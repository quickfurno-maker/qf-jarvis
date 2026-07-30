/**
 * The production Groq credential binding at the process boundary (QFJ-S2-D-B, ADR-0064).
 *
 * It implements the EXISTING `GroqCredentialResolver` — the seam `@qf-jarvis/model-gateway` already
 * declares — over one explicitly configured file. It is Groq-specific on purpose: a provider-neutral
 * `resolve(ref): Promise<string>` would erase the branding that is currently the whole defence.
 *
 * This module imports NO filesystem module; all disk access lives in the one designated adapter. It
 * reads no environment variable. It constructs no provider, calls no provider, and opens no transport.
 *
 * Lifecycle (ADR-0064 §6):
 *   - construction reads NOTHING;
 *   - the first matching `resolve` performs the first read, and concurrent first callers share it;
 *   - `refresh()` forces one read, replacing the holder future resolutions return;
 *   - a failed refresh keeps the last-known-good, marks `stale`, and retries nothing.
 *
 * On erasure: JavaScript strings are immutable and GC-managed, and `fetch` ultimately requires a
 * string, so the value cannot be zeroised. This module does not pretend otherwise — it minimises how
 * many places hold the value, not how long the runtime keeps a copy alive.
 */
import { createGroqApiKey, type GroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqCredentialReference, GroqCredentialResolver } from '@qf-jarvis/model-gateway';

import { CredentialBindingError, type CredentialFailureCode } from './credential-errors.js';
import {
  createNodeCredentialFileReader,
  type CredentialFileRead,
  type CredentialFileReader,
} from './credential-file-reader.js';

/** The one backend this slice ships. A fixed token, safe to emit. */
const BACKEND_TYPE = 'file';

/** The bounded shape a configured reference must have. No wildcard, no `latest`, no path-like text. */
const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_REFERENCE_LENGTH = 128;
const WILDCARDS: ReadonlySet<string> = new Set(['*', 'latest']);

/**
 * Every C0 control byte plus DEL — which covers NUL, and any CR or LF beyond the one terminal
 * sequence stripped above.
 *
 * Built from escapes rather than written literally: a literal control byte in source is exactly what
 * the repository's containment scan rejects, and it would be invisible in a diff.
 */
// eslint-disable-next-line no-control-regex -- rejecting control bytes IS this guard's purpose.
const CONTROL_BYTE = new RegExp('[\u0000-\u001f\u007f]');

/** What the process boundary supplies. Immutable, explicit, and free of ambient inputs. */
export interface FileGroqCredentialBindingConfig {
  /** The OPAQUE reference this binding answers for. Never a path, never the value. */
  readonly credentialReference: GroqCredentialReference;
  /** The absolute path of the mounted credential file. Explicit — never read from the environment. */
  readonly absoluteFilePath: string;
  /** Injected read seam. Production omits it and gets the real designated adapter. */
  readonly fileReader?: CredentialFileReader;
}

/** The outcome of a forced refresh. Closed; never a message, path, or value. */
export type CredentialRefreshResult =
  { readonly ok: true } | { readonly ok: false; readonly code: CredentialFailureCode };

/**
 * Redacted, deeply frozen diagnostics (ADR-0064 §11).
 *
 * Counters, two booleans, a closed outcome and fixed tokens. `credentialReference` is deliberately
 * ABSENT: it names a secret's location in a store, and `providerId`/`releaseId` already identify a run.
 */
export interface CredentialBindingSnapshot {
  readonly backendType: string;
  readonly resolveAttempts: number;
  readonly resolveSuccesses: number;
  readonly refreshAttempts: number;
  readonly refreshSuccesses: number;
  readonly hasCurrentCredential: boolean;
  /** True once a forced refresh has failed while a last-known-good is still being served. */
  readonly stale: boolean;
  readonly lastOutcome: 'not-attempted' | 'success' | CredentialFailureCode;
  readonly authority: 'QUICKFURNO_CORE';
}

/**
 * The process-boundary handle. Exactly three members, and nothing that could leak identity or state:
 * no raw credential, no path, no reference, no in-flight promise, no mutable cache, no provider, no
 * activation method.
 */
export interface FileGroqCredentialBinding {
  readonly resolver: GroqCredentialResolver;
  refresh(): Promise<CredentialRefreshResult>;
  snapshot(): CredentialBindingSnapshot;
}

/** True iff a reference is exact, bounded, and not a wildcard sentinel. */
function isExactReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_REFERENCE_LENGTH &&
    REFERENCE_PATTERN.test(value) &&
    !WILDCARDS.has(value.toLowerCase())
  );
}

/**
 * Strip AT MOST one terminal newline sequence, then refuse anything else.
 *
 * A file mount commonly appends one `LF` or `CRLF`; that much is normalised. Everything else is a
 * refusal rather than a repair — `trim()` is never called, because silently absorbing whitespace turns a
 * wrong credential into a confusing 401 instead of a clear local failure.
 */
export function normalizeCredentialFileText(text: string): { readonly value: string } | undefined {
  let value = text;
  if (value.endsWith('\r\n')) {
    value = value.slice(0, -2);
  } else if (value.endsWith('\n')) {
    value = value.slice(0, -1);
  }
  // A second terminal newline, any embedded CR/LF, any NUL or other control byte.
  if (CONTROL_BYTE.test(value)) {
    return undefined;
  }
  // Any surviving leading or trailing whitespace — space, tab, NBSP — is refused, not trimmed.
  if (value.length === 0 || value !== value.replace(/^\s+|\s+$/gu, '')) {
    return undefined;
  }
  return { value };
}

/** Turn one bounded read into a branded holder, or a closed failure code. */
function toCredential(
  read: CredentialFileRead,
):
  | { readonly ok: true; readonly key: GroqApiKey }
  | { readonly ok: false; readonly code: CredentialFailureCode } {
  if (!read.ok) {
    return { ok: false, code: read.code };
  }
  const normalized = normalizeCredentialFileText(read.text);
  if (normalized === undefined) {
    return { ok: false, code: 'credential-value-invalid' };
  }
  try {
    // The EXISTING gateway factory owns the final bounds check and the branding.
    return { ok: true, key: createGroqApiKey(normalized.value) };
  } catch {
    // Its message is fixed and quotes nothing, but it is discarded regardless.
    return { ok: false, code: 'credential-value-invalid' };
  }
}

/**
 * Build the process-boundary credential binding. Constructing it performs NO read — not of the file,
 * not of the environment. The first matching `resolve` is what touches disk.
 */
export function createFileGroqCredentialBinding(
  config: FileGroqCredentialBindingConfig,
): FileGroqCredentialBinding {
  if (!isExactReference(config.credentialReference.ref)) {
    // A malformed configured reference is a construction-time invariant, not a runtime outcome.
    throw new CredentialBindingError('credential-reference-invalid');
  }
  const configuredRef = config.credentialReference.ref;
  const reader = config.fileReader ?? createNodeCredentialFileReader(config.absoluteFilePath);

  const state: {
    current: GroqApiKey | undefined;
    initialRead: Promise<GroqApiKey> | undefined;
    refreshInFlight: Promise<CredentialRefreshResult> | undefined;
    stale: boolean;
    resolveAttempts: number;
    resolveSuccesses: number;
    refreshAttempts: number;
    refreshSuccesses: number;
    lastOutcome: CredentialBindingSnapshot['lastOutcome'];
  } = {
    current: undefined,
    initialRead: undefined,
    refreshInFlight: undefined,
    stale: false,
    resolveAttempts: 0,
    resolveSuccesses: 0,
    refreshAttempts: 0,
    refreshSuccesses: 0,
    lastOutcome: 'not-attempted',
  };

  /**
   * One bounded read, converted to a holder. Shared by the initial resolution and by refresh.
   *
   * The designated adapter returns a closed result and never throws, but this catches anyway: an
   * injected or future seam that throws would otherwise propagate a raw exception — one that typically
   * carries the filesystem path in its `message` and `path` fields — straight through this boundary.
   * Any throw is discarded and reported as `internal-invariant`, so no backend text can escape.
   */
  async function readOnce(): Promise<
    | { readonly ok: true; readonly key: GroqApiKey }
    | { readonly ok: false; readonly code: CredentialFailureCode }
  > {
    let read: CredentialFileRead;
    try {
      read = await reader.read();
    } catch {
      return { ok: false, code: 'internal-invariant' };
    }
    return toCredential(read);
  }

  return Object.freeze({
    resolver: Object.freeze({
      async resolve(reference: GroqCredentialReference): Promise<GroqApiKey> {
        state.resolveAttempts += 1;
        // Only the configured reference is answered. No path is derived from it, and it is never
        // echoed — the caller learns only that its reference is not this binding's.
        // Narrowed through `unknown`: the signature promises an object, but this is a process
        // boundary and a caller can hand over anything. Trusting the declared type here would make
        // the guard decorative.
        const candidate: unknown = reference;
        if (
          typeof candidate !== 'object' ||
          candidate === null ||
          (candidate as GroqCredentialReference).ref !== configuredRef
        ) {
          state.lastOutcome = 'credential-reference-invalid';
          throw new CredentialBindingError('credential-reference-invalid');
        }
        // Last-known-good short-circuit: this is also what lets a resolve DURING a forced refresh
        // return immediately rather than block on the refresh.
        const current = state.current;
        if (current !== undefined) {
          state.resolveSuccesses += 1;
          state.lastOutcome = 'success';
          return current;
        }
        // Single flight: concurrent first callers share ONE read.
        state.initialRead ??= (async (): Promise<GroqApiKey> => {
          const result = await readOnce();
          if (!result.ok) {
            state.lastOutcome = result.code;
            throw new CredentialBindingError(result.code);
          }
          state.current = result.key;
          state.stale = false;
          return result.key;
        })().finally(() => {
          // Cleared either way, so a failed first read does not poison every later attempt.
          state.initialRead = undefined;
        });

        const key = await state.initialRead;
        state.resolveSuccesses += 1;
        state.lastOutcome = 'success';
        return key;
      },
    }),

    /**
     * Force exactly one new read. Overlapping refreshes SHARE one in-flight read — the locked policy,
     * so two callers can never produce two reads.
     *
     * This replaces the value FUTURE resolutions return. It rebuilds no provider, rebinds nothing, and
     * invokes no model: refreshing a credential is not retrying a model invocation.
     */
    refresh(): Promise<CredentialRefreshResult> {
      state.refreshAttempts += 1;
      state.refreshInFlight ??= (async (): Promise<CredentialRefreshResult> => {
        const result = await readOnce();
        if (result.ok) {
          state.current = result.key;
          state.stale = false;
          state.refreshSuccesses += 1;
          state.lastOutcome = 'success';
          return Object.freeze({ ok: true as const });
        }
        if (state.current !== undefined) {
          // Last-known-good is preserved and keeps serving; the caller is told the refresh failed.
          state.stale = true;
          state.lastOutcome = 'credential-refresh-failed';
          return Object.freeze({ ok: false as const, code: 'credential-refresh-failed' as const });
        }
        // No last-known-good exists, so the underlying initial failure is the accurate answer.
        state.lastOutcome = result.code;
        return Object.freeze({ ok: false as const, code: result.code });
      })().finally(() => {
        state.refreshInFlight = undefined;
      });
      return state.refreshInFlight;
    },

    snapshot(): CredentialBindingSnapshot {
      return Object.freeze({
        backendType: BACKEND_TYPE,
        resolveAttempts: state.resolveAttempts,
        resolveSuccesses: state.resolveSuccesses,
        refreshAttempts: state.refreshAttempts,
        refreshSuccesses: state.refreshSuccesses,
        hasCurrentCredential: state.current !== undefined,
        stale: state.stale,
        lastOutcome: state.lastOutcome,
        authority: 'QUICKFURNO_CORE',
      });
    },
  });
}
