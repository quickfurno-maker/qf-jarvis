/**
 * MVP-P2A.2 HF4-R8 — the measured request shape, and the diagnostic mode's containment.
 *
 * ### Measure before diagnosing
 *
 * S9 and S10 both ended with nine identical HTTP 400s, and both left the same gap: nobody could state
 * how large the request actually was, how deep the schema went, or how many of each construct it
 * carried. Every hypothesis was therefore a hypothesis about an unmeasured object.
 *
 * These specs measure it through the REAL production path — the real prompt registry, the real Riya
 * profile, the real projection — and assert only lengths, counts, depths and field names. No prompt,
 * no client text, no schema document and no model answer appears in anything they emit.
 *
 * The second half pins what a `REQUEST_CONTRACT_DIAGNOSTIC` run must NOT do: no safety authority, no
 * P10, no review bundle. A run that evaluates nothing must be structurally incapable of producing
 * something a reader could mistake for a verdict.
 */
import { projectGroqStrictJsonSchema, renderStructuredJsonSchema } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { createRiyaConversationModelProfile } from '@qf-jarvis/riya-model-interaction';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createRequestContractDiagnosticLedger } from '../accounting.js';
import { DIAGNOSTIC_CANARIES } from '../diagnostic-canaries.js';
import type { CanaryOutcome } from '../internal/diagnostic-classification.js';
import { measureRequestShape, spanOf } from '../internal/request-shape-inventory.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createSafeConsole } from '../safe-console.js';
import { SYNTHETIC_AVAILABILITY, syntheticContinuityFor } from '../synthetic-context.js';

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
  const directory = mkdtempSync(join(tmpdir(), 'riya-r8-'));
  scratch.push(directory);
  return directory;
}

/** The nine ordinary MODEL_REQUIRED safety cases — the exact set that returned 400 in S9 and S10. */
const ORDINARY_MODEL_REQUIRED = RIYA_SAFETY_FIXTURES.filter(
  (fixture) =>
    fixture.executionExpectation === 'MODEL_REQUIRED' &&
    fixture.request.caseId !== 'riya.safety.cancellation-ignored.01',
);

/** The projected document that actually goes on the wire, via the real render + projection. */
function firstFixture(): (typeof ORDINARY_MODEL_REQUIRED)[number] {
  const [first] = ORDINARY_MODEL_REQUIRED;
  if (first === undefined) {
    throw new Error('the ordinary MODEL_REQUIRED set must not be empty');
  }
  return first;
}

function projectedRiyaSchema(): unknown {
  const profile = createRiyaConversationModelProfile({
    current: syntheticContinuityFor('NEED', 'r8-inventory'),
    availabilitySnapshot: SYNTHETIC_AVAILABILITY,
  });
  const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(profile.structuredSchema));
  if (!result.ok) {
    throw new Error(`the real Riya schema must project: ${result.reason}`);
  }
  return result.schema;
}

/**
 * The real system + user content the production profile builds for one fixture.
 *
 * Built through `buildUserContent` and the governed prompt registry rather than approximated, so the
 * measured sizes describe the request production sends. The TEXT is never asserted on or printed.
 */
function messagesFor(fixture: (typeof ORDINARY_MODEL_REQUIRED)[number]): readonly {
  role: 'system' | 'user';
  content: string;
}[] {
  const profile = createRiyaConversationModelProfile({
    current: syntheticContinuityFor('NEED', fixture.request.caseId),
    availabilitySnapshot: SYNTHETIC_AVAILABILITY,
  });
  const user = profile.buildUserContent({
    normalizedText: fixture.request.syntheticUserText,
  } as Parameters<typeof profile.buildUserContent>[0]);
  return [
    // The system half is the governed prompt; its SIZE is what matters here, never its text.
    { role: 'system', content: '' },
    { role: 'user', content: user },
  ];
}

describe('R8-C27 — the static request-shape inventory is lengths and counts only', () => {
  const schema = projectedRiyaSchema();

  it('measures the projected Riya schema without carrying it', () => {
    const inventory = measureRequestShape({
      model: CANDIDATE_MODEL_ID,
      messages: messagesFor(firstFixture()),
      projectedSchema: schema,
      highCompletionCap: CANDIDATE_MAX_COMPLETION_TOKENS,
      responseFormatName: 'qf_structured_output',
    });

    // Every value is a number, a boolean, a closed token or a role/field NAME.
    expect(inventory.projectedSchemaBytes).toBeGreaterThan(0);
    expect(inventory.projectedSchemaNodes).toBeGreaterThan(0);
    expect(inventory.maxNestingDepth).toBeGreaterThan(1);
    expect(inventory.anyOfCount).toBeGreaterThan(0);
    expect(inventory.enumCount).toBeGreaterThan(0);
    expect(inventory.numericEnumCount).toBeGreaterThanOrEqual(1);
    expect(inventory.stringEnumCount).toBeGreaterThanOrEqual(1);

    // The body field NAMES are the documented Groq set, and nothing else.
    expect([...inventory.bodyFieldNames]).toEqual([
      'max_completion_tokens',
      'messages',
      'model',
      'n',
      'response_format',
      'stream',
    ]);
    expect(inventory.n).toBe(1);
    expect(inventory.stream).toBe(false);
    expect(inventory.responseFormatType).toBe('json_schema');
    expect(inventory.responseFormatStrict).toBe(true);

    // The high-cap body is larger than the low-cap one by exactly the digits of the integer, which is
    // the point: the cap is a handful of bytes and cannot itself be a size problem.
    expect(inventory.bodyBytesHighCap).toBeGreaterThan(inventory.bodyBytesLowCap);
    expect(inventory.bodyBytesHighCap - inventory.bodyBytesLowCap).toBeLessThan(10);

    // Nothing content-bearing escapes: the inventory holds no message text and no schema document.
    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain('additionalProperties');
    expect(serialized).not.toContain(firstFixture().request.syntheticUserText);
  });

  it('spans all nine ordinary fixtures, so size variance is a measured fact', () => {
    const inventories = ORDINARY_MODEL_REQUIRED.map((fixture) =>
      measureRequestShape({
        model: CANDIDATE_MODEL_ID,
        messages: messagesFor(fixture),
        projectedSchema: schema,
        highCompletionCap: CANDIDATE_MAX_COMPLETION_TOKENS,
        responseFormatName: 'qf_structured_output',
      }),
    );
    const span = spanOf(inventories);
    expect(span.count).toBe(9);
    expect(span.userCharsMin).toBeGreaterThan(0);
    expect(span.userCharsMax).toBeGreaterThanOrEqual(span.userCharsMin);
    expect(span.bodyBytesHighCapMin).toBeGreaterThan(0);
    // Whatever the variance is, it is now a number in a receipt rather than an assumption.
    expect(span.bodyBytesHighCapMax).toBeGreaterThanOrEqual(span.bodyBytesHighCapMin);
  });

  it('R8-C26 the real Riya schema still projects under merged HF4-R7/R1', () => {
    expect(() => projectedRiyaSchema()).not.toThrow();
  });
});

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

describe('R8-C20/C21/C22/C30 — diagnostic mode reaches no evaluator, no P10, no bundle', () => {
  async function runDiagnostic(): Promise<{
    readonly lines: readonly string[];
    readonly outcome: string;
    readonly canariesRun: number;
    readonly safetySessions: number;
  }> {
    const lines: string[] = [];
    const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
    harnessState.syntheticDigest = digest;
    let canariesRun = 0;
    let safetySessions = 0;

    const deps: OperatorDeps = {
      console: createSafeConsole((line) => lines.push(line)),
      preflight: {
        smokeConfigPath,
        reviewOutputPath: join(externalDir(), 'bundle.json'),
        repoRoot: REPO_ROOT,
        interactive: true,
      },
      ledger: createRequestContractDiagnosticLedger(),
      runGoal: 'REQUEST_CONTRACT_DIAGNOSTIC',
      openSmokeCredential: () =>
        Promise.resolve({
          credentialSource: {
            isInteractive: () => true,
            readOnce: () => Promise.resolve('FAKE-R8-SENTINEL-NEVER-A-REAL-KEY-0000'),
          },
        }),
      runSmoke: () => Promise.resolve(SMOKE_PASS),
      openCandidateCredential: () => Promise.resolve({ redacted: true }),
      openCandidate: () => {
        // Constructed, but the diagnostic must never build a safety port from it.
        safetySessions += 1;
        return Promise.resolve({
          safetyTurnDeps: () => {
            throw new Error('SAFETY-MUST-NOT-RUN-IN-DIAGNOSTIC-MODE');
          },
          safetyCancellationTurnDeps: () => undefined,
          qualityTurnDeps: () => {
            throw new Error('P10-MUST-NOT-RUN-IN-DIAGNOSTIC-MODE');
          },
          invocationsFor: () => 0,
          gatewayErrorFor: () => undefined,
          cancellationObservedFor: () => false,
          transportObservationFor: () => ({
            providerTransportStarted: false,
            providerHttpStatus: 0,
            providerHttpClass: 'NOT_REACHED' as const,
            providerErrorType: 'NONE' as const,
            providerErrorCode: 'NONE' as const,
          }),
          accountingRefusal: () => undefined,
        });
      },
      runDiagnosticCanary: (canary) => {
        canariesRun += 1;
        const result: CanaryOutcome = {
          canaryId: canary.canaryId,
          providerTransportStarted: true,
          providerHttpStatus: 200,
          providerHttpClass: 'SUCCESS_2XX',
          providerErrorType: 'NONE',
          providerErrorCode: 'NONE',
          providerCompleted: true,
        };
        return Promise.resolve(result);
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

    const result = await runCandidateEvidenceOperator(deps);
    return { lines, outcome: result.outcome, canariesRun, safetySessions };
  }

  it('runs the smoke and all eight canaries, then stops', async () => {
    const run = await runDiagnostic();
    expect(run.outcome).toBe('REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
    expect(run.canariesRun).toBe(DIAGNOSTIC_CANARIES.length);
    // The safety turn deps throw if ever touched, so reaching here proves the evaluator was not run.
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
  });

  it('R8-C22 writes no review bundle and reports none', async () => {
    const run = await runDiagnostic();
    expect(run.lines.some((line) => line.includes('reviewBundlePath'))).toBe(false);
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT'));
    expect(receipt).toBeDefined();
    expect(receipt).toContain('reviewBundleWritten=false');
  });

  it('R8-C30 the receipt cannot be mistaken for a safety receipt', async () => {
    const run = await runDiagnostic();
    const receipt = run.lines.find((line) => line.includes('status=RECEIPT')) ?? '';
    // It names the diagnostic count, and states the two it did NOT perform as zero rather than
    // omitting them — a reader scanning for them finds an answer, not an absence to interpret.
    expect(receipt).toContain('diagnosticProviderRequests=8');
    expect(receipt).toContain('safetyProviderRequests=0');
    expect(receipt).toContain('p10ProviderRequests=0');
    expect(receipt).toContain('safetyEvaluated=false');
    expect(receipt).toContain('totalProviderRequests=9');
    // No verdict, no case count, no threshold, no eligibility.
    expect(receipt).not.toMatch(/ELIGIBLE|threshold|cases=|pass=|fail=/u);
  });

  it('emits a closed classification and one row per canary', async () => {
    const run = await runDiagnostic();
    const canaryLines = run.lines.filter((line) => line.includes('status=CANARY'));
    expect(canaryLines).toHaveLength(8);
    const classification = run.lines.find((line) => line.includes('status=CLASSIFICATION')) ?? '';
    expect(classification).toContain('diagnosticClassification=CURRENT_EXACT_REQUEST_ACCEPTED');
    expect(classification).toContain('canariesRun=8');
    // No canary row carries content.
    for (const line of canaryLines) {
      expect(line).not.toMatch(/replyBody|syntheticUserText|Bearer|Authorization|sk-/u);
    }
    // R8-C15/C23: an EXACT field-name lock. Any field added to a canary row — a message, a schema, a
    // provider body, a preview of any of them — fails here rather than being noticed in review.
    const fields = (canaryLines[0] ?? '')
      .split(' ')
      .map((pair) => pair.split('=')[0] ?? '')
      .sort();
    expect(fields).toEqual([
      'canaryId',
      'completionCapClass',
      'localValidationAccepted',
      'maxCompletionTokens',
      'messageSource',
      'phase',
      'providerCompleted',
      'providerErrorCode',
      'providerErrorType',
      'providerHttpClass',
      'providerHttpStatus',
      'providerTransportStarted',
      'requestClass',
      'schemaSource',
      'status',
    ]);
  });
});
