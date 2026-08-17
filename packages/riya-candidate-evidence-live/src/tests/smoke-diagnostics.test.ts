/**
 * MVP-P2A.2 HF4-R2 — the smoke timeout phase, made observable.
 *
 * ### What RUN S3 could not say
 *
 * S3 was authorized as ONE live operator process. It printed exactly:
 *
 *     phase=smoke status=FAILED reason=smoke-timeout requests=1
 *
 * and stopped, consuming the authorization. `smoke-timeout` is a single collapsed reason covering at
 * least four unrelated diagnoses — the budget went into credential entry, or the request never left,
 * or nothing came back, or the body stalled — and the line distinguishes none of them.
 *
 * The telemetry to tell them apart already existed on `SmokeRunResult.diagnostics`. The operator threw
 * it away. These specs pin that it no longer does, and that each phase is reported verbatim as the
 * smoke harness classified it rather than re-derived here.
 *
 * **S3's actual timeout phase is NOT recoverable** and is never guessed: every phase below is a
 * synthetic fixture.
 */
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { emitSmokeExecutionDiagnostics } from '../internal/smoke-diagnostics.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import type { OperatorDeps } from '../operator.js';
import { createSafeConsole } from '../safe-console.js';

type ActualPreflight = typeof ActualPreflightModule;

/**
 * The established TEST-ONLY preflight seam (see `integrated-composition.test.ts`).
 *
 * Production offers no preflight override by design, so the SPEC substitutes the module and supplies a
 * SYNTHETIC expected digest. Everything else about preflight stays real — the path fences, the closed
 * config parse, the embedded-digest comparison and the semantic recomputation all run exactly as they
 * would live. No production bypass is added and `EXPECTED_SMOKE_CONFIG_DIGEST` is untouched.
 */
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

/** Sentinels that must never reach the terminal. */
const KEY_SENTINEL = 'sk-SENTINEL-NEVER-A-REAL-KEY-000000000000';
const BODY_SENTINEL = 'SENTINEL-PROVIDER-BODY-MUST-NOT-PRINT';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
const externalDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'riya-smoke-diag-'));
  scratch.push(directory);
  return directory;
};

type Diagnostics = SmokeRunResult['diagnostics'];

/** Every milestone absent by default; each fixture proves exactly the ones its phase implies. */
const BASE_DIAGNOSTICS: Diagnostics = {
  timerArmedMs: 0,
  bindStartedMs: undefined,
  credentialReadSettledMs: undefined,
  credentialResolvedMs: undefined,
  invokeStartedMs: undefined,
  requestConstructedMs: undefined,
  fetchStartedMs: undefined,
  headersReceivedMs: undefined,
  responseBodyStartedMs: undefined,
  responseBodyCompletedMs: undefined,
  invokeSettledMs: undefined,
  abortSignalledMs: undefined,
  credentialEntryMs: undefined,
  networkElapsedMs: undefined,
  totalElapsedMs: 30_000,
  timeoutPhase: 'unknown',
  transportErrorCode: 'NONE',
  credentialOutcome: 'resolved',
  credentialReadAttempts: 0,
  credentialResolutions: 0,
};

function smokeResult(
  ok: boolean,
  reason: string,
  diagnostics: Partial<Diagnostics>,
): SmokeRunResult {
  return {
    ok,
    reason,
    references: {},
    ...(ok ? { latencyMs: 1, usage: { inputTokens: 194, outputTokens: 82 } } : {}),
    counters: { binds: 1, credentialReads: 1, invocations: 1, timersArmed: 1, timersCleared: 1 },
    diagnostics: { ...BASE_DIAGNOSTICS, ...diagnostics },
  } as unknown as SmokeRunResult;
}

/**
 * A valid, secret-free synthetic smoke configuration, digest-consistent with the test seam.
 *
 * Built through the REAL parser and the REAL semantic-digest helper, then written with that digest
 * embedded — so preflight's two independent checks (recomputation and the embedded claim) are both
 * genuinely satisfied rather than accidentally bypassed.
 */
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
    capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
    evaluationRef: 'eval.groq.qfj-staging.smoke.v1',
    dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
    dataControlsAttested: true,
    promptFamily: SMOKE_PROMPT_FAMILY,
    promptVersion: SMOKE_PROMPT_VERSION,
    schemaRevision: SMOKE_SCHEMA_REVISION,
    timeoutMs: 15_000,
  };
  const parsed = parseSmokeConfig(draft);
  if (!parsed.ok) {
    throw new Error(
      'The synthetic smoke configuration must parse, or this harness proves nothing.',
    );
  }
  const digest = computeSmokeApprovalDigest(parsed.config);
  writeFileSync(
    path,
    JSON.stringify({ ...draft, release: { ...draft.release, configDigest: digest } }),
    'utf8',
  );
  return { path, digest };
}

interface SmokeGateRun {
  readonly lines: string[];
  readonly outcome: string;
  readonly reviewBundlePath: string | undefined;
  readonly smokeRuns: number;
  readonly candidateCredentials: number;
  readonly candidateSessions: number;
  readonly reviewOutputPath: string;
}

/**
 * Drive the REAL operator PAST preflight and into the supplied synthetic smoke result.
 *
 * The first version of this helper pointed `smokeConfigPath` at a non-existent file, so preflight
 * refused and the run never reached smoke at all — the test asserted an outer fence while claiming to
 * prove the smoke-failure one. That is the defect R2.1 corrects; the seam above is what lets the run
 * genuinely arrive at the smoke gate.
 */
async function runToSmoke(smoke: SmokeRunResult): Promise<SmokeGateRun> {
  const lines: string[] = [];
  let smokeRuns = 0;
  let candidateCredentials = 0;
  let candidateSessions = 0;
  const configDir = externalDir();
  const { path: smokeConfigPath, digest } = writeSmokeConfig(configDir);
  harnessState.syntheticDigest = digest;
  const reviewOutputPath = join(externalDir(), 'riya-review-bundle.json');

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: { smokeConfigPath, reviewOutputPath, repoRoot: REPO_ROOT, interactive: true },
    openSmokeCredential: () =>
      Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(KEY_SENTINEL),
        },
      }),
    runSmoke: () => {
      smokeRuns += 1;
      return Promise.resolve(smoke);
    },
    openCandidateCredential: () => {
      candidateCredentials += 1;
      return Promise.resolve({});
    },
    openCandidate: () => {
      candidateSessions += 1;
      // This harness owns the SMOKE gate only. A passing smoke legitimately continues, so the bind is
      // refused here on purpose: the operator's own catch turns that into CANDIDATE_BIND_FAILED,
      // which stops the run cleanly after the smoke lines this file is about. Returning a stub
      // session instead would crash inside the safety port on an unimplemented member, which would
      // be an accident rather than a decision.
      return Promise.reject(new Error('bind refused: this harness owns the smoke gate only'));
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
      createdAt: '2026-08-14T00:00:00.000Z',
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
    repoRoot: REPO_ROOT,
  };

  const result = await runCandidateEvidenceOperator(deps);
  return {
    lines,
    outcome: result.outcome,
    reviewBundlePath: result.reviewBundlePath,
    smokeRuns,
    candidateCredentials,
    candidateSessions,
    reviewOutputPath,
  };
}

/** Emit one fixture's diagnostics in isolation and return the single line. */
function diagnosticLine(diagnostics: Partial<Diagnostics>, ok = false): string {
  const lines: string[] = [];
  emitSmokeExecutionDiagnostics(
    createSafeConsole((line) => lines.push(line)),
    smokeResult(ok, ok ? 'smoke-ok' : 'smoke-timeout', diagnostics),
  );
  return lines[0] ?? '';
}

describe('THE TIMEOUT PHASE IS NOW OBSERVABLE, AND THE PHASES ARE DISTINGUISHABLE', () => {
  it('A — a timeout during CREDENTIAL RESOLUTION', () => {
    const line = diagnosticLine({
      timeoutPhase: 'credential-resolution',
      credentialOutcome: 'read-aborted',
      credentialReadAttempts: 1,
      credentialResolutions: 0,
      bindStartedMs: 12,
      abortSignalledMs: 30_000,
      transportErrorCode: 'NONE',
    });
    expect(line).toContain('phase=smoke-execution status=DIAGNOSTIC');
    expect(line).toContain('timeoutPhase=credential-resolution');
    expect(line).toContain('credentialOutcome=read-aborted');
    expect(line).toContain('credentialResolutions=0');
    // The request never left, and the line says so by ABSENCE rather than by a misleading zero.
    expect(line).toContain('fetchStartedMs=ABSENT');
    expect(line).toContain('networkElapsedMs=ABSENT');
  });

  it('B — a timeout AWAITING HEADERS is a different line entirely', () => {
    const line = diagnosticLine({
      timeoutPhase: 'awaiting-headers',
      credentialOutcome: 'resolved',
      credentialReadAttempts: 1,
      credentialResolutions: 1,
      credentialResolvedMs: 4_100,
      credentialEntryMs: 4_050,
      fetchStartedMs: 4_200,
      headersReceivedMs: undefined,
      transportErrorCode: 'ABORT',
    });
    expect(line).toContain('timeoutPhase=awaiting-headers');
    expect(line).toContain('transportErrorCode=ABORT');
    expect(line).toContain('credentialResolutions=1');
    expect(line).toContain('credentialEntryMs=4050');
    // The request DID leave and nothing came back — the exact opposite reading from case A.
    expect(line).toContain('fetchStartedMs=4200');
    expect(line).toContain('headersReceivedMs=ABSENT');
  });

  it('C — a timeout AWAITING BODY, headers already received', () => {
    const line = diagnosticLine({
      timeoutPhase: 'awaiting-body',
      credentialResolutions: 1,
      fetchStartedMs: 3_000,
      headersReceivedMs: 3_400,
      responseBodyStartedMs: 3_410,
      responseBodyCompletedMs: undefined,
      transportErrorCode: 'UND_ERR_BODY_TIMEOUT',
    });
    expect(line).toContain('timeoutPhase=awaiting-body');
    expect(line).toContain('headersReceivedMs=3400');
    expect(line).toContain('responseBodyCompletedMs=ABSENT');
    expect(line).toContain('transportErrorCode=UND_ERR_BODY_TIMEOUT');
  });

  it('every closed phase is carried VERBATIM, never re-derived here', () => {
    // The phase-derivation algorithm belongs to the smoke harness, which freezes it AT abort. If this
    // package ever re-derived it, the two would disagree the first time one was corrected.
    for (const phase of [
      'pre-bind',
      'credential-resolution',
      'pre-fetch',
      'awaiting-headers',
      'awaiting-body',
      'post-body',
      'invoke-settlement',
      'unknown',
    ] as const) {
      expect(diagnosticLine({ timeoutPhase: phase })).toContain(`timeoutPhase=${phase}`);
    }
  });

  it('D — a SUCCESSFUL smoke also reports its timing, as the healthy reference', () => {
    const line = diagnosticLine(
      {
        timeoutPhase: 'unknown',
        credentialOutcome: 'resolved',
        credentialReadAttempts: 1,
        credentialResolutions: 1,
        credentialEntryMs: 6_200,
        networkElapsedMs: 900,
        totalElapsedMs: 7_300,
        fetchStartedMs: 6_300,
        headersReceivedMs: 6_800,
        responseBodyCompletedMs: 7_200,
      },
      true,
    );
    // Without this a later failure has nothing to be compared against — is 30s of budget normally
    // typing, or normally network?
    expect(line).toContain('credentialEntryMs=6200');
    expect(line).toContain('networkElapsedMs=900');
    expect(line).toContain('totalElapsedMs=7300');
  });

  it('E — a NON-TIMEOUT failure still reports safely and truthfully', () => {
    const line = diagnosticLine({
      timeoutPhase: 'unknown',
      transportErrorCode: 'ECONNREFUSED',
      credentialOutcome: 'resolved',
      credentialResolutions: 1,
    });
    expect(line).toContain('transportErrorCode=ECONNREFUSED');
    expect(line).toContain('timeoutPhase=unknown');
  });
});

describe('G — NOTHING CONTENT-BEARING CAN REACH THE TERMINAL', () => {
  it('the diagnostic carries only numbers, closed enums and ABSENT', () => {
    const line = diagnosticLine({
      timeoutPhase: 'awaiting-headers',
      transportErrorCode: 'ABORT',
      credentialEntryMs: 4_050,
    });
    for (const forbidden of [
      KEY_SENTINEL,
      BODY_SENTINEL,
      'sk-',
      'Authorization',
      'Bearer',
      'apiKey',
      'GROQ_API_KEY',
      'https://',
      'at Object.',
      'Error:',
    ]) {
      expect(line, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // Whitelist: every emitted value is a number, a closed token or ABSENT.
    for (const pair of line.split(' ')) {
      const value = pair.slice(pair.indexOf('=') + 1);
      expect(value, pair).toMatch(/^(ABSENT|[0-9]+|[A-Za-z][A-Za-z0-9_-]*)$/u);
    }
  });
});

describe('THE S3 INCIDENT SHAPE — the fences held, and now the phase is legible', () => {
  it('F/H/I — PREFLIGHT PASSES, SMOKE FAILS, AND THE WHOLE SEQUENCE HOLDS IN ONE RUN', async () => {
    // The load-bearing R2 regression, and the one owner review corrected. The first version pointed
    // the config path at a missing file, so preflight refused and the run never reached smoke — it
    // asserted an outer fence while its name claimed the smoke-failure one. This drives the REAL
    // operator through a passing preflight into a synthetic smoke failure and proves the whole
    // sequence R2 claims, in a single execution.
    const run = await runToSmoke(
      smokeResult(false, 'smoke-timeout', {
        timeoutPhase: 'awaiting-headers',
        transportErrorCode: 'ABORT',
        credentialOutcome: 'resolved',
        credentialReadAttempts: 1,
        credentialResolutions: 1,
        fetchStartedMs: 4_200,
      }),
    );

    const at = (fragment: string): number => run.lines.findIndex((l) => l.includes(fragment));
    const preflightAt = at('phase=preflight status=PASS');
    const diagnosticAt = at('phase=smoke-execution status=DIAGNOSTIC');
    const failedAt = at('phase=smoke status=FAILED reason=smoke-timeout requests=1');

    // 1. preflight genuinely passed — without this the rest of the assertions prove nothing.
    expect(preflightAt).toBeGreaterThanOrEqual(0);
    // 2. the diagnostic, BEFORE the verdict.
    expect(diagnosticAt).toBeGreaterThan(preflightAt);
    // 3. the authoritative failure line, unchanged and last.
    expect(failedAt).toBeGreaterThan(diagnosticAt);
    expect(failedAt).toBe(run.lines.length - 1);

    // The smoke actually ran, exactly once.
    expect(run.smokeRuns).toBe(1);
    // The synthetic phase travelled verbatim.
    expect(run.lines[diagnosticAt]).toContain('timeoutPhase=awaiting-headers');
    expect(run.lines[diagnosticAt]).toContain('transportErrorCode=ABORT');

    // The fences this test is named for.
    expect(run.outcome).toBe('SMOKE_FAILED');
    expect(run.candidateCredentials).toBe(0);
    expect(run.candidateSessions).toBe(0);
    expect(run.lines.join(' ')).not.toContain('phase=safety');
    expect(run.lines.join(' ')).not.toContain('phase=p10');
    expect(run.reviewBundlePath).toBeUndefined();
    expect(existsSync(run.reviewOutputPath)).toBe(false);
  });

  it('a SUCCESSFUL smoke also emits its diagnostic before the PASS line', async () => {
    const run = await runToSmoke(
      smokeResult(true, 'smoke-ok', {
        credentialResolutions: 1,
        credentialEntryMs: 6_200,
        networkElapsedMs: 900,
        totalElapsedMs: 7_300,
      }),
    );
    const at = (fragment: string): number => run.lines.findIndex((l) => l.includes(fragment));
    expect(at('phase=smoke-execution status=DIAGNOSTIC')).toBeGreaterThan(
      at('phase=preflight status=PASS'),
    );
    expect(at('phase=smoke status=PASS requests=1')).toBeGreaterThan(
      at('phase=smoke-execution status=DIAGNOSTIC'),
    );
    expect(run.smokeRuns).toBe(1);
    // The healthy reference timing is what a later failure gets compared against.
    expect(run.lines[at('phase=smoke-execution status=DIAGNOSTIC')]).toContain(
      'credentialEntryMs=6200',
    );
    expect(run.lines[at('phase=smoke-execution status=DIAGNOSTIC')]).toContain(
      'networkElapsedMs=900',
    );
    // A passing smoke DOES proceed to the second credential — the fence is specific to failure.
    expect(run.candidateCredentials).toBe(1);
    expect(run.outcome).toBe('CANDIDATE_BIND_FAILED');
  });

  it('the operator emits the diagnostic BEFORE the authoritative status line', () => {
    // Order matters: a terminal is read top to bottom, and an owner who sees the verdict first often
    // stops there. Proven against the real operator source rather than a re-implementation.
    const source = new URL('../operator.ts', import.meta.url);
    const code = readFileSync(source, 'utf8');
    const diagnosticAt = code.indexOf('emitSmokeExecutionDiagnostics(safe, smoke)');
    const failedAt = code.indexOf("safe.line({ phase: 'smoke', status: 'FAILED'");
    const passAt = code.indexOf("safe.line({ phase: 'smoke', status: 'PASS'");
    expect(diagnosticAt).toBeGreaterThan(0);
    expect(failedAt).toBeGreaterThan(diagnosticAt);
    expect(passAt).toBeGreaterThan(diagnosticAt);
  });

  it('the authoritative failure line and its exit code are UNCHANGED', () => {
    const source = new URL('../operator.ts', import.meta.url);
    const code = readFileSync(source, 'utf8');
    // Byte-for-byte the pre-R2 line.
    expect(code).toContain(
      "safe.line({ phase: 'smoke', status: 'FAILED', reason: smoke.reason, requests: 1 });",
    );
    expect(code).toContain("return { outcome: 'SMOKE_FAILED' };");
    expect(OPERATOR_EXIT_CODES.SMOKE_FAILED).toBe(12);
  });

  it('the smoke TIMER and timeout budget are not touched by this package', () => {
    // R2 is observability only. Moving the budget before measuring where it was spent would destroy
    // the evidence the diagnostics exist to capture.
    const code = readFileSync(new URL('../operator.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      'timeoutMs',
      'createSystemSmokeTimer',
      'setTimeout(',
      'AbortSignal.timeout',
    ]) {
      expect(code, `the operator must not touch ${forbidden}`).not.toContain(forbidden);
    }
  });
});
