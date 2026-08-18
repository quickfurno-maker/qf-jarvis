/**
 * MVP-P2A.2 HF4-R8-R1 — the LIVE diagnostic composition, driven end to end with a fake network.
 *
 * ### The defect these specs exist for
 *
 * R8 shipped a reviewed canary port and never bound it. `bin.ts` passed no diagnostic seam, so the
 * compiled command was guaranteed to run preflight, spend the smoke request, resolve the candidate
 * credential, reach the diagnostic branch, find no port and return `INTERNAL_CLOSED_FAILURE` with
 * zero canaries run. A live authorization is consumed at process launch, so the next authorized run
 * would have been burned on a missing local wire — and every R8 spec would still have passed, because
 * every one of them injected the port the executable did not.
 *
 * So these specs drive the composition `bin.ts` ITSELF uses. The transport is fake and no credential
 * is real; everything above it — the matrix, the production request capture, the Groq provider, the
 * strict projection, the observer, the ledger, the emitters — is the production path. The bodies the
 * fake transport receives are the bodies the real one would have sent, which is what turns "the wire
 * exists" from a textual claim into a measured one.
 *
 * Nothing here prints a prompt, a client turn, a schema document, a provider body or a credential.
 * The assertions are lengths, counts, closed tokens, field names and object identities.
 */
import { createGroqApiKey, renderStructuredJsonSchema } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

import { createRequestContractDiagnosticLedger } from '../accounting.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import {
  CANARY_ANYOF_NULLABLE_SCHEMA,
  CANARY_LOW_COMPLETION_CAP,
  CANARY_MINIMAL_SCHEMA,
  CANARY_NUMERIC_ENUM_SCHEMA,
  DIAGNOSTIC_CANARIES,
} from '../diagnostic-canaries.js';
import type { DiagnosticCanary } from '../diagnostic-canaries.js';
import { SYNTHETIC_CANARY_MESSAGES } from '../diagnostic-canary-port.js';
import {
  captureProductionRiyaCanaryRequest,
  createDiagnosticCanaryMaterials,
} from '../diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { createLiveDiagnosticCanaryComposition } from '../live-diagnostic-canary-composition.js';
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
  const directory = mkdtempSync(join(tmpdir(), 'riya-r8r1-'));
  scratch.push(directory);
  return directory;
}

/** An obvious non-key. Bounded and charset-clean so the holder accepts it; it reaches no network. */
const SENTINEL_KEY = 'FAKE-R8R1-SENTINEL-NEVER-A-REAL-KEY-0000';

/** What one fake wire send carried. Parsed for SHAPE; no content is asserted on or printed. */
interface RecordedSend {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly maxCompletionTokens: number;
  readonly responseFormatType: string | undefined;
  readonly responseFormatStrict: boolean | undefined;
  readonly responseFormatSchema: unknown;
  readonly bodyFieldNames: readonly string[];
  readonly authorization: string;
  readonly signal: AbortSignal;
  readonly signalAbortedAtSend: boolean;
}

interface FakeTransport {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
}

/** A structurally valid Groq chat completion. Its CONTENT is never read by these specs. */
const OK_BODY = JSON.stringify({
  id: 'chatcmpl-r8r1',
  object: 'chat.completion',
  created: 1,
  model: CANDIDATE_MODEL_ID,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"ok":"OK"}' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
});

/**
 * The fake wire.
 *
 * It records the exact body the production Groq provider built and returns a fixed 200. Nothing about
 * it is reachable from `bin.ts` — production passes no `openTransport`, so the default factory is the
 * real one, and a spec that forgot to inject this would open a socket rather than silently pass.
 */
function fakeTransport(status = 200, bodyText = OK_BODY): FakeTransport {
  const sends: RecordedSend[] = [];
  const transport: GroqTransport = {
    send: (request, signal) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const responseFormat = parsed['response_format'] as
        { type?: string; json_schema?: { strict?: boolean; schema?: unknown } } | undefined;
      sends.push({
        model: String(parsed['model']),
        messages: parsed['messages'] as RecordedSend['messages'],
        maxCompletionTokens: Number(parsed['max_completion_tokens']),
        responseFormatType: responseFormat?.type,
        responseFormatStrict: responseFormat?.json_schema?.strict,
        responseFormatSchema: responseFormat?.json_schema?.schema,
        bodyFieldNames: Object.keys(parsed).sort(),
        authorization: request.headers['authorization'] ?? '',
        signal,
        signalAbortedAtSend: signal.aborted,
      });
      return Promise.resolve({ status, retryAfterSeconds: null, bodyText });
    },
  };
  return { transport, sends: () => sends };
}

/** A valid, secret-free synthetic smoke configuration, digest-consistent with the test seam. */
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

/** A candidate session whose every accessor throws. A diagnostic must never construct one. */
function forbiddenSession(): never {
  throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-DIAGNOSTIC-MODE');
}

interface RunOptions {
  readonly runner?: OperatorDeps['openDiagnosticCanaryRunner'];
  readonly smoke?: SmokeRunResult;
  readonly credentialThrows?: boolean;
  readonly runGoal?: OperatorDeps['runGoal'];
}

interface RunRecord {
  readonly lines: readonly string[];
  readonly outcome: string;
  readonly runnerOpenCalls: number;
  readonly openCandidateCalls: number;
  readonly credentialsHandedToRunner: readonly unknown[];
  readonly candidateCredential: unknown;
}

/**
 * Drive the real operator.
 *
 * Everything injected here is a seam the executable also fills; the only difference is that the
 * runner may be omitted, which is exactly the composition the reviewed head shipped.
 */
async function runOperator(options: RunOptions = {}): Promise<RunRecord> {
  const lines: string[] = [];
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;
  let runnerOpenCalls = 0;
  let openCandidateCalls = 0;
  const credentialsHandedToRunner: unknown[] = [];
  const candidateCredential = createGroqApiKey(SENTINEL_KEY);
  const runner = options.runner;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    ledger: createRequestContractDiagnosticLedger(),
    runGoal: options.runGoal ?? 'REQUEST_CONTRACT_DIAGNOSTIC',
    openSmokeCredential: () =>
      Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve(SENTINEL_KEY),
        },
      }),
    runSmoke: () => Promise.resolve(options.smoke ?? SMOKE_PASS),
    openCandidateCredential: () =>
      options.credentialThrows === true
        ? Promise.reject(new Error('CREDENTIAL-REFUSED'))
        : Promise.resolve(candidateCredential),
    openCandidate: () => {
      openCandidateCalls += 1;
      return Promise.resolve(forbiddenSession());
    },
    ...(runner === undefined
      ? {}
      : {
          openDiagnosticCanaryRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            return runner(credential);
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
  };
}

/** The production capture, taken once. Reaches no provider, no transport and no credential. */
let captured: CapturedProductionRiyaRequest;
beforeAll(async () => {
  captured = await captureProductionRiyaCanaryRequest();
});

describe('R8R1-C1/C2/C9 — the reviewed head could not run a canary, and this composition can', () => {
  it('R8R1-C1 reproduces the exact live failure of a composition with no diagnostic port', async () => {
    // The reviewed head's `bin.ts` passed no runner. This is the result it was GUARANTEED to
    // produce: preflight passed, the smoke request was spent, the candidate credential was
    // resolved — and then zero canaries ran.
    const run = await runOperator();
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(OPERATOR_EXIT_CODES[run.outcome as 'INTERNAL_CLOSED_FAILURE']).toBe(20);
    expect(run.lines.some((line) => line.includes('reason=port-missing'))).toBe(true);
    expect(run.lines.some((line) => line.includes('status=CANARY'))).toBe(false);
    // The cost of the defect: the smoke DID happen, so a live authorization would have been spent.
    expect(
      run.lines.some((line) => line.includes('phase=smoke') && line.includes('status=PASS')),
    ).toBe(true);
  });

  it('R8R1-C2 the composition bin.ts uses names the concrete live factory', () => {
    const bin = readFileSync(join(SRC, 'bin.ts'), 'utf8');
    // The seam, the concrete factory, and the import that supplies it.
    expect(bin).toContain("from './live-diagnostic-canary-composition.js'");
    expect(bin).toContain('openDiagnosticCanaryRunner: (credential) =>');
    expect(bin).toContain('openLiveDiagnosticCanaryRunner({ credential })');
    // It is the ONLY diagnostic seam bin passes, and it is not the obsolete R8 shape.
    expect(bin).not.toContain('runDiagnosticCanary');
  });

  it('R8R1-C9 a correctly composed run never reports port-missing', async () => {
    const wire = fakeTransport();
    const run = await runOperator({
      runner: (credential) =>
        Promise.resolve(
          createLiveDiagnosticCanaryComposition({
            credential,
            openTransport: () => wire.transport,
            captured,
          }).run,
        ),
    });
    expect(run.lines.some((line) => line.includes('reason=port-missing'))).toBe(false);
    expect(run.lines.some((line) => line.includes('reason=runner-bind-failed'))).toBe(false);
    expect(run.outcome).toBe('REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
  });
});

describe('R8R1-C3..C8 — the real composition, driven end to end over a fake wire', () => {
  interface LiveRun {
    readonly run: RunRecord;
    readonly sends: readonly RecordedSend[];
    readonly composition: ReturnType<typeof createLiveDiagnosticCanaryComposition>;
  }

  async function liveRun(): Promise<LiveRun> {
    const wire = fakeTransport();
    let composition: ReturnType<typeof createLiveDiagnosticCanaryComposition> | undefined;
    const run = await runOperator({
      runner: (credential) => {
        composition = createLiveDiagnosticCanaryComposition({
          credential,
          openTransport: () => wire.transport,
          captured,
        });
        return Promise.resolve(composition.run);
      },
    });
    if (composition === undefined) {
      throw new Error('the composition must have been built');
    }
    return { run, sends: wire.sends(), composition };
  }

  it('R8R1-C4/C5/C6 the factory is opened once, and no candidate session is constructed', async () => {
    const { run } = await liveRun();
    expect(run.runnerOpenCalls).toBe(1);
    // The diagnostic returns BEFORE `openCandidate`, so no ordinary gateway, no cancellation
    // controller and no safety/quality port ever exists in this run.
    expect(run.openCandidateCalls).toBe(0);
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
  });

  it('R8R1-C3 the runner is bound to the SAME credential object the operator resolved', async () => {
    const { run } = await liveRun();
    expect(run.credentialsHandedToRunner).toHaveLength(1);
    // Object identity, not equality: a second holder would be a second credential policy.
    expect(run.credentialsHandedToRunner[0]).toBe(run.candidateCredential);
  });

  it('R8R1-C7 D1-D8 each reach the wire exactly once, in matrix order', async () => {
    const { sends, composition } = await liveRun();
    expect(sends).toHaveLength(DIAGNOSTIC_CANARIES.length);
    expect(composition.providerBuilds()).toBe(DIAGNOSTIC_CANARIES.length);
    // Each canary claimed its own attribution window on the ONE recorder, in order.
    for (const canary of DIAGNOSTIC_CANARIES) {
      expect(composition.observations.observationCountFor(canary.canaryId)).toBe(1);
    }
    expect(composition.observations.unattributedObservations()).toBe(0);
    expect(composition.observations.overlappingCaseWindows()).toBe(0);
  });

  it('R8R1-C8 a completed diagnostic maps to exit code 23', async () => {
    const { run } = await liveRun();
    expect(run.outcome).toBe('REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
    expect(OPERATOR_EXIT_CODES.REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE).toBe(23);
    expect(run.lines.at(-1)).toContain('finalStatus=REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
  });

  it('R8R1-C13 every cap provider carries the SAME credential holder', async () => {
    const { sends } = await liveRun();
    const authorizations = new Set(sends.map((one) => one.authorization));
    // One distinct value across all eight, and it is the sentinel's — so no second holder, no second
    // resolver, and nothing read from anywhere else.
    expect(authorizations.size).toBe(1);
    expect(sends.every((one) => one.authorization.endsWith(SENTINEL_KEY))).toBe(true);
  });

  it('R8R1-C14 exactly ONE observation recorder serves all eight canaries', async () => {
    const { composition } = await liveRun();
    // A per-canary observer would leave the composition's own recorder empty. It is not: every
    // canary's boundary crossing is on this one recorder.
    for (const canary of DIAGNOSTIC_CANARIES) {
      const observed = composition.observations.observationFor(canary.canaryId);
      expect(observed.providerTransportStarted).toBe(true);
      expect(observed.providerHttpStatus).toBe(200);
      expect(observed.providerHttpClass).toBe('SUCCESS_2XX');
    }
  });

  it('R8R1-C15 the caps on the wire are exactly the frozen matrix values', async () => {
    const { sends, composition } = await liveRun();
    const expected = DIAGNOSTIC_CANARIES.map((one) => one.maxCompletionTokens);
    expect(sends.map((one) => one.maxCompletionTokens)).toEqual(expected);
    expect([...composition.completionCapsUsed()]).toEqual(expected);
    // The two classes are the exact integers, and neither collapsed onto the other.
    expect(new Set(expected)).toEqual(
      new Set([CANARY_LOW_COMPLETION_CAP, CANDIDATE_MAX_COMPLETION_TOKENS]),
    );
    expect(CANARY_LOW_COMPLETION_CAP).toBe(512);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
  });

  it('R8R1-C16/C17 the schema on the wire is the exact declared source for every canary', async () => {
    const { sends } = await liveRun();
    const bySource = new Map<string, unknown>([
      ['SYNTHETIC_MINIMAL', CANARY_MINIMAL_SCHEMA],
      ['SYNTHETIC_ANYOF_NULLABLE', CANARY_ANYOF_NULLABLE_SCHEMA],
      ['SYNTHETIC_NUMERIC_ENUM', CANARY_NUMERIC_ENUM_SCHEMA],
    ]);
    DIAGNOSTIC_CANARIES.forEach((canary, index) => {
      const sent = sends[index]?.responseFormatSchema;
      if (canary.schemaSource === 'REAL_RIYA_STRUCTURED') {
        // D5-D8 carry the production Riya schema, PROJECTED by the real provider from the raw
        // rendering — so the strict projection ran here rather than being pre-empted.
        expect(sent).toBeDefined();
        expect(JSON.stringify(sent)).not.toBe(JSON.stringify(captured.rawStructuredJsonSchema));
        expect(JSON.stringify(sent).length).toBeGreaterThan(
          JSON.stringify(CANARY_MINIMAL_SCHEMA).length,
        );
        return;
      }
      const raw = bySource.get(canary.schemaSource);
      expect(raw).toBeDefined();
      // The synthetic schemas are already inside the documented subset, so projection is identity.
      expect(JSON.stringify(sent)).toBe(JSON.stringify(raw));
    });
  });

  it('R8R1-C18/C19 message SOURCES on the wire match the frozen matrix', async () => {
    const { sends } = await liveRun();
    const synthetic = SYNTHETIC_CANARY_MESSAGES.map((one) => ({
      role: one.role,
      content: one.content,
    }));
    DIAGNOSTIC_CANARIES.forEach((canary, index) => {
      const sent = sends[index]?.messages ?? [];
      if (canary.messageSource === 'SYNTHETIC_TINY') {
        expect(sent).toEqual(synthetic);
        return;
      }
      // D7/D8 carry the CAPTURED production request, not an approximation of it.
      expect(sent).toEqual(
        captured.messages.map((one) => ({ role: one.role, content: one.content })),
      );
      // And it is genuinely the production shape: bigger than the tiny synthetic pair, and it
      // carries the governed system prompt rather than a placeholder.
      expect(sent.length).toBeGreaterThanOrEqual(2);
      const systemChars = sent
        .filter((one) => one.role === 'system')
        .reduce((total, one) => total + one.content.length, 0);
      expect(systemChars).toBeGreaterThan(
        SYNTHETIC_CANARY_MESSAGES[0]?.content.length ?? Number.MAX_SAFE_INTEGER,
      );
    });
  });

  it('R8R1-C20/C21/C22 each cap pair differs on the wire by the completion cap ALONE', async () => {
    const { sends } = await liveRun();
    const indexOf = (id: string): number =>
      DIAGNOSTIC_CANARIES.findIndex((one) => one.canaryId === id);
    for (const [low, high] of [
      ['D1', 'D2'],
      ['D5', 'D6'],
      ['D7', 'D8'],
    ] as const) {
      const a = sends[indexOf(low)];
      const b = sends[indexOf(high)];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // Byte-identical messages and schema; the ONLY difference is the cap.
      expect(JSON.stringify(a?.messages)).toBe(JSON.stringify(b?.messages));
      expect(JSON.stringify(a?.responseFormatSchema)).toBe(JSON.stringify(b?.responseFormatSchema));
      expect(a?.model).toBe(b?.model);
      expect(a?.maxCompletionTokens).toBe(CANARY_LOW_COMPLETION_CAP);
      expect(b?.maxCompletionTokens).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    }
  });

  it('R8R1-C23 every invocation carries a FRESH, non-aborted signal', async () => {
    const { sends } = await liveRun();
    expect(sends.every((one) => !one.signalAbortedAtSend)).toBe(true);
    // Eight distinct controllers: a shared signal would make one canary's fate another's.
    expect(new Set(sends.map((one) => one.signal)).size).toBe(sends.length);
  });

  it('R8R1-C24/C25 strict json_schema on every request, and never json_object', async () => {
    const { sends } = await liveRun();
    for (const sent of sends) {
      expect(sent.responseFormatType).toBe('json_schema');
      expect(sent.responseFormatStrict).toBe(true);
      expect(sent.bodyFieldNames).toEqual([
        'max_completion_tokens',
        'messages',
        'model',
        'n',
        'response_format',
        'stream',
      ]);
      expect(sent.model).toBe(CANDIDATE_MODEL_ID);
    }
    expect(JSON.stringify(sends)).not.toContain('json_object');
  });

  it('R8R1-C26/C27 no retry and no fallback — one send per canary even when the wire rejects', async () => {
    // The production request itself carries a zero retry budget.
    expect(captured.retryBudget).toBe(0);

    const wire = fakeTransport(
      400,
      JSON.stringify({ error: { type: 'invalid_request_error', code: 'json_validate_failed' } }),
    );
    const run = await runOperator({
      runner: (credential) =>
        Promise.resolve(
          createLiveDiagnosticCanaryComposition({
            credential,
            openTransport: () => wire.transport,
            captured,
          }).run,
        ),
    });
    // Eight canaries, eight sends. A retry would be nine or more; a fallback would name a second
    // provider, and there is only one on the wire.
    expect(wire.sends()).toHaveLength(DIAGNOSTIC_CANARIES.length);
    expect(new Set(wire.sends().map((one) => one.model))).toEqual(new Set([CANDIDATE_MODEL_ID]));
    // The rejection is classified through the closed vocabulary, and the run still completes.
    expect(run.outcome).toBe('REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
    const canaryLines = run.lines.filter((line) => line.includes('status=CANARY'));
    expect(canaryLines).toHaveLength(8);
    expect(canaryLines.every((line) => line.includes('providerHttpClass=BAD_REQUEST_400'))).toBe(
      true,
    );
    expect(
      canaryLines.every((line) => line.includes('providerErrorType=INVALID_REQUEST_ERROR')),
    ).toBe(true);
  });

  it('R8R1-C28/C29/C30 the ledger stops at nine and the receipt evaluates nothing', async () => {
    const { run } = await liveRun();
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('totalProviderRequests=9');
    expect(receipt).toContain('smokeRequests=1');
    expect(receipt).toContain('diagnosticProviderRequests=8');
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('reviewBundleWritten=false');
    // R8R1-C30: no bundle path is ever reported, and the writer is not reachable from this branch.
    expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
  });

  it('R8R1-C35 nothing content-bearing reaches the console', async () => {
    const { run } = await liveRun();
    const all = run.lines.join('\n');
    for (const forbidden of [
      SENTINEL_KEY,
      'Bearer',
      'authorization',
      'Authorization',
      'additionalProperties',
      'json_schema',
      'failed_generation',
      'response_format',
    ]) {
      expect(all).not.toContain(forbidden);
    }
    // No message content: neither the synthetic pair nor any captured production message.
    for (const message of [...SYNTHETIC_CANARY_MESSAGES, ...captured.messages]) {
      const probe = message.content.slice(0, 24);
      if (probe.length > 0) {
        expect(all).not.toContain(probe);
      }
    }
  });
});

describe('R8R1-C10/C11/C12 — the runner is never built when it should not be', () => {
  it('R8R1-C10 a bind failure fails closed BEFORE D1, with nothing from the error', async () => {
    const wire = fakeTransport();
    const run = await runOperator({
      runner: () => Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR')),
    });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=runner-bind-failed'))).toBe(true);
    // No canary ran, and no request reached the wire.
    expect(run.lines.some((line) => line.includes('status=CANARY'))).toBe(false);
    expect(wire.sends()).toHaveLength(0);
    expect(run.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL');
  });

  it('a credential that is not a real holder is refused before any canary', () => {
    expect(() =>
      createLiveDiagnosticCanaryComposition({
        credential: { pretending: 'to be a key' },
        openTransport: () => fakeTransport().transport,
        captured,
      }),
    ).toThrow(/QFJ_DIAGNOSTIC_CREDENTIAL_NOT_BOUND/u);
  });

  it('R8R1-C11 a failed smoke creates no diagnostic runner', async () => {
    const run = await runOperator({
      smoke: SMOKE_FAIL,
      runner: () => Promise.reject(new Error('MUST-NOT-BE-OPENED')),
    });
    expect(run.outcome).toBe('SMOKE_FAILED');
    expect(run.runnerOpenCalls).toBe(0);
    expect(run.openCandidateCalls).toBe(0);
  });

  it('R8R1-C12 a credential failure creates no diagnostic runner', async () => {
    await expect(
      runOperator({
        credentialThrows: true,
        runner: () => Promise.reject(new Error('MUST-NOT-BE-OPENED')),
      }),
    ).rejects.toThrow(/CREDENTIAL-REFUSED/u);
  });
});

describe('R8R1-C31/C32/C33/C34 — every other flow is untouched', () => {
  it('R8R1-C31/C32 non-diagnostic goals never open the diagnostic runner', async () => {
    for (const goal of ['SAFETY_REPLICATION', 'FULL_EVIDENCE'] as const) {
      const record = await runOperator({
        runGoal: goal,
        runner: () => Promise.reject(new Error('MUST-NOT-BE-OPENED')),
      });
      // Both goals fall through to `openCandidate`, whose stub throws — which is itself the proof
      // that the diagnostic branch did not intercept them, and that the runner was never opened.
      expect(record.outcome).toBe('CANDIDATE_BIND_FAILED');
      expect(record.runnerOpenCalls).toBe(0);
      expect(record.openCandidateCalls).toBe(1);
      expect(record.lines.some((line) => line.includes('request-contract-diagnostic'))).toBe(false);
    }
  });

  it('R8R1-C33/C34 the TTY gate and the credential ingress semantics are unchanged', () => {
    const operator = readFileSync(join(SRC, 'operator.ts'), 'utf8');
    // The ingress is still opened once, forwarded untouched, and reported for both phases.
    expect(operator).toContain('await deps.openSmokeCredential()');
    expect(operator).toContain("emitCredentialIngress(safe, credentialSource, 'SMOKE'");
    expect(operator).toContain("emitCredentialIngress(safe, credentialSource, 'CANDIDATE'");
    expect(operator).toContain("precheck.failure === 'tty-unavailable' ? 'TTY_REQUIRED'");
    // The diagnostic branch sits AFTER the candidate ingress line and BEFORE `openCandidate`.
    const ingress = operator.indexOf("emitCredentialIngress(safe, credentialSource, 'CANDIDATE'");
    const diagnostic = operator.indexOf("runGoal === 'REQUEST_CONTRACT_DIAGNOSTIC'");
    const openCandidate = operator.indexOf('await deps.openCandidate(candidateCredential)');
    expect(ingress).toBeGreaterThan(-1);
    expect(diagnostic).toBeGreaterThan(ingress);
    expect(openCandidate).toBeGreaterThan(diagnostic);
  });

  it('the live composition opens no second ingress, resolver or holder', () => {
    const composition = readFileSync(join(SRC, 'live-diagnostic-canary-composition.ts'), 'utf8');
    const materials = readFileSync(join(SRC, 'diagnostic-canary-materials.ts'), 'utf8');
    for (const source of [composition, materials]) {
      for (const forbidden of [
        'createGroqApiKey',
        'createNodeMaskedSecretSource',
        'createMaskedTtyCredentialResolver',
        'createWindowsPowerShellClipboardSource',
        'createCredentialComposition',
        'readOnce',
        'process.env',
        'process.argv',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
    // Exactly one recorder is constructed for the whole diagnostic run.
    expect(composition.split('createCandidateTransportObservations()').length - 1).toBe(1);
  });
});

describe('the materials are the production sources, not replicas', () => {
  it('the captured schema is the real Riya structured schema rendering', () => {
    const materials = createDiagnosticCanaryMaterials(captured);
    const real = DIAGNOSTIC_CANARIES.filter(
      (one) => one.schemaSource === 'REAL_RIYA_STRUCTURED',
    ) as readonly DiagnosticCanary[];
    expect(real).toHaveLength(4);
    for (const canary of real) {
      // Object identity with the ONE captured rendering — there is no second Riya schema.
      expect(materials.rawSchemaFor(canary)).toBe(captured.rawStructuredJsonSchema);
    }
    // It is a real rendering, not an empty fallback.
    expect(JSON.stringify(captured.rawStructuredJsonSchema)).toContain('properties');
  });

  it('the captured request carries the production timeout and zero retry', () => {
    expect(captured.timeoutMs).toBeGreaterThan(0);
    expect(captured.retryBudget).toBe(0);
  });

  it('D1-D6 share the ONE synthetic message array by identity', () => {
    const materials = createDiagnosticCanaryMaterials(captured);
    for (const canary of DIAGNOSTIC_CANARIES.filter(
      (one) => one.messageSource === 'SYNTHETIC_TINY',
    )) {
      expect(materials.messagesFor(canary)).toBe(SYNTHETIC_CANARY_MESSAGES);
    }
    for (const canary of DIAGNOSTIC_CANARIES.filter(
      (one) => one.messageSource === 'REAL_RIYA_REQUEST_BUILDER',
    )) {
      expect(materials.messagesFor(canary)).toBe(captured.messages);
    }
  });

  it('two captures produce byte-identical messages', async () => {
    const again = await captureProductionRiyaCanaryRequest();
    expect(JSON.stringify(again.messages)).toBe(JSON.stringify(captured.messages));
    expect(JSON.stringify(again.rawStructuredJsonSchema)).toBe(
      JSON.stringify(captured.rawStructuredJsonSchema),
    );
  });

  it('renderStructuredJsonSchema is the ONE rendering path', () => {
    // A sanity check that the helper used is the production one and returns a real document.
    expect(typeof renderStructuredJsonSchema).toBe('function');
    expect(captured.rawStructuredJsonSchema).not.toStrictEqual({});
  });
});
