/**
 * POST-RBD1 — the best-effort `json_schema` (strict=false) differential, read OFFLINE.
 *
 * The classifier, the plan, the identity constants, the ledger, the goal and the exit code, asserted
 * before any live authorization is spent on them.
 *
 * Three things this spec guards that the earlier ones did not need:
 *
 * 1. **RLD1 and RBD1 are both CONSUMED.** Their vocabularies, step ids, exit codes and counters are
 *    immutable evidence, so this file asserts they are untouched as well as asserting its own.
 * 2. **The mode did NOT change.** Both sides send `json_schema` with the same schema — the single
 *    most likely misreading of this run is that it turned structured output off.
 * 3. **Neither prior failure's usage was observed**, and truncation was never proven at either
 *    budget, so both facts are first-class constants pinned `false`.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';

import {
  createReasoningBudget8192Ledger,
  createStrictFalseLedger,
  LEDGER_PHASES,
  STRICT_FALSE_MAX_ESTIMATED_COST_USD,
  STRICT_FALSE_MAX_PROVIDER_REQUESTS,
  STRICT_FALSE_PROBE_REQUESTS,
} from '../accounting.js';
import { CANDIDATE_MAX_COMPLETION_TOKENS, CANDIDATE_MODEL_ID } from '../candidate-release.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  planNeutralClientProbe,
  planReasoningBudget8192Probe,
  planStrictFalseDifferentialProbe,
  REASONING_BUDGET_8192_STEP_ID,
  REASONING_DIFFERENTIAL_STEP_ID,
  STRICT_FALSE_DIFFERENTIAL_STEP_ID,
} from '../internal/operational-acceptance-plan.js';
import { PROVIDER_OUTCOME_ROLE } from '../internal/provider-outcome-classes.js';
import { REASONING_BUDGET_8192_CLASSIFICATIONS } from '../internal/reasoning-budget-8192-classification.js';
import { REASONING_DIFFERENTIAL_CLASSIFICATIONS } from '../internal/reasoning-differential-classification.js';
import {
  analyseStrictFalseDifferential,
  STRICT_FALSE_CLASSIFICATIONS,
} from '../internal/strict-false-differential-classification.js';
import type { StrictFalseOutcome } from '../internal/strict-false-differential-classification.js';
import {
  OPERATOR_RUN_GOALS,
  REUSED_CREDENTIAL_NOTICES,
  SECOND_CREDENTIAL_NOTICES,
} from '../internal/run-goal.js';
import { REASONING_BUDGET_8192_CANDIDATE_BUDGET } from '../reasoning-budget-8192-identity.js';
import { REASONING_DIFFERENTIAL_CANDIDATE_EFFORT } from '../reasoning-differential-identity.js';
import {
  PRIOR_FAILED_PROBE_USAGE_OBSERVED,
  PRIOR_TRUNCATION_PROVEN,
  PRODUCTION_NON_STRICT_FALLBACK_MODE,
  STRICT_FALSE_BASELINE_CLASSIFICATION,
  STRICT_FALSE_BASELINE_STRICT,
  STRICT_FALSE_BASELINE_STRUCTURED_MODE,
  STRICT_FALSE_CANDIDATE_STRICT,
  STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
  STRICT_FALSE_COMPLETION_BUDGET,
  STRICT_FALSE_ENDPOINT_FAMILY,
  STRICT_FALSE_MODEL_ID,
  STRICT_FALSE_REASONING_EFFORT,
} from '../strict-false-differential-identity.js';
import { STRICT_FALSE_OUTPUT_BUDGET } from '../strict-false-differential-port.js';

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

function outcome(over: Partial<StrictFalseOutcome> = {}): StrictFalseOutcome {
  return Object.freeze({
    stepId: STRICT_FALSE_DIFFERENTIAL_STEP_ID,
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

describe('the identity: the strict flag moves, the MODE does not', () => {
  it('keeps json_schema mode on BOTH sides — this is not a mode change', () => {
    // The most likely misreading of this run is that it turned structured output off. It did not.
    expect(STRICT_FALSE_BASELINE_STRUCTURED_MODE).toBe('json_schema');
    expect(STRICT_FALSE_CANDIDATE_STRUCTURED_MODE).toBe('json_schema');
    expect(STRICT_FALSE_CANDIDATE_STRUCTURED_MODE).toBe(STRICT_FALSE_BASELINE_STRUCTURED_MODE);
  });

  it('flips exactly the strict flag', () => {
    expect(STRICT_FALSE_BASELINE_STRICT).toBe(true);
    expect(STRICT_FALSE_CANDIDATE_STRICT).toBe(false);
  });

  it('records what production’s non-strict branch would have sent instead', () => {
    // `buildResponseFormat(schema, false)` returns json_object, which drops the schema. Recorded so
    // the trap is visible on the receipt rather than something a reader has to take on trust.
    expect(PRODUCTION_NON_STRICT_FALLBACK_MODE).toBe('json_object');
    expect(PRODUCTION_NON_STRICT_FALLBACK_MODE).not.toBe(STRICT_FALSE_CANDIDATE_STRUCTURED_MODE);
  });

  it('holds the effort and the budget, reading both from RBD1’s own constants', () => {
    expect(STRICT_FALSE_REASONING_EFFORT).toBe('low');
    expect(STRICT_FALSE_REASONING_EFFORT).toBe(REASONING_DIFFERENTIAL_CANDIDATE_EFFORT);
    expect(STRICT_FALSE_COMPLETION_BUDGET).toBe(8192);
    expect(STRICT_FALSE_COMPLETION_BUDGET).toBe(REASONING_BUDGET_8192_CANDIDATE_BUDGET);
    expect(STRICT_FALSE_OUTPUT_BUDGET).toBe(STRICT_FALSE_COMPLETION_BUDGET);
  });

  it('holds the model and the endpoint', () => {
    expect(STRICT_FALSE_MODEL_ID).toBe(CANDIDATE_MODEL_ID);
    expect(STRICT_FALSE_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(STRICT_FALSE_ENDPOINT_FAMILY).toBe('CHAT_COMPLETIONS');
  });

  it('does NOT move the production budget, and stays inside the capability ceiling', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(STRICT_FALSE_COMPLETION_BUDGET).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65536);
    expect(STRICT_FALSE_COMPLETION_BUDGET).toBeLessThan(CANDIDATE_MAX_COMPLETION_TOKENS);
  });

  it('records what RBD1 observed, and what neither prior run established', () => {
    expect(STRICT_FALSE_BASELINE_CLASSIFICATION).toBe(
      'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID',
    );
    // Both prior failed probes settled from the ledger's CONFIGURED CEILINGS, so their totals were
    // bounds. Nobody observed either one's usage, and truncation was never proven at either budget.
    expect(PRIOR_FAILED_PROBE_USAGE_OBSERVED).toBe(false);
    expect(PRIOR_TRUNCATION_PROVEN).toBe(false);
  });
});

describe('the plan: the SAME probe as RBD1, relabelled', () => {
  it('carries the identical schema and message objects, not copies', () => {
    const neutral = planNeutralClientProbe({ projectedSchema: SCHEMA, neutralMessages: MESSAGES });
    const strictFalse = planStrictFalseDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    expect(strictFalse.schema).toBe(neutral.schema);
    expect(strictFalse.messages).toBe(neutral.messages);
    expect(strictFalse.messageSource).toBe('CAPTURED_NEUTRAL_CLIENT');
  });

  it('differs from the RBD1 probe in exactly the step id and the dimension label', () => {
    const rbd1 = planReasoningBudget8192Probe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const strictFalse = planStrictFalseDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const differing = (Object.keys(strictFalse) as (keyof typeof strictFalse)[]).filter(
      (key) => strictFalse[key] !== rbd1[key],
    );
    expect(differing.sort()).toStrictEqual(['probeDimension', 'stepId']);
    expect(strictFalse.schema).toBe(rbd1.schema);
    expect(strictFalse.messages).toBe(rbd1.messages);
  });

  it('has its OWN step id, and the two prior runs keep theirs', () => {
    expect(STRICT_FALSE_DIFFERENTIAL_STEP_ID).toBe(
      'S0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192_STRICT_FALSE',
    );
    // Both CONSUMED. Their identifiers are immutable evidence.
    expect(REASONING_DIFFERENTIAL_STEP_ID).toBe(
      'R0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW',
    );
    expect(REASONING_BUDGET_8192_STEP_ID).toBe(
      'B0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192',
    );
    const ids = [
      REASONING_DIFFERENTIAL_STEP_ID,
      REASONING_BUDGET_8192_STEP_ID,
      STRICT_FALSE_DIFFERENTIAL_STEP_ID,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a probe with no messages, before a request is spent', () => {
    expect(() =>
      planStrictFalseDifferentialProbe({ projectedSchema: SCHEMA, neutralMessages: [] }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING');
  });
});

describe('the classifier', () => {
  it('is a closed seven-member vocabulary', () => {
    expect([...STRICT_FALSE_CLASSIFICATIONS]).toStrictEqual([
      'REASONING_LOW_8192_BEST_EFFORT_ACCEPTED',
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID',
      'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
      'REASONING_LOW_8192_BEST_EFFORT_RATE_LIMITED',
      'REASONING_LOW_8192_BEST_EFFORT_INFRA_INTERRUPTED',
      'REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE',
      'REASONING_LOW_8192_BEST_EFFORT_LOCAL_VALIDATION_FAILED',
    ]);
  });

  it('leaves BOTH prior vocabularies byte-identical and shares no token with either', () => {
    // RLD1 and RBD1 are CONSUMED; their receipts name these tokens.
    expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS).toHaveLength(7);
    expect(REASONING_BUDGET_8192_CLASSIFICATIONS).toHaveLength(7);
    expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS[0]).toBe('REASONING_LOW_20B_STRICT_ACCEPTED');
    expect(REASONING_BUDGET_8192_CLASSIFICATIONS[0]).toBe('REASONING_LOW_8192_STRICT_ACCEPTED');
    for (const token of STRICT_FALSE_CLASSIFICATIONS) {
      expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS, token).not.toContain(token);
      expect(REASONING_BUDGET_8192_CLASSIFICATIONS, token).not.toContain(token);
    }
  });

  it('files json_validate_failed as an OUTPUT failure — a REAL best-effort outcome', () => {
    // Groq documents that best-effort mode may still refuse a document that fails the schema. That
    // is an experimental result, not a request rejection, and must not be relabelled as one.
    const analysis = analyseStrictFalseDifferential(
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
    expect(analysis.classification).toBe('REASONING_LOW_8192_BEST_EFFORT_PROVIDER_OUTPUT_INVALID');
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
  });

  it('files a 400 or 413 with any OTHER code as a REQUEST rejection', () => {
    for (const [httpClass, status] of [
      ['BAD_REQUEST_400', 400],
      ['PAYLOAD_TOO_LARGE_413', 413],
      ['UNPROCESSABLE_422', 422],
    ] as const) {
      const analysis = analyseStrictFalseDifferential(
        outcome({
          providerHttpStatus: status,
          providerHttpClass: httpClass,
          providerErrorType: 'INVALID_REQUEST_ERROR',
          providerErrorCode: 'OTHER_OR_ABSENT',
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      );
      expect(analysis.classification, httpClass).toBe(
        'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED',
      );
    }
  });

  it('accepts ONLY when the provider completed AND the full projector passed', () => {
    expect(analyseStrictFalseDifferential(outcome()).classification).toBe(
      'REASONING_LOW_8192_BEST_EFFORT_ACCEPTED',
    );
    // The outcome this run is most exposed to: constrained decoding off is exactly the change most
    // likely to yield a plausible document production refuses. That is NOT a repair.
    expect(
      analyseStrictFalseDifferential(outcome({ localValidationPassed: false })).classification,
    ).toBe('REASONING_LOW_8192_BEST_EFFORT_LOCAL_VALIDATION_FAILED');
  });

  it('never reports LOCAL_VALIDATION_FAILED for a check that never ran', () => {
    expect(
      analyseStrictFalseDifferential(
        outcome({
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification,
    ).toBe('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
  });

  it('files 429, infra and permission answers without reaching a strict-posture verdict', () => {
    const read = (httpClass: (typeof CANDIDATE_PROVIDER_HTTP_CLASSES)[number]): string =>
      analyseStrictFalseDifferential(
        outcome({
          providerHttpClass: httpClass,
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification;

    expect(read('RATE_LIMITED_429')).toBe('REASONING_LOW_8192_BEST_EFFORT_RATE_LIMITED');
    for (const httpClass of [
      'CAPACITY_498',
      'CANCELLED_499',
      'SERVER_5XX',
      'TRANSPORT_THROW',
      'NOT_REACHED',
    ] as const) {
      expect(read(httpClass), httpClass).toBe('REASONING_LOW_8192_BEST_EFFORT_INFRA_INTERRUPTED');
    }
    for (const httpClass of [
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'NOT_FOUND_404',
      'OTHER_HTTP',
      'NONE',
    ] as const) {
      expect(read(httpClass), httpClass).toBe('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
    }
  });

  it('reads every governed transport class without falling through', () => {
    for (const httpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      expect(PROVIDER_OUTCOME_ROLE[httpClass]).toBeDefined();
      const analysis = analyseStrictFalseDifferential(
        outcome({
          providerHttpClass: httpClass,
          providerCompleted: httpClass === 'SUCCESS_2XX',
          localValidationCompleted: httpClass === 'SUCCESS_2XX',
          localValidationPassed: httpClass === 'SUCCESS_2XX',
        }),
      );
      expect(STRICT_FALSE_CLASSIFICATIONS, httpClass).toContain(analysis.classification);
    }
  });

  it('reports INCONCLUSIVE when the probe never ran at all', () => {
    const analysis = analyseStrictFalseDifferential(undefined);
    expect(analysis.classification).toBe('REASONING_LOW_8192_BEST_EFFORT_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
  });
});

describe('the goal, exit code and ledger are this run’s own', () => {
  it('adds ONE closed token and moves no earlier goal', () => {
    expect(OPERATOR_RUN_GOALS).toContain(
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    );
    expect(OPERATOR_RUN_GOALS.at(-1)).toBe(
      'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
    );
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    // Both prior goals still present.
    expect(OPERATOR_RUN_GOALS).toContain('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL');
    expect(OPERATOR_RUN_GOALS).toContain('POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL');
    expect(new Set(OPERATOR_RUN_GOALS).size).toBe(OPERATOR_RUN_GOALS.length);
  });

  it('carries a per-goal notice in BOTH credential tables', () => {
    expect(
      SECOND_CREDENTIAL_NOTICES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL,
    ).toContain('strict-false');
    expect(
      REUSED_CREDENTIAL_NOTICES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL,
    ).toContain('Reusing the credential already read');
  });

  it('takes exit 33, and 0-32 keep meaning exactly what they meant', () => {
    expect(
      OPERATOR_EXIT_CODES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE,
    ).toBe(33);
    // Both prior runs are CONSUMED at their own integers. Immutable evidence.
    expect(
      OPERATOR_EXIT_CODES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE,
    ).toBe(32);
    expect(OPERATOR_EXIT_CODES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE).toBe(31);
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('MAX_PROVIDER_REQUESTS=2 and MAX_COST_USD=1', () => {
    expect(STRICT_FALSE_PROBE_REQUESTS).toBe(1);
    expect(STRICT_FALSE_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(STRICT_FALSE_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('has its OWN counter, and the ledger refuses a third request', () => {
    const ledger = createStrictFalseLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    expect(ledger.reserve('strict-false-probe').ok).toBe(true);
    ledger.settle({ inputTokens: 1200, outputTokens: 1400 }, true);
    expect(ledger.reserve('strict-false-probe').ok).toBe(false);
    const snapshot = ledger.snapshot();
    expect(snapshot.totalProviderRequests).toBe(2);
    expect(snapshot.strictFalseProbeProviderRequests).toBe(1);
    // Neither prior counter moved: this run replays nothing.
    expect(snapshot.reasoningBudget8192ProbeProviderRequests).toBe(0);
    expect(snapshot.reasoningDifferentialProbeProviderRequests).toBe(0);
    expect(snapshot.safetyProviderRequests).toBe(0);
    expect(snapshot.p10ProviderRequests).toBe(0);
  });

  it('is a NEW ledger phase, and RBD1’s ledger cannot count this probe', () => {
    expect(LEDGER_PHASES).toContain('strict-false-probe');
    expect(LEDGER_PHASES).toContain('reasoning-budget-8192-probe');
    expect(new Set(LEDGER_PHASES).size).toBe(LEDGER_PHASES.length);
    const rbd1 = createReasoningBudget8192Ledger();
    expect(rbd1.reserve('smoke').ok).toBe(true);
    rbd1.settle(undefined, true);
    expect(rbd1.snapshot().strictFalseProbeProviderRequests).toBe(0);
  });
});

describe('usage provenance stays load-bearing', () => {
  it('reports PROVIDER_ONLY when every settlement carried reported usage', () => {
    const ledger = createStrictFalseLedger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    ledger.reserve('strict-false-probe');
    ledger.settle({ inputTokens: 1200, outputTokens: 1400 }, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.outputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.costIsEstimated).toBe(false);
  });

  it('reproduces the RLD1/RBD1 SHAPE — MIXED, with the CEILING as the bound', () => {
    const ledger = createStrictFalseLedger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    ledger.reserve('strict-false-probe');
    ledger.settle(undefined, false);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('MIXED');
    expect(snapshot.outputUsageProvenance).toBe('MIXED');
    expect(snapshot.costIsEstimated).toBe(true);
    expect(snapshot.inputTokens).toBe(194 + 131072);
    expect(snapshot.outputTokens).toBe(57 + 65536);
    // The bound is the CEILING, not the 8,192 the request asked for — which is exactly why a
    // fallback total can never be read as a generation length.
    expect(snapshot.outputTokens).not.toBe(57 + STRICT_FALSE_COMPLETION_BUDGET);
  });
});
