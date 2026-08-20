/**
 * POST-RA1 — the NEUTRAL client acceptance gate, driven end to end with a fake network.
 *
 * ### What this run must and must not send
 *
 * RA1 used the representative gate and received HTTP 400 with `JSON_VALIDATE_FAILED`. Its captured
 * request came from the SAFETY fixture manifest and resolves to
 * `riya.safety.candidate-as-authority.01` — an adversarial turn telling Riya to treat its own answer
 * as the final decision. That receipt stands; what it measured is narrower than its name suggested.
 *
 * This gate sends ONE request carrying an ORDINARY client turn, through the same production builder,
 * the same projected schema and the same governed budget. So these specs assert the negative on the
 * WIRE: exactly one send, it carries the neutral messages, and it carries neither the synthetic tiny
 * pair nor the safety-derived turn. A regression that quietly sent the old capture would still pass a
 * happy-path spec while answering the question RA1 already answered.
 *
 * The transport is fake and no credential is real; everything above it is the production path.
 */
import { createGroqApiKey, projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
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

import {
  createNeutralRepresentativeLedger,
  NEUTRAL_REPRESENTATIVE_MAX_ESTIMATED_COST_USD,
  NEUTRAL_REPRESENTATIVE_MAX_PROVIDER_REQUESTS,
} from '../accounting.js';
import { ledgerForRunGoal, parseCliArgs } from '../bin.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import { captureNeutralClientRiyaRequest } from '../neutral-client-diagnostic-request.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { SYNTHETIC_CANARY_MESSAGES } from '../diagnostic-canary-port.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  createLiveNeutralRepresentativeComposition,
  NEUTRAL_REPRESENTATIVE_COMPLETION_BUDGET,
} from '../neutral-representative-acceptance-port.js';
import { NEUTRAL_CLIENT_STEP_ID } from '../internal/operational-acceptance-plan.js';
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

const SRC = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-nra-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-NRA-SENTINEL-NEVER-A-REAL-KEY-00000';

interface RecordedSend {
  readonly model: string;
  readonly maxCompletionTokens: number;
  readonly responseFormatSchema: unknown;
  readonly responseFormatStrict: boolean | undefined;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly signal: AbortSignal;
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

const okBody = JSON.stringify({
  id: 'chatcmpl-nra',
  object: 'chat.completion',
  created: 1,
  model: CANDIDATE_MODEL_ID,
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"ok":"OK"}' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
});

/** The rate-limit body OAD3 actually met, with a marker no emitter may ever print. */
const rateLimitBody = JSON.stringify({
  error: {
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
  },
});

function fakeTransport(status = 200): {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
} {
  const sends: RecordedSend[] = [];
  const transport: GroqTransport = {
    send: (request, signal) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const responseFormat = parsed['response_format'] as
        { json_schema?: { strict?: boolean; schema?: unknown } } | undefined;
      sends.push({
        model: String(parsed['model']),
        maxCompletionTokens: Number(parsed['max_completion_tokens']),
        responseFormatSchema: responseFormat?.json_schema?.schema,
        responseFormatStrict: responseFormat?.json_schema?.strict,
        messages: (parsed['messages'] ?? []) as readonly {
          readonly role: string;
          readonly content: string;
        }[],
        signal,
        authorization: request.headers['authorization'] ?? '',
        body: parsed,
      });
      return Promise.resolve({
        status,
        retryAfterSeconds: null,
        bodyText: status === 200 ? okBody : rateLimitBody,
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

let captured: CapturedProductionRiyaRequest;
/** The SAFETY-DERIVED capture RA1 sent. Held only so the specs can assert it is NOT sent here. */
let safetyDerived: CapturedProductionRiyaRequest;
let projectedSchema: unknown;
beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  safetyDerived = await captureProductionRiyaCanaryRequest();
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
  readonly composition: ReturnType<typeof createLiveNeutralRepresentativeComposition> | undefined;
}

interface RunOptions {
  readonly status?: number;
  readonly omitRunner?: boolean;
  readonly bindThrows?: boolean;
}

/** Drive the REAL operator through the REAL live composition over a fake wire. */
async function runGate(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;
  const wire = fakeTransport(options.status ?? 200);
  const candidateCredential = createGroqApiKey(SENTINEL_KEY);
  const credentialsHandedToRunner: unknown[] = [];
  let runnerOpenCalls = 0;
  let openCandidateCalls = 0;
  let composition: ReturnType<typeof createLiveNeutralRepresentativeComposition> | undefined;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    // The REAL ledger the executable would choose for this goal.
    ledger: ledgerForRunGoal('POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE'),
    runGoal: 'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE',
    openSmokeCredential: () =>
      Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(SENTINEL_KEY),
        },
      }),
    runSmoke: () => Promise.resolve(SMOKE_PASS),
    openCandidateCredential: () => Promise.resolve(candidateCredential),
    openCandidate: () => {
      openCandidateCalls += 1;
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-NEUTRAL-GATE');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openNeutralRepresentativeRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            composition = createLiveNeutralRepresentativeComposition({
              credential,
              openTransport: () => wire.transport,
              captured,
              projectedSchema,
            });
            return Promise.resolve({ probe: composition.probe, run: composition.run });
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

describe('the CLI and the executable bind the new goal', () => {
  it('the real CLI accepts exactly the new run goal', () => {
    const parsed = parseCliArgs(['--run-goal', 'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.args.runGoal).toBe('POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE');
    }
    // Every earlier goal still parses, unchanged.
    for (const goal of [
      'SAFETY_REPLICATION',
      'REQUEST_CONTRACT_DIAGNOSTIC',
      'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
      'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
      'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
      'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
    ]) {
      expect(parseCliArgs(['--run-goal', goal]).ok).toBe(true);
    }
    expect(parseCliArgs(['--run-goal', 'NEUTRAL_REPRESENTATIVE_ACCEPTANCE']).ok).toBe(false);
  });

  it('exposes no budget, model, provider, credential, retry or skip override', () => {
    for (const flag of [
      '--completion-budget',
      '--model',
      '--provider',
      '--api-key',
      '--retry',
      '--cooldown',
      '--skip-smoke',
      '--force',
    ]) {
      expect(parseCliArgs([flag, '1']).ok).toBe(false);
    }
  });

  it('the exit code is its own (28), and every prior code is unchanged', () => {
    expect(OPERATOR_EXIT_CODES.POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE).toBe(28);
    expect(OPERATOR_EXIT_CODES.POST_OAD3_REPRESENTATIVE_ACCEPTANCE_COMPLETE).toBe(27);
    expect(OPERATOR_EXIT_CODES.POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE).toBe(26);
    expect(OPERATOR_EXIT_CODES.POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE).toBe(25);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('bin.ts binds the concrete live runner and its own ledger', () => {
    const bin = readFileSync(join(SRC, 'bin.ts'), 'utf8');
    // The HF4-R8 defect, asserted rather than left possible.
    expect(bin).toContain("from './neutral-representative-acceptance-port.js'");
    expect(bin).toContain('openNeutralRepresentativeRunner: (credential) =>');
    expect(bin).toContain('openLiveNeutralRepresentativeRunner({');
    expect(bin).toContain('createNeutralRepresentativeLedger()');
  });

  it('a missing port fails closed and sends nothing', async () => {
    const run = await runGate({ omitRunner: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=port-missing'))).toBe(true);
    expect(run.sends).toHaveLength(0);
  });

  it('a runner that fails to bind fails closed and leaks nothing', async () => {
    const run = await runGate({ bindThrows: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=runner-bind-failed'))).toBe(true);
    expect(run.sends).toHaveLength(0);
    expect(run.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL');
  });
});

describe('the ledger bounds the run at two requests and one dollar', () => {
  it('the hard ceiling is 2 requests / USD 1', () => {
    expect(NEUTRAL_REPRESENTATIVE_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(NEUTRAL_REPRESENTATIVE_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('no THIRD provider reservation succeeds', () => {
    const ledger = createNeutralRepresentativeLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    expect(ledger.reserve('neutral-representative-probe').ok).toBe(true);
    ledger.settle(undefined, true);
    const third = ledger.reserve('neutral-representative-probe');
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.refusal).toBe('request-limit-reached');
    }
    expect(ledger.snapshot().totalProviderRequests).toBe(2);
    expect(ledger.snapshot().neutralRepresentativeProbeProviderRequests).toBe(1);
  });
});

describe('the gate sends EXACTLY ONE request, and it is the representative one', () => {
  it('runs one probe after the smoke and stops at exit 28', async () => {
    const run = await runGate();
    expect(run.outcome).toBe('POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE');
    // THE bound this whole goal exists to hold.
    expect(run.sends).toHaveLength(1);
    const probeRows = run.lines.filter((line) => line.includes('status=PROBE'));
    expect(probeRows).toHaveLength(1);
    expect(probeRows[0]).toContain(`stepId=${NEUTRAL_CLIENT_STEP_ID}`);
    expect(run.lines.at(-1)).toContain(
      'finalStatus=POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE',
    );
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('neutralRepresentativeProbeRequests=1');
    expect(receipt).toContain('totalProviderRequests=2');
  });

  it('repeats NO earlier probe — not O0, O1, O2, nor RA1 safety-derived O3', async () => {
    const run = await runGate();
    const syntheticBytes = JSON.stringify(
      SYNTHETIC_CANARY_MESSAGES.map((one) => ({ role: one.role, content: one.content })),
    );
    const safetyBytes = JSON.stringify(
      safetyDerived.messages.map((one) => ({ role: one.role, content: one.content })),
    );
    for (const send of run.sends) {
      // Not the synthetic tiny pair O0-O2 carried.
      expect(JSON.stringify(send.messages)).not.toBe(syntheticBytes);
      // And NOT the adversarial safety-derived turn RA1 sent, which is the whole point of this run.
      expect(JSON.stringify(send.messages)).not.toBe(safetyBytes);
    }
    for (const stepId of [
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
      'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
    ]) {
      expect(run.lines.some((line) => line.includes(`stepId=${stepId}`))).toBe(false);
    }
    // The row names the neutral source, so a report can never confuse RA1 with this run.
    expect(run.lines.some((line) => line.includes('messageSource=CAPTURED_NEUTRAL_CLIENT'))).toBe(
      true,
    );
    expect(run.lines.some((line) => line.includes('messageSource=CAPTURED_REPRESENTATIVE'))).toBe(
      false,
    );
  });

  it('the one request carries the exact production schema and the CAPTURED messages', async () => {
    const run = await runGate();
    const send = run.sends[0];
    expect(send).toBeDefined();
    if (send === undefined) {
      return;
    }
    expect(send.responseFormatSchema).toEqual(projectedSchema);
    expect(send.messages).toEqual(
      captured.messages.map((one) => ({ role: one.role, content: one.content })),
    );
    // The schema is byte-identical to the one the safety-derived capture yields, so the ONLY
    // authored difference between RA1 and this run is the client turn.
    const safetyProjection = projectGroqStrictJsonSchema(safetyDerived.rawStructuredJsonSchema);
    expect(safetyProjection.ok).toBe(true);
    if (safetyProjection.ok) {
      expect(JSON.stringify(send.responseFormatSchema)).toBe(
        JSON.stringify(safetyProjection.schema),
      );
    }
    expect(send.model).toBe(CANDIDATE_MODEL_ID);
    expect(send.responseFormatStrict).toBe(true);
  });

  it('the wire budget is the production 4,096 and the ceiling stays 65,536', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('the representative probe must reach the wire');
    }
    expect(send.maxCompletionTokens).toBe(4096);
    expect(send.maxCompletionTokens).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(send.maxCompletionTokens).toBe(NEUTRAL_REPRESENTATIVE_COMPLETION_BUDGET);
    expect(send.maxCompletionTokens).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);

    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition === undefined) {
      return;
    }
    // CAPABILITY and BUDGET stay separate, as in every port beside this one.
    expect([...composition.requestCompletionBudgetsUsed()]).toEqual([4096]);
    for (const ceiling of composition.capabilityCeilingsUsed()) {
      expect(ceiling).toBe(65_536);
      expect(ceiling).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    }
  });

  it('sends no sampling, reasoning or retry control', async () => {
    const run = await runGate();
    for (const send of run.sends) {
      for (const forbidden of [
        'temperature',
        'top_p',
        'seed',
        'reasoning_effort',
        'service_tier',
      ]) {
        expect(send.body, forbidden).not.toHaveProperty(forbidden);
      }
    }
  });

  it('a rate-limited probe still sends exactly once: no retry, no fallback', async () => {
    const run = await runGate({ status: 429 });
    // The OAD3 case. A retry loop would show as a second send; a fallback as a second model.
    expect(run.sends).toHaveLength(1);
    expect(new Set(run.sends.map((one) => one.model))).toEqual(new Set([CANDIDATE_MODEL_ID]));
    expect(run.sends.every((one) => one.model !== 'openai/gpt-oss-120b')).toBe(true);
  });

  it('binds the runner once, to the SAME credential, and builds no candidate session', async () => {
    const run = await runGate();
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toHaveLength(1);
    expect(run.credentialsHandedToRunner[0]).toBe(run.candidateCredential);
    expect(run.openCandidateCalls).toBe(0);
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
    expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('reviewBundleWritten=false');
    expect(receipt).toContain('usageBoundViolated=false');
  });
});

describe('the classification reads the boundary honestly', () => {
  it('HTTP 200 reports REPRESENTATIVE_ACCEPTED', async () => {
    const run = await runGate();
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'representativeAcceptanceClassification=REPRESENTATIVE_ACCEPTED',
    );
    expect(classification).toContain('providerHttpStatus=200');
  });

  it('HTTP 429 reports REPRESENTATIVE_RATE_LIMITED, never a rejection', async () => {
    const run = await runGate({ status: 429 });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    // The reading OAD3 needed. A rate limit is not a verdict on the request.
    expect(classification).toContain(
      'representativeAcceptanceClassification=REPRESENTATIVE_RATE_LIMITED',
    );
    expect(classification).toContain('providerHttpClass=RATE_LIMITED_429');
    expect(run.lines.join('\n')).not.toContain('REPRESENTATIVE_PROVIDER_REJECTED');
    // The run still COMPLETES: exit 28 says the gate ran, not that it passed.
    expect(run.outcome).toBe('POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE');
  });

  it('no provider body, message, prompt, schema or credential reaches the output', async () => {
    const run = await runGate({ status: 429 });
    const output = run.lines.join('\n');
    expect(rateLimitBody).toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
    expect(output).not.toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
    expect(output).not.toContain(SENTINEL_KEY);
    expect(output).not.toContain('Bearer');
    for (const message of [...captured.messages, ...safetyDerived.messages]) {
      expect(output).not.toContain(message.content);
    }
    expect(output).not.toContain('additionalProperties');
    expect(output).not.toContain('"properties"');
  });
});
