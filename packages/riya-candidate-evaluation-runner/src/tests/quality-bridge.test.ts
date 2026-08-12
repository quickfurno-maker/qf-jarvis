/**
 * The P10 half of the bridge: capture, the blinded bundle, the external write, and review ingest.
 *
 * Two properties carry this file. First, the bridge measures what it can measure and refuses to
 * synthesize what it cannot — a reply whose language it cannot identify fails its case rather than
 * being recorded as the mode the fixture hoped for. Second, the two-reviewer rule survives contact
 * with an implementation: one review does not satisfy it, and the same person twice does not either.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createApprovalEvidence,
  createEvaluationBinding,
  createSuiteThresholds,
} from '@qf-jarvis/model-evaluation';
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';
import {
  createRiyaQualityCandidateBinding,
  createRiyaQualitySuite,
  RIYA_QUALITY_CANONICAL_THRESHOLDS_V1,
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
} from '@qf-jarvis/riya-quality-evaluation';
import type {
  RiyaQualityHumanReviewInput,
  RiyaQualitySuiteV1,
} from '@qf-jarvis/riya-quality-evaluation';
import {
  RIYA_QUALITY_GOLDEN_FIXTURES,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SCENARIOS,
  RIYA_QUALITY_GOLDEN_SUITE_ID,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from '@qf-jarvis/riya-quality-evaluation/testing';
import type { RiyaQualityGoldenFixture } from '@qf-jarvis/riya-quality-evaluation/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import { captureRiyaQualityCandidates } from '../quality/capture.js';
import type {
  RiyaQualityCandidateCapture,
  RiyaQualityCandidateRequest,
} from '../quality/capture.js';
import {
  evaluateRiyaQualityFromReviews,
  ingestRiyaQualityReviews,
} from '../quality/ingest-reviews.js';
import type { RiyaQualityCaseReviews } from '../quality/ingest-reviews.js';
import { buildRiyaQualityReviewBundle } from '../quality/review-bundle.js';
import {
  RIYA_SAFETY_FIXTURE_MANIFEST_ID,
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
  RIYA_SAFETY_SUITE_ID,
  RIYA_SAFETY_SUITE_VERSION,
} from '../safety/fixtures.js';
import { writeRiyaQualityReviewBundle } from '../quality/write-bundle.js';
import { runRiyaSafetyCandidate } from '../safety/run-safety.js';
import { FakeQualityCandidate, FakeSafetyCandidate } from '../testing/fakes.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratchDirs: string[] = [];

afterAll(() => {
  for (const directory of scratchDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-bundle-'));
  scratchDirs.push(directory);
  return directory;
}

/** Real safety evidence, produced by the bridge itself. Quality cannot exist without it. */
async function safetyEvidence(): Promise<ApprovalEvidence> {
  const result = await runRiyaSafetyCandidate({
    port: new FakeSafetyCandidate(),
    binding: createEvaluationBinding({
      // The exported identity, not a retyped literal — see the same restatement in safety-bridge.
      evaluationSuiteId: RIYA_SAFETY_SUITE_ID,
      evaluationSuiteVersion: RIYA_SAFETY_SUITE_VERSION,
      fixtureManifestId: RIYA_SAFETY_FIXTURE_MANIFEST_ID,
      fixtureManifestVersion: RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
      evaluatorImplId: 'qfj.eval.deterministic',
      evaluatorImplVersion: 1,
      release: {
        releaseId: 'rel.fake.candidate.v1',
        providerId: 'fake',
        modelId: 'fake-model',
        modelVersion: 'v1',
        configDigest: 'abcdef01',
        executionClass: 'HOSTED',
      },
      promptFamily: 'prompt.family.fake',
      promptVersion: 1,
      promptDigest: 'a'.repeat(64),
      capabilityProfileRef: 'cap.profile.fake',
      knowledgeRevision: 'know.rev.1',
      policyContractRevision: 'policy.rev.1',
      createdAt: '2026-08-12T00:00:00Z',
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
  });
  if (result.status !== 'EVALUATED') {
    throw new Error('safety run blocked');
  }
  const evidence = createApprovalEvidence(result.suiteResult, 'SHADOW_ELIGIBILITY', {
    createdAt: '2026-08-12T00:00:00Z',
  });
  if (!evidence.ok) {
    throw new Error(`safety evidence blocked: ${evidence.code}`);
  }
  return evidence.evidence;
}

async function qualitySuite(): Promise<RiyaQualitySuiteV1> {
  return createRiyaQualitySuite({
    binding: createRiyaQualityCandidateBinding({
      safetyEvidence: await safetyEvidence(),
      qualitySuiteId: RIYA_QUALITY_GOLDEN_SUITE_ID,
      qualitySuiteVersion: RIYA_QUALITY_GOLDEN_SUITE_VERSION,
      fixtureManifestId: RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
      fixtureManifestVersion: RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
      thresholdsId: RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsId,
      thresholdsVersion: RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsVersion,
      createdAt: '2026-08-12T00:00:00Z',
    }),
    scenarios: RIYA_QUALITY_GOLDEN_SCENARIOS,
    thresholds: RIYA_QUALITY_CANONICAL_THRESHOLDS_V1,
  });
}

/** Two distinct reviewers marking every dimension satisfied. */
function twoReviews(): readonly RiyaQualityHumanReviewInput[] {
  return ['reviewer.alpha', 'reviewer.beta'].map((reviewRef) => ({
    version: 1 as const,
    reviewRef,
    satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
  }));
}

/**
 * Completed review envelopes, each carrying the digest of the case a reviewer was actually shown.
 * This is what an honest review tool returns.
 */
function reviewsFor(
  captures: readonly RiyaQualityCandidateCapture[],
  reviews: readonly RiyaQualityHumanReviewInput[] = twoReviews(),
): readonly RiyaQualityCaseReviews[] {
  return buildRiyaQualityReviewBundle({ captures }).cases.map((reviewCase) => ({
    caseRef: reviewCase.caseRef,
    caseDigest: reviewCase.caseDigest,
    reviews,
  }));
}

async function captureAll(): Promise<readonly RiyaQualityCandidateCapture[]> {
  const result = await captureRiyaQualityCandidates({ port: new FakeQualityCandidate() });
  if (!result.ok) {
    throw new Error('capture incomplete');
  }
  return result.captures;
}

// ---------------------------------------------------------------------------
// Capture.
// ---------------------------------------------------------------------------

describe('P10 capture consumes the governed corpus unchanged', () => {
  it('runs every governed fixture exactly once', async () => {
    const port = new FakeQualityCandidate();
    const result = await captureRiyaQualityCandidates({ port });
    expect(result.ok).toBe(true);
    expect(port.executedCaseIds).toHaveLength(RIYA_QUALITY_GOLDEN_FIXTURES.length);
    expect(new Set(port.executedCaseIds).size).toBe(RIYA_QUALITY_GOLDEN_FIXTURES.length);
    expect(result.ok ? result.captures.length : 0).toBe(RIYA_QUALITY_GOLDEN_FIXTURES.length);
  });

  it('does not reduce the corpus for MVP — it is the full governed set', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURES.length).toBe(RIYA_QUALITY_GOLDEN_SCENARIOS.length);
    expect(RIYA_QUALITY_GOLDEN_FIXTURES.length).toBeGreaterThanOrEqual(72);
  });

  it('COMPUTES the counts rather than accepting them from the adapter', async () => {
    const captures = await captureAll();
    for (const capture of captures) {
      expect(capture.replyCharCount).toBe(capture.replyBody.length);
      expect(capture.questionCount).toBe(capture.replyBody.split('?').length - 1);
    }
  });

  it('carries citations and phase through from the typed result', async () => {
    const captures = await captureAll();
    const byFixtureId = new Map(RIYA_QUALITY_GOLDEN_FIXTURES.map((f) => [f.fixtureId, f]));
    for (const capture of captures) {
      const fixture = byFixtureId.get(capture.fixtureId);
      expect(fixture).toBeDefined();
      expect(capture.citations).toStrictEqual(fixture?.passingShape.citations ?? []);
      expect(capture.continuityPhaseAfter).toBe(fixture?.passingShape.continuityPhaseAfter);
    }
  });

  it('synthesizes NO subjective field — a capture has no dimension verdict at all', async () => {
    const captures = await captureAll();
    const first = captures[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(Object.keys(first)).not.toContain('humanReviews');
      expect(Object.keys(first)).not.toContain('satisfiedDimensions');
      expect(Object.keys(first)).not.toContain('dimensions');
    }
  });

  it.each([
    [
      'a reply the strict schema refused',
      { structuredOutputWellFormed: false },
      'structured-output-invalid',
    ],
    [
      'an unidentifiable language',
      { replyLanguageMode: 'UNKNOWN' as const },
      'language-mode-unknown',
    ],
    ['an empty reply', { replyBody: '' }, 'empty-reply'],
  ])('FAILS THE CASE FOR %s rather than inventing a value', async (_name, override, reason) => {
    const target = RIYA_QUALITY_GOLDEN_FIXTURES[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const result = await captureRiyaQualityCandidates({
      port: new FakeQualityCandidate({ [target.fixtureId]: override }),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.incomplete).toStrictEqual([
      { fixtureId: target.fixtureId, reason },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The situation reaches the candidate; the marking scheme does not (MVP-P2A.2 inputs).
// ---------------------------------------------------------------------------

describe('a grounded P10 case is given the source it is expected to cite', () => {
  const groundedFixtures = RIYA_QUALITY_GOLDEN_FIXTURES.filter(
    (f) => f.syntheticGroundedKnowledge !== undefined,
  );

  async function requests(
    fixtures?: readonly RiyaQualityGoldenFixture[],
  ): Promise<readonly RiyaQualityCandidateRequest[]> {
    const port = new FakeQualityCandidate();
    await captureRiyaQualityCandidates(fixtures === undefined ? { port } : { port, fixtures });
    return port.executedRequests;
  }

  it('carries the fixture INPUT record to all eighteen grounded cases', async () => {
    const sent = await requests();
    const byCase = new Map(sent.map((one) => [one.caseId, one]));
    expect(groundedFixtures).toHaveLength(18);
    for (const fixture of groundedFixtures) {
      const request = byCase.get(fixture.fixtureId);
      expect(request?.groundedKnowledge, fixture.fixtureId).toStrictEqual(
        fixture.syntheticGroundedKnowledge,
      );
    }
  });

  it('omits the field entirely on the other fifty-four', async () => {
    const sent = await requests();
    const ungrounded = sent.filter(
      (one) =>
        !groundedFixtures.some((fixture) => fixture.fixtureId === one.caseId) &&
        one.caseId.length > 0,
    );
    expect(ungrounded).toHaveLength(54);
    for (const request of ungrounded) {
      expect(Object.keys(request).sort(), request.caseId).toStrictEqual([
        'caseId',
        'continuityPhaseBefore',
        'syntheticUserText',
      ]);
    }
  });

  it('THE CANDIDATE INPUT DOES NOT COME FROM THE EXPECTED CITATION', async () => {
    // Move the answer key and nothing else. What the candidate is shown must not follow it — otherwise
    // editing an expectation would silently tell the model which source to name.
    const target = groundedFixtures[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const drifted: RiyaQualityGoldenFixture = {
      ...target,
      passingShape: {
        ...target.passingShape,
        citations: [{ knowledgeId: 'knowledge.answer-key.alpha', version: 99 }],
      },
    };
    const sent = await requests([drifted]);
    const supplied = sent[0]?.groundedKnowledge?.records[0];
    expect(supplied?.knowledgeId).toBe(target.syntheticGroundedKnowledge?.records[0]?.knowledgeId);
    expect(supplied?.knowledgeId).not.toBe('knowledge.answer-key.alpha');
    expect(supplied?.version).not.toBe(99);
    expect(JSON.stringify(sent[0])).not.toContain('knowledge.answer-key.alpha');
  });

  it('a grounded request still carries NO marking scheme', async () => {
    const sent = await requests();
    const grounded = sent.filter((one) => one.groundedKnowledge !== undefined);
    expect(grounded).toHaveLength(18);
    for (const request of grounded) {
      expect(Object.keys(request).sort(), request.caseId).toStrictEqual([
        'caseId',
        'continuityPhaseBefore',
        'groundedKnowledge',
        'syntheticUserText',
      ]);
      const serialized = JSON.stringify(request).toLowerCase();
      for (const leak of [
        'requiredcitation',
        'requiredqualitydimensions',
        'passingshape',
        'expectedobservations',
        'maxreplychars',
        'maxquestions',
        'allowedcontinuityphasesafter',
        'forbiddenobservationfields',
      ]) {
        expect(serialized, `${request.caseId} leaks ${leak}`).not.toContain(leak);
      }
    }
  });

  it('the knowledge input reaching the port is the minimized five-field shape', async () => {
    const sent = await requests();
    for (const request of sent.filter((one) => one.groundedKnowledge !== undefined)) {
      expect(Object.keys(request.groundedKnowledge ?? {}).sort()).toStrictEqual([
        'records',
        'state',
      ]);
      expect(request.groundedKnowledge?.state).toBe('CURRENT');
      for (const record of request.groundedKnowledge?.records ?? []) {
        expect(Object.keys(record).sort()).toStrictEqual([
          'content',
          'contentFormat',
          'knowledgeId',
          'topic',
          'version',
        ]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The blinded bundle.
// ---------------------------------------------------------------------------

describe('the review bundle is blinded, and the writer stays out of the repository', () => {
  it('REVEALS NO PROVIDER, MODEL, SIZE, COST OR SPEED', async () => {
    const bundle = buildRiyaQualityReviewBundle({ captures: await captureAll() });
    // Three separate claims. First: no candidate IDENTITY token in anything a reviewer READS,
    // including the reply itself, because a model that names itself unblinds them just as
    // effectively. Scanned over the human-readable fields rather than the whole document, because a
    // 64-character hex digest contains arbitrary substrings and matching one would be noise.
    const readable = bundle.cases
      .map((one) =>
        [
          one.caseRef,
          one.languageMode,
          one.interactionKind,
          one.clientMessage,
          one.candidateReply,
          ...one.requiredDimensions,
        ].join(' '),
      )
      .join(' ')
      .toLowerCase();
    for (const forbidden of ['groq', 'gpt-oss', 'openai', 'anthropic', 'llama', '20b', '120b']) {
      expect(readable, `bundle must not name ${forbidden}`).not.toContain(forbidden);
    }
    // Second: the digest is opaque hex and therefore carries nothing legible at all.
    for (const one of bundle.cases) {
      expect(one.caseDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
    // Third: no FIELD that could carry provider, cost or speed exists at all. Scanned over keys
    // rather than values, because "price" is an ordinary word a client message may legitimately use
    // and a synthetic objection case does.
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          collect(item);
        }
      }
    };
    collect(bundle);
    for (const forbidden of [
      'provider',
      'model',
      'release',
      'price',
      'cost',
      'latency',
      'speed',
      'tokens',
    ]) {
      for (const key of keys) {
        expect(key, `bundle key ${key} must not mention ${forbidden}`).not.toContain(forbidden);
      }
    }
    for (const reviewCase of bundle.cases) {
      expect(Object.keys(reviewCase).sort()).toStrictEqual([
        'candidateReply',
        'caseDigest',
        'caseRef',
        'clientMessage',
        'interactionKind',
        'languageMode',
        'requiredDimensions',
      ]);
      expect(reviewCase.caseDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('states the governed number of independent reviews per case', async () => {
    const bundle = buildRiyaQualityReviewBundle({ captures: await captureAll() });
    expect(bundle.requiredReviewsPerCase).toBe(RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS);
    expect(bundle.cases).toHaveLength(RIYA_QUALITY_GOLDEN_FIXTURES.length);
  });

  it('REFUSES A REPOSITORY-INTERNAL OUTPUT PATH', async () => {
    const bundle = buildRiyaQualityReviewBundle({ captures: await captureAll() });
    expect(() =>
      writeRiyaQualityReviewBundle({
        bundle,
        outputPath: join(REPO_ROOT, 'review-bundle.json'),
        repoRoot: REPO_ROOT,
      }),
    ).toThrow(RiyaCandidateRunnerError);
  });

  it('refuses to overwrite unless told twice', async () => {
    const bundle = buildRiyaQualityReviewBundle({ captures: await captureAll() });
    const directory = scratch();
    const outputPath = join(directory, 'bundle.json');
    writeFileSync(outputPath, 'existing', 'utf8');
    expect(() => writeRiyaQualityReviewBundle({ bundle, outputPath, repoRoot: REPO_ROOT })).toThrow(
      RiyaCandidateRunnerError,
    );
    const receipt = writeRiyaQualityReviewBundle({
      bundle,
      outputPath,
      repoRoot: REPO_ROOT,
      overwrite: true,
    });
    expect(receipt.caseCount).toBe(bundle.cases.length);
  });

  it('the receipt names counts and a path, and no content', async () => {
    const bundle = buildRiyaQualityReviewBundle({ captures: await captureAll() });
    const outputPath = join(scratch(), 'bundle.json');
    const receipt = writeRiyaQualityReviewBundle({ bundle, outputPath, repoRoot: REPO_ROOT });
    expect(Object.keys(receipt).sort()).toStrictEqual([
      'caseCount',
      'outputPath',
      'requiredReviewsPerCase',
    ]);
    const written = JSON.parse(readFileSync(outputPath, 'utf8')) as { cases: unknown[] };
    expect(written.cases).toHaveLength(RIYA_QUALITY_GOLDEN_FIXTURES.length);
  });
});

// ---------------------------------------------------------------------------
// Review ingest.
// ---------------------------------------------------------------------------

describe('two independent humans, and the rule is not negotiable', () => {
  it('accepts two DISTINCT reviews per case and evaluates the suite', async () => {
    const captures = await captureAll();
    const outcome = evaluateRiyaQualityFromReviews({
      suite: await qualitySuite(),
      captures,
      caseReviews: reviewsFor(captures),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && 'result' in outcome) {
      expect(outcome.result.caseResults).toHaveLength(RIYA_QUALITY_GOLDEN_FIXTURES.length);
    }
  });

  it('THE SAME REVIEWER TWICE DOES NOT SATISFY THE TWO-REVIEW RULE', async () => {
    const captures = await captureAll();
    const duplicate: readonly RiyaQualityHumanReviewInput[] = [
      {
        version: 1,
        reviewRef: 'reviewer.alpha',
        satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
      },
      {
        version: 1,
        reviewRef: 'reviewer.alpha',
        satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
      },
    ];
    const ingested = ingestRiyaQualityReviews({
      captures,
      caseReviews: reviewsFor(captures, duplicate),
    });
    expect(ingested.ok).toBe(false);
    expect(ingested.ok ? [] : ingested.rejections.map((one) => one.reason)).toContain(
      'duplicate-reviewer',
    );
  });

  it('ONE REVIEW DOES NOT SATISFY IT EITHER', async () => {
    const captures = await captureAll();
    const single: readonly RiyaQualityHumanReviewInput[] = [
      {
        version: 1,
        reviewRef: 'reviewer.alpha',
        satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
      },
    ];
    const ingested = ingestRiyaQualityReviews({
      captures,
      caseReviews: reviewsFor(captures, single),
    });
    expect(ingested.ok).toBe(false);
    expect(ingested.ok ? [] : ingested.rejections.map((one) => one.reason)).toContain(
      'insufficient-independent-reviews',
    );
  });

  it('a missing case review is a refusal, not a silent skip', async () => {
    const captures = await captureAll();
    const ingested = ingestRiyaQualityReviews({
      captures,
      caseReviews: reviewsFor(captures).slice(1),
    });
    expect(ingested.ok).toBe(false);
    expect(ingested.ok ? [] : ingested.rejections.map((one) => one.reason)).toContain(
      'missing-case-review',
    );
  });

  it('a review for a case that was never captured is refused', async () => {
    const captures = await captureAll();
    const ingested = ingestRiyaQualityReviews({
      captures,
      caseReviews: [
        ...reviewsFor(captures),
        { caseRef: 'case-999', caseDigest: 'f'.repeat(64), reviews: twoReviews() },
      ],
    });
    expect(ingested.ok).toBe(false);
    expect(ingested.ok ? [] : ingested.rejections.map((one) => one.reason)).toContain(
      'unknown-case-ref',
    );
  });

  it('a review carrying a comment or a name is refused by the governed contract', async () => {
    const captures = await captureAll();
    const tainted = [
      {
        version: 1 as const,
        reviewRef: 'reviewer.alpha',
        satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
        comment: 'the reply quoted here would be conversation content in an artifact',
      },
      {
        version: 1 as const,
        reviewRef: 'reviewer.beta',
        satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
      },
    ] as unknown as readonly RiyaQualityHumanReviewInput[];
    const ingested = ingestRiyaQualityReviews({
      captures,
      caseReviews: reviewsFor(captures, tainted),
    });
    expect(ingested.ok).toBe(false);
    expect(ingested.ok ? [] : ingested.rejections.map((one) => one.reason)).toContain(
      'review-schema-invalid',
    );
  });
});
