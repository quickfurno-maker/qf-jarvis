/**
 * HGV1-A — Gold corpus matrix, provenance, progress and repetition metrics (ADR-0108).
 *
 * ### The provenance spec is the important one
 *
 * A `TEACHER_GENERATED_SYNTHETIC` trajectory does not count toward Human Gold, and nothing — not a
 * review, not an approval, not a helper — changes that. Provenance is a statement about who wrote the
 * words. A human clicking accept did not write them, and a dataset whose provenance field can be
 * talked into being wrong is a dataset nobody can reason about later.
 *
 * The corpus is exercised on a small synthetic analogue rather than the real 360, which does not
 * exist yet and is not generated here.
 */
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import { describe, expect, it } from 'vitest';

import { createRiyaDatasetCoveragePolicy } from '../contracts/coverage-policy.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import { createRiyaDatasetReleasePolicy } from '../contracts/release-policy.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import { createRiyaDatasetAssistantTurn, createRiyaDatasetUserTurn } from '../contracts/turns.js';
import type { RiyaDatasetTurnV1 } from '../contracts/turns.js';
import { createProtectedTextIndex } from '../internal/leakage.js';
import { createRiyaGoldV1Assignment } from '../gold-v1/contracts/assignment.js';
import type { RiyaGoldV1AssignmentV1 } from '../gold-v1/contracts/assignment.js';
import {
  createRiyaGoldV1Progress,
  summarizeRiyaGoldV1Progress,
} from '../gold-v1/contracts/progress.js';
import {
  buildRiyaGoldV1ReleasePolicy,
  RIYA_GOLD_V1_COVERAGE_POLICY,
  RIYA_GOLD_V1_PROTECTED_CORPUS_REF,
} from '../gold-v1/policy/gold-policy.js';
import { riyaGoldRepetitionMetrics } from '../gold-v1/service/repetition.js';
import { validateRiyaGoldV1Corpus } from '../gold-v1/service/validate-corpus.js';
import { acceptedReviews } from '../testing/fixtures.js';

const PROTECTED_INDEX = createProtectedTextIndex(
  RIYA_QUALITY_GOLDEN_FIXTURES.map((fixture) => ({
    protectedRef: fixture.fixtureId,
    text: fixture.syntheticUserText,
  })),
);

/**
 * Narrow one indexed access.
 *
 * `noUncheckedIndexedAccess` is on and the lint bans both `!` and a widening `as`, so a spec that
 * needs a definite element says so once, here, and fails loudly rather than silently passing
 * `undefined` into a constructor.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaDatasetError ? error.code : 'not-a-dataset-error';
  }
  return 'no-error';
};

/**
 * A tiny two-slot Gold analogue.
 *
 * The real 360 is authored by humans in the next PR. What the validator needs to be tested against is
 * the MATRIX behaviour, and two slots exercise every branch of it.
 */
const TINY_ASSIGNMENTS: readonly RiyaGoldV1AssignmentV1[] = Object.freeze([
  createRiyaGoldV1Assignment({
    version: 1,
    assignmentId: 'gold.v1.w1.en.discovery.01',
    wave: 1,
    ordinalWithinPair: 1,
    split: 'TRAIN',
    languageMode: 'ENGLISH',
    primaryInteractionKind: 'DISCOVERY',
    requiredSecondaryKinds: [],
    persona: 'EXPLORING',
    difficulty: 'BASIC',
    riskClass: 'STANDARD',
    startPhase: 'INTRO',
    targetAssistantTurns: 4,
    authoringBriefRef: 'brief.gold.v1.w1.en.discovery.01',
    requiredAuthorityFactClasses: [],
    forbiddenPatterns: ['CANNED_OPENER'],
  }),
  createRiyaGoldV1Assignment({
    version: 1,
    assignmentId: 'gold.v1.w1.en.discovery.02',
    wave: 1,
    ordinalWithinPair: 2,
    split: 'TRAIN',
    languageMode: 'ENGLISH',
    primaryInteractionKind: 'DISCOVERY',
    requiredSecondaryKinds: [],
    persona: 'BUSY_SHORT_REPLY',
    difficulty: 'STANDARD',
    riskClass: 'STANDARD',
    startPhase: 'NEED',
    targetAssistantTurns: 4,
    authoringBriefRef: 'brief.gold.v1.w1.en.discovery.02',
    requiredAuthorityFactClasses: [],
    forbiddenPatterns: ['CANNED_OPENER'],
  }),
]);

/**
 * The three follow-up exchanges of each analogue conversation, written twice, independently.
 *
 * Splicing one template with a per-trajectory token was the obvious shortcut and it produced exactly
 * the artefact these specs measure: the same opener and the same closer in every reply, differing
 * only in the middle. Two separately written scripts keep the repetition numbers honest.
 */
const FILLER: Readonly<Record<1 | 2, readonly (readonly [string, string])[]>> = Object.freeze({
  1: [
    [
      'Nothing is fixed yet, we are still comparing a few options.',
      'Comparing is sensible at this stage. Which room would you want done first?',
    ],
    [
      'Probably the kitchen, since we cook every single day.',
      'Kitchens are usually where the constraints show up. Any date you are working back from?',
    ],
    [
      'Sometime after the handover paperwork clears.',
      'Understood, I will treat the timing as open for now.',
    ],
  ],
  2: [
    [
      'We have not decided anything at all yet, honestly.',
      'That is fine, nothing needs deciding today. What is the space like right now?',
    ],
    [
      'Two bedrooms, both empty, and the place is rented.',
      'Rented changes what makes sense to build in. Do you know how long you will stay?',
    ],
    [
      'At least two years, possibly a fair bit longer.',
      'Good to know. I will keep the suggestions removable rather than fixed.',
    ],
  ],
});

/**
 * Four assistant turns, which is the shallowest depth the Gold plan allows.
 *
 * The RID-F1 fixture exchange is two turns, which would read as a three-turn depth deviation against
 * every Gold slot, so the analogue builds its own.
 */
function goldTurns(
  variant: 1 | 2,
  userText: string,
  replyText: string,
): readonly RiyaDatasetTurnV1[] {
  const reply = (turnRef: string, text: string) =>
    createRiyaDatasetAssistantTurn({
      type: 'ASSISTANT',
      turnRef,
      text,
      annotation: {
        decision: 'ASK_DISCOVERY',
        askedDiscoveryFields: [],
        supportedFactRefs: [],
        responseObjective: 'DISCOVER',
      },
    });
  const rest = FILLER[variant].flatMap(([ask, answer], index) => [
    createRiyaDatasetUserTurn({
      type: 'USER',
      turnRef: `u${String(index + 2)}`,
      text: ask,
    }),
    reply(`a${String(index + 2)}`, answer),
  ]);
  return Object.freeze([
    createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: userText }),
    reply('a1', replyText),
    ...rest,
  ]);
}

/** A Gold-shaped trajectory fulfilling one slot. Human-authored by declaration, as Gold requires. */
function goldTrajectory(
  assignment: RiyaGoldV1AssignmentV1,
  overrides: {
    readonly userText?: string;
    readonly replyText?: string;
    readonly sourceKind?: 'HUMAN_AUTHORED_SYNTHETIC' | 'TEACHER_GENERATED_SYNTHETIC';
    readonly persona?: RiyaGoldV1AssignmentV1['persona'];
    readonly split?: RiyaGoldV1AssignmentV1['split'];
    readonly languageMode?: RiyaGoldV1AssignmentV1['languageMode'];
  } = {},
): RiyaIntelligenceTrajectoryV1 {
  const kind = overrides.sourceKind ?? 'HUMAN_AUTHORED_SYNTHETIC';
  return createRiyaIntelligenceTrajectory({
    version: 1,
    trajectoryId: assignment.assignmentId,
    trajectoryRevision: 1,
    lineageRootRef: `family.${assignment.assignmentId}`,
    split: overrides.split ?? assignment.split,
    languageMode: overrides.languageMode ?? assignment.languageMode,
    primaryInteractionKind: assignment.primaryInteractionKind,
    secondaryInteractionKinds: [],
    persona: overrides.persona ?? assignment.persona,
    difficulty: assignment.difficulty,
    riskClass: assignment.riskClass,
    source: {
      kind,
      sourceRef: 'author.a01',
      synthetic: true,
      ...(kind === 'TEACHER_GENERATED_SYNTHETIC' ? { teacherRef: 'teacher.t01' } : {}),
    },
    initialState: {
      phase: assignment.startPhase,
      discovery: {},
      fieldProvenance: {},
      summaryConfirmed: false,
    },
    turns: goldTurns(
      assignment.ordinalWithinPair,
      overrides.userText ?? 'We just got the flat and want work done in city.alpha.',
      overrides.replyText ?? 'Congratulations on the handover. What are you hoping to start with?',
    ),
    review: acceptedReviews(1, { refs: ['reviewer.r01'] }),
  });
}

const tinyCorpus = () => [
  goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
    userText: 'We just got the flat and want the kitchen done in city.alpha.',
    replyText: 'Congratulations on the handover. What budget range are you working with?',
  }),
  goldTrajectory(must(TINY_ASSIGNMENTS[1], 'assignment 1'), {
    userText: 'Looking at wardrobes for a rented place in city.beta before we move in.',
    replyText: 'Understood, wardrobes only for now. Roughly when do you need it done?',
  }),
];

/**
 * The analogue's release policy: the REAL protected pin, a two-slot coverage bar.
 *
 * The real Gold policy demands 360 and a two-slot corpus can never satisfy it — which is the correct
 * behaviour and is asserted directly against the policy below. What these specs exercise is the
 * MATRIX, so coverage is scaled down and the exam pin, which is the part that must never be relaxed,
 * is the real one.
 */
const releaseOptions = () => ({
  protectedIndex: PROTECTED_INDEX,
  releasePolicy: createRiyaDatasetReleasePolicy({
    policyId: 'riya-gold-v1-matrix-analogue',
    policyVersion: 1,
    coveragePolicy: createRiyaDatasetCoveragePolicy({
      policyId: 'riya-gold-v1-matrix-analogue-coverage',
      policyVersion: 1,
      minimumTotalTrajectories: 2,
      minimumByLanguage: { ENGLISH: 1 },
      minimumByPrimaryInteraction: { DISCOVERY: 1 },
    }),
    protectedCorpusRef: RIYA_GOLD_V1_PROTECTED_CORPUS_REF,
    protectedIndexSha256: PROTECTED_INDEX.indexSha256,
    protectedEntryCount: PROTECTED_INDEX.entryCount,
  }),
});

// ---------------------------------------------------------------------------
// 1. The Gold policies.
// ---------------------------------------------------------------------------

describe('the Gold V1 policies carry the target, and pin the real exam corpus', () => {
  it('the coverage policy is 360, 120 per language, 30 per interaction', () => {
    expect(RIYA_GOLD_V1_COVERAGE_POLICY.policyId).toBe('riya-gold-v1-coverage');
    expect(RIYA_GOLD_V1_COVERAGE_POLICY.minimumTotalTrajectories).toBe(360);
    expect({ ...RIYA_GOLD_V1_COVERAGE_POLICY.minimumByLanguage }).toStrictEqual({
      ENGLISH: 120,
      HINDI: 120,
      HINGLISH: 120,
    });
    expect(
      Object.values(RIYA_GOLD_V1_COVERAGE_POLICY.minimumByPrimaryInteraction).every(
        (value) => value === 30,
      ),
    ).toBe(true);
    // Diversity floors, deliberately not summing to 360.
    const personaFloors = Object.values(RIYA_GOLD_V1_COVERAGE_POLICY.minimumByPersona);
    expect(personaFloors).toHaveLength(8);
    expect(personaFloors.reduce((a, b) => a + b, 0)).toBeLessThan(360);
  });

  it('the release policy pins the REAL protected corpus by count and digest', () => {
    const policy = buildRiyaGoldV1ReleasePolicy(PROTECTED_INDEX);
    expect(policy.protectedCorpusRef).toBe(RIYA_GOLD_V1_PROTECTED_CORPUS_REF);
    expect(policy.protectedEntryCount).toBe(PROTECTED_INDEX.entryCount);
    expect(policy.protectedIndexSha256).toBe(PROTECTED_INDEX.indexSha256);
    expect(policy.protectedIndexSha256).toMatch(/^[0-9a-f]{64}$/u);
    // Derived from the corpus, never transcribed. No fixture id or text is in production source.
    expect(policy.protectedCorpusRef.startsWith('riya.p10.')).toBe(false);
  });

  it('the REAL Gold policy refuses a corpus that is not yet 360', () => {
    // The bar is not decorative. Until the waves are authored, the real policy says no.
    const report = validateRiyaGoldV1Corpus(tinyCorpus(), TINY_ASSIGNMENTS, {
      protectedIndex: PROTECTED_INDEX,
      releasePolicy: buildRiyaGoldV1ReleasePolicy(PROTECTED_INDEX),
    });
    expect(report.datasetReport.coverageShortfalls.length).toBeGreaterThan(0);
    expect(report.datasetReport.eligible).toBe(false);
    expect(report.goldEligible).toBe(false);
    // And the matrix itself is clean: it is coverage, and only coverage, that refuses.
    expect(report.findings).toStrictEqual([]);
  });

  it('a partial or wrong protected index cannot satisfy the Gold policy', () => {
    const partial = createProtectedTextIndex(
      RIYA_QUALITY_GOLDEN_FIXTURES.slice(0, 10).map((fixture) => ({
        protectedRef: fixture.fixtureId,
        text: fixture.syntheticUserText,
      })),
    );
    const report = validateRiyaGoldV1Corpus(tinyCorpus(), TINY_ASSIGNMENTS, {
      protectedIndex: partial,
      releasePolicy: buildRiyaGoldV1ReleasePolicy(PROTECTED_INDEX),
    });
    expect(report.datasetReport.releaseBindingFailures.length).toBeGreaterThan(0);
    expect(report.goldEligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The corpus matrix.
// ---------------------------------------------------------------------------

describe('a Gold corpus must match the plan it was written against', () => {
  it('a valid small analogue passes both the RID-F1 gate and the matrix', () => {
    const report = validateRiyaGoldV1Corpus(tinyCorpus(), TINY_ASSIGNMENTS, releaseOptions());
    expect(report.findings).toStrictEqual([]);
    expect(report.datasetReport.eligible).toBe(true);
    expect(report.matchedAssignments).toBe(2);
    expect(report.goldEligible).toBe(true);
  });

  it.each([
    ['a wrong split', { split: 'VALIDATION' as const }, 'SPLIT_MISMATCH'],
    ['a wrong language', { languageMode: 'HINDI' as const }, 'LANGUAGE_MISMATCH'],
    ['a wrong persona', { persona: 'FRUSTRATED' as const }, 'PERSONA_MISMATCH'],
  ])('%s fails the matrix', (_name, override, reason) => {
    const corpus = [
      goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
        userText: 'We just got the flat and want the kitchen done in city.alpha.',
        ...override,
      }),
      must(tinyCorpus()[1], 'trajectory 1'),
    ];
    const report = validateRiyaGoldV1Corpus(corpus, TINY_ASSIGNMENTS, releaseOptions());
    expect(report.findings.some((one) => one.reason === reason)).toBe(true);
    expect(report.goldEligible).toBe(false);
  });

  it('an unfulfilled assignment fails', () => {
    const report = validateRiyaGoldV1Corpus(
      [must(tinyCorpus()[0], 'trajectory 0')],
      TINY_ASSIGNMENTS,
      releaseOptions(),
    );
    expect(report.findings.some((one) => one.reason === 'ASSIGNMENT_UNFULFILLED')).toBe(true);
    expect(report.goldEligible).toBe(false);
  });

  it('an extra trajectory with no assignment fails', () => {
    const extra = createRiyaIntelligenceTrajectory({
      ...must(tinyCorpus()[0], 'trajectory 0'),
      trajectoryId: 'gold.v1.w1.en.discovery.99',
      lineageRootRef: 'family.extra',
      turns: goldTurns(
        1,
        'A different opening, about painting an older flat in city.gamma.',
        'Painting an older place has its own sequence. Is anyone living there now?',
      ),
    });
    const report = validateRiyaGoldV1Corpus(
      [...tinyCorpus(), extra],
      TINY_ASSIGNMENTS,
      releaseOptions(),
    );
    expect(report.findings.some((one) => one.reason === 'TRAJECTORY_WITHOUT_ASSIGNMENT')).toBe(
      true,
    );
  });

  it('a TEACHER-generated trajectory does not count toward Human Gold', () => {
    // The provenance rule, enforced. Nothing about a review or an approval changes who wrote it.
    const corpus = [
      goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
        userText: 'We just got the flat and want the kitchen done in city.alpha.',
        sourceKind: 'TEACHER_GENERATED_SYNTHETIC',
      }),
      must(tinyCorpus()[1], 'trajectory 1'),
    ];
    const report = validateRiyaGoldV1Corpus(corpus, TINY_ASSIGNMENTS, releaseOptions());
    expect(report.findings.some((one) => one.reason === 'NOT_HUMAN_AUTHORED')).toBe(true);
    expect(report.goldEligible).toBe(false);
    // And the underlying dataset is perfectly valid — it is Gold membership that is refused.
    expect(report.datasetReport.eligible).toBe(true);
  });

  it('accepting a teacher trajectory does NOT reclassify it', () => {
    const teacher = goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
      userText: 'We just got the flat and want the kitchen done in city.alpha.',
      sourceKind: 'TEACHER_GENERATED_SYNTHETIC',
    });
    // Two accepted reviews, the strongest approval the system has.
    const heavilyReviewed = createRiyaIntelligenceTrajectory({
      ...teacher,
      review: acceptedReviews(2, { refs: ['reviewer.r01', 'reviewer.r02'] }),
    });
    expect(heavilyReviewed.source.kind).toBe('TEACHER_GENERATED_SYNTHETIC');
    const report = validateRiyaGoldV1Corpus(
      [heavilyReviewed, must(tinyCorpus()[1], 'trajectory 1')],
      TINY_ASSIGNMENTS,
      releaseOptions(),
    );
    expect(report.findings.some((one) => one.reason === 'NOT_HUMAN_AUTHORED')).toBe(true);
  });

  it('a RID-F1 ineligibility fails Gold even when the matrix is perfect', () => {
    const leaking = goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
      userText: RIYA_QUALITY_GOLDEN_FIXTURES[0]?.syntheticUserText ?? 'x',
    });
    const report = validateRiyaGoldV1Corpus(
      [leaking, must(tinyCorpus()[1], 'trajectory 1')],
      TINY_ASSIGNMENTS,
      releaseOptions(),
    );
    // The exam leaked. The matrix is fine and that does not matter.
    expect(report.datasetReport.protectedExactLeakage.length).toBeGreaterThan(0);
    expect(report.findings).toStrictEqual([]);
    expect(report.goldEligible).toBe(false);
  });

  it('a depth deviation beyond one turn is reported', () => {
    const deep = createRiyaGoldV1Assignment({
      ...must(TINY_ASSIGNMENTS[0], 'assignment 0'),
      targetAssistantTurns: 10,
    });
    const report = validateRiyaGoldV1Corpus(
      tinyCorpus(),
      [deep, must(TINY_ASSIGNMENTS[1], 'assignment 1')],
      releaseOptions(),
    );
    expect(report.findings.some((one) => one.reason === 'DEPTH_DEVIATION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Repetition metrics.
// ---------------------------------------------------------------------------

describe('formula degeneration is measured, and reported rather than guessed at', () => {
  it('counts unique replies and exact repeats', () => {
    const metrics = riyaGoldRepetitionMetrics(tinyCorpus());
    expect(metrics.totalAssistantReplies).toBe(8);
    expect(metrics.uniqueNormalizedReplies).toBe(8);
    expect(metrics.exactRepeatedReplyCount).toBe(0);
    expect(metrics.repeatedOpeningPrefixCount).toBe(0);
  });

  it('a copy-pasted reply shows up as an exact repeat', () => {
    const same = 'Congratulations on the handover. What budget range are you working with?';
    const corpus = [
      goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
        userText: 'First opening about a kitchen in city.alpha.',
        replyText: same,
      }),
      goldTrajectory(must(TINY_ASSIGNMENTS[1], 'assignment 1'), {
        userText: 'Second and quite different opening about wardrobes in city.beta.',
        replyText: same,
      }),
    ];
    const metrics = riyaGoldRepetitionMetrics(corpus);
    expect(metrics.exactRepeatedReplyCount).toBe(1);
    expect(metrics.uniqueNormalizedReplies).toBe(7);
    expect(metrics.repeatedOpeningPrefixCount).toBe(1);
    expect(metrics.topOpeningPrefixes[0]?.count).toBe(2);
  });

  it('short acknowledgements do NOT count as a repeated opener', () => {
    // A metric that flagged "Sure." recurring is a metric everybody ignores.
    const corpus = [
      goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
        userText: 'First opening about a kitchen in city.alpha.',
        replyText: 'Sure.',
      }),
      goldTrajectory(must(TINY_ASSIGNMENTS[1], 'assignment 1'), {
        userText: 'Second and quite different opening about wardrobes in city.beta.',
        replyText: 'Understood.',
      }),
    ];
    const metrics = riyaGoldRepetitionMetrics(corpus);
    expect(metrics.repeatedOpeningPrefixCount).toBe(0);
    expect(metrics.topOpeningPrefixes).toStrictEqual([]);
  });

  it('is REPORT-ONLY: metrics alone never make a corpus ineligible', () => {
    // The V1 threshold is set by Wave-1 calibration against real content, not guessed here.
    const same = 'Congratulations on the handover. What budget range are you working with?';
    const corpus = [
      goldTrajectory(must(TINY_ASSIGNMENTS[0], 'assignment 0'), {
        userText: 'First opening about a kitchen in city.alpha.',
        replyText: same,
      }),
      goldTrajectory(must(TINY_ASSIGNMENTS[1], 'assignment 1'), {
        userText: 'Second and quite different opening about wardrobes in city.beta.',
        replyText: same,
      }),
    ];
    const report = validateRiyaGoldV1Corpus(corpus, TINY_ASSIGNMENTS, releaseOptions());
    expect(report.repetition.exactRepeatedReplyCount).toBe(1);
    expect(report.goldEligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Progress.
// ---------------------------------------------------------------------------

describe('the progress board is workflow metadata and nothing else', () => {
  const record = (
    assignmentId: string,
    status: 'NOT_STARTED' | 'DRAFTING' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'REJECTED',
    reviewCount = 0,
  ) =>
    createRiyaGoldV1Progress({
      version: 1,
      assignmentId,
      status,
      ...(status === 'NOT_STARTED' ? {} : { trajectoryId: assignmentId }),
      ...(status === 'NOT_STARTED' ? {} : { authorRef: 'author.a01' }),
      reviewCount,
      lastRevision: status === 'NOT_STARTED' ? 0 : 1,
    });

  it('summarizes deterministically, with no content', () => {
    const summary = summarizeRiyaGoldV1Progress(
      [
        record('gold.v1.w1.en.discovery.01', 'ACCEPTED', 1),
        record('gold.v1.w1.hi.objection-price.02', 'READY_FOR_REVIEW', 1),
        record('gold.v1.w1.hinglish.next-step.01', 'NOT_STARTED'),
        record('gold.v1.w2.en.correction.01', 'REJECTED', 1),
      ],
      new Set(['gold.v1.w1.hi.objection-price.02']),
    );
    expect(summary.total).toBe(4);
    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.byStatus.NOT_STARTED).toBe(1);
    expect(summary.byWave['w1']).toBe(3);
    expect(summary.byWave['w2']).toBe(1);
    expect(summary.acceptedByLanguage['en']).toBe(1);
    expect(summary.acceptedByInteraction['discovery']).toBe(1);
    // The number worth watching during a wave: high-risk slots stall here.
    expect(summary.highRiskAwaitingSecondReview).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('kitchen');
  });

  it('refuses a record with dialogue, a reviewer name or an inconsistent state', () => {
    for (const extra of [
      { replyText: 'Sure, happy to help.' },
      { reviewerName: 'a real person' },
      { notes: 'looked fine' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaGoldV1Progress({
            version: 1,
            assignmentId: 'gold.v1.w1.en.discovery.01',
            status: 'DRAFTING',
            trajectoryId: 'gold.v1.w1.en.discovery.01',
            reviewCount: 0,
            lastRevision: 1,
            ...extra,
          } as never),
        ),
        JSON.stringify(extra),
      ).toBe('invalid-gold-progress');
    }
    // Drafting with nothing drafted, and accepted with nobody having reviewed.
    expect(
      codeOf(() =>
        createRiyaGoldV1Progress({
          version: 1,
          assignmentId: 'gold.v1.w1.en.discovery.01',
          status: 'DRAFTING',
          reviewCount: 0,
          lastRevision: 1,
        }),
      ),
    ).toBe('invalid-gold-progress');
    expect(
      codeOf(() =>
        createRiyaGoldV1Progress({
          version: 1,
          assignmentId: 'gold.v1.w1.en.discovery.01',
          status: 'ACCEPTED',
          trajectoryId: 'gold.v1.w1.en.discovery.01',
          reviewCount: 0,
          lastRevision: 1,
        }),
      ),
    ).toBe('invalid-gold-progress');
  });
});
