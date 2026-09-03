/**
 * The automated acceptance gate (AS1, ADR-0143).
 *
 * Every hard blocker gets a spec that proves it BLOCKS, and the clean corpus gets one that proves it
 * passes. A gate nobody has watched refuse something is a gate nobody knows is wired up.
 */
import { describe, expect, it } from 'vitest';

import {
  createRiyaAiSyntheticAcceptancePolicy,
  createRiyaAiSyntheticGenerationProvenance,
  createRiyaAiSyntheticScenario,
  createRiyaAiSyntheticTrajectoryAcceptanceEvidence,
  createRiyaAiSyntheticReleaseEvidence,
  riyaAiSyntheticProvenanceSha256,
  riyaAiSyntheticScenarioSha256,
  validateRiyaAiSyntheticCorpus,
} from '../ai-synthetic/index.js';
import type {
  RiyaAiSyntheticAcceptancePolicyV1,
  RiyaAiSyntheticFindingKind,
} from '../ai-synthetic/index.js';
import { createRiyaDatasetAssistantTurn, createRiyaDatasetUserTurn } from '../contracts/turns.js';
import type { RiyaDatasetTurnV1 } from '../contracts/turns.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';
import { validateRiyaIntelligenceDataset } from '../service/validate-dataset.js';
import { buildRiyaIntelligenceDatasetManifest } from '../service/create-manifest.js';
import {
  SYNTHETIC_DATASET_INSTANT,
  acceptedReviews,
  emptyTrainingState,
  releasePolicyFor,
  syntheticProtectedIndex,
  syntheticTrajectory,
} from '../testing/fixtures.js';

const PROTECTED = syntheticProtectedIndex();

/**
 * Index into a fixture array and PROVE the element exists.
 *
 * `noUncheckedIndexedAccess` types every index read as `T | undefined`, and a `!` silences that by
 * assertion rather than by proof. Throwing keeps the spec honest — a helper that returned a stub
 * would quietly turn a broken fixture into a passing test.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`fixture element ${String(index)} is missing`);
  }
  return item;
}

/** Four assistant turns, varied decisions and objectives, seeded so fingerprints differ. */
function turnsFor(seed: string): readonly RiyaDatasetTurnV1[] {
  const plan = [
    { decision: 'ASK_DISCOVERY', objective: 'DISCOVER', asked: ['budget'], phase: 'NEED' },
    { decision: 'ANSWER_DIRECT', objective: 'ANSWER', asked: [], phase: 'PROJECT_DETAILS' },
    {
      decision: 'ASK_DISCOVERY',
      objective: 'DISCOVER',
      asked: ['timeline'],
      phase: 'BUDGET_TIMELINE',
    },
    { decision: 'ANSWER_DIRECT', objective: 'ADVANCE_NEXT_STEP', asked: [], phase: 'SUMMARY' },
  ] as const;
  const turns: RiyaDatasetTurnV1[] = [];
  plan.forEach((step, index) => {
    turns.push(
      createRiyaDatasetUserTurn({
        type: 'USER',
        turnRef: `u${String(index)}`,
        text: `${seed} customer says something about the project at step ${String(index)} here.`,
      }),
    );
    turns.push(
      createRiyaDatasetAssistantTurn({
        type: 'ASSISTANT',
        turnRef: `a${String(index)}`,
        text: `${seed} assistant replies about the next part of the plan at step ${String(index)}.`,
        annotation: {
          decision: step.decision,
          askedDiscoveryFields: [...step.asked],
          supportedFactRefs: [],
          expectedPhaseAfter: step.phase,
          responseObjective: step.objective,
        },
      }),
    );
  });
  return Object.freeze(turns);
}

function teacherTrajectory(
  seed: string,
  overrides: { readonly lineageRootRef?: string; readonly teacherRef?: string } = {},
): RiyaIntelligenceTrajectoryV1 {
  return createRiyaIntelligenceTrajectory({
    version: 1,
    trajectoryId: `riya.ai.${seed}`,
    trajectoryRevision: 1,
    lineageRootRef: overrides.lineageRootRef ?? `riya.family.${seed}`,
    split: 'TRAIN',
    languageMode: 'ENGLISH',
    primaryInteractionKind: 'DISCOVERY',
    secondaryInteractionKinds: [],
    persona: 'EXPLORING',
    difficulty: 'STANDARD',
    riskClass: 'STANDARD',
    source: {
      kind: 'TEACHER_GENERATED_SYNTHETIC',
      sourceRef: 'teacher.alpha',
      synthetic: true,
      teacherRef: overrides.teacherRef ?? `gen.${seed}`,
    },
    initialState: emptyTrainingState(),
    turns: turnsFor(seed),
    review: [],
  });
}

function scenarioFor(seed: string, lineageRootRef?: string) {
  return createRiyaAiSyntheticScenario({
    scenarioRef: `scn.${seed}`,
    lineageRootRef: lineageRootRef ?? `riya.family.${seed}`,
    split: 'TRAIN',
    languageMode: 'ENGLISH',
    primaryInteractionKind: 'DISCOVERY',
    secondaryInteractionKinds: [],
    persona: 'EXPLORING',
    difficulty: 'STANDARD',
    riskClass: 'STANDARD',
    startPhase: 'NEED',
    targetAssistantTurns: 4,
    plannedDiscoveryFields: ['budget', 'timeline'],
    plannedCustomerFacts: [{ field: 'location', value: 'city.alpha' }],
    requiredAuthorityFactClasses: [],
    requiredAssistantDecisions: ['ASK_DISCOVERY'],
    requiredResponseObjectives: ['DISCOVER'],
    customerBehaviorCodes: ['SHORT_REPLY', 'UNCERTAINTY'],
    requiredConversationEvents: ['ASK_ONE_DISCOVERY_QUESTION', 'CAPTURE_NEW_FACT'],
    forbiddenBehaviors: ['CANNED_OPENER'],
  });
}

function provenanceFor(seed: string, scenarioSha: string) {
  return createRiyaAiSyntheticGenerationProvenance({
    generationRef: `gen.${seed}`,
    scenarioRef: `scn.${seed}`,
    scenarioSha256: scenarioSha,
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.simulator',
    riyaTeacherConfigRef: 'cfg.teacher',
    annotationVerifierConfigRef: 'cfg.verifier',
  });
}

const CRITICS = [
  {
    criticRef: 'critic.one',
    criticConfigRef: 'cfg.critic.one',
    criticModelFamilyRef: 'family.one',
    decision: 'ACCEPTED' as const,
    satisfiedQualityDimensions: [
      'CLARITY',
      'NATURALNESS',
      'CONTEXT_USE',
      'NON_REPETITION',
    ] as const,
  },
  {
    criticRef: 'critic.two',
    criticConfigRef: 'cfg.critic.two',
    criticModelFamilyRef: 'family.two',
    decision: 'ACCEPTED' as const,
    satisfiedQualityDimensions: [
      'CLARITY',
      'NATURALNESS',
      'CONTEXT_USE',
      'NON_REPETITION',
    ] as const,
  },
];

function policy(
  overrides: {
    readonly diversity?: Partial<
      Parameters<typeof createRiyaAiSyntheticAcceptancePolicy>[0]['diversityPolicy']
    >;
    readonly critic?: Partial<
      Parameters<typeof createRiyaAiSyntheticAcceptancePolicy>[0]['criticPolicy']
    >;
  } = {},
): RiyaAiSyntheticAcceptancePolicyV1 {
  return createRiyaAiSyntheticAcceptancePolicy({
    policyId: 'riya-ai-synthetic-acceptance-v1',
    policyVersion: 1,
    baseReleasePolicy: releasePolicyFor(PROTECTED, { minimumTotalTrajectories: 1 }),
    criticPolicy: {
      minAcceptedCritics: 2,
      requiredQualityDimensions: ['CLARITY', 'NATURALNESS', 'CONTEXT_USE', 'NON_REPETITION'],
      requireCriticConfigDistinctFromGeneration: true,
      requireDistinctCriticConfigs: true,
      requireDistinctCriticModelFamilies: false,
      ...overrides.critic,
    },
    diversityPolicy: {
      minFingerprintUniquenessBp: 10_000,
      maxOpenerRecurrenceBp: 10_000,
      maxCloserRecurrenceBp: 10_000,
      maxQuestionSequenceRecurrenceBp: 10_000,
      maxPhaseSequenceRecurrenceBp: 10_000,
      maxVariantsPerLineage: 4,
      maxSameLineageNearDuplicateBp: 10_000,
      minDepthBandsCovered: 1,
      minDecisionsCovered: 1,
      minObjectivesCovered: 1,
      ...overrides.diversity,
    },
    assistantTurnTolerance: 1,
  });
}

/** A clean, eligible corpus: two teacher rows, each with a matching scenario and two critics. */
function cleanCorpus(seeds: readonly string[] = ['alpha', 'beta']) {
  const trajectories = seeds.map((seed) => teacherTrajectory(seed));
  const scenarios = seeds.map((seed) => scenarioFor(seed));
  const provenances = seeds.map((seed, index) =>
    provenanceFor(seed, riyaAiSyntheticScenarioSha256(at(scenarios, index))),
  );
  const evidence = seeds.map((seed, index) =>
    createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      trajectoryId: `riya.ai.${seed}`,
      trajectoryArtifactSha256: trajectoryArtifactSha256(at(trajectories, index)),
      conversationFingerprint: trajectoryConversationFingerprint(at(trajectories, index)),
      scenarioRef: `scn.${seed}`,
      scenarioSha256: riyaAiSyntheticScenarioSha256(at(scenarios, index)),
      generationRef: `gen.${seed}`,
      provenanceSha256: riyaAiSyntheticProvenanceSha256(at(provenances, index)),
      criticVerdicts: CRITICS.map((critic) => ({
        ...critic,
        satisfiedQualityDimensions: [...critic.satisfiedQualityDimensions],
      })),
    }),
  );
  return { trajectories, scenarios, provenances, evidence };
}

const run = (
  parts: ReturnType<typeof cleanCorpus>,
  acceptancePolicy: RiyaAiSyntheticAcceptancePolicyV1 = policy(),
) =>
  validateRiyaAiSyntheticCorpus({
    ...parts,
    policy: acceptancePolicy,
    protectedIndex: PROTECTED,
  });

const kinds = (result: ReturnType<typeof run>): readonly RiyaAiSyntheticFindingKind[] =>
  result.report.findings.map((one) => one.kind);

// ---------------------------------------------------------------------------
// The clean path.
// ---------------------------------------------------------------------------

describe('a clean teacher-only corpus is eligible under automated acceptance', () => {
  it('passes with no findings', () => {
    const result = run(cleanCorpus());

    expect(result.report.findings).toStrictEqual([]);
    expect(result.report.eligible).toBe(true);
    expect(result.report.acceptedEvidenceCount).toBe(2);
    expect(result.report.reviewMode).toBe('AUTOMATED_SYNTHETIC');
  });

  it('is eligible even though the GENERIC report is not', () => {
    // The base report is right to refuse: there are no human reviews. The automated report reaches a
    // different verdict under a different policy, and both artifacts keep their own meaning.
    const result = run(cleanCorpus());

    expect(result.baseReport.insufficientReview.length).toBe(2);
    expect(result.baseReport.eligible).toBe(false);
    expect(result.report.eligible).toBe(true);
  });

  it('issues release evidence with trainingApproval false and its own review mode', () => {
    const parts = cleanCorpus();
    const result = run(parts);
    const manifest = buildRiyaIntelligenceDatasetManifest({
      datasetId: 'riya.ai.synthetic',
      datasetVersion: 1,
      policyVersion: 1,
      trajectories: parts.trajectories,
      createdAt: SYNTHETIC_DATASET_INSTANT,
    });

    const issued = createRiyaAiSyntheticReleaseEvidence({ report: result.report, manifest });

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.evidence.trainingApproval).toBe(false);
    expect(issued.evidence.syntheticOnly).toBe(true);
    expect(issued.evidence.reviewMode).toBe('AUTOMATED_SYNTHETIC');
    // A different identity from the human lane's `rid.` prefix, readable in a log line months later.
    expect(issued.evidence.datasetRef.startsWith('ras.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The policy boundary.
// ---------------------------------------------------------------------------

describe('the acceptance policy is re-proved at the boundary', () => {
  it('refuses a policy that never went through the constructor', () => {
    // The type says `AUTOMATED_SYNTHETIC`, but a cast can say anything. Deep re-proof is what makes
    // the review mode an enforced fact: the constructor ASSIGNS the literal rather than accepting
    // one, so a hand-assembled policy claiming HUMAN_REVIEW cannot survive this call.
    const forged = {
      ...policy(),
      reviewMode: 'HUMAN_REVIEW',
      assistantTurnTolerance: 99,
    } as unknown as RiyaAiSyntheticAcceptancePolicyV1;

    expect(() =>
      validateRiyaAiSyntheticCorpus({
        ...cleanCorpus(),
        policy: forged,
        protectedIndex: PROTECTED,
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('re-proves a legitimate policy without altering the verdict', () => {
    const result = run(cleanCorpus());

    expect(result.report.reviewMode).toBe('AUTOMATED_SYNTHETIC');
    expect(result.report.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provenance and source.
// ---------------------------------------------------------------------------

describe('only a teacher-generated corpus may use automated acceptance', () => {
  it('blocks a human-authored row, and re-raises the human-review blocker', () => {
    const parts = cleanCorpus();
    const human = syntheticTrajectory({ trajectoryId: 'riya.ai.human', review: [] });
    const result = run({ ...parts, trajectories: [...parts.trajectories, human] });

    expect(kinds(result)).toContain('SOURCE_NOT_TEACHER_GENERATED');
    // The bypass is a reward for proving the alternative. Unproven, the generic blocker returns.
    expect(kinds(result)).toContain('BASE_VALIDATION_BLOCKED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a mixed-source corpus', () => {
    const parts = cleanCorpus();
    const human = syntheticTrajectory({
      trajectoryId: 'riya.ai.mixed',
      review: acceptedReviews(1),
    });
    const result = run({ ...parts, trajectories: [...parts.trajectories, human] });

    expect(kinds(result)).toContain('SOURCE_NOT_TEACHER_GENERATED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a teacher row carrying review records', () => {
    // No fabricated ACCEPTED reviews. A teacher row with reviews is claiming a human looked.
    const parts = cleanCorpus();
    const withReviews = createRiyaIntelligenceTrajectory({
      ...at(parts.trajectories, 0),
      review: [...acceptedReviews(1)],
    });
    const result = run({ ...parts, trajectories: [withReviews, at(parts.trajectories, 1)] });

    expect(kinds(result)).toContain('REVIEW_RECORDS_PRESENT');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks when teacherRef does not equal the evidence generationRef', () => {
    const parts = cleanCorpus();
    const drifted = teacherTrajectory('alpha', { teacherRef: 'gen.somethingelse' });
    const result = run({ ...parts, trajectories: [drifted, at(parts.trajectories, 1)] });

    expect(kinds(result)).toContain('TEACHER_REF_NOT_BOUND_TO_GENERATION');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evidence binding.
// ---------------------------------------------------------------------------

describe('acceptance evidence is bound to content, not to an id', () => {
  it('blocks a missing evidence record', () => {
    const parts = cleanCorpus();
    const result = run({ ...parts, evidence: [at(parts.evidence, 0)] });

    expect(kinds(result)).toContain('EVIDENCE_MISSING');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks evidence for a trajectory that is not in the corpus', () => {
    const parts = cleanCorpus();
    const orphan = cleanCorpus(['gamma']);
    const result = run({ ...parts, evidence: [...parts.evidence, at(orphan.evidence, 0)] });

    expect(kinds(result)).toContain('EVIDENCE_UNMATCHED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks duplicate evidence for one trajectory', () => {
    const parts = cleanCorpus();
    const result = run({ ...parts, evidence: [...parts.evidence, at(parts.evidence, 0)] });

    expect(kinds(result)).toContain('EVIDENCE_DUPLICATED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks when the trajectory digest does not match the evidence', () => {
    // The revision-drift attack: fix a reply, keep the id, and yesterday's verdicts would otherwise
    // silently cover today's words.
    const parts = cleanCorpus();
    const edited = createRiyaIntelligenceTrajectory({
      ...at(parts.trajectories, 0),
      trajectoryRevision: 2,
    });
    const result = run({ ...parts, trajectories: [edited, at(parts.trajectories, 1)] });

    expect(kinds(result)).toContain('TRAJECTORY_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks when the scenario digest does not match', () => {
    const parts = cleanCorpus();
    const edited = createRiyaAiSyntheticScenario({
      ...at(parts.scenarios, 0),
      targetAssistantTurns: 5,
    });
    const result = run({ ...parts, scenarios: [edited, at(parts.scenarios, 1)] });

    expect(kinds(result)).toContain('SCENARIO_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks when the scenario is absent entirely', () => {
    const parts = cleanCorpus();
    const result = run({ ...parts, scenarios: [at(parts.scenarios, 1)] });

    expect(kinds(result)).toContain('SCENARIO_MISSING');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario correspondence.
// ---------------------------------------------------------------------------

describe('the generated trajectory must match the plan it claims', () => {
  it('blocks a split that drifted from the scenario', () => {
    // The whole reason lineage and split live on the PLAN: a row that moved split after generation
    // is how a paraphrase reaches VALIDATION while its parent sits in TRAIN.
    const parts = cleanCorpus();
    const moved = createRiyaIntelligenceTrajectory({
      ...at(parts.trajectories, 0),
      split: 'VALIDATION',
    });
    const result = run({ ...parts, trajectories: [moved, at(parts.trajectories, 1)] });

    expect(kinds(result)).toContain('SCENARIO_TRAJECTORY_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a depth outside the policy tolerance', () => {
    const parts = cleanCorpus();
    const deeper = createRiyaAiSyntheticScenario({
      ...at(parts.scenarios, 0),
      targetAssistantTurns: 10,
    });
    const provenance = provenanceFor('alpha', riyaAiSyntheticScenarioSha256(deeper));
    const evidence = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      scenarioSha256: riyaAiSyntheticScenarioSha256(deeper),
      provenanceSha256: riyaAiSyntheticProvenanceSha256(provenance),
      criticVerdicts: [...at(parts.evidence, 0).criticVerdicts],
    });
    const result = run({
      ...parts,
      scenarios: [deeper, at(parts.scenarios, 1)],
      provenances: [provenance, at(parts.provenances, 1)],
      evidence: [evidence, at(parts.evidence, 1)],
    });

    expect(kinds(result)).toContain('SCENARIO_DEPTH_OUT_OF_TOLERANCE');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Critics.
// ---------------------------------------------------------------------------

describe('no single model approves its own trajectory', () => {
  it('blocks when a critic config is one of the generation roles', () => {
    const parts = cleanCorpus();
    const selfJudged = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        {
          ...at(CRITICS, 0),
          satisfiedQualityDimensions: [...at(CRITICS, 0).satisfiedQualityDimensions],
        },
        {
          ...at(CRITICS, 1),
          criticConfigRef: 'cfg.teacher',
          satisfiedQualityDimensions: [...at(CRITICS, 1).satisfiedQualityDimensions],
        },
      ],
    });
    const result = run({ ...parts, evidence: [selfJudged, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_CONFIG_NOT_INDEPENDENT');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks two critics sharing one configuration', () => {
    const parts = cleanCorpus();
    const cloned = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        {
          ...at(CRITICS, 0),
          satisfiedQualityDimensions: [...at(CRITICS, 0).satisfiedQualityDimensions],
        },
        {
          ...at(CRITICS, 1),
          criticConfigRef: 'cfg.critic.one',
          satisfiedQualityDimensions: [...at(CRITICS, 1).satisfiedQualityDimensions],
        },
      ],
    });
    const result = run({ ...parts, evidence: [cloned, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_DUPLICATE_CONFIG');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks when fewer critics accepted than the policy requires', () => {
    const parts = cleanCorpus();
    const thin = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        {
          ...at(CRITICS, 0),
          satisfiedQualityDimensions: [...at(CRITICS, 0).satisfiedQualityDimensions],
        },
      ],
    });
    const result = run({ ...parts, evidence: [thin, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_COUNT_BELOW_POLICY');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks on ONE explicit rejection, however many acceptances sit beside it', () => {
    // No averaged score. A rejection is decisive.
    const parts = cleanCorpus();
    const rejected = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        {
          ...at(CRITICS, 0),
          satisfiedQualityDimensions: [...at(CRITICS, 0).satisfiedQualityDimensions],
        },
        {
          ...at(CRITICS, 1),
          satisfiedQualityDimensions: [...at(CRITICS, 1).satisfiedQualityDimensions],
        },
        {
          criticRef: 'critic.three',
          criticConfigRef: 'cfg.critic.three',
          decision: 'REJECTED' as const,
          satisfiedQualityDimensions: [],
          failedQualityDimensions: ['NATURALNESS' as const],
        },
      ],
    });
    const result = run({ ...parts, evidence: [rejected, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_REJECTED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a missing required quality dimension', () => {
    const parts = cleanCorpus();
    const short = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        { ...at(CRITICS, 0), satisfiedQualityDimensions: ['CLARITY' as const] },
        { ...at(CRITICS, 1), satisfiedQualityDimensions: ['CLARITY' as const] },
      ],
    });
    const result = run({ ...parts, evidence: [short, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_DIMENSION_MISSING');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks undeclared model families when the policy requires distinct ones', () => {
    // Undeclared cannot be proved distinct, and the flag was switched on deliberately.
    const parts = cleanCorpus();
    const undeclared = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        {
          criticRef: 'critic.one',
          criticConfigRef: 'cfg.critic.one',
          decision: 'ACCEPTED' as const,
          satisfiedQualityDimensions: [...at(CRITICS, 0).satisfiedQualityDimensions],
        },
        {
          criticRef: 'critic.two',
          criticConfigRef: 'cfg.critic.two',
          decision: 'ACCEPTED' as const,
          satisfiedQualityDimensions: [...at(CRITICS, 1).satisfiedQualityDimensions],
        },
      ],
    });
    const result = run(
      { ...parts, evidence: [undeclared, at(parts.evidence, 1)] },
      policy({ critic: { requireDistinctCriticModelFamilies: true } }),
    );

    expect(kinds(result)).toContain('CRITIC_MODEL_FAMILY_NOT_DISTINCT');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Diversity.
// ---------------------------------------------------------------------------

describe('the diversity policy blocks a formulaic corpus', () => {
  it('blocks too many variants of one lineage', () => {
    const parts = cleanCorpus();
    const sameLineage = teacherTrajectory('beta', { lineageRootRef: 'riya.family.alpha' });
    const scenario = createRiyaAiSyntheticScenario({
      ...at(parts.scenarios, 1),
      lineageRootRef: 'riya.family.alpha',
    });
    const provenance = provenanceFor('beta', riyaAiSyntheticScenarioSha256(scenario));
    const evidence = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 1),
      trajectoryArtifactSha256: trajectoryArtifactSha256(sameLineage),
      conversationFingerprint: trajectoryConversationFingerprint(sameLineage),
      scenarioSha256: riyaAiSyntheticScenarioSha256(scenario),
      provenanceSha256: riyaAiSyntheticProvenanceSha256(provenance),
      criticVerdicts: [...at(parts.evidence, 1).criticVerdicts],
    });
    const result = run(
      {
        trajectories: [at(parts.trajectories, 0), sameLineage],
        scenarios: [at(parts.scenarios, 0), scenario],
        provenances: [at(parts.provenances, 0), provenance],
        evidence: [at(parts.evidence, 0), evidence],
      },
      policy({ diversity: { maxVariantsPerLineage: 1 } }),
    );

    expect(kinds(result)).toContain('DIVERSITY_LINEAGE_VARIANTS_ABOVE_CAP');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a corpus that exercises too few decisions', () => {
    const result = run(cleanCorpus(), policy({ diversity: { minDecisionsCovered: 6 } }));

    expect(kinds(result)).toContain('DIVERSITY_DECISION_COVERAGE_BELOW_FLOOR');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a corpus that covers too few depth bands', () => {
    const result = run(cleanCorpus(), policy({ diversity: { minDepthBandsCovered: 3 } }));

    expect(kinds(result)).toContain('DIVERSITY_DEPTH_BAND_COVERAGE_BELOW_FLOOR');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The deterministic gates stay exactly as strict.
// ---------------------------------------------------------------------------

describe('every generic hard gate still blocks on the AI lane', () => {
  it('blocks protected exact leakage', () => {
    const parts = cleanCorpus();
    const leaked = createRiyaIntelligenceTrajectory({
      ...at(parts.trajectories, 0),
      turns: [
        createRiyaDatasetUserTurn({
          type: 'USER',
          turnRef: 'u0',
          text: 'A protected synthetic evaluation sentence.',
        }),
        ...at(parts.trajectories, 0).turns.slice(1),
      ],
    });
    const result = run({ ...parts, trajectories: [leaked, at(parts.trajectories, 1)] });

    expect(result.baseReport.protectedExactLeakage.length).toBeGreaterThan(0);
    expect(kinds(result)).toContain('BASE_VALIDATION_BLOCKED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks an unbound protected index', () => {
    const parts = cleanCorpus();
    const result = validateRiyaAiSyntheticCorpus({ ...parts, policy: policy() });

    expect(result.baseReport.releaseBindingFailures.length).toBeGreaterThan(0);
    expect(kinds(result)).toContain('BASE_VALIDATION_BLOCKED');
    expect(result.report.eligible).toBe(false);
  });

  it('leaves same-split near duplicates report-only, exactly as RID-F1 does', () => {
    // The one duplicate category RID-F1 allows on purpose. This lane does not promote it into a
    // blocker -- excessive redundancy is caught by the versioned diversity policy instead.
    const parts = cleanCorpus();
    // NEAR, not exact: an identical fingerprint short-circuits to the exact-duplicate branch, which
    // only records a finding across splits. One changed word is what this category is actually for.
    const original = at(parts.trajectories, 0);
    const twin = createRiyaIntelligenceTrajectory({
      ...original,
      trajectoryId: 'riya.ai.alpha.twin',
      lineageRootRef: 'riya.family.alpha.twin',
      turns: [
        createRiyaDatasetUserTurn({
          type: 'USER',
          turnRef: 'u0',
          text: 'alpha customer says something about the project at step 0 today.',
        }),
        ...original.turns.slice(1),
      ],
    });
    const base = validateRiyaIntelligenceDataset([at(parts.trajectories, 0), twin], {
      protectedIndex: PROTECTED,
      releasePolicy: releasePolicyFor(PROTECTED, { minimumTotalTrajectories: 1 }),
    });

    expect(base.sameSplitNearDuplicates.length).toBeGreaterThan(0);
    expect(base.exactCrossSplitDuplicates).toStrictEqual([]);
    expect(base.nearCrossSplitDuplicates).toStrictEqual([]);
  });
});
