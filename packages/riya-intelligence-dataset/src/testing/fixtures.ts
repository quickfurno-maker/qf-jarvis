/**
 * TINY synthetic fixtures for the RID-F1 specs. TESTING SUBPATH ONLY (ADR-0107).
 *
 * ### This is not the corpus
 *
 * RID-F1 builds the factory; HUMAN GOLD V1 authors the content. What is here is the smallest set of
 * trajectories the gates can be exercised against — a handful, not 360 — and nothing here is
 * release-quality training data.
 *
 * Everything is invented. `service.alpha`, `city.beta`, `fact.price.alpha`: obvious placeholders, so
 * a fixture can never be mistaken for a QuickFurno record and a passing spec can never be read as a
 * claim about a real offering.
 */
import {
  createRiyaDatasetAssistantTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetUserTurn,
} from '../contracts/turns.js';
import type { RiyaDatasetTurnV1 } from '../contracts/turns.js';
import { createRiyaTrainingReview } from '../contracts/review.js';
import type { RiyaTrainingReviewV1 } from '../contracts/review.js';
import { createRiyaTrainingState } from '../contracts/training-state.js';
import type { RiyaTrainingStateV1 } from '../contracts/training-state.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import { createRiyaDatasetCoveragePolicy } from '../contracts/coverage-policy.js';
import { createRiyaDatasetReleasePolicy } from '../contracts/release-policy.js';
import type { RiyaDatasetReleasePolicyV1 } from '../contracts/release-policy.js';
import { createProtectedTextIndex } from '../internal/leakage.js';
import type { ProtectedTextEntry, ProtectedTextIndex } from '../internal/leakage.js';
import {
  RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS,
  RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS,
} from '../contracts/vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetQualityDimension,
  RiyaDatasetRiskClass,
  RiyaDatasetSplit,
} from '../contracts/vocabularies.js';

/** A fixed instant. Deterministic, so two runs of a spec produce identical digests. */
export const SYNTHETIC_DATASET_INSTANT = '2026-01-01T00:00:00Z';

/** An empty NEED-phase state: nothing known yet. */
export function emptyTrainingState(): RiyaTrainingStateV1 {
  return createRiyaTrainingState({
    phase: 'NEED',
    discovery: {},
    fieldProvenance: {},
    summaryConfirmed: false,
  });
}

/** A state where the customer has already given a service and a city. */
export function partialTrainingState(): RiyaTrainingStateV1 {
  return createRiyaTrainingState({
    phase: 'LOCATION',
    discovery: { serviceInterest: 'service.alpha', location: 'city.alpha' },
    fieldProvenance: { serviceInterest: 'user_stated', location: 'user_stated' },
    summaryConfirmed: false,
  });
}

/** Accepted reviews satisfying whatever this trajectory needs. */
export function acceptedReviews(
  count: number,
  options: { readonly objection?: boolean; readonly refs?: readonly string[] } = {},
): readonly RiyaTrainingReviewV1[] {
  const dimensions: readonly RiyaDatasetQualityDimension[] =
    options.objection === true
      ? [...RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS, ...RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS]
      : RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS;
  const refs = options.refs ?? ['reviewer.alpha', 'reviewer.beta', 'reviewer.gamma'];
  return Object.freeze(
    Array.from({ length: count }, (_unused, index) =>
      createRiyaTrainingReview({
        reviewRef: refs[index] ?? `reviewer.${String(index)}`,
        decision: 'ACCEPTED',
        satisfiedQualityDimensions: dimensions,
      }),
    ),
  );
}

/** A simple two-turn discovery exchange. */
export function discoveryTurns(
  options: { readonly userText?: string; readonly replyText?: string } = {},
): readonly RiyaDatasetTurnV1[] {
  return Object.freeze([
    createRiyaDatasetUserTurn({
      type: 'USER',
      turnRef: 't1',
      text: options.userText ?? 'We just got a new flat and want the kitchen done in city.alpha.',
    }),
    createRiyaDatasetAssistantTurn({
      type: 'ASSISTANT',
      turnRef: 't2',
      text:
        options.replyText ??
        'Congratulations on the new place. What budget range are you working with?',
      annotation: {
        decision: 'ASK_DISCOVERY',
        expectedObservationBatch: {
          version: 1,
          observations: [
            {
              field: 'serviceInterest',
              operation: 'SET',
              value: 'service.alpha',
              provenance: 'user_stated',
            },
            { field: 'location', operation: 'SET', value: 'city.alpha', provenance: 'user_stated' },
          ],
          skipProjectDetails: false,
        },
        askedDiscoveryFields: ['budget'],
        supportedFactRefs: [],
        expectedPhaseAfter: 'BUDGET_TIMELINE',
        responseObjective: 'DISCOVER',
      },
    }),
  ]);
}

/**
 * A price exchange where the assistant cites an EARLIER synthetic Core fact.
 *
 * This is the shape the business-fact firewall exists to make normal: the number reaches the customer
 * from an authoritative context, not from the model's memory.
 */
export function supportedPriceTurns(): readonly RiyaDatasetTurnV1[] {
  return Object.freeze([
    createRiyaDatasetUserTurn({
      type: 'USER',
      turnRef: 'p1',
      text: 'I got a 7 lakh quote from another company. What would this cost with you?',
    }),
    createRiyaDatasetAuthoritativeContextTurn({
      type: 'AUTHORITATIVE_CONTEXT',
      turnRef: 'p2',
      authority: 'CORE_RUNTIME_SYNTHETIC',
      facts: [
        {
          factRef: 'fact.price.alpha',
          value: 'service.alpha in city.alpha starts around 6 lakh for a standard scope',
          factClass: 'PRICE',
        },
      ],
    }),
    createRiyaDatasetAssistantTurn({
      type: 'ASSISTANT',
      turnRef: 'p3',
      text: 'That is a real amount of money, so it is worth comparing properly. For a standard scope we typically start around 6 lakh.',
      annotation: {
        decision: 'USE_CORE_TRUTH',
        askedDiscoveryFields: [],
        supportedFactRefs: ['fact.price.alpha'],
        responseObjective: 'ADDRESS_OBJECTION',
      },
    }),
  ]);
}

export interface SyntheticTrajectoryOptions {
  readonly trajectoryId?: string;
  readonly lineageRootRef?: string;
  readonly split?: RiyaDatasetSplit;
  readonly languageMode?: RiyaDatasetLanguageMode;
  readonly primaryInteractionKind?: RiyaDatasetInteractionKind;
  readonly riskClass?: RiyaDatasetRiskClass;
  readonly turns?: readonly RiyaDatasetTurnV1[];
  readonly review?: readonly RiyaTrainingReviewV1[];
  readonly sourceRef?: string;
  readonly initialState?: RiyaTrainingStateV1;
  /**
   * Teacher provenance, for the AI-synthetic specs (AS1, ADR-0143).
   *
   * Default stays `HUMAN_AUTHORED_SYNTHETIC` so every existing spec is untouched. Supplying a
   * `teacherRef` is what makes a row teacher-generated — the trajectory constructor already refuses
   * the two halves apart, so there is no way to build an inconsistent source through this option.
   */
  readonly teacherRef?: string;
  readonly persona?: RiyaDatasetPersona;
  readonly difficulty?: RiyaDatasetDifficulty;
}

/** A minimal, valid, release-shaped trajectory. */
export function syntheticTrajectory(
  options: SyntheticTrajectoryOptions = {},
): RiyaIntelligenceTrajectoryV1 {
  const risk = options.riskClass ?? 'STANDARD';
  return createRiyaIntelligenceTrajectory({
    version: 1,
    trajectoryId: options.trajectoryId ?? 'riya.gold.en.discovery.001',
    trajectoryRevision: 1,
    lineageRootRef: options.lineageRootRef ?? 'riya.family.discovery.001',
    split: options.split ?? 'TRAIN',
    languageMode: options.languageMode ?? 'ENGLISH',
    primaryInteractionKind: options.primaryInteractionKind ?? 'DISCOVERY',
    secondaryInteractionKinds: [],
    persona: options.persona ?? 'EXPLORING',
    difficulty: options.difficulty ?? 'STANDARD',
    riskClass: risk,
    source:
      options.teacherRef === undefined
        ? {
            kind: 'HUMAN_AUTHORED_SYNTHETIC',
            sourceRef: options.sourceRef ?? 'author.alpha',
            synthetic: true,
          }
        : {
            kind: 'TEACHER_GENERATED_SYNTHETIC',
            sourceRef: options.sourceRef ?? 'teacher.alpha',
            synthetic: true,
            teacherRef: options.teacherRef,
          },
    initialState: options.initialState ?? emptyTrainingState(),
    turns: options.turns ?? discoveryTurns(),
    review: options.review ?? acceptedReviews(risk === 'HIGH_RISK' ? 2 : 1),
  });
}

/**
 * A release policy PINNED to whatever protected corpus a spec supplies.
 *
 * Built from the index rather than hand-written, because the whole point of the binding is that the
 * policy names the corpus that was actually used -- a spec that typed the digest by hand would be
 * asserting its own arithmetic rather than the gate.
 */
export function releasePolicyFor(
  protectedIndex: ProtectedTextIndex,
  options: { readonly minimumTotalTrajectories?: number } = {},
): RiyaDatasetReleasePolicyV1 {
  return createRiyaDatasetReleasePolicy({
    policyId: 'riya-dataset-release-v1',
    policyVersion: 1,
    coveragePolicy: createRiyaDatasetCoveragePolicy({
      policyId: 'riya-dataset-coverage-v1',
      policyVersion: 1,
      ...(options.minimumTotalTrajectories === undefined
        ? {}
        : { minimumTotalTrajectories: options.minimumTotalTrajectories }),
    }),
    protectedCorpusRef: 'protected.corpus.synthetic',
    protectedIndexSha256: protectedIndex.indexSha256,
    protectedEntryCount: protectedIndex.entryCount,
  });
}

/** A tiny synthetic protected corpus, so a spec can bind without touching the real exam. */
export function syntheticProtectedIndex(
  entries: readonly ProtectedTextEntry[] = [
    {
      protectedRef: 'protected.alpha.en.one.01',
      text: 'A protected synthetic evaluation sentence.',
    },
    {
      protectedRef: 'protected.alpha.en.two.01',
      text: 'A second protected synthetic evaluation sentence.',
    },
  ],
): ProtectedTextIndex {
  return createProtectedTextIndex(entries);
}

/** The bound options a releasable validation needs. */
export function releasableOptions(protectedIndex: ProtectedTextIndex = syntheticProtectedIndex()): {
  readonly protectedIndex: ProtectedTextIndex;
  readonly releasePolicy: RiyaDatasetReleasePolicyV1;
} {
  return { protectedIndex, releasePolicy: releasePolicyFor(protectedIndex) };
}
