/**
 * The reading of a POST-SDH4 schema-repair verification matrix.
 *
 * ### A separate vocabulary, deliberately
 *
 * SDH4's `ISOLATED_SCHEMA_FEATURE_REJECTION` describes a matrix run against the PRE-repair schema.
 * Reusing that token for a run against the repaired schema would make two materially different
 * findings indistinguishable in a receipt, so the provenance is modelled in the type system: these
 * outcomes can only be produced from `V0`-`V4` probes, and the historical ones only from `R0`-`R8`.
 *
 * ### Same precedence discipline as the historical analysis
 *
 * The control decides whether anything is readable. The exact document decides the summary. Between
 * the repaired-feature and group probes there is no precedence at all — the result is a SET, and no
 * member of it is promoted to "the cause" by ordering.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import type { SchemaRepairVerificationStepId } from './riya-schema-repair-verification-plan.js';
import { SCHEMA_REPAIR_VERIFICATION_STEP_IDS } from './riya-schema-repair-verification-plan.js';

/** The closed conclusions a verification matrix can support. */
export const SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS = [
  /** The control did not pass, so nothing else is interpretable. Not a statement about the repair. */
  'CONTROL_INVALID',
  /**
   * The exact repaired projected schema was accepted at the low cap.
   *
   * It means ONLY that. It is not a statement about the operational Riya completion budget, the
   * production message shape, safety eligibility, model quality, P10 eligibility or release
   * readiness — and it does not by itself close the historical D5 investigation.
   */
  'REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP',
  /**
   * The exact document was rejected AND at least one repaired observation array was rejected on its
   * own. The rejected set is reported in full; no single member is named as the cause.
   */
  'REPAIRED_OBSERVATION_SCHEMA_REJECTED',
  /**
   * The exact document was rejected while every isolated repaired fragment was accepted.
   *
   * The remaining cause is a composition or a limit these probes do not isolate. Not guessed.
   */
  'REPAIRED_EVOLUTION_COMPOSITION_REJECTED',
  /** The matrix did not run completely, or transport failures prevent a clean reading. */
  'MIXED_OR_INCONCLUSIVE',
] as const;
export type SchemaRepairVerificationClassification =
  (typeof SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS)[number];

/** What ONE verification probe did at the provider boundary. Content-free by construction. */
export interface SchemaRepairProbeOutcome {
  readonly stepId: SchemaRepairVerificationStepId;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
}

/** The full reading: a summary token, and every step id in its own bucket. */
export interface SchemaRepairVerificationAnalysis {
  readonly classification: SchemaRepairVerificationClassification;
  readonly acceptedStepIds: readonly SchemaRepairVerificationStepId[];
  readonly rejectedStepIds: readonly SchemaRepairVerificationStepId[];
  readonly inconclusiveStepIds: readonly SchemaRepairVerificationStepId[];
}

/** Accepted means the provider TOOK the request. Local semantics are not consulted. */
function accepted(one: SchemaRepairProbeOutcome): boolean {
  return one.providerCompleted && one.providerHttpClass === 'SUCCESS_2XX';
}

/** Refused BY the provider, as distinct from never having settled. */
function rejected(one: SchemaRepairProbeOutcome): boolean {
  return (
    !accepted(one) &&
    one.providerTransportStarted &&
    one.providerHttpStatus >= 100 &&
    one.providerHttpClass !== 'TRANSPORT_THROW' &&
    one.providerHttpClass !== 'NOT_REACHED' &&
    one.providerHttpClass !== 'NONE'
  );
}

/** Read a verification matrix. Every declared step lands in exactly one bucket. */
export function analyseSchemaRepairVerification(
  outcomes: readonly SchemaRepairProbeOutcome[],
): SchemaRepairVerificationAnalysis {
  const byId = new Map<SchemaRepairVerificationStepId, SchemaRepairProbeOutcome>();
  for (const one of outcomes) {
    byId.set(one.stepId, one);
  }

  const acceptedIds: SchemaRepairVerificationStepId[] = [];
  const rejectedIds: SchemaRepairVerificationStepId[] = [];
  const inconclusiveIds: SchemaRepairVerificationStepId[] = [];
  for (const stepId of SCHEMA_REPAIR_VERIFICATION_STEP_IDS) {
    const one = byId.get(stepId);
    if (one === undefined) {
      inconclusiveIds.push(stepId);
    } else if (accepted(one)) {
      acceptedIds.push(stepId);
    } else if (rejected(one)) {
      rejectedIds.push(stepId);
    } else {
      inconclusiveIds.push(stepId);
    }
  }

  const result = (
    classification: SchemaRepairVerificationClassification,
  ): SchemaRepairVerificationAnalysis =>
    Object.freeze({
      classification,
      acceptedStepIds: Object.freeze([...acceptedIds]),
      rejectedStepIds: Object.freeze([...rejectedIds]),
      inconclusiveStepIds: Object.freeze([...inconclusiveIds]),
    });

  const control = byId.get('V0_MINIMAL_CONTROL');
  if (control === undefined || !accepted(control)) {
    return result('CONTROL_INVALID');
  }
  if (inconclusiveIds.length > 0) {
    return result('MIXED_OR_INCONCLUSIVE');
  }

  // The exact document decides the summary, exactly as R8 does in the historical analysis: if the
  // provider took the repaired schema, an isolated wrapper result cannot headline as though it had
  // not. Wrapper rejections stay visible in the set.
  if (!rejectedIds.includes('V4_EXACT_PROJECTED_RIYA')) {
    return result('REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP');
  }
  const repairedFragmentRejected = rejectedIds.some((one) => one !== 'V4_EXACT_PROJECTED_RIYA');
  if (repairedFragmentRejected) {
    return result('REPAIRED_OBSERVATION_SCHEMA_REJECTED');
  }
  return result('REPAIRED_EVOLUTION_COMPOSITION_REJECTED');
}
