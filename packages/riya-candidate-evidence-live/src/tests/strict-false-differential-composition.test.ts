/**
 * POST-RBD1 — the best-effort `json_schema` (strict=false) differential, end to end over a fake wire.
 *
 * ### The central proof is a RECURSIVE leaf diff of the TWO REAL COMPOSITIONS
 *
 * RLD1 met `json_validate_failed` at 4,096 and RBD1 met it again at 8,192, both under
 * `json_schema.strict: true`. This run turns constrained decoding off and holds everything else.
 *
 * So the spec drives BOTH live compositions — the merged RBD1 one and this one — over recording
 * transports and compares every LEAF PATH of the bodies they emit:
 *
 *   added leaf paths   === []
 *   removed leaf paths === []
 *   changed leaf paths === ['response_format.json_schema.strict']   (true -> false)
 *
 * A top-level key comparison would be useless here: `response_format` is an object, so a top-level
 * check could only say "response_format changed" and could not tell a flipped flag from a dropped
 * schema. The recursion is what makes this a one-variable proof.
 *
 * ### The trap this run exists to avoid
 *
 * Production's `buildResponseFormat(schema, false)` returns `{ type: 'json_object' }`, which drops
 * the schema NAME and the schema BODY along with the flag. The wire assertions below therefore
 * require `json_schema` mode, the same name and a present schema on the candidate — not merely a
 * different strict value.
 *
 * ### Production must not move
 *
 * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096 and the production Groq body still sends
 * `strict: true` with no reasoning field. Both are asserted against the real production provider.
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
import { STRICT_FALSE_DIFFERENTIAL_STEP_ID } from '../internal/operational-acceptance-plan.js';
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
  createLiveStrictFalseDifferentialComposition,
  STRICT_FALSE_OUTPUT_BUDGET,
} from '../strict-false-differential-port.js';
import { createLiveReasoningBudget8192Composition } from '../reasoning-budget-8192-port.js';
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
  const directory = mkdtempSync(join(tmpdir(), 'riya-sfd-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-SFD-SENTINEL-NEVER-A-REAL-KEY-00000';

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
    id: 'chatcmpl-sfd',
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
    id: 'chatcmpl-sfd-nousage',
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
    ledger: ledgerForRunGoal(
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    ),
    runGoal: 'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
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
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-STRICT-FALSE-DIFFERENTIAL');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openStrictFalseDifferentialRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            const composition = createLiveStrictFalseDifferentialComposition({
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

/** Every leaf path of a JSON-ish value, so a NESTED change cannot hide behind a top-level key. */
function leafPaths(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (value === null || typeof value !== 'object') {
    out.set(prefix, JSON.stringify(value));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [k, v] of leafPaths(item, `${prefix}[${String(index)}]`)) {
        out.set(k, v);
      }
    });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    for (const [k, v] of leafPaths(child, prefix === '' ? key : `${prefix}.${key}`)) {
      out.set(k, v);
    }
  }
  return out;
}

describe('THE ONE-LEAF PROOF: strict=false differs from RBD1 in exactly one nested leaf', () => {
  it('changes only response_format.json_schema.strict, adding and removing nothing', async () => {
    // Both REAL live compositions, over recording transports. A diff of what two governed runs
    // actually emit — not a comparison of two hand-written field lists.
    const rbd1Wire = recordingTransport();
    const rbd1 = createLiveReasoningBudget8192Composition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => rbd1Wire.transport,
      captured,
      projectedSchema,
    });
    await rbd1.run(rbd1.probe);

    const strictFalseWire = recordingTransport();
    const strictFalse = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => strictFalseWire.transport,
      captured,
      projectedSchema,
    });
    await strictFalse.run(strictFalse.probe);

    const baseline = rbd1Wire.bodies()[0];
    const candidate = strictFalseWire.bodies()[0];
    if (baseline === undefined || candidate === undefined) {
      throw new Error('both compositions must have sent exactly one body');
    }

    const a = leafPaths(baseline);
    const b = leafPaths(candidate);
    const added = [...b.keys()].filter((k) => !a.has(k)).sort();
    const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
    const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).sort();

    expect(added).toStrictEqual([]);
    expect(removed).toStrictEqual([]);
    expect(changed).toStrictEqual(['response_format.json_schema.strict']);
    expect(a.get('response_format.json_schema.strict')).toBe('true');
    expect(b.get('response_format.json_schema.strict')).toBe('false');

    // Named explicitly as well, because these are what a reader will look for — and because the
    // schema DISAPPEARING is the specific failure the leaf diff exists to catch.
    const baseFormat = baseline['response_format'] as {
      type: string;
      json_schema: { name: string; schema: unknown };
    };
    const candFormat = candidate['response_format'] as {
      type: string;
      json_schema: { name: string; schema: unknown };
    };
    expect(candFormat.type).toBe('json_schema');
    expect(candFormat.type).toBe(baseFormat.type);
    expect(candFormat.json_schema.name).toBe(baseFormat.json_schema.name);
    expect(JSON.stringify(candFormat.json_schema.schema)).toBe(
      JSON.stringify(baseFormat.json_schema.schema),
    );
    expect(JSON.stringify(candFormat.json_schema.schema)).toBe(JSON.stringify(projectedSchema));
    expect(candidate['max_completion_tokens']).toBe(8192);
    expect(candidate['reasoning_effort']).toBe('low');
    expect(candidate['model']).toBe('openai/gpt-oss-20b');
    expect(candidate['stream']).toBe(false);
    expect(candidate['n']).toBe(1);
    expect(JSON.stringify(candidate['messages'])).toBe(JSON.stringify(captured.messages));
  });

  it('never sends json_object — the production non-strict shape', async () => {
    const wire = recordingTransport();
    const composition = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => wire.transport,
      captured,
      projectedSchema,
    });
    await composition.run(composition.probe);
    const body = wire.bodies()[0];
    if (body === undefined) {
      throw new Error('one body expected');
    }
    const format = body['response_format'] as { type: string };
    expect(format.type).not.toBe('json_object');
    expect(format.type).toBe('json_schema');
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

  it('holds the budget, model, endpoint and effort the shared primitive built', async () => {
    const wire = recordingTransport();
    const composition = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => wire.transport,
      captured,
      projectedSchema,
    });
    await composition.run(composition.probe);
    expect([...composition.requestCompletionBudgetsUsed()]).toStrictEqual([8192]);
    expect([...composition.capabilityCeilingsUsed()]).toStrictEqual([
      CANDIDATE_MAX_COMPLETION_TOKENS,
    ]);
    expect([...composition.candidateModelsUsed()]).toStrictEqual([CANDIDATE_MODEL_ID]);
    expect([...composition.endpointsUsed()]).toStrictEqual([GROQ_CHAT_COMPLETIONS_ENDPOINT]);
    expect([...composition.reasoningEffortsUsed()]).toStrictEqual(['low']);
  });

  it('fails closed on an unbound credential, before any probe', () => {
    expect(() =>
      createLiveStrictFalseDifferentialComposition({
        credential: 'not-a-groq-key',
        openTransport: () => recordingTransport().transport,
        captured,
        projectedSchema,
      }),
    ).toThrow('QFJ_STRICT_FALSE_DIFFERENTIAL_CREDENTIAL_NOT_BOUND');
  });
});

describe('production is not moved by this bridge', () => {
  it('leaves RIYA_COMPLETION_BUDGET_TOKENS at 4096', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(STRICT_FALSE_OUTPUT_BUDGET).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
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
    // Production still sends STRICT TRUE with the schema retained. This bridge does not move it.
    const productionFormat = body['response_format'] as {
      type: string;
      json_schema?: { strict?: boolean };
    };
    expect(productionFormat.type).toBe('json_schema');
    expect(productionFormat.json_schema?.strict).toBe(true);
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
  it('sends exactly ONE request, to Chat Completions, at 8192, low effort, strict FALSE', async () => {
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
    // THE variable on the wire, and the mode that did NOT move beside it.
    expect(send.responseFormatStrict).toBe(false);
    expect(JSON.stringify(send.responseFormatSchema)).toBe(JSON.stringify(projectedSchema));
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
    expect(receipt['priorFailedProbeUsageObserved']).toBe('false');
    expect(receipt['priorTruncationProven']).toBe('false');
    expect(receipt['baselineStrict']).toBe('true');
    expect(receipt['candidateStrict']).toBe('false');
    // The MODE did not move -- the misreading this field set exists to prevent.
    expect(receipt['baselineStructuredOutputMode']).toBe('json_schema');
    expect(receipt['candidateStructuredOutputMode']).toBe('json_schema');
    expect(receipt['productionNonStrictFallbackMode']).toBe('json_object');
    expect(receipt['maxCompletionTokens']).toBe('8192');
    expect(receipt['reasoningEffort']).toBe('low');
    expect(receipt['baselineClassification']).toBe(
      'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID',
    );
  });
});

describe('the operator sequence, and what it never touches', () => {
  it('runs one probe and stops at exit 33', async () => {
    const run = await runGate();
    expect(run.outcome).toBe(
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE',
    );
    expect(
      OPERATOR_EXIT_CODES[
        run.outcome as 'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE'
      ],
    ).toBe(33);
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
    expect(receipt['strictFalseProbeRequests']).toBe('1');
    // Neither prior counter moves: RBD1's strict request is NOT replayed.
    expect(receipt['reasoningBudget8192ProbeRequests']).toBe('0');
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
    expect(classification['strictFalseClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_ACCEPTED',
    );
    expect(classification['localValidationPassed']).toBe('true');
  });

  it('classifies a wire-shaped document production REFUSES as LOCAL_VALIDATION_FAILED', async () => {
    const run = await runGate({ document: '{"ok":"OK"}' });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['strictFalseClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_LOCAL_VALIDATION_FAILED',
    );
    expect(classification['localValidationCompleted']).toBe('true');
    expect(classification['localValidationPassed']).toBe('false');
  });

  it('classifies a 400 json_validate_failed as PROVIDER_OUTPUT_INVALID', async () => {
    const run = await runGate({ status: 400 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['strictFalseClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID',
    );
    expect(classification['providerErrorCode']).toBe('JSON_VALIDATE_FAILED');
  });

  it('classifies a 413 as a REQUEST rejection, not an output failure', async () => {
    const run = await runGate({ status: 413 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['strictFalseClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
    );
  });

  it('classifies a 429 as rate-limited', async () => {
    const run = await runGate({ status: 429 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['strictFalseClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_RATE_LIMITED',
    );
  });

  it('records its own step id and the held effort on the probe line', async () => {
    const run = await runGate();
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['stepId']).toBe(STRICT_FALSE_DIFFERENTIAL_STEP_ID);
    expect(probe['baselineStrict']).toBe('true');
    expect(probe['candidateStrict']).toBe('false');
    expect(probe['baselineStructuredOutputMode']).toBe('json_schema');
    expect(probe['candidateStructuredOutputMode']).toBe('json_schema');
    expect(probe['maxCompletionTokens']).toBe('8192');
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
      expect(all).not.toContain('chatcmpl-sfd');
      const system = captured.messages[0]?.content ?? '';
      expect(all).not.toContain(system.slice(0, 40));
      expect(all).not.toContain('additionalProperties');
    }
  });
});

describe('the CLI accepts the goal and no raw parameter', () => {
  it('parses the exact new run goal, and RLD1’s still parses', () => {
    for (const goal of [
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
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
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
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
      '--strict',
      '--strict-json',
      '--response-format',
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
