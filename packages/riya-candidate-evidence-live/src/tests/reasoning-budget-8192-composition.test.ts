/**
 * POST-RLD1 — the low-reasoning 8,192 output-budget differential, driven end to end over a fake wire.
 *
 * ### The central proof is a diff of the TWO REAL COMPOSITIONS
 *
 * RLD1 sent the neutral production request at `reasoning_effort='low'` and 4,096, and met HTTP 400
 * with `json_validate_failed`. This run sends the same request at 8,192.
 *
 * So the spec drives BOTH live compositions — the merged RLD1 one and this one — over recording
 * transports and compares the bodies they actually emit:
 *
 *   added keys   === []
 *   removed keys === []
 *   changed keys === ['max_completion_tokens']   (4096 -> 8192)
 *
 * Every other key byte-identical, which covers the model, the messages, the projected schema, strict
 * mode, `reasoning_effort`, `stream` and `n` in one loop — and catches a twelfth field a hand-written
 * list would miss.
 *
 * The two ports are callers of ONE shared primitive, so this is confirming a property of the
 * construction rather than propping one up. The diff would still catch a regression that gave either
 * port its own config, adapter or transport.
 *
 * ### Production must not move
 *
 * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096 and the production Groq body still carries no reasoning
 * field of any spelling. Both are asserted against the real production provider's recorded body.
 *
 * The transport is fake and no credential is real; everything above it is the production path.
 */
import {
  createGroqApiKey,
  createGroqProviderConfig,
  createSystemClock,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  GROQ_RESPONSES_ENDPOINT,
  GroqModelProvider,
  projectGroqStrictJsonSchema,
} from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

import { ledgerForRunGoal, parseCliArgs } from '../bin.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_RELEASE,
  CANDIDATE_SUPPORTS_STRICT_JSON,
  CANDIDATE_CATALOG_SNAPSHOT,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { REASONING_BUDGET_8192_STEP_ID } from '../internal/operational-acceptance-plan.js';
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
  createLiveReasoningBudget8192Composition,
  REASONING_BUDGET_8192_OUTPUT_BUDGET,
} from '../reasoning-budget-8192-port.js';
import { createLiveReasoningDifferentialComposition } from '../reasoning-differential-port.js';
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

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-rbd-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-RBD-SENTINEL-NEVER-A-REAL-KEY-00000';

interface RecordedSend {
  readonly url: string;
  readonly model: string;
  readonly maxCompletionTokens: unknown;
  readonly reasoningEffort: unknown;
  readonly responseFormatSchema: unknown;
  readonly responseFormatStrict: unknown;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

function okBody(documentJson: string): string {
  return JSON.stringify({
    id: 'chatcmpl-rbd',
    object: 'chat.completion',
    created: 1,
    model: CANDIDATE_MODEL_ID,
    choices: [
      { index: 0, message: { role: 'assistant', content: documentJson }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 1400, total_tokens: 2600 },
  });
}

function okBodyWithoutUsage(documentJson: string): string {
  return JSON.stringify({
    id: 'chatcmpl-rbd-nousage',
    object: 'chat.completion',
    created: 1,
    model: CANDIDATE_MODEL_ID,
    choices: [
      { index: 0, message: { role: 'assistant', content: documentJson }, finish_reason: 'stop' },
    ],
  });
}

/** The strict-output failure RLD1 met, with markers no emitter may ever print. */
const jsonValidateFailedBody = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
    failed_generation: 'FAILED-GENERATION-MUST-NEVER-BE-EMITTED',
  },
});

/** A payload-too-large refusal — the case that would INVALIDATE this differential. */
const payloadTooLargeBody = JSON.stringify({
  error: { type: 'invalid_request_error', code: 'request_too_large', message: 'NEVER-EMITTED' },
});

const rateLimitBody = JSON.stringify({
  error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'NEVER-EMITTED' },
});

interface WireOptions {
  readonly status?: number;
  readonly reportUsage?: boolean;
  readonly document?: string;
}

function fakeTransport(options: WireOptions = {}): {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
} {
  const sends: RecordedSend[] = [];
  const status = options.status ?? 200;
  const transport: GroqTransport = {
    send: (request) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const responseFormat = parsed['response_format'] as
        { json_schema?: { strict?: boolean; schema?: unknown } } | undefined;
      sends.push({
        url: request.url,
        model: String(parsed['model']),
        maxCompletionTokens: parsed['max_completion_tokens'],
        reasoningEffort: parsed['reasoning_effort'],
        responseFormatSchema: responseFormat?.json_schema?.schema,
        responseFormatStrict: responseFormat?.json_schema?.strict,
        messages: (parsed['messages'] ?? []) as readonly {
          readonly role: string;
          readonly content: string;
        }[],
        authorization: request.headers['authorization'] ?? '',
        body: parsed,
      });
      const document = options.document ?? productionValidDocument;
      const bodyText =
        status === 200
          ? options.reportUsage === false
            ? okBodyWithoutUsage(document)
            : okBody(document)
          : status === 429
            ? rateLimitBody
            : status === 413
              ? payloadTooLargeBody
              : jsonValidateFailedBody;
      return Promise.resolve({ status, retryAfterSeconds: null, bodyText });
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

/** The governed smoke, reporting the same observed figures RLD1's receipt carried. */
const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 194, outputTokens: 57 },
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

let captured: CapturedProductionRiyaRequest;
let projectedSchema: unknown;
let productionValidDocument: string;
beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the real Riya schema must project');
  }
  projectedSchema = projection.schema;
  const valid = evolutionPayload({
    current: syntheticContinuityFor('NEED', NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID),
    language: 'ENGLISH',
    citations: [],
  });
  if (captured.projectStructuredResult(valid) === undefined) {
    throw new Error('the fixture document must satisfy the FULL production projector');
  }
  productionValidDocument = JSON.stringify(valid);
});

interface RunRecord {
  readonly lines: readonly string[];
  readonly outcome: string;
  readonly runnerOpenCalls: number;
  readonly openCandidateCalls: number;
  readonly credentialsHandedToRunner: readonly unknown[];
  readonly candidateCredential: unknown;
  readonly sends: readonly RecordedSend[];
  readonly bundleDirEntries: readonly string[];
}

interface RunOptions extends WireOptions {
  readonly omitRunner?: boolean;
  readonly bindThrows?: boolean;
  readonly smokeFails?: boolean;
}

async function runGate(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;
  const wire = fakeTransport(options);
  const candidateCredential = createGroqApiKey(SENTINEL_KEY);
  const credentialsHandedToRunner: unknown[] = [];
  const bundleDir = externalDir();
  let runnerOpenCalls = 0;
  let openCandidateCalls = 0;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(bundleDir, 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    ledger: ledgerForRunGoal('POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL'),
    runGoal: 'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
    openSmokeCredential: () =>
      Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(SENTINEL_KEY),
        },
      }),
    runSmoke: () =>
      Promise.resolve(
        options.smokeFails === true
          ? ({ ...SMOKE_PASS, ok: false, reason: 'smoke-refused' } as unknown as SmokeRunResult)
          : SMOKE_PASS,
      ),
    openCandidateCredential: () => Promise.resolve(candidateCredential),
    openCandidate: () => {
      openCandidateCalls += 1;
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-BUDGET-DIFFERENTIAL');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openReasoningBudget8192Runner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            const composition = createLiveReasoningBudget8192Composition({
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
    bundleDirEntries: readdirSync(bundleDir),
  };
}

/** `SafeConsole` emits `key=value` pairs, not JSON. Values come back as STRINGS, deliberately. */
function lineWith(lines: readonly string[], marker: string): Record<string, string> {
  const found = lines.find((line) => line.includes(marker));
  if (found === undefined) {
    throw new Error(`no line containing ${marker}`);
  }
  const fields: Record<string, string> = {};
  for (const pair of found.split(' ')) {
    const index = pair.indexOf('=');
    if (index > 0) {
      fields[pair.slice(0, index)] = pair.slice(index + 1);
    }
  }
  return fields;
}

function recordingTransport(): {
  readonly transport: GroqTransport;
  readonly bodies: () => readonly Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  return {
    transport: {
      send: (request) => {
        bodies.push(JSON.parse(request.body) as Record<string, unknown>);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: okBody(productionValidDocument),
        });
      },
    },
    bodies: () => bodies,
  };
}

describe('THE ONE-VARIABLE PROOF: 8192 differs from RLD1 in exactly max_completion_tokens', () => {
  it('changes one key, adds none and removes none', async () => {
    // Both REAL live compositions, over recording transports. This is a diff of what two governed
    // runs actually emit — not a comparison of two hand-written field lists.
    const rld1Wire = recordingTransport();
    const rld1 = createLiveReasoningDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => rld1Wire.transport,
      captured,
      projectedSchema,
    });
    await rld1.run(rld1.probe);

    const budgetWire = recordingTransport();
    const budget = createLiveReasoningBudget8192Composition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => budgetWire.transport,
      captured,
      projectedSchema,
    });
    await budget.run(budget.probe);

    const baseline = rld1Wire.bodies()[0];
    const candidate = budgetWire.bodies()[0];
    if (baseline === undefined || candidate === undefined) {
      throw new Error('both compositions must have sent exactly one body');
    }

    const added = Object.keys(candidate).filter((key) => !(key in baseline));
    const removed = Object.keys(baseline).filter((key) => !(key in candidate));
    const changed = Object.keys(baseline).filter(
      (key) => JSON.stringify(baseline[key]) !== JSON.stringify(candidate[key]),
    );

    expect(added).toStrictEqual([]);
    expect(removed).toStrictEqual([]);
    expect(changed).toStrictEqual(['max_completion_tokens']);
    expect(baseline['max_completion_tokens']).toBe(4096);
    expect(candidate['max_completion_tokens']).toBe(8192);

    // Every OTHER key byte-identical — model, messages, schema, strict, reasoning_effort, stream, n.
    for (const key of Object.keys(baseline).filter((one) => one !== 'max_completion_tokens')) {
      expect(JSON.stringify(candidate[key]), key).toBe(JSON.stringify(baseline[key]));
    }
    // Named explicitly as well, because these are the ones a reader will look for.
    expect(candidate['reasoning_effort']).toBe('low');
    expect(candidate['model']).toBe('openai/gpt-oss-20b');
    expect(candidate['stream']).toBe(false);
    expect(candidate['n']).toBe(1);
  });

  it('carries no reasoning capture, sampling, tool or seed key', async () => {
    const budgetWire = recordingTransport();
    const budget = createLiveReasoningBudget8192Composition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => budgetWire.transport,
      captured,
      projectedSchema,
    });
    await budget.run(budget.probe);
    const body = budgetWire.bodies()[0];
    if (body === undefined) {
      throw new Error('one body expected');
    }
    for (const forbidden of [
      'temperature',
      'top_p',
      'seed',
      'tools',
      'tool_choice',
      'reasoning',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });

  it('asks for 8192 exactly once, and leaves the capability ceiling at 65,536', async () => {
    const budgetWire = recordingTransport();
    const budget = createLiveReasoningBudget8192Composition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => budgetWire.transport,
      captured,
      projectedSchema,
    });
    await budget.run(budget.probe);
    expect([...budget.requestCompletionBudgetsUsed()]).toStrictEqual([8192]);
    // The CONFIG ceiling is untouched: a diagnostic may narrow the request, never widen the ceiling.
    expect([...budget.capabilityCeilingsUsed()]).toStrictEqual([CANDIDATE_MAX_COMPLETION_TOKENS]);
    expect([...budget.candidateModelsUsed()]).toStrictEqual([CANDIDATE_MODEL_ID]);
    expect([...budget.endpointsUsed()]).toStrictEqual([GROQ_CHAT_COMPLETIONS_ENDPOINT]);
    expect([...budget.reasoningEffortsUsed()]).toStrictEqual(['low']);
  });

  it('fails closed on an unbound credential, before any probe', () => {
    expect(() =>
      createLiveReasoningBudget8192Composition({
        credential: 'not-a-groq-key',
        openTransport: () => recordingTransport().transport,
        captured,
        projectedSchema,
      }),
    ).toThrow('QFJ_REASONING_BUDGET_8192_CREDENTIAL_NOT_BOUND');
  });
});

describe('production is not moved by this bridge', () => {
  it('leaves RIYA_COMPLETION_BUDGET_TOKENS at 4096', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(REASONING_BUDGET_8192_OUTPUT_BUDGET).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
  });

  it('leaves the PRODUCTION Groq body at 4096 with no reasoning field of any spelling', async () => {
    const productionWire = recordingTransport();
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_CATALOG_SNAPSHOT,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey: createGroqApiKey(SENTINEL_KEY),
      transport: productionWire.transport,
      dataControlsAttested: true,
    });
    await new GroqModelProvider(config, createSystemClock()).invoke({
      runId: 'production-unchanged-proof',
      messages: captured.messages,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: projectedSchema,
      timeoutMs: 30_000,
      maxCompletionTokens: RIYA_COMPLETION_BUDGET_TOKENS,
      signal: new AbortController().signal,
    });
    const body = productionWire.bodies()[0];
    if (body === undefined) {
      throw new Error('the production provider must have sent one body');
    }
    expect(body['max_completion_tokens']).toBe(4096);
    for (const forbidden of [
      'reasoning',
      'reasoning_effort',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });
});

describe('the wire, end to end through the operator', () => {
  it('sends exactly ONE request, to Chat Completions, at 8192 and low effort', async () => {
    const run = await runGate();
    expect(run.sends).toHaveLength(1);
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    expect(send.maxCompletionTokens).toBe(8192);
    expect(send.reasoningEffort).toBe('low');
    expect(send.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
    expect(send.url).not.toBe(GROQ_RESPONSES_ENDPOINT);
    expect(send.model).toBe(CANDIDATE_MODEL_ID);
    expect(send.model).not.toBe(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID);
    expect(send.responseFormatStrict).toBe(true);
  });

  it('carries the captured neutral messages and projected schema byte-for-byte', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    expect(JSON.stringify(send.messages)).toBe(JSON.stringify(captured.messages));
    expect(send.messages.map((one) => one.role)).toStrictEqual(['system', 'user']);
    expect(JSON.stringify(send.responseFormatSchema)).toBe(JSON.stringify(projectedSchema));
  });
});

describe('usage propagation', () => {
  it('settles PROVIDER-REPORTED usage, so the receipt reads PROVIDER_ONLY', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['inputTokensTotal']).toBe(String(194 + 1200));
    expect(receipt['outputTokensTotal']).toBe(String(57 + 1400));
    expect(receipt['inputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['outputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['costIsEstimated']).toBe('false');
  });

  it('bounds a probe that reports nothing, and says MIXED — the RLD1 shape', async () => {
    const run = await runGate({ reportUsage: false });
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['inputUsageProvenance']).toBe('MIXED');
    expect(receipt['outputUsageProvenance']).toBe('MIXED');
    expect(receipt['costIsEstimated']).toBe('true');
    // The CEILING is the bound, not the 8,192 the request asked for.
    expect(receipt['outputTokensTotal']).toBe(String(57 + CANDIDATE_MAX_COMPLETION_TOKENS));
  });

  it('prints the two constants that stop the hypothesis reading as a proof', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['baselineFailedProbeUsageObserved']).toBe('false');
    expect(receipt['baselineTruncationProven']).toBe('false');
    expect(receipt['baselineCompletionBudget']).toBe('4096');
    expect(receipt['candidateCompletionBudget']).toBe('8192');
    expect(receipt['baselineClassification']).toBe(
      'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
    );
  });
});

describe('the operator sequence, and what it never touches', () => {
  it('runs one probe and stops at exit 32', async () => {
    const run = await runGate();
    expect(run.outcome).toBe('POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE');
    expect(
      OPERATOR_EXIT_CODES[
        run.outcome as 'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE'
      ],
    ).toBe(32);
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toStrictEqual([run.candidateCredential]);
    expect(run.sends).toHaveLength(1);
    expect(run.openCandidateCalls).toBe(0);
  });

  it('spends ZERO probes when the smoke fails', async () => {
    const run = await runGate({ smokeFails: true });
    expect(run.outcome).toBe('SMOKE_FAILED');
    expect(run.runnerOpenCalls).toBe(0);
    expect(run.sends).toHaveLength(0);
  });

  it('reaches no safety authority, no P10 and writes NO review bundle', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['safetyProviderRequests']).toBe('0');
    expect(receipt['p10ProviderRequests']).toBe('0');
    expect(receipt['safetyEvaluated']).toBe('false');
    expect(receipt['reviewBundleWritten']).toBe('false');
    expect(run.bundleDirEntries).toStrictEqual([]);
  });

  it('counts its OWN probe and does NOT replay RLD1’s 4096 request', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['totalProviderRequests']).toBe('2');
    expect(receipt['smokeRequests']).toBe('1');
    expect(receipt['reasoningBudget8192ProbeRequests']).toBe('1');
    // RLD1's counter stays at zero: its answer is recorded and is not re-purchased.
    expect(receipt['reasoningDifferentialProbeRequests']).toBe('0');
    expect(receipt['responsesDifferentialProbeRequests']).toBe('0');
    expect(receipt['modelDifferentialProbeRequests']).toBe('0');
  });

  it('fails closed, and content-free, when the seam is missing or the bind throws', async () => {
    const missing = await runGate({ omitRunner: true });
    expect(missing.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(missing.sends).toHaveLength(0);

    const threw = await runGate({ bindThrows: true });
    expect(threw.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(threw.sends).toHaveLength(0);
    expect(threw.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL-MUST-NOT-APPEAR');
  });
});

describe('classification end to end', () => {
  it('classifies a production-valid 2xx as ACCEPTED', async () => {
    const run = await runGate();
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningBudget8192Classification']).toBe(
      'REASONING_LOW_8192_STRICT_ACCEPTED',
    );
    expect(classification['localValidationPassed']).toBe('true');
  });

  it('classifies a wire-shaped document production REFUSES as LOCAL_VALIDATION_FAILED', async () => {
    const run = await runGate({ document: '{"ok":"OK"}' });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningBudget8192Classification']).toBe(
      'REASONING_LOW_8192_STRICT_LOCAL_VALIDATION_FAILED',
    );
    expect(classification['localValidationCompleted']).toBe('true');
    expect(classification['localValidationPassed']).toBe('false');
  });

  it('classifies a 400 json_validate_failed as PROVIDER_OUTPUT_INVALID', async () => {
    const run = await runGate({ status: 400 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningBudget8192Classification']).toBe(
      'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID',
    );
    expect(classification['providerErrorCode']).toBe('JSON_VALIDATE_FAILED');
  });

  it('classifies a 413 as a REQUEST rejection, not an output failure', async () => {
    const run = await runGate({ status: 413 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningBudget8192Classification']).toBe(
      'REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED',
    );
  });

  it('classifies a 429 as rate-limited', async () => {
    const run = await runGate({ status: 429 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningBudget8192Classification']).toBe(
      'REASONING_LOW_8192_STRICT_RATE_LIMITED',
    );
  });

  it('records its own step id and the held effort on the probe line', async () => {
    const run = await runGate();
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['stepId']).toBe(REASONING_BUDGET_8192_STEP_ID);
    expect(probe['candidateCompletionBudget']).toBe('8192');
    expect(probe['baselineCompletionBudget']).toBe('4096');
    expect(probe['reasoningEffort']).toBe('low');
    expect(probe['candidateModel']).toBe('openai/gpt-oss-20b');
  });

  it('never emits a credential, prompt byte, schema body, provider body or reasoning trace', async () => {
    for (const options of [{}, { status: 400 }, { status: 413 }, { status: 429 }] as const) {
      const run = await runGate(options);
      const all = run.lines.join('\n');
      expect(all).not.toContain(SENTINEL_KEY);
      expect(all).not.toContain('Bearer');
      expect(all).not.toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
      expect(all).not.toContain('FAILED-GENERATION-MUST-NEVER-BE-EMITTED');
      expect(all).not.toContain('failed_generation');
      expect(all).not.toContain('chatcmpl-rbd');
      const system = captured.messages[0]?.content ?? '';
      expect(all).not.toContain(system.slice(0, 40));
      expect(all).not.toContain('additionalProperties');
    }
  });
});

describe('the CLI accepts the goal and no raw parameter', () => {
  it('parses the exact new run goal, and RLD1’s still parses', () => {
    for (const goal of [
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
      'SAFETY_REPLICATION',
    ]) {
      const parsed = parseCliArgs([
        '--smoke-config',
        'c.json',
        '--review-output',
        'o.json',
        '--run-goal',
        goal,
      ]);
      expect(parsed.ok, goal).toBe(true);
    }
  });

  it('still defaults to FULL_EVIDENCE', () => {
    const bare = parseCliArgs(['--smoke-config', 'c.json', '--review-output', 'o.json']);
    expect(bare.ok ? bare.args.runGoal : 'set').toBeUndefined();
  });

  it('refuses a missing value, a duplicate goal and an unknown goal', () => {
    expect(parseCliArgs(['--run-goal']).ok).toBe(false);
    const duplicate = parseCliArgs([
      '--run-goal',
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
      '--run-goal',
      'SAFETY_REPLICATION',
    ]);
    expect(duplicate.ok ? 'ok' : duplicate.reason).toBe('duplicate-run-goal');
    for (const bad of [
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_16384_DIFFERENTIAL',
      'FULL_EVIDENCE',
      '8192',
    ]) {
      const parsed = parseCliArgs(['--run-goal', bad]);
      expect(parsed.ok ? 'ok' : parsed.reason, bad).toBe('invalid-run-goal');
    }
  });

  it('exposes NO raw budget flag: the owner selects a PURPOSE', () => {
    for (const flag of [
      '--max-completion-tokens',
      '--budget',
      '--output-budget',
      '--reasoning-effort',
      '--model',
      '--retry',
      '--force',
      '--skip-smoke',
      '--api-key',
    ]) {
      const parsed = parseCliArgs([flag, '8192']);
      expect(parsed.ok ? 'ok' : parsed.reason, flag).toBe('unknown-argument');
    }
  });
});
