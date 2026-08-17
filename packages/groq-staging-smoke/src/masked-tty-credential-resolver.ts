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

import {
  classifyRejection,
  isBoundedCredential,
  MAX_CREDENTIAL_LENGTH,
  MIN_CREDENTIAL_LENGTH,
} from './credential-policy.js';
import type { CredentialOutcome, DiagnosticRecorder } from './diagnostic-telemetry.js';
import type { SmokeFailureReason } from './smoke-reasons.js';

/**
 * The bounded shape an accepted staging credential must have. No provider prefix is asserted.
 *
 * HF4-R5 moved the rule itself into `credential-policy.ts` so the clipboard ingress applies the SAME
 * predicate rather than a second copy of it. These re-exports keep this module's surface unchanged.
 */
export { MAX_CREDENTIAL_LENGTH, MIN_CREDENTIAL_LENGTH };

/** The label shown at the prompt. It names the reference, never a value. */
export const CREDENTIAL_PROMPT_LABEL = 'Staging Groq credential (input hidden): ';

/**
 * How a masked read failed, as TYPED identity rather than a parsed message.
 *
 * `aborted` is claimed ONLY when the source itself signalled an explicit operator abort (Ctrl-C /
 * Ctrl-D) through its own control flow. Everything else — a consumed source, an unavailable raw mode,
 * or any foreign rejection — is `unavailable`, the safe fallback. Classifying by error message would
 * mean trusting arbitrary text; this cannot.
 */
export const SECRET_READ_FAILURE_KINDS = ['aborted', 'unavailable'] as const;
export type SecretReadFailureKind = (typeof SECRET_READ_FAILURE_KINDS)[number];

/** The one typed rejection the production source raises. Carries a kind, never a value or a cause. */
export class MaskedSecretReadError extends Error {
  public readonly kind: SecretReadFailureKind;

  public constructor(kind: SecretReadFailureKind) {
    // A fixed message. It quotes no path, no cause, no reference, and no typed character.
    super('QFJ_SMOKE_SECRET_READ_FAILED');
    this.name = 'MaskedSecretReadError';
    this.kind = kind;
  }
}

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
   * LEGACY (QFJ-S1D-E). A count of read ATTEMPTS, retained only for output compatibility with the
   * pre-S1D-E `credentialReads` field. It equals {@link StagingCredentialResolver.readAttempts} in this
   * one-shot harness. It has never meant "a credential was resolved" — use `resolutions` for that.
   */
  readonly reads: () => number;
  /** The sanitized code for the last refusal, or `undefined` if none. Never a cause or a value. */
  readonly lastFailure: () => SmokeFailureReason | undefined;
  /** QFJ-S1D-E: which local ingress branch ran. A code path, never a property of the value. */
  readonly outcome: () => CredentialOutcome;
  /** QFJ-S1D-E: how many times the source read was ENTERED (0 when the TTY gate refused). */
  readonly readAttempts: () => number;
  /** QFJ-S1D-E: how many credential objects were successfully created. */
  readonly resolutions: () => number;
}

/** The narrow recorder slice the resolver needs. Optional, so existing compositions are unchanged. */
export type CredentialIngressRecorder = Pick<
  DiagnosticRecorder,
  'mark' | 'recordCredentialOutcome' | 'countCredentialReadAttempt' | 'countCredentialResolution'
>;

/** Injection points added for diagnostics. Both optional; neither changes acceptance semantics. */
export interface MaskedResolverOptions {
  readonly recorder?: CredentialIngressRecorder;
  /**
   * The credential holder factory. Production always uses `createGroqApiKey`. A test may inject a
   * refusing factory to exercise `rejected-holder`, which the real bounds make unreachable — the
   * production guards are NOT weakened to make that branch testable.
   */
  readonly createHolder?: (value: string) => GroqApiKey;
}

/**
 * Build the resolver over an injected terminal seam. `resolve` rejects with a FIXED, value-free error;
 * the specific sanitized code is read from {@link StagingCredentialResolver.lastFailure}, because the
 * gateway binding deliberately collapses every resolver rejection to `groq-bind-credential-unavailable`.
 *
 * QFJ-S1D-E adds a closed {@link CredentialOutcome} naming the exact local branch that ran. It reports;
 * it never decides. Which values are accepted is unchanged.
 */
export function createMaskedTtyCredentialResolver(
  source: MaskedSecretSource,
  options: MaskedResolverOptions = {},
): StagingCredentialResolver {
  const recorder = options.recorder;
  const createHolder = options.createHolder ?? createGroqApiKey;
  const state: {
    entered: boolean;
    reads: number;
    resolutions: number;
    failure: SmokeFailureReason | undefined;
    outcome: CredentialOutcome;
  } = {
    entered: false,
    reads: 0,
    resolutions: 0,
    failure: undefined,
    outcome: 'not-attempted',
  };

  const record = (outcome: CredentialOutcome): void => {
    // First non-default wins locally, mirroring the recorder, so a refused re-entry cannot overwrite.
    if (state.outcome === 'not-attempted') {
      state.outcome = outcome;
    }
    recorder?.recordCredentialOutcome(outcome);
  };

  const fail = (reason: SmokeFailureReason, outcome: CredentialOutcome): Promise<GroqApiKey> => {
    state.failure = reason;
    record(outcome);
    // A fixed message. It quotes no path, no cause, no reference, and no typed character.
    return Promise.reject(new Error('QFJ_SMOKE_CREDENTIAL_REFUSED'));
  };

  return Object.freeze({
    async resolve(_reference: GroqCredentialReference): Promise<GroqApiKey> {
      // Exactly one entry per process. A second call fails closed rather than re-prompting, and
      // deliberately does NOT overwrite the first call's recorded outcome.
      if (state.entered) {
        state.failure = 'smoke-credential-invalid';
        return Promise.reject(new Error('QFJ_SMOKE_CREDENTIAL_REFUSED'));
      }
      state.entered = true;

      // The TTY gate is re-checked here so the resolver is safe on its own, not only via the harness.
      // It runs BEFORE any attempt is counted, so a refusal leaves the attempt counter at zero.
      if (!source.isInteractive()) {
        return fail('smoke-tty-required', 'tty-required');
      }

      // Counted immediately before the read is entered — an attempt, never a success.
      state.reads += 1;
      recorder?.countCredentialReadAttempt();

      let typed: string;
      try {
        typed = await source.readOnce(CREDENTIAL_PROMPT_LABEL);
      } catch (error: unknown) {
        recorder?.mark('credentialReadSettled');
        // TYPED identity only. An explicit abort is claimed solely when the source itself said so;
        // every other rejection, including a foreign one, falls back to `read-unavailable`.
        const aborted = error instanceof MaskedSecretReadError && error.kind === 'aborted';
        return fail('smoke-credential-invalid', aborted ? 'read-aborted' : 'read-unavailable');
      }
      recorder?.mark('credentialReadSettled');

      if (!isBoundedCredential(typed)) {
        return fail('smoke-credential-invalid', classifyRejection(typed));
      }

      // The holder wraps the value in the redacting type. From here the value has no accessor:
      // `toString`, `toJSON`, and the Node inspect hook all return the redaction marker.
      let holder: GroqApiKey;
      try {
        holder = createHolder(typed);
      } catch {
        return fail('smoke-credential-invalid', 'rejected-holder');
      }
      state.resolutions += 1;
      recorder?.countCredentialResolution();
      record('resolved');
      return holder;
    },
    reads: () => state.reads,
    lastFailure: () => state.failure,
    outcome: () => state.outcome,
    readAttempts: () => state.reads,
    resolutions: () => state.resolutions,
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
        return Promise.reject(new MaskedSecretReadError('unavailable'));
      }
      consumed = true;

      const input = process.stdin;
      if (typeof input.setRawMode !== 'function') {
        return Promise.reject(new MaskedSecretReadError('unavailable'));
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
          reject(new MaskedSecretReadError('aborted'));
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
