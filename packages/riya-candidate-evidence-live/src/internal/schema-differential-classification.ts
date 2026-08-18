/**
 * The reading of a schema probe matrix (POST-PR-131).
 *
 * ### It reports a SET, never a winner
 *
 * The S11 classifier collapsed a matrix carrying two independent findings into one causal token,
 * because a high-cap rule fired and a low-cap rule was gated behind it. The repair there was to fix
 * the precedence; the lesson here is stronger — this analysis has no precedence at all between
 * feature probes.
 *
 * Every probe after the control is independent: R2 is not R1 plus an array, it is a different real
 * fragment. So "the first rejection" means only "the earliest in reading order", and reporting it as
 * the cause would be inventing an ordering the schemas do not have. What comes out is therefore the
 * complete set of rejected step ids, always, plus a closed summary token that says what SHAPE the
 * matrix has rather than which single thing is to blame.
 *
 * ### The control is the one exception
 *
 * R0 is the only probe whose failure changes how the others may be read. If the known-good minimal
 * strict schema is refused, the account, the model entitlement or the request envelope moved, and
 * nothing the remaining probes did could be attributed to the Riya schema. That is a precedence, and
 * it is the only one.
 *
 * ### Pure
 *
 * No clock, no I/O, no provider, no credential. It consumes closed outcome records and returns closed
 * tokens, which is what lets every rule below — including the ones that must NOT fire — be asserted
 * on fixtures before a live authorization is spent on them.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import type { SchemaProbeStepId } from './riya-schema-probe-matrix.js';
import { SCHEMA_PROBE_STEP_IDS } from './riya-schema-probe-matrix.js';

/** The closed conclusions a probe matrix can support. */
export const SCHEMA_DIFFERENTIAL_CLASSIFICATIONS = [
  /**
   * The control did not pass, so nothing else is interpretable.
   *
   * Not a statement about the Riya schema. It says the envelope this matrix assumes was not
   * established, and every other probe in the run must be read as unattributable.
   */
  'DIAGNOSTIC_INVALID_CONTROL',
  /**
   * The control passed and at least one isolated feature or group probe was rejected.
   *
   * The rejected set is reported in full. This token deliberately does NOT name a root cause: several
   * independent fragments may each be rejected, and choosing one of them would be a guess.
   */
  'ISOLATED_SCHEMA_FEATURE_REJECTION',
  /**
   * Every feature and group probe was accepted, and the exact full projected document was not.
   *
   * The remaining cause is an interaction, a composition or a limit that these probes do not isolate.
   * Which one is deliberately not guessed.
   */
  'FULL_SCHEMA_COMPOSITION_REJECTED',
  /**
   * Every probe including the exact projected schema was accepted.
   *
   * It means ONLY that: the exact projected Riya schema was accepted with the synthetic diagnostic
   * messages at the low completion cap, in this run. It is not a statement about the normal Riya
   * completion budget, the production message shape, safety eligibility, model quality, P10
   * eligibility or release readiness.
   */
  'EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP',
  /**
   * The matrix did not run completely, or transport failures prevent a clean reading.
   *
   * The honest answer when some probes never settled: a partial matrix supports no conclusion about
   * the ones that did.
   */
  'MIXED_OR_INCONCLUSIVE',
] as const;
export type SchemaDifferentialClassification = (typeof SCHEMA_DIFFERENTIAL_CLASSIFICATIONS)[number];

/**
 * What ONE probe did at the provider boundary.
 *
 * The same content-free vocabulary HF4-R4 established for the safety path: a probe is observed by the
 * same transport observer as a real request, so there is no second way of describing what happened
 * and no field here a raw provider body could occupy.
 */
export interface SchemaProbeOutcome {
  readonly stepId: SchemaProbeStepId;
  readonly providerTransportStarted: boolean;
  /** The exact HTTP status, bounded 100-599 by the observer. `0` means none was received. */
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  /** The provider returned a response the gateway did not classify as a failure. */
  readonly providerCompleted: boolean;
}

/** The full reading: a summary token, and every step id in its own bucket. */
export interface SchemaDifferentialAnalysis {
  readonly classification: SchemaDifferentialClassification;
  readonly acceptedStepIds: readonly SchemaProbeStepId[];
  readonly rejectedStepIds: readonly SchemaProbeStepId[];
  /** Probes that never settled, or never ran. Neither accepted nor rejected. */
  readonly inconclusiveStepIds: readonly SchemaProbeStepId[];
}

/** Accepted means the provider TOOK the request. Local semantics are explicitly not consulted. */
function accepted(one: SchemaProbeOutcome): boolean {
  return one.providerCompleted && one.providerHttpClass === 'SUCCESS_2XX';
}

/**
 * A probe that reached the boundary and was refused BY the provider.
 *
 * Distinguished from one that never settled: a transport throw or an unstarted request says nothing
 * about the schema, and folding it into "rejected" would manufacture evidence.
 */
function rejected(one: SchemaProbeOutcome): boolean {
  return (
    !accepted(one) &&
    one.providerTransportStarted &&
    one.providerHttpStatus >= 100 &&
    one.providerHttpClass !== 'TRANSPORT_THROW' &&
    one.providerHttpClass !== 'NOT_REACHED' &&
    one.providerHttpClass !== 'NONE'
  );
}

/**
 * Read a probe matrix.
 *
 * Every step id the matrix declares lands in exactly one bucket, including ids that never produced an
 * outcome at all — a run cut short by a ceiling reports those as inconclusive rather than omitting
 * them, so the three lists always reconstruct the whole matrix.
 */
export function analyseSchemaProbeMatrix(
  outcomes: readonly SchemaProbeOutcome[],
): SchemaDifferentialAnalysis {
  const byId = new Map<SchemaProbeStepId, SchemaProbeOutcome>();
  for (const one of outcomes) {
    byId.set(one.stepId, one);
  }

  const acceptedIds: SchemaProbeStepId[] = [];
  const rejectedIds: SchemaProbeStepId[] = [];
  const inconclusiveIds: SchemaProbeStepId[] = [];
  // Iterated over the DECLARED matrix, not over what arrived, so a missing probe is visible.
  for (const stepId of SCHEMA_PROBE_STEP_IDS) {
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

  const frozen = (ids: readonly SchemaProbeStepId[]): readonly SchemaProbeStepId[] =>
    Object.freeze([...ids]);
  const result = (classification: SchemaDifferentialClassification): SchemaDifferentialAnalysis =>
    Object.freeze({
      classification,
      acceptedStepIds: frozen(acceptedIds),
      rejectedStepIds: frozen(rejectedIds),
      inconclusiveStepIds: frozen(inconclusiveIds),
    });

  const control = byId.get('R0_MINIMAL_CONTROL');
  // THE only precedence in this function. Without an established envelope nothing else is readable.
  if (control === undefined || !accepted(control)) {
    return result('DIAGNOSTIC_INVALID_CONTROL');
  }

  // Anything that neither settled nor ran leaves the matrix incomplete. Reported before the shape
  // rules below, because a partial matrix cannot support a statement about the probes that did run.
  if (inconclusiveIds.length > 0) {
    return result('MIXED_OR_INCONCLUSIVE');
  }

  const exactRejected = rejectedIds.includes('R8_EXACT_PROJECTED_RIYA');
  const featureOrGroupRejected = rejectedIds.filter(
    (one) => one !== 'R8_EXACT_PROJECTED_RIYA',
  ).length;

  if (featureOrGroupRejected > 0) {
    // At least one isolated fragment was refused on its own. The set is what is reported; no single
    // member of it is promoted to "the cause", whether or not the exact document also failed.
    return result('ISOLATED_SCHEMA_FEATURE_REJECTION');
  }
  if (exactRejected) {
    return result('FULL_SCHEMA_COMPOSITION_REJECTED');
  }
  return result('EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP');
}
