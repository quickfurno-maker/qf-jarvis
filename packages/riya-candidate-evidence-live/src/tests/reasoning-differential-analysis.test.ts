/**
 * POST-RSP20B2 — the `reasoning_effort='low'` differential, read OFFLINE.
 *
 * The classifier, the plan, the identity constants, the ledger, the goal and the exit code, asserted
 * before any live authorization is spent on them. MD120B1 recorded why this matters: a classifier
 * nobody can check before the run is a classifier that spends the next one too.
 *
 * The token this vocabulary has that no earlier one did is the SPLIT of the contract-rejection role.
 * `json_validate_failed` means the provider's OUTPUT failed strict validation — the request was
 * accepted and generation ran — so filing it as a request rejection would point the next reader at a
 * contract that was never in question. A 400 carrying any other code is a genuine request rejection
 * and means the opposite: that adding the field changed how the provider reads the request, which
 * would invalidate the differential rather than answer it.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';
import { GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT } from '@qf-jarvis/model-gateway';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';

import {
  createReasoningDifferentialLedger,
  createResponsesDifferentialLedger,
  LEDGER_PHASES,
  REASONING_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  REASONING_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
  REASONING_DIFFERENTIAL_PROBE_REQUESTS,
} from '../accounting.js';
import { CANDIDATE_MAX_COMPLETION_TOKENS, CANDIDATE_MODEL_ID } from '../candidate-release.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  NEUTRAL_CLIENT_STEP_ID,
  planNeutralClientProbe,
  planReasoningDifferentialProbe,
  planResponsesDifferentialProbe,
  REASONING_DIFFERENTIAL_STEP_ID,
  RESPONSES_DIFFERENTIAL_STEP_ID,
} from '../internal/operational-acceptance-plan.js';
import { PROVIDER_OUTCOME_ROLE } from '../internal/provider-outcome-classes.js';
import {
  analyseReasoningDifferential,
  REASONING_DIFFERENTIAL_CLASSIFICATIONS,
} from '../internal/reasoning-differential-classification.js';
import type { ReasoningDifferentialOutcome } from '../internal/reasoning-differential-classification.js';
import { OPERATOR_RUN_GOALS, SECOND_CREDENTIAL_NOTICES } from '../internal/run-goal.js';
import { REUSED_CREDENTIAL_NOTICES } from '../internal/run-goal.js';
import {
  REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
  REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
  REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_MODEL_ID,
  REASONING_FIELD_POSTURES,
} from '../reasoning-differential-identity.js';
import { REASONING_DIFFERENTIAL_OUTPUT_BUDGET } from '../reasoning-differential-port.js';

const MESSAGES = Object.freeze([
  Object.freeze({ role: 'system' as const, content: 'S' }),
  Object.freeze({ role: 'user' as const, content: 'U' }),
]);
const SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'string' } },
  required: ['ok'],
  additionalProperties: false,
});

function outcome(over: Partial<ReasoningDifferentialOutcome> = {}): ReasoningDifferentialOutcome {
  return Object.freeze({
    stepId: REASONING_DIFFERENTIAL_STEP_ID,
    providerTransportStarted: true,
    providerHttpStatus: 200,
    providerHttpClass: 'SUCCESS_2XX' as const,
    providerErrorType: 'NONE' as const,
    providerErrorCode: 'NONE' as const,
    providerCompleted: true,
    localValidationCompleted: true,
    localValidationPassed: true,
    ...over,
  });
}

describe('the identity: one variable, stated against a baseline that carried no field', () => {
  it('records the baseline POSTURE as ABSENT rather than as an effort value', () => {
    // The historical request OMITTED `reasoning_effort`. It did not send `'medium'`. Printing an
    // effort for the baseline would assert a wire fact nobody observed.
    expect(REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE).toBe('ABSENT');
    expect([...REASONING_FIELD_POSTURES]).toStrictEqual(['ABSENT', 'EXPLICIT']);
    expect(REASONING_FIELD_POSTURES).not.toContain('medium');
  });

  it('records the documented default separately, and reads it from the gateway', () => {
    expect(REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT).toBe('medium');
    // Read, never restated: the diagnostic and the adapter cannot disagree about what the baseline
    // was competing against.
    expect(REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT).toBe(
      GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT,
    );
  });

  it('sends exactly low', () => {
    expect(REASONING_DIFFERENTIAL_CANDIDATE_EFFORT).toBe('low');
  });

  it('holds the model, the endpoint and the budget', () => {
    // References, not literals. A separate constant with the same value would be somewhere for the
    // two to drift apart, and "the model did not move" is a property this run rests on.
    expect(REASONING_DIFFERENTIAL_MODEL_ID).toBe(CANDIDATE_MODEL_ID);
    expect(REASONING_DIFFERENTIAL_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(REASONING_DIFFERENTIAL_ENDPOINT_FAMILY).toBe('CHAT_COMPLETIONS');
    // The endpoint is the SAME as the baseline's, unlike the Responses differential.
    expect(REASONING_DIFFERENTIAL_ENDPOINT_FAMILY).toBe(
      REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
    );
    // Held hardest of all: reasoning tokens are drawn from THIS budget.
    //
    // Two different numbers, and conflating them is the mistake worth pinning. The REQUEST budget is
    // the governed 4,096 every earlier gate sent; `CANDIDATE_MAX_COMPLETION_TOKENS` is the model
    // CAPABILITY ceiling the config declares, and it is 65,536. The ledger's fallback bound is the
    // ceiling — which is exactly why an unreported probe produced RSP20B2's 65,622 output total.
    expect(REASONING_DIFFERENTIAL_OUTPUT_BUDGET).toBe(4096);
    expect(REASONING_DIFFERENTIAL_OUTPUT_BUDGET).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65536);
    expect(REASONING_DIFFERENTIAL_OUTPUT_BUDGET).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
  });
});

describe('the plan: the SAME probe as the neutral baseline, relabelled', () => {
  it('carries the identical schema and message objects, not copies', () => {
    const neutral = planNeutralClientProbe({ projectedSchema: SCHEMA, neutralMessages: MESSAGES });
    const reasoning = planReasoningDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    // Reference equality. "Identical to NRA1's request" is then a consequence of the code rather
    // than a claim a reader has to verify by hand.
    expect(reasoning.schema).toBe(neutral.schema);
    expect(reasoning.messages).toBe(neutral.messages);
    expect(reasoning.probeKind).toBe(neutral.probeKind);
    expect(reasoning.messageSource).toBe(neutral.messageSource);
    expect(reasoning.messageSource).toBe('CAPTURED_NEUTRAL_CLIENT');
    expect(reasoning.derivedFromPath).toBe(neutral.derivedFromPath);
  });

  it('overwrites exactly the step id and the dimension label', () => {
    const neutral = planNeutralClientProbe({ projectedSchema: SCHEMA, neutralMessages: MESSAGES });
    const reasoning = planReasoningDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const differing = (Object.keys(reasoning) as (keyof typeof reasoning)[]).filter(
      (key) => reasoning[key] !== neutral[key],
    );
    expect(differing.sort()).toStrictEqual(['probeDimension', 'stepId']);
  });

  it('has its OWN step id, distinct from every earlier one-probe gate', () => {
    expect(REASONING_DIFFERENTIAL_STEP_ID).toBe(
      'R0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW',
    );
    const ids = [
      NEUTRAL_CLIENT_STEP_ID,
      RESPONSES_DIFFERENTIAL_STEP_ID,
      REASONING_DIFFERENTIAL_STEP_ID,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const responses = planResponsesDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    expect(
      planReasoningDifferentialProbe({
        projectedSchema: SCHEMA,
        neutralMessages: MESSAGES,
      }).stepId,
    ).not.toBe(responses.stepId);
  });

  it('refuses a probe with no messages, before a request is spent', () => {
    expect(() =>
      planReasoningDifferentialProbe({ projectedSchema: SCHEMA, neutralMessages: [] }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING');
  });
});

describe('the classifier: json_validate_failed is an OUTPUT failure, not a rejection', () => {
  it('is a closed seven-member vocabulary with no generic bucket', () => {
    expect([...REASONING_DIFFERENTIAL_CLASSIFICATIONS]).toStrictEqual([
      'REASONING_LOW_20B_STRICT_ACCEPTED',
      'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
      'REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED',
      'REASONING_LOW_20B_STRICT_RATE_LIMITED',
      'REASONING_LOW_20B_STRICT_INFRA_INTERRUPTED',
      'REASONING_LOW_20B_STRICT_INCONCLUSIVE',
      'REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED',
    ]);
    // The historical wording is NOT reused: no token here calls anything a plain "rejection".
    expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS).not.toContain(
      'REASONING_LOW_20B_STRICT_PROVIDER_REJECTED',
    );
  });

  it('files a 400 carrying JSON_VALIDATE_FAILED as PROVIDER_OUTPUT_INVALID', () => {
    // THE distinction this classifier exists for. The request was accepted and generation ran; what
    // failed is the provider's own output against the strict schema.
    const analysis = analyseReasoningDifferential(
      outcome({
        providerHttpStatus: 400,
        providerHttpClass: 'BAD_REQUEST_400',
        providerErrorType: 'INVALID_REQUEST_ERROR',
        providerErrorCode: 'JSON_VALIDATE_FAILED',
        providerCompleted: false,
        localValidationCompleted: false,
        localValidationPassed: false,
      }),
    );
    expect(analysis.classification).toBe('REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID');
    // The literal observed fields travel with it, uninterpreted.
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
    expect(analysis.providerHttpStatus).toBe(400);
  });

  it('files a 400 carrying any OTHER code as a genuine REQUEST rejection', () => {
    // A different meaning entirely: that adding the field changed how the provider reads the
    // request, which would invalidate the differential rather than answer it.
    for (const code of ['OTHER_OR_ABSENT', 'BLOCKED_API_ACCESS'] as const) {
      const analysis = analyseReasoningDifferential(
        outcome({
          providerHttpStatus: 400,
          providerHttpClass: 'BAD_REQUEST_400',
          providerErrorType: 'INVALID_REQUEST_ERROR',
          providerErrorCode: code,
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      );
      expect(analysis.classification, code).toBe(
        'REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED',
      );
    }
  });

  it('splits 413 and 422 on the same rule, so the role map stays the single authority', () => {
    for (const httpClass of ['PAYLOAD_TOO_LARGE_413', 'UNPROCESSABLE_422'] as const) {
      expect(PROVIDER_OUTCOME_ROLE[httpClass]).toBe('CONTRACT_REJECTION');
      expect(
        analyseReasoningDifferential(
          outcome({
            providerHttpStatus: httpClass === 'PAYLOAD_TOO_LARGE_413' ? 413 : 422,
            providerHttpClass: httpClass,
            providerErrorCode: 'JSON_VALIDATE_FAILED',
            providerCompleted: false,
            localValidationCompleted: false,
            localValidationPassed: false,
          }),
        ).classification,
      ).toBe('REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID');
    }
  });

  it('accepts ONLY when the provider completed AND the full projector passed', () => {
    expect(analyseReasoningDifferential(outcome()).classification).toBe(
      'REASONING_LOW_20B_STRICT_ACCEPTED',
    );
    // A 2xx alone never reaches ACCEPTED. This is the false-positive the gate exists to be
    // incapable of: a document production would refuse must not read as success.
    expect(
      analyseReasoningDifferential(outcome({ localValidationPassed: false })).classification,
    ).toBe('REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED');
  });

  it('never reports LOCAL_VALIDATION_FAILED for a check that never ran', () => {
    // A 2xx whose provider did not complete carried no readable document, so nothing reached the
    // validator. Saying it failed would be a claim about a check that never happened.
    expect(
      analyseReasoningDifferential(
        outcome({
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification,
    ).toBe('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
  });

  it('files 429 as rate-limited and never as a verdict', () => {
    expect(
      analyseReasoningDifferential(
        outcome({
          providerHttpStatus: 429,
          providerHttpClass: 'RATE_LIMITED_429',
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification,
    ).toBe('REASONING_LOW_20B_STRICT_RATE_LIMITED');
  });

  it('files transport, capacity, cancellation and 5xx as infra-interrupted', () => {
    for (const httpClass of [
      'CAPACITY_498',
      'CANCELLED_499',
      'SERVER_5XX',
      'TRANSPORT_THROW',
      'NOT_REACHED',
    ] as const) {
      expect(
        analyseReasoningDifferential(
          outcome({
            providerHttpStatus: httpClass === 'SERVER_5XX' ? 503 : 0,
            providerHttpClass: httpClass,
            providerCompleted: false,
            localValidationCompleted: false,
            localValidationPassed: false,
          }),
        ).classification,
        httpClass,
      ).toBe('REASONING_LOW_20B_STRICT_INFRA_INTERRUPTED');
    }
  });

  it('keeps credential and permission answers out of every verdict', () => {
    for (const httpClass of [
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'NOT_FOUND_404',
      'OTHER_HTTP',
      'NONE',
    ] as const) {
      expect(
        analyseReasoningDifferential(
          outcome({
            providerHttpStatus: 401,
            providerHttpClass: httpClass,
            providerCompleted: false,
            localValidationCompleted: false,
            localValidationPassed: false,
          }),
        ).classification,
        httpClass,
      ).toBe('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
    }
  });

  it('reads every governed transport class without falling through', () => {
    // Total over the observation vocabulary: a class added upstream cannot reach a verdict here by
    // accident, because the switch has no default branch and the role map is total by type.
    for (const httpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      const analysis = analyseReasoningDifferential(
        outcome({
          providerHttpClass: httpClass,
          providerCompleted: httpClass === 'SUCCESS_2XX',
          localValidationCompleted: httpClass === 'SUCCESS_2XX',
          localValidationPassed: httpClass === 'SUCCESS_2XX',
        }),
      );
      expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS, httpClass).toContain(analysis.classification);
    }
  });

  it('reports INCONCLUSIVE when the probe never ran at all', () => {
    const analysis = analyseReasoningDifferential(undefined);
    expect(analysis.classification).toBe('REASONING_LOW_20B_STRICT_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
    expect(analysis.localValidationCompleted).toBe(false);
  });
});

describe('the goal, exit code and ledger are this run’s own', () => {
  it('adds ONE closed token and moves no earlier goal', () => {
    expect(OPERATOR_RUN_GOALS).toContain('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL');
    // POST-RLD1 appended a successor, so this token is no longer last. What this spec owns is that
    // ITS goal exists exactly once and did not become the default; the exact ORDER of the closed
    // vocabulary is locked once, in operator-sequence.test.ts.
    expect(
      OPERATOR_RUN_GOALS.filter((one) => one === 'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL'),
    ).toHaveLength(1);
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    expect(new Set(OPERATOR_RUN_GOALS).size).toBe(OPERATOR_RUN_GOALS.length);
  });

  it('carries a per-goal notice in BOTH credential tables', () => {
    // An owner is told which bounded run their credential is about to fund, not merely that one is
    // starting — and the clipboard wording must not claim they will be asked again.
    expect(SECOND_CREDENTIAL_NOTICES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL).toContain(
      'reasoning-effort',
    );
    expect(SECOND_CREDENTIAL_NOTICES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL).toContain(
      'Enter the same Groq credential again',
    );
    expect(REUSED_CREDENTIAL_NOTICES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL).toContain(
      'Reusing the credential already read',
    );
  });

  it('takes exit 31, and 0-30 keep meaning exactly what they meant', () => {
    // NOT a reuse of 30. The convention is one integer PER GOAL — which is why 22-30 are nine
    // distinct codes — so a shell reading `$LASTEXITCODE` can tell this run from RSP20B2's.
    expect(OPERATOR_EXIT_CODES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE).toBe(31);
    expect(OPERATOR_EXIT_CODES.POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE).toBe(
      30,
    );
    expect(OPERATOR_EXIT_CODES.POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL_COMPLETE).toBe(29);
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('MAX_PROVIDER_REQUESTS=2 and MAX_COST_USD=1', () => {
    expect(REASONING_DIFFERENTIAL_PROBE_REQUESTS).toBe(1);
    expect(REASONING_DIFFERENTIAL_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(REASONING_DIFFERENTIAL_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('has its OWN counter, and the ledger refuses a third request', () => {
    const ledger = createReasoningDifferentialLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle({ inputTokens: 10, outputTokens: 5 }, true);
    expect(ledger.reserve('reasoning-differential-probe').ok).toBe(true);
    ledger.settle({ inputTokens: 100, outputTokens: 50 }, true);
    const third = ledger.reserve('reasoning-differential-probe');
    expect(third.ok).toBe(false);
    const snapshot = ledger.snapshot();
    expect(snapshot.totalProviderRequests).toBe(2);
    expect(snapshot.smokeRequests).toBe(1);
    expect(snapshot.reasoningDifferentialProbeProviderRequests).toBe(1);
    // No earlier counter moved.
    expect(snapshot.responsesDifferentialProbeProviderRequests).toBe(0);
    expect(snapshot.modelDifferentialProbeProviderRequests).toBe(0);
    expect(snapshot.safetyProviderRequests).toBe(0);
    expect(snapshot.p10ProviderRequests).toBe(0);
  });

  it('is a NEW ledger phase, and RSP20B2’s counter cannot be incremented by this one', () => {
    expect(LEDGER_PHASES).toContain('reasoning-differential-probe');
    expect(new Set(LEDGER_PHASES).size).toBe(LEDGER_PHASES.length);
    const responses = createResponsesDifferentialLedger();
    expect(responses.reserve('smoke').ok).toBe(true);
    responses.settle(undefined, true);
    expect(responses.snapshot().reasoningDifferentialProbeProviderRequests).toBe(0);
  });
});

describe('usage provenance is load-bearing on this ledger', () => {
  it('reports PROVIDER_ONLY when every settlement carried reported usage', () => {
    const ledger = createReasoningDifferentialLedger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 86 }, true);
    ledger.reserve('reasoning-differential-probe');
    // The whole point of this lane's seam: a completed probe settles with what the provider MEASURED.
    ledger.settle({ inputTokens: 1200, outputTokens: 640 }, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.outputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.costIsEstimated).toBe(false);
    expect(snapshot.inputTokens).toBe(1394);
    expect(snapshot.outputTokens).toBe(726);
  });

  it('reports MIXED — never PROVIDER_ONLY — when the probe reported nothing', () => {
    // THE RSP20B2 SHAPE. A bounded figure must never read as a measurement.
    const ledger = createReasoningDifferentialLedger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 86 }, true);
    ledger.reserve('reasoning-differential-probe');
    ledger.settle(undefined, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('MIXED');
    expect(snapshot.outputUsageProvenance).toBe('MIXED');
    expect(snapshot.costIsEstimated).toBe(true);
    expect(snapshot.outputTokens).toBe(86 + CANDIDATE_MAX_COMPLETION_TOKENS);
  });
});
