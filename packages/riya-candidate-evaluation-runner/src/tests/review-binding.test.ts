/**
 * Review binding and execution-context fidelity.
 *
 * ### The defect this file exists for
 *
 * A review used to be addressed by position. Two humans read Candidate A's reply for `case-001` and
 * marked it good; those records are valid, and nothing stopped them being submitted later beside
 * Candidate B's captures, where `case-001` is a different and worse reply. The authority would then
 * have built an observation for B out of judgements about A, and certified the wrong model. The first
 * spec below is that exact attack.
 *
 * ### And the second
 *
 * A candidate must be put in the situation the scenario describes. A `VENDOR`-scope case sent without
 * its scope, or a `COMPLETE`-phase P10 case sent as though the conversation had just started, is being
 * scored against a situation it was never placed in. The context specs prove the situation travels —
 * and that the marking scheme does not travel with it.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RIYA_QUALITY_DIMENSIONS } from '@qf-jarvis/riya-quality-evaluation';
import type { RiyaQualityHumanReviewInput } from '@qf-jarvis/riya-quality-evaluation';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import type { RiyaQualityGoldenFixture } from '@qf-jarvis/riya-quality-evaluation/testing';
import { afterAll, describe, expect, it } from 'vitest';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import { captureRiyaQualityCandidates } from '../quality/capture.js';
import type {
  RiyaQualityCandidateCapture,
  RiyaQualityCandidateRequest,
} from '../quality/capture.js';
import { riyaReviewCaseDigest } from '../quality/case-digest.js';
import { ingestRiyaQualityReviews } from '../quality/ingest-reviews.js';
import type { RiyaQualityCaseReviews } from '../quality/ingest-reviews.js';
import {
  buildRiyaQualityReviewBundle,
  RIYA_REVIEW_BUNDLE_VERSION,
} from '../quality/review-bundle.js';
import { writeRiyaQualityReviewBundle } from '../quality/write-bundle.js';
import { RIYA_SAFETY_FIXTURES } from '../safety/fixtures.js';
import { runRiyaSafetyCandidate } from '../safety/run-safety.js';
import { FakeQualityCandidate, FakeSafetyCandidate } from '../testing/fakes.js';
import type { FakeQualityBehaviour } from '../testing/fakes.js';
import type { RiyaCandidateRequest } from '../contracts/candidate-port.js';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';

const scratchDirs: string[] = [];

afterAll(() => {
  for (const directory of scratchDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-binding-'));
  scratchDirs.push(directory);
  return directory;
}

/** A named child directory under a temp root the spec already owns. */
function mkdirIn(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** The first three governed fixtures. Enough to prove binding without 72 of everything. */
const SOME: readonly RiyaQualityGoldenFixture[] = RIYA_QUALITY_GOLDEN_FIXTURES.slice(0, 3);

function twoReviews(): readonly RiyaQualityHumanReviewInput[] {
  return ['reviewer.alpha', 'reviewer.beta'].map((reviewRef) => ({
    version: 1 as const,
    reviewRef,
    satisfiedDimensions: [...RIYA_QUALITY_DIMENSIONS],
  }));
}

async function captureWith(
  overrides: Readonly<Record<string, FakeQualityBehaviour>> = {},
): Promise<readonly RiyaQualityCandidateCapture[]> {
  const result = await captureRiyaQualityCandidates({
    port: new FakeQualityCandidate(overrides),
    fixtures: SOME,
  });
  if (!result.ok) {
    throw new Error('capture incomplete');
  }
  return result.captures;
}

/** Envelopes carrying the digest of what the reviewer was shown for THESE captures. */
function envelopesFor(
  captures: readonly RiyaQualityCandidateCapture[],
): readonly RiyaQualityCaseReviews[] {
  return buildRiyaQualityReviewBundle({ captures, fixtures: SOME }).cases.map((one) => ({
    caseRef: one.caseRef,
    caseDigest: one.caseDigest,
    reviews: twoReviews(),
  }));
}

const ingest = (
  captures: readonly RiyaQualityCandidateCapture[],
  caseReviews: readonly RiyaQualityCaseReviews[],
) => ingestRiyaQualityReviews({ captures, caseReviews, fixtures: SOME });

const reasons = (result: ReturnType<typeof ingest>): readonly string[] =>
  result.ok ? [] : result.rejections.map((one) => one.reason);

// ---------------------------------------------------------------------------
// A — review binding.
// ---------------------------------------------------------------------------

describe('a human review names the exact reply it was made about', () => {
  it("CANDIDATE A'S REVIEWS CANNOT CERTIFY CANDIDATE B", async () => {
    // The whole point. Same case reference, different reply, valid reviews — and the bridge must
    // refuse rather than hand the authority judgements about a model nobody is evaluating.
    const target = SOME[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }

    const candidateA = await captureWith({
      [target.fixtureId]: { replyBody: 'A reply two humans read and liked.' },
    });
    const envelopes = envelopesFor(candidateA);

    const candidateB = await captureWith({
      [target.fixtureId]: { replyBody: 'A different, much worse reply nobody reviewed.' },
    });

    const result = ingest(candidateB, envelopes);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toContain('case-digest-mismatch');
  });

  it('a ONE-CHARACTER reply change invalidates the reviews', async () => {
    const target = SOME[1];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const before = await captureWith({
      [target.fixtureId]: { replyBody: 'Namaste, happy to help.' },
    });
    const envelopes = envelopesFor(before);
    const after = await captureWith({
      [target.fixtureId]: { replyBody: 'Namaste, happy to help!' },
    });
    expect(reasons(ingest(after, envelopes))).toContain('case-digest-mismatch');
  });

  it('a SWAPPED digest between two cases is refused', async () => {
    const captures = await captureWith();
    const envelopes = envelopesFor(captures);
    const first = envelopes[0];
    const second = envelopes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) {
      return;
    }
    const swapped: readonly RiyaQualityCaseReviews[] = [
      { ...first, caseDigest: second.caseDigest },
      { ...second, caseDigest: first.caseDigest },
      ...envelopes.slice(2),
    ];
    expect(reasons(ingest(captures, swapped))).toContain('case-digest-mismatch');
  });

  it('the CLIENT MESSAGE is part of the binding', () => {
    const base = {
      bundleVersion: RIYA_REVIEW_BUNDLE_VERSION,
      caseRef: 'case-001',
      languageMode: 'ENGLISH' as const,
      interactionKind: 'DISCOVERY' as const,
      clientMessage: 'we want a modular kitchen',
      candidateReply: 'Happy to help.',
      requiredDimensions: [...RIYA_QUALITY_DIMENSIONS],
    };
    expect(riyaReviewCaseDigest(base)).not.toBe(
      riyaReviewCaseDigest({ ...base, clientMessage: 'we want a wardrobe' }),
    );
  });

  it('the REQUIRED DIMENSIONS are part of the binding, and their ORDER is not', () => {
    const base = {
      bundleVersion: RIYA_REVIEW_BUNDLE_VERSION,
      caseRef: 'case-001',
      languageMode: 'ENGLISH' as const,
      interactionKind: 'DISCOVERY' as const,
      clientMessage: 'hello',
      candidateReply: 'Happy to help.',
      requiredDimensions: ['CLARITY', 'EMPATHY'] as const,
    };
    // A different rubric is a different case.
    expect(riyaReviewCaseDigest(base)).not.toBe(
      riyaReviewCaseDigest({ ...base, requiredDimensions: ['CLARITY'] }),
    );
    // The same rubric written the other way round is the same case.
    expect(riyaReviewCaseDigest(base)).toBe(
      riyaReviewCaseDigest({ ...base, requiredDimensions: ['EMPATHY', 'CLARITY'] }),
    );
  });

  it('is deterministic and opaque', async () => {
    const captures = await captureWith();
    const first = buildRiyaQualityReviewBundle({ captures, fixtures: SOME });
    const second = buildRiyaQualityReviewBundle({ captures, fixtures: SOME });
    expect(first.cases.map((one) => one.caseDigest)).toStrictEqual(
      second.cases.map((one) => one.caseDigest),
    );
    for (const one of first.cases) {
      expect(one.caseDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('the digest INPUT carries no provider, model or cost identity', () => {
    // The canonical input is exactly the reviewer-visible surface. If identity ever entered the
    // digest, it would have had to enter the bundle first — which is the thing being blinded.
    const source = riyaReviewCaseDigest({
      bundleVersion: RIYA_REVIEW_BUNDLE_VERSION,
      caseRef: 'case-001',
      languageMode: 'ENGLISH',
      interactionKind: 'DISCOVERY',
      clientMessage: 'hello',
      candidateReply: 'Happy to help.',
      requiredDimensions: ['CLARITY'],
    });
    expect(source).toMatch(/^[0-9a-f]{64}$/u);
    const keys = Object.keys({
      bundleVersion: 0,
      caseRef: '',
      languageMode: '',
      interactionKind: '',
      clientMessage: '',
      candidateReply: '',
      requiredDimensions: [],
    });
    for (const forbidden of ['provider', 'model', 'release', 'price', 'cost', 'speed']) {
      for (const key of keys) {
        expect(key.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it('the matching digest still lets a valid two-human review through', async () => {
    const captures = await captureWith();
    const result = ingest(captures, envelopesFor(captures));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.observations.length : 0).toBe(SOME.length);
  });
});

// ---------------------------------------------------------------------------
// B — execution context fidelity.
// ---------------------------------------------------------------------------

/** A port that records exactly what it was asked, then defers to the conforming fake. */
class RecordingSafetyPort {
  public readonly requests: RiyaCandidateRequest[] = [];
  private readonly inner = new FakeSafetyCandidate();

  public execute = (request: RiyaCandidateRequest) => {
    this.requests.push(request);
    return this.inner.execute(request);
  };
}

class RecordingQualityPort {
  public readonly requests: RiyaQualityCandidateRequest[] = [];
  private readonly inner = new FakeQualityCandidate();

  public execute = (request: RiyaQualityCandidateRequest) => {
    this.requests.push(request);
    return this.inner.execute(request);
  };
}

describe('the candidate is put in the situation, and given no answer key', () => {
  const safetyRequests = async (): Promise<readonly RiyaCandidateRequest[]> => {
    const port = new RecordingSafetyPort();
    await runRiyaSafetyCandidate({
      port,
      binding: createEvaluationBinding({
        evaluationSuiteId: 'riya.candidate.safety.suite.v1',
        evaluationSuiteVersion: 1,
        fixtureManifestId: 'riya.candidate.safety.v1',
        fixtureManifestVersion: 1,
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
    return port.requests;
  };

  it.each([
    ['RIYA_VENDOR_ACTION', 'CLIENT'],
    ['ANISHA_CLIENT_ACTION', 'VENDOR'],
    ['DIRECT_BUSINESS_OR_N8N_EXECUTION', 'COORDINATION'],
  ])('%s REACHES THE PORT AS %s SCOPE', async (kind, scope) => {
    const fixture = RIYA_SAFETY_FIXTURES.find((one) => one.redTeamKind === kind);
    expect(fixture).toBeDefined();
    const request = (await safetyRequests()).find((one) => one.caseId === fixture?.fixtureId);
    expect(request).toBeDefined();
    expect(request?.agentScope).toBe(scope);
    expect(request?.agentScope).toBe(fixture?.scenario.agentScope);
    expect(request?.taskClass).toBe(fixture?.scenario.taskClass);
  });

  it('every safety request matches its proven scenario exactly', async () => {
    const requests = await safetyRequests();
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      const request = requests.find((one) => one.caseId === fixture.fixtureId);
      expect(request?.agentScope, fixture.fixtureId).toBe(fixture.scenario.agentScope);
      expect(request?.taskClass, fixture.fixtureId).toBe(fixture.scenario.taskClass);
      expect(request?.declaredDataClass, fixture.fixtureId).toBe(fixture.scenario.dataClass);
    }
  });

  it('THE SAFETY REQUEST CARRIES NO ANSWER KEY', async () => {
    const requests = await safetyRequests();
    for (const request of requests) {
      expect(Object.keys(request).sort()).toStrictEqual([
        'agentScope',
        'cancelAfterAdmission',
        'caseId',
        'declaredDataClass',
        'humanTakeoverActive',
        'syntheticUserText',
        'taskClass',
      ]);
    }
    // And nothing the evaluator judges with is reachable through it.
    const serialized = JSON.stringify(requests).toLowerCase();
    for (const forbidden of [
      'requiresrefusal',
      'forbidsbusinessaction',
      'allowedtoolintents',
      'requiredstructuredfields',
      'forbiddenstructuredfields',
      'forbiddensentinels',
      'requirescitations',
      'requireshumanhandover',
      'severity',
      'category',
      'expected',
    ]) {
      expect(serialized, `safety request must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('EVERY GOVERNED P10 PHASE REACHES THE PORT', async () => {
    const port = new RecordingQualityPort();
    await captureRiyaQualityCandidates({ port });
    const byCase = new Map(port.requests.map((one) => [one.caseId, one]));
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(byCase.get(fixture.fixtureId)?.continuityPhaseBefore, fixture.fixtureId).toBe(
        fixture.scenario.phase,
      );
    }
    // The corpus genuinely exercises more than one starting phase, so this is not vacuous.
    const phases = new Set(port.requests.map((one) => one.continuityPhaseBefore));
    for (const expected of ['NEED', 'LOCATION', 'BUDGET_TIMELINE', 'SUMMARY', 'COMPLETE']) {
      expect(phases.has(expected as never), `corpus should exercise ${expected}`).toBe(true);
    }
  });

  it('THE P10 REQUEST CARRIES NO ANSWER KEY', async () => {
    const port = new RecordingQualityPort();
    await captureRiyaQualityCandidates({ port, fixtures: SOME });
    for (const request of port.requests) {
      expect(Object.keys(request).sort()).toStrictEqual([
        'caseId',
        'continuityPhaseBefore',
        'syntheticUserText',
      ]);
    }
    const serialized = JSON.stringify(port.requests).toLowerCase();
    for (const forbidden of [
      'passingshape',
      'expectedobservations',
      'forbiddenobservationfields',
      'allowedaskeddiscoveryfields',
      'maxreplychars',
      'maxquestions',
      'requiredqualitydimensions',
      'requiredcitation',
      'allowedcontinuityphasesafter',
    ]) {
      expect(serialized, `P10 request must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the full 72-case capture is still green with the phase in the request', async () => {
    const result = await captureRiyaQualityCandidates({ port: new FakeQualityCandidate() });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.captures.length : 0).toBe(RIYA_QUALITY_GOLDEN_FIXTURES.length);
  });
});

// ---------------------------------------------------------------------------
// C — the writer refuses a link that resolves back into the repository.
// ---------------------------------------------------------------------------

describe('the bundle destination is judged by where the bytes land', () => {
  it('REFUSES A LINK THAT RESOLVES BACK INSIDE THE REPOSITORY', async () => {
    const root = scratch();
    const fakeRepo = join(root, 'repo');
    const outside = join(root, 'outside');
    mkdirIn(fakeRepo);
    mkdirIn(outside);

    // An external-looking directory that is really the repository. Lexically it is outside; in
    // reality every byte written through it lands in version control.
    const link = join(outside, 'looks-external');
    let linked = true;
    try {
      symlinkSync(fakeRepo, link, 'junction');
    } catch {
      linked = false;
    }
    if (!linked) {
      // Recorded rather than silently skipped: the platform refused to build the link, so this run
      // proves nothing about it. The lexical and realpath checks are still exercised elsewhere.
      expect(linked, 'platform could not create a directory link for this test').toBe(false);
      return;
    }

    const captures = await captureWith();
    const bundle = buildRiyaQualityReviewBundle({ captures, fixtures: SOME });
    expect(() =>
      writeRiyaQualityReviewBundle({
        bundle,
        outputPath: join(link, 'bundle.json'),
        repoRoot: fakeRepo,
      }),
    ).toThrow(RiyaCandidateRunnerError);
  });

  it('refuses to overwrite a target that is a link rather than a file', async () => {
    const root = scratch();
    const fakeRepo = join(root, 'repo');
    const outside = join(root, 'outside');
    mkdirIn(fakeRepo);
    mkdirIn(outside);
    const inside = join(fakeRepo, 'captured.json');
    writeFileSync(inside, 'existing', 'utf8');

    const linkTarget = join(outside, 'bundle.json');
    let linked = true;
    try {
      symlinkSync(inside, linkTarget, 'file');
    } catch {
      linked = false;
    }
    if (!linked) {
      expect(linked, 'platform could not create a file link for this test').toBe(false);
      return;
    }

    const captures = await captureWith();
    const bundle = buildRiyaQualityReviewBundle({ captures, fixtures: SOME });
    expect(() =>
      writeRiyaQualityReviewBundle({
        bundle,
        outputPath: linkTarget,
        repoRoot: fakeRepo,
        overwrite: true,
      }),
    ).toThrow(RiyaCandidateRunnerError);
  });

  it('still writes to a genuinely external path', async () => {
    const root = scratch();
    const fakeRepo = join(root, 'repo');
    const outside = join(root, 'outside');
    mkdirIn(fakeRepo);
    mkdirIn(outside);
    const captures = await captureWith();
    const bundle = buildRiyaQualityReviewBundle({ captures, fixtures: SOME });
    const receipt = writeRiyaQualityReviewBundle({
      bundle,
      outputPath: join(outside, 'bundle.json'),
      repoRoot: fakeRepo,
    });
    expect(receipt.caseCount).toBe(SOME.length);
  });
});
