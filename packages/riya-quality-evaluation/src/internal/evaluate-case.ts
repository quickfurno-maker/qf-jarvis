/**
 * One scenario, one observation, one verdict (RWC-P10, ADR-0106 §13, §14).
 *
 * ### Objective and subjective are kept apart deliberately
 *
 * The objective checks below are all countable or set-membership: a mode, two counts, which
 * canonical observations appeared, which fields were asked about, whether a citation exists, which
 * phase the conversation reached. None involves judgement, so none can be argued with.
 *
 * The subjective verdict comes only from two humans. Nothing in this file reads a reply, and nothing
 * in this file forms an opinion — a Riya answer that is contract-correct and unpleasant fails here on
 * `EMPATHY` because two people said so, never because a heuristic guessed.
 *
 * ### Missing is not failing
 *
 * A case with no observation, or with fewer than two reviews where subjective dimensions are
 * required, is `INCONCLUSIVE`. Calling that a FAIL would blame a candidate for a gap in the harness;
 * calling it a PASS would let coverage rot silently. It is neither, and the thresholds refuse a suite
 * containing any.
 */
import type { RiyaQualityObservationV1 } from '../contracts/observation.js';
import type { RiyaQualityCaseResultV1 } from '../contracts/results.js';
import type { RiyaQualityScenarioV1 } from '../contracts/scenario.js';
import { RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS } from '../contracts/thresholds.js';
import { reviewSatisfies } from '../contracts/human-review.js';
import type {
  RiyaQualityDimension,
  RiyaQualityObjectiveFailureCode,
} from '../contracts/vocabularies.js';

/** What one case contributed to each dimension's coverage. */
export interface RiyaQualityCaseDimensionTally {
  readonly applicable: readonly RiyaQualityDimension[];
  readonly passed: readonly RiyaQualityDimension[];
}

export interface RiyaQualityCaseEvaluation {
  readonly result: RiyaQualityCaseResultV1;
  readonly tally: RiyaQualityCaseDimensionTally;
}

const sorted = <T extends string>(values: Iterable<T>): readonly T[] =>
  Object.freeze([...new Set(values)].sort());

/** Evaluate one scenario against its observation. `undefined` means nothing was submitted. */
export function evaluateRiyaQualityCase(
  scenario: RiyaQualityScenarioV1,
  observation: RiyaQualityObservationV1 | undefined,
  requiredHumanReviews: number = RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
): RiyaQualityCaseEvaluation {
  const inconclusive = (code: RiyaQualityObjectiveFailureCode): RiyaQualityCaseEvaluation => ({
    result: Object.freeze({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion,
      outcome: 'INCONCLUSIVE' as const,
      objectiveFailures: Object.freeze([code]),
      failedQualityDimensions: Object.freeze([]),
    }),
    // An unmeasured case contributes to NO dimension. Counting it as applicable-and-failed would
    // punish a candidate for a harness gap; counting it as applicable-and-passed would hide one.
    tally: { applicable: Object.freeze([]), passed: Object.freeze([]) },
  });

  if (observation === undefined) {
    return inconclusive('OBSERVATION_MISSING');
  }

  const required = scenario.expected.requiredQualityDimensions;
  if (required.length > 0 && observation.humanReviews.length !== requiredHumanReviews) {
    // One review is one person's taste, not a measurement. Three would make "both agreed" ambiguous.
    return inconclusive('HUMAN_REVIEW_MISSING');
  }

  // ---- objective ---------------------------------------------------------------------------
  const failures: RiyaQualityObjectiveFailureCode[] = [];
  const expected = scenario.expected;

  if (observation.languageMode !== scenario.languageMode) {
    // Answering a Hinglish client in English is a real product failure, not a style note: it reads
    // as a system that did not understand them.
    failures.push('LANGUAGE_MISMATCH');
  }
  if (observation.replyCharCount > expected.maxReplyChars) {
    failures.push('REPLY_TOO_LONG');
  }
  if (observation.questionCount > expected.maxQuestions) {
    failures.push('TOO_MANY_QUESTIONS');
  }

  const observed = new Map(
    observation.observationBatch.observations.map((one) => [one.field, one]),
  );

  for (const want of expected.expectedObservations) {
    const got = observed.get(want.field);
    if (got === undefined) {
      failures.push('REQUIRED_OBSERVATION_MISSING');
      continue;
    }
    if (got.operation !== want.operation) {
      failures.push('OBSERVATION_VALUE_MISMATCH');
      continue;
    }
    if (want.value !== undefined && got.value !== want.value) {
      failures.push('OBSERVATION_VALUE_MISMATCH');
      continue;
    }
    if (
      want.allowedProvenance !== undefined &&
      !(want.allowedProvenance as readonly string[]).includes(got.provenance)
    ) {
      // A fact the client stated and a fact the candidate guessed are different results even when
      // the value matches, and only one of them survives contact with a client who never said it.
      failures.push('OBSERVATION_VALUE_MISMATCH');
    }
  }

  for (const field of expected.forbiddenObservationFields) {
    if (observed.has(field)) {
      failures.push('FORBIDDEN_OBSERVATION_PRESENT');
    }
  }

  const allowedAsked = new Set(expected.allowedAskedDiscoveryFields);
  for (const field of observation.askedDiscoveryFields) {
    if (!allowedAsked.has(field)) {
      // Re-asking something the client already answered is the single most common way a discovery
      // conversation loses somebody.
      failures.push('ASKED_FIELD_NOT_ALLOWED');
    }
  }

  if (expected.requiredCitation && observation.citations.length === 0) {
    // An ungrounded factual answer is worse than no answer: it is a claim about somebody's home
    // that nothing backs.
    failures.push('CITATION_REQUIRED');
  }

  if (!expected.allowedContinuityPhasesAfter.includes(observation.continuityPhaseAfter)) {
    failures.push('PHASE_NOT_ALLOWED');
  }

  // ---- subjective --------------------------------------------------------------------------
  const failedDimensions: RiyaQualityDimension[] = [];
  const passedDimensions: RiyaQualityDimension[] = [];
  for (const dimension of required) {
    // BOTH, not either and not a majority. One reviewer disagreeing means the reply was not clearly
    // good on that dimension, and "not clearly good" is the honest verdict.
    const bothSatisfied = observation.humanReviews.every((review) =>
      reviewSatisfies(review, dimension),
    );
    if (bothSatisfied) {
      passedDimensions.push(dimension);
    } else {
      failedDimensions.push(dimension);
    }
  }

  const outcome = failures.length > 0 || failedDimensions.length > 0 ? 'FAIL' : 'PASS';

  return {
    result: Object.freeze({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion,
      outcome,
      objectiveFailures: sorted(failures),
      failedQualityDimensions: sorted(failedDimensions),
    }),
    tally: {
      // Every required dimension WAS judged here -- two reviews exist -- so it counts toward
      // coverage even when the case also failed objectively. An objective contract violation does
      // not retract what two people observed about the reply's tone.
      applicable: sorted(required),
      passed: sorted(passedDimensions),
    },
  };
}
