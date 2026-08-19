/**
 * POST-PR-131 — the SCHEMA DIFFERENTIAL diagnostic, driven end to end with a fake network.
 *
 * ### Why this spec exists in this exact shape
 *
 * HF4-R8 shipped a complete, reviewed canary port that `bin.ts` never bound. Every spec passed,
 * because every spec injected the port the executable did not, and the compiled command was
 * guaranteed to spend preflight, the smoke request and both credential steps before returning
 * `INTERNAL_CLOSED_FAILURE` having run nothing. A live authorization is consumed at process launch,
 * so that defect would have burned one.
 *
 * So these specs drive the REAL operator through the SAME composition `bin.ts` uses. The transport is
 * fake and no credential is real; everything above it — the probe matrix, the Groq provider, the
 * strict projection, the observer, the ledger, the emitters — is the production path. The bodies the
 * fake transport receives are the bodies the real one would have sent.
 */
import { createGroqApiKey, projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';

import { createSchemaDifferentialDiagnosticLedger } from '../accounting.js';
import { parseCliArgs } from '../bin.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { createLiveSchemaRepairVerificationComposition } from '../schema-repair-verification-port.js';
import { SCHEMA_REPAIR_VERIFICATION_STEP_IDS } from '../internal/riya-schema-repair-verification-plan.js';
import { createSchemaRepairVerificationLedger } from '../accounting.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createSafeConsole } from '../safe-console.js';
import { SCHEMA_PROBE_COMPLETION_CAP } from '../schema-probe-port.js';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';

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

const SRC = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-sdh-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-SDH-SENTINEL-NEVER-A-REAL-KEY-000000';

interface RecordedSend {
  readonly model: string;
  readonly maxCompletionTokens: number;
  readonly responseFormatSchema: unknown;
  readonly responseFormatStrict: boolean | undefined;
  readonly signal: AbortSignal;
  readonly signalAbortedAtSend: boolean;
  readonly authorization: string;
}

interface FakeTransport {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
}

const okBody = JSON.stringify({
  id: 'chatcmpl-sdh',
  object: 'chat.completion',
  created: 1,
  model: CANDIDATE_MODEL_ID,
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"ok":"OK"}' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
});

/** A wire that records and answers. `statusFor` lets one probe be refused without touching others. */
function fakeTransport(statusFor: (index: number) => number = () => 200): FakeTransport {
  const sends: RecordedSend[] = [];
  const transport: GroqTransport = {
    send: (request, signal) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const responseFormat = parsed['response_format'] as
        { json_schema?: { strict?: boolean; schema?: unknown } } | undefined;
      const index = sends.length;
      sends.push({
        model: String(parsed['model']),
        maxCompletionTokens: Number(parsed['max_completion_tokens']),
        responseFormatSchema: responseFormat?.json_schema?.schema,
        responseFormatStrict: responseFormat?.json_schema?.strict,
        signal,
        signalAbortedAtSend: signal.aborted,
        authorization: request.headers['authorization'] ?? '',
      });
      const status = statusFor(index);
      return Promise.resolve({
        status,
        retryAfterSeconds: null,
        bodyText:
          status === 200
            ? okBody
            : JSON.stringify({ error: { type: 'invalid_request_error', code: 'other' } }),
      });
    },
  };
  return { transport, sends: () => sends };
}

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

const SMOKE_FAIL = {
  ok: false,
  reason: 'smoke-timeout',
  references: {},
  latencyMs: 1,
  usage: {},
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

let captured: CapturedProductionRiyaRequest;
let projectedSchema: unknown;
beforeAll(async () => {
  captured = await captureProductionRiyaCanaryRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the real Riya schema must project');
  }
  projectedSchema = projection.schema;
});

interface RunRecord {
  readonly lines: readonly string[];
  readonly outcome: string;
  readonly runnerOpenCalls: number;
  readonly openCandidateCalls: number;
  readonly credentialsHandedToRunner: readonly unknown[];
  readonly candidateCredential: unknown;
  readonly sends: readonly RecordedSend[];
  readonly composition:
    ReturnType<typeof createLiveSchemaRepairVerificationComposition> | undefined;
}

interface RunOptions {
  readonly statusFor?: (index: number) => number;
  readonly smoke?: SmokeRunResult;
  readonly bindThrows?: boolean;
  readonly omitRunner?: boolean;
}

/** Drive the REAL operator through the REAL live composition over a fake wire. */
async function runDiagnostic(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;
  const wire = fakeTransport(options.statusFor);
  const candidateCredential = createGroqApiKey(SENTINEL_KEY);
  const credentialsHandedToRunner: unknown[] = [];
  let runnerOpenCalls = 0;
  let openCandidateCalls = 0;
  let composition: ReturnType<typeof createLiveSchemaRepairVerificationComposition> | undefined;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    ledger: createSchemaRepairVerificationLedger(),
    runGoal: 'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
    openSmokeCredential: () =>
      Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(SENTINEL_KEY),
        },
      }),
    runSmoke: () => Promise.resolve(options.smoke ?? SMOKE_PASS),
    openCandidateCredential: () => Promise.resolve(candidateCredential),
    openCandidate: () => {
      openCandidateCalls += 1;
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-SCHEMA-DIAGNOSTIC');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openSchemaRepairVerificationRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            // THE composition bin.ts uses, with only the transport and the projection injected.
            // The SAME composition bin.ts uses, kept so both budget axes are observable directly.
            composition = createLiveSchemaRepairVerificationComposition({
              credential,
              openTransport: () => wire.transport,
              captured,
              projectedSchema,
            });
            return Promise.resolve({ probes: composition.probes, run: composition.run });
          },
        }),
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
  return {
    lines,
    outcome: result.outcome,
    runnerOpenCalls,
    openCandidateCalls,
    credentialsHandedToRunner,
    candidateCredential,
    sends: wire.sends(),
    composition,
  };
}

describe('the CLI and the executable composition bind the new goal', () => {
  it('the real CLI parses the new run goal', () => {
    const parsed = parseCliArgs(['--run-goal', 'SCHEMA_DIFFERENTIAL_DIAGNOSTIC']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.args.runGoal).toBe('SCHEMA_DIFFERENTIAL_DIAGNOSTIC');
    }
    // The historical goal still parses and is unchanged.
    const historical = parseCliArgs(['--run-goal', 'REQUEST_CONTRACT_DIAGNOSTIC']);
    expect(historical.ok).toBe(true);
    // And an unknown goal is still refused rather than defaulted.
    expect(parseCliArgs(['--run-goal', 'SCHEMA_DIFF']).ok).toBe(false);
  });

  it('bin.ts binds the concrete live verification runner and its own ledger', () => {
    const bin = readFileSync(join(SRC, 'bin.ts'), 'utf8');
    expect(bin).toContain("from './schema-repair-verification-port.js'");
    expect(bin).toContain('openSchemaRepairVerificationRunner: (credential) =>');
    expect(bin).toContain('openLiveSchemaRepairVerificationRunner({');
    expect(bin).toContain('createSchemaRepairVerificationLedger()');
  });

  it('a composition with no probe port fails closed and runs nothing', () => {
    // The exact HF4-R8 defect, asserted as a failure mode rather than left possible.
    return runDiagnostic({ omitRunner: true }).then((run) => {
      expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
      expect(run.lines.some((line) => line.includes('reason=port-missing'))).toBe(true);
      expect(run.sends).toHaveLength(0);
    });
  });
});

describe('a healthy run executes exactly V0-V4 once each', () => {
  it('runs all five probes and stops at exit code 24', async () => {
    const run = await runDiagnostic();
    expect(run.outcome).toBe('POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE');
    expect(OPERATOR_EXIT_CODES.POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE).toBe(25);
    expect(run.sends).toHaveLength(SCHEMA_REPAIR_VERIFICATION_STEP_IDS.length);
    const probeRows = run.lines.filter((line) => line.includes('status=PROBE'));
    expect(probeRows).toHaveLength(5);
    expect(run.lines.at(-1)).toContain('finalStatus=POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE');
  });

  it('binds the runner once, to the SAME credential object, and builds no candidate session', () => {
    return runDiagnostic().then((run) => {
      expect(run.runnerOpenCalls).toBe(1);
      expect(run.credentialsHandedToRunner).toHaveLength(1);
      // Object identity: a second holder would be a second credential policy.
      expect(run.credentialsHandedToRunner[0]).toBe(run.candidateCredential);
      // The diagnostic returns BEFORE `openCandidate`, so no ordinary gateway, cancellation
      // controller, safety port or quality port ever exists.
      expect(run.openCandidateCalls).toBe(0);
      expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
      expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
      expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
    });
  });

  it('EVERY probe goes on the wire at the fixed 512 budget', async () => {
    const run = await runDiagnostic();
    for (const send of run.sends) {
      expect(send.maxCompletionTokens).toBe(SCHEMA_PROBE_COMPLETION_CAP);
      expect(send.maxCompletionTokens).toBe(512);
      // The two budgets a probe must never inherit.
      expect(send.maxCompletionTokens).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
      expect(send.maxCompletionTokens).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
      expect(send.responseFormatStrict).toBe(true);
      expect(send.model).toBe(CANDIDATE_MODEL_ID);
      expect(send.signalAbortedAtSend).toBe(false);
    }
    // One holder: every request carries the same authorization value.
    expect(new Set(run.sends.map((one) => one.authorization)).size).toBe(1);
    // Nine distinct controllers: a shared signal would make one probe's fate another's.
    expect(new Set(run.sends.map((one) => one.signal)).size).toBe(5);
  });

  it('CAPABILITY ceiling and REQUEST budget stay separate in the composition', async () => {
    // THE regression PR #131 repaired and an earlier revision of this harness reintroduced: passing
    // the 512 probe budget into `createGroqProviderConfig` made the diagnostic provider DECLARE a
    // 512-token model capability. The wire was right for the wrong reason.
    //
    // Observed from the composition itself rather than from source text.
    const run = await runDiagnostic();
    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition === undefined) {
      return;
    }

    // Nine providers built, one per probe.
    const ceilings = [...composition.capabilityCeilingsUsed()];
    const budgets = [...composition.requestCompletionBudgetsUsed()];
    expect(ceilings).toHaveLength(5);
    expect(budgets).toHaveLength(5);

    // The MODEL CAPABILITY the diagnostic provider declares is the candidate's real one.
    expect(new Set(ceilings)).toEqual(new Set([CANDIDATE_MAX_COMPLETION_TOKENS]));
    expect(new Set(ceilings)).toEqual(new Set([65_536]));

    // The PER-REQUEST budget is the probe cap, and it is a different number.
    expect(new Set(budgets)).toEqual(new Set([SCHEMA_PROBE_COMPLETION_CAP]));
    expect(new Set(budgets)).toEqual(new Set([512]));
    expect(budgets[0]).not.toBe(ceilings[0]);

    // And the clamp resolves to the budget on the wire: min(512, 65_536).
    for (const send of run.sends) {
      expect(send.maxCompletionTokens).toBe(Math.min(512, 65_536));
    }

    // The governed constants are untouched by this run.
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(14_336);
  });

  it('the wire schema for EVERY probe is the production projection of its planned schema', async () => {
    // The matrix is planned from the already-projected document, and the provider projects again
    // before building `response_format`. That second pass must be identity-preserving on these
    // fragments, or the diagnostic would be measuring a transformed target rather than the one
    // reviewed. Proven per probe rather than assumed.
    const run = await runDiagnostic();
    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition === undefined) {
      return;
    }
    const probes = composition.probes;
    expect(run.sends).toHaveLength(probes.length);

    probes.forEach((probe, index) => {
      const projection = projectGroqStrictJsonSchema(probe.schema);
      expect(projection.ok, probe.stepId).toBe(true);
      if (!projection.ok) {
        return;
      }
      // Send order corresponds exactly to R0-R8.
      expect(JSON.stringify(run.sends[index]?.responseFormatSchema), probe.stepId).toBe(
        JSON.stringify(projection.schema),
      );
      // Identity-preserving: projecting an already-projected fragment changes nothing.
      expect(JSON.stringify(projection.schema), probe.stepId).toBe(JSON.stringify(probe.schema));
    });
  });

  it('R8 puts the EXACT projected production Riya schema on the wire', async () => {
    // The owner exit criterion. R8 is the D5 shape, and what reaches the wire must be structurally
    // the exact projected document the matrix was planned from — not a re-derived approximation.
    const run = await runDiagnostic();
    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition === undefined) {
      return;
    }
    const index = composition.probes.findIndex((one) => one.stepId === 'V4_EXACT_PROJECTED_RIYA');
    expect(index).toBeGreaterThanOrEqual(0);
    const sent = run.sends[index]?.responseFormatSchema;
    expect(JSON.stringify(sent)).toBe(JSON.stringify(projectedSchema));
    // And it is the real document, not a stub.
    expect(JSON.stringify(sent)).toContain('properties');
    expect(JSON.stringify(sent).length).toBeGreaterThan(500);
  });

  it('the send ORDER is exactly V0 through V4', async () => {
    const run = await runDiagnostic();
    const composition = run.composition;
    expect(composition?.probes.map((one) => one.stepId)).toEqual([
      ...SCHEMA_REPAIR_VERIFICATION_STEP_IDS,
    ]);
    // Each probe row is emitted in the same order, so a reader can align rows with sends.
    const rowIds = run.lines
      .filter((line) => line.includes('status=PROBE'))
      .map((line) => /stepId=(\S+)/u.exec(line)?.[1]);
    expect(rowIds).toEqual([...SCHEMA_REPAIR_VERIFICATION_STEP_IDS]);
  });

  it('the receipt names the schema matrix and states safety and P10 as zero', async () => {
    const run = await runDiagnostic();
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('totalProviderRequests=6');
    expect(receipt).toContain('smokeRequests=1');
    expect(receipt).toContain('schemaRepairProbeRequests=5');
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('reviewBundleWritten=false');
  });

  it('emits a closed classification with all three step-id buckets', async () => {
    const run = await runDiagnostic();
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'schemaRepairClassification=REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP',
    );
    expect(classification).toContain('rejectedStepIds=NONE');
    expect(classification).toContain('probesRun=5');
  });

  it('nothing content-bearing reaches the console', async () => {
    const run = await runDiagnostic();
    const all = run.lines.join('\n');
    for (const forbidden of [
      SENTINEL_KEY,
      'Bearer',
      'authorization',
      'additionalProperties',
      'json_schema',
      'replyBody',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

describe('the stop rules', () => {
  it('a FAILED CONTROL stops the matrix before any feature probe', async () => {
    // R0 is the first send. Refusing it must spend none of the remaining eight authorized requests.
    const run = await runDiagnostic({ statusFor: (index) => (index === 0 ? 400 : 200) });
    expect(run.sends).toHaveLength(1);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain('schemaRepairClassification=CONTROL_INVALID');
    // The run still completes and reports — a control failure is a finding, not a crash.
    expect(run.outcome).toBe('POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE');
  });

  it('a FEATURE rejection does NOT stop the matrix — the whole set is collected', async () => {
    // THE property that separates this from S11. R2 (index 2) is refused; every later probe must
    // still run, because the useful answer is the complete set of rejections.
    const run = await runDiagnostic({ statusFor: (index) => (index === 1 ? 400 : 200) });
    expect(run.sends).toHaveLength(5);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    // R8 was accepted here, so the SUMMARY is the acceptance token — the exact production schema was
    // taken, and an isolated wrapper rejection may not headline as though it had not been.
    expect(classification).toContain(
      'schemaRepairClassification=REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP',
    );
    // And the isolated finding is still fully visible.
    expect(classification).toContain('rejectedStepIds=V1_OBSERVATION_SETS_ARRAY');
  });

  it('MULTIPLE feature rejections are all reported, none masked', async () => {
    const run = await runDiagnostic({
      statusFor: (index) => ([1, 2, 3].includes(index) ? 400 : 200),
    });
    expect(run.sends).toHaveLength(5);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain('V1_OBSERVATION_SETS_ARRAY');
    expect(classification).toContain('V2_OBSERVATION_CLEARS_ARRAY');
    expect(classification).toContain('V3_EVOLUTION_GROUP');
  });

  it('wrapper rejections WITH an R8 rejection report REPAIRED_OBSERVATION_SCHEMA_REJECTED', async () => {
    // The other side of the corrected precedence, driven through the real composition: R2 and R8
    // (indices 2 and 8) both refused. Now the exact document really was rejected, so the isolated
    // finding is the headline — and both ids survive.
    const run = await runDiagnostic({ statusFor: (index) => ([1, 4].includes(index) ? 400 : 200) });
    expect(run.sends).toHaveLength(5);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'schemaRepairClassification=REPAIRED_OBSERVATION_SCHEMA_REJECTED',
    );
    expect(classification).toContain('V1_OBSERVATION_SETS_ARRAY');
    expect(classification).toContain('V4_EXACT_PROJECTED_RIYA');
  });

  it('only R8 rejected reports REPAIRED_EVOLUTION_COMPOSITION_REJECTED', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === 4 ? 400 : 200) });
    expect(run.sends).toHaveLength(5);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'schemaRepairClassification=REPAIRED_EVOLUTION_COMPOSITION_REJECTED',
    );
    expect(classification).toContain('rejectedStepIds=V4_EXACT_PROJECTED_RIYA');
  });

  it('a failed SMOKE never constructs the probe runner', async () => {
    const run = await runDiagnostic({ smoke: SMOKE_FAIL });
    expect(run.outcome).toBe('SMOKE_FAILED');
    expect(run.runnerOpenCalls).toBe(0);
    expect(run.openCandidateCalls).toBe(0);
    expect(run.sends).toHaveLength(0);
  });

  it('a bind failure fails closed before R0, with nothing from the error', async () => {
    const run = await runDiagnostic({ bindThrows: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=runner-bind-failed'))).toBe(true);
    expect(run.sends).toHaveLength(0);
    expect(run.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL');
  });
});

describe('the other run goals are untouched', () => {
  it('a non-diagnostic goal never opens the schema probe runner', async () => {
    for (const goal of [
      'SAFETY_REPLICATION',
      'FULL_EVIDENCE',
      'REQUEST_CONTRACT_DIAGNOSTIC',
    ] as const) {
      const lines: string[] = [];
      const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
      harnessState.syntheticDigest = digest;
      let runnerOpenCalls = 0;
      let openCandidateCalls = 0;
      const result = await runCandidateEvidenceOperator({
        console: createSafeConsole((line) => lines.push(line)),
        preflight: {
          smokeConfigPath,
          reviewOutputPath: join(externalDir(), 'bundle.json'),
          repoRoot: REPO_ROOT,
          interactive: true,
        },
        ledger: createSchemaDifferentialDiagnosticLedger(),
        runGoal: goal,
        openSmokeCredential: () =>
          Promise.resolve({
            credentialSource: {
              isInteractive: () => true,
              readOnce: () => Promise.resolve(SENTINEL_KEY),
            },
          }),
        runSmoke: () => Promise.resolve(SMOKE_PASS),
        openCandidateCredential: () => Promise.resolve(createGroqApiKey(SENTINEL_KEY)),
        openCandidate: () => {
          openCandidateCalls += 1;
          throw new Error('bind-refused');
        },
        openSchemaRepairVerificationRunner: () => {
          runnerOpenCalls += 1;
          return Promise.reject(new Error('MUST-NOT-BE-OPENED'));
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
      expect(runnerOpenCalls, goal).toBe(0);
      if (goal === 'REQUEST_CONTRACT_DIAGNOSTIC') {
        // Its own branch still fails closed on its own missing port — unchanged behaviour.
        expect(result.outcome, goal).toBe('INTERNAL_CLOSED_FAILURE');
        expect(lines.some((line) => line.includes('phase=request-contract-diagnostic'))).toBe(true);
      } else {
        expect(result.outcome, goal).toBe('CANDIDATE_BIND_FAILED');
        expect(openCandidateCalls, goal).toBe(1);
      }
      // No schema-probe output leaked into any other goal.
      expect(lines.some((line) => line.includes('phase=schema-repair-verification'))).toBe(false);
    }
  });
});
