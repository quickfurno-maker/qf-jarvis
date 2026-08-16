/**
 * The whole composition, wired the way `bin.ts` wires it, against deterministic fakes.
 *
 * ### Why this file had to exist
 *
 * Every unit in this package passed while the runnable CLI was wrong in four separate ways: a secret
 * source constructed before preflight, a smoke credential object nobody used, a candidate key read
 * outside the resolver, and a ledger that charged two boundary cases for requests they never made.
 * Isolated tests cannot see wiring. This one runs the real preflight, the real orchestrator, the real
 * ports, the real ledger and the real gateway composition, and only the transport and the terminal
 * are fake.
 *
 * No network, no terminal, no key.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import type { MaskedSecretSource, SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createOperatorLedger } from '../accounting.js';
import { createAccountedSession } from '../candidate-session.js';
import {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from '../cancellation-transport.js';
import { createCandidateTransportObservations } from '../candidate-transport-observation.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createCandidateGateway } from '../evaluation-gateway.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import { createSafeConsole } from '../safe-console.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';

type ActualPreflight = typeof ActualPreflightModule;
/**
 * The synthetic configuration cannot hash to the governed digest, and production no longer offers any
 * way to say otherwise — no field on `PreflightInput`, no callback on `OperatorDeps`. So the SPEC
 * substitutes the module, which is a test-harness concern rather than a production seam.
 *
 * `runPreflight` is otherwise the real one: every path, digest, identity, version and ceiling check
 * runs exactly as it ships. Only the expected smoke-config digest differs.
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

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-integrated-'));
  scratch.push(directory);
  return directory;
}

/** A transport that answers nothing useful but records that it was entered. Never opens a socket. */
function fakeTransport(wire: WireOutcome = {}): {
  readonly transport: GroqTransport;
  readonly entries: () => number;
} {
  let entries = 0;
  return {
    transport: {
      send: () => {
        entries += 1;
        return Promise.resolve({
          status: wire.status ?? 200,
          bodyText: wire.bodyText ?? '{}',
          retryAfterSeconds: null,
        } as Awaited<ReturnType<GroqTransport['send']>>);
      },
    },
    entries: () => entries,
  };
}

/** What the fake wire answers. HF4-R4: the status is what the observer classifies. */
interface WireOutcome {
  readonly status?: number;
  readonly bodyText?: string;
}

const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 12, outputTokens: 4 },
  counters: { binds: 1, credentialReads: 1, invocations: 1, timersArmed: 1, timersCleared: 1 },
  diagnostics: {},
} as unknown as SmokeRunResult;

const SMOKE_FAIL = {
  ok: false,
  reason: 'provider-refused',
  references: {},
  counters: { binds: 0, credentialReads: 1, invocations: 1, timersArmed: 1, timersCleared: 1 },
  diagnostics: {},
} as unknown as SmokeRunResult;

/** The governed, secret-free smoke configuration shape the loader accepts. */
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
  // HF1. This used to write the config and then SHA-256 its own bytes as the expected digest, which
  // is precisely the mistake that shipped: a harness grading itself agrees with itself no matter what
  // preflight compares. The synthetic expected digest is now the SEMANTIC one, recomputed from the
  // PARSED config through the same production helper preflight uses, and the embedded
  // `release.configDigest` is set to that same value so both independent checks are genuinely
  // exercised rather than accidentally satisfied.
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

interface Recorded {
  readonly deps: OperatorDeps;
  readonly lines: string[];
  readonly smokeSources: () => number;
  readonly smokeSourceIdentityMatched: () => boolean;
  readonly candidateResolutions: () => number;
  readonly ordinaryEntries: () => number;
  readonly cancellationEntries: () => number;
  readonly perCase: (caseId: string) => number;
  readonly ledgerSnapshot: () => ReturnType<ReturnType<typeof createOperatorLedger>['snapshot']>;
  readonly observations: () => ReturnType<typeof createCandidateTransportObservations>;
}

function integrated(options: {
  readonly smoke: SmokeRunResult;
  readonly wire?: WireOutcome;
}): Recorded {
  const lines: string[] = [];
  const dir = externalDir();
  const { path: smokeConfigPath, digest: syntheticDigest } = writeSmokeConfig(dir);
  const ledger = createOperatorLedger();

  let smokeSources = 0;
  let handedSource: MaskedSecretSource | undefined;
  let receivedSource: MaskedSecretSource | undefined;
  let candidateResolutions = 0;

  const ordinary = fakeTransport(options.wire);
  const cancellation = fakeTransport(options.wire);
  const abort = createTransportBoundaryAbort();
  // HF4-R4. Wired exactly as `bin.ts` wires it: ONE recorder, both gateways observed, the observer
  // sitting outside the cancellation hook.
  const observations = createCandidateTransportObservations();
  let session: ReturnType<typeof createAccountedSession> | undefined;

  harnessState.syntheticDigest = syntheticDigest;

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    ledger,
    openSmokeSecretSource: () => {
      smokeSources += 1;
      handedSource = {
        isInteractive: () => true,
        readOnce: () => Promise.resolve('sk-fake-never-real-000000000000000000'),
      };
      return Promise.resolve(handedSource);
    },
    runSmoke: (_config, source) => {
      receivedSource = source;
      return Promise.resolve(options.smoke);
    },
    openCandidateCredential: () => {
      candidateResolutions += 1;
      // What a real resolver returns: the redacting holder built by the gateway's own constructor.
      // The string is an obvious sentinel that has never been a credential.
      return Promise.resolve(createGroqApiKey('sk-SENTINEL-INTEGRATED-NEVER-A-REAL-KEY-0000'));
    },
    openCandidate: (credential) => {
      const apiKey = credential as Parameters<typeof createCandidateGateway>[0]['apiKey'];
      const built = createAccountedSession({
        gateway: createCandidateGateway({
          apiKey,
          transport: observations.observe(ordinary.transport),
        }),
        cancellationGateway: createCandidateGateway({
          apiKey,
          transport: observations.observe(
            createTransportStartHook(cancellation.transport, abort.onTransportStarted),
          ),
        }),
        cancellationController: abort.controller,
        transportStarts: abort.started,
        transportObservations: observations,
        ledger,
        clock: () => '2026-08-12T00:00:00.000Z',
      });
      session = built;
      return Promise.resolve(built);
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
  };

  return {
    deps,
    lines,
    smokeSources: () => smokeSources,
    smokeSourceIdentityMatched: () => handedSource !== undefined && handedSource === receivedSource,
    candidateResolutions: () => candidateResolutions,
    ordinaryEntries: ordinary.entries,
    cancellationEntries: cancellation.entries,
    perCase: (caseId) => session?.invocationsFor(caseId) ?? 0,
    ledgerSnapshot: () => ledger.snapshot(),
    observations: () => observations,
  };
}

const MODEL_REQUIRED = RIYA_SAFETY_FIXTURES.filter(
  (one) => one.executionExpectation === 'MODEL_REQUIRED',
);
const PRE_MODEL = RIYA_SAFETY_FIXTURES.filter(
  (one) => one.executionExpectation === 'PRE_MODEL_REQUIRED',
);

describe('the wired composition charges and counts exactly what it does', () => {
  it('THE SMOKE HARNESS RECEIVES THE EXACT SOURCE THAT WAS COUNTED', async () => {
    // Defect 2. One source, created once, and the object identity proves the harness used THAT one
    // rather than quietly constructing its own.
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);
    expect(run.smokeSources()).toBe(1);
    expect(run.smokeSourceIdentityMatched()).toBe(true);
  });

  it('the candidate credential is resolved once, and only after smoke PASS', async () => {
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);
    expect(run.candidateResolutions()).toBe(1);
  });

  it('SEVEN BOUNDARY CASES COST NOTHING, TEN MODEL CASES COST ONE EACH', async () => {
    // Defects 4 and 5 together. Reservation now happens inside the invoker, so the two cases that
    // build a turn and are refused by the M4 state gate are charged nothing — and the count is per
    // case, so the tenth model-facing case still reports 1 rather than a running total.
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);

    for (const fixture of PRE_MODEL) {
      expect(run.perCase(fixture.fixtureId), fixture.fixtureId).toBe(0);
    }
    for (const fixture of MODEL_REQUIRED) {
      expect(run.perCase(fixture.fixtureId), fixture.fixtureId).toBe(1);
    }
    const snapshot = run.ledgerSnapshot();
    expect(snapshot.smokeRequests).toBe(1);
    // Exactly the ten model-facing cases were charged; the seven boundary cases were not.
    expect(snapshot.safetyProviderRequests).toBe(MODEL_REQUIRED.length);
    expect(MODEL_REQUIRED).toHaveLength(10);
    expect(PRE_MODEL).toHaveLength(7);
  });

  it('THE CANCELLATION CASE USES THE INSTRUMENTED TRANSPORT, AND ONLY IT', async () => {
    // Defect 7. Before this, cancellation shared the ordinary invoker and the transport hook was
    // never reached by a real run.
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);
    expect(run.cancellationEntries()).toBe(1);
    // The other nine model-facing cases went through the ordinary transport.
    expect(run.ordinaryEntries()).toBe(MODEL_REQUIRED.length - 1);
  });

  it('candidate usage is settled, not only the smoke', async () => {
    // Defect 6. Every candidate attempt settles; a transport that returned no parseable usage is
    // priced at the guaranteed bound and the run says so rather than inventing a token count.
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);
    const snapshot = run.ledgerSnapshot();
    expect(snapshot.totalProviderRequests).toBeGreaterThan(1);
    expect(snapshot.inputTokens).toBeGreaterThan(0);
    expect(snapshot.estimatedCostUsd).toBeGreaterThan(0);
    expect(snapshot.usageBoundViolated).toBe(false);
  });

  it('the console stays content-free across the whole wired run', async () => {
    const run = integrated({ smoke: SMOKE_PASS });
    await runCandidateEvidenceOperator(run.deps);
    const output = run.lines.join('\n');
    for (const forbidden of ['sk-', 'Authorization', 'Bearer', 'SENTINEL-', 'modular kitchen']) {
      expect(output, `console must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('HF4-R4 — the WIRED run labels every row from the manifest and classifies every failure', () => {
  const caseLines = (lines: readonly string[]): readonly string[] =>
    lines.filter((line) => line.includes('phase=safety-execution status=CASE'));
  const lineFor = (lines: readonly string[], caseId: string): string =>
    caseLines(lines).find((line) => line.includes(`caseId=${caseId} `)) ?? '';
  const summaryOf = (lines: readonly string[]): string =>
    lines.find((line) => line.includes('phase=safety-execution status=SUMMARY')) ?? '';
  const healthOf = (lines: readonly string[]): string =>
    lines.find((line) => line.includes('status=EXECUTION_HEALTH')) ?? '';

  it('the S5 SHAPE: twelve rows, ten model-facing, two adapter-boundary — never modelRequired=12', async () => {
    // The end-to-end version of the defect. `erased-subject.01` and `human-takeover.01` build a real
    // turn, are refused by the M4 state gate, and emit a row each. Twelve rows; ten model cases.
    const run = integrated({ smoke: SMOKE_PASS, wire: { status: 400 } });
    await runCandidateEvidenceOperator(run.deps);

    expect(caseLines(run.lines)).toHaveLength(12);
    const summary = summaryOf(run.lines);
    expect(summary).toContain('modelRequired=10');
    expect(summary).toContain('preModelRequired=7');
    expect(summary).toContain('executionDiagnosticRows=12');
    expect(summary).toContain('modelRequiredDiagnosticRows=10');
    expect(summary).toContain('preModelRequiredDiagnosticRows=2');
    expect(summary).toContain('providerInvokedCases=10');
    expect(summary).not.toContain('modelRequired=12');
    expect(summary).toContain('unknownLayerDiagnosticRows=0');
  });

  it('every row carries the layer the REAL fixture manifest declares', async () => {
    const run = integrated({ smoke: SMOKE_PASS, wire: { status: 400 } });
    await runCandidateEvidenceOperator(run.deps);

    for (const line of caseLines(run.lines)) {
      const id = /caseId=(\S+)/u.exec(line)?.[1] ?? '';
      const fixture = RIYA_SAFETY_FIXTURES.find((one) => one.request.caseId === id);
      expect(fixture, `${id} must be a governed fixture`).toBeDefined();
      expect(line, id).toContain(`executionLayer=${fixture?.executionExpectation ?? ''}`);
    }
    // Named explicitly, because these are the two the pre-R4 summary silently promoted.
    for (const id of ['riya.safety.erased-subject.01', 'riya.safety.human-takeover.01']) {
      expect(lineFor(run.lines, id)).toContain('executionLayer=PRE_MODEL_REQUIRED');
      expect(lineFor(run.lines, id)).toContain('providerInvocations=0');
      expect(lineFor(run.lines, id)).toContain('providerHttpClass=NOT_REACHED');
    }
  });

  it('a 400 across the wire is named as BAD_REQUEST_400 on every model-facing row', async () => {
    // What RUN S5 could not say. The gateway code is free to stay `provider-failed`; the HTTP class
    // is what distinguishes a rejected request from a revoked key.
    const run = integrated({ smoke: SMOKE_PASS, wire: { status: 400 } });
    await runCandidateEvidenceOperator(run.deps);

    for (const fixture of MODEL_REQUIRED) {
      const line = lineFor(run.lines, fixture.request.caseId);
      expect(line, fixture.fixtureId).toContain('providerTransportStarted=true');
      expect(line, fixture.fixtureId).toContain('providerHttpClass=BAD_REQUEST_400');
      expect(line, fixture.fixtureId).toContain('providerHttpStatus=400');
      expect(run.observations().observationCountFor(fixture.request.caseId)).toBe(1);
    }
    expect(run.observations().unattributedObservations()).toBe(0);
    expect(run.observations().overlappingCaseWindows()).toBe(0);
    expect(healthOf(run.lines)).toContain('executionHealth=INVALID');
  });

  it('the 401 and 403 that S5 could not have distinguished now differ on the row', async () => {
    for (const [status, expected] of [
      [401, 'UNAUTHORIZED_401'],
      [403, 'FORBIDDEN_403'],
      [429, 'RATE_LIMITED_429'],
      [500, 'SERVER_5XX'],
    ] as const) {
      const run = integrated({ smoke: SMOKE_PASS, wire: { status } });
      await runCandidateEvidenceOperator(run.deps);
      const line = lineFor(run.lines, 'riya.safety.override-core.01');
      const label = `HTTP ${String(status)}`;
      expect(line, label).toContain(`providerHttpClass=${expected}`);
      expect(line, label).toContain(`providerHttpStatus=${String(status)}`);
    }
  });

  it('a hostile provider body reaches no line of the wired run', async () => {
    const run = integrated({
      smoke: SMOKE_PASS,
      wire: {
        status: 403,
        bodyText: JSON.stringify({
          error: {
            message: 'key sk-SENTINEL-NEVER-A-REAL-KEY-0000 lacks access',
            type: 'permissions_error',
            code: 'model_permission_blocked_project',
            failed_generation: 'the client asked about a modular kitchen',
          },
        }),
      },
    });
    await runCandidateEvidenceOperator(run.deps);

    const output = run.lines.join('\n');
    // The reviewed code survives; nothing beside it does.
    expect(output).toContain('providerErrorCode=MODEL_PERMISSION_BLOCKED_PROJECT');
    expect(output).toContain('providerErrorType=PERMISSIONS_ERROR');
    for (const forbidden of [
      'sk-',
      'SENTINEL-',
      'lacks access',
      'failed_generation',
      'modular kitchen',
      'Authorization',
      'Bearer',
      'https://',
      'at Object.',
    ]) {
      expect(output, `the wired run must not print ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('no case claims another case observation, and the cancellation claims its own', async () => {
    const run = integrated({ smoke: SMOKE_PASS, wire: { status: 400 } });
    await runCandidateEvidenceOperator(run.deps);

    // Every boundary case: no observation at all, rather than the previous case value.
    for (const fixture of PRE_MODEL) {
      expect(
        run.observations().observationCountFor(fixture.request.caseId),
        fixture.fixtureId,
      ).toBe(0);
      expect(
        run.observations().observationFor(fixture.request.caseId).providerHttpClass,
        fixture.fixtureId,
      ).toBe('NOT_REACHED');
    }
    // The cancellation went through its OWN transport and its observation is its own.
    expect(run.cancellationEntries()).toBe(1);
    expect(run.observations().observationCountFor('riya.safety.cancellation-ignored.01')).toBe(1);
    expect(
      run.observations().observationFor('riya.safety.cancellation-ignored.01')
        .providerTransportStarted,
    ).toBe(true);
  });
});

describe('a failing smoke ends the wired run before the candidate exists', () => {
  it('ONE SOURCE, NO CANDIDATE RESOLUTION, NO SAFETY, NO P10, NO BUNDLE', async () => {
    const run = integrated({ smoke: SMOKE_FAIL });
    const result = await runCandidateEvidenceOperator(run.deps);
    expect(result.outcome).toBe('SMOKE_FAILED');
    expect(run.smokeSources()).toBe(1);
    expect(run.candidateResolutions()).toBe(0);
    expect(run.ordinaryEntries()).toBe(0);
    expect(run.cancellationEntries()).toBe(0);
    expect(result.reviewBundlePath).toBeUndefined();
    expect(run.ledgerSnapshot().safetyProviderRequests).toBe(0);
  });
});

describe('preflight still runs before anything is constructed', () => {
  it('NO SECRET SOURCE IS CREATED WHEN PRECHECK FAILS', async () => {
    // Defect 1, at the composition level rather than the unit level.
    const run = integrated({ smoke: SMOKE_PASS });
    const result = await runCandidateEvidenceOperator({
      ...run.deps,
      preflight: { ...run.deps.preflight, reviewOutputPath: join(REPO_ROOT, 'bundle.json') },
    });
    expect(result.outcome).toBe('PRECHECK_FAILED');
    expect(run.smokeSources()).toBe(0);
    expect(run.candidateResolutions()).toBe(0);
  });
});
