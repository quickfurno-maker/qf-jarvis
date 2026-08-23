/**
 * The reading of ONE low-reasoning 8,192 output-budget differential probe (POST-RLD1).
 *
 * ### A separate vocabulary, because the QUESTION differs
 *
 * `REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID` said the provider's output failed strict
 * validation at a 4,096 budget. `REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID` says it failed
 * at 8,192, under the same effort. Reporting the second in the first's words would lose the only
 * thing this run measures — and RLD1's receipt is immutable evidence that already uses those tokens.
 *
 * RLD1's vocabulary is NOT modified. Nothing here renames, extends or reinterprets it.
 *
 * ### The split RLD1 introduced is kept, for the same reason
 *
 * `json_validate_failed` is not a request rejection: the request was accepted, generation ran, and
 * the provider is reporting that its OWN OUTPUT failed strict validation. That is precisely the
 * signal this run exists to re-take at a larger budget, so it keeps its own token.
 *
 * A 400/413/422 carrying any OTHER code stays separate and means something else entirely: that
 * changing the budget changed how the provider reads the REQUEST. A 413 is the case worth naming —
 * S11 met one at 65,536 and OAD2 at 14,848 — and at 8,192 it would say the request itself became
 * unacceptable, which would invalidate the differential rather than answer it.
 *
 * ### The HTTP reading is not re-implemented
 *
 * Every branch switches on {@link PROVIDER_OUTCOME_ROLE}, the same total, reviewed role map every
 * classifier beside this one uses. The code split happens INSIDE the contract-rejection branch, so
 * the allowlist that keeps 401/403/404 out of "rejection" applies here for free and cannot drift.
 *
 * ### Local validation is the FULL production projector
 *
 * `LOCAL_VALIDATION_FAILED` exists for the reason it exists on every gate since the endpoint
 * differential: a 2xx whose document production would refuse is a WORSE outcome than a 400, because
 * it looks like success. Accepting a document on shape alone would report that a bigger budget
 * repairs the path when production would refuse the very answer it returned — and on THIS run that
 * error would be especially expensive, because it is the run an owner would read as license to move
 * the production budget.
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
export const REASONING_BUDGET_8192_CLASSIFICATIONS = [
  /**
   * HTTP 2xx, the provider completed, AND the FULL production projector accepted the document.
   *
   * At `reasoning_effort='low'` and `max_completion_tokens=8192`, on the production model over the
   * production endpoint, the neutral request that failed strict validation at 4,096 produced an
   * answer production Riya would carry as a draft.
   *
   * What that proves is bounded: raising the budget while holding every other governed field changed
   * the outcome. It does NOT prove 4,096 was the exact cliff, that 8,192 is required for other
   * turns, or that production should move — `RIYA_PRODUCTION_OUTPUT_BUDGET_CHANGE_AUTHORIZED` stays
   * a separate owner decision, and RLD1's failed-probe usage was never observed.
   */
  'REASONING_LOW_8192_STRICT_ACCEPTED',
  /**
   * The provider's own `json_validate_failed`, again — now at double the budget.
   *
   * The request was accepted and generation ran; the OUTPUT failed strict validation. If this comes
   * back, doubling the budget did not repair the exact neutral path under low reasoning, and the
   * next step is owner interpretation rather than 16,384. Escalating a budget because the last
   * budget failed is how a run series stops testing a hypothesis and starts chasing one.
   */
  'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID',
  /**
   * 400, 413 or 422 carrying any OTHER code — the provider judged the REQUEST and refused it.
   *
   * Separate because it would mean the budget change altered how the provider reads the request
   * itself. A 413 here is the concrete worry: it would say 8,192 made the request unacceptable, which
   * invalidates the differential rather than answering it.
   */
  'REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'REASONING_LOW_8192_STRICT_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'REASONING_LOW_8192_STRICT_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, a 2xx that produced no readable document, or a probe that
   * never ran.
   */
  'REASONING_LOW_8192_STRICT_INCONCLUSIVE',
  /**
   * HTTP 2xx and a decoded document, which the FULL production projector then rejected.
   *
   * The budget was large enough for the provider to finish, and what it finished is not an answer
   * production Riya would carry. Distinct from the two provider tokens because nobody rejected
   * anything at the provider, and distinct from `ACCEPTED` because no usable result was produced.
   */
  'REASONING_LOW_8192_STRICT_LOCAL_VALIDATION_FAILED',
] as const;
export type ReasoningBudget8192Classification =
  (typeof REASONING_BUDGET_8192_CLASSIFICATIONS)[number];

/**
 * What the ONE probe did, at the provider boundary AND at the local validator. Content-free.
 *
 * `localValidationCompleted` and `localValidationPassed` are two booleans rather than one tri-state
 * because they answer two different questions: whether the validator ever ran (it cannot, if nothing
 * came back), and what it said.
 */
export interface ReasoningBudget8192Outcome {
  readonly stepId: 'B0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192';
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
export interface ReasoningBudget8192Analysis {
  readonly classification: ReasoningBudget8192Classification;
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
export function analyseReasoningBudget8192(
  outcome: ReasoningBudget8192Outcome | undefined,
): ReasoningBudget8192Analysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'REASONING_LOW_8192_STRICT_INCONCLUSIVE' as const,
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
  const result = (classification: ReasoningBudget8192Classification): ReasoningBudget8192Analysis =>
    Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    // The provider took the request AND finished. Whether the larger budget ANSWERED the question is
    // now the FULL production projector's call, and neither a 2xx nor a wire-shaped document speaks
    // for it.
    return outcome.localValidationCompleted && outcome.localValidationPassed
      ? result('REASONING_LOW_8192_STRICT_ACCEPTED')
      : result('REASONING_LOW_8192_STRICT_LOCAL_VALIDATION_FAILED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION': {
      // 400 / 413 / 422 only, and only with a real response behind them.
      if (!outcome.providerTransportStarted || outcome.providerHttpStatus < 100) {
        return result('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
      }
      // THE SPLIT, kept from RLD1. `json_validate_failed` means the provider's OUTPUT failed strict
      // validation, not that it refused the request — and this run's question is about the output.
      return outcome.providerErrorCode === 'JSON_VALIDATE_FAILED'
        ? result('REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID')
        : result('REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED');
    }
    case 'RATE_LIMITED':
      return result('REASONING_LOW_8192_STRICT_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('REASONING_LOW_8192_STRICT_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Credential, permission, configuration, ungoverned. Never a budget verdict.
      return result('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
    case 'ACCEPTED': {
      // A 2xx whose provider did not complete — the payload carried no readable structured document.
      //
      // Deliberately NOT `LOCAL_VALIDATION_FAILED`: nothing reached the local validator, so saying it
      // failed would be a claim about a check that never ran.
      return result('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
    }
  }
}
