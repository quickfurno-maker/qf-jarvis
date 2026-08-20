/**
 * The reading of ONE representative acceptance probe (POST-OAD3).
 *
 * ### Why this vocabulary is separate, and tiny
 *
 * OAD3's classifier answers a question about a MATRIX: which of four probes did the provider take,
 * and what does the pattern support. This run has one probe and one question — was the representative
 * production request accepted — so a matrix vocabulary would be five-sixths dead weight and would
 * invite a reader to look for a comparison that does not exist.
 *
 * Five outcomes, and the split between them is the lesson OAD3 taught: **a rate limit is not a
 * verdict.** OAD3's `O3` came back HTTP 429 and the harness of the day filed it beside HTTP 400,
 * emitting a token that named the message shape. It could not have known that; a 429 means the
 * provider declined to process. Here that case has its own token, so it can never again be read as
 * the provider judging the request.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions ONE representative probe can support. */
export const REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS = [
  /**
   * HTTP 2xx and the provider completed.
   *
   * The representative operational request contract was accepted ONCE, at the governed budget, with
   * the current repaired strict schema and the captured production messages. That is sufficient to
   * move to bounded safety replication and is NOT a quality verdict, safety eligibility, P10
   * eligibility, release readiness, concurrency evidence or WhatsApp E2E evidence.
   */
  'REPRESENTATIVE_ACCEPTED',
  /**
   * The provider judged the request and refused it on CONTRACT grounds: 400, 413 or 422.
   *
   * The literal provider error type and code travel with this outcome and are NOT interpreted. A 400
   * is a refusal; which part of the request it refers to is not established by this run.
   *
   * A 401, 403 or 404 is deliberately NOT this. Those say the caller was not authorised, not
   * permitted, or pointed somewhere that does not exist — real problems, but not evidence about the
   * request shape, and a mistyped candidate credential must never land here.
   */
  'REPRESENTATIVE_PROVIDER_REJECTED',
  /**
   * HTTP 429. The provider declined to PROCESS because a rate limit was reached.
   *
   * Its own token precisely so it cannot be mistaken for a verdict. This is what OAD3 actually hit,
   * and reading it as contract evidence is the error this vocabulary exists to prevent. It says
   * nothing about the schema, nothing about the messages, and nothing about the budget.
   */
  'REPRESENTATIVE_RATE_LIMITED',
  /**
   * The request failed to EXECUTE: transport failure, timeout with no provider response, capacity,
   * cancellation, or provider unavailability.
   *
   * No provider verdict exists, so there is no contract evidence either way.
   */
  'REPRESENTATIVE_INFRA_INTERRUPTED',
  /**
   * The probe did not run, or the outcome is a credential, permission, configuration or ungoverned
   * HTTP class.
   *
   * Separated from `..._INFRA_INTERRUPTED` because the operator action differs: an execution failure
   * says try again, whereas a 401 or a 404 says fix something before trying again.
   */
  'REPRESENTATIVE_INCONCLUSIVE',
] as const;
export type RepresentativeAcceptanceClassification =
  (typeof REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS)[number];

/** What the ONE probe did at the provider boundary. Content-free by construction. */
export interface RepresentativeAcceptanceOutcome {
  /**
   * Which probe this was.
   *
   * POST-RA1 this admits the neutral step too. The CLASSIFIER is deliberately shared — the reading of
   * a 400, a 429 or a 401 does not depend on which client turn was sent — while the step id keeps the
   * two runs distinguishable on the row itself.
   */
  readonly stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL' | 'N0_EXACT_NEUTRAL_CLIENT_OPERATIONAL';
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
}

/** The reading: one token, plus the literal provider codes preserved uninterpreted. */
export interface RepresentativeAcceptanceAnalysis {
  readonly classification: RepresentativeAcceptanceClassification;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
}

/**
 * Read the one probe.
 *
 * Order matters and is deliberate: acceptance first, then the rate limit BEFORE the general rejection
 * test, so a 429 can never fall through into a contract verdict.
 */
export function analyseRepresentativeAcceptance(
  outcome: RepresentativeAcceptanceOutcome | undefined,
): RepresentativeAcceptanceAnalysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'REPRESENTATIVE_INCONCLUSIVE' as const,
      providerHttpStatus: 0,
      providerHttpClass: 'NOT_REACHED' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
    });
  }

  const observed = {
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
  };
  const result = (
    classification: RepresentativeAcceptanceClassification,
  ): RepresentativeAcceptanceAnalysis => Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    return result('REPRESENTATIVE_ACCEPTED');
  }

  // Read the reviewed ROLE rather than testing statuses here, so this function cannot drift from the
  // allowlist the matrix classifier uses. The role map is total, so there is no unhandled class.
  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION':
      // 400 / 413 / 422 only. Requires a real response, exactly as the shared predicate demands.
      return outcome.providerTransportStarted && outcome.providerHttpStatus >= 100
        ? result('REPRESENTATIVE_PROVIDER_REJECTED')
        : result('REPRESENTATIVE_INCONCLUSIVE');
    case 'RATE_LIMITED':
      return result('REPRESENTATIVE_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('REPRESENTATIVE_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Credential, permission, configuration, ungoverned. Never a contract verdict.
      return result('REPRESENTATIVE_INCONCLUSIVE');
    case 'ACCEPTED':
      // A 2xx whose provider did not complete. Not acceptance, and not evidence of a refusal either.
      return result('REPRESENTATIVE_INCONCLUSIVE');
  }
}
