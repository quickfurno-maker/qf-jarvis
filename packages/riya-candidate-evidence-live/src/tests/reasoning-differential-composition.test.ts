/**
 * POST-RSP20B2 — the `reasoning_effort='low'` differential, driven end to end over a fake network.
 *
 * ### What must reach the wire, and what must not
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` over Chat Completions at the
 * 4,096 budget with NO reasoning field, and received HTTP 400 with `JSON_VALIDATE_FAILED`. MD120B3
 * reproduced it on 120B and RSP20B2 over the Responses API, so neither the model nor the endpoint is
 * the open axis.
 *
 * This run re-sends the SAME captured request on the SAME production model over the SAME production
 * endpoint at the SAME budget, and adds exactly ONE body key. So the central spec here is a DIFF: the
 * production Groq body and this diagnostic body are built from one synthetic input and compared
 * key-for-key, and the only permitted difference is `reasoning_effort: 'low'`.
 *
 * That is stronger than asserting fields one at a time. A field-by-field list proves the fields
 * somebody remembered to list; the diff proves there is no twelfth field nobody thought of.
 *
 * ### Usage propagation is the second thing this lane exists for
 *
 * Every earlier one-probe seam narrows the provider result to `{ providerCompleted, structuredValue }`
 * and the operator settles `undefined` — which is why RSP20B2's receipt printed
 * `outputTokensTotal=65622`, a fallback BOUND rather than a measurement. This seam returns `usage`,
 * and the specs assert both halves: reported usage reaches the ledger and the receipt reads
 * `PROVIDER_ONLY`; absent usage still bounds and the receipt reads `MIXED`, never `PROVIDER_ONLY`.
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
import { REASONING_DIFFERENTIAL_STEP_ID } from '../internal/operational-acceptance-plan.js';
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
  createLiveReasoningDifferentialComposition,
  REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
} from '../reasoning-differential-port.js';
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
  const directory = mkdtempSync(join(tmpdir(), 'riya-rld-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-RLD-SENTINEL-NEVER-A-REAL-KEY-00000';

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

/** A Chat Completions success carrying REPORTED usage — the thing this lane propagates. */
function okBody(documentJson: string): string {
  return JSON.stringify({
    id: 'chatcmpl-rld',
    object: 'chat.completion',
    created: 1,
    model: CANDIDATE_MODEL_ID,
    choices: [
      { index: 0, message: { role: 'assistant', content: documentJson }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 640, total_tokens: 1840 },
  });
}

/** A 2xx that reports NO usage. The ledger must bound it and say so. */
function okBodyWithoutUsage(documentJson: string): string {
  return JSON.stringify({
    id: 'chatcmpl-rld-nousage',
    object: 'chat.completion',
    created: 1,
    model: CANDIDATE_MODEL_ID,
    choices: [
      { index: 0, message: { role: 'assistant', content: documentJson }, finish_reason: 'stop' },
    ],
  });
}

/** The strict-output failure NRA1 met, with a marker no emitter may ever print. */
const jsonValidateFailedBody = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
    failed_generation: 'FAILED-GENERATION-MUST-NEVER-BE-EMITTED',
  },
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
        status !== 200
          ? status === 429
            ? rateLimitBody
            : jsonValidateFailedBody
          : options.reportUsage === false
            ? okBodyWithoutUsage(document)
            : okBody(document);
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

/** The governed smoke, which reports REAL usage. Its 194/86 are the observed half of a MIXED run. */
const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 194, outputTokens: 86 },
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
  // A document the FULL production projector accepts, proved here rather than assumed — the
  // ACCEPTED classification is only meaningful if a genuinely acceptable document exists.
  //
  // The question plan is COMPUTED against the same continuity state the port uses, never
  // hand-written: the projector refuses an answer whose claimed plan disagrees with what the reducer
  // independently decides, and a hand-written plan would fail for that reason rather than for any
  // reason this spec is about.
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

/** Drive the REAL operator through the REAL live composition over a fake wire. */
async function runGate(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const smokeDir = externalDir();
  const { path: smokeConfigPath, digest } = writeSmokeConfig(smokeDir);
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
    // The REAL ledger the executable would choose for this goal.
    ledger: ledgerForRunGoal('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL'),
    runGoal: 'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
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
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-REASONING-DIFFERENTIAL');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openReasoningDifferentialRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            const composition = createLiveReasoningDifferentialComposition({
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

/**
 * Read one content-free operator line.
 *
 * `SafeConsole` emits `key=value` pairs, not JSON — which is itself part of the containment design,
 * since there is no nesting a document could hide in. So the values come back as STRINGS and the
 * assertions compare strings: coercing them here would quietly turn `'0'` and `'false'` into things
 * a spec could confuse.
 */
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

describe('THE HELD-CONSTANT PROOF: the diagnostic wire body is the production body plus one key', () => {
  it('differs from the PRODUCTION Groq request in exactly reasoning_effort', async () => {
    // The central assertion of this lane, and deliberately a DIFF of two RECORDED WIRE BODIES rather
    // than a field list. A field-by-field check proves the fields somebody remembered to list; the
    // diff proves there is no twelfth field nobody thought of.
    //
    // It is also taken from the wire rather than from a body builder: the builder is internal to the
    // gateway on purpose, and what governs the differential is what the provider actually receives.
    const captureBodies = (): {
      readonly transport: GroqTransport;
      readonly bodies: () => readonly Record<string, unknown>[];
    } => {
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
    };

    const configFor = (transport: GroqTransport) =>
      createGroqProviderConfig({
        providerId: CANDIDATE_PROVIDER_ID,
        modelId: CANDIDATE_MODEL_ID,
        modelVersion: CANDIDATE_CATALOG_SNAPSHOT,
        executionClass: 'HOSTED',
        maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
        maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
        supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
        apiKey: createGroqApiKey(SENTINEL_KEY),
        transport,
        dataControlsAttested: true,
      });

    // The PRODUCTION provider, over the same synthetic input.
    const productionWire = captureBodies();
    await new GroqModelProvider(configFor(productionWire.transport), createSystemClock()).invoke({
      runId: 'held-constant-proof',
      messages: captured.messages,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: projectedSchema,
      timeoutMs: 30_000,
      maxCompletionTokens: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
      signal: new AbortController().signal,
    });

    // The DIAGNOSTIC path, through the real composition.
    const diagnosticWire = captureBodies();
    const composition = createLiveReasoningDifferentialComposition({
      credential: createGroqApiKey(SENTINEL_KEY),
      openTransport: () => diagnosticWire.transport,
      captured,
      projectedSchema,
    });
    await composition.run(composition.probe);

    const production = productionWire.bodies()[0];
    const diagnostic = diagnosticWire.bodies()[0];
    if (production === undefined || diagnostic === undefined) {
      throw new Error('both paths must have sent exactly one body');
    }

    // ADDS exactly one key, and REMOVES none.
    const added = Object.keys(diagnostic).filter((key) => !(key in production));
    const removed = Object.keys(production).filter((key) => !(key in diagnostic));
    expect(added).toStrictEqual(['reasoning_effort']);
    expect(removed).toStrictEqual([]);
    expect(diagnostic['reasoning_effort']).toBe('low');

    // And every shared key is byte-identical. Model, messages, schema, strict mode, budget and
    // anything else either body carries are all covered by this one loop.
    for (const key of Object.keys(production)) {
      expect(JSON.stringify(diagnostic[key]), key).toBe(JSON.stringify(production[key]));
    }

    // The PRODUCTION body carries no reasoning field of any spelling, and must keep carrying none.
    for (const forbidden of [
      'reasoning',
      'reasoning_effort',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(Object.keys(production), forbidden).not.toContain(forbidden);
    }
    // Nor does either body carry sampling, tools, a seed, streaming or fan-out.
    for (const body of [production, diagnostic]) {
      for (const forbidden of ['temperature', 'top_p', 'seed', 'tools', 'tool_choice']) {
        expect(Object.keys(body), forbidden).not.toContain(forbidden);
      }
      // `stream` and `n` are PRESENT with pinned values rather than absent, in BOTH bodies.
      // Asserting the value is the real control: an absent key would let a future provider default
      // turn streaming on or fan the request out.
      expect(body['stream']).toBe(false);
      expect(body['n']).toBe(1);
    }
  });
});

describe('the wire: one send, and every governed field held', () => {
  it('sends exactly ONE request, to Chat Completions, with reasoning_effort=low', async () => {
    const run = await runGate();
    expect(run.sends).toHaveLength(1);
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    // THE variable.
    expect(send.reasoningEffort).toBe('low');
    // The endpoint did NOT move. The Responses endpoint is never reached.
    expect(send.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
    expect(send.url).not.toBe(GROQ_RESPONSES_ENDPOINT);
    // The model did NOT move.
    expect(send.model).toBe(CANDIDATE_MODEL_ID);
    expect(send.model).toBe('openai/gpt-oss-20b');
    expect(send.model).not.toBe(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID);
    // The budget did NOT move, which matters most: reasoning tokens come out of it.
    expect(send.maxCompletionTokens).toBe(4096);
    expect(send.maxCompletionTokens).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    // Strict mode did NOT move.
    expect(send.responseFormatStrict).toBe(true);
  });

  it('carries the captured neutral messages byte-for-byte, in order', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    // The SAME capture NRA1 used. Not a second neutral prompt, not a reconstruction.
    expect(JSON.stringify(send.messages)).toBe(JSON.stringify(captured.messages));
    expect(send.messages.map((one) => one.role)).toStrictEqual(['system', 'user']);
    expect(send.messages).toHaveLength(2);
  });

  it('carries the projected production schema byte-for-byte', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
    }
    expect(JSON.stringify(send.responseFormatSchema)).toBe(JSON.stringify(projectedSchema));
  });

  it('adds no sampling, tool, seed, streaming or reasoning-capture key on the wire', async () => {
    const run = await runGate();
    const send = run.sends[0];
    if (send === undefined) {
      throw new Error('one send expected');
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
      expect(Object.keys(send.body), forbidden).not.toContain(forbidden);
    }
    // Present with a pinned VALUE, never absent. An absent key would let a future provider default
    // turn streaming on or fan the request out; the value is the control, not the omission.
    expect(send.body['stream']).toBe(false);
    expect(send.body['n']).toBe(1);
  });
});

describe('usage propagation — what this lane fixes', () => {
  it('settles PROVIDER-REPORTED usage, so the receipt reads PROVIDER_ONLY', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    // The smoke reported 194/86 and the probe reported 1200/640. Nothing was bounded.
    expect(receipt['inputTokensTotal']).toBe(String(194 + 1200));
    expect(receipt['outputTokensTotal']).toBe(String(86 + 640));
    expect(receipt['inputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['outputUsageProvenance']).toBe('PROVIDER_ONLY');
    expect(receipt['costIsEstimated']).toBe('false');
    // And emphatically NOT the 65,536 bound RSP20B2's receipt carried.
    expect(receipt['outputTokensTotal']).not.toBe(String(86 + CANDIDATE_MAX_COMPLETION_TOKENS));
  });

  it('still bounds when the provider reports nothing, and says MIXED rather than PROVIDER_ONLY', async () => {
    const run = await runGate({ reportUsage: false });
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['inputUsageProvenance']).toBe('MIXED');
    expect(receipt['outputUsageProvenance']).toBe('MIXED');
    expect(receipt['costIsEstimated']).toBe('true');
    // The bound, visibly labelled. A fallback total can never report PROVIDER_ONLY.
    expect(receipt['outputTokensTotal']).toBe(String(86 + CANDIDATE_MAX_COMPLETION_TOKENS));
  });
});

describe('the operator sequence, and what it never touches', () => {
  it('runs preflight, smoke, candidate credential, ONE probe, then stops at exit 31', async () => {
    const run = await runGate();
    expect(run.outcome).toBe('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE');
    expect(
      OPERATOR_EXIT_CODES[run.outcome as 'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE'],
    ).toBe(31);
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toStrictEqual([run.candidateCredential]);
    expect(run.sends).toHaveLength(1);
    // No candidate evaluation session is constructed: no fixture, no evaluator, no authority.
    expect(run.openCandidateCalls).toBe(0);
  });

  it('spends ZERO probes when the smoke fails', async () => {
    const run = await runGate({ smokeFails: true });
    expect(run.outcome).toBe('SMOKE_FAILED');
    // The credential path is never opened and the wire is never touched.
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
    // Not merely reported as unwritten — no file exists.
    expect(run.bundleDirEntries).toStrictEqual([]);
  });

  it('counts its OWN probe and leaves every earlier counter at zero', async () => {
    const run = await runGate();
    const receipt = lineWith(run.lines, 'status=RECEIPT');
    expect(receipt['totalProviderRequests']).toBe('2');
    expect(receipt['smokeRequests']).toBe('1');
    expect(receipt['reasoningDifferentialProbeRequests']).toBe('1');
    expect(receipt['responsesDifferentialProbeRequests']).toBe('0');
    expect(receipt['modelDifferentialProbeRequests']).toBe('0');
    expect(receipt['neutralRepresentativeProbeRequests']).toBe('0');
    expect(receipt['representativeAcceptanceProbeRequests']).toBe('0');
  });

  it('fails closed, and content-free, when the seam is missing or the bind throws', async () => {
    const missing = await runGate({ omitRunner: true });
    expect(missing.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(missing.sends).toHaveLength(0);

    const threw = await runGate({ bindThrows: true });
    expect(threw.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(threw.sends).toHaveLength(0);
    // Nothing the thrown object carried reaches the console.
    expect(threw.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL-MUST-NOT-APPEAR');
  });
});

describe('classification end to end, and the receipt says nothing it should not', () => {
  it('classifies a production-valid 2xx as ACCEPTED', async () => {
    const run = await runGate();
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningDifferentialClassification']).toBe(
      'REASONING_LOW_20B_STRICT_ACCEPTED',
    );
    expect(classification['localValidationCompleted']).toBe('true');
    expect(classification['localValidationPassed']).toBe('true');
    expect(classification['probesRun']).toBe('1');
  });

  it('classifies a wire-shaped document production REFUSES as LOCAL_VALIDATION_FAILED', async () => {
    // The false-positive this gate exists to be incapable of. `{"ok":"OK"}` is not a Riya reply.
    const run = await runGate({ document: '{"ok":"OK"}' });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningDifferentialClassification']).toBe(
      'REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED',
    );
    expect(classification['localValidationCompleted']).toBe('true');
    expect(classification['localValidationPassed']).toBe('false');
  });

  it('classifies a 400 json_validate_failed as PROVIDER_OUTPUT_INVALID, not a rejection', async () => {
    const run = await runGate({ status: 400 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningDifferentialClassification']).toBe(
      'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
    );
    expect(classification['providerErrorCode']).toBe('JSON_VALIDATE_FAILED');
    // The check never ran, and the receipt must not pretend otherwise.
    expect(classification['localValidationCompleted']).toBe('false');
  });

  it('classifies a 429 as rate-limited', async () => {
    const run = await runGate({ status: 429 });
    const classification = lineWith(run.lines, 'status=CLASSIFICATION');
    expect(classification['reasoningDifferentialClassification']).toBe(
      'REASONING_LOW_20B_STRICT_RATE_LIMITED',
    );
  });

  it('records the baseline posture as ABSENT and the documented default beside it', async () => {
    const run = await runGate();
    const probe = lineWith(run.lines, 'status=PROBE');
    expect(probe['stepId']).toBe(REASONING_DIFFERENTIAL_STEP_ID);
    expect(probe['baselineReasoningFieldPosture']).toBe('ABSENT');
    expect(probe['baselineDocumentedDefaultEffort']).toBe('medium');
    expect(probe['candidateReasoningEffort']).toBe('low');
    expect(probe['maxCompletionTokens']).toBe('4096');
    expect(probe['candidateModel']).toBe('openai/gpt-oss-20b');
    expect(probe['endpointFamily']).toBe('CHAT_COMPLETIONS');
  });

  it('never emits a credential, prompt byte, schema body, provider body or reasoning trace', async () => {
    for (const options of [{}, { status: 400 }, { status: 429 }] as const) {
      const run = await runGate(options);
      const all = run.lines.join('\n');
      expect(all).not.toContain(SENTINEL_KEY);
      expect(all).not.toContain('Bearer');
      expect(all).not.toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
      expect(all).not.toContain('FAILED-GENERATION-MUST-NEVER-BE-EMITTED');
      expect(all).not.toContain('failed_generation');
      expect(all).not.toContain('chatcmpl-rld');
      // No prompt or schema bytes. The captured system message is long; even a prefix must not leak.
      const system = captured.messages[0]?.content ?? '';
      expect(all).not.toContain(system.slice(0, 40));
      expect(all).not.toContain('additionalProperties');
    }
  });
});

describe('the CLI accepts the goal and nothing more', () => {
  it('parses the exact new run goal', () => {
    const parsed = parseCliArgs([
      '--smoke-config',
      'c.json',
      '--review-output',
      'o.json',
      '--run-goal',
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
    ]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.runGoal : undefined).toBe(
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
    );
  });

  it('still defaults to FULL_EVIDENCE, and older goals still parse', () => {
    const bare = parseCliArgs(['--smoke-config', 'c.json', '--review-output', 'o.json']);
    expect(bare.ok ? bare.args.runGoal : 'set').toBeUndefined();
    for (const goal of [
      'SAFETY_REPLICATION',
      'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL',
      'POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL',
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

  it('refuses a missing value, a duplicate goal and an unknown goal', () => {
    const missing = parseCliArgs(['--run-goal']);
    expect(missing.ok ? 'ok' : missing.reason).toBe('missing-value');

    const duplicate = parseCliArgs([
      '--run-goal',
      'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
      '--run-goal',
      'SAFETY_REPLICATION',
    ]);
    expect(duplicate.ok ? 'ok' : duplicate.reason).toBe('duplicate-run-goal');

    for (const bad of [
      'POST_RSP20B2_REASONING_EFFORT_HIGH_DIFFERENTIAL',
      'FULL_EVIDENCE',
      'reasoning',
    ]) {
      const parsed = parseCliArgs(['--run-goal', bad]);
      expect(parsed.ok ? 'ok' : parsed.reason, bad).toBe('invalid-run-goal');
    }
  });

  it('exposes NO raw-parameter flag: the owner selects a PURPOSE', () => {
    // A `--reasoning-effort` flag would turn a governed diagnostic into an arbitrary provider knob.
    for (const flag of [
      '--reasoning-effort',
      '--model',
      '--max-output',
      '--retry',
      '--force',
      '--skip-smoke',
      '--api-key',
    ]) {
      const parsed = parseCliArgs([flag, 'low']);
      expect(parsed.ok ? 'ok' : parsed.reason, flag).toBe('unknown-argument');
    }
  });
});
