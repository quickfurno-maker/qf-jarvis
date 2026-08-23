/**
 * The reading of ONE best-effort `json_schema` (strict=false) differential probe (POST-RBD1).
 *
 * ### A separate vocabulary, because the QUESTION differs
 *
 * `REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID` said the provider's output failed strict
 * validation under constrained decoding. `REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID`
 * says it failed with constrained decoding OFF, on the same model, endpoint, schema, messages,
 * effort and budget. Reporting the second in the first's words would lose the only thing this run
 * measures — and RBD1's receipt is immutable evidence that already uses those tokens.
 *
 * RLD1's and RBD1's vocabularies are NOT modified. Nothing here renames, extends or reinterprets
 * either of them.
 *
 * ### `json_validate_failed` under strict=false is a REAL outcome, not a mislabelled rejection
 *
 * Groq documents that best-effort mode may still refuse a document that does not satisfy the schema.
 * So a 400 carrying `json_validate_failed` here means what it meant under strict: the request was
 * accepted, generation ran, and the provider is reporting that its OWN OUTPUT failed validation.
 * Filing it as a request rejection would point the next reader at a request contract that was never
 * in question, and would hide the one signal this run exists to produce.
 *
 * A 400/413/422 carrying any OTHER code stays separate and means the opposite: that changing the
 * strict flag changed how the provider reads the REQUEST, which would invalidate the differential
 * rather than answer it.
 *
 * ### The HTTP reading is not re-implemented
 *
 * Every branch switches on {@link PROVIDER_OUTCOME_ROLE}, the same total, reviewed role map every
 * classifier beside this one uses. The code split happens INSIDE the contract-rejection branch, so
 * the allowlist that keeps 401/403/404 out of "rejection" applies here for free.
 *
 * ### Local validation is the FULL production projector, and it matters most on THIS run
 *
 * Turning constrained decoding off is exactly the change most likely to produce a syntactically
 * plausible document that production would refuse. A wire-shaped answer accepted on shape alone would
 * report that best-effort mode repairs the path when production would reject the very document it
 * returned — and this is the run whose ACCEPTED an owner would read as evidence about the strict
 * posture itself. So a 2xx whose document the full projector refuses is `LOCAL_VALIDATION_FAILED`,
 * which is emphatically NOT a repair.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */

import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions ONE 8,192 budget differential probe can support. */
export const STRICT_FALSE_CLASSIFICATIONS = [
  /**
   * HTTP 2xx, the provider completed, AND the FULL production projector accepted the document.
   *
   * With constrained decoding OFF — same model, same endpoint, same schema, same neutral messages,
   * same `reasoning_effort='low'`, same 8,192 budget — the request that RBD1 met
   * `json_validate_failed` on produced an answer production Riya would carry as a draft.
   *
   * What that proves is bounded: turning `strict` off, while holding the governed request otherwise
   * fixed, changed this exact neutral path. It does NOT prove that Groq strict mode is globally
   * broken, that `strict: false` is generally better, that 8,192 is universally required, that
   * either failed probe was truncated, or that production should move —
   * `RIYA_PRODUCTION_STRICT_MODE_CHANGE_AUTHORIZED` stays a separate owner decision.
   */
  'REASONING_LOW_8192_BEST_EFFORT_ACCEPTED',
  /**
   * The provider's own `json_validate_failed`, now with constrained decoding OFF.
   *
   * This is a REAL experimental outcome, not a mislabelled rejection: Groq documents that best-effort
   * mode may still refuse a document that does not satisfy the schema. The request was accepted and
   * generation ran; the OUTPUT failed validation.
   *
   * If this comes back, switching to best-effort did not repair the exact neutral path under low
   * reasoning at 8,192, and the next step is owner interpretation — not 16,384. Escalating a budget
   * because the last one failed is how a run series stops testing a hypothesis and starts chasing one.
   */
  'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID',
  /**
   * 400, 413 or 422 carrying any OTHER code — the provider judged the REQUEST and refused it.
   *
   * Separate because it would mean the opposite thing: that changing the strict flag changed how the
   * provider reads the request itself, which invalidates the differential rather than answering it.
   */
  'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'REASONING_LOW_8192_BEST_EFFORT_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'REASONING_LOW_8192_BEST_EFFORT_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, a 2xx that produced no readable document, or a probe that
   * never ran.
   */
  'REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE',
  /**
   * HTTP 2xx and a decoded document, which the FULL production projector then rejected.
   *
   * The outcome this run is most exposed to, and emphatically NOT a repair. Turning constrained
   * decoding off is exactly the change most likely to yield a syntactically plausible document that
   * production refuses — grounded citations, the canonical observation batch, availability refs, the
   * reducer, the prospective state and the next-question plan all still have to hold.
   *
   * Distinct from the two provider tokens because nobody rejected anything at the provider, and
   * distinct from `ACCEPTED` because no production-usable result was produced.
   */
  'REASONING_LOW_8192_BEST_EFFORT_LOCAL_VALIDATION_FAILED',
] as const;
export type StrictFalseClassification = (typeof STRICT_FALSE_CLASSIFICATIONS)[number];

/**
 * What the ONE probe did, at the provider boundary AND at the local validator. Content-free.
 *
 * `localValidationCompleted` and `localValidationPassed` are two booleans rather than one tri-state
 * because they answer two different questions: whether the validator ever ran (it cannot, if nothing
 * came back), and what it said.
 */
export interface StrictFalseOutcome {
  readonly stepId: 'S0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192_STRICT_FALSE';
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
  readonly localValidationCompleted: boolean;
  readonly localValidationPassed: boolean;
}

/** The reading: one token, with the literal observed fields preserved beside it. */
export interface StrictFalseAnalysis {
  readonly classification: StrictFalseClassification;
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
export function analyseStrictFalseDifferential(
  outcome: StrictFalseOutcome | undefined,
): StrictFalseAnalysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE' as const,
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
  const result = (classification: StrictFalseClassification): StrictFalseAnalysis =>
    Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    // The provider took the request AND finished. Whether the larger budget ANSWERED the question is
    // now the FULL production projector's call, and neither a 2xx nor a wire-shaped document speaks
    // for it.
    return outcome.localValidationCompleted && outcome.localValidationPassed
      ? result('REASONING_LOW_8192_BEST_EFFORT_ACCEPTED')
      : result('REASONING_LOW_8192_BEST_EFFORT_LOCAL_VALIDATION_FAILED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION': {
      // 400 / 413 / 422 only, and only with a real response behind them.
      if (!outcome.providerTransportStarted || outcome.providerHttpStatus < 100) {
        return result('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
      }
      // THE SPLIT, kept from RLD1. `json_validate_failed` means the provider's OUTPUT failed strict
      // validation, not that it refused the request — and this run's question is about the output.
      return outcome.providerErrorCode === 'JSON_VALIDATE_FAILED'
        ? result('REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID')
        : result('REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED');
    }
    case 'RATE_LIMITED':
      return result('REASONING_LOW_8192_BEST_EFFORT_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('REASONING_LOW_8192_BEST_EFFORT_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Credential, permission, configuration, ungoverned. Never a budget verdict.
      return result('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
    case 'ACCEPTED': {
      // A 2xx whose provider did not complete — the payload carried no readable structured document.
      //
      // Deliberately NOT `LOCAL_VALIDATION_FAILED`: nothing reached the local validator, so saying it
      // failed would be a claim about a check that never ran.
      return result('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
    }
  }
}
