/**
 * AI-synthetic contracts, and the V1 non-regression proofs (AS1, ADR-0143).
 *
 * The second half matters more than the first. AS1's whole risk is that opening a second lane
 * quietly loosens the first one, so the human-review semantics, the Gold provenance rule and the
 * empty Gold corpus are all asserted here as things this slice did NOT change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as aiBarrel from '../ai-synthetic/index.js';
import {
  RIYA_AI_SYNTHETIC_INITIAL_STATE,
  advanceRiyaAiSyntheticCandidate,
  createRiyaAiSyntheticCandidateState,
  createRiyaAiSyntheticCriticVerdict,
  createRiyaAiSyntheticGenerationProvenance,
  createRiyaAiSyntheticScenario,
  riyaAiSyntheticDiversityMetrics,
  riyaAiSyntheticTransitionAllowed,
} from '../ai-synthetic/index.js';
import type { RiyaAiSyntheticScenarioInput } from '../ai-synthetic/index.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import { RIYA_DATASET_REQUIRED_REVIEWS } from '../contracts/vocabularies.js';
import { RIYA_GOLD_REQUIRED_SOURCE_KIND } from '../gold-v1/service/validate-corpus.js';
import {
  RIYA_DATASET_MAX_ASSISTANT_TURNS,
  createRiyaIntelligenceTrajectory,
} from '../contracts/trajectory.js';
import { buildRiyaIntelligenceDatasetManifest } from '../service/create-manifest.js';
import { createRiyaDatasetReleaseEvidence } from '../service/create-release-evidence.js';
import { validateRiyaIntelligenceDataset } from '../service/validate-dataset.js';
import {
  SYNTHETIC_DATASET_INSTANT,
  acceptedReviews,
  emptyTrainingState,
  discoveryTurns,
  releasableOptions,
  syntheticTrajectory,
} from '../testing/fixtures.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));

const SCENARIO: RiyaAiSyntheticScenarioInput = {
  scenarioRef: 'scn.one',
  lineageRootRef: 'lin.one',
  split: 'TRAIN',
  languageMode: 'ENGLISH',
  primaryInteractionKind: 'DISCOVERY',
  secondaryInteractionKinds: [],
  persona: 'EXPLORING',
  difficulty: 'BASIC',
  riskClass: 'STANDARD',
  startPhase: 'INTRO',
  targetAssistantTurns: 6,
  plannedDiscoveryFields: ['budget'],
  plannedCustomerFacts: [{ field: 'location', value: 'city.alpha' }],
  requiredAuthorityFactClasses: [],
  requiredAssistantDecisions: ['ASK_DISCOVERY'],
  requiredResponseObjectives: ['DISCOVER'],
  customerBehaviorCodes: ['SHORT_REPLY'],
  requiredConversationEvents: ['ASK_ONE_DISCOVERY_QUESTION'],
  forbiddenBehaviors: ['CANNED_OPENER'],
};

// ---------------------------------------------------------------------------
// The scenario has nowhere to put a sentence.
// ---------------------------------------------------------------------------

describe('a scenario is a plan, not a conversation', () => {
  it('has no field a turn would fit in', () => {
    const scenario = createRiyaAiSyntheticScenario(SCENARIO);

    for (const absent of ['turns', 'text', 'exampleReply', 'transcript', 'idealConversation']) {
      expect(Object.keys(scenario), absent).not.toContain(absent);
    }
    const serialized = JSON.stringify(scenario);
    for (const shape of ['"type":"USER"', '"type":"ASSISTANT"', 'annotation', 'turnRef']) {
      expect(serialized, shape).not.toContain(shape);
    }
  });

  it('refuses a planned value that is dialogue rather than data', () => {
    for (const value of [
      'Customer: we want a modular kitchen',
      'He said "around six lakh" to me',
      'We just moved in. We want the kitchen done first.',
    ]) {
      expect(() =>
        createRiyaAiSyntheticScenario({
          ...SCENARIO,
          plannedCustomerFacts: [{ field: 'scope', value }],
        }),
      ).toThrow(RiyaDatasetError);
    }
  });

  it('refuses a planned value carrying a secret or contact detail', () => {
    expect(() =>
      createRiyaAiSyntheticScenario({
        ...SCENARIO,
        plannedCustomerFacts: [{ field: 'scope', value: 'reach me at someone@example.com' }],
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('requires lineage and split BEFORE generation, and freezes them', () => {
    const scenario = createRiyaAiSyntheticScenario(SCENARIO);

    expect(scenario.lineageRootRef).toBe('lin.one');
    expect(scenario.split).toBe('TRAIN');
    expect(Object.isFrozen(scenario)).toBe(true);
    for (const field of ['lineageRootRef', 'split'] as const) {
      const { [field]: _dropped, ...without } = SCENARIO;
      expect(() => createRiyaAiSyntheticScenario(without as never)).toThrow(RiyaDatasetError);
    }
  });

  it('holds depth to the lane bounds of 4 to 12', () => {
    for (const turns of [3, 13]) {
      expect(() =>
        createRiyaAiSyntheticScenario({ ...SCENARIO, targetAssistantTurns: turns }),
      ).toThrow(RiyaDatasetError);
    }
    expect(createRiyaAiSyntheticScenario({ ...SCENARIO, targetAssistantTurns: 4 })).toBeDefined();
    expect(createRiyaAiSyntheticScenario({ ...SCENARIO, targetAssistantTurns: 12 })).toBeDefined();
  });

  it('refuses a plan that asserts business truth with no authority to rest on', () => {
    expect(() =>
      createRiyaAiSyntheticScenario({
        ...SCENARIO,
        requiredAssistantDecisions: ['USE_CORE_TRUTH'],
        requiredAuthorityFactClasses: [],
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('encodes behaviour, never identity', () => {
    const serialized = JSON.stringify(aiBarrel.RIYA_AI_SYNTHETIC_BEHAVIOR_CODES).toUpperCase();
    for (const forbidden of [
      'CASTE',
      'RELIGION',
      'ETHNIC',
      'GENDER',
      'MALE',
      'FEMALE',
      'AGE',
      'POLITIC',
      'MEDICAL',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Provenance and critic.
// ---------------------------------------------------------------------------

describe('generation roles are separated in the record itself', () => {
  const PROVENANCE = {
    generationRef: 'gen.one',
    scenarioRef: 'scn.one',
    scenarioSha256: 'a'.repeat(64),
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.simulator',
    riyaTeacherConfigRef: 'cfg.teacher',
    annotationVerifierConfigRef: 'cfg.verifier',
  };

  it('refuses a verifier that is the teacher', () => {
    expect(() =>
      createRiyaAiSyntheticGenerationProvenance({
        ...PROVENANCE,
        annotationVerifierConfigRef: 'cfg.teacher',
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('refuses a bundle ref that is also one of its roles', () => {
    expect(() =>
      createRiyaAiSyntheticGenerationProvenance({ ...PROVENANCE, generationRef: 'cfg.teacher' }),
    ).toThrow(RiyaDatasetError);
  });

  it('carries no prompt, key, url or reasoning field', () => {
    const record = createRiyaAiSyntheticGenerationProvenance(PROVENANCE);

    for (const absent of ['prompt', 'apiKey', 'url', 'reasoning', 'temperature', 'output']) {
      expect(Object.keys(record), absent).not.toContain(absent);
    }
  });
});

describe('a critic verdict is a decision and closed dimensions', () => {
  it('carries no rationale, comment, score or confidence', () => {
    const verdict = createRiyaAiSyntheticCriticVerdict({
      criticRef: 'critic.one',
      criticConfigRef: 'cfg.critic.one',
      decision: 'ACCEPTED',
      satisfiedQualityDimensions: ['CLARITY'],
    });

    for (const absent of ['comment', 'rationale', 'confidence', 'score', 'explanation', 'text']) {
      expect(Object.keys(verdict), absent).not.toContain(absent);
    }
  });

  it('refuses an acceptance that also names a failed dimension', () => {
    expect(() =>
      createRiyaAiSyntheticCriticVerdict({
        criticRef: 'critic.one',
        criticConfigRef: 'cfg.critic.one',
        decision: 'ACCEPTED',
        satisfiedQualityDimensions: ['CLARITY'],
        failedQualityDimensions: ['NATURALNESS'],
      }),
    ).toThrow(RiyaDatasetError);
  });

  it('refuses a rejection that names nothing', () => {
    expect(() =>
      createRiyaAiSyntheticCriticVerdict({
        criticRef: 'critic.one',
        criticConfigRef: 'cfg.critic.one',
        decision: 'REJECTED',
        satisfiedQualityDimensions: [],
      }),
    ).toThrow(RiyaDatasetError);
  });
});

// ---------------------------------------------------------------------------
// The state machine.
// ---------------------------------------------------------------------------

describe('the candidate lifecycle is forward-only', () => {
  it('starts at PLANNED', () => {
    expect(RIYA_AI_SYNTHETIC_INITIAL_STATE).toBe('PLANNED');
  });

  it('advances one step at a time and refuses a skip', () => {
    const candidate = createRiyaAiSyntheticCandidateState({
      candidateRef: 'cand.one',
      scenarioRef: 'scn.one',
      state: 'PLANNED',
    });

    expect(advanceRiyaAiSyntheticCandidate(candidate, 'GENERATED').state).toBe('GENERATED');
    expect(() => advanceRiyaAiSyntheticCandidate(candidate, 'ACCEPTED')).toThrow(RiyaDatasetError);
  });

  it('never lets QUARANTINED become ACCEPTED', () => {
    // ADR-0143 §19. There is no human to adjudicate a protected near-leak, so it is discarded.
    expect(riyaAiSyntheticTransitionAllowed('QUARANTINED', 'ACCEPTED')).toBe(false);
    for (const state of aiBarrel.RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES) {
      expect(riyaAiSyntheticTransitionAllowed('QUARANTINED', state), state).toBe(false);
      expect(riyaAiSyntheticTransitionAllowed('REJECTED', state), state).toBe(false);
      expect(riyaAiSyntheticTransitionAllowed('ACCEPTED', state), state).toBe(false);
    }
  });

  it('allows an exit to REJECTED or QUARANTINED from any live state', () => {
    for (const state of aiBarrel.RIYA_AI_SYNTHETIC_PROGRESSION) {
      if (state === 'ACCEPTED') continue;
      expect(riyaAiSyntheticTransitionAllowed(state, 'REJECTED'), state).toBe(true);
      expect(riyaAiSyntheticTransitionAllowed(state, 'QUARANTINED'), state).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Diversity metrics are deterministic and content-free.
// ---------------------------------------------------------------------------

describe('diversity metrics are deterministic and carry no text', () => {
  it('returns the same numbers for the same corpus', () => {
    const corpus = [
      syntheticTrajectory({ teacherRef: 'gen.one', review: [] }),
      syntheticTrajectory({
        trajectoryId: 'riya.two',
        lineageRootRef: 'lin.two',
        teacherRef: 'gen.two',
        review: [],
        turns: discoveryTurns({ userText: 'A different opening message from the customer here.' }),
      }),
    ];

    expect(riyaAiSyntheticDiversityMetrics(corpus)).toStrictEqual(
      riyaAiSyntheticDiversityMetrics(corpus),
    );
  });

  it('reports only numbers — never a phrase', () => {
    const metrics = riyaAiSyntheticDiversityMetrics([
      syntheticTrajectory({ teacherRef: 'gen.one', review: [] }),
    ]);

    for (const value of Object.values(metrics)) {
      expect(typeof value).toBe('number');
    }
  });

  it('handles an empty corpus without dividing by zero', () => {
    expect(riyaAiSyntheticDiversityMetrics([]).fingerprintUniquenessBp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// V1 NON-REGRESSION. This is the half that matters.
// ---------------------------------------------------------------------------

describe('AS1 changes nothing about the human-review lane', () => {
  it('leaves the required-review counts exactly as they were', () => {
    expect(RIYA_DATASET_REQUIRED_REVIEWS).toStrictEqual({ STANDARD: 1, HIGH_RISK: 2 });
  });

  it('still refuses a human-authored corpus with no reviews', () => {
    const report = validateRiyaIntelligenceDataset(
      [syntheticTrajectory({ review: [] })],
      releasableOptions(),
    );

    expect(report.insufficientReview.length).toBe(1);
    expect(report.eligible).toBe(false);
  });

  it('still refuses a TEACHER row with no reviews, through the generic validator', () => {
    // The generic lane is unchanged: a teacher row there still needs human review, and only the
    // ai-synthetic validator may reach a different verdict.
    const report = validateRiyaIntelligenceDataset(
      [syntheticTrajectory({ teacherRef: 'gen.one', review: [] })],
      releasableOptions(),
    );

    expect(report.insufficientReview.length).toBe(1);
    expect(report.eligible).toBe(false);
  });

  it('still accepts a properly reviewed human corpus', () => {
    const report = validateRiyaIntelligenceDataset(
      [syntheticTrajectory({ review: acceptedReviews(1) })],
      releasableOptions(),
    );

    expect(report.insufficientReview).toStrictEqual([]);
    expect(report.eligible).toBe(true);
  });

  it('keeps the generic release evidence literally trainingApproval false', () => {
    // Issued for real, so the assertion is about the artifact rather than about a type annotation.
    const trajectories = [syntheticTrajectory({ review: acceptedReviews(1) })];
    const report = validateRiyaIntelligenceDataset(trajectories, releasableOptions());
    const manifest = buildRiyaIntelligenceDatasetManifest({
      datasetId: 'riya.human.lane',
      datasetVersion: 1,
      policyVersion: 1,
      trajectories,
      createdAt: SYNTHETIC_DATASET_INSTANT,
    });

    const issued = createRiyaDatasetReleaseEvidence({ report, manifest });

    // Narrow the result union BEFORE reading the evidence. The failure arm carries a bounded code
    // and no artifact, so reaching through it would be an assertion rather than a proof.
    if (!issued.ok) {
      throw new Error(`expected release evidence, got ${issued.code}`);
    }
    expect(issued.evidence.trainingApproval).toBe(false);
    expect(issued.evidence.syntheticOnly).toBe(true);
  });

  it('keeps the AI-synthetic depth ceiling inside the generic one', () => {
    // The invariant that used to be an unreachable runtime `if` in `ai-synthetic/contracts/
    // vocabularies.ts`. It belongs here: the drift it guards against is a source edit.
    expect(aiBarrel.RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS).toBeLessThanOrEqual(
      RIYA_DATASET_MAX_ASSISTANT_TURNS,
    );
    expect(aiBarrel.RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS).toBeLessThan(
      aiBarrel.RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS,
    );
  });

  it('leaves the Gold lane requiring human authorship', () => {
    // The rule itself, unchanged by AS1. `gold-v1-corpus.test.ts` already proves the finding fires
    // against real assignments; what matters here is that opening a teacher lane did not relax the
    // constant that lane is judged by.
    expect(RIYA_GOLD_REQUIRED_SOURCE_KIND).toBe('HUMAN_AUTHORED_SYNTHETIC');
  });

  it('leaves the Human Gold Batch-1 corpus empty', () => {
    const corpus = readFileSync(
      join(PKG, 'data', 'human-gold-v1', 'wave-1', 'batch-1.jsonl'),
      'utf8',
    );

    expect(corpus).toBe('');
  });

  it('does not widen the root barrel', () => {
    // The AI lane lives entirely on its own subpath. Nothing named for it appears at the root.
    for (const key of Object.keys(barrel)) {
      expect(key.toUpperCase(), key).not.toContain('AI_SYNTHETIC');
      expect(key.toUpperCase(), key).not.toContain('AISYNTHETIC');
    }
  });

  it('still builds a human-authored trajectory with no teacherRef', () => {
    const human = createRiyaIntelligenceTrajectory({
      version: 1,
      trajectoryId: 'riya.human.one',
      trajectoryRevision: 1,
      lineageRootRef: 'lin.human',
      split: 'TRAIN',
      languageMode: 'ENGLISH',
      primaryInteractionKind: 'DISCOVERY',
      secondaryInteractionKinds: [],
      persona: 'EXPLORING',
      difficulty: 'BASIC',
      riskClass: 'STANDARD',
      source: { kind: 'HUMAN_AUTHORED_SYNTHETIC', sourceRef: 'author.alpha', synthetic: true },
      initialState: emptyTrainingState(),
      turns: discoveryTurns(),
      review: [...acceptedReviews(1)],
    });

    expect(human.source.teacherRef).toBeUndefined();
  });
});
