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
import { isProviderAccepted, isProviderRejected } from './provider-outcome-classes.js';

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
   * The provider judged the request and refused it.
   *
   * The literal provider error type and code travel with this outcome and are NOT interpreted. A 400
   * is a refusal; which part of the request it refers to is not established by this run.
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
   * A transport failure, a timeout with no provider response, or provider unavailability.
   *
   * No provider verdict exists, so there is no contract evidence either way.
   */
  'REPRESENTATIVE_INFRA_INTERRUPTED',
  /** The probe did not run, or its observation supports none of the above. */
  'REPRESENTATIVE_INCONCLUSIVE',
] as const;
export type RepresentativeAcceptanceClassification =
  (typeof REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS)[number];

/** What the ONE probe did at the provider boundary. Content-free by construction. */
export interface RepresentativeAcceptanceOutcome {
  readonly stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL';
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
  // BEFORE the rejection test. This ordering is the whole point of the vocabulary.
  if (outcome.providerHttpClass === 'RATE_LIMITED_429') {
    return result('REPRESENTATIVE_RATE_LIMITED');
  }
  if (isProviderRejected(outcome)) {
    return result('REPRESENTATIVE_PROVIDER_REJECTED');
  }
  if (
    outcome.providerHttpClass === 'TRANSPORT_THROW' ||
    outcome.providerHttpClass === 'SERVER_5XX' ||
    outcome.providerHttpClass === 'CAPACITY_498' ||
    outcome.providerHttpClass === 'CANCELLED_499' ||
    outcome.providerHttpClass === 'NOT_REACHED'
  ) {
    return result('REPRESENTATIVE_INFRA_INTERRUPTED');
  }
  return result('REPRESENTATIVE_INCONCLUSIVE');
}
