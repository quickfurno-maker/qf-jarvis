/**
 * POST-SFD1 — the one-shot guard driven through the REAL operator.
 *
 * The unit spec proves the guard refuses. This one proves the refusal costs nothing: on a second
 * launch, zero credentials are read, zero smokes are sent and zero candidate requests are made.
 * That is the whole point — the incident was a second launch that reached the provider.
 *
 * It also pins the BOUNDARY. Consumption is claimed after preflight and the smoke configuration have
 * passed, and before any credential exists:
 *
 * - a malformed command or a bad worktree must never spend a governed goal;
 * - a goal whose smoke later fails is still spent, because the authorization was for one launch and
 *   "it failed, so try again" is exactly the reasoning a guard has to refuse.
 *
 * The marker directory is a per-test temp directory. No developer staging area is touched.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createOneShotConsumptionGuard } from '../internal/one-shot-consumption.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createSafeConsole } from '../safe-console.js';

type ActualPreflight = typeof ActualPreflightModule;
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
function externalDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-ONE-SHOT-SENTINEL-NEVER-A-REAL-KEY';

function writeSmokeConfig(directory: string): { readonly path: string; readonly digest: string } {
  const path = join(directory, 'groq-smoke-config.json');
  const draft = {
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
    timeoutMs: 15_000,
    capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
    evaluationRef: 'eval.groq.qfj-staging.smoke.v1',
    dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
    dataControlsAttested: true,
    promptFamily: SMOKE_PROMPT_FAMILY,
    promptVersion: SMOKE_PROMPT_VERSION,
    schemaRevision: SMOKE_SCHEMA_REVISION,
  };
  const parsed = parseSmokeConfig(draft);
  if (!parsed.ok) {
    throw new Error('The synthetic smoke configuration must parse.');
  }
  const digest = computeSmokeApprovalDigest(parsed.config);
  writeFileSync(
    path,
    JSON.stringify({ ...draft, release: { ...draft.release, configDigest: digest } }),
    'utf8',
  );
  return { path, digest };
}

const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

interface Counters {
  credentialReads: number;
  smokes: number;
  candidateSessions: number;
}

async function launch(options: {
  readonly markerDirectory: string;
  readonly runGoal?: OperatorDeps['runGoal'];
  readonly smokeFails?: boolean;
  readonly badSmokeConfigPath?: boolean;
}): Promise<{ readonly outcome: string; readonly counters: Counters; readonly lines: string[] }> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir('qfj-one-shot-cfg-'));
  harnessState.syntheticDigest = digest;
  const counters: Counters = { credentialReads: 0, smokes: 0, candidateSessions: 0 };

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath:
        options.badSmokeConfigPath === true ? join(tmpdir(), 'absent.json') : smokeConfigPath,
      reviewOutputPath: join(externalDir('qfj-one-shot-out-'), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    oneShotGuard: createOneShotConsumptionGuard({ markerDirectory: options.markerDirectory }),
    ...(options.runGoal === undefined ? {} : { runGoal: options.runGoal }),
    openSmokeCredential: () => {
      counters.credentialReads += 1;
      return Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(SENTINEL_KEY),
        },
      });
    },
    runSmoke: () => {
      counters.smokes += 1;
      return Promise.resolve(
        options.smokeFails === true
          ? ({ ...SMOKE_PASS, ok: false, reason: 'smoke-refused' } as unknown as SmokeRunResult)
          : SMOKE_PASS,
      );
    },
    openCandidateCredential: () => Promise.resolve({}),
    openCandidate: () => {
      counters.candidateSessions += 1;
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED');
    },
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

  const result = await runCandidateEvidenceOperator(deps);
  return { outcome: result.outcome, counters, lines };
}

describe('a second launch of the same goal spends nothing', () => {
  it('refuses before any credential, smoke or candidate request', async () => {
    const markerDirectory = externalDir('qfj-one-shot-marker-');
    // First launch: the goal is claimed and the run proceeds into the smoke.
    const first = await launch({ markerDirectory });
    expect(first.counters.credentialReads).toBe(1);
    expect(first.counters.smokes).toBe(1);

    // Second launch, same goal, same workstation. THE INCIDENT.
    const second = await launch({ markerDirectory });
    expect(second.outcome).toBe('RUN_GOAL_ALREADY_CONSUMED');
    expect(second.counters.credentialReads).toBe(0);
    expect(second.counters.smokes).toBe(0);
    expect(second.counters.candidateSessions).toBe(0);
  });

  it('emits a content-free refusal line naming the goal and the reason', async () => {
    const markerDirectory = externalDir('qfj-one-shot-marker-');
    await launch({ markerDirectory });
    const second = await launch({ markerDirectory });
    const line = second.lines.find((one) => one.includes('phase=one-shot'));
    expect(line).toBeDefined();
    expect(line).toContain('status=REFUSED');
    expect(line).toContain('reason=goal-already-consumed');
    expect(second.lines.join('\n')).not.toContain(SENTINEL_KEY);
  });
});

describe('a statically consumed goal refuses on a FRESH workstation', () => {
  it('refuses RLD1/RBD1/SFD1 goals before any credential, with no marker written', async () => {
    for (const goal of [
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    ] as const) {
      const markerDirectory = externalDir('qfj-one-shot-marker-');
      const run = await launch({ markerDirectory, runGoal: goal });
      expect(run.outcome, goal).toBe('RUN_GOAL_STATICALLY_CONSUMED');
      expect(run.counters.credentialReads, goal).toBe(0);
      expect(run.counters.smokes, goal).toBe(0);
      // A tombstoned goal never touches the marker directory at all.
      expect(readdirSync(markerDirectory), goal).toStrictEqual([]);
    }
  });
});

describe('the consumption boundary', () => {
  it('does NOT consume a goal when preflight refuses', async () => {
    // A malformed or unreadable configuration must never spend a governed one-shot. The marker
    // directory stays empty, and a later legitimate launch still works.
    const markerDirectory = externalDir('qfj-one-shot-marker-');
    const failed = await launch({ markerDirectory, badSmokeConfigPath: true });
    expect(failed.outcome).toBe('PRECHECK_FAILED');
    expect(readdirSync(markerDirectory)).toStrictEqual([]);
    expect(failed.counters.credentialReads).toBe(0);

    const later = await launch({ markerDirectory });
    expect(later.counters.credentialReads).toBe(1);
  });

  it('DOES consume a goal whose smoke later fails', async () => {
    // The authorization was for one launch, not for one success. "It failed, so try again" is
    // exactly the reasoning the guard exists to refuse.
    const markerDirectory = externalDir('qfj-one-shot-marker-');
    const first = await launch({ markerDirectory, smokeFails: true });
    expect(first.outcome).toBe('SMOKE_FAILED');
    expect(first.counters.smokes).toBe(1);

    const second = await launch({ markerDirectory });
    expect(second.outcome).toBe('RUN_GOAL_ALREADY_CONSUMED');
    expect(second.counters.smokes).toBe(0);
  });

  it('leaves a run without a guard exactly as it was', async () => {
    // Every pre-existing spec omits the seam, and their behaviour must be untouched.
    const lines: string[] = [];
    const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir('qfj-one-shot-cfg-'));
    harnessState.syntheticDigest = digest;
    const result = await runCandidateEvidenceOperator({
      console: createSafeConsole((line) => lines.push(line)),
      preflight: {
        smokeConfigPath,
        reviewOutputPath: join(externalDir('qfj-one-shot-out-'), 'bundle.json'),
        repoRoot: REPO_ROOT,
        interactive: true,
      },
      openSmokeCredential: () =>
        Promise.resolve({
          credentialSource: {
            isInteractive: () => true,
            readOnce: () => Promise.resolve(SENTINEL_KEY),
          },
        }),
      runSmoke: () =>
        Promise.resolve({
          ...SMOKE_PASS,
          ok: false,
          reason: 'smoke-refused',
        } as unknown as SmokeRunResult),
      openCandidateCredential: () => Promise.resolve({}),
      openCandidate: () => {
        throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED');
      },
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
    });
    expect(result.outcome).toBe('SMOKE_FAILED');
    // No one-shot line at all when the seam is absent.
    expect(lines.some((one) => one.includes('phase=one-shot'))).toBe(false);
  });
});
