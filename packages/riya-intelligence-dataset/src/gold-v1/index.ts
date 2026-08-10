/**
 * `@qf-jarvis/riya-intelligence-dataset/gold-v1` — the Human Gold V1 authoring system
 * (HGV1-A, ADR-0108).
 *
 * ### OFFLINE. Explicitly.
 *
 * A separate subpath from the package root so nothing on a production import path can reach the
 * authoring plan, the briefs or the Gold policies. Runtime importers of this package are already
 * zero and stay zero; this subpath is for authors, reviewers and CI.
 *
 * ### What is here
 *
 * The exact 360-slot plan, the 72 Wave-1 authoring briefs, the Gold coverage and release policies,
 * the plan/brief/corpus validators, the progress board and the formula-degeneration metrics.
 *
 * ### What is NOT here
 *
 * Any Gold conversation. HGV1-A builds the authoring system; Wave-1 dialogue is authored by humans in
 * the next content PR. A brief cannot become a training row — it has no field a sentence fits in, and
 * the constructor refuses quotation marks and speaker prefixes.
 *
 * And no model, provider, embedding, judge, tokenizer or training framework. This slice designs human
 * authoring; teacher-assisted expansion is a separately governed later slice.
 */

// Vocabularies.
export {
  RIYA_GOLD_WAVES,
  RIYA_GOLD_ORDINALS,
  RIYA_GOLD_WAVE_SPLITS,
  RIYA_GOLD_JOURNEY_EVENTS,
  RIYA_GOLD_FORBIDDEN_PATTERNS,
  RIYA_GOLD_STYLE_CODES,
  RIYA_GOLD_PROGRESS_STATUSES,
  RIYA_GOLD_V1_TOTAL,
  RIYA_GOLD_V1_PER_WAVE,
  RIYA_GOLD_V1_PER_PAIR_PER_WAVE,
  RIYA_GOLD_V1_TRAIN_TOTAL,
  RIYA_GOLD_V1_VALIDATION_TOTAL,
  RIYA_GOLD_V1_HOLDOUT_TOTAL,
  RIYA_GOLD_MIN_ASSISTANT_TURNS,
  RIYA_GOLD_MAX_ASSISTANT_TURNS,
} from './contracts/vocabularies.js';
export type {
  RiyaGoldWave,
  RiyaGoldOrdinal,
  RiyaGoldJourneyEvent,
  RiyaGoldForbiddenPattern,
  RiyaGoldStyleCode,
  RiyaGoldProgressStatus,
} from './contracts/vocabularies.js';

// Assignment.
export { createRiyaGoldV1Assignment, goldPairKey } from './contracts/assignment.js';
export type { RiyaGoldV1AssignmentV1, RiyaGoldV1AssignmentInput } from './contracts/assignment.js';

// Brief.
export { createRiyaGoldV1Brief } from './contracts/brief.js';
export type {
  RiyaGoldV1BriefV1,
  RiyaGoldV1BriefInput,
  RiyaGoldAuthorityPlanEntry,
} from './contracts/brief.js';

// Progress.
export { createRiyaGoldV1Progress, summarizeRiyaGoldV1Progress } from './contracts/progress.js';
export type {
  RiyaGoldV1ProgressV1,
  RiyaGoldV1ProgressInput,
  RiyaGoldProgressSummary,
} from './contracts/progress.js';

// The plan and the Wave-1 briefs.
export {
  generateRiyaGoldV1Plan,
  riyaGoldV1WaveAssignments,
  goldAssignmentId,
  goldBriefRef,
} from './plan/generate-plan.js';
export { RIYA_GOLD_V1_WAVE_1_BRIEFS } from './plan/wave-1-briefs.js';

// Policies.
export {
  RIYA_GOLD_V1_COVERAGE_POLICY,
  RIYA_GOLD_V1_PROTECTED_CORPUS_REF,
  buildRiyaGoldV1ReleasePolicy,
} from './policy/gold-policy.js';

// Validators and metrics.
export {
  validateRiyaGoldV1Plan,
  validateRiyaGoldV1Briefs,
  RIYA_GOLD_ASSIGNMENT_ID_PATTERN,
} from './service/validate-plan.js';
export type {
  RiyaGoldPlanReport,
  RiyaGoldBriefReport,
  RiyaGoldFinding,
} from './service/validate-plan.js';
export {
  validateRiyaGoldV1Corpus,
  RIYA_GOLD_REQUIRED_SOURCE_KIND,
} from './service/validate-corpus.js';
export type { RiyaGoldCorpusReport } from './service/validate-corpus.js';
export { riyaGoldRepetitionMetrics, assistantTurnCountOf } from './service/repetition.js';
export type { RiyaGoldRepetitionMetrics, RiyaGoldRepeatedPhrase } from './service/repetition.js';
