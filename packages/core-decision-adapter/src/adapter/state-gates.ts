/**
 * The double state gate (QFJ-M3, ADR-0056 §I).
 *
 * The same content-free check is applied BEFORE transport and AFTER the response: a revision change,
 * a party/assignment change, a human takeover, an AI pause, a cancellation, or a non-clear subject
 * status blocks acceptance. Any block yields a safe `STALE_REVISION` and prevents `ACCEPTED`.
 */
import type { CoreDecisionRequest } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionState } from '../contracts/state.js';

/** True iff the current state blocks acceptance for this request (fail closed). */
export function isStateBlocked(state: CoreDecisionState, request: CoreDecisionRequest): boolean {
  return (
    state.revision !== request.expectedRevision ||
    state.partyType !== request.partyType ||
    state.humanTakeover ||
    state.aiPaused ||
    state.cancelled ||
    state.subjectStatus !== 'clear'
  );
}
