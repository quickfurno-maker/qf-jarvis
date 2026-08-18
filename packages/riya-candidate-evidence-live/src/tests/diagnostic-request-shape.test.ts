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
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
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

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createRequestContractDiagnosticLedger } from '../accounting.js';
import { DIAGNOSTIC_CANARIES } from '../diagnostic-canaries.js';
import type { DiagnosticCanary } from '../diagnostic-canaries.js';
import type { CanaryOutcome } from '../internal/diagnostic-classification.js';
import {
  captureProductionRiyaRequestFor,
  ordinaryModelRequiredRequests,
} from '../diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { measureRequestShape, spanOf } from '../internal/request-shape-inventory.js';
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
const ORDINARY_MODEL_REQUIRED = ordinaryModelRequiredRequests();

/**
 * Every ordinary request, CAPTURED through the production path (HF4-R8-R1).
 *
 * This measurement used to build its own approximation: the real user half through
 * `buildUserContent`, and an EMPTY string for the system half. That understated every size by the
 * whole governed prompt, and — worse — it meant the recipe for a production request lived only in
 * this file, which is precisely why `bin.ts` had no way to build the D7/D8 canaries and shipped
 * without them. One helper now serves both, so the numbers in a receipt and the bytes on the wire
 * come from the same assembled `ModelRequest`.
 */
async function captureAll(): Promise<readonly CapturedProductionRiyaRequest[]> {
  const captures: CapturedProductionRiyaRequest[] = [];
  for (const request of ORDINARY_MODEL_REQUIRED) {
    captures.push(await captureProductionRiyaRequestFor(request));
  }
  return captures;
}

/** The projected document that actually goes on the wire, via the real render + projection. */
function projectedRiyaSchema(raw: unknown): unknown {
  const result = projectGroqStrictJsonSchema(raw);
  if (!result.ok) {
    throw new Error(`the real Riya schema must project: ${result.reason}`);
  }
  return result.schema;
}

describe('R8-C27 — the static request-shape inventory is lengths and counts only', () => {
  let captures: readonly CapturedProductionRiyaRequest[];
  let schema: unknown;
  let first: CapturedProductionRiyaRequest;
  beforeAll(async () => {
    captures = await captureAll();
    const [head] = captures;
    if (head === undefined) {
      throw new Error('the ordinary MODEL_REQUIRED set must not be empty');
    }
    first = head;
    schema = projectedRiyaSchema(head.rawStructuredJsonSchema);
  });

  it('measures the projected Riya schema without carrying it', () => {
    const inventory = measureRequestShape({
      model: CANDIDATE_MODEL_ID,
      messages: first.messages,
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
    expect(serialized).not.toContain(ORDINARY_MODEL_REQUIRED[0]?.syntheticUserText ?? 'x');
    // HF4-R8-R1: the system half is now the REAL governed prompt, not a placeholder, so the
    // measurement finally describes the request production sends.
    expect(inventory.systemMessageChars).toBeGreaterThan(0);
    expect(inventory.roleSequence).toContain('system');
    expect(inventory.roleSequence).toContain('user');
  });

  it('spans all nine ordinary fixtures, so size variance is a measured fact', () => {
    const inventories = captures.map((capture) =>
      measureRequestShape({
        model: CANDIDATE_MODEL_ID,
        messages: capture.messages,
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
    expect(() => projectedRiyaSchema(first.rawStructuredJsonSchema)).not.toThrow();
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
        // HF4-R8-R1: a diagnostic must never reach this at all. R8 called it and threw the session
        // away; the branch now returns before it, so `safetySessions` stays 0.
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
      openDiagnosticCanaryRunner: () =>
        Promise.resolve((canary: DiagnosticCanary) => {
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
    return { lines, outcome: result.outcome, canariesRun, safetySessions };
  }

  it('runs the smoke and all eight canaries, then stops', async () => {
    const run = await runDiagnostic();
    expect(run.outcome).toBe('REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE');
    expect(run.canariesRun).toBe(DIAGNOSTIC_CANARIES.length);
    // The safety turn deps throw if ever touched, so reaching here proves the evaluator was not run.
    expect(run.lines.some((line) => line.includes('phase=safety'))).toBe(false);
    expect(run.lines.some((line) => line.includes('phase=p10'))).toBe(false);
    // R8R1-C5/C6: the ordinary candidate session is never CONSTRUCTED in diagnostic mode, so there
    // is no window in which a safety gateway, a cancellation controller or a second transport
    // observer exists in a run that evaluates nothing.
    expect(run.safetySessions).toBe(0);
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
