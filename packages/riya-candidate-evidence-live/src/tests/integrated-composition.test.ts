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
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import type { MaskedSecretSource, SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';
import {
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { afterAll, describe, expect, it } from 'vitest';

import { createOperatorLedger } from '../accounting.js';
import { createAccountedSession } from '../candidate-session.js';
import {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from '../cancellation-transport.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createCandidateGateway } from '../evaluation-gateway.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import { createSafeConsole } from '../safe-console.js';
import { runPreflightForTesting } from '../testing/preflight-testing.js';

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
function fakeTransport(): { readonly transport: GroqTransport; readonly entries: () => number } {
  let entries = 0;
  return {
    transport: {
      send: () => {
        entries += 1;
        return Promise.resolve({
          status: 200,
          bodyText: '{}',
          retryAfterSeconds: null,
        } as Awaited<ReturnType<GroqTransport['send']>>);
      },
    },
    entries: () => entries,
  };
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
function writeSmokeConfig(directory: string): string {
  const path = join(directory, 'groq-smoke-config.json');
  writeFileSync(
    path,
    JSON.stringify({
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
    }),
    'utf8',
  );
  return path;
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
}

function integrated(options: { readonly smoke: SmokeRunResult }): Recorded {
  const lines: string[] = [];
  const dir = externalDir();
  const smokeConfigPath = writeSmokeConfig(dir);
  const ledger = createOperatorLedger();

  let smokeSources = 0;
  let handedSource: MaskedSecretSource | undefined;
  let receivedSource: MaskedSecretSource | undefined;
  let candidateResolutions = 0;

  const ordinary = fakeTransport();
  const cancellation = fakeTransport();
  const abort = createTransportBoundaryAbort();
  let session: ReturnType<typeof createAccountedSession> | undefined;

  // The synthetic configuration cannot hash to the governed digest, so the integrated run uses the
  // TEST-ONLY preflight seam rather than a runtime override on the production contract.
  const syntheticDigest = createHash('sha256').update(readFileSync(smokeConfigPath)).digest('hex');

  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflightOverrideForTesting: (input) => runPreflightForTesting(input, syntheticDigest),
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
        gateway: createCandidateGateway({ apiKey, transport: ordinary.transport }),
        cancellationGateway: createCandidateGateway({
          apiKey,
          transport: createTransportStartHook(cancellation.transport, abort.onTransportStarted),
        }),
        cancellationController: abort.controller,
        transportStarts: abort.started,
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
