/**
 * Non-secret, low-cardinality timeout diagnostics for the one-shot staging smoke (QFJ-S1D-B).
 *
 * The first authorized smoke returned `smoke-timeout` with every counter at 1. That result proved the
 * harness behaved, and proved nothing about WHERE the 30 s went: credential entry, DNS/TLS/connect,
 * waiting for response headers, streaming the body, or settlement were all indistinguishable. This
 * module makes the last completed phase observable — and nothing else.
 *
 * Two properties are structural rather than promised:
 *
 *   1. **It cannot carry a secret.** A milestone is a name from a closed list and a number of
 *      milliseconds. The recorder accepts no strings from the caller, so a key, a header, a prompt, a
 *      body, an error message, a URL, or a stack trace has no representable place to go.
 *   2. **It cannot change behaviour.** Recording is pure bookkeeping: no branch in the run depends on
 *      a milestone, no timer is added, and the timeout is untouched.
 *
 * Every elapsed value is an integer millisecond offset from a run-local origin taken when the recorder
 * is created, read from an injected monotonic clock. Wall-clock time never enters it, so a clock step
 * cannot produce a negative or nonsensical duration.
 */

/** The injected monotonic clock. Milliseconds since an arbitrary origin; never the wall clock. */
export interface MonotonicClock {
  nowMs(): number;
}

/**
 * The production clock. `performance.now()` is monotonic within a process, which is exactly the
 * guarantee a phase measurement needs and the one `Date.now()` does not give.
 */
export function createSystemMonotonicClock(): MonotonicClock {
  return {
    nowMs(): number {
      return Math.round(performance.now());
    },
  };
}

/** The closed set of observable milestones. Order here is documentation, not an enforced sequence. */
export const SMOKE_MILESTONES = [
  'timerArmed',
  'bindStarted',
  'credentialReadSettled',
  'credentialResolved',
  'invokeStarted',
  'requestConstructed',
  'fetchStarted',
  'headersReceived',
  'responseBodyStarted',
  'responseBodyCompleted',
  'invokeSettled',
  'abortSignalled',
] as const;
export type SmokeMilestone = (typeof SMOKE_MILESTONES)[number];

/** The closed set of phases an abort can land in. Derived solely from the last proven milestone. */
export const SMOKE_TIMEOUT_PHASES = [
  'pre-bind',
  'credential-resolution',
  'pre-fetch',
  'awaiting-headers',
  'awaiting-body',
  'post-body',
  'invoke-settlement',
  'unknown',
] as const;
export type SmokeTimeoutPhase = (typeof SMOKE_TIMEOUT_PHASES)[number];

/**
 * The closed set of normalized transport failure codes.
 *
 * These are CLASSES, not messages. A failure is mapped to the narrowest member that is deterministically
 * identifiable from the error's `name`/`code` (and one level of `cause.code`); everything else is
 * `OTHER`. The originating error object is never read for its message, stack, or any URL it quotes.
 */
export const TRANSPORT_ERROR_CODES = [
  'NONE',
  'ABORT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'CERT',
  'OTHER',
] as const;
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

/**
 * The closed set of CREDENTIAL INGRESS outcomes (QFJ-S1D-B / S1D-E).
 *
 * S1D-C failed locally with a single `smoke-credential-invalid`, which collapsed six distinct causes
 * into one word and left the operator with nothing to act on. These members name the exact local branch
 * that ran — and nothing about the value that ran through it.
 *
 * Each member is a CODE PATH, never a property of the credential:
 *   - `not-attempted`     the resolver was never entered (a bind gate refused first)
 *   - `tty-required`      the interactive gate failed before any source read
 *   - `read-aborted`      the source signalled an explicit operator abort (Ctrl-C / Ctrl-D)
 *   - `read-unavailable`  the source failed for any other reason — the SAFE FALLBACK
 *   - `rejected-empty`    a zero-character value
 *   - `rejected-too-short` non-empty but under the existing lower bound
 *   - `rejected-too-long` over the existing upper bound
 *   - `rejected-charset`  violates the existing allowed-character predicate
 *   - `rejected-holder`   the credential holder refused construction after the earlier guards
 *   - `resolved`          a credential object was successfully created
 *
 * MVP-P2A.2 HF4-R5 adds the four branches the CLIPBOARD ingress can take before a value is ever
 * classified. They name a failure of the INGRESS, never a property of a credential:
 *
 *   - `clipboard-platform-unsupported` the ingress is Windows-only and this is not Windows
 *   - `clipboard-helper-failed`        the helper could not run, timed out, or overran its bound
 *   - `clipboard-unavailable`          the helper ran and the OS refused the clipboard read
 *   - `clipboard-clear-failed`         the value was read and the OS refused to overwrite the entry
 *
 * `clipboard-clear-failed` is a REFUSAL, not a warning. A run that could not take the credential back
 * out of the clipboard fails closed rather than continuing with a live key sitting in it. RUN S7 ended
 * exactly here, on Windows PowerShell 5.1, and reached no holder and no provider.
 *
 * MVP-P2A.2 HF4-R6 adds one more:
 *
 *   - `clipboard-sentinel-present`     the clipboard held the marker a previous run wrote, not a key
 *
 * It is separate from `rejected-*` because it is not a malformed credential — it is the correct sign
 * that the previous run removed one, and the operator simply has not copied a new value yet. Telling
 * an owner "the charset was wrong" there would send them looking for a defect that is not present.
 *
 * The shape classifications above are deliberately SHARED with the clipboard ingress rather than
 * duplicated: a value that is too short is `rejected-too-short` whichever door it arrived through.
 *
 * A finer member is NEVER inferred when the source cannot prove it; unclassified source failures are
 * `read-unavailable`. Classification uses typed error identity, never message parsing.
 */
export const CREDENTIAL_OUTCOMES = [
  'not-attempted',
  'tty-required',
  'read-aborted',
  'read-unavailable',
  'clipboard-platform-unsupported',
  'clipboard-helper-failed',
  'clipboard-unavailable',
  'clipboard-clear-failed',
  'clipboard-sentinel-present',
  'rejected-empty',
  'rejected-too-short',
  'rejected-too-long',
  'rejected-charset',
  'rejected-holder',
  'resolved',
] as const;
export type CredentialOutcome = (typeof CREDENTIAL_OUTCOMES)[number];

/** Codes that map to themselves when observed verbatim on an error. */
const PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Certificate/TLS failure codes, collapsed to the single `CERT` class. */
const CERT_CODES: ReadonlySet<string> = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function readCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Map a transport failure to the narrowest deterministic class.
 *
 * Only `name` and `code` are consulted, plus one level of `cause.code`. The message, the stack, and any
 * URL or address the error quotes are never read — so nothing arbitrary can reach the report.
 */
export function normaliseTransportError(error: unknown): TransportErrorCode {
  if (readName(error) === 'AbortError') {
    return 'ABORT';
  }
  const codes = [readCode(error), readCode((error as { cause?: unknown } | null)?.cause)];
  for (const code of codes) {
    if (code === undefined) {
      continue;
    }
    if (code === 'ABORT_ERR') {
      return 'ABORT';
    }
    if (PASSTHROUGH_CODES.has(code)) {
      return code as TransportErrorCode;
    }
    if (CERT_CODES.has(code) || code.startsWith('CERT_') || code.startsWith('ERR_TLS_')) {
      return 'CERT';
    }
  }
  return 'OTHER';
}

/** The frozen, fully non-secret diagnostic snapshot attached to every smoke outcome. */
export interface SmokeDiagnostics {
  readonly timerArmedMs: number | undefined;
  readonly bindStartedMs: number | undefined;
  /** When `source.readOnce` settled — resolved OR rejected. Absent when no read was attempted. */
  readonly credentialReadSettledMs: number | undefined;
  readonly credentialResolvedMs: number | undefined;
  readonly invokeStartedMs: number | undefined;
  readonly requestConstructedMs: number | undefined;
  readonly fetchStartedMs: number | undefined;
  readonly headersReceivedMs: number | undefined;
  readonly responseBodyStartedMs: number | undefined;
  readonly responseBodyCompletedMs: number | undefined;
  readonly invokeSettledMs: number | undefined;
  readonly abortSignalledMs: number | undefined;
  /** `credentialResolvedMs - bindStartedMs`: the bind gates plus the operator's typing time. */
  readonly credentialEntryMs: number | undefined;
  /** `responseBodyCompletedMs - fetchStartedMs`. Absent unless BOTH ends are proven — never estimated. */
  readonly networkElapsedMs: number | undefined;
  /** Elapsed from the run-local origin to settlement, or to the snapshot if the run never settled. */
  readonly totalElapsedMs: number;
  /** The phase the abort landed in, frozen AT abort. `unknown` when no abort fired. */
  readonly timeoutPhase: SmokeTimeoutPhase;
  readonly transportErrorCode: TransportErrorCode;
  /** Which local credential-ingress branch ran. Says nothing about the value. */
  readonly credentialOutcome: CredentialOutcome;
  /** How many times the source read was ENTERED. The TTY refusal never reaches it, so it stays 0. */
  readonly credentialReadAttempts: number;
  /** How many credential objects were successfully created. 0 or 1 in this one-shot harness. */
  readonly credentialResolutions: number;
}

/** The recorder. Accepts only closed-vocabulary milestones and enum codes — never caller strings. */
export interface DiagnosticRecorder {
  /** Stamp a milestone. The FIRST stamp for a milestone wins, so a retry could not overwrite history. */
  mark(milestone: SmokeMilestone): void;
  /**
   * Stamp the abort and FREEZE the timeout phase from the milestones proven at this instant. Freezing
   * here is the whole point: by the time the run settles, `invokeSettled` is always present and every
   * timeout would otherwise look identical.
   */
  markAbort(): void;
  /** Record the normalized transport failure class. The first non-`NONE` code wins. */
  recordTransportError(code: TransportErrorCode): void;
  /** Record the credential-ingress branch. The FIRST non-default outcome wins. */
  recordCredentialOutcome(outcome: CredentialOutcome): void;
  /** Count one entry into the source read. Stamped immediately before `source.readOnce`. */
  countCredentialReadAttempt(): void;
  /** Count one successfully constructed credential object. */
  countCredentialResolution(): void;
  snapshot(): SmokeDiagnostics;
}

/**
 * Derive the phase from the last PROVEN milestone.
 *
 * The ordering is causal, not chronological guesswork: each rung requires the one below it, so a phase
 * is only reported when the harness actually observed reaching it.
 */
export function deriveTimeoutPhase(
  marks: Readonly<Partial<Record<SmokeMilestone, number>>>,
): SmokeTimeoutPhase {
  if (marks.invokeSettled !== undefined) {
    return 'invoke-settlement';
  }
  if (marks.responseBodyCompleted !== undefined) {
    return 'post-body';
  }
  if (marks.headersReceived !== undefined) {
    return 'awaiting-body';
  }
  if (marks.fetchStarted !== undefined) {
    return 'awaiting-headers';
  }
  if (marks.credentialResolved !== undefined) {
    return 'pre-fetch';
  }
  if (marks.bindStarted !== undefined) {
    return 'credential-resolution';
  }
  if (marks.timerArmed !== undefined) {
    return 'pre-bind';
  }
  return 'unknown';
}

function difference(later: number | undefined, earlier: number | undefined): number | undefined {
  return later === undefined || earlier === undefined ? undefined : later - earlier;
}

/** Build a recorder whose origin is the moment of construction. */
export function createDiagnosticRecorder(clock: MonotonicClock): DiagnosticRecorder {
  const origin = clock.nowMs();
  const marks: Partial<Record<SmokeMilestone, number>> = {};
  const state: {
    phase: SmokeTimeoutPhase;
    error: TransportErrorCode;
    credential: CredentialOutcome;
    readAttempts: number;
    resolutions: number;
  } = {
    phase: 'unknown',
    error: 'NONE',
    credential: 'not-attempted',
    readAttempts: 0,
    resolutions: 0,
  };

  const stamp = (milestone: SmokeMilestone): void => {
    // First stamp wins, so history cannot be rewritten by a later call.
    marks[milestone] ??= clock.nowMs() - origin;
  };

  return {
    mark: stamp,
    markAbort(): void {
      // Freeze the phase BEFORE stamping the abort, so `abortSignalled` cannot influence the answer.
      if (marks.abortSignalled === undefined) {
        state.phase = deriveTimeoutPhase(marks);
      }
      stamp('abortSignalled');
    },
    recordCredentialOutcome(outcome: CredentialOutcome): void {
      // First non-default wins, so a refused re-entry cannot overwrite the real outcome.
      if (state.credential === 'not-attempted') {
        state.credential = outcome;
      }
    },
    countCredentialReadAttempt(): void {
      state.readAttempts += 1;
    },
    countCredentialResolution(): void {
      state.resolutions += 1;
    },
    recordTransportError(code: TransportErrorCode): void {
      if (state.error === 'NONE') {
        state.error = code;
      }
    },
    snapshot(): SmokeDiagnostics {
      return Object.freeze({
        timerArmedMs: marks.timerArmed,
        bindStartedMs: marks.bindStarted,
        credentialReadSettledMs: marks.credentialReadSettled,
        credentialResolvedMs: marks.credentialResolved,
        invokeStartedMs: marks.invokeStarted,
        requestConstructedMs: marks.requestConstructed,
        fetchStartedMs: marks.fetchStarted,
        headersReceivedMs: marks.headersReceived,
        responseBodyStartedMs: marks.responseBodyStarted,
        responseBodyCompletedMs: marks.responseBodyCompleted,
        invokeSettledMs: marks.invokeSettled,
        abortSignalledMs: marks.abortSignalled,
        credentialEntryMs: difference(marks.credentialResolved, marks.bindStarted),
        networkElapsedMs: difference(marks.responseBodyCompleted, marks.fetchStarted),
        totalElapsedMs: marks.invokeSettled ?? clock.nowMs() - origin,
        timeoutPhase: state.phase,
        transportErrorCode: state.error,
        credentialOutcome: state.credential,
        credentialReadAttempts: state.readAttempts,
        credentialResolutions: state.resolutions,
      });
    },
  };
}
