/**
 * The concrete masked-TTY staging credential resolver (QFJ-S1A, ADR-0061 §B) — the closure of
 * QFJ-S1-BLOCK-001.
 *
 * It lives OUTSIDE `@qf-jarvis/model-gateway` on purpose: the gateway package keeps its property of
 * reading no environment and owning no ingress, and this package supplies the one approved ingress for a
 * controlled staging run. The resolver satisfies the existing `GroqCredentialResolver` interface and
 * returns the existing redacting `GroqApiKey`, so the key's only exit remains the `Authorization` header
 * built at the transport edge.
 *
 * The ingress rules, all enforced here rather than documented:
 *   - the key is typed at an INTERACTIVE terminal — never `argv`, never the configuration file, never
 *     the process environment (this package reads no environment variable at all), never a file;
 *   - a non-TTY / piped / redirected stdin is refused BEFORE any read is attempted;
 *   - terminal echo is disabled while reading, so the value is never rendered;
 *   - the value is length- and charset-bounded before it is accepted;
 *   - it is read EXACTLY ONCE — a second `resolve` fails closed instead of re-prompting;
 *   - no method returns or exposes the value, and the failure path reports a sanitized code only;
 *   - the accumulating character buffer is cleared once the value has been built;
 *   - the key stays in process memory for the single run and the process then exits.
 *
 * This resolver is approved ONLY for the controlled staging smoke. It is not, and must not become, the
 * production deployment secret-manager integration.
 */
import { createGroqApiKey, type GroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqCredentialReference, GroqCredentialResolver } from '@qf-jarvis/model-gateway';

import type { SmokeFailureReason } from './smoke-reasons.js';

/** The bounded shape an accepted staging credential must have. No provider prefix is asserted. */
export const MIN_CREDENTIAL_LENGTH = 20;
export const MAX_CREDENTIAL_LENGTH = 200;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The label shown at the prompt. It names the reference, never a value. */
export const CREDENTIAL_PROMPT_LABEL = 'Staging Groq credential (input hidden): ';

/**
 * The narrow terminal seam. Production reads a real masked TTY; tests inject a deterministic fake, so no
 * test ever touches real terminal echo state.
 */
export interface MaskedSecretSource {
  /** True only when stdin AND stdout are a real interactive terminal. Checked before any read. */
  isInteractive(): boolean;
  /** Read one secret with echo disabled. Called at most once per process. May reject. */
  readOnce(label: string): Promise<string>;
}

/** A `GroqCredentialResolver` that also reports its read count and its sanitized failure code. */
export interface StagingCredentialResolver extends GroqCredentialResolver {
  /**
   * How many credential reads were actually PERFORMED. A refused second `resolve` does not increment
   * it, because nothing was read — so the harness can assert this never exceeds one.
   */
  readonly reads: () => number;
  /** The sanitized code for the last refusal, or `undefined` if none. Never a cause or a value. */
  readonly lastFailure: () => SmokeFailureReason | undefined;
}

function isBoundedCredential(value: string): boolean {
  return (
    value.length >= MIN_CREDENTIAL_LENGTH &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    CREDENTIAL_PATTERN.test(value)
  );
}

/**
 * Build the resolver over an injected terminal seam. `resolve` rejects with a FIXED, value-free error;
 * the specific sanitized code is read from {@link StagingCredentialResolver.lastFailure}, because the
 * gateway binding deliberately collapses every resolver rejection to `groq-bind-credential-unavailable`.
 */
export function createMaskedTtyCredentialResolver(
  source: MaskedSecretSource,
): StagingCredentialResolver {
  const state: { reads: number; failure: SmokeFailureReason | undefined } = {
    reads: 0,
    failure: undefined,
  };

  const fail = (reason: SmokeFailureReason): Promise<GroqApiKey> => {
    state.failure = reason;
    // A fixed message. It quotes no path, no cause, no reference, and no typed character.
    return Promise.reject(new Error('QFJ_SMOKE_CREDENTIAL_REFUSED'));
  };

  return Object.freeze({
    async resolve(_reference: GroqCredentialReference): Promise<GroqApiKey> {
      // Exactly one read per process. A second call fails closed rather than re-prompting.
      if (state.reads >= 1) {
        return fail('smoke-credential-invalid');
      }
      state.reads += 1;

      // The TTY gate is re-checked here so the resolver is safe on its own, not only via the harness.
      if (!source.isInteractive()) {
        return fail('smoke-tty-required');
      }

      let typed: string;
      try {
        typed = await source.readOnce(CREDENTIAL_PROMPT_LABEL);
      } catch {
        return fail('smoke-credential-invalid');
      }

      if (!isBoundedCredential(typed)) {
        return fail('smoke-credential-invalid');
      }

      // `createGroqApiKey` wraps the value in the redacting holder. From here the value has no
      // accessor: `toString`, `toJSON`, and the Node inspect hook all return the redaction marker.
      try {
        return createGroqApiKey(typed);
      } catch {
        return fail('smoke-credential-invalid');
      }
    },
    reads: () => state.reads,
    lastFailure: () => state.failure,
  });
}

// The raw-mode control characters, built numerically so this source file itself stays free of any
// control byte (the repository's containment scan rejects one in production source).
const END_OF_TEXT = String.fromCharCode(3); // Ctrl-C
const END_OF_TRANSMISSION = String.fromCharCode(4); // Ctrl-D
const BACKSPACE = String.fromCharCode(8);
const DELETE = String.fromCharCode(127);
const SPACE = ' ';

/**
 * The production terminal seam: a raw-mode, echo-disabled, single-use read from the real terminal.
 *
 * Nothing is echoed — not the characters, not a mask character, not a length. Backspace edits the
 * buffer; Ctrl-C and Ctrl-D abort. The accumulating array is emptied once the string has been built,
 * which is as much erasure as a JavaScript runtime permits (the resulting string is immutable).
 *
 * This function is never used by a test: the entire test suite injects a fake source instead, so the
 * suite never mutates a real terminal's echo state and never blocks on input.
 */
export function createNodeMaskedSecretSource(): MaskedSecretSource {
  let consumed = false;

  return {
    isInteractive(): boolean {
      return process.stdin.isTTY && process.stdout.isTTY;
    },

    readOnce(label: string): Promise<string> {
      if (consumed) {
        return Promise.reject(new Error('QFJ_SMOKE_SECRET_ALREADY_READ'));
      }
      consumed = true;

      const input = process.stdin;
      if (typeof input.setRawMode !== 'function') {
        return Promise.reject(new Error('QFJ_SMOKE_TTY_UNAVAILABLE'));
      }

      return new Promise<string>((resolve, reject) => {
        const characters: string[] = [];
        let settled = false;

        const restore = (): void => {
          input.removeListener('data', onData);
          input.setRawMode(false);
          input.pause();
          // End the prompt line. The typed value was never rendered, so nothing is being hidden here.
          process.stdout.write('\n');
        };

        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          restore();
          const value = characters.join('');
          characters.fill('');
          characters.length = 0;
          resolve(value);
        };

        const abort = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          restore();
          characters.fill('');
          characters.length = 0;
          reject(new Error('QFJ_SMOKE_SECRET_READ_ABORTED'));
        };

        const onData = (chunk: string): void => {
          for (const character of chunk) {
            if (character === '\r' || character === '\n') {
              finish();
              return;
            }
            if (character === END_OF_TEXT || character === END_OF_TRANSMISSION) {
              abort();
              return;
            }
            if (character === DELETE || character === BACKSPACE) {
              characters.pop();
              continue;
            }
            if (character >= SPACE && character !== DELETE) {
              characters.push(character);
            }
          }
        };

        process.stdout.write(label);
        input.setRawMode(true);
        input.setEncoding('utf8');
        input.resume();
        input.on('data', onData);
      });
    },
  };
}
