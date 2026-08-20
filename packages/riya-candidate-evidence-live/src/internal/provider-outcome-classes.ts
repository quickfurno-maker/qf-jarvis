/**
 * What each observed transport class establishes about a REQUEST CONTRACT — and what it does not.
 *
 * ### Two defects, and the second is why this file is shaped like this
 *
 * OAD3's classifier counted every non-2xx row as rejection evidence. `O1` and `O3` returned HTTP 429
 * and the run emitted `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED` — a token naming
 * the message shape — on what was a rate limit. That was the first defect.
 *
 * The first repair fixed it the wrong way round: it listed the classes that were NOT evidence and
 * treated everything left over as a provider rejection. That leftover set silently included
 * `UNAUTHORIZED_401`, `FORBIDDEN_403`, `NOT_FOUND_404` and `OTHER_HTTP`. So a wrong second candidate
 * credential — smoke passes on the first entry, the candidate entry is mistyped — would have been
 * filed as evidence about Riya's schema. So would a model-route misconfiguration, and so would any
 * status class nobody has governed yet.
 *
 * A diagnostic that answers "is this request contract valid" must not accept "the caller was not
 * authorised" as an answer.
 *
 * ### So contract rejection is an ALLOWLIST, and the map is TOTAL
 *
 * {@link PROVIDER_OUTCOME_ROLE} assigns a role to EVERY member of the governed class vocabulary. It is
 * typed `Record<CandidateProviderHttpClass, ProviderOutcomeRole>`, so adding a class to that
 * vocabulary without deciding its role does not compile. There is no fallback branch, which means
 * "new class becomes rejection evidence" is not a thing that can happen by omission.
 *
 * Only three classes carry contract-rejection evidence today:
 *
 * - `BAD_REQUEST_400` — the provider validated the request and refused it;
 * - `PAYLOAD_TOO_LARGE_413` — the envelope was refused as too large, which is how OAD2 read its 413;
 * - `UNPROCESSABLE_422` — the provider reports the request as unprocessable.
 *
 * For all three the literal error type and code travel onward UNINTERPRETED. `400` says a refusal
 * happened; it does not say which part of the request caused it, and nothing here invents a cause.
 *
 * Everything else is NON-VERDICT: it does not establish anything about the request contract, in either
 * direction. That is a statement about evidence, not about severity — a 401 is a serious problem, just
 * not one this diagnostic is measuring.
 */
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import type { CandidateProviderHttpClass } from '../candidate-transport-observation.js';

/** What one observed class establishes. Finer than the three buckets, so both readers can share it. */
export const PROVIDER_OUTCOME_ROLES = [
  /** The provider took the request. */
  'ACCEPTED',
  /** The provider judged the request and refused it. Contract evidence. */
  'CONTRACT_REJECTION',
  /** The provider declined to PROCESS because a rate limit was reached. Not a verdict. */
  'RATE_LIMITED',
  /** The request failed to execute: transport, availability, cancellation. Not a verdict. */
  'EXECUTION_INTERRUPTED',
  /** Credential, permission, configuration, or a class nobody has governed. Not a verdict. */
  'NON_VERDICT_OTHER',
] as const;
export type ProviderOutcomeRole = (typeof PROVIDER_OUTCOME_ROLES)[number];

/**
 * The role of every governed transport class.
 *
 * TOTAL by type. A new `CandidateProviderHttpClass` fails to compile until somebody assigns it a role,
 * which is the point: the previous revision let a new class inherit "rejection" by falling through.
 */
export const PROVIDER_OUTCOME_ROLE: Readonly<
  Record<CandidateProviderHttpClass, ProviderOutcomeRole>
> = Object.freeze({
  SUCCESS_2XX: 'ACCEPTED',

  // The contract-rejection allowlist. Three classes, each reviewed.
  BAD_REQUEST_400: 'CONTRACT_REJECTION',
  PAYLOAD_TOO_LARGE_413: 'CONTRACT_REJECTION',
  UNPROCESSABLE_422: 'CONTRACT_REJECTION',

  RATE_LIMITED_429: 'RATE_LIMITED',

  // The request never executed. No provider verdict exists.
  CAPACITY_498: 'EXECUTION_INTERRUPTED',
  CANCELLED_499: 'EXECUTION_INTERRUPTED',
  SERVER_5XX: 'EXECUTION_INTERRUPTED',
  TRANSPORT_THROW: 'EXECUTION_INTERRUPTED',
  NOT_REACHED: 'EXECUTION_INTERRUPTED',

  // Credential, permission, configuration, or ungoverned. A wrong candidate credential lands on 401,
  // and it must never read as evidence about Riya's schema.
  UNAUTHORIZED_401: 'NON_VERDICT_OTHER',
  FORBIDDEN_403: 'NON_VERDICT_OTHER',
  NOT_FOUND_404: 'NON_VERDICT_OTHER',
  OTHER_HTTP: 'NON_VERDICT_OTHER',
  NONE: 'NON_VERDICT_OTHER',
});

/** The classes that carry contract-rejection evidence. Derived from the map, never restated. */
export const PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES: readonly CandidateProviderHttpClass[] =
  Object.freeze(
    CANDIDATE_PROVIDER_HTTP_CLASSES.filter(
      (one) => PROVIDER_OUTCOME_ROLE[one] === 'CONTRACT_REJECTION',
    ),
  );

/** The classes that establish NOTHING about the request contract. Derived, never restated. */
export const NON_VERDICT_HTTP_CLASSES: readonly CandidateProviderHttpClass[] = Object.freeze(
  CANDIDATE_PROVIDER_HTTP_CLASSES.filter((one) => {
    const role = PROVIDER_OUTCOME_ROLE[one];
    return role !== 'ACCEPTED' && role !== 'CONTRACT_REJECTION';
  }),
);

/** The provider TOOK the request. Local semantics are never consulted. */
export function isProviderAccepted(outcome: {
  readonly providerCompleted: boolean;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return (
    outcome.providerCompleted && PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass] === 'ACCEPTED'
  );
}

/**
 * The provider judged the request and refused it — CONTRACT evidence.
 *
 * Named for what it establishes rather than for what happened at the wire. A 401 is a provider
 * refusal too, and it is deliberately NOT this: it says the caller was not authorised, not that the
 * request was malformed.
 *
 * Requires a real response as well as an allowlisted class, so a class that somehow appears without
 * transport or without a status cannot become evidence.
 */
export function isProviderContractRejected(outcome: {
  readonly providerCompleted: boolean;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return (
    !isProviderAccepted(outcome) &&
    PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass] === 'CONTRACT_REJECTION' &&
    outcome.providerTransportStarted &&
    outcome.providerHttpStatus >= 100
  );
}

/**
 * The outcome establishes nothing about the request contract.
 *
 * The complement of the two above, computed rather than listed — so an outcome can never be neither,
 * and never both.
 */
export function isProviderOutcomeInconclusive(outcome: {
  readonly providerCompleted: boolean;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
}): boolean {
  return !isProviderAccepted(outcome) && !isProviderContractRejected(outcome);
}
