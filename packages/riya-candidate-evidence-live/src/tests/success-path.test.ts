/**
 * TEST B — the operator crosses every gate and hands off to two humans.
 *
 * ### The gap this closes
 *
 * Test A proves the real gateway, the real provider, the accounting split and the cancellation signal.
 * The existing integrated test proves preflight ordering, credential sequencing and the per-case
 * execution layers — but it stops at the safety gate, because its transport answers nothing valid.
 * Nothing yet proved the operator can go SAFETY ELIGIBLE → P10 → BUNDLE.
 *
 * ### What is real here, and what is not
 *
 * Real: `runCandidateEvidenceOperator`, both candidate ports, the M4 adapter and the Riya profile,
 * governed knowledge admission, the safety authority and `createApprovalEvidence`,
 * `captureRiyaQualityCandidates`, the bundle builder and the external writer, the ledger, the safe
 * console. Fake: the terminal, the credential, and the model's answers.
 *
 * The answers are contract fixtures, not a simulated model. They exist so the machinery can be
 * observed crossing the branch; they say nothing about whether any candidate is good.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type { MaskedSecretSource, SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import type { ModelRequest } from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvocation } from '@qf-jarvis/model-reply-adapter';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createOperatorLedger } from '../accounting.js';
import type { BaseTurnDeps } from '../candidate-ports.js';
import type { CandidateSession } from '../candidate-session.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import { taskClassFor } from '../riya-turn.js';
import { createSafeConsole } from '../safe-console.js';
import { syntheticContinuityFor } from '../synthetic-context.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import {
  payloadFor,
  refusedPayload,
  responseFor,
  TEST_REPLIES,
} from './helpers/contract-valid-riya-response.js';
import type { TestCitation } from './helpers/contract-valid-riya-response.js';

type ActualPreflight = typeof ActualPreflightModule;

/** Production offers no preflight override, so the SPEC substitutes the module. See Turn 1E. */
const harnessState = vi.hoisted(() => ({ syntheticDigest: '' }));
vi.mock('../preflight.js', async (importOriginal) => {
  const actual = await importOriginal<ActualPreflight>();
  const helper = await import('./helpers/preflight-testing.js');
  return {
    ...actual,
    runPreflight: (input: PreflightInput) =>
      helper.runPreflightForTesting(input, harnessState.syntheticDigest),
  };
});

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-success-'));
  scratch.push(directory);
  return directory;
}

const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 12, outputTokens: 4 },
  counters: { binds: 1, credentialReads: 1, invocations: 1, timersArmed: 1, timersCleared: 1 },
  diagnostics: {},
} as unknown as SmokeRunResult;

function writeSmokeConfig(directory: string): string {
  const path = join(directory, 'groq-smoke-config.json');
  writeFileSync(
    path,
    JSON.stringify({
      credentialReference: 'secret.qfj-staging.groq.v1',
      release: {
        releaseId: 'rel.groq.qfj-staging.smoke.v1',
        providerId: 'groq',
        modelId: 'openai/gpt-oss-20b',
        modelVersion: 'groq-catalog-snapshot-2026-08-12',
        executionClass: 'HOSTED',
        configDigest: 'a'.repeat(64),
      },
      dataClass: 'HOSTED_ALLOWED',
      maxInputTokens: 4096,
      maxCompletionTokens: 512,
      supportsStrictJsonSchema: true,
      capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
      evaluationRef: 'eval.groq.qfj-staging.smoke.v1',
      dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
      dataControlsAttested: true,
      promptFamily: SMOKE_PROMPT_FAMILY,
      promptVersion: SMOKE_PROMPT_VERSION,
      schemaRevision: SMOKE_SCHEMA_REVISION,
      timeoutMs: 15_000,
    }),
    'utf8',
  );
  return path;
}

// ---------------------------------------------------------------------------
// The deterministic case-aware session.
// ---------------------------------------------------------------------------

/**
 * Safety kinds whose SAFE behaviour is a refusal.
 *
 * A Riya structured answer has exactly one reply kind, so a turn cannot say "I decline" through the
 * schema. What actually reaches the record as `refused` is a turn the adapter did not accept — so
 * these emit a structurally invalid answer and let the REAL adapter reject it.
 */
const REFUSAL_KINDS: ReadonlySet<string> = new Set([
  'KNOWLEDGE_PROMPT_INJECTION',
  'REVEAL_SECRET_OR_PROMPT',
  'OVERRIDE_CORE',
  'RIYA_VENDOR_ACTION',
  'DIRECT_BUSINESS_OR_N8N_EXECUTION',
  'UNSUPPORTED_TOOL_INTENT',
  'CANCELLATION_OR_KILLSWITCH_IGNORED',
  'CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY',
]);

const safetyByCase = new Map(RIYA_SAFETY_FIXTURES.map((one) => [one.fixtureId, one]));
const qualityByCase = new Map(RIYA_QUALITY_GOLDEN_FIXTURES.map((one) => [one.fixtureId, one]));

interface SessionRecorder {
  readonly session: CandidateSession;
  readonly safetyCases: () => readonly string[];
  readonly qualityCases: () => readonly string[];
  readonly cancellationCases: () => readonly string[];
}

function deterministicSession(clock: () => string): SessionRecorder {
  const perCase = new Map<string, number>();
  const safetyCases: string[] = [];
  const qualityCases: string[] = [];
  const cancellationCases: string[] = [];

  const invokerFor = (caseId: string, cancelling: boolean): BaseTurnDeps => ({
    clock,
    invoker: {
      invoke: (request: ModelRequest): Promise<ModelGatewayInvocation> => {
        perCase.set(caseId, (perCase.get(caseId) ?? 0) + 1);

        const safety = safetyByCase.get(caseId);
        if (safety !== undefined) {
          if (cancelling) {
            cancellationCases.push(caseId);
          }
          const payload = REFUSAL_KINDS.has(safety.redTeamKind)
            ? refusedPayload()
            : payloadFor({
                // Every safety case is a live NEED turn, which is the evolution identity.
                taskClass: taskClassFor({
                  phase: 'NEED',
                  hasGroundedKnowledge: safety.request.groundedKnowledge !== undefined,
                }),
                current: syntheticContinuityFor('NEED', caseId),
                language: 'ENGLISH',
                citations: citationsForSafety(caseId),
              });
          return Promise.resolve({ ok: true as const, response: responseFor(request, payload) });
        }

        const fixture = qualityByCase.get(caseId);
        if (fixture === undefined) {
          return Promise.resolve({ ok: false as const, transient: false });
        }
        const grounded = fixture.syntheticGroundedKnowledge;
        const payload = payloadFor({
          taskClass: taskClassFor({
            phase: fixture.scenario.phase,
            hasGroundedKnowledge: grounded !== undefined,
          }),
          current: syntheticContinuityFor(fixture.scenario.phase, caseId),
          language: fixture.languageMode,
          citations: (grounded?.records ?? []).map((record) => ({
            knowledgeId: record.knowledgeId,
            version: record.version,
          })),
        });
        return Promise.resolve({ ok: true as const, response: responseFor(request, payload) });
      },
    },
  });

  return {
    session: {
      safetyTurnDeps: (caseId) => {
        safetyCases.push(caseId);
        return invokerFor(caseId, false);
      },
      safetyCancellationTurnDeps: (caseId) => {
        safetyCases.push(caseId);
        return invokerFor(caseId, true);
      },
      qualityTurnDeps: (caseId) => {
        qualityCases.push(caseId);
        return invokerFor(caseId, false);
      },
      invocationsFor: (caseId) => perCase.get(caseId) ?? 0,
      cancellationObservedFor: (caseId) => cancellationCases.includes(caseId),
      accountingRefusal: () => undefined,
    },
    safetyCases: () => safetyCases,
    qualityCases: () => qualityCases,
    cancellationCases: () => cancellationCases,
  };
}

/** Only records the case was actually shown. Never a fabricated id. */
function citationsForSafety(caseId: string): readonly TestCitation[] {
  const grounded = safetyByCase.get(caseId)?.request.groundedKnowledge;
  if (grounded?.state !== 'CURRENT') {
    return [];
  }
  return grounded.records.map((record) => ({
    knowledgeId: record.knowledgeId,
    version: record.version,
  }));
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

function successHarness() {
  const lines: string[] = [];
  const configDir = externalDir();
  const smokeConfigPath = writeSmokeConfig(configDir);
  const outputPath = join(externalDir(), 'riya-review-bundle.json');
  const ledger = createOperatorLedger();
  const recorder = deterministicSession(() => '2026-08-12T00:00:00.000Z');

  harnessState.syntheticDigest = createHash('sha256')
    .update(readFileSync(smokeConfigPath))
    .digest('hex');

  const source: MaskedSecretSource = {
    isInteractive: () => true,
    readOnce: () => Promise.resolve('sk-SENTINEL-SUCCESS-NEVER-A-REAL-KEY-0000'),
  };

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: outputPath,
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    ledger,
    openSmokeSecretSource: () => Promise.resolve(source),
    runSmoke: () => Promise.resolve(SMOKE_PASS),
    openCandidateCredential: () => Promise.resolve({ redacted: true }),
    openCandidate: () => Promise.resolve(recorder.session),
    binding: createEvaluationBinding({
      evaluationSuiteId: 'riya.candidate.safety.suite.v1',
      evaluationSuiteVersion: 2,
      fixtureManifestId: 'riya.candidate.safety.v1',
      fixtureManifestVersion: 4,
      evaluatorImplId: 'qfj.eval.deterministic',
      evaluatorImplVersion: 1,
      release: CANDIDATE_RELEASE,
      promptFamily: 'riya.client-sales',
      promptVersion: 1,
      promptDigest: RIYA_CLIENT_PROMPT_DIGEST,
      capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
      knowledgeRevision: 'know.rev.1',
      policyContractRevision: 'policy.rev.1',
      createdAt: '2026-08-12T00:00:00.000Z',
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
    repoRoot: REPO_ROOT,
  };
  return { deps, lines, recorder, ledger, outputPath };
}

describe('full bounded operator reaches blinded human-review handoff', () => {
  it('CROSSES EVERY GATE AND STOPS AT AWAITING_P10_HUMAN_REVIEW', async () => {
    const harness = successHarness();
    const result = await runCandidateEvidenceOperator(harness.deps);
    const output = harness.lines.join('\n');

    // Preflight and smoke.
    expect(output).toContain('phase=preflight status=PASS');
    expect(output).toContain('phase=smoke status=PASS');

    // Safety: twelve cases BUILD a turn. The other five are refused earlier — a VENDOR scope Riya
    // does not own, LOCAL_ONLY and HUMAN_ONLY content a hosted candidate never receives, and a
    // SUPERSEDED record governed retrieval refuses — so they never ask for turn dependencies at all.
    // Human takeover and the erased subject DO build one, because their boundary is the M4 state gate.
    expect(new Set(harness.recorder.safetyCases()).size).toBe(12);
    expect(output).toContain('phase=safety status=ELIGIBLE');

    // P10 only after eligibility, and all seventy-two.
    expect(new Set(harness.recorder.qualityCases()).size).toBe(72);
    expect(output).toContain('status=CAPTURE_COMPLETE');
    expect(output).toContain('cases=72');

    // The handoff.
    expect(result.outcome).toBe('AWAITING_P10_HUMAN_REVIEW');
    expect(result.reviewCaseCount).toBe(72);
    expect(output).toContain('finalStatus=AWAITING_P10_HUMAN_REVIEW');
  });

  it('writes a BLINDED 72-case bundle to an external path', async () => {
    const harness = successHarness();
    const result = await runCandidateEvidenceOperator(harness.deps);
    expect(result.outcome).toBe('AWAITING_P10_HUMAN_REVIEW');

    const written = JSON.parse(readFileSync(harness.outputPath, 'utf8')) as {
      cases: readonly { readonly caseRef: string; readonly caseDigest: string }[];
    };
    expect(written.cases).toHaveLength(72);
    for (const one of written.cases) {
      expect(one.caseDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(one.caseRef).toMatch(/^case-\d{3}$/u);
    }

    // A reviewer must not be able to tell which model this was.
    const serialized = JSON.stringify(written).toLowerCase();
    for (const forbidden of [
      'groq',
      'gpt-oss',
      'rel.groq',
      'modelversion',
      'latency',
      'tokens',
      'cost',
      'providerid',
    ]) {
      expect(serialized, `bundle must not reveal ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the safety and P10 gates ran in order, not in parallel or reversed', async () => {
    const harness = successHarness();
    await runCandidateEvidenceOperator(harness.deps);
    // Every safety case was requested before the first quality case existed.
    expect(harness.recorder.safetyCases().length).toBeGreaterThan(0);
    expect(harness.recorder.qualityCases().length).toBe(72);
    const eligibleAt = harness.lines.findIndex((line) => line.includes('status=ELIGIBLE'));
    const captureAt = harness.lines.findIndex((line) => line.includes('CAPTURE_COMPLETE'));
    expect(eligibleAt).toBeGreaterThanOrEqual(0);
    expect(captureAt).toBeGreaterThan(eligibleAt);
  });

  it('fabricates no review, no score and no operational benchmark', async () => {
    const harness = successHarness();
    await runCandidateEvidenceOperator(harness.deps);
    const output = harness.lines.join('\n').toLowerCase();
    for (const forbidden of [
      'reviewer',
      'satisfied',
      'passrate',
      'score',
      'eligible=true',
      'rmb',
    ]) {
      expect(output, `console must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // The bundle carries no human review either — two people have not read it yet.
    const written = readFileSync(harness.outputPath, 'utf8').toLowerCase();
    expect(written).not.toContain('satisfieddimensions');
    expect(written).not.toContain('reviewref');
  });

  it('the console stays content-free across a complete successful run', async () => {
    const harness = successHarness();
    await runCandidateEvidenceOperator(harness.deps);
    const output = harness.lines.join('\n');
    for (const forbidden of [
      'sk-',
      'Authorization',
      'Bearer',
      'SENTINEL-',
      TEST_REPLIES.ENGLISH,
      TEST_REPLIES.HINDI,
      TEST_REPLIES.HINGLISH,
    ]) {
      expect(output, `console must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the corpus split is untouched by the run', () => {
    const grounded = RIYA_QUALITY_GOLDEN_FIXTURES.filter(
      (one) => one.syntheticGroundedKnowledge !== undefined,
    );
    expect(RIYA_QUALITY_GOLDEN_FIXTURES).toHaveLength(72);
    expect(grounded).toHaveLength(18);
    expect(RIYA_QUALITY_GOLDEN_FIXTURES.length - grounded.length).toBe(54);
    expect(RIYA_SAFETY_FIXTURES).toHaveLength(17);
  });
});
