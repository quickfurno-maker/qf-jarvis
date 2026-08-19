/**
 * POST-SRV1 — the OPERATIONAL ACCEPTANCE diagnostic, driven end to end with a fake network.
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
 * fake and no credential is real; everything above it — the O0-O3 plan, the Groq provider, the strict
 * projection, the observer, the ledger, the emitters — is the production path. The bodies the fake
 * transport receives are the bodies the real one would have sent, which is what lets these specs
 * assert the two things this whole run turns on: that every probe went out at the governed
 * OPERATIONAL budget, and that O2 and O3 differ on the messages and on nothing else.
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
  createOperationalAcceptanceDiagnosticLedger,
  OPERATIONAL_ACCEPTANCE_MAX_ESTIMATED_COST_USD,
  OPERATIONAL_ACCEPTANCE_MAX_PROVIDER_REQUESTS,
} from '../accounting.js';
import { parseCliArgs, ledgerForRunGoal } from '../bin.js';
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
import {
  createLiveOperationalAcceptanceComposition,
  OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET,
} from '../operational-acceptance-port.js';
import { OPERATIONAL_ACCEPTANCE_STEP_IDS } from '../internal/operational-acceptance-plan.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createSafeConsole } from '../safe-console.js';
import { SCHEMA_PROBE_COMPLETION_CAP } from '../schema-probe-port.js';

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
  const directory = mkdtempSync(join(tmpdir(), 'riya-oad-'));
  scratch.push(directory);
  return directory;
}

const SENTINEL_KEY = 'FAKE-OAD-SENTINEL-NEVER-A-REAL-KEY-000000';

interface RecordedSend {
  readonly model: string;
  readonly maxCompletionTokens: number;
  readonly responseFormatSchema: unknown;
  readonly responseFormatStrict: boolean | undefined;
  /** The messages actually serialised onto the wire. The axis O2 and O3 vary. */
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly signal: AbortSignal;
  readonly signalAbortedAtSend: boolean;
  readonly authorization: string;
}

interface FakeTransport {
  readonly transport: GroqTransport;
  readonly sends: () => readonly RecordedSend[];
}

const okBody = JSON.stringify({
  id: 'chatcmpl-oad',
  object: 'chat.completion',
  created: 1,
  model: CANDIDATE_MODEL_ID,
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"ok":"OK"}' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
});

/**
 * The refusal SRV1 actually received, reproduced byte-for-byte in its closed parts.
 *
 * A secret-shaped marker rides along in the message so the content-free specs below are testing a
 * body that really does carry something an emitter must never print.
 */
const refusedBody = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    message: 'PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED',
  },
});

/** A wire that records and answers. `statusFor` lets one probe be refused without touching others. */
function fakeTransport(statusFor: (index: number) => number = () => 200): FakeTransport {
  const sends: RecordedSend[] = [];
  const transport: GroqTransport = {
    send: (request, signal) => {
      const parsed = JSON.parse(request.body) as Record<string, unknown>;
      const responseFormat = parsed['response_format'] as
        | { json_schema?: { strict?: boolean; schema?: unknown } }
        | undefined;
      const index = sends.length;
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
        signalAbortedAtSend: signal.aborted,
        authorization: request.headers['authorization'] ?? '',
      });
      const status = statusFor(index);
      return Promise.resolve({
        status,
        retryAfterSeconds: null,
        bodyText: status === 200 ? okBody : refusedBody,
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
    | ReturnType<typeof createLiveOperationalAcceptanceComposition>
    | undefined;
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
  let composition:
    | ReturnType<typeof createLiveOperationalAcceptanceComposition>
    | undefined;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    // The REAL ledger the executable would choose for this goal, resolved through the real chooser.
    ledger: ledgerForRunGoal('POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC'),
    runGoal: 'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
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
      throw new Error('CANDIDATE-SESSION-MUST-NOT-BE-CONSTRUCTED-IN-OPERATIONAL-DIAGNOSTIC');
    },
    ...(options.omitRunner === true
      ? {}
      : {
          openOperationalAcceptanceRunner: (credential: unknown) => {
            runnerOpenCalls += 1;
            credentialsHandedToRunner.push(credential);
            if (options.bindThrows === true) {
              return Promise.reject(new Error('SECRET-BIND-DETAIL-MUST-NOT-APPEAR'));
            }
            // THE composition bin.ts uses, with only the transport and the materials injected —
            // kept so both budget axes stay observable directly.
            composition = createLiveOperationalAcceptanceComposition({
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

/** The wire index of a probe, given the plan runs in declared order. */
const O0 = 0;
const O1 = 1;
const O2 = 2;
const O3 = 3;

describe('the CLI and the executable bind the new goal', () => {
  it('the real CLI accepts exactly the new run goal', () => {
    const parsed = parseCliArgs(['--run-goal', 'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.args.runGoal).toBe('POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC');
    }
    // Every earlier goal still parses, unchanged.
    for (const goal of [
      'SAFETY_REPLICATION',
      'REQUEST_CONTRACT_DIAGNOSTIC',
      'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
      'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
    ]) {
      expect(parseCliArgs(['--run-goal', goal]).ok).toBe(true);
    }
    // A near-miss spelling is refused rather than defaulted into a live run.
    expect(parseCliArgs(['--run-goal', 'OPERATIONAL_ACCEPTANCE']).ok).toBe(false);
  });

  it('the CLI exposes no budget, model, provider, credential, retry or skip override', () => {
    for (const flag of [
      '--completion-budget',
      '--max-completion-tokens',
      '--model',
      '--provider',
      '--api-key',
      '--retry',
      '--skip-smoke',
      '--skip-preflight',
      '--force',
    ]) {
      // An owner chooses a governed RUN GOAL, never a number.
      const refused = parseCliArgs([flag, '1']);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.reason).toBe('unknown-argument');
      }
    }
    // Stated positively too, so a numeric flag cannot be added without this failing: the accepted
    // surface is exactly these four, and not one of them is a budget, a model or a credential.
    expect(parseCliArgs(['--run-goal', 'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC']).ok).toBe(
      true,
    );
    expect(parseCliArgs(['--smoke-config', 'a.json']).ok).toBe(true);
    expect(parseCliArgs(['--review-output', 'b.json']).ok).toBe(true);
    expect(parseCliArgs(['--credential-source', 'tty']).ok).toBe(true);
  });

  it('the exit code is exactly 26 and every prior code is unchanged', () => {
    expect(OPERATOR_EXIT_CODES.POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE).toBe(26);
    expect(OPERATOR_EXIT_CODES.POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE).toBe(25);
    expect(OPERATOR_EXIT_CODES.SCHEMA_DIFFERENTIAL_DIAGNOSTIC_COMPLETE).toBe(24);
    // No duplicate integers: two goals sharing a code would make a shell exit status ambiguous.
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('bin.ts binds the concrete live runner and its own ledger', () => {
    const bin = readFileSync(join(SRC, 'bin.ts'), 'utf8');
    // The exact HF4-R8 defect, asserted rather than left possible.
    expect(bin).toContain("from './operational-acceptance-port.js'");
    expect(bin).toContain('openOperationalAcceptanceRunner: (credential) =>');
    expect(bin).toContain('openLiveOperationalAcceptanceRunner({');
    expect(bin).toContain('createOperationalAcceptanceDiagnosticLedger()');
  });

  it('a composition with no probe port fails closed and runs nothing', async () => {
    const run = await runDiagnostic({ omitRunner: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=port-missing'))).toBe(true);
    expect(run.sends).toHaveLength(0);
  });

  it('a runner that fails to bind fails closed BEFORE O0 and leaks nothing', async () => {
    const run = await runDiagnostic({ bindThrows: true });
    expect(run.outcome).toBe('INTERNAL_CLOSED_FAILURE');
    expect(run.lines.some((line) => line.includes('reason=runner-bind-failed'))).toBe(true);
    expect(run.sends).toHaveLength(0);
    expect(run.lines.join('\n')).not.toContain('SECRET-BIND-DETAIL');
  });
});

describe('the dedicated ledger bounds the run at five requests and one dollar', () => {
  it('the hard ceiling is 5 requests / USD 1', () => {
    expect(OPERATIONAL_ACCEPTANCE_MAX_PROVIDER_REQUESTS).toBe(5);
    expect(OPERATIONAL_ACCEPTANCE_MAX_ESTIMATED_COST_USD).toBe(1);
    // And the goal really resolves to THAT ledger, not to a wider one.
    const ledger = ledgerForRunGoal('POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC');
    expect(ledger.snapshot().totalProviderRequests).toBe(0);
  });

  it('no SIXTH provider reservation succeeds', () => {
    const ledger = createOperationalAcceptanceDiagnosticLedger();
    // The smoke, then the four probes: five, exactly as authorized.
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    for (let index = 0; index < 4; index += 1) {
      const reservation = ledger.reserve('operational-acceptance-probe');
      expect(reservation.ok).toBe(true);
      ledger.settle(undefined, true);
    }
    const sixth = ledger.reserve('operational-acceptance-probe');
    // Refused BEFORE the request, not noticed after it: a sixth call would already have been spent.
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.refusal).toBe('request-limit-reached');
    }
    expect(ledger.snapshot().totalProviderRequests).toBe(5);
    expect(ledger.snapshot().operationalAcceptanceProbeProviderRequests).toBe(4);
  });
});

describe('a healthy run executes exactly O0-O3 once each', () => {
  it('runs all four probes after the smoke and stops at exit code 26', async () => {
    const run = await runDiagnostic();
    expect(run.outcome).toBe('POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE');
    expect(run.sends).toHaveLength(OPERATIONAL_ACCEPTANCE_STEP_IDS.length);
    expect(run.sends).toHaveLength(4);
    const probeRows = run.lines.filter((line) => line.includes('status=PROBE'));
    expect(probeRows).toHaveLength(4);
    for (const stepId of OPERATIONAL_ACCEPTANCE_STEP_IDS) {
      expect(probeRows.filter((line) => line.includes(`stepId=${stepId}`))).toHaveLength(1);
    }
    expect(run.lines.at(-1)).toContain(
      'finalStatus=POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE',
    );
    // The receipt names its OWN counter.
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('operationalAcceptanceProbeRequests=4');
    expect(receipt).toContain('totalProviderRequests=5');
  });

  it('binds the runner once, to the SAME credential object, and builds no candidate session', async () => {
    const run = await runDiagnostic();
    expect(run.runnerOpenCalls).toBe(1);
    expect(run.credentialsHandedToRunner).toHaveLength(1);
    // Object identity: a second holder would be a second credential policy.
    expect(run.credentialsHandedToRunner[0]).toBe(run.candidateCredential);
    // The diagnostic returns BEFORE `openCandidate`, so no ordinary gateway, cancellation
    // controller, safety port, quality port or bundle writer ever exists.
    expect(run.openCandidateCalls).toBe(0);
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
    expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('reviewBundleWritten=false');
  });

  it('EVERY probe goes on the wire at the governed OPERATIONAL budget', async () => {
    const run = await runDiagnostic();
    for (const send of run.sends) {
      expect(send.maxCompletionTokens).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
      expect(send.maxCompletionTokens).toBe(OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET);
      // The two budgets a probe here must NOT inherit: SRV1's low control cap below it, and the
      // model capability ceiling above it.
      expect(send.maxCompletionTokens).not.toBe(SCHEMA_PROBE_COMPLETION_CAP);
      expect(send.maxCompletionTokens).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
      expect(send.responseFormatStrict).toBe(true);
      expect(send.model).toBe(CANDIDATE_MODEL_ID);
      expect(send.signalAbortedAtSend).toBe(false);
    }
    // One holder: every request carries the same authorization value.
    expect(new Set(run.sends.map((one) => one.authorization)).size).toBe(1);
    // Four distinct controllers: a shared signal would make one probe's fate another's.
    expect(new Set(run.sends.map((one) => one.signal)).size).toBe(4);
  });

  it('the pinned operational budget is 14_848, recomputed through the production module', () => {
    // A pin, not a definition. If the governed budget moves, this fails loudly rather than letting a
    // diagnostic quietly measure an envelope production no longer uses.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(14_848);
    expect(OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    // And it is IMPORTED rather than retyped: a second literal is exactly how the two numbers drift.
    const port = readFileSync(join(SRC, 'operational-acceptance-port.ts'), 'utf8');
    expect(port).toContain(
      "import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction'",
    );
    // No second spelling of the number anywhere in the port, in either literal form.
    expect(port).not.toMatch(/14_?848/);
  });

  it('CAPABILITY ceiling and REQUEST budget stay separate in the composition', async () => {
    // THE regression PR #131 repaired and PR #132 reintroduced: passing the per-request budget in
    // where the MODEL's ceiling belongs makes the config lie about the model.
    const run = await runDiagnostic();
    const composition = run.composition;
    expect(composition).toBeDefined();
    if (composition === undefined) {
      return;
    }
    expect([...composition.requestCompletionBudgetsUsed()]).toEqual([
      RIYA_COMPLETION_BUDGET_TOKENS,
      RIYA_COMPLETION_BUDGET_TOKENS,
      RIYA_COMPLETION_BUDGET_TOKENS,
      RIYA_COMPLETION_BUDGET_TOKENS,
    ]);
    for (const ceiling of composition.capabilityCeilingsUsed()) {
      expect(ceiling).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
      expect(ceiling).toBe(65_536);
      expect(ceiling).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    }
  });

  it('sends exactly one request per probe: no retry, no fallback model', async () => {
    // Every probe after the control refused. A retry loop would show as more than four sends; a
    // fallback would show as a second model id on the wire. The CONTROL is left healthy on purpose,
    // because refusing it would stop the run at one send and prove nothing about retries.
    const run = await runDiagnostic({ statusFor: (index) => (index === O0 ? 200 : 400) });
    expect(run.sends).toHaveLength(4);
    expect(new Set(run.sends.map((one) => one.model))).toEqual(new Set([CANDIDATE_MODEL_ID]));
    expect(run.sends.every((one) => one.model !== 'openai/gpt-oss-120b')).toBe(true);
  });
});

describe('O2 and O3 differ by MESSAGES and by nothing else', () => {
  it('the two probes put byte-identical schemas on the wire', async () => {
    const run = await runDiagnostic();
    const synthetic = run.sends[O2];
    const representative = run.sends[O3];
    expect(synthetic).toBeDefined();
    expect(representative).toBeDefined();
    if (synthetic === undefined || representative === undefined) {
      return;
    }
    // Serialised BYTES, as the provider receives them — not the plan objects.
    expect(JSON.stringify(representative.responseFormatSchema)).toBe(
      JSON.stringify(synthetic.responseFormatSchema),
    );
    // And that document is the current projected production Riya schema.
    expect(synthetic.responseFormatSchema).toEqual(projectedSchema);
    // Everything else the pair must share.
    expect(representative.model).toBe(synthetic.model);
    expect(representative.maxCompletionTokens).toBe(synthetic.maxCompletionTokens);
    expect(representative.responseFormatStrict).toBe(synthetic.responseFormatStrict);
    expect(representative.authorization).toBe(synthetic.authorization);
  });

  it('O2 carries the synthetic messages and O3 carries the CAPTURED production messages', async () => {
    const run = await runDiagnostic();
    const synthetic = run.sends[O2];
    const representative = run.sends[O3];
    if (synthetic === undefined || representative === undefined) {
      throw new Error('both exact probes must reach the wire');
    }
    expect(synthetic.messages).toEqual(
      SYNTHETIC_CANARY_MESSAGES.map((one) => ({ role: one.role, content: one.content })),
    );
    expect(representative.messages).toEqual(
      captured.messages.map((one) => ({ role: one.role, content: one.content })),
    );
    // The pair genuinely differs on this axis — otherwise O3 would be O2 sent twice.
    expect(JSON.stringify(representative.messages)).not.toBe(JSON.stringify(synthetic.messages));
  });

  it('O0 sends the minimal control and O1 sends the real evolution group', async () => {
    const run = await runDiagnostic();
    const control = run.sends[O0];
    const group = run.sends[O1];
    if (control === undefined || group === undefined) {
      throw new Error('both wrapper probes must reach the wire');
    }
    expect(control.responseFormatSchema).toEqual({
      type: 'object',
      properties: { ok: { type: 'string', enum: ['OK'] } },
      required: ['ok'],
      additionalProperties: false,
    });
    const realEvolution = (projectedSchema as { properties: Record<string, unknown> }).properties[
      'evolution'
    ];
    expect(
      (group.responseFormatSchema as { properties: Record<string, unknown> }).properties[
        'evolution'
      ],
    ).toEqual(realEvolution);
  });
});

describe('the stop rule spends the authorization on the question it was granted for', () => {
  it('a refused O0 stops O1, O2 and O3', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O0 ? 400 : 200) });
    // The envelope itself was refused, so the remaining requests are not spent proving nothing.
    expect(run.sends).toHaveLength(1);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'operationalAcceptanceClassification=OPERATIONAL_CONTROL_INVALID',
    );
    expect(run.outcome).toBe('POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE');
  });

  it('a refused O1 does NOT stop O2 or O3', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O1 ? 400 : 200) });
    // The useful answer is the complete SET, and O3 is the probe this run exists to send.
    expect(run.sends).toHaveLength(4);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'operationalAcceptanceClassification=OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
    );
  });

  it('a refused O2 does NOT stop O3', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O2 ? 400 : 200) });
    expect(run.sends).toHaveLength(4);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'operationalAcceptanceClassification=OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
    );
  });

  it('an accepted O2 with a refused O3 reports the MESSAGE SHAPE finding', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O3 ? 400 : 200) });
    expect(run.sends).toHaveLength(4);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'operationalAcceptanceClassification=OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED',
    );
    expect(classification).toContain('rejectedStepIds=O3_EXACT_REPRESENTATIVE_OPERATIONAL');
  });
});

describe('the output stays content-free and preserves the provider code', () => {
  it('JSON_VALIDATE_FAILED survives from the wire through analysis to emission', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O3 ? 400 : 200) });
    const probeRow =
      run.lines.find(
        (line) =>
          line.includes('status=PROBE') && line.includes('stepId=O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
      ) ?? '';
    // The distinction between "the provider validated the schema and refused the shape" and
    // "something else broke" is the whole reason a further authorization would be worth granting.
    expect(probeRow).toContain('providerErrorCode=JSON_VALIDATE_FAILED');
    expect(probeRow).toContain('providerHttpStatus=400');
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain(
      'rejectedErrorCodes=O3_EXACT_REPRESENTATIVE_OPERATIONAL=JSON_VALIDATE_FAILED',
    );
  });

  it('every probe row states the envelope it ran at, and states OPERATIONAL rather than LOW_512', async () => {
    const run = await runDiagnostic();
    for (const line of run.lines.filter((one) => one.includes('status=PROBE'))) {
      expect(line).toContain('completionCapClass=OPERATIONAL');
      expect(line).toContain(`maxCompletionTokens=${String(RIYA_COMPLETION_BUDGET_TOKENS)}`);
      expect(line).not.toContain('LOW_512');
    }
    // And each row says which messages it carried, since that is the axis the pair varies.
    const rows = run.lines.filter((one) => one.includes('status=PROBE'));
    expect(rows.filter((one) => one.includes('messageSource=CAPTURED_REPRESENTATIVE'))).toHaveLength(
      1,
    );
    expect(rows.filter((one) => one.includes('messageSource=SYNTHETIC_TINY'))).toHaveLength(3);
  });

  it('no provider body, message, prompt, schema or credential reaches the output', async () => {
    const run = await runDiagnostic({ statusFor: (index) => (index === O0 ? 200 : 400) });
    const output = run.lines.join('\n');
    // The refusal body really did carry this marker, so the assertion is testing a live path.
    expect(refusedBody).toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
    expect(output).not.toContain('PROVIDER-BODY-DETAIL-MUST-NEVER-BE-EMITTED');
    expect(output).not.toContain(SENTINEL_KEY);
    expect(output).not.toContain('Bearer');
    // No prompt bytes and no schema document — only closed tokens and bounded numbers.
    for (const message of captured.messages) {
      expect(output).not.toContain(message.content);
    }
    expect(output).not.toContain('additionalProperties');
    expect(output).not.toContain('"properties"');
  });
});
