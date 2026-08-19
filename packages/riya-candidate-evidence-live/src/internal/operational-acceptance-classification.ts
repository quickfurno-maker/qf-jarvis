/**
 * The reading of an O0-O3 operational acceptance matrix.
 *
 * ### The strongest success wins the headline
 *
 * O3 is the closest thing to a real Riya turn this harness can send: the exact repaired schema, the
 * governed operational budget, and the captured representative production messages. If the provider
 * takes it, that is the finding, and a surprising rejection further down cannot overturn it — those
 * stay visible in `rejectedStepIds` as facts about the fragments, not about the whole.
 *
 * ### Below that, the pair does the work
 *
 * O2 and O3 are byte-identical in schema and differ only in messages, so `O3 rejected, O2 accepted`
 * says the MESSAGE SHAPE is implicated and nothing else could be. `O2 rejected, O1 accepted` says the
 * full document is, while its evolution group is not. `O1 rejected` says SRV1's group failure
 * survives the budget change.
 *
 * Each of those is a different claim, and none of them names a cause beyond what the pair supports.
 *
 * ### Control and completeness come first
 *
 * A rejected control means the operational envelope itself was refused, so nothing after it is
 * attributable to the schema or the messages. An incomplete matrix supports no conclusion about the
 * probes that did settle.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import type { OperationalAcceptanceStepId } from './operational-acceptance-plan.js';
import { OPERATIONAL_ACCEPTANCE_STEP_IDS } from './operational-acceptance-plan.js';

/** The closed conclusions an operational acceptance matrix can support. */
export const OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS = [
  /** The control was refused at the operational budget, so nothing else is interpretable. */
  'OPERATIONAL_CONTROL_INVALID',
  /**
   * The exact repaired schema WITH representative production messages was accepted at the governed
   * operational budget.
   *
   * The strongest result this harness can produce, and still narrow: it says the request contract is
   * healthy enough to proceed. It is not safety eligibility, model quality, P10 eligibility or
   * release readiness, and it evaluates nothing.
   */
  'OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
  /**
   * O3 rejected while O2 was accepted.
   *
   * Same schema bytes, same budget, same everything except the messages — so the representative
   * message shape is implicated. WHY is deliberately not guessed.
   */
  'OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED',
  /**
   * O3 and O2 rejected while O1 was accepted.
   *
   * The evolution group survives the operational budget but the full document does not. Which
   * top-level interaction causes it is deliberately not guessed.
   */
  'OPERATIONAL_FULL_SCHEMA_REJECTED',
  /**
   * O3, O2 and O1 all rejected.
   *
   * SRV1's evolution-group failure persists at the operational budget, so the budget is not what was
   * behind it. The provider error code on each row is what carries the detail.
   */
  'OPERATIONAL_EVOLUTION_GROUP_REJECTED',
  /** The matrix did not run completely, or transport failures prevent a clean reading. */
  'MIXED_OR_INCONCLUSIVE',
] as const;
export type OperationalAcceptanceClassification =
  (typeof OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS)[number];

/** What ONE probe did at the provider boundary. Content-free by construction. */
export interface OperationalAcceptanceOutcome {
  readonly stepId: OperationalAcceptanceStepId;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  /**
   * The provider's own closed error code.
   *
   * SRV1's V3/V4 carried `JSON_VALIDATE_FAILED`, which the observer maps only from the literal Groq
   * envelope code and never infers from an HTTP status. It is preserved through this analysis
   * unchanged, because "400 with json_validate_failed" and "400 with something else" are different
   * findings and a reader must be able to tell them apart without any provider content being printed.
   */
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
}

/** The full reading: a summary token, every step id bucketed, and the error codes that were seen. */
export interface OperationalAcceptanceAnalysis {
  readonly classification: OperationalAcceptanceClassification;
  readonly acceptedStepIds: readonly OperationalAcceptanceStepId[];
  readonly rejectedStepIds: readonly OperationalAcceptanceStepId[];
  readonly inconclusiveStepIds: readonly OperationalAcceptanceStepId[];
  /**
   * The closed provider error code for each rejected step, in step order.
   *
   * Reported because `JSON_VALIDATE_FAILED` versus `OTHER_OR_ABSENT` is the difference between "the
   * provider validated the schema and refused the shape" and "something else went wrong", and losing
   * that distinction would cost the next authorization.
   */
  readonly rejectedErrorCodes: readonly {
    readonly stepId: OperationalAcceptanceStepId;
    readonly providerErrorCode: CandidateProviderErrorCode;
  }[];
}

/** Accepted means the provider TOOK the request. Local semantics are not consulted. */
function accepted(one: OperationalAcceptanceOutcome): boolean {
  return one.providerCompleted && one.providerHttpClass === 'SUCCESS_2XX';
}

/** Refused BY the provider, as distinct from never having settled. */
function rejected(one: OperationalAcceptanceOutcome): boolean {
  return (
    !accepted(one) &&
    one.providerTransportStarted &&
    one.providerHttpStatus >= 100 &&
    one.providerHttpClass !== 'TRANSPORT_THROW' &&
    one.providerHttpClass !== 'NOT_REACHED' &&
    one.providerHttpClass !== 'NONE'
  );
}

/** Read an operational acceptance matrix. Every declared step lands in exactly one bucket. */
export function analyseOperationalAcceptance(
  outcomes: readonly OperationalAcceptanceOutcome[],
): OperationalAcceptanceAnalysis {
  const byId = new Map<OperationalAcceptanceStepId, OperationalAcceptanceOutcome>();
  for (const one of outcomes) {
    byId.set(one.stepId, one);
  }

  const acceptedIds: OperationalAcceptanceStepId[] = [];
  const rejectedIds: OperationalAcceptanceStepId[] = [];
  const inconclusiveIds: OperationalAcceptanceStepId[] = [];
  const rejectedErrorCodes: {
    readonly stepId: OperationalAcceptanceStepId;
    readonly providerErrorCode: CandidateProviderErrorCode;
  }[] = [];

  for (const stepId of OPERATIONAL_ACCEPTANCE_STEP_IDS) {
    const one = byId.get(stepId);
    if (one === undefined) {
      inconclusiveIds.push(stepId);
    } else if (accepted(one)) {
      acceptedIds.push(stepId);
    } else if (rejected(one)) {
      rejectedIds.push(stepId);
      rejectedErrorCodes.push(
        Object.freeze({ stepId, providerErrorCode: one.providerErrorCode }),
      );
    } else {
      inconclusiveIds.push(stepId);
    }
  }

  const result = (
    classification: OperationalAcceptanceClassification,
  ): OperationalAcceptanceAnalysis =>
    Object.freeze({
      classification,
      acceptedStepIds: Object.freeze([...acceptedIds]),
      rejectedStepIds: Object.freeze([...rejectedIds]),
      inconclusiveStepIds: Object.freeze([...inconclusiveIds]),
      rejectedErrorCodes: Object.freeze([...rejectedErrorCodes]),
    });

  const control = byId.get('O0_MINIMAL_CONTROL_OPERATIONAL');
  if (control === undefined || !accepted(control)) {
    return result('OPERATIONAL_CONTROL_INVALID');
  }
  if (inconclusiveIds.length > 0) {
    return result('MIXED_OR_INCONCLUSIVE');
  }

  // The strongest success wins, whatever the wrappers did. A surprising O1 or O2 rejection stays in
  // the set as a fact about that fragment; it cannot overturn a representative request the provider
  // actually took.
  if (!rejectedIds.includes('O3_EXACT_REPRESENTATIVE_OPERATIONAL')) {
    return result('OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED');
  }
  // O3 was refused. O2 shares its schema bytes exactly, so the pair localises the axis.
  if (!rejectedIds.includes('O2_EXACT_SYNTHETIC_OPERATIONAL')) {
    return result('OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED');
  }
  if (!rejectedIds.includes('O1_EVOLUTION_GROUP_OPERATIONAL')) {
    return result('OPERATIONAL_FULL_SCHEMA_REJECTED');
  }
  return result('OPERATIONAL_EVOLUTION_GROUP_REJECTED');
}
