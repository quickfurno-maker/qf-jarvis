/**
 * POST-SFD1 — the strict-false LOCAL-VALIDATION LOCALIZATION bridge, end to end over a fake wire.
 *
 * ### The central proof is BYTE EQUALITY, not a field comparison
 *
 * Every earlier differential proved "one variable moved". This one has to prove the opposite: that
 * NOTHING moved on the wire, because SFD2 must ask SFD1's question again and answer a purely local
 * one. SFD1's canonical result was HTTP 413 while its unauthorized duplicate reached HTTP 200, so
 * "same request" is exactly the claim a reader will want checked hardest.
 *
 * The transport seam hands over the serialized request body as a string, so this spec drives BOTH
 * real live compositions over recording transports and compares those strings BYTE FOR BYTE in
 * UTF-8. A recursive leaf diff is asserted beside it — added, removed and changed leaf paths are all
 * empty — so a failure says WHICH path moved rather than only that the bytes differ.
 *
 * ### What is allowed to differ, and where it must not appear
 *
 * The run goal, the step id and the phase token. All three are receipt metadata. A spec asserts the
 * recorded body contains neither step id anywhere in its bytes.
 *
 * ### The two-stage provenance is driven through the REAL operator
 *
 * Four documents reach the fake wire: one the full production projector accepts, one that is
 * wire-valid and production-INVALID (a next-question phase the deterministic reducer did not
 * decide), one that is wire-invalid, and none at all on the non-2xx paths. Each is asserted to
 * produce the localized token that names the stage which refused.
 *
 * A 413 — SFD1's canonical result — must report BOTH stages incomplete. Reporting a stage verdict
 * for a request that never produced a document is the exact failure this vocabulary exists to
 * prevent.
 *
 * ### Production must not move
 *
 * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096 and the production Groq body still sends
 * `strict: true` with no reasoning field of any spelling. Both are asserted against the real
 * production provider.
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
import {
  analyseLocalizedStructuredReply,
  LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS,
} from '../internal/localized-structured-reply-classification.js';
import type { LocalizedStructuredReplyOutcome } from '../internal/localized-structured-reply-classification.js';
import {
  isOneShotDiagnosticRunGoal,
  STATICALLY_CONSUMED_RUN_GOALS,
} from '../internal/one-shot-consumption.js';
import {
  REASONING_BUDGET_8192_STEP_ID,
  REASONING_DIFFERENTIAL_STEP_ID,
  STRICT_FALSE_DIFFERENTIAL_STEP_ID,
  STRICT_FALSE_LOCALIZATION_STEP_ID,
} from '../internal/operational-acceptance-plan.js';
import {
  DEFAULT_RUN_GOAL,
  OPERATOR_RUN_GOALS,
  REUSED_CREDENTIAL_NOTICES,
  SECOND_CREDENTIAL_NOTICES,
} from '../internal/run-goal.js';
import { STRICT_FALSE_CLASSIFICATIONS } from '../internal/strict-false-differential-classification.js';
import { MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID } from '../model-differential-identity.js';
import {
  captureNeutralClientRiyaRequest,
  NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
} from '../neutral-client-diagnostic-request.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createLiveStrictFalseDifferentialComposition } from '../strict-false-differential-port.js';
import {
  createLiveStrictFalseLocalizationComposition,
  STRICT_FALSE_LOCALIZATION_OUTPUT_BUDGET,
} from '../strict-false-localization-port.js';
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

const RUN_GOAL = 'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE' as const;
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-sfl-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-SFL-SENTINEL-NEVER-A-REAL-KEY-00000';

interface RecordedSend {
  readonly url: string;
  readonly rawBody: string;
  readonly model: string;
  readonly maxCompletionTokens: unknown;
  readonly reasoningEffort: unknown;
  readonly responseFormatSchema: unknown;
  readonly responseFormatStrict: unknown;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

function okBody(documentJson: string, withUsage = true): string {
  return JSON.stringify({
    id: 'chatcmpl-sfl',
    object: 'chat.completion',
    created: 1,
    model: CANDIDATE_MODEL_ID,
    choices: [
      { index: 0, message: { role: 'assistant', content: documentJson }, finish_reason: 'stop' },
    ],
    ...(withUsage
      ? { usage: { prompt_tokens: 1200, completion_tokens: 1400, total_tokens: 2600 } }
      : {}),
  });
}

/** The strict-output failure, with markers no emitter may ever print. */
const jsonValidateFailedBody = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
    failed_generation: 'FAILED-GENERATION-MUST-NEVER-BE-EMITTED',
  },
});

/** SFD1's CANONICAL result: a payload-too-large refusal, which localizes nothing. */
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
        rawBody: request.body,
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
          ? okBody(document, options.reportUsage !== false)
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

/** The governed smoke, reporting the same observed figures the earlier receipts carried. */
const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 194, outputTokens: 57 },
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

interface RiyaDocument {
  readonly reply: unknown;
  readonly evolution: {
    readonly version: number;
    readonly observations: unknown;
    readonly skipProjectDetails: boolean;
    readonly questionPlan: { readonly phase: string; readonly questionFields: readonly string[] };
  };
}

let captured: CapturedProductionRiyaRequest;
let projectedSchema: unknown;
/** Wire-valid AND accepted by the FULL production projector. */
let productionValidDocument: string;
/** Wire-valid, production-INVALID: one field moved, a phase the reducer did not decide. */
let wireValidProductionInvalidDocument: string;
/** Refused by the gateway's own first-stage wire schema. */
const wireInvalidDocument = JSON.stringify({ notARiyaAnswer: 'WIRE-INVALID-FIXTURE' });

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
  }) as RiyaDocument;
  if (captured.projectStructuredResult(valid) === undefined) {
    throw new Error('the fixture document must satisfy the FULL production projector');
  }
  productionValidDocument = JSON.stringify(valid);

  // The invariant chosen is the reducer-agreement check: the most stable one in the production
  // projector, and the one the profile's own documentation calls the point of the single-call
  // design. The replacement phase is COMPUTED rather than hard-coded, so it can never accidentally
  // be the decided phase; both values are members of the model-facing enum, so the document stays
  // wire-valid either way.
  const decidedPhase = valid.evolution.questionPlan.phase;
  const disagreeing = {
    ...valid,
    evolution: {
      ...valid.evolution,
      questionPlan: {
        ...valid.evolution.questionPlan,
        phase: decidedPhase === 'SUMMARY' ? 'NEED' : 'SUMMARY',
      },
    },
  };
  if (!captured.structuredWireSchema.safeParse(disagreeing).success) {
    throw new Error('the post-wire fixture must still be WIRE valid');
  }
  if (captured.projectStructuredResult(disagreeing) !== undefined) {
    throw new Error('the post-wire fixture must be refused by the FULL production projector');
  }
  wireValidProductionInvalidDocument = JSON.stringify(disagreeing);

  if (captured.structuredWireSchema.safeParse(JSON.parse(wireInvalidDocument)).success) {
    throw new Error('the wire-invalid fixture must be refused by the wire schema');
  }
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
    ledger: ledgerForRunGoal(RUN_GOAL),
    runGoal: RUN_GOAL,
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
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-STRICT-FALSE-LOCALIZATION');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openStrictFalseLocalizationRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            const composition = createLiveStrictFalseLocalizationComposition({
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
  readonly raw: () => readonly string[];
  readonly bodies: () => readonly Record<string, unknown>[];
} {
  const raw: string[] = [];
  return {
    transport: {
      send: (request) => {
        raw.push(request.body);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: okBody(productionValidDocument),
        });
      },
    },
    raw: () => raw,
    bodies: () => raw.map((one) => JSON.parse(one) as Record<string, unknown>),
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

describe('THE BYTE PROOF: SFD2 sends SFD1 candidate request, unchanged', () => {
  it('emits a BYTE-IDENTICAL serialized body at the transport boundary', async () => {
    // Both REAL live compositions, over recording transports. The transport seam hands over the
    // serialized body as a string, so this is the request itself and not a reconstruction of it.
    const sfd1Wire = recordingTransport();
    const sfd1 = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => sfd1Wire.transport,
      captured,
      projectedSchema,
    });
    await sfd1.run(sfd1.probe);

    const sfd2Wire = recordingTransport();
    const sfd2 = createLiveStrictFalseLocalizationComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => sfd2Wire.transport,
      captured,
      projectedSchema,
    });
    await sfd2.run(sfd2.probe);

    const baseline = sfd1Wire.raw()[0];
    const candidate = sfd2Wire.raw()[0];
    if (baseline === undefined || candidate === undefined) {
      throw new Error('both compositions must have sent exactly one body');
    }
    expect(sfd1Wire.raw()).toHaveLength(1);
    expect(sfd2Wire.raw()).toHaveLength(1);

    // BYTE FOR BYTE, in UTF-8, at the seam that actually sends it.
    expect(Buffer.from(candidate, 'utf8').equals(Buffer.from(baseline, 'utf8'))).toBe(true);
    expect(Buffer.byteLength(candidate, 'utf8')).toBe(Buffer.byteLength(baseline, 'utf8'));
    expect(candidate).toBe(baseline);
  });

  it('has an EMPTY recursive leaf diff — nothing added, removed or changed', async () => {
    // Asserted beside the byte comparison rather than instead of it: byte equality is the stronger
    // claim, and this one says WHICH path moved when a future edit breaks it.
    const sfd1Wire = recordingTransport();
    const sfd1 = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => sfd1Wire.transport,
      captured,
      projectedSchema,
    });
    await sfd1.run(sfd1.probe);

    const sfd2Wire = recordingTransport();
    const sfd2 = createLiveStrictFalseLocalizationComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => sfd2Wire.transport,
      captured,
      projectedSchema,
    });
    await sfd2.run(sfd2.probe);

    const baseline = sfd1Wire.bodies()[0];
    const candidate = sfd2Wire.bodies()[0];
    if (baseline === undefined || candidate === undefined) {
      throw new Error('both compositions must have sent exactly one body');
    }
    const a = leafPaths(baseline);
    const b = leafPaths(candidate);
    expect([...b.keys()].filter((k) => !a.has(k)).sort()).toStrictEqual([]);
    expect([...a.keys()].filter((k) => !b.has(k)).sort()).toStrictEqual([]);
    expect([...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).sort()).toStrictEqual([]);
    // And the key ORDER is identical too, which is what makes the byte comparison above possible.
    expect(Object.keys(candidate)).toStrictEqual(Object.keys(baseline));
  });

  it('carries the SFD1 posture on the wire: json_schema, strict FALSE, low, 8192, 20B, chat', async () => {
    const run = await runGate();
    expect(run.sends).toHaveLength(1);
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    expect(send.maxCompletionTokens).toBe(8192);
    expect(STRICT_FALSE_LOCALIZATION_OUTPUT_BUDGET).toBe(8192);
    expect(send.reasoningEffort).toBe('low');
    expect(send.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
    expect(send.url).not.toBe(GROQ_RESPONSES_ENDPOINT);
    expect(send.model).toBe(CANDIDATE_MODEL_ID);
    expect(send.model).not.toBe(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID);
    expect(send.body['stream']).toBe(false);
    expect(send.body['n']).toBe(1);
    // json_schema mode with the schema RETAINED — never production's json_object non-strict branch.
    const format = send.body['response_format'] as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: unknown };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(false);
    expect(typeof format.json_schema.name).toBe('string');
    expect(JSON.stringify(format.json_schema.schema)).toBe(JSON.stringify(projectedSchema));
    expect(JSON.stringify(send.messages)).toBe(JSON.stringify(captured.messages));
    expect(send.messages.map((one) => one.role)).toStrictEqual(['system', 'user']);
    // No retry and no fallback: exactly one request reaches the wire, ever.
    expect(run.sends).toHaveLength(1);
  });

  it('keeps the STEP ID out of the provider request entirely', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    expect(send.rawBody).not.toContain(STRICT_FALSE_LOCALIZATION_STEP_ID);
    expect(send.rawBody).not.toContain(STRICT_FALSE_DIFFERENTIAL_STEP_ID);
    expect(send.rawBody).not.toContain('L0_');
    expect(send.rawBody).not.toContain('S0_');
    expect(send.rawBody).not.toContain(RUN_GOAL);
    expect(send.rawBody).not.toContain('strict-false-localization');
    // But the receipt DOES carry it — that is the only thing distinguishing the two runs.
    expect(lineWith(run.lines, 'status=PROBE')['stepId']).toBe(STRICT_FALSE_LOCALIZATION_STEP_ID);
  });
});

describe('run-goal and step identity', () => {
  it('adds the goal exactly once, with both credential notices, and keeps the default', () => {
    expect(OPERATOR_RUN_GOALS.filter((one) => one === RUN_GOAL)).toHaveLength(1);
    expect(new Set(OPERATOR_RUN_GOALS).size).toBe(OPERATOR_RUN_GOALS.length);
    expect(DEFAULT_RUN_GOAL).toBe('FULL_EVIDENCE');
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    for (const table of [SECOND_CREDENTIAL_NOTICES, REUSED_CREDENTIAL_NOTICES]) {
      expect(table[RUN_GOAL]).toContain('Smoke passed.');
      expect(table[RUN_GOAL]).toContain('localization');
      expect(table[RUN_GOAL]).not.toMatch(/sk-|key=|Bearer|Authorization/u);
    }
  });

  it('gives the probe its OWN step id, distinct from every consumed run', () => {
    expect(STRICT_FALSE_LOCALIZATION_STEP_ID).toBe(
      'L0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192_STRICT_FALSE_LOCALIZATION',
    );
    for (const historical of [
      STRICT_FALSE_DIFFERENTIAL_STEP_ID,
      REASONING_BUDGET_8192_STEP_ID,
      REASONING_DIFFERENTIAL_STEP_ID,
    ]) {
      expect(STRICT_FALSE_LOCALIZATION_STEP_ID, historical).not.toBe(historical);
    }
    // The identifier is what separates two receipts whose BODIES are identical, so a prefix
    // relationship would not be enough: it must not merely extend SFD1's id.
    expect(STRICT_FALSE_LOCALIZATION_STEP_ID.startsWith('S0_')).toBe(false);
  });

  it('is one-shot ELIGIBLE and now TOMBSTONED — SFD2 consumed it', () => {
    // This spec asserted the opposite until SFD2 ran. The composition below is unchanged and still
    // proves what the request was; what changed is that the goal can no longer be launched.
    expect(isOneShotDiagnosticRunGoal(RUN_GOAL)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(STATICALLY_CONSUMED_RUN_GOALS, RUN_GOAL)).toBe(
      true,
    );
    expect(STATICALLY_CONSUMED_RUN_GOALS[RUN_GOAL]).toBe('SFD2');
    expect(Object.keys(STATICALLY_CONSUMED_RUN_GOALS)).toHaveLength(12);
    expect(isOneShotDiagnosticRunGoal('FULL_EVIDENCE')).toBe(false);
    expect(isOneShotDiagnosticRunGoal('SAFETY_REPLICATION')).toBe(false);
  });

  it('takes exit 37, and 0-36 keep meaning exactly what they meant', () => {
    expect(OPERATOR_EXIT_CODES.POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE_COMPLETE).toBe(
      37,
    );
    expect(OPERATOR_EXIT_CODES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE).toBe(31);
    expect(
      OPERATOR_EXIT_CODES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE,
    ).toBe(32);
    expect(
      OPERATOR_EXIT_CODES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE,
    ).toBe(33);
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_STATICALLY_CONSUMED).toBe(34);
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_ALREADY_CONSUMED).toBe(35);
    expect(OPERATOR_EXIT_CODES.RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE).toBe(36);
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Math.max(...codes)).toBe(37);
  });
});

describe('the two-stage local validation provenance, through the REAL operator', () => {
  it('ACCEPTED — both stages ran and both passed', async () => {
    const run = await runGate();
    expect(run.outcome).toBe('POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE_COMPLETE');
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['providerCompleted']).toBe('true');
    expect(probe['wireValidationCompleted']).toBe('true');
    expect(probe['wireValidationPassed']).toBe('true');
    expect(probe['productionValidationCompleted']).toBe('true');
    expect(probe['productionValidationPassed']).toBe('true');
    expect(lineWith(run.lines, 'status=CLASSIFICATION')['localizedClassification']).toBe(
      'STRUCTURED_REPLY_ACCEPTED',
    );
  });

  it('POST_WIRE_PRODUCTION_INVARIANT_FAILED — the shape held, Riya refused it', async () => {
    // THE finding this run exists to make expressible. Previously indistinguishable from the case
    // below, and it points at a completely different investigation.
    const run = await runGate({ document: wireValidProductionInvalidDocument });
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['wireValidationCompleted']).toBe('true');
    expect(probe['wireValidationPassed']).toBe('true');
    expect(probe['productionValidationCompleted']).toBe('true');
    expect(probe['productionValidationPassed']).toBe('false');
    expect(lineWith(run.lines, 'status=CLASSIFICATION')['localizedClassification']).toBe(
      'STRUCTURED_REPLY_POST_WIRE_PRODUCTION_INVARIANT_FAILED',
    );
  });

  it('WIRE_SCHEMA_INVALID — the provider did not honour the shape it was asked for', async () => {
    const run = await runGate({ document: wireInvalidDocument });
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['wireValidationCompleted']).toBe('true');
    expect(probe['wireValidationPassed']).toBe('false');
    // Stage 2 still RUNS, so `productionValidationPassed` keeps the meaning it always had.
    expect(probe['productionValidationCompleted']).toBe('true');
    expect(probe['productionValidationPassed']).toBe('false');
    expect(lineWith(run.lines, 'status=CLASSIFICATION')['localizedClassification']).toBe(
      'STRUCTURED_REPLY_WIRE_SCHEMA_INVALID',
    );
  });

  it('SFD1 CANONICAL 413 — a request rejection localizes NOTHING, and is not retried', async () => {
    const run = await runGate({ status: 413 });
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['providerCompleted']).toBe('false');
    expect(probe['providerHttpStatus']).toBe('413');
    expect(probe['providerHttpClass']).toBe('PAYLOAD_TOO_LARGE_413');
    // BOTH stages incomplete. Reporting a stage verdict here would be a claim about a check that
    // never ran, which is exactly what this vocabulary exists to prevent.
    expect(probe['wireValidationCompleted']).toBe('false');
    expect(probe['wireValidationPassed']).toBe('false');
    expect(probe['productionValidationCompleted']).toBe('false');
    expect(probe['productionValidationPassed']).toBe('false');
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['localizedClassification']).toBe(
      'STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED',
    );
    expect(classification['baselineHttpStatus']).toBe('413');
    expect(classification['baselineClassification']).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
    );
    expect(classification['duplicateObservationIsCanonical']).toBe('false');
    // NO retry, no escalation, no second request of any kind.
    expect(run.sends).toHaveLength(1);
    expect(run.outcome).toBe('POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE_COMPLETE');
  });

  it('PROVIDER_OUTPUT_INVALID — json_validate_failed is an OUTPUT failure, not a rejection', async () => {
    const run = await runGate({ status: 400 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['localizedClassification']).toBe(
      'STRUCTURED_REPLY_PROVIDER_OUTPUT_INVALID',
    );
    expect(classification['wireValidationCompleted']).toBe('false');
    expect(classification['productionValidationCompleted']).toBe('false');
    expect(run.sends).toHaveLength(1);
  });

  it('RATE_LIMITED — a 429 is the provider declining to process, not a verdict', async () => {
    const run = await runGate({ status: 429 });
    expect(lineWith(run.lines, 'status=CLASSIFICATION')['localizedClassification']).toBe(
      'STRUCTURED_REPLY_RATE_LIMITED',
    );
    expect(run.sends).toHaveLength(1);
  });

  it('SFD1 own composition could NOT have answered this — its wire stage never runs', async () => {
    // The reason this lane exists, proved rather than asserted in prose. SFD1's port supplies only
    // the projector, so on the SAME 200 and the SAME document its outcome carries no wire stage --
    // and the localized classifier correctly refuses to name one, reporting INCONCLUSIVE.
    const wire = recordingTransport();
    const sfd1 = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => wire.transport,
      captured,
      projectedSchema,
    });
    const sfd1Result = await sfd1.run(sfd1.probe);
    // SFD1's outcome TYPE has no wire fields, because its port never supplied the wire schema. The
    // shared runner still populates them as `false`/`false`, which is exactly the shape the
    // classifier must refuse to read a verdict from -- so it is widened here to look at them.
    const sfd1Outcome = sfd1Result.outcome as unknown as LocalizedStructuredReplyOutcome;
    expect(sfd1Outcome.providerCompleted).toBe(true);
    expect(sfd1Result.outcome.localValidationPassed).toBe(true);
    expect(sfd1Outcome.wireValidationCompleted).toBe(false);
    expect(analyseLocalizedStructuredReply(sfd1Outcome).classification).toBe(
      'STRUCTURED_REPLY_INCONCLUSIVE',
    );

    // SFD2, same wire, same document: both stages observed, and a real verdict.
    const sfd2Wire = recordingTransport();
    const sfd2 = createLiveStrictFalseLocalizationComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => sfd2Wire.transport,
      captured,
      projectedSchema,
    });
    const sfd2Result = await sfd2.run(sfd2.probe);
    expect(sfd2Result.outcome.wireValidationCompleted).toBe(true);
    expect(sfd2Result.outcome.wireValidationPassed).toBe(true);
    expect(analyseLocalizedStructuredReply(sfd2Result.outcome).classification).toBe(
      'STRUCTURED_REPLY_ACCEPTED',
    );
  });

  it('reuses the merged run-neutral vocabulary rather than adding a parallel one', () => {
    // Eight tokens, unchanged, and NOT a copy of SFD1's — whose vocabulary is immutable evidence.
    expect(LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS).toHaveLength(8);
    for (const token of LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS) {
      expect(token.startsWith('STRUCTURED_REPLY_'), token).toBe(true);
      expect(STRICT_FALSE_CLASSIFICATIONS, token).not.toContain(token);
    }
  });
});

describe('the bounded ledger', () => {
  it('caps the run at TWO provider requests and one dollar', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['totalProviderRequests']).toBe('2');
    expect(receipt['smokeRequests']).toBe('1');
    expect(receipt['localizationProbeRequests']).toBe('1');
    // Every OTHER lane's counter stays zero: no earlier probe is replayed.
    expect(receipt['strictFalseProbeRequests']).toBe('0');
    expect(receipt['reasoningBudget8192ProbeRequests']).toBe('0');
    expect(receipt['reasoningDifferentialProbeRequests']).toBe('0');
    expect(receipt['safetyProviderRequests']).toBe('0');
    expect(receipt['p10ProviderRequests']).toBe('0');
    expect(receipt['safetyEvaluated']).toBe('false');
    expect(receipt['reviewBundleWritten']).toBe('false');
    expect(run.bundleDirEntries).toStrictEqual([]);
    expect(run.openCandidateCalls).toBe(0);
    expect(Number(receipt['estimatedCostUsd'])).toBeLessThanOrEqual(1);
  });

  it('refuses a third request by construction — the ledger allows exactly two', () => {
    const ledger = ledgerForRunGoal(RUN_GOAL);
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle({ inputTokens: 10, outputTokens: 10 }, true);
    expect(ledger.reserve('strict-false-localization-probe').ok).toBe(true);
    ledger.settle({ inputTokens: 10, outputTokens: 10 }, true);
    const third = ledger.reserve('strict-false-localization-probe');
    expect(third.ok).toBe(false);
    expect(third.ok ? 'ok' : third.refusal).toBe('request-limit-reached');
  });

  it('settles PROVIDER-REPORTED usage, so the receipt reads PROVIDER_ONLY', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['inputTokensTotal']).toBe(String(194 + 1200));
    expect(receipt['outputTokensTotal']).toBe(String(57 + 1400));
    expect(receipt['inputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['outputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['costIsEstimated']).toBe('false');
    expect(receipt['usageBoundViolated']).toBe('false');
  });

  it('bounds a probe that reports nothing, and says MIXED rather than pretending', async () => {
    const run = await runGate({ reportUsage: false });
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['inputUsageProvenance']).toBe('MIXED');
    expect(receipt['outputUsageProvenance']).toBe('MIXED');
    expect(receipt['costIsEstimated']).toBe('true');
    // The CEILING is the bound, not the 8,192 the request asked for.
    expect(receipt['outputTokensTotal']).toBe(String(57 + CANDIDATE_MAX_COMPLETION_TOKENS));
  });

  it('states the wire posture and that NOTHING on it moved', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['structuredOutputMode']).toBe('json_schema');
    expect(receipt['strict']).toBe('false');
    expect(receipt['productionNonStrictFallbackMode']).toBe('json_object');
    expect(receipt['reasoningEffort']).toBe('low');
    expect(receipt['maxCompletionTokens']).toBe('8192');
    expect(receipt['endpointFamily']).toBe('CHAT_COMPLETIONS');
    expect(receipt['candidateModel']).toBe('openai/gpt-oss-20b');
    expect(receipt['wireFieldsChangedVsSfd1']).toBe('0');
    expect(receipt['localValidationStages']).toBe('WIRE_SCHEMA+PRODUCTION_PROJECTOR');
    expect(receipt['wireStageAuthority']).toBe('CAPTURED_GATEWAY_STRUCTURED_WIRE_SCHEMA');
    expect(receipt['productionStageAuthority']).toBe(
      'CAPTURED_PRODUCTION_PROJECT_STRUCTURED_RESULT',
    );
  });
});

describe('the operator seam', () => {
  it('binds the runner to the CANDIDATE credential, after the smoke', async () => {
    const run = await runGate();
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toStrictEqual([run.candidateCredential]);
  });

  it('stops CLOSED when the port is missing, spending no candidate request', async () => {
    const run = await runGate({ omitRunner: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.sends).toHaveLength(0);
    expect(lineWith(run.lines, 'phase=strict-false-localization')['reason']).toBe('port-missing');
  });

  it('stops CLOSED when the bind throws, and prints nothing the error carried', async () => {
    const run = await runGate({ bindThrows: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.sends).toHaveLength(0);
    expect(lineWith(run.lines, 'phase=strict-false-localization')['reason']).toBe(
      'runner-bind-failed',
    );
    expect(run.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL-MUST-NOT-APPEAR');
  });

  it('stops at a FAILED smoke without reaching the candidate', async () => {
    const run = await runGate({ smokeFails: true });
    expect(run.outcome).toBe('SMOKE_FAILED');
    expect(run.runnerOpenCalls).toBe(0);
    expect(run.sends).toHaveLength(0);
  });

  it('fails CLOSED on an unbound credential, before any probe exists', () => {
    expect(() =>
      createLiveStrictFalseLocalizationComposition({
        credential: { notAKey: true },
        captured,
        projectedSchema,
      }),
    ).toThrow('QFJ_STRICT_FALSE_LOCALIZATION_CREDENTIAL_NOT_BOUND');
  });
});

describe('the transcript is content-free', () => {
  it('never prints the document, the schema, the prompt, the credential or a provider body', async () => {
    for (const options of [
      {},
      { document: wireValidProductionInvalidDocument },
      { document: wireInvalidDocument },
      { status: 400 },
      { status: 413 },
      { status: 429 },
    ] as readonly RunOptions[]) {
      const run = await runGate(options);
      const transcript = run.lines.join('\n');
      for (const forbidden of [
        SENTINEL_KEY,
        'Bearer',
        'authorization',
        'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
        'FAILED-GENERATION-MUST-NEVER-BE-EMITTED',
        'failed_generation',
        'WIRE-INVALID-FIXTURE',
        'questionPlan',
        'replyBody',
        'additionalProperties',
        'invalid_type',
        'unrecognized_keys',
        'ZodError',
      ]) {
        expect(transcript, `${forbidden} in ${JSON.stringify(options)}`).not.toContain(forbidden);
      }
      // Nor the model's own words, nor any captured message body.
      for (const message of captured.messages) {
        expect(transcript).not.toContain(message.content);
      }
      expect(transcript).not.toContain(JSON.stringify(projectedSchema));
    }
  });
});

describe('historical evidence is untouched', () => {
  it('leaves SFD1 own vocabulary, step id and composition exactly as merged', async () => {
    expect(STRICT_FALSE_CLASSIFICATIONS).toHaveLength(7);
    expect(STRICT_FALSE_CLASSIFICATIONS).toContain(
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
    );
    expect(STRICT_FALSE_DIFFERENTIAL_STEP_ID).toBe(
      'S0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192_STRICT_FALSE',
    );
    expect(REASONING_BUDGET_8192_STEP_ID).toBe(
      'B0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192',
    );
    expect(REASONING_DIFFERENTIAL_STEP_ID).toBe(
      'R0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW',
    );

    // And SFD1's own composition still emits its own request under its own step id: this lane adds
    // a caller to the shared primitive and must not have moved the one already there.
    const wire = recordingTransport();
    const sfd1 = createLiveStrictFalseDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => wire.transport,
      captured,
      projectedSchema,
    });
    expect(sfd1.probe.stepId).toBe(STRICT_FALSE_DIFFERENTIAL_STEP_ID);
    await sfd1.run(sfd1.probe);
    const body = wire.bodies()[0];
    if (body === undefined) {
      throw new Error('SFD1 composition must have sent one body');
    }
    const format = body['response_format'] as { type: string; json_schema: { strict: boolean } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(false);
    expect(body['max_completion_tokens']).toBe(8192);
    expect(body['reasoning_effort']).toBe('low');
    expect(sfd1.reasoningEffortsUsed()).toStrictEqual(['low']);
    expect(sfd1.capabilityCeilingsUsed()).toStrictEqual([CANDIDATE_MAX_COMPLETION_TOKENS]);
  });
});

describe('production is not moved by this bridge', () => {
  it('leaves RIYA_COMPLETION_BUDGET_TOKENS at 4096', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(STRICT_FALSE_LOCALIZATION_OUTPUT_BUDGET).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
  });

  it('leaves the PRODUCTION Groq body at 4096, strict TRUE, with no reasoning field', async () => {
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

describe('the CLI selects a PURPOSE, never a parameter', () => {
  it('accepts the new goal and still defaults to FULL_EVIDENCE', () => {
    const parsed = parseCliArgs([
      '--smoke-config',
      'c.json',
      '--review-output',
      'o.json',
      '--run-goal',
      RUN_GOAL,
    ]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.runGoal : undefined).toBe(RUN_GOAL);
    const bare = parseCliArgs(['--smoke-config', 'c.json', '--review-output', 'o.json']);
    expect(bare.ok ? bare.args.runGoal : 'set').toBeUndefined();
  });

  it('refuses a near-miss goal token', () => {
    for (const bad of [
      'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION',
      'POST_SFD2_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE',
      'LOCALIZATION',
    ]) {
      const parsed = parseCliArgs(['--run-goal', bad]);
      expect(parsed.ok ? 'ok' : parsed.reason, bad).toBe('invalid-run-goal');
    }
  });

  it('exposes NO raw validation or budget flag', () => {
    for (const flag of [
      '--localize',
      '--wire-schema',
      '--validate',
      '--strict',
      '--max-completion-tokens',
      '--reasoning-effort',
      '--retry',
      '--force',
    ]) {
      expect(parseCliArgs([flag, 'x']).ok, flag).toBe(false);
    }
  });
});
