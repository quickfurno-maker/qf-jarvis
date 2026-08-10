/**
 * The Gold V1 plan and brief validators (HGV1-A, ADR-0108).
 *
 * These check the TABLE, before anybody writes against it. A plan defect found here costs an
 * afternoon; the same defect found after Wave 3 costs two hundred conversations.
 *
 * Nothing throws for a finding. Both validators list everything, so one pass tells an author or an
 * owner the whole story.
 */
import {
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
  RiyaDatasetSplit,
} from '../../contracts/vocabularies.js';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import { scanTextForPrivacy } from '../../internal/privacy-scan.js';
import { collidesWithProtectedIdentity } from '../../internal/leakage.js';
import type { ProtectedTextIndex } from '../../internal/leakage.js';
import { goldPairKey } from '../contracts/assignment.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';
import type { RiyaGoldV1BriefV1 } from '../contracts/brief.js';
import {
  RIYA_GOLD_V1_HOLDOUT_TOTAL,
  RIYA_GOLD_V1_PER_PAIR_PER_WAVE,
  RIYA_GOLD_V1_PER_WAVE,
  RIYA_GOLD_V1_TOTAL,
  RIYA_GOLD_V1_TRAIN_TOTAL,
  RIYA_GOLD_V1_VALIDATION_TOTAL,
  RIYA_GOLD_WAVES,
  RIYA_GOLD_WAVE_SPLITS,
} from '../contracts/vocabularies.js';

/** Wave-1 diversity floors. Calibration needs enough of each to exercise the workflow. */
export const RIYA_GOLD_WAVE1_MIN_DIFFICULTY: Readonly<Record<RiyaDatasetDifficulty, number>> =
  Object.freeze({ BASIC: 8, STANDARD: 30, HARD: 20, EDGE: 6 });
export const RIYA_GOLD_WAVE1_MIN_HIGH_RISK = 18;
export const RIYA_GOLD_WAVE1_MAX_PERSONA_SHARE = 16;
export const RIYA_GOLD_WAVE1_MIN_PERSONAS_PER_LANGUAGE = 6;
/** Depth bands: shallow, mid, deep. A corpus of only four-turn examples teaches only openings. */
export const RIYA_GOLD_WAVE1_MIN_DEPTH_BANDS = Object.freeze({ shallow: 12, mid: 36, deep: 12 });

/** A plan or brief defect. A closed reason and a location, never content. */
export interface RiyaGoldFinding {
  readonly reason: string;
  readonly locationRef?: string;
}

export interface RiyaGoldPlanReport {
  readonly totalAssignments: number;
  readonly countsByWave: Readonly<Record<string, number>>;
  readonly countsBySplit: Readonly<Record<RiyaDatasetSplit, number>>;
  readonly countsByLanguage: Readonly<Partial<Record<RiyaDatasetLanguageMode, number>>>;
  readonly countsByPrimaryInteraction: Readonly<
    Partial<Record<RiyaDatasetInteractionKind, number>>
  >;
  readonly countsByPersona: Readonly<Partial<Record<RiyaDatasetPersona, number>>>;
  readonly countsByDifficulty: Readonly<Partial<Record<RiyaDatasetDifficulty, number>>>;
  readonly countsByRiskClass: Readonly<Partial<Record<RiyaDatasetRiskClass, number>>>;
  readonly startPhasesCovered: readonly string[];
  readonly wave1DepthBands: Readonly<Record<'shallow' | 'mid' | 'deep', number>>;
  readonly findings: readonly RiyaGoldFinding[];
  readonly valid: boolean;
}

const tally = <Key extends string>(
  keys: readonly Key[],
): Readonly<Partial<Record<Key, number>>> => {
  const out: Partial<Record<Key, number>> = {};
  for (const key of keys) {
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.freeze(out);
};

const depthBand = (turns: number): 'shallow' | 'mid' | 'deep' =>
  turns <= 5 ? 'shallow' : turns <= 8 ? 'mid' : 'deep';

/** The id every Gold assignment must match. Its own namespace, never the exam's. */
export const RIYA_GOLD_ASSIGNMENT_ID_PATTERN =
  /^gold\.v1\.w[1-5]\.(?:en|hi|hinglish)\.[a-z-]+\.0[12]$/u;

/** Validate the 360-slot plan. */
export function validateRiyaGoldV1Plan(
  assignments: readonly RiyaGoldV1AssignmentV1[],
  options: { readonly protectedIndex?: ProtectedTextIndex } = {},
): RiyaGoldPlanReport {
  const findings: RiyaGoldFinding[] = [];

  if (assignments.length !== RIYA_GOLD_V1_TOTAL) {
    findings.push({ reason: 'TOTAL_NOT_360' });
  }

  const ids = assignments.map((one) => one.assignmentId);
  if (new Set(ids).size !== ids.length) {
    findings.push({ reason: 'DUPLICATE_ASSIGNMENT_ID' });
  }
  for (const assignment of assignments) {
    if (!RIYA_GOLD_ASSIGNMENT_ID_PATTERN.test(assignment.assignmentId)) {
      findings.push({ reason: 'ID_PATTERN', locationRef: assignment.assignmentId });
    }
    if (assignment.authoringBriefRef !== `brief.${assignment.assignmentId}`) {
      findings.push({ reason: 'BRIEF_REF_MISMATCH', locationRef: assignment.assignmentId });
    }
    if (
      options.protectedIndex !== undefined &&
      collidesWithProtectedIdentity(options.protectedIndex, assignment.assignmentId)
    ) {
      // A Gold id inside the exam's namespace would collide with it in every tool that keys on ids.
      findings.push({
        reason: 'PROTECTED_NAMESPACE_COLLISION',
        locationRef: assignment.assignmentId,
      });
    }
  }

  // Wave shape.
  const countsByWave: Record<string, number> = {};
  for (const assignment of assignments) {
    const key = String(assignment.wave);
    countsByWave[key] = (countsByWave[key] ?? 0) + 1;
    if (assignment.split !== RIYA_GOLD_WAVE_SPLITS[assignment.wave]) {
      findings.push({ reason: 'WAVE_SPLIT_MISMATCH', locationRef: assignment.assignmentId });
    }
  }
  for (const wave of RIYA_GOLD_WAVES) {
    if ((countsByWave[String(wave)] ?? 0) !== RIYA_GOLD_V1_PER_WAVE) {
      findings.push({ reason: 'WAVE_NOT_72', locationRef: `wave.${String(wave)}` });
    }
  }
  if (Object.keys(countsByWave).length !== RIYA_GOLD_WAVES.length) {
    findings.push({ reason: 'WAVE_COUNT_NOT_5' });
  }

  // Exactly two per wave, language and kind.
  const pairCounts = new Map<string, number>();
  for (const assignment of assignments) {
    const key = goldPairKey(assignment);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  for (const wave of RIYA_GOLD_WAVES) {
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        const key = `${String(wave)}|${languageMode}|${kind}`;
        if ((pairCounts.get(key) ?? 0) !== RIYA_GOLD_V1_PER_PAIR_PER_WAVE) {
          findings.push({ reason: 'PAIR_NOT_2', locationRef: key });
        }
      }
    }
  }

  const countsBySplit: Record<RiyaDatasetSplit, number> = {
    TRAIN: 0,
    VALIDATION: 0,
    HOLDOUT: 0,
  };
  for (const assignment of assignments) {
    countsBySplit[assignment.split] += 1;
  }
  if (countsBySplit.TRAIN !== RIYA_GOLD_V1_TRAIN_TOTAL) {
    findings.push({ reason: 'TRAIN_NOT_288' });
  }
  if (countsBySplit.VALIDATION !== RIYA_GOLD_V1_VALIDATION_TOTAL) {
    findings.push({ reason: 'VALIDATION_NOT_72' });
  }
  if (countsBySplit.HOLDOUT !== RIYA_GOLD_V1_HOLDOUT_TOTAL) {
    // Gold V1 populates no holdout. A Git-visible corpus is not hidden, and labelling one as such
    // would be a comforting name on something untrue.
    findings.push({ reason: 'HOLDOUT_NOT_ZERO' });
  }

  // Final diversity floors.
  const countsByPersona = tally(assignments.map((one) => one.persona));
  const countsByDifficulty = tally(assignments.map((one) => one.difficulty));
  const countsByRiskClass = tally(assignments.map((one) => one.riskClass));
  for (const persona of RIYA_DATASET_PERSONAS) {
    if ((countsByPersona[persona] ?? 0) < 30) {
      findings.push({ reason: 'PERSONA_FLOOR', locationRef: persona });
    }
  }
  for (const [difficulty, floor] of [
    ['BASIC', 50],
    ['STANDARD', 150],
    ['HARD', 100],
    ['EDGE', 30],
  ] as const) {
    if ((countsByDifficulty[difficulty] ?? 0) < floor) {
      findings.push({ reason: 'DIFFICULTY_FLOOR', locationRef: difficulty });
    }
  }
  if ((countsByRiskClass.HIGH_RISK ?? 0) < 90) {
    findings.push({ reason: 'HIGH_RISK_FLOOR' });
  }
  if ((countsByRiskClass.STANDARD ?? 0) < 180) {
    findings.push({ reason: 'STANDARD_RISK_FLOOR' });
  }

  // Wave-1 calibration shape.
  const wave1 = assignments.filter((one) => one.wave === 1);
  const wave1Difficulty = tally(wave1.map((one) => one.difficulty));
  for (const difficulty of RIYA_DATASET_DIFFICULTIES) {
    if ((wave1Difficulty[difficulty] ?? 0) < RIYA_GOLD_WAVE1_MIN_DIFFICULTY[difficulty]) {
      findings.push({ reason: 'WAVE1_DIFFICULTY_FLOOR', locationRef: difficulty });
    }
  }
  const wave1Personas = tally(wave1.map((one) => one.persona));
  for (const persona of RIYA_DATASET_PERSONAS) {
    const count = wave1Personas[persona] ?? 0;
    if (count === 0) {
      findings.push({ reason: 'WAVE1_PERSONA_MISSING', locationRef: persona });
    }
    if (count > RIYA_GOLD_WAVE1_MAX_PERSONA_SHARE) {
      findings.push({ reason: 'WAVE1_PERSONA_DOMINATES', locationRef: persona });
    }
  }
  for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
    const distinct = new Set(
      wave1.filter((one) => one.languageMode === languageMode).map((one) => one.persona),
    ).size;
    if (distinct < RIYA_GOLD_WAVE1_MIN_PERSONAS_PER_LANGUAGE) {
      findings.push({ reason: 'WAVE1_LANGUAGE_PERSONA_SPREAD', locationRef: languageMode });
    }
  }
  const wave1Risk = tally(wave1.map((one) => one.riskClass));
  if ((wave1Risk.HIGH_RISK ?? 0) < RIYA_GOLD_WAVE1_MIN_HIGH_RISK) {
    findings.push({ reason: 'WAVE1_HIGH_RISK_FLOOR' });
  }

  const wave1DepthBands = { shallow: 0, mid: 0, deep: 0 };
  for (const assignment of wave1) {
    wave1DepthBands[depthBand(assignment.targetAssistantTurns)] += 1;
  }
  for (const band of ['shallow', 'mid', 'deep'] as const) {
    if (wave1DepthBands[band] < RIYA_GOLD_WAVE1_MIN_DEPTH_BANDS[band]) {
      findings.push({ reason: 'WAVE1_DEPTH_BAND', locationRef: band });
    }
  }

  // Every phase should be somebody's starting point in Wave 1.
  const wave1Phases = new Set(wave1.map((one) => one.startPhase));
  for (const phase of RIYA_CONVERSATION_PHASES) {
    if (!wave1Phases.has(phase)) {
      findings.push({ reason: 'WAVE1_START_PHASE_MISSING', locationRef: phase });
    }
  }

  return Object.freeze({
    totalAssignments: assignments.length,
    countsByWave: Object.freeze(countsByWave),
    countsBySplit: Object.freeze(countsBySplit),
    countsByLanguage: tally(assignments.map((one) => one.languageMode)),
    countsByPrimaryInteraction: tally(assignments.map((one) => one.primaryInteractionKind)),
    countsByPersona,
    countsByDifficulty,
    countsByRiskClass,
    startPhasesCovered: Object.freeze([...wave1Phases].sort()),
    wave1DepthBands: Object.freeze(wave1DepthBands),
    findings: Object.freeze(findings),
    valid: findings.length === 0,
  });
}

export interface RiyaGoldBriefReport {
  readonly totalBriefs: number;
  readonly findings: readonly RiyaGoldFinding[];
  readonly valid: boolean;
}

/** Shapes that mean a brief has become a script rather than an instruction. */
const DIALOGUE_SHAPES: readonly RegExp[] = Object.freeze([
  /["“”]/u,
  /(?:^|\s)(?:user|customer|assistant|riya|bot|agent)\s*:/iu,
]);

/** Brand and product names that must never appear in an authoring instruction. */
const FORBIDDEN_NAMES: readonly string[] = Object.freeze([
  'quickfurno',
  'onedecore',
  'groq',
  'openai',
  'anthropic',
  'claude',
  'gpt',
  'llama',
  'qwen',
  'gemini',
]);

/**
 * Validate a wave's briefs against its assignments.
 *
 * Separate from the trajectory release validator on purpose: a brief is checked for being a good
 * ASSIGNMENT, and a trajectory for being a good EXAMPLE. Merging the two would mean a brief could
 * accidentally satisfy a corpus gate.
 */
export function validateRiyaGoldV1Briefs(
  briefs: readonly RiyaGoldV1BriefV1[],
  assignments: readonly RiyaGoldV1AssignmentV1[],
  options: { readonly protectedIndex?: ProtectedTextIndex } = {},
): RiyaGoldBriefReport {
  const findings: RiyaGoldFinding[] = [];

  if (briefs.length !== assignments.length) {
    findings.push({ reason: 'BRIEF_COUNT_MISMATCH' });
  }

  const refs = briefs.map((one) => one.briefRef);
  if (new Set(refs).size !== refs.length) {
    findings.push({ reason: 'DUPLICATE_BRIEF_REF' });
  }

  const byAssignment = new Map(briefs.map((one) => [one.assignmentId, one]));
  for (const assignment of assignments) {
    const brief = byAssignment.get(assignment.assignmentId);
    if (brief === undefined) {
      findings.push({ reason: 'BRIEF_MISSING', locationRef: assignment.assignmentId });
      continue;
    }
    if (brief.briefRef !== assignment.authoringBriefRef) {
      findings.push({ reason: 'BRIEF_REF_MISMATCH', locationRef: assignment.assignmentId });
    }
    if (brief.requiredJourneyEvents.length === 0) {
      findings.push({ reason: 'JOURNEY_EVENTS_EMPTY', locationRef: brief.briefRef });
    }
    if (brief.forbiddenShortcuts.length === 0) {
      findings.push({ reason: 'FORBIDDEN_SHORTCUTS_EMPTY', locationRef: brief.briefRef });
    }
    if (brief.reviewFocus.length === 0) {
      findings.push({ reason: 'REVIEW_FOCUS_EMPTY', locationRef: brief.briefRef });
    }
    // An authority plan is required exactly when the assignment says mutable business truth is in
    // play. Without it the author has no legitimate way to state the fact the scenario needs.
    if (assignment.requiredAuthorityFactClasses.length > 0 && brief.authorityPlan.length === 0) {
      findings.push({ reason: 'AUTHORITY_PLAN_MISSING', locationRef: brief.briefRef });
    }
    const planned = new Set(brief.authorityPlan.map((entry) => entry.factClass));
    for (const factClass of assignment.requiredAuthorityFactClasses) {
      if (!planned.has(factClass)) {
        findings.push({ reason: 'AUTHORITY_CLASS_UNPLANNED', locationRef: brief.briefRef });
      }
    }
  }

  for (const brief of briefs) {
    if (!assignments.some((one) => one.assignmentId === brief.assignmentId)) {
      findings.push({ reason: 'BRIEF_WITHOUT_ASSIGNMENT', locationRef: brief.briefRef });
    }
    for (const prose of [brief.customerSituation, brief.conversationGoal]) {
      for (const shape of DIALOGUE_SHAPES) {
        if (shape.test(prose)) {
          findings.push({ reason: 'BRIEF_LOOKS_LIKE_DIALOGUE', locationRef: brief.briefRef });
        }
      }
      for (const kind of scanTextForPrivacy(prose)) {
        findings.push({ reason: `PRIVACY_${kind}`, locationRef: brief.briefRef });
      }
      const lowered = prose.toLowerCase();
      for (const name of FORBIDDEN_NAMES) {
        if (lowered.includes(name)) {
          findings.push({ reason: 'FORBIDDEN_NAME', locationRef: brief.briefRef });
        }
      }
    }
    if (
      options.protectedIndex !== undefined &&
      collidesWithProtectedIdentity(options.protectedIndex, brief.briefRef)
    ) {
      findings.push({ reason: 'PROTECTED_NAMESPACE_COLLISION', locationRef: brief.briefRef });
    }
  }

  return Object.freeze({
    totalBriefs: briefs.length,
    findings: Object.freeze(findings),
    valid: findings.length === 0,
  });
}
