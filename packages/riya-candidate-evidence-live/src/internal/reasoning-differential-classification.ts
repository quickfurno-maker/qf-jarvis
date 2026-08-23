/**
 * The reading of ONE `reasoning_effort='low'` differential probe (POST-RSP20B2).
 *
 * ### Why this vocabulary splits a token every earlier classifier collapsed
 *
 * Every classifier before this one files an HTTP 400 as `PROVIDER_REJECTED` — one token for the whole
 * `CONTRACT_REJECTION` role. That was right for those runs: each was asking whether the provider would
 * ACCEPT a request, so a 400 was the answer regardless of which code came with it.
 *
 * This run asks something else, and the collapse would now mislead. `json_validate_failed` is not the
 * provider refusing a request — the request was accepted, generation ran, and the provider is
 * reporting that its own OUTPUT failed strict validation. Calling that "request rejected" would point
 * the next reader at the request contract when the request contract was never in question, and it
 * would hide the one signal this run exists to produce: whether narrowing reasoning effort leaves
 * enough completion budget for the structured answer to complete.
 *
 * So the `CONTRACT_REJECTION` role splits on the literal provider code:
 *
 * - `json_validate_failed` -> `PROVIDER_OUTPUT_INVALID`
 * - anything else -> `PROVIDER_REQUEST_REJECTED`
 *
 * Historical classifiers are NOT changed. RA1's, NRA1's and MD120B3's receipts say `PROVIDER_REJECTED`
 * and must keep saying it — an immutable receipt whose vocabulary was retro-edited would no longer
 * describe the run that produced it.
 *
 * ### The HTTP reading is not re-implemented
 *
 * Every branch switches on {@link PROVIDER_OUTCOME_ROLE}, the same total, reviewed role map the
 * model, representative and endpoint classifiers use. The split above happens INSIDE the
 * contract-rejection branch, so the allowlist that keeps 401/403/404 out of "rejection" applies here
 * for free and cannot drift.
 *
 * ### Local validation is the FULL production projector
 *
 * `LOCAL_VALIDATION_FAILED` exists here for the reason it exists on the endpoint differential: a 2xx
 * whose document production would refuse is a WORSE outcome than a 400, because it looks like
 * success. The authority is the profile's `projectStructuredResult` — grounded citations, the
 * canonical observation batch, availability refs, the deterministic reducer, the prospective state
 * and the next-question plan — not a wire-shape `safeParse`, which is only its first stage.
 *
 * Accepting a document on shape alone would report that low reasoning effort repairs the path when
 * production would refuse the very answer it returned. That is the single worst thing this diagnostic
 * could produce.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions ONE reasoning-effort differential probe can support. */
export const REASONING_DIFFERENTIAL_CLASSIFICATIONS = [
  /**
   * HTTP 2xx, the provider completed, AND the FULL production projector accepted the document.
   *
   * At `reasoning_effort='low'`, on the production model, over the production endpoint, at the
   * production budget, the neutral request that failed strict validation at the documented default
   * produced an answer production Riya would carry as a draft.
   *
   * That is a one-variable finding and nothing more: not a release decision, not a production
   * parameter change, not a quality verdict, not safety, and not evidence about any other request.
   * `RIYA_PRODUCTION_REASONING_EFFORT_CHANGE_AUTHORIZED` remains a separate owner decision.
   */
  'REASONING_LOW_20B_STRICT_ACCEPTED',
  /**
   * A governed strict-output failure — the provider's own `json_validate_failed`.
   *
   * Deliberately NOT called a request rejection. The request was accepted and generation ran; what
   * failed is the provider's OUTPUT against the strict schema. If this comes back, narrowing
   * reasoning effort did not free enough completion budget for the structured answer, and the next
   * decision is an offline output-contract strategy rather than another effort value.
   */
  'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
  /**
   * 400, 413 or 422 carrying any OTHER code — the provider judged the REQUEST and refused it.
   *
   * A separate token because it would mean something entirely different: that adding
   * `reasoning_effort` changed how the provider reads the request itself. That would invalidate the
   * differential rather than answer it, and it must never be filed as an output failure.
   */
  'REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'REASONING_LOW_20B_STRICT_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'REASONING_LOW_20B_STRICT_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, a 2xx that produced no readable document, or a probe that
   * never ran.
   *
   * A credential or permission answer says nothing about a request contract, and a 2xx with nothing
   * behind it is a request that produced no result rather than a result that failed.
   */
  'REASONING_LOW_20B_STRICT_INCONCLUSIVE',
  /**
   * HTTP 2xx and a decoded document, which the FULL production projector then rejected.
   *
   * The provider accepted the request and returned something that is not an answer production Riya
   * would carry — whether it failed at the wire shape or at any later production invariant, which
   * this token deliberately does not distinguish because both mean the same thing for the effort
   * question. Distinct from the two provider tokens because nobody rejected anything at the provider,
   * and distinct from `ACCEPTED` because no usable result was produced.
   */
  'REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED',
] as const;
export type ReasoningDifferentialClassification =
  (typeof REASONING_DIFFERENTIAL_CLASSIFICATIONS)[number];

/**
 * What the ONE probe did, at the provider boundary AND at the local validator. Content-free.
 *
 * `localValidationCompleted` and `localValidationPassed` are two booleans rather than one tri-state
 * because they answer two different questions: whether the validator ever ran (it cannot, if nothing
 * came back), and what it said.
 */
export interface ReasoningDifferentialOutcome {
  readonly stepId: 'R0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW';
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
  /** Whether the full production projector was reached at all. False unless a document came back. */
  readonly localValidationCompleted: boolean;
  /** What it said. Meaningless — and always false — unless `localValidationCompleted`. */
  readonly localValidationPassed: boolean;
}

/** The reading: one token, with the literal observed fields preserved beside it. */
export interface ReasoningDifferentialAnalysis {
  readonly classification: ReasoningDifferentialClassification;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly localValidationCompleted: boolean;
  readonly localValidationPassed: boolean;
}

/**
 * Read the one probe.
 *
 * The switch is exhaustive over the role map, which is total by type — so a transport class added to
 * the observation vocabulary cannot reach a verdict here by falling through. There is no default
 * branch on purpose.
 *
 * The acceptance branch is the only one that consults the local validator, and it requires the
 * validator to have PASSED. A 2xx alone never reaches `ACCEPTED`.
 */
export function analyseReasoningDifferential(
  outcome: ReasoningDifferentialOutcome | undefined,
): ReasoningDifferentialAnalysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'REASONING_LOW_20B_STRICT_INCONCLUSIVE' as const,
      providerHttpStatus: 0,
      providerHttpClass: 'NOT_REACHED' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
      localValidationCompleted: false,
      localValidationPassed: false,
    });
  }

  const observed = {
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    localValidationCompleted: outcome.localValidationCompleted,
    localValidationPassed: outcome.localValidationPassed,
  };
  const result = (
    classification: ReasoningDifferentialClassification,
  ): ReasoningDifferentialAnalysis => Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    // The provider took the request. Whether low effort ANSWERED the question is now the FULL
    // production projector's call, and neither a 2xx nor a wire-shaped document speaks for it.
    return outcome.localValidationCompleted && outcome.localValidationPassed
      ? result('REASONING_LOW_20B_STRICT_ACCEPTED')
      : result('REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION': {
      // 400 / 413 / 422 only, and only with a real response behind them.
      if (!outcome.providerTransportStarted || outcome.providerHttpStatus < 100) {
        return result('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
      }
      // THE SPLIT. `json_validate_failed` means the provider's OUTPUT failed strict validation, not
      // that it refused the request — and this run's whole question is about the output.
      return outcome.providerErrorCode === 'JSON_VALIDATE_FAILED'
        ? result('REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID')
        : result('REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED');
    }
    case 'RATE_LIMITED':
      return result('REASONING_LOW_20B_STRICT_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('REASONING_LOW_20B_STRICT_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Credential, permission, configuration, ungoverned. Never an effort verdict.
      return result('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
    case 'ACCEPTED': {
      // A 2xx whose provider did not complete — the payload carried no readable structured document.
      //
      // Deliberately NOT `LOCAL_VALIDATION_FAILED`: nothing reached the local validator, so saying it
      // failed would be a claim about a check that never ran.
      return result('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
    }
  }
}
