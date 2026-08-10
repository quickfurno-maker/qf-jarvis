/**
 * The deterministic 360-slot Human Gold V1 plan (HGV1-A, ADR-0108).
 *
 * ### Why the whole plan exists before a word is written
 *
 * Partitioning first is what makes every wave independently balanced. If assignments were invented as
 * authors went, the corpus would drift toward whatever is easiest to write — more discovery, fewer
 * handoffs, every objection marked HARD — and nobody would notice until the model was measurably
 * lopsided.
 *
 * Generating it also means the plan is auditable as a table. A defect here is caught while it is
 * still a table, not after three hundred conversations have been written against it.
 *
 * ### The tables below are per (kind, ordinal), and that is deliberate
 *
 * Difficulty, depth, start phase, risk and the persona POOL are properties of the SITUATION, not of
 * the language. A price objection is a price objection in Hindi. What varies by language and wave is
 * which persona from the pool is drawn, so the same twelve situations are written by materially
 * different customers across the corpus rather than translated three times.
 */
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';

import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetFactClass,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
} from '../../contracts/vocabularies.js';
import { createRiyaGoldV1Assignment } from '../contracts/assignment.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';
import {
  RIYA_GOLD_ORDINALS,
  RIYA_GOLD_WAVE_SPLITS,
  RIYA_GOLD_WAVES,
} from '../contracts/vocabularies.js';
import type {
  RiyaGoldForbiddenPattern,
  RiyaGoldOrdinal,
  RiyaGoldWave,
} from '../contracts/vocabularies.js';

/** The id fragment each language contributes. */
const LANGUAGE_SLUG: Readonly<Record<RiyaDatasetLanguageMode, string>> = Object.freeze({
  ENGLISH: 'en',
  HINDI: 'hi',
  HINGLISH: 'hinglish',
});

const KIND_SLUG: Readonly<Record<RiyaDatasetInteractionKind, string>> = Object.freeze({
  DISCOVERY: 'discovery',
  CORRECTION: 'correction',
  OBJECTION_PRICE: 'objection-price',
  OBJECTION_TRUST: 'objection-trust',
  OBJECTION_TIMELINE: 'objection-timeline',
  COMPARISON: 'comparison',
  GROUNDING_QA: 'grounding-qa',
  OUT_OF_SCOPE: 'out-of-scope',
  HUMAN_REQUEST: 'human-request',
  POST_SUMMARY_QA: 'post-summary-qa',
  COMPLETE_QA: 'complete-qa',
  NEXT_STEP: 'next-step',
});

/** What varies between the two assignments of one situation. */
interface SlotShape {
  readonly difficulty: RiyaDatasetDifficulty;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly startPhase: RiyaConversationPhase;
  readonly targetAssistantTurns: number;
  readonly requiredAuthorityFactClasses: readonly RiyaDatasetFactClass[];
  readonly requiredSecondaryKinds: readonly RiyaDatasetInteractionKind[];
  readonly extraForbidden: readonly RiyaGoldForbiddenPattern[];
}

/**
 * Forbidden everywhere.
 *
 * These are not situational. A canned opener, a fabricated price or a chain-of-thought aside is wrong
 * in a discovery turn and wrong in a handoff, so they are not left to per-slot judgement.
 */
const UNIVERSAL_FORBIDDEN: readonly RiyaGoldForbiddenPattern[] = Object.freeze([
  'CANNED_OPENER',
  'CANNED_CTA',
  'FALSE_URGENCY',
  'FALSE_SCARCITY',
  'INVENTED_PRICE',
  'INVENTED_WARRANTY',
  'INVENTED_AVAILABILITY',
  'INVENTED_RATING_OR_REVIEW',
  'INVENTED_VENDOR_COUNT',
  'GUILT_OR_FEAR',
  'DEMOGRAPHIC_STEREOTYPE',
  'AI_SELF_REFERENCE',
  'SYSTEM_PROMPT_DISCLOSURE',
  'CHAIN_OF_THOUGHT',
  'CLAIM_ACTION_NOT_TAKEN',
  'MULTIPLE_DISCOVERY_QUESTIONS',
  'REPEATED_KNOWN_QUESTION',
]);

/**
 * Which personas can plausibly be this customer.
 *
 * Four per situation, so a language-and-wave rotation draws materially different people rather than
 * the same two forever — and so a persona is never forced onto a scenario it does not fit. A
 * `PREMIUM` customer raising a pure out-of-scope request is possible; a `PRICE_SENSITIVE` one asking
 * a completed-intake process question is a stretch.
 */
const PERSONA_POOL: Readonly<Record<RiyaDatasetInteractionKind, readonly RiyaDatasetPersona[]>> =
  Object.freeze({
    DISCOVERY: ['EXPLORING', 'BUSY_SHORT_REPLY', 'DECISIVE', 'CONFUSED'],
    CORRECTION: ['CONFUSED', 'BUSY_SHORT_REPLY', 'FRUSTRATED', 'EXPLORING'],
    OBJECTION_PRICE: ['PRICE_SENSITIVE', 'SKEPTICAL', 'PREMIUM', 'DECISIVE'],
    OBJECTION_TRUST: ['SKEPTICAL', 'FRUSTRATED', 'PREMIUM', 'EXPLORING'],
    OBJECTION_TIMELINE: ['DECISIVE', 'BUSY_SHORT_REPLY', 'FRUSTRATED', 'PRICE_SENSITIVE'],
    COMPARISON: ['EXPLORING', 'PREMIUM', 'PRICE_SENSITIVE', 'SKEPTICAL'],
    GROUNDING_QA: ['CONFUSED', 'EXPLORING', 'BUSY_SHORT_REPLY', 'PREMIUM'],
    OUT_OF_SCOPE: ['CONFUSED', 'EXPLORING', 'BUSY_SHORT_REPLY', 'DECISIVE'],
    HUMAN_REQUEST: ['FRUSTRATED', 'SKEPTICAL', 'BUSY_SHORT_REPLY', 'CONFUSED'],
    POST_SUMMARY_QA: ['DECISIVE', 'PREMIUM', 'EXPLORING', 'PRICE_SENSITIVE'],
    COMPLETE_QA: ['DECISIVE', 'BUSY_SHORT_REPLY', 'PREMIUM', 'CONFUSED'],
    NEXT_STEP: ['DECISIVE', 'EXPLORING', 'PREMIUM', 'PRICE_SENSITIVE'],
  });

/**
 * The two slots of each situation.
 *
 * Ordinal 1 is the ordinary case; ordinal 2 is the harder, deeper, usually riskier one. They differ
 * in start phase as well, so the pair is not the same conversation at two difficulties.
 */
const SLOTS: Readonly<Record<RiyaDatasetInteractionKind, readonly [SlotShape, SlotShape]>> =
  Object.freeze({
    DISCOVERY: [
      {
        difficulty: 'BASIC',
        riskClass: 'STANDARD',
        startPhase: 'INTRO',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'NEED',
        targetAssistantTurns: 8,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: ['CORRECTION'],
        extraForbidden: [],
      },
    ],
    CORRECTION: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'LOCATION',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'HARD',
        riskClass: 'STANDARD',
        startPhase: 'BUDGET_TIMELINE',
        targetAssistantTurns: 9,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: ['DISCOVERY'],
        extraForbidden: [],
      },
    ],
    OBJECTION_PRICE: [
      {
        difficulty: 'STANDARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'BUDGET_TIMELINE',
        targetAssistantTurns: 7,
        requiredAuthorityFactClasses: ['PRICE'],
        requiredSecondaryKinds: [],
        extraForbidden: ['INSTANT_DISCOUNT'],
      },
      {
        difficulty: 'HARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'PROJECT_DETAILS',
        targetAssistantTurns: 10,
        requiredAuthorityFactClasses: ['PRICE', 'PACKAGE'],
        requiredSecondaryKinds: ['COMPARISON'],
        extraForbidden: ['INSTANT_DISCOUNT', 'COMPETITOR_ATTACK'],
      },
    ],
    OBJECTION_TRUST: [
      {
        difficulty: 'STANDARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'NEED',
        targetAssistantTurns: 7,
        requiredAuthorityFactClasses: ['PROCESS'],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'HARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'BUDGET_TIMELINE',
        targetAssistantTurns: 9,
        requiredAuthorityFactClasses: ['WARRANTY', 'PROCESS'],
        requiredSecondaryKinds: [],
        extraForbidden: ['APOLOGY_LOOP'],
      },
    ],
    OBJECTION_TIMELINE: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'BUDGET_TIMELINE',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'HARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'PROJECT_DETAILS',
        targetAssistantTurns: 8,
        requiredAuthorityFactClasses: ['CURRENT_STATUS', 'PROCESS'],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
    ],
    COMPARISON: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'NEED',
        targetAssistantTurns: 8,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: ['COMPETITOR_ATTACK'],
      },
      {
        difficulty: 'HARD',
        riskClass: 'STANDARD',
        startPhase: 'PROJECT_DETAILS',
        targetAssistantTurns: 11,
        requiredAuthorityFactClasses: ['PACKAGE'],
        requiredSecondaryKinds: ['OBJECTION_PRICE'],
        extraForbidden: ['COMPETITOR_ATTACK'],
      },
    ],
    GROUNDING_QA: [
      {
        difficulty: 'BASIC',
        riskClass: 'STANDARD',
        startPhase: 'INTRO',
        targetAssistantTurns: 4,
        requiredAuthorityFactClasses: ['SERVICE_AVAILABILITY'],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'STANDARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'LOCATION',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: ['POLICY'],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
    ],
    OUT_OF_SCOPE: [
      {
        difficulty: 'BASIC',
        riskClass: 'STANDARD',
        startPhase: 'NEED',
        targetAssistantTurns: 4,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'EDGE',
        riskClass: 'STANDARD',
        startPhase: 'INTRO',
        targetAssistantTurns: 5,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: ['GROUNDING_QA'],
        extraForbidden: [],
      },
    ],
    HUMAN_REQUEST: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'LOCATION',
        targetAssistantTurns: 4,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: ['PRESSURE_AFTER_HUMAN_REQUEST'],
      },
      {
        difficulty: 'HARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'SUMMARY',
        targetAssistantTurns: 7,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: ['CORRECTION'],
        extraForbidden: ['PRESSURE_AFTER_HUMAN_REQUEST', 'APOLOGY_LOOP'],
      },
    ],
    POST_SUMMARY_QA: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'SUMMARY',
        targetAssistantTurns: 5,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: ['REOPEN_COMPLETED_INTAKE'],
      },
      {
        difficulty: 'HARD',
        riskClass: 'STANDARD',
        startPhase: 'CONTACT',
        targetAssistantTurns: 7,
        requiredAuthorityFactClasses: ['PACKAGE'],
        requiredSecondaryKinds: ['CORRECTION'],
        extraForbidden: ['REOPEN_COMPLETED_INTAKE'],
      },
    ],
    COMPLETE_QA: [
      {
        difficulty: 'BASIC',
        riskClass: 'STANDARD',
        startPhase: 'COMPLETE',
        targetAssistantTurns: 4,
        requiredAuthorityFactClasses: ['PROCESS'],
        requiredSecondaryKinds: [],
        extraForbidden: ['REOPEN_COMPLETED_INTAKE'],
      },
      {
        difficulty: 'STANDARD',
        riskClass: 'HIGH_RISK',
        startPhase: 'COMPLETE',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: ['CURRENT_STATUS'],
        requiredSecondaryKinds: [],
        extraForbidden: ['REOPEN_COMPLETED_INTAKE'],
      },
    ],
    NEXT_STEP: [
      {
        difficulty: 'STANDARD',
        riskClass: 'STANDARD',
        startPhase: 'SUMMARY',
        targetAssistantTurns: 6,
        requiredAuthorityFactClasses: [],
        requiredSecondaryKinds: [],
        extraForbidden: [],
      },
      {
        difficulty: 'EDGE',
        riskClass: 'HIGH_RISK',
        startPhase: 'CONSENT',
        targetAssistantTurns: 12,
        requiredAuthorityFactClasses: ['PROCESS'],
        requiredSecondaryKinds: ['OBJECTION_TRUST'],
        extraForbidden: [],
      },
    ],
  });

/**
 * Waves 2 and 4 shift two slots, so five waves are not five copies of one table.
 *
 * `DISCOVERY.02` becomes HARD and `COMPLETE_QA.02` becomes EDGE. Both are genuinely harder versions
 * of the same situation rather than arbitrary relabels, and the plan validator asserts the resulting
 * distribution still clears every floor.
 */
/** The slot shape for one situation and ordinal. Indexed access is narrowed once, here. */
function slotFor(kind: RiyaDatasetInteractionKind, ordinal: RiyaGoldOrdinal): SlotShape {
  const pair = SLOTS[kind];
  return ordinal === 1 ? pair[0] : pair[1];
}

function difficultyFor(
  kind: RiyaDatasetInteractionKind,
  ordinal: RiyaGoldOrdinal,
  wave: RiyaGoldWave,
): RiyaDatasetDifficulty {
  const base = slotFor(kind, ordinal).difficulty;
  if (wave !== 2 && wave !== 4) {
    return base;
  }
  if (kind === 'DISCOVERY' && ordinal === 2) {
    return 'HARD';
  }
  if (kind === 'COMPLETE_QA' && ordinal === 2) {
    return 'EDGE';
  }
  return base;
}

/**
 * Draw the persona for this exact slot.
 *
 * The offset moves with both the wave and the language, so the two assignments of a cell always
 * differ, and the same cell in Hindi is a different customer from the one in English. Without the
 * language term the corpus would be the same twelve people repeated in three languages.
 */
function personaFor(
  kind: RiyaDatasetInteractionKind,
  ordinal: RiyaGoldOrdinal,
  wave: RiyaGoldWave,
  languageIndex: number,
): RiyaDatasetPersona {
  const pool = PERSONA_POOL[kind];
  const index = (wave - 1 + languageIndex * 2 + (ordinal - 1)) % pool.length;
  return pool[index] ?? pool[0] ?? 'EXPLORING';
}

/** `gold.v1.w1.en.objection-price.02` */
export function goldAssignmentId(
  wave: RiyaGoldWave,
  languageMode: RiyaDatasetLanguageMode,
  kind: RiyaDatasetInteractionKind,
  ordinal: RiyaGoldOrdinal,
): string {
  return `gold.v1.w${String(wave)}.${LANGUAGE_SLUG[languageMode]}.${KIND_SLUG[kind]}.0${String(ordinal)}`;
}

/** The brief that belongs to an assignment. One to one, by construction. */
export function goldBriefRef(assignmentId: string): string {
  return `brief.${assignmentId}`;
}

/**
 * Generate all 360 assignments, deterministically.
 *
 * Same code, same plan, every time. The ordering is wave, then language, then kind, then ordinal —
 * stable, so a diff of the plan is readable.
 */
export function generateRiyaGoldV1Plan(): readonly RiyaGoldV1AssignmentV1[] {
  const assignments: RiyaGoldV1AssignmentV1[] = [];

  for (const wave of RIYA_GOLD_WAVES) {
    RIYA_DATASET_LANGUAGE_MODES.forEach((languageMode, languageIndex) => {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        for (const ordinal of RIYA_GOLD_ORDINALS) {
          const slot = slotFor(kind, ordinal);
          const assignmentId = goldAssignmentId(wave, languageMode, kind, ordinal);
          assignments.push(
            createRiyaGoldV1Assignment({
              version: 1,
              assignmentId,
              wave,
              ordinalWithinPair: ordinal,
              split: RIYA_GOLD_WAVE_SPLITS[wave],
              languageMode,
              primaryInteractionKind: kind,
              requiredSecondaryKinds: slot.requiredSecondaryKinds,
              persona: personaFor(kind, ordinal, wave, languageIndex),
              difficulty: difficultyFor(kind, ordinal, wave),
              riskClass: slot.riskClass,
              startPhase: slot.startPhase,
              targetAssistantTurns: slot.targetAssistantTurns,
              authoringBriefRef: goldBriefRef(assignmentId),
              requiredAuthorityFactClasses: slot.requiredAuthorityFactClasses,
              forbiddenPatterns: [...UNIVERSAL_FORBIDDEN, ...slot.extraForbidden],
            }),
          );
        }
      }
    });
  }

  return Object.freeze(assignments);
}

/** Just the assignments of one wave, in plan order. */
export function riyaGoldV1WaveAssignments(wave: RiyaGoldWave): readonly RiyaGoldV1AssignmentV1[] {
  return Object.freeze(generateRiyaGoldV1Plan().filter((one) => one.wave === wave));
}

/** Exposed so the plan validator can assert every phase the plan claims to start from. */
export const RIYA_GOLD_START_PHASES: readonly RiyaConversationPhase[] = RIYA_CONVERSATION_PHASES;
