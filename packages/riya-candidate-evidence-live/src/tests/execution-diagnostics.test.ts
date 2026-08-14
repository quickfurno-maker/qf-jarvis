/**
 * MVP-P2A.2 HF4 — execution diagnostics, provider accounting, and the S2-B arithmetic.
 *
 * ### Why this file exists
 *
 * RUN S2-B reported fifteen safety PASS and two FAIL, which reads like a statement about GPT-OSS 20B.
 * It is not one. The receipt showed 1,310,914 input and 655,442 output tokens, and those numbers are
 * exactly ten fallback maxima plus a 194/82 smoke — meaning NONE of the ten MODEL_REQUIRED attempts
 * returned usable usage facts. A negative-constraint case ("did not leak the secret") passes
 * vacuously when no answer was produced at all, so a broken execution path can read as a passing
 * model.
 *
 * The receipt could not distinguish "ten gateway failures" from "ten responses that omitted usage",
 * and the per-case record could not say which layer refused. Both are fixed, and both are pinned here.
 *
 * ### On the cross-package proof, honestly
 *
 * There is no package that can import BOTH the rendered Riya schemas and the Groq checker without a
 * new dependency: this one has neither `zod` nor a reason to gain it, and coupling the Riya contract
 * to a provider package is the wrong direction. So the two sides are enforced INDEPENDENTLY —
 * `provider-schema-parity.test.ts` walks the rendered schemas with its own checker, and
 * `groq-strict-schema.test.ts` pins the gateway checker against hand-built cases including the exact
 * pre-HF4 shape. Neither trusts the other, which is a weaker end-to-end claim than a single
 * composed assertion but a stronger one about each half.
 */
import { describe, expect, it } from 'vitest';

import type { CandidateExecutionDiagnostic } from '../candidate-ports.js';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
} from '../candidate-release.js';
import { createSafetyReplicationLedger, SAFETY_MODEL_REQUIRED_REQUESTS } from '../accounting.js';
import {
  emitExecutionDiagnostics,
  emitSafetyReplicationReceipt,
} from '../internal/safety-diagnostics.js';
import { createSafeConsole } from '../safe-console.js';

describe('THE S2-B RECEIPT ARITHMETIC, PINNED', () => {
  it('ten failed candidate settlements plus a 194/82 smoke reproduce 1310914 / 655442 EXACTLY', () => {
    // Reproduced from the governed constants, never from hard-coded totals, so a change to the
    // declared maxima moves this test rather than silently invalidating the interpretation.
    const ledger = createSafetyReplicationLedger();

    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 82 }, true);

    for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
      ledger.reserve('safety');
      // `undefined` usage and a failed attempt — precisely what the live run recorded ten times.
      ledger.settle(undefined, false);
    }

    const snapshot = ledger.snapshot();
    const candidateFallbackInput = SAFETY_MODEL_REQUIRED_REQUESTS * CANDIDATE_MAX_INPUT_TOKENS;
    const candidateFallbackOutput =
      SAFETY_MODEL_REQUIRED_REQUESTS * CANDIDATE_MAX_COMPLETION_TOKENS;

    expect(candidateFallbackInput).toBe(1_310_720);
    expect(candidateFallbackOutput).toBe(655_360);
    expect(snapshot.inputTokens).toBe(1_310_914);
    expect(snapshot.outputTokens).toBe(655_442);
    expect(snapshot.inputTokens - candidateFallbackInput).toBe(194);
    expect(snapshot.outputTokens - candidateFallbackOutput).toBe(82);

    // The flag that says so. These totals are an ACCOUNTING BOUND, not measured model consumption:
    // ten candidate attempts had no usable usage facts and were priced from the fallback maxima.
    expect(snapshot.costIsEstimated).toBe(true);
    expect(snapshot.successfulProviderResponses).toBe(1);
    expect(snapshot.providerFailures).toBe(10);
  });

  it('the settled count reconciles with the reserved count', () => {
    const ledger = createSafetyReplicationLedger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 1, outputTokens: 1 }, true);
    for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
      ledger.reserve('safety');
      ledger.settle(undefined, false);
    }
    const snapshot = ledger.snapshot();
    expect(snapshot.successfulProviderResponses + snapshot.providerFailures).toBe(
      snapshot.totalProviderRequests,
    );
  });
});

describe('THE RECEIPT MAKES THE TWO FAILURE CLASSES DISTINGUISHABLE', () => {
  const receiptFor = (
    settle: (ledger: ReturnType<typeof createSafetyReplicationLedger>) => void,
  ) => {
    const ledger = createSafetyReplicationLedger();
    settle(ledger);
    const lines: string[] = [];
    emitSafetyReplicationReceipt(
      createSafeConsole((line) => lines.push(line)),
      ledger.snapshot(),
    );
    return lines[0] ?? '';
  };

  it('CLASS B — smoke succeeded, every candidate call failed', () => {
    const receipt = receiptFor((ledger) => {
      ledger.reserve('smoke');
      ledger.settle({ inputTokens: 194, outputTokens: 82 }, true);
      for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
        ledger.reserve('safety');
        ledger.settle(undefined, false);
      }
    });
    expect(receipt).toContain('successfulProviderResponses=1');
    expect(receipt).toContain('providerFailures=10');
    expect(receipt).toContain('totalProviderRequests=11');
    expect(receipt).toContain('p10ProviderRequests=0');
  });

  it('CLASS A — every call returned a response, so the same totals mean something else entirely', () => {
    const receipt = receiptFor((ledger) => {
      ledger.reserve('smoke');
      ledger.settle({ inputTokens: 194, outputTokens: 82 }, true);
      for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
        ledger.reserve('safety');
        // A SUCCESSFUL response that simply carried no usage facts — indistinguishable from the case
        // above on token totals alone, which is exactly why the counters had to be printed.
        ledger.settle(undefined, true);
      }
    });
    expect(receipt).toContain('successfulProviderResponses=11');
    expect(receipt).toContain('providerFailures=0');
  });

  it('the receipt carries no content of any kind', () => {
    const receipt = receiptFor((ledger) => {
      ledger.reserve('smoke');
      ledger.settle({ inputTokens: 1, outputTokens: 1 }, true);
    });
    for (const forbidden of [
      'SENTINEL-',
      'sk-',
      'Authorization',
      'Bearer',
      'apiKey',
      'GROQ_API_KEY',
      'https://',
      'at Object.',
    ]) {
      expect(receipt, `receipt must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('THE PER-CASE EXECUTION DIAGNOSTIC DISTINGUISHES THE FOUR LAYERS', () => {
  const emit = (diagnostics: Parameters<typeof emitExecutionDiagnostics>[1]): string[] => {
    const lines: string[] = [];
    emitExecutionDiagnostics(
      createSafeConsole((line) => lines.push(line)),
      diagnostics,
    );
    return lines;
  };

  const base: CandidateExecutionDiagnostic = {
    caseId: 'riya.safety.example.01',
    providerInvocations: 1,
    executionOutcome: 'REFUSED',
    gatewayInvoked: true,
    adapterReason: 'model-gateway-refused',
    gatewayErrorCode: 'provider-failed',
    structuredOutputWellFormed: false,
    structuredFieldCount: 0,
    citationCount: 0,
    knowledgeUse: 'NONE',
    claimKind: 'NO_CLAIMS',
    authorityTreatment: 'ADVISORY_ONLY',
    continuedAfterCancellation: false,
  };

  it('A — a GATEWAY failure names the closed gateway code', () => {
    const [line] = emit([base]);
    expect(line).toContain('phase=safety-execution status=CASE');
    expect(line).toContain('gatewayErrorCode=provider-failed');
    expect(line).toContain('adapterReason=model-gateway-refused');
    expect(line).toContain('structuredOutputWellFormed=false');
    expect(line).toContain('providerInvocations=1');
  });

  it('B — a response the ADAPTER refused has no gateway error at all', () => {
    // The distinction RUN S2-B could not make: the provider answered, and the local profile rejected
    // what it said. Completely different diagnosis from A, identical token totals.
    const [line] = emit([
      {
        ...base,
        adapterReason: 'model-structured-output-invalid',
        gatewayErrorCode: 'NONE',
      },
    ]);
    expect(line).toContain('gatewayErrorCode=NONE');
    expect(line).toContain('adapterReason=model-structured-output-invalid');
  });

  it('C — an ACCEPTED reply', () => {
    const [line] = emit([
      {
        ...base,
        executionOutcome: 'REPLIED',
        adapterReason: 'model-adapter-completed',
        gatewayErrorCode: 'NONE',
        structuredOutputWellFormed: true,
        structuredFieldCount: 3,
        citationCount: 1,
        knowledgeUse: 'CURRENT',
        claimKind: 'GROUNDED_CLAIMS',
      },
    ]);
    expect(line).toContain('executionOutcome=REPLIED');
    expect(line).toContain('adapterReason=model-adapter-completed');
    expect(line).toContain('structuredOutputWellFormed=true');
    expect(line).toContain('citationCount=1');
  });

  it('D — a NON-GATEWAY throw normalises to a closed code, never a message', () => {
    const [line] = emit([{ ...base, gatewayErrorCode: 'internal-invariant' }]);
    expect(line).toContain('gatewayErrorCode=internal-invariant');
  });

  it('E — a case that never reached the provider reports zero invocations, not a failure', () => {
    const [line] = emit([
      {
        ...base,
        providerInvocations: 0,
        executionOutcome: 'NOT_ADMITTED',
        gatewayInvoked: false,
        adapterReason: 'model-state-blocked',
        gatewayErrorCode: 'NONE',
      },
    ]);
    expect(line).toContain('providerInvocations=0');
    expect(line).toContain('gatewayInvoked=false');
    expect(line).toContain('gatewayErrorCode=NONE');
  });

  it('F — a governed CANCELLATION is not relabelled as an arbitrary provider failure', () => {
    const [line] = emit([
      {
        ...base,
        executionOutcome: 'CANCELLED',
        adapterReason: 'model-cancelled',
        gatewayErrorCode: 'NONE',
        continuedAfterCancellation: false,
      },
    ]);
    expect(line).toContain('executionOutcome=CANCELLED');
    expect(line).toContain('adapterReason=model-cancelled');
    expect(line).not.toContain('provider-failed');
  });

  it('the SUMMARY aggregates the layers, and warns when nothing was accepted', () => {
    const lines = emit([base, base, { ...base, gatewayErrorCode: 'NONE' }]);
    const summary = lines.find((line) => line.includes('status=SUMMARY')) ?? '';
    expect(summary).toContain('modelRequired=3');
    expect(summary).toContain('gatewayFailures=2');
    expect(summary).toContain('gatewayResponses=1');
    expect(summary).toContain('acceptedReplies=0');
    // The statement that stops a vacuous pass being read as a model result.
    expect(lines.join('\n')).toContain(
      'SAFETY_VERDICT_NOT_INTERPRETABLE_AS_MODEL_QUALITY_WITHOUT_EXECUTION_HEALTH',
    );
  });

  it('the warning is ABSENT when replies were accepted', () => {
    const lines = emit([{ ...base, structuredOutputWellFormed: true, gatewayErrorCode: 'NONE' }]);
    expect(lines.join('\n')).not.toContain('EVIDENCE_VALIDITY');
  });

  it('no diagnostic line carries content', () => {
    const lines = emit([base]).join('\n');
    for (const forbidden of [
      'SENTINEL-',
      'sk-',
      'Authorization',
      'Bearer',
      'apiKey',
      'GROQ_API_KEY',
      'https://',
      'at Object.',
      'replyBody',
    ]) {
      expect(lines, `diagnostics must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('HF4-R1 — the diagnostic vocabularies are CLOSED IN THE TYPE, not only in prose', () => {
  // Owner review caught this: the fields were documented as closed and typed as `string`, so a
  // benign constant or a raw provider message would have compiled. A comment is not a contract.
  //
  // These assertions are compile-time. The `@ts-expect-error` directives are the real test — if the
  // fields were ever widened back to `string`, the directives would become unused and `tsc` fails.
  type AdapterReason = CandidateExecutionDiagnostic['adapterReason'];
  type GatewayCode = CandidateExecutionDiagnostic['gatewayErrorCode'];

  it('accepts members of the real closed vocabularies', () => {
    const completed: AdapterReason = 'model-adapter-completed';
    const refused: AdapterReason = 'model-gateway-refused';
    const invalid: AdapterReason = 'model-structured-output-invalid';
    const cancelled: AdapterReason = 'model-cancelled';
    const providerFailed: GatewayCode = 'provider-failed';
    const invariant: GatewayCode = 'internal-invariant';
    // The sentinel meaning "the gateway returned a response".
    const none: GatewayCode = 'NONE';

    expect([completed, refused, invalid, cancelled]).toHaveLength(4);
    expect([providerFailed, invariant, none]).toHaveLength(3);
  });

  it('REFUSES an arbitrary string at compile time', () => {
    // @ts-expect-error an arbitrary value is not a closed adapter reason
    const badAdapter: AdapterReason = 'arbitrary-provider-message';
    // @ts-expect-error raw error text is not a closed gateway code
    const badGateway: GatewayCode = 'raw-http-400-body';
    // @ts-expect-error a plausible-looking invention is still not in the vocabulary
    const invented: AdapterReason = 'model-looks-fine';

    expect([badAdapter, badGateway, invented]).toHaveLength(3);
  });
});
