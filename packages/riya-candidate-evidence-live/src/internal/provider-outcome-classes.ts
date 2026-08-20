/**
 * Which observed transport classes are INFRASTRUCTURE, and which are the provider judging a request.
 *
 * ### The defect this exists to remove
 *
 * OAD3's classifier treated every non-2xx row as rejection evidence. That is fine for a matrix asking
 * "did the provider take this", and wrong for a matrix asking "is this request contract valid" — the
 * two questions differ exactly where the provider never got as far as judging the request.
 *
 * OAD3 hit that difference. `O0` and `O2` returned HTTP 200, while `O1` and `O3` returned **HTTP 429**
 * and the run emitted `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED` — a token whose
 * name points at the messages. But a 429 says the provider DECLINED TO PROCESS because a rate limit
 * was reached. It says nothing about the schema, and nothing about the messages. Reading it as
 * contract evidence would have retired a question that is still open, on a receipt that cannot
 * support it.
 *
 * So a rate limit, a transport throw, a timeout that never produced a provider response, and
 * provider-availability failures are all INCONCLUSIVE-INFRA. They are not acceptance and they are not
 * rejection; they are an absence of evidence.
 *
 * ### What stays a rejection
 *
 * A response where the provider actually judged the request — a 4xx that is not a rate limit, most
 * obviously a 400 — remains a rejection, and its literal error type and code travel with it
 * uninterpreted. `400 + JSON_VALIDATE_FAILED` and `400 + OTHER_OR_ABSENT` stay distinguishable, and
 * neither is given a cause here.
 *
 * The historical OAD3 receipt is NOT rewritten by any of this. It recorded what the harness emitted at
 * the time, and it keeps saying so. This module changes only what FUTURE analysis concludes.
 */
import type { CandidateProviderHttpClass } from '../candidate-transport-observation.js';

/**
 * Transport classes that mean "the provider never judged this request".
 *
 * `RATE_LIMITED_429` and `CAPACITY_498` are the provider declining to process. `SERVER_5XX` is the
 * provider failing to. `CANCELLED_499`, `TRANSPORT_THROW`, `NOT_REACHED` and `NONE` are cases where no
 * provider verdict exists at all.
 *
 * Listed explicitly rather than derived from a status range, so adding a class to the observation
 * vocabulary cannot silently join this set — a new class is a decision somebody makes on purpose.
 */
export const INFRASTRUCTURE_HTTP_CLASSES: readonly CandidateProviderHttpClass[] = Object.freeze([
  'RATE_LIMITED_429',
  'CAPACITY_498',
  'CANCELLED_499',
  'SERVER_5XX',
  'TRANSPORT_THROW',
  'NOT_REACHED',
  'NONE',
]);

/** The provider TOOK the request. Local semantics are never consulted. */
export function isProviderAccepted(outcome: {
  readonly providerCompleted: boolean;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return outcome.providerCompleted && outcome.providerHttpClass === 'SUCCESS_2XX';
}

/** The request never reached a provider verdict. Not acceptance, not rejection — absent evidence. */
export function isInfrastructureInterrupted(outcome: {
  readonly providerCompleted: boolean;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return (
    !isProviderAccepted(outcome) && INFRASTRUCTURE_HTTP_CLASSES.includes(outcome.providerHttpClass)
  );
}

/**
 * The provider judged the request and refused it.
 *
 * Requires a real response: transport started, a status was received, and the class is neither
 * success nor infrastructure. WHY it was refused is not decided here.
 */
export function isProviderRejected(outcome: {
  readonly providerCompleted: boolean;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return (
    !isProviderAccepted(outcome) &&
    !isInfrastructureInterrupted(outcome) &&
    outcome.providerTransportStarted &&
    outcome.providerHttpStatus >= 100
  );
}
