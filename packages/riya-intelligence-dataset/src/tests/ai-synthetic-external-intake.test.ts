/**
 * External manual synthetic intake, and the AS1 non-regression proofs (AS1-B, ADR-0144).
 *
 * Two halves, and the first matters most. AS1-B's whole risk is that admitting externally generated
 * candidates quietly loosens the gate they are admitted through — so the historical V1 provenance
 * bytes, an already-serialized acceptance evidence record, the critic requirements and the required
 * quality dimensions are all asserted here as things this slice did NOT change.
 *
 * The second half proves the external route is gated at least as hard: same evidence binding, same
 * critic independence, same dimensions, plus a deterministic verifier run it cannot skip.
 */
import { describe, expect, it } from 'vitest';

import {
  createRiyaAiSyntheticAcceptancePolicy,
  createRiyaAiSyntheticDeterministicVerifierRun,
  createRiyaAiSyntheticExternalIntakeProvenance,
  createRiyaAiSyntheticExternalSourceBinding,
  riyaAiSyntheticExternalBundleSha256,
  riyaAiSyntheticExternalJsonlRecordSha256,
  createRiyaAiSyntheticGenerationProvenance,
  createRiyaAiSyntheticScenario,
  createRiyaAiSyntheticTrajectoryAcceptanceEvidence,
  isRiyaAiSyntheticExternalIntakeProvenance,
  riyaAiSyntheticEvidenceSha256,
  riyaAiSyntheticProvenanceMode,
  riyaAiSyntheticProvenanceSha256,
  riyaAiSyntheticScenarioSha256,
  advanceRiyaAiSyntheticCandidate,
  createRiyaAiSyntheticCandidateState,
  validateRiyaAiSyntheticCorpus,
  RIYA_AI_SYNTHETIC_PROVENANCE_MODES,
  RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS,
} from '../ai-synthetic/index.js';
import type {
  RiyaAiSyntheticAcceptancePolicyV1,
  RiyaAiSyntheticFindingKind,
  RiyaAiSyntheticProvenanceV1,
} from '../ai-synthetic/index.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import { createRiyaDatasetAssistantTurn, createRiyaDatasetUserTurn } from '../contracts/turns.js';
import type { RiyaDatasetTurnV1 } from '../contracts/turns.js';
import { sha256Bytes, sha256OfCanonical } from '../internal/sha256.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';
import {
  emptyTrainingState,
  releasePolicyFor,
  syntheticProtectedIndex,
} from '../testing/fixtures.js';

const PROTECTED = syntheticProtectedIndex();

/** Index into a fixture array and PROVE the element exists (`noUncheckedIndexedAccess`). */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`fixture element ${String(index)} is missing`);
  }
  return item;
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

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

/**
 * An externally produced row is still `TEACHER_GENERATED_SYNTHETIC`.
 *
 * ADR-0143 §2 is about WHO WROTE THE WORDS, not about which machine ran. A model wrote these, so the
 * source kind is the teacher one and `teacherRef` is present — external origin earns no new source
 * kind, and most certainly not the human one.
 */
function externalTrajectory(seed: string): RiyaIntelligenceTrajectoryV1 {
  return createRiyaIntelligenceTrajectory({
    version: 1,
    trajectoryId: `riya.ext.${seed}`,
    trajectoryRevision: 1,
    lineageRootRef: `riya.family.${seed}`,
    split: 'TRAIN',
    languageMode: 'ENGLISH',
    primaryInteractionKind: 'DISCOVERY',
    secondaryInteractionKinds: [],
    persona: 'EXPLORING',
    difficulty: 'STANDARD',
    riskClass: 'STANDARD',
    source: {
      kind: 'TEACHER_GENERATED_SYNTHETIC',
      sourceRef: 'external.producer.alpha',
      synthetic: true,
      teacherRef: `gen.ext.${seed}`,
    },
    initialState: emptyTrainingState(),
    turns: turnsFor(seed),
    review: [],
  });
}

function scenarioFor(seed: string) {
  return createRiyaAiSyntheticScenario({
    scenarioRef: `scn.ext.${seed}`,
    lineageRootRef: `riya.family.${seed}`,
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

const EXTERNAL_INPUT = {
  generationRef: 'gen.ext.alpha',
  intakeContractRef: 'riya-external-synthetic-intake',
  intakeContractVersion: 1,
  batchRef: 'batch.ext.2026-09',
  producerFamilyRef: 'family.external.one',
  producerTeacherRef: 'external.teacher.one',
  scenarioRef: 'scn.ext.alpha',
  scenarioSha256: 'a'.repeat(64),
  sourceCandidateSha256: 'b'.repeat(64),
  sourceTrajectoryArtifactSha256: 'c'.repeat(64),
  sourceBundleSha256: 'd'.repeat(64),
} as const;

function externalProvenanceInputFor(seed: string, trajectory: RiyaIntelligenceTrajectoryV1) {
  return {
    ...EXTERNAL_INPUT,
    generationRef: `gen.ext.${seed}`,
    scenarioRef: `scn.ext.${seed}`,
    scenarioSha256: riyaAiSyntheticScenarioSha256(scenarioFor(seed)),
    sourceCandidateSha256: sha256OfCanonical({ candidate: seed }),
    sourceTrajectoryArtifactSha256: trajectoryArtifactSha256(trajectory),
    sourceBundleSha256: sha256OfCanonical({ bundle: 'batch.ext.2026-09' }),
  };
}

function externalProvenanceFor(seed: string, trajectory: RiyaIntelligenceTrajectoryV1) {
  return createRiyaAiSyntheticExternalIntakeProvenance(
    externalProvenanceInputFor(seed, trajectory),
  );
}

/**
 * What the intake reader OBSERVED from the delivered files for this row.
 *
 * Built from the same values the provenance claims, which is what a clean corpus looks like. The
 * specs that matter move ONE of them and prove the gate notices.
 */
function sourceBindingFor(seed: string, trajectory: RiyaIntelligenceTrajectoryV1) {
  const claimed = externalProvenanceInputFor(seed, trajectory);
  return createRiyaAiSyntheticExternalSourceBinding({
    generationRef: claimed.generationRef,
    observedSourceCandidateSha256: claimed.sourceCandidateSha256,
    observedSourceBundleSha256: claimed.sourceBundleSha256,
  });
}

const VERIFIER_INPUT = {
  verifierRef: 'verifier.run.alpha',
  verifierImplementationRef: 'jarvis.deterministic.dataset-validator',
  verifierImplementationVersion: 1,
  validationScopeRef: 'rid-f1.full-release-validation',
  validationScopeVersion: 1,
  trajectoryArtifactSha256: 'e'.repeat(64),
  deterministicReportSha256: 'f'.repeat(64),
  verdict: 'PASSED',
} as const;

function verifierRunFor(seed: string, trajectory: RiyaIntelligenceTrajectoryV1) {
  return createRiyaAiSyntheticDeterministicVerifierRun({
    ...VERIFIER_INPUT,
    verifierRef: `verifier.run.${seed}`,
    trajectoryArtifactSha256: trajectoryArtifactSha256(trajectory),
    deterministicReportSha256: sha256OfCanonical({ report: seed }),
  });
}

/** The four dimensions the policy below requires. Never reduced for the external route. */
const REQUIRED_DIMENSIONS = ['CLARITY', 'NATURALNESS', 'CONTEXT_USE', 'NON_REPETITION'] as const;

const CRITICS = [
  {
    criticRef: 'critic.ext.one',
    criticConfigRef: 'cfg.critic.one',
    criticModelFamilyRef: 'family.critic.one',
    decision: 'ACCEPTED' as const,
    satisfiedQualityDimensions: REQUIRED_DIMENSIONS,
  },
  {
    criticRef: 'critic.ext.two',
    criticConfigRef: 'cfg.critic.two',
    criticModelFamilyRef: 'family.critic.two',
    decision: 'ACCEPTED' as const,
    satisfiedQualityDimensions: REQUIRED_DIMENSIONS,
  },
];

const criticInputs = () =>
  CRITICS.map((critic) => ({
    ...critic,
    satisfiedQualityDimensions: [...critic.satisfiedQualityDimensions],
  }));

function policy(
  overrides: {
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
      requiredQualityDimensions: [...REQUIRED_DIMENSIONS],
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
    },
    assistantTurnTolerance: 1,
  });
}

/** A clean, eligible EXTERNAL corpus: two intaken rows, each with a scenario, critics and a run. */
function externalCorpus(seeds: readonly string[] = ['alpha', 'beta']) {
  const trajectories = seeds.map((seed) => externalTrajectory(seed));
  const scenarios = seeds.map((seed) => scenarioFor(seed));
  const provenances: RiyaAiSyntheticProvenanceV1[] = seeds.map((seed, index) =>
    externalProvenanceFor(seed, at(trajectories, index)),
  );
  const evidence = seeds.map((seed, index) =>
    createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      trajectoryId: `riya.ext.${seed}`,
      trajectoryArtifactSha256: trajectoryArtifactSha256(at(trajectories, index)),
      conversationFingerprint: trajectoryConversationFingerprint(at(trajectories, index)),
      scenarioRef: `scn.ext.${seed}`,
      scenarioSha256: riyaAiSyntheticScenarioSha256(at(scenarios, index)),
      generationRef: `gen.ext.${seed}`,
      provenanceSha256: riyaAiSyntheticProvenanceSha256(at(provenances, index)),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: verifierRunFor(seed, at(trajectories, index)),
    }),
  );
  const sourceBindings = seeds.map((seed, index) =>
    sourceBindingFor(seed, at(trajectories, index)),
  );
  return { trajectories, scenarios, provenances, evidence, sourceBindings };
}

/**
 * Replace row 0's provenance and RE-SEAL its evidence against the new digest.
 *
 * Without the re-seal every source-binding spec would trip `PROVENANCE_DIGEST_MISMATCH` first and
 * prove nothing about the rule actually under test.
 */
function rebind(
  parts: ReturnType<typeof externalCorpus>,
  provenance: RiyaAiSyntheticProvenanceV1,
): ReturnType<typeof externalCorpus> {
  const first = at(parts.evidence, 0);
  const resealed = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
    ...first,
    provenanceSha256: riyaAiSyntheticProvenanceSha256(provenance),
    criticVerdicts: [...first.criticVerdicts],
    deterministicVerifierRun: first.deterministicVerifierRun,
  });
  return {
    ...parts,
    provenances: [provenance, at(parts.provenances, 1)],
    evidence: [resealed, at(parts.evidence, 1)],
  };
}

const run = (
  parts: ReturnType<typeof externalCorpus>,
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
// A. Backward compatibility. AS1-B changed no historical byte.
// ---------------------------------------------------------------------------

describe('the AS1 in-repo route is exactly what it was', () => {
  const IN_REPO_INPUT = {
    generationRef: 'gen.one',
    scenarioRef: 'scn.one',
    scenarioSha256: 'a'.repeat(64),
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.simulator',
    riyaTeacherConfigRef: 'cfg.teacher',
    annotationVerifierConfigRef: 'cfg.verifier',
  };

  /** The exact field set an AS1 provenance record serialized to, written out by hand. */
  const HISTORICAL_PROVENANCE_BYTES = Object.freeze({
    version: 1,
    generationRef: 'gen.one',
    scenarioRef: 'scn.one',
    scenarioSha256: 'a'.repeat(64),
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.simulator',
    riyaTeacherConfigRef: 'cfg.teacher',
    annotationVerifierConfigRef: 'cfg.verifier',
  });

  it('still builds V1 provenance to the same fields and the same digest', () => {
    const record = createRiyaAiSyntheticGenerationProvenance(IN_REPO_INPUT);

    expect(Object.keys(record).sort()).toStrictEqual(
      Object.keys(HISTORICAL_PROVENANCE_BYTES).sort(),
    );
    // No mode discriminant was added, so the canonical bytes -- and therefore every
    // `provenanceSha256` already written into acceptance evidence -- are unchanged.
    expect(record).not.toHaveProperty('generationMode');
    expect(riyaAiSyntheticProvenanceSha256(record)).toBe(
      sha256OfCanonical(HISTORICAL_PROVENANCE_BYTES),
    );
  });

  it('reports the in-repo mode without storing it', () => {
    const record = createRiyaAiSyntheticGenerationProvenance(IN_REPO_INPUT);

    expect(riyaAiSyntheticProvenanceMode(record)).toBe('IN_REPO_GENERATED_SYNTHETIC');
    expect(isRiyaAiSyntheticExternalIntakeProvenance(record)).toBe(false);
  });

  it('refuses an external discriminant on the in-repo constructor', () => {
    // The strict schema is what makes the two modes mutually unconstructible.
    expect(() =>
      createRiyaAiSyntheticGenerationProvenance({
        ...IN_REPO_INPUT,
        generationMode: 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE',
      } as never),
    ).toThrow(RiyaDatasetError);
  });

  /** An acceptance evidence record exactly as AS1 serialized one, before AS1-B existed. */
  const HISTORICAL_EVIDENCE = Object.freeze({
    version: 1,
    trajectoryId: 'riya.ai.alpha',
    trajectoryArtifactSha256: 'a'.repeat(64),
    conversationFingerprint: 'b'.repeat(64),
    scenarioRef: 'scn.one',
    scenarioSha256: 'c'.repeat(64),
    generationRef: 'gen.one',
    provenanceSha256: 'd'.repeat(64),
    criticVerdicts: [
      Object.freeze({
        version: 1,
        criticRef: 'critic.one',
        criticConfigRef: 'cfg.critic.one',
        decision: 'ACCEPTED',
        satisfiedQualityDimensions: ['CLARITY'],
        failedQualityDimensions: [],
      }),
    ],
  } as const);

  it('re-proves an already-serialized AS1 evidence record to identical bytes', () => {
    const rebuilt = createRiyaAiSyntheticTrajectoryAcceptanceEvidence(HISTORICAL_EVIDENCE);

    expect(Object.keys(rebuilt).sort()).toStrictEqual(Object.keys(HISTORICAL_EVIDENCE).sort());
    // The new field is OPTIONAL and absent, not present-and-undefined: canonical JSON omits an
    // absent key, so the digest of every evidence record ever issued is untouched.
    expect(rebuilt).not.toHaveProperty('deterministicVerifierRun');
    expect(riyaAiSyntheticEvidenceSha256(rebuilt)).toBe(sha256OfCanonical(HISTORICAL_EVIDENCE));
  });

  it('still gates a clean in-repo corpus with no verifier run at all', () => {
    const trajectories = ['gamma', 'delta'].map((seed) =>
      createRiyaIntelligenceTrajectory({
        ...externalTrajectory(seed),
        trajectoryId: `riya.ai.${seed}`,
        source: {
          kind: 'TEACHER_GENERATED_SYNTHETIC',
          sourceRef: 'cfg.teacher',
          synthetic: true,
          teacherRef: `gen.${seed}`,
        },
      }),
    );
    const scenarios = ['gamma', 'delta'].map((seed) => scenarioFor(seed));
    const provenances: RiyaAiSyntheticProvenanceV1[] = ['gamma', 'delta'].map((seed, index) =>
      createRiyaAiSyntheticGenerationProvenance({
        generationRef: `gen.${seed}`,
        scenarioRef: `scn.ext.${seed}`,
        scenarioSha256: riyaAiSyntheticScenarioSha256(at(scenarios, index)),
        scenarioPlannerConfigRef: 'cfg.planner',
        customerSimulatorConfigRef: 'cfg.simulator',
        riyaTeacherConfigRef: 'cfg.teacher',
        annotationVerifierConfigRef: 'cfg.verifier',
      }),
    );
    const evidence = ['gamma', 'delta'].map((seed, index) =>
      createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
        trajectoryId: `riya.ai.${seed}`,
        trajectoryArtifactSha256: trajectoryArtifactSha256(at(trajectories, index)),
        conversationFingerprint: trajectoryConversationFingerprint(at(trajectories, index)),
        scenarioRef: `scn.ext.${seed}`,
        scenarioSha256: riyaAiSyntheticScenarioSha256(at(scenarios, index)),
        generationRef: `gen.${seed}`,
        provenanceSha256: riyaAiSyntheticProvenanceSha256(at(provenances, index)),
        criticVerdicts: criticInputs(),
      }),
    );
    const result = validateRiyaAiSyntheticCorpus({
      trajectories,
      scenarios,
      provenances,
      evidence,
      policy: policy(),
      protectedIndex: PROTECTED,
    });

    // No VERIFIER_RUN_MISSING: the run is required only where there is no annotation verifier
    // config ref to stand in its place. And NO `sourceBindings` argument was passed at all --
    // an in-repo corpus makes no source claim, so it is asked to corroborate none, and the call
    // above is byte-for-byte the call an AS2 caller already makes.
    expect(result.report.findings).toStrictEqual([]);
    expect(result.report.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. External provenance.
// ---------------------------------------------------------------------------

describe('external manual synthetic intake provenance', () => {
  it('builds, stores its mode as a literal and digests deterministically', () => {
    const one = createRiyaAiSyntheticExternalIntakeProvenance(EXTERNAL_INPUT);
    // Same values, different key order on input. The digest is canonical, so it cannot move.
    const two = createRiyaAiSyntheticExternalIntakeProvenance({
      sourceBundleSha256: EXTERNAL_INPUT.sourceBundleSha256,
      sourceTrajectoryArtifactSha256: EXTERNAL_INPUT.sourceTrajectoryArtifactSha256,
      sourceCandidateSha256: EXTERNAL_INPUT.sourceCandidateSha256,
      scenarioSha256: EXTERNAL_INPUT.scenarioSha256,
      scenarioRef: EXTERNAL_INPUT.scenarioRef,
      producerTeacherRef: EXTERNAL_INPUT.producerTeacherRef,
      producerFamilyRef: EXTERNAL_INPUT.producerFamilyRef,
      batchRef: EXTERNAL_INPUT.batchRef,
      intakeContractVersion: EXTERNAL_INPUT.intakeContractVersion,
      intakeContractRef: EXTERNAL_INPUT.intakeContractRef,
      generationRef: EXTERNAL_INPUT.generationRef,
    });

    expect(one.generationMode).toBe('EXTERNAL_MANUAL_SYNTHETIC_INTAKE');
    expect(riyaAiSyntheticProvenanceMode(one)).toBe('EXTERNAL_MANUAL_SYNTHETIC_INTAKE');
    expect(isRiyaAiSyntheticExternalIntakeProvenance(one)).toBe(true);
    expect(riyaAiSyntheticProvenanceSha256(two)).toBe(riyaAiSyntheticProvenanceSha256(one));
    // Round-trips: an already-constructed record re-proves to itself.
    expect(createRiyaAiSyntheticExternalIntakeProvenance(one)).toStrictEqual(one);
  });

  it('cannot masquerade as an in-repo AS2 allocation', () => {
    // The whole point of AS1-B. An external row that could carry these refs would be indistinguishable
    // from a harness run that never happened.
    for (const role of [
      'scenarioPlannerConfigRef',
      'customerSimulatorConfigRef',
      'riyaTeacherConfigRef',
      'annotationVerifierConfigRef',
    ]) {
      expect(() =>
        createRiyaAiSyntheticExternalIntakeProvenance({
          ...EXTERNAL_INPUT,
          [role]: 'cfg.invented',
        }),
      ).toThrow(RiyaDatasetError);
    }
  });

  it('refuses a record missing durable source identity', () => {
    for (const field of [
      'generationRef',
      'producerFamilyRef',
      'producerTeacherRef',
      'intakeContractRef',
      'intakeContractVersion',
      'batchRef',
      'scenarioRef',
      'scenarioSha256',
      'sourceCandidateSha256',
      'sourceTrajectoryArtifactSha256',
      'sourceBundleSha256',
    ]) {
      const { [field]: _removed, ...rest } = EXTERNAL_INPUT as Record<string, unknown>;
      expect(() => createRiyaAiSyntheticExternalIntakeProvenance(rest as never)).toThrow(
        RiyaDatasetError,
      );
    }
  });

  it('refuses malformed refs and malformed digests', () => {
    expect(() =>
      createRiyaAiSyntheticExternalIntakeProvenance({
        ...EXTERNAL_INPUT,
        producerFamilyRef: 'https://producer.example/keys',
      }),
    ).toThrow(RiyaDatasetError);
    expect(() =>
      createRiyaAiSyntheticExternalIntakeProvenance({ ...EXTERNAL_INPUT, batchRef: 'a b' }),
    ).toThrow(RiyaDatasetError);
    expect(() =>
      createRiyaAiSyntheticExternalIntakeProvenance({
        ...EXTERNAL_INPUT,
        sourceBundleSha256: 'not-a-digest',
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('refuses an intake bundle that is also its own teacher', () => {
    expect(() =>
      createRiyaAiSyntheticExternalIntakeProvenance({
        ...EXTERNAL_INPUT,
        producerTeacherRef: EXTERNAL_INPUT.generationRef,
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('carries no prompt, key, url, provider or AS2 run field', () => {
    const record = createRiyaAiSyntheticExternalIntakeProvenance(EXTERNAL_INPUT);

    for (const absent of [
      'prompt',
      'apiKey',
      'url',
      'reasoning',
      'temperature',
      'output',
      'runId',
    ]) {
      expect(Object.keys(record), absent).not.toContain(absent);
    }
  });

  it('blocks a source digest that does not describe the row in hand', () => {
    const parts = externalCorpus();
    const drifted = createRiyaAiSyntheticExternalIntakeProvenance({
      ...EXTERNAL_INPUT,
      generationRef: 'gen.ext.alpha',
      scenarioRef: 'scn.ext.alpha',
      scenarioSha256: riyaAiSyntheticScenarioSha256(at(parts.scenarios, 0)),
      sourceTrajectoryArtifactSha256: 'f'.repeat(64),
    });
    const evidence = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      provenanceSha256: riyaAiSyntheticProvenanceSha256(drifted),
      criticVerdicts: [...at(parts.evidence, 0).criticVerdicts],
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({
      ...parts,
      provenances: [drifted, at(parts.provenances, 1)],
      evidence: [evidence, at(parts.evidence, 1)],
    });

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a candidate digest that does not match the observed delivery', () => {
    // Owner review of PR #195: `sourceCandidateSha256` was sealed inside `provenanceSha256` and
    // never compared to anything. A well-formed digest that described no delivered row passed.
    const parts = externalCorpus();
    const swapped = createRiyaAiSyntheticExternalIntakeProvenance({
      ...externalProvenanceInputFor('alpha', at(parts.trajectories, 0)),
      sourceCandidateSha256: sha256OfCanonical({ candidate: 'some other row entirely' }),
    });
    const result = run(rebind(parts, swapped));

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a bundle digest that does not match the observed delivery', () => {
    const parts = externalCorpus();
    const swapped = createRiyaAiSyntheticExternalIntakeProvenance({
      ...externalProvenanceInputFor('alpha', at(parts.trajectories, 0)),
      sourceBundleSha256: sha256OfCanonical({ bundle: 'some other delivery entirely' }),
    });
    const result = run(rebind(parts, swapped));

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks an external row whose observed source binding is absent', () => {
    const parts = externalCorpus();
    const result = run({ ...parts, sourceBindings: [at(parts.sourceBindings, 1)] });

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_BINDING_MISSING');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks two contradictory observations of one delivery', () => {
    const parts = externalCorpus();
    const second = createRiyaAiSyntheticExternalSourceBinding({
      generationRef: 'gen.ext.alpha',
      observedSourceCandidateSha256: sha256OfCanonical({ candidate: 'a different reading' }),
      observedSourceBundleSha256: sha256OfCanonical({ bundle: 'a different reading' }),
    });
    const result = run({
      ...parts,
      sourceBindings: [...parts.sourceBindings, second],
    });

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_BINDING_DUPLICATED');
    expect(result.report.eligible).toBe(false);
  });

  it('does not let one row’s binding satisfy another row', () => {
    // The binding is keyed by generationRef. A delivery observation for beta says nothing about
    // alpha, and must not be silently reused for it.
    const parts = externalCorpus();
    const result = run({
      ...parts,
      sourceBindings: [at(parts.sourceBindings, 1), at(parts.sourceBindings, 1)],
    });

    expect(kinds(result)).toContain('EXTERNAL_SOURCE_BINDING_MISSING');
    expect(result.report.eligible).toBe(false);
  });

  it('refuses a malformed or over-full source binding', () => {
    const valid = {
      generationRef: 'gen.ext.alpha',
      observedSourceCandidateSha256: 'a'.repeat(64),
      observedSourceBundleSha256: 'b'.repeat(64),
    };

    expect(() => createRiyaAiSyntheticExternalSourceBinding(valid)).not.toThrow();
    for (const broken of [
      { ...valid, generationRef: 'not a ref' },
      { ...valid, generationRef: 'https://producer.example/keys' },
      { ...valid, observedSourceCandidateSha256: 'not-a-digest' },
      { ...valid, observedSourceBundleSha256: 'B'.repeat(64) },
      // No unknown field, and above all nowhere to attach the candidate's own words.
      { ...valid, sourcePath: 'delivery/batch.jsonl' },
      { ...valid, candidateText: 'the customer said something' },
      { ...valid, text: 'anything at all' },
    ]) {
      expect(
        () => createRiyaAiSyntheticExternalSourceBinding(broken as never),
        JSON.stringify(Object.keys(broken)),
      ).toThrow(RiyaDatasetError);
    }
  });

  it('carries no source path and no candidate text', () => {
    const binding = createRiyaAiSyntheticExternalSourceBinding({
      generationRef: 'gen.ext.alpha',
      observedSourceCandidateSha256: 'a'.repeat(64),
      observedSourceBundleSha256: 'b'.repeat(64),
    });

    expect(Object.keys(binding).sort()).toStrictEqual([
      'generationRef',
      'observedSourceBundleSha256',
      'observedSourceCandidateSha256',
      'version',
    ]);
  });

  it('names exactly two modes, and they are closed', () => {
    expect([...RIYA_AI_SYNTHETIC_PROVENANCE_MODES]).toStrictEqual([
      'IN_REPO_GENERATED_SYNTHETIC',
      'EXTERNAL_MANUAL_SYNTHETIC_INTAKE',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B2. The raw-byte hashing conventions, pinned.
// ---------------------------------------------------------------------------

describe('the external intake hashing conventions are byte-exact', () => {
  /**
   * One delivered JSONL record, and its digest.
   *
   * The expected values below were computed OUTSIDE this package, with `node:crypto` called directly
   * on the same bytes — never through the helper under test. A vector a helper computed for itself
   * proves only that the helper is consistent with its own bug.
   */
  const RECORD = '{"candidateRef":"cand.ext.alpha","scenarioRef":"scn.ext.alpha"}';
  const RECORD_SHA = '5dd395a73d6ac420c9c655582e232f55a5f95ee5026f85ecf9b633f8f7283897';

  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('hashes the exact record bytes to a known digest', () => {
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD))).toBe(RECORD_SHA);
  });

  it('strips exactly one trailing LF and exactly two trailing CRLF bytes', () => {
    // The point of the convention: the same record delivered with either line ending, or with none,
    // is the same record. A delivery that changed only its line endings must not read as a swap.
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + '\n'))).toBe(RECORD_SHA);
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + '\r\n'))).toBe(RECORD_SHA);

    // And the digests of the UNSTRIPPED bytes are genuinely different, so the two assertions above
    // prove that stripping happened rather than that the terminators never mattered.
    expect(sha256Bytes(bytes(RECORD + '\n'))).toBe(
      '3c1d3893962b2f0303c08c82fbe98e1638dea0bf1a5b40547b72613ef8f360dd',
    );
    expect(sha256Bytes(bytes(RECORD + '\r\n'))).toBe(
      'd089c4b5c1a5c6ea5a47c42954ffd1b3441a2b5e9943a1345169af8672c45a3d',
    );
  });

  it('keeps a bare trailing CR, because bare CR is not a defined terminator here', () => {
    // Dropping it would be a guess, and a guess that silently changes a digest is how a record stops
    // describing the file it claims to describe.
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + '\r'))).toBe(
      'beca6b93a93f17b3c906a3789839f2b1638c965e864740cc506d711bcd37f636',
    );
  });

  it('does NOT trim spaces, before or after the record', () => {
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + ' \n'))).toBe(
      '3b24f6f29ab0d35f6ec55d33bb88b085d8c8495b96b1f64b9dc2e1d856a2a401',
    );
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(' ' + RECORD))).toBe(
      '25e9e4735e8959cf7d89b5a421c7d0651a069508dd6b7d7ccd369956ae6ce2b9',
    );
    // Both differ from the untouched record: whitespace is delivered content, not noise.
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + ' \n'))).not.toBe(RECORD_SHA);
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(' ' + RECORD))).not.toBe(RECORD_SHA);
  });

  it('is byte identity, NOT canonical JSON identity', () => {
    // The same parsed object with its keys in a different order. Canonical JSON calls those equal —
    // which is exactly why `sha256OfCanonical` is the wrong tool for a delivered file.
    const KEY_SWAPPED = '{"scenarioRef":"scn.ext.alpha","candidateRef":"cand.ext.alpha"}';
    const REFORMATTED = '{"candidateRef": "cand.ext.alpha","scenarioRef":"scn.ext.alpha"}';

    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(KEY_SWAPPED))).toBe(
      'ba4b8fad9367b433d358cb65129aa91a3f9342dc8a42fb0ba096b2ae0a795a3c',
    );
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(REFORMATTED))).toBe(
      'a9cf7d3787aba14be3cad1e98ba7f9d59aa18f54a7f1b45da645f5affad9d469',
    );
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(KEY_SWAPPED))).not.toBe(RECORD_SHA);
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(REFORMATTED))).not.toBe(RECORD_SHA);

    // The contrast as an assertion rather than a comment: canonicalizing DOES collapse them.
    expect(sha256OfCanonical(JSON.parse(KEY_SWAPPED))).toBe(sha256OfCanonical(JSON.parse(RECORD)));
  });

  it('does not Unicode-normalize', () => {
    // NFD and NFC spellings of one glyph. A normalizing digest would call these one delivery.
    // Written as escapes, deliberately: an editor that normalized the literals would silently
    // turn these two vectors into one and the spec would stop proving anything.
    const NFD = '{"note":"e\u0301"}';
    const NFC = '{"note":"\u00e9"}';

    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(NFD))).toBe(
      '652adce0901f1d9c40c956bde6fac2a53cee7bc87592006c9d0f4435ae46c78b',
    );
    expect(riyaAiSyntheticExternalJsonlRecordSha256(bytes(NFC))).toBe(
      '6442fa400575468d43a22425ba3cc684670d3b02d8b855ce32b6f1e99a03909b',
    );
  });

  it('refuses a record that is empty once its terminator is removed', () => {
    for (const empty of ['', '\n', '\r\n']) {
      expect(() => riyaAiSyntheticExternalJsonlRecordSha256(bytes(empty)), empty).toThrow(
        RiyaDatasetError,
      );
    }
  });

  /** A delivered bundle, ending in CRLF on purpose: the bundle helper must not touch it. */
  const BUNDLE = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x0d, 0x0a]);
  const BUNDLE_SHA = 'e29e148919c549ebd0fe43016dbc9e502dee40e742e9181d1693d446dd7087d6';

  it('hashes the exact bundle bytes to a known digest', () => {
    expect(riyaAiSyntheticExternalBundleSha256(BUNDLE)).toBe(BUNDLE_SHA);
  });

  it('strips nothing from a bundle, line endings included', () => {
    // The bundle ends in CRLF. If it stripped that the way the record helper does, it would return
    // the digest of the first six bytes — which is a different, independently known value.
    expect(riyaAiSyntheticExternalBundleSha256(BUNDLE.subarray(0, 6))).toBe(
      'f9709437c1e4db38aea43d39f66e9bf4604398d2ddf60dd38df4368de1b35fcd',
    );
    expect(riyaAiSyntheticExternalBundleSha256(BUNDLE)).not.toBe(
      riyaAiSyntheticExternalBundleSha256(BUNDLE.subarray(0, 6)),
    );
  });

  it('changes when any single bundle byte changes', () => {
    const flipped = Uint8Array.from(BUNDLE);
    flipped[4] = 0xfe;

    expect(riyaAiSyntheticExternalBundleSha256(flipped)).not.toBe(BUNDLE_SHA);
  });

  it('refuses anything that is not raw bytes', () => {
    // A string of the record is the tempting mistake: it would hash, and it would hash DIFFERENTLY
    // once any non-ASCII byte appeared. An array-like is the other one. Both are refused.
    const notBytes: readonly { readonly label: string; readonly value: unknown }[] = [
      { label: 'string', value: RECORD },
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
      { label: 'array-like', value: { length: 3 } },
      { label: 'number array', value: [1, 2, 3] },
    ];
    for (const { label, value } of notBytes) {
      expect(() => riyaAiSyntheticExternalJsonlRecordSha256(value as never), label).toThrow(
        RiyaDatasetError,
      );
      expect(() => riyaAiSyntheticExternalBundleSha256(value as never), label).toThrow(
        RiyaDatasetError,
      );
    }
  });

  it('feeds a source binding without ever putting the bytes in it', () => {
    // The helpers are how an intake reader computes what it observed; the binding carries only the
    // results. There is no path by which delivered content itself reaches the record.
    const binding = createRiyaAiSyntheticExternalSourceBinding({
      generationRef: 'gen.ext.alpha',
      observedSourceCandidateSha256: riyaAiSyntheticExternalJsonlRecordSha256(bytes(RECORD + '\n')),
      observedSourceBundleSha256: riyaAiSyntheticExternalBundleSha256(BUNDLE),
    });

    expect(binding.observedSourceCandidateSha256).toBe(RECORD_SHA);
    expect(binding.observedSourceBundleSha256).toBe(BUNDLE_SHA);
    expect(JSON.stringify(binding)).not.toContain('candidateRef');
    expect(JSON.stringify(binding)).not.toContain('scn.ext.alpha');
  });
});

// ---------------------------------------------------------------------------
// C. The deterministic verifier.
// ---------------------------------------------------------------------------

describe('deterministic verifier run evidence', () => {
  it('builds, and binds identity, scope, verdict and report digest', () => {
    const record = createRiyaAiSyntheticDeterministicVerifierRun(VERIFIER_INPUT);

    expect(record.verdict).toBe('PASSED');
    expect(record.deterministicReportSha256).toBe('f'.repeat(64));
    expect(createRiyaAiSyntheticDeterministicVerifierRun(record)).toStrictEqual(record);
    expect([...RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS]).toStrictEqual(['PASSED', 'FAILED']);
  });

  it('refuses a run record missing the evidence that it ran', () => {
    for (const field of [
      'verifierRef',
      'verifierImplementationRef',
      'verifierImplementationVersion',
      'validationScopeRef',
      'validationScopeVersion',
      'trajectoryArtifactSha256',
      'deterministicReportSha256',
      'verdict',
    ]) {
      const { [field]: _removed, ...rest } = VERIFIER_INPUT as Record<string, unknown>;
      expect(() => createRiyaAiSyntheticDeterministicVerifierRun(rest as never)).toThrow(
        RiyaDatasetError,
      );
    }
  });

  it('refuses an open verdict and a malformed report digest', () => {
    expect(() =>
      createRiyaAiSyntheticDeterministicVerifierRun({
        ...VERIFIER_INPUT,
        verdict: 'MOSTLY_FINE',
      } as never),
    ).toThrow(RiyaDatasetError);
    expect(() =>
      createRiyaAiSyntheticDeterministicVerifierRun({
        ...VERIFIER_INPUT,
        deterministicReportSha256: 'ran-successfully',
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('refuses a model configuration standing in for a verifier run', () => {
    // A `RiyaSyntheticModelConfigV1`-shaped object is not run evidence. It names a configuration and
    // proves no execution, and the strict schema has nowhere to put its fields.
    expect(() =>
      createRiyaAiSyntheticDeterministicVerifierRun({
        configRef: 'cfg.verifier',
        providerFamilyRef: 'family.one',
        modelFamilyRef: 'family.one',
        modelRef: 'model.one',
        adapterRef: 'adapter.one',
        allowedRoles: ['ANNOTATION_VERIFIER'],
        instructionRef: 'instruction.one',
        instructionSha256: 'a'.repeat(64),
        outputSchemaVersion: 1,
        maxOutputTokens: 1024,
        samplingPolicyRef: 'sampling.one',
        retryPolicyRef: 'retry.one',
        activeForGeneration: true,
      } as never),
    ).toThrow(RiyaDatasetError);
    // And a bare string ref is not run evidence either.
    expect(() => createRiyaAiSyntheticDeterministicVerifierRun('cfg.verifier' as never)).toThrow(
      RiyaDatasetError,
    );
  });

  it('refuses a run whose identity collapses into its own implementation or scope', () => {
    expect(() =>
      createRiyaAiSyntheticDeterministicVerifierRun({
        ...VERIFIER_INPUT,
        verifierImplementationRef: VERIFIER_INPUT.verifierRef,
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('refuses evidence in which a critic is also the verifier', () => {
    const parts = externalCorpus();
    expect(() =>
      createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
        ...at(parts.evidence, 0),
        criticVerdicts: criticInputs(),
        deterministicVerifierRun: createRiyaAiSyntheticDeterministicVerifierRun({
          ...VERIFIER_INPUT,
          trajectoryArtifactSha256: trajectoryArtifactSha256(at(parts.trajectories, 0)),
          verifierImplementationRef: 'cfg.critic.one',
        }),
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('blocks a verifier that is one of the generation roles', () => {
    const parts = externalCorpus();
    const selfVerified = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: createRiyaAiSyntheticDeterministicVerifierRun({
        ...VERIFIER_INPUT,
        trajectoryArtifactSha256: trajectoryArtifactSha256(at(parts.trajectories, 0)),
        // The producer's own teacher, confirming its own dialogue.
        verifierImplementationRef: EXTERNAL_INPUT.producerTeacherRef,
      }),
    });
    const result = run({ ...parts, evidence: [selfVerified, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('VERIFIER_NOT_INDEPENDENT');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a run record pasted from a different trajectory', () => {
    const parts = externalCorpus();
    const borrowed = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: verifierRunFor('alpha', at(parts.trajectories, 1)),
    });
    const result = run({ ...parts, evidence: [borrowed, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('VERIFIER_RUN_NOT_BOUND_TO_TRAJECTORY');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a verdict that is not a pass', () => {
    const parts = externalCorpus();
    const failed = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: createRiyaAiSyntheticDeterministicVerifierRun({
        ...VERIFIER_INPUT,
        trajectoryArtifactSha256: trajectoryArtifactSha256(at(parts.trajectories, 0)),
        verdict: 'FAILED',
      }),
    });
    const result = run({ ...parts, evidence: [failed, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('VERIFIER_VERDICT_NOT_PASSED');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks an external row carrying no verifier run at all', () => {
    const parts = externalCorpus();
    const unverified = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      trajectoryId: 'riya.ext.alpha',
      trajectoryArtifactSha256: trajectoryArtifactSha256(at(parts.trajectories, 0)),
      conversationFingerprint: trajectoryConversationFingerprint(at(parts.trajectories, 0)),
      scenarioRef: 'scn.ext.alpha',
      scenarioSha256: riyaAiSyntheticScenarioSha256(at(parts.scenarios, 0)),
      generationRef: 'gen.ext.alpha',
      provenanceSha256: riyaAiSyntheticProvenanceSha256(at(parts.provenances, 0)),
      criticVerdicts: criticInputs(),
    });
    const result = run({ ...parts, evidence: [unverified, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('VERIFIER_RUN_MISSING');
    expect(result.report.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Acceptance, at full strength.
// ---------------------------------------------------------------------------

describe('the external route is accepted only on the same terms', () => {
  it('accepts a clean external corpus', () => {
    const result = run(externalCorpus());

    expect(result.report.findings).toStrictEqual([]);
    expect(result.report.eligible).toBe(true);
    expect(result.report.acceptedEvidenceCount).toBe(2);
  });

  it('still refuses a critic verdict with no critic config ref', () => {
    // AS1-B does NOT grandfather the historical external KEEP/REJECT artifacts. They lack this field
    // and a fresh canonical critic pass is what has to supply it.
    expect(() =>
      createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
        ...at(externalCorpus().evidence, 0),
        criticVerdicts: [
          {
            criticRef: 'critic.ext.one',
            decision: 'ACCEPTED',
            satisfiedQualityDimensions: [...REQUIRED_DIMENSIONS],
          },
        ],
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('still requires every required quality dimension', () => {
    const parts = externalCorpus();
    const short = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: criticInputs().map((critic) => ({
        ...critic,
        satisfiedQualityDimensions: ['CLARITY', 'NATURALNESS', 'CONTEXT_USE'],
      })),
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [short, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_DIMENSION_MISSING');
    expect(result.report.eligible).toBe(false);
  });

  it('still refuses an empty satisfied-dimension list', () => {
    const parts = externalCorpus();
    const empty = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: criticInputs().map((critic) => ({
        ...critic,
        satisfiedQualityDimensions: [],
      })),
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [empty, at(parts.evidence, 1)] });

    // Every one of the four is reported missing. An empty array is not a quiet pass.
    expect(kinds(result).filter((kind) => kind === 'CRITIC_DIMENSION_MISSING')).toHaveLength(
      REQUIRED_DIMENSIONS.length,
    );
    expect(result.report.eligible).toBe(false);
  });

  it('still blocks a critic that is the producer teacher', () => {
    const parts = externalCorpus();
    const selfJudged = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      criticVerdicts: [
        { ...at(criticInputs(), 0), criticConfigRef: EXTERNAL_INPUT.producerTeacherRef },
        at(criticInputs(), 1),
      ],
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [selfJudged, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('CRITIC_CONFIG_NOT_INDEPENDENT');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a provenance digest that does not match the record it names', () => {
    const parts = externalCorpus();
    const wrong = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      provenanceSha256: 'a'.repeat(64),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [wrong, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('PROVENANCE_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a scenario digest that drifted from the plan', () => {
    const parts = externalCorpus();
    const wrong = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      scenarioSha256: 'b'.repeat(64),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [wrong, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('SCENARIO_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks a trajectory digest that does not describe the row', () => {
    const parts = externalCorpus();
    const wrong = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
      ...at(parts.evidence, 0),
      trajectoryArtifactSha256: 'c'.repeat(64),
      criticVerdicts: criticInputs(),
      deterministicVerifierRun: at(parts.evidence, 0).deterministicVerifierRun,
    });
    const result = run({ ...parts, evidence: [wrong, at(parts.evidence, 1)] });

    expect(kinds(result)).toContain('TRAJECTORY_DIGEST_MISMATCH');
    expect(result.report.eligible).toBe(false);
  });

  it('blocks an external row whose teacher ref is not the intake bundle', () => {
    const parts = externalCorpus();
    const unbound = createRiyaIntelligenceTrajectory({
      ...at(parts.trajectories, 0),
      source: {
        kind: 'TEACHER_GENERATED_SYNTHETIC',
        sourceRef: 'external.producer.alpha',
        synthetic: true,
        teacherRef: 'gen.ext.somewhere.else',
      },
    });
    const result = run({ ...parts, trajectories: [unbound, at(parts.trajectories, 1)] });

    expect(kinds(result)).toContain('TEACHER_REF_NOT_BOUND_TO_GENERATION');
    expect(result.report.eligible).toBe(false);
  });

  it('leaves QUARANTINED terminal for an externally intaken candidate', () => {
    const quarantined = advanceRiyaAiSyntheticCandidate(
      createRiyaAiSyntheticCandidateState({
        candidateRef: 'cand.ext.alpha',
        scenarioRef: 'scn.ext.alpha',
        state: 'GENERATED',
      }),
      'QUARANTINED',
    );

    for (const target of ['ACCEPTED', 'CRITIC_VALIDATED', 'GENERATED', 'REJECTED'] as const) {
      expect(() => advanceRiyaAiSyntheticCandidate(quarantined, target), target).toThrow(
        RiyaDatasetError,
      );
    }
  });

  it('sets no training approval anywhere on this route', () => {
    const parts = externalCorpus();
    const serialized = JSON.stringify(parts);

    expect(serialized).not.toContain('trainingApproval');
    expect(serialized).not.toContain('HUMAN_AUTHORED_SYNTHETIC');
  });
});

// ---------------------------------------------------------------------------
// E. The P10 boundary is untouched.
// ---------------------------------------------------------------------------

describe('protected RWC-P10 material reaches nothing AS1-B added', () => {
  it('gives the new contracts nowhere to carry protected content', () => {
    const provenance = createRiyaAiSyntheticExternalIntakeProvenance(EXTERNAL_INPUT);
    const verifier = createRiyaAiSyntheticDeterministicVerifierRun(VERIFIER_INPUT);

    for (const key of [...Object.keys(provenance), ...Object.keys(verifier)]) {
      const upper = key.toUpperCase();
      expect(upper, key).not.toContain('P10');
      expect(upper, key).not.toContain('PROTECTED');
      expect(upper, key).not.toContain('EXAM');
      expect(upper, key).not.toContain('GOLDEN');
    }
    expect(JSON.stringify([provenance, verifier])).not.toContain('riya.p10.');
  });

  it('takes no protected index into any AS1-B builder', () => {
    // Both constructors take exactly one argument, and it is the record. The protected corpus stays
    // what it has always been: a validation-time input to the generic validator, never a field.
    expect(createRiyaAiSyntheticExternalIntakeProvenance).toHaveLength(1);
    expect(createRiyaAiSyntheticDeterministicVerifierRun).toHaveLength(1);
  });

  it('still refuses an external corpus whose protected index is unbound', () => {
    // P10 remains a release-gate concern reached through the base policy, not something the external
    // route can opt out of by being external.
    const result = validateRiyaAiSyntheticCorpus({ ...externalCorpus(), policy: policy() });

    expect(result.baseReport.releaseBindingFailures.length).toBeGreaterThan(0);
    expect(kinds(result)).toContain('BASE_VALIDATION_BLOCKED');
    expect(result.report.eligible).toBe(false);
  });
});
