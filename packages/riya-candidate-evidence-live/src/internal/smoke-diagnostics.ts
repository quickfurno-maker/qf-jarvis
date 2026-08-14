/**
 * Content-free smoke EXECUTION diagnostics for the candidate operator (MVP-P2A.2 HF4-R2).
 *
 * ### The line that made this necessary
 *
 * RUN S3 was authorized as exactly one live operator process. It printed:
 *
 *     phase=smoke status=FAILED reason=smoke-timeout requests=1
 *
 * and stopped. That single line consumed the authorization and cannot distinguish a timeout during
 * credential resolution from one awaiting headers, awaiting a body, or settling the invocation — which
 * are four completely different diagnoses with four different fixes. The one-shot authorization is
 * spent, so the phase S3 actually reached is **unrecoverable**; nothing here reconstructs it.
 *
 * ### The telemetry already existed
 *
 * `runGroqStagingSmokeOnce` has recorded all of this from the beginning: milestone timestamps, a frozen
 * `timeoutPhase`, a normalized `transportErrorCode`, the credential-ingress branch and its counts. The
 * smoke harness even has its own sanitized formatter, which is the proof these fields were designed for
 * terminal output. The candidate operator simply threw `smoke.diagnostics` away and printed the
 * collapsed reason. That discard is the whole defect, and it is why the timer is NOT touched here:
 * moving a budget before measuring where it was spent would destroy the evidence.
 *
 * ### Why every field is safe to print
 *
 * Numbers and closed enums, nothing else. `timeoutPhase`, `transportErrorCode` and `credentialOutcome`
 * are fixed vocabularies; the rest are millisecond deltas and small counts. There is no field here that
 * can hold a credential, a URL, a header, a request or response body, a prompt, model output, an error
 * message, a stack or a cause — the smoke package took care to make that structurally true, and this
 * emitter names each property explicitly rather than spreading the object, so a field added upstream
 * cannot start printing here without someone deciding it should.
 */
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';

import type { SafeConsole, SafeValue } from '../safe-console.js';

/**
 * The diagnostics shape, derived from the already-exported result type.
 *
 * Indexed access rather than a direct `SmokeDiagnostics` import: the smoke package does not export that
 * interface from its root today, and widening a package surface for one internal consumer would be a
 * worse trade than deriving it.
 */
type SmokeDiagnosticsView = SmokeRunResult['diagnostics'];

/**
 * How an absent millisecond is printed.
 *
 * Absence is a FINDING, not a gap to be zero-filled: `headersReceivedMs` missing while `fetchStartedMs`
 * is present is precisely how "the request went out and nothing came back" is read off the line. A `0`
 * would claim the milestone happened instantly.
 */
const ABSENT = 'ABSENT';

function ms(value: number | undefined): SafeValue {
  return value ?? ABSENT;
}

/**
 * Emit the sanitized smoke execution diagnostics.
 *
 * Called for BOTH outcomes. On failure it says where the budget went; on success it records the healthy
 * reference timing, which is the only way a later run can show whether a 30-second budget is mostly
 * credential entry or mostly network.
 *
 * The authoritative `phase=smoke status=…` line is emitted by the caller AFTERWARDS and is unchanged.
 */
export function emitSmokeExecutionDiagnostics(safe: SafeConsole, smoke: SmokeRunResult): void {
  const diagnostics: SmokeDiagnosticsView = smoke.diagnostics;
  safe.line({
    phase: 'smoke-execution',
    status: 'DIAGNOSTIC',
    // The three closed classifications. `timeoutPhase` is frozen AT abort by the recorder, which is
    // what makes it meaningful — by settlement time every timeout looks alike.
    timeoutPhase: diagnostics.timeoutPhase,
    transportErrorCode: diagnostics.transportErrorCode,
    credentialOutcome: diagnostics.credentialOutcome,
    credentialReadAttempts: diagnostics.credentialReadAttempts,
    credentialResolutions: diagnostics.credentialResolutions,
    // The two derived spans the harness will only report when BOTH ends are proven. Never estimated.
    credentialEntryMs: ms(diagnostics.credentialEntryMs),
    networkElapsedMs: ms(diagnostics.networkElapsedMs),
    totalElapsedMs: diagnostics.totalElapsedMs,
    // The milestones, in the order they would occur. Which of these is ABSENT is the actual diagnosis:
    // no `fetchStartedMs` means the request never left; `fetchStartedMs` without `headersReceivedMs`
    // means it left and nothing came back; headers without a completed body means a stalled stream.
    timerArmedMs: ms(diagnostics.timerArmedMs),
    bindStartedMs: ms(diagnostics.bindStartedMs),
    credentialReadSettledMs: ms(diagnostics.credentialReadSettledMs),
    credentialResolvedMs: ms(diagnostics.credentialResolvedMs),
    requestConstructedMs: ms(diagnostics.requestConstructedMs),
    invokeStartedMs: ms(diagnostics.invokeStartedMs),
    fetchStartedMs: ms(diagnostics.fetchStartedMs),
    headersReceivedMs: ms(diagnostics.headersReceivedMs),
    responseBodyStartedMs: ms(diagnostics.responseBodyStartedMs),
    responseBodyCompletedMs: ms(diagnostics.responseBodyCompletedMs),
    invokeSettledMs: ms(diagnostics.invokeSettledMs),
    abortSignalledMs: ms(diagnostics.abortSignalledMs),
  });
}
