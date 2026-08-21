/**
 * POST-MD120B3 — the Groq Responses API strict endpoint differential, driven end to end over a fake
 * network.
 *
 * ### What must reach the wire, and what must not
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` over Chat Completions and
 * received HTTP 400 with `JSON_VALIDATE_FAILED`. MD120B3 sent the same request to
 * `openai/gpt-oss-120b` and met the same 400 with the same code, so the model is not the axis.
 *
 * This run re-sends the SAME captured request on the SAME production model and changes only the
 * ENDPOINT. So the specs assert both halves on the WIRE: exactly one send, to
 * `https://api.groq.com/openai/v1/responses`, carrying `openai/gpt-oss-20b`, the Responses envelope,
 * the projected production schema byte-for-byte, NRA1's captured message bytes, and the integer 4,096
 * in the Responses output field — and NOT a Chat Completions request, NOT 120B, and NOT a second send.
 *
 * The one structural difference from every earlier gate: a provider 2xx is not the finding. A 2xx
 * whose document the PRODUCTION canonical validator rejects must classify as
 * `RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED`, and a spec drives exactly that.
 *
 * The transport is fake and no credential is real; everything above it is the production path.
 */
import { GROQ_CHAT_COMPLETIONS_ENDPOINT, GROQ_RESPONSES_ENDPOINT } from '@qf-jarvis/model-gateway';
import { createGroqApiKey, projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
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
  createResponsesDifferentialLedger,
  RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
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
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { SYNTHETIC_CANARY_MESSAGES } from '../diagnostic-canary-port.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { RESPONSES_DIFFERENTIAL_STEP_ID } from '../internal/operational-acceptance-plan.js';
import { MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID } from '../model-differential-identity.js';
import {
  captureNeutralClientRiyaRequest,
  NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
} from '../neutral-client-diagnostic-request.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import {
  createLiveResponsesDifferentialComposition,
  RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET,
} from '../responses-differential-port.js';
import { RESPONSES_DIFFERENTIAL_SCHEMA_NAME } from '../responses-differential-identity.js';
import { createSafeConsole } from '../safe-console.js';
import { syntheticContinuityFor } from '../synthetic-context.js';
import { evolutionPayload } from './helpers/contract-valid-riya-response.js';

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
  const directory = mkdtempSync(join(tmpdir(), 'riya-rsp-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-RSP-SENTINEL-NEVER-A-REAL-KEY-00000';

interface RecordedSend {
  readonly url: string;
  readonly model: string;
  readonly maxOutputTokens: unknown;
  readonly maxCompletionTokens: unknown;
  readonly formatSchema: unknown;
  readonly formatStrict: unknown;
  readonly formatName: unknown;
  readonly formatType: unknown;
  readonly input: readonly { readonly role: string; readonly content: string }[];
  readonly signal: AbortSignal;
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

/**
 * A Groq Responses payload, in the shape the API documents.
 *
 * The `reasoning` item is deliberately present: GPT-OSS models emit one, and the decoder must skip it
 * without reading it. The marker inside is a canary — no emitter may ever print it.
 */
function responsesOkBody(documentJson: string): string {
  return JSON.stringify({
    id: 'resp_rsp20b1',
    object: 'response',
    status: 'completed',
    model: CANDIDATE_MODEL_ID,
    output: [
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [],
        content: [{ type: 'reasoning_text', text: 'REASONING-TEXT-MUST-NEVER-BE-EMITTED' }],
      },
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: documentJson }],
      },
    ],
    usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
  });
}

/** The rate-limit body OAD3 actually met, with a marker no emitter may ever print. */
const rateLimitBody = JSON.stringify({
  error: {
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
  },
});

/** The refusal MD120B3 and NRA1 both received, in its Responses form. */
const jsonValidateFailedBody = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'FAILED-GENERATION-DETAIL-MUST-NEVER-BE-EMITTED',
    failed_generation: 'FAILED-GENERATION-DETAIL-MUST-NEVER-BE-EMITTED',
  },
});

interface WireOptions {
  readonly status?: number;
  readonly bodyText?: string;
}

function fakeTransport(options: WireOptions = {}): {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
} {
  const status = options.status ?? 200;
  const sends: RecordedSend[] = [];
  const transport: GroqTransport = {
    send: (request, signal) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const text = parsed['text'] as { format?: Record<string, unknown> } | undefined;
      sends.push({
        url: request.url,
        model: String(parsed['model']),
        maxOutputTokens: parsed['max_output_tokens'],
        maxCompletionTokens: parsed['max_completion_tokens'],
        formatSchema: text?.format?.['schema'],
        formatStrict: text?.format?.['strict'],
        formatName: text?.format?.['name'],
        formatType: text?.format?.['type'],
        input: (parsed['input'] ?? []) as readonly {
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
        bodyText: options.bodyText ?? (status === 200 ? responsesOkBody('{}') : rateLimitBody),
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
/** A document the PRODUCTION canonical schema accepts, built by the production evolution reducer. */
let canonicalValidDocument: string;
beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  safetyDerived = await captureProductionRiyaCanaryRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the real Riya schema must project');
  }
  projectedSchema = projection.schema;
  // Not hand-written: the profile refuses an answer whose claimed plan disagrees with what the
  // reducer independently decides, so a valid document has to be computed the same way production
  // computes it.
  canonicalValidDocument = JSON.stringify(
    evolutionPayload({
      current: syntheticContinuityFor('NEED', NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID),
      language: 'ENGLISH',
      citations: [],
    }),
  );
});

interface RunRecord {
  readonly lines: readonly string[];
  readonly outcome: string;
  readonly runnerOpenCalls: number;
  readonly openCandidateCalls: number;
  readonly credentialsHandedToRunner: readonly unknown[];
  readonly candidateCredential: unknown;
  readonly sends: readonly RecordedSend[];
  readonly composition: ReturnType<typeof createLiveResponsesDifferentialComposition> | undefined;
}

interface RunOptions extends WireOptions {
  readonly omitRunner?: boolean;
  readonly bindThrows?: boolean;
}

/** Drive the REAL operator through the REAL live composition over a fake wire. */
async function runGate(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;
  const wire = fakeTransport(options);
  const candidateCredential = createGroqApiKey(SENTINEL_KEY);
  const credentialsHandedToRunner: unknown[] = [];
  let runnerOpenCalls = 0;
  let openCandidateCalls = 0;
  let composition: ReturnType<typeof createLiveResponsesDifferentialComposition> | undefined;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    // The REAL ledger the executable would choose for this goal.
    ledger: ledgerForRunGoal('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL'),
    runGoal: 'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL',
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
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-RESPONSES-DIFFERENTIAL');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openResponsesDifferentialRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            composition = createLiveResponsesDifferentialComposition({
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
    const parsed = parseCliArgs([
      '--run-goal',
      'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL',
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.args.runGoal).toBe('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL');
    }
    // Every earlier goal still parses, unchanged.
    for (const goal of [
      'SAFETY_REPLICATION',
      'REQUEST_CONTRACT_DIAGNOSTIC',
      'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
      'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
      'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
      'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
      'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE',
      'POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL',
    ]) {
      expect(parseCliArgs(['--run-goal', goal]).ok).toBe(true);
    }
    expect(parseCliArgs(['--run-goal', 'GROQ_RESPONSES_API_STRICT_DIFFERENTIAL']).ok).toBe(false);
  });

  it('exposes no endpoint, budget, model, provider, credential, retry or skip override', () => {
    for (const flag of [
      '--endpoint',
      '--responses',
      '--completion-budget',
      '--max-output-tokens',
      '--model',
      '--provider',
      '--api-key',
      '--retry',
      '--skip-smoke',
      '--force',
    ]) {
      expect(parseCliArgs([flag, '1']).ok).toBe(false);
    }
  });

  it('the exit code is its own (30), and every prior code is unchanged', () => {
    expect(OPERATOR_EXIT_CODES.POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE).toBe(
      30,
    );
    expect(OPERATOR_EXIT_CODES.POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL_COMPLETE).toBe(29);
    expect(OPERATOR_EXIT_CODES.POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE).toBe(28);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('bin.ts binds the concrete live runner and its own ledger', () => {
    const bin = readFileSync(join(SRC, 'bin.ts'), 'utf8');
    // The HF4-R8 defect, asserted rather than left possible.
    expect(bin).toContain("from './responses-differential-port.js'");
    expect(bin).toContain('openResponsesDifferentialRunner: (credential) =>');
    expect(bin).toContain('openLiveResponsesDifferentialRunner({');
    expect(bin).toContain('createResponsesDifferentialLedger()');
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
    expect(RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('no THIRD provider reservation succeeds', () => {
    const ledger = createResponsesDifferentialLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    expect(ledger.reserve('responses-differential-probe').ok).toBe(true);
    ledger.settle(undefined, true);
    expect(ledger.reserve('responses-differential-probe').ok).toBe(false);
    expect(ledger.snapshot().totalProviderRequests).toBe(2);
  });
});

describe('J/K — EXACTLY ONE send, and it is the RESPONSES one', () => {
  it('runs one probe after the smoke and stops at exit 30', async () => {
    const run = await runGate();
    expect(run.outcome).toBe('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE');
    // THE bound this whole goal exists to hold.
    expect(run.sends).toHaveLength(1);
    const probeRows = run.lines.filter((line) => line.includes('status=PROBE'));
    expect(probeRows).toHaveLength(1);
    expect(probeRows[0]).toContain(`stepId=${RESPONSES_DIFFERENTIAL_STEP_ID}`);
    expect(run.lines.at(-1)).toContain(
      'finalStatus=POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE',
    );
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('responsesDifferentialProbeRequests=1');
    expect(receipt).toContain('totalProviderRequests=2');
  });

  it('K: the candidate request goes to the RESPONSES endpoint, never Chat Completions', async () => {
    const run = await runGate();
    // THE variable, asserted where it actually matters: on the wire.
    expect(run.sends.map((one) => one.url)).toEqual([GROQ_RESPONSES_ENDPOINT]);
    expect(run.sends[0]?.url).toBe('https://api.groq.com/openai/v1/responses');
    // No Chat Completions candidate request is sent by this differential at all. Only the existing
    // smoke remains Chat Completions, and it does not run through this transport.
    expect(run.sends.every((one) => one.url !== GROQ_CHAT_COMPLETIONS_ENDPOINT)).toBe(true);

    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition !== undefined) {
      expect([...composition.endpointsUsed()]).toEqual([GROQ_RESPONSES_ENDPOINT]);
    }
    // Both contracts named on every row, so a receipt states the comparison it belongs to.
    expect(run.lines.some((line) => line.includes('endpointFamily=RESPONSES_API'))).toBe(true);
    expect(run.lines.some((line) => line.includes('baselineEndpoint=CHAT_COMPLETIONS'))).toBe(true);
  });

  it('B: sends the PRODUCTION 20B on the wire, and never the 120B diagnostic model', async () => {
    const run = await runGate();
    expect(run.sends.map((one) => one.model)).toEqual([CANDIDATE_MODEL_ID]);
    expect(run.sends.every((one) => one.model === 'openai/gpt-oss-20b')).toBe(true);
    // MD120B3 already answered the model question. Moving it here would add a second variable.
    expect(run.sends.every((one) => one.model !== MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID)).toBe(
      true,
    );
    expect(run.sends.every((one) => one.model !== 'openai/gpt-oss-120b')).toBe(true);

    const composition = run.composition;
    if (composition !== undefined) {
      expect([...composition.candidateModelsUsed()]).toEqual([CANDIDATE_MODEL_ID]);
    }
    expect(run.lines.some((line) => line.includes('candidateModel=openai/gpt-oss-20b'))).toBe(true);
  });

  it('repeats NO earlier probe — not O0-O3, not N0, not M0', async () => {
    const run = await runGate();
    const syntheticBytes = JSON.stringify(
      SYNTHETIC_CANARY_MESSAGES.map((one) => ({ role: one.role, content: one.content })),
    );
    const safetyBytes = JSON.stringify(
      safetyDerived.messages.map((one) => ({ role: one.role, content: one.content })),
    );
    for (const send of run.sends) {
      expect(JSON.stringify(send.input)).not.toBe(syntheticBytes);
      expect(JSON.stringify(send.input)).not.toBe(safetyBytes);
    }
    for (const stepId of [
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
      'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
      'N0_EXACT_NEUTRAL_CLIENT_OPERATIONAL',
      'M0_EXACT_NEUTRAL_CLIENT_GPT_OSS_120B_STRICT',
    ]) {
      expect(run.lines.some((line) => line.includes(`stepId=${stepId}`))).toBe(false);
    }
    // The message source is HELD CONSTANT — it is the endpoint that varies, not the request.
    expect(run.lines.some((line) => line.includes('messageSource=CAPTURED_NEUTRAL_CLIENT'))).toBe(
      true,
    );
    expect(run.lines.some((line) => line.includes('messageSource=CAPTURED_REPRESENTATIVE'))).toBe(
      false,
    );
  });
});

describe('C/D/E/F/G — the one request is NRA1’s request, in a different envelope', () => {
  it('D: the system and user content bytes are the captured neutral ones, in order', async () => {
    const run = await runGate();
    const send = run.sends[0];
    expect(send).toBeDefined();
    if (send === undefined) {
      return;
    }
    // Role SEQUENCE preserved, which the Responses `input` array supports.
    expect(send.input.map((one) => one.role)).toEqual(captured.messages.map((one) => one.role));
    expect(send.input.map((one) => one.role)).toEqual(['system', 'user']);
    // Content BYTES, not a paraphrase. No helper prose, no schema tutorial, no JSON example, no
    // rewritten system prompt, no simplified user turn.
    expect(send.input).toEqual(
      captured.messages.map((one) => ({ role: one.role, content: one.content })),
    );
    expect(JSON.stringify(send.input)).toBe(
      JSON.stringify(captured.messages.map((one) => ({ role: one.role, content: one.content }))),
    );
  });

  it('E/F: the schema is the projected PRODUCTION document, byte for byte', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('the responses probe must reach the wire');
    }
    expect(send.formatSchema).toEqual(projectedSchema);
    expect(JSON.stringify(send.formatSchema)).toBe(JSON.stringify(projectedSchema));
    // And it is byte-identical to the document the SAFETY-derived capture yields, so the only
    // authored difference between this run and RA1 remains the client turn.
    const safetyProjection = projectGroqStrictJsonSchema(safetyDerived.rawStructuredJsonSchema);
    expect(safetyProjection.ok).toBe(true);
    if (safetyProjection.ok) {
      expect(JSON.stringify(send.formatSchema)).toBe(JSON.stringify(safetyProjection.schema));
    }
    // The RAW schema behind the projection is the production one, unmodified.
    const reprojected = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
    expect(reprojected.ok).toBe(true);
    if (reprojected.ok) {
      expect(JSON.stringify(reprojected.schema)).toBe(JSON.stringify(send.formatSchema));
    }
  });

  it('the envelope is the documented Responses structured-output form, strict', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('the responses probe must reach the wire');
    }
    // `text.format`, not `response_format`. The envelope difference IS the experiment.
    expect(send.formatType).toBe('json_schema');
    expect(send.formatStrict).toBe(true);
    expect(send.formatName).toBe(RESPONSES_DIFFERENTIAL_SCHEMA_NAME);
    expect(send.body).toHaveProperty('text');
    expect(send.body).not.toHaveProperty('response_format');
    expect(send.body).toHaveProperty('input');
    expect(send.body).not.toHaveProperty('messages');
  });

  it('G: the WIRE output budget is exactly 4,096, in the RESPONSES field', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('the responses probe must reach the wire');
    }
    // §8: equivalence is NOT inferred from naming. The integer is asserted where it lands.
    expect(send.maxOutputTokens).toBe(4096);
    expect(send.maxOutputTokens).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(send.maxOutputTokens).toBe(RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET);
    // The Chat Completions field is absent, so nothing is bounded twice or by the wrong name.
    expect(send.maxCompletionTokens).toBeUndefined();
    // And the capability ceiling did not leak onto the wire.
    expect(send.maxOutputTokens).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);

    const composition = run.composition;
    if (composition === undefined) {
      return;
    }
    // CAPABILITY and BUDGET stay separate, as in every port beside this one.
    expect([...composition.requestOutputBudgetsUsed()]).toEqual([4096]);
    for (const ceiling of composition.capabilityCeilingsUsed()) {
      expect(ceiling).toBe(65_536);
      expect(ceiling).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    }
  });

  it('H/I: no sampling, reasoning, tool, state or background field is sent', async () => {
    const run = await runGate();
    for (const send of run.sends) {
      for (const forbidden of [
        'temperature',
        'top_p',
        'seed',
        'reasoning',
        'reasoning_effort',
        'service_tier',
        'tools',
        'tool_choice',
        'previous_response_id',
        'background',
        'truncation',
        'metadata',
        'instructions',
        'parallel_tool_calls',
      ]) {
        expect(send.body, forbidden).not.toHaveProperty(forbidden);
      }
      // Stateless, explicitly. The Responses API is stateful by design, and a diagnostic that left a
      // copy of a production prompt on a provider would be a privacy decision nobody made.
      expect(send.body['store']).toBe(false);
      expect(send.body['stream']).toBe(false);
    }
  });

  it('L: a rate-limited probe still sends exactly once — no retry, no fallback', async () => {
    const run = await runGate({ status: 429 });
    expect(run.sends).toHaveLength(1);
    // One endpoint on the wire. A fallback to Chat Completions would show as a second URL.
    expect(new Set(run.sends.map((one) => one.url))).toEqual(new Set([GROQ_RESPONSES_ENDPOINT]));
    expect(new Set(run.sends.map((one) => one.model))).toEqual(new Set([CANDIDATE_MODEL_ID]));
  });

  it('binds the runner once, to the SAME credential, and builds no candidate session', async () => {
    const run = await runGate();
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toHaveLength(1);
    expect(run.credentialsHandedToRunner[0]).toBe(run.candidateCredential);
    expect(run.openCandidateCalls).toBe(0);
  });
});

describe('Q/R/S — no safety, no P10, no bundle', () => {
  it('the receipt states every other counter as zero and writes nothing', async () => {
    const run = await runGate();
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
    expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('reviewBundleWritten=false');
    expect(receipt).toContain('usageBoundViolated=false');
    // Its OWN counter, and every earlier gate's stated as zero rather than omitted.
    expect(receipt).toContain('responsesDifferentialProbeRequests=1');
    expect(receipt).toContain('modelDifferentialProbeRequests=0');
    expect(receipt).toContain('neutralRepresentativeProbeRequests=0');
    expect(receipt).toContain('representativeAcceptanceProbeRequests=0');
  });

  it('the receipt states the endpoint gap, the maturity and the tariff', async () => {
    const run = await runGate();
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    // The entitlement gap an owner must not have to infer.
    expect(receipt).toContain('smokeEndpointCheckFamily=CHAT_COMPLETIONS');
    expect(receipt).toContain('smokeProvesEndpointEntitlement=false');
    // Groq ships this contract as beta, and the evidence says so on its face.
    expect(receipt).toContain('endpointMaturity=BETA');
    // Single-model, so the production tariff is exactly right — the opposite of MD120B3's posture,
    // and two receipts that priced differently must be able to say why.
    expect(receipt).toContain('costPricingPosture=PRODUCTION_20B_RATES_FOR_SINGLE_MODEL_RUN');
    expect(receipt).not.toContain('CONSERVATIVE_120B_RATES_FOR_MIXED_MODEL_RUN');
    expect(receipt).toContain('pricingSnapshot=groq-pricing-snapshot-2026-08-20');
  });
});

describe('M/N/O/P — the classification reads BOTH boundaries honestly', () => {
  it('N: 2xx carrying a canonically valid Riya document => ACCEPTED', async () => {
    const run = await runGate({ bodyText: responsesOkBody(canonicalValidDocument) });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'responsesDifferentialClassification=RESPONSES_20B_STRICT_ACCEPTED',
    );
    expect(classification).toContain('providerHttpStatus=200');
    expect(classification).toContain('localValidationCompleted=true');
    expect(classification).toContain('localValidationPassed=true');
    expect(run.outcome).toBe('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE');
  });

  it('O: 2xx carrying a document the PRODUCTION schema rejects => LOCAL_VALIDATION_FAILED', async () => {
    // The failure mode that matters most on a new output contract: the provider accepted the request
    // and returned something, and it is not a Riya reply. A gate that stopped at the provider
    // boundary would have called this a success.
    const run = await runGate({ bodyText: responsesOkBody('{"reply":{"kind":"REPLY"}}') });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'responsesDifferentialClassification=RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED',
    );
    expect(classification).toContain('providerHttpStatus=200');
    expect(classification).toContain('localValidationCompleted=true');
    expect(classification).toContain('localValidationPassed=false');
    // Not collapsed into a provider rejection: nobody rejected anything at the provider.
    expect(run.lines.join('\n')).not.toContain('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    // The run still COMPLETES: exit 30 says the gate ran, not that it passed.
    expect(run.outcome).toBe('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE');
  });

  it('M: HTTP 400 json_validate_failed preserves both literals and classifies REJECTED', async () => {
    const run = await runGate({ status: 400, bodyText: jsonValidateFailedBody });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'responsesDifferentialClassification=RESPONSES_20B_STRICT_PROVIDER_REJECTED',
    );
    expect(classification).toContain('providerHttpStatus=400');
    expect(classification).toContain('providerHttpClass=BAD_REQUEST_400');
    // Preserved verbatim and uninterpreted, exactly as MD120B3 preserved them.
    expect(classification).toContain('providerErrorType=INVALID_REQUEST_ERROR');
    expect(classification).toContain('providerErrorCode=JSON_VALIDATE_FAILED');
    // The local validator never ran, so it reports no verdict.
    expect(classification).toContain('localValidationCompleted=false');
    expect(classification).toContain('localValidationPassed=false');
  });

  it('L: HTTP 429 reports RATE_LIMITED, never a rejection', async () => {
    const run = await runGate({ status: 429 });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'responsesDifferentialClassification=RESPONSES_20B_STRICT_RATE_LIMITED',
    );
    expect(classification).toContain('providerHttpClass=RATE_LIMITED_429');
    expect(run.lines.join('\n')).not.toContain('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
  });

  it('P: HTTP 401, 403 and 404 report INCONCLUSIVE, never an endpoint verdict', async () => {
    for (const status of [401, 403, 404]) {
      const run = await runGate({
        status,
        bodyText: JSON.stringify({
          error: { type: 'permissions_error', code: 'model_permission_blocked_project' },
        }),
      });
      const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
      expect(classification).toContain(
        'responsesDifferentialClassification=RESPONSES_20B_STRICT_INCONCLUSIVE',
      );
      expect(run.lines.join('\n')).not.toContain('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    }
  });

  it('a 2xx whose payload carries no readable document is INCONCLUSIVE', async () => {
    // Nothing reached the local validator, so it reports no verdict rather than a failure.
    const run = await runGate({
      bodyText: JSON.stringify({ id: 'resp_x', status: 'incomplete', output: [] }),
    });
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'responsesDifferentialClassification=RESPONSES_20B_STRICT_INCONCLUSIVE',
    );
    expect(classification).toContain('localValidationCompleted=false');
  });
});

describe('T — provider, body, prompt, schema and OUTPUT content cannot be emitted', () => {
  it('no error body, message, failed_generation or reasoning trace reaches the output', async () => {
    for (const options of [
      { status: 429 },
      { status: 400, bodyText: jsonValidateFailedBody },
      { bodyText: responsesOkBody(canonicalValidDocument) },
    ] as const) {
      const run = await runGate(options);
      const output = run.lines.join('\n');
      expect(output).not.toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
      expect(output).not.toContain('FAILED-GENERATION-DETAIL-MUST-NEVER-BE-EMITTED');
      // The GPT-OSS reasoning item is real, is present in the fake payload, and is never read.
      expect(output).not.toContain('REASONING-TEXT-MUST-NEVER-BE-EMITTED');
      expect(output).not.toContain('failed_generation');
    }
  });

  it('no credential, header, prompt, message or schema document reaches the output', async () => {
    const run = await runGate({ bodyText: responsesOkBody(canonicalValidDocument) });
    const output = run.lines.join('\n');
    expect(output).not.toContain(SENTINEL_KEY);
    expect(output).not.toContain('Bearer');
    expect(output).not.toContain('authorization');
    for (const message of [...captured.messages, ...safetyDerived.messages]) {
      expect(output).not.toContain(message.content);
    }
    expect(output).not.toContain('additionalProperties');
    expect(output).not.toContain('"properties"');
    // The URL is an endpoint identifier and is deliberately not printed either: the closed
    // `endpointFamily` token is what a receipt carries.
    expect(output).not.toContain('api.groq.com');
  });

  it('the accepted MODEL OUTPUT never reaches a line, even though it was validated', async () => {
    // The one new content risk on this gate: the port decodes a document in order to validate it.
    // Two booleans survive that statement, and nothing else.
    const run = await runGate({ bodyText: responsesOkBody(canonicalValidDocument) });
    const output = run.lines.join('\n');
    const document = JSON.parse(canonicalValidDocument) as {
      reply: { replyBody: string };
    };
    expect(document.reply.replyBody.length).toBeGreaterThan(0);
    expect(output).not.toContain(document.reply.replyBody);
    expect(output).not.toContain('replyBody');
    expect(output).not.toContain('questionPlan');
    expect(output).not.toContain(canonicalValidDocument);
  });
});

describe('A — production is untouched, and nothing production imports this', () => {
  const codeOnly = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'dist', '.next', 'coverage', '.turbo'].includes(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'tests') continue;
        out.push(...walk(full));
      } else if (entry.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('the production Riya turn still routes through the Chat Completions provider', () => {
    // The serving path is `GroqModelProvider`, which names `GROQ_CHAT_COMPLETIONS_ENDPOINT`. Neither
    // moved, and the evaluation gateway still composes exactly that provider.
    const gateway = codeOnly(readFileSync(join(SRC, 'evaluation-gateway.ts'), 'utf8'));
    expect(gateway).toContain('providers: [new GroqModelProvider(config, clock)]');
    expect(gateway).not.toContain('Responses');
    const provider = codeOnly(
      readFileSync(
        join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/groq-model-provider.ts'),
        'utf8',
      ),
    );
    expect(provider).toContain('GROQ_CHAT_COMPLETIONS_ENDPOINT');
    expect(provider).toContain('max_completion_tokens');
    // The production adapter knows nothing about the diagnostic contract.
    expect(provider).not.toContain('GROQ_RESPONSES_ENDPOINT');
    expect(provider).not.toContain('max_output_tokens');
    expect(provider).not.toContain('createGroqResponsesDiagnosticProvider');
  });

  it('NO PRODUCTION MODULE anywhere composes the diagnostic Responses surface', () => {
    // The one containment claim this whole bridge rests on. Only the evidence operator's own
    // diagnostic port may name either factory, and only that port does.
    const allowed = new Set([
      // The diagnostic adapter and the transport that serves it.
      join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/groq-responses-diagnostic.ts'),
      join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/groq-transport.ts'),
      // The barrels that carry them, which compose nothing.
      join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/index.ts'),
      join(REPO_ROOT, 'packages/model-gateway/src/index.ts'),
      // The ONE diagnostic port, and the executable that binds it for its own run goal.
      join(SRC, 'responses-differential-port.ts'),
      join(SRC, 'bin.ts'),
      join(SRC, 'index.ts'),
    ]);
    const offenders: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'));
        } catch {
          continue;
        }
        for (const file of files) {
          if (allowed.has(file)) continue;
          const code = codeOnly(readFileSync(file, 'utf8'));
          for (const symbol of [
            'createGroqResponsesDiagnosticProvider',
            'createFetchGroqResponsesTransport',
            'openLiveResponsesDifferentialRunner',
            'createLiveResponsesDifferentialComposition',
          ]) {
            if (code.includes(symbol)) {
              offenders.push(`${file.split(sep).slice(-3).join('/')}: ${symbol}`);
            }
          }
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('the diagnostic adapter registers no provider and joins no routing table', () => {
    const adapter = codeOnly(
      readFileSync(
        join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/groq-responses-diagnostic.ts'),
        'utf8',
      ),
    );
    // It cannot be routed to: no descriptor, no capabilities, no health, no gateway registration.
    for (const forbidden of [
      'implements ModelProvider',
      'descriptor',
      'capabilities()',
      'health()',
      'createModelGateway',
      'rolloutController',
    ]) {
      expect(adapter, `the diagnostic adapter must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the production model, budget, schema and retry posture did not move', () => {
    // Named where a reviewer looks for them, so "production unchanged" is asserted rather than
    // asserted about.
    expect(CANDIDATE_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    const turn = codeOnly(readFileSync(join(SRC, 'riya-turn.ts'), 'utf8'));
    expect(turn).toContain('retryBudget: 0');
    expect(turn).toContain('completionBudget: RIYA_COMPLETION_BUDGET_TOKENS');
    expect(turn).not.toContain('Responses');
  });
});
