/**
 * POST-RLD1 — the low-reasoning 8,192 output-budget differential, read OFFLINE.
 *
 * The classifier, the plan, the identity constants, the ledger, the goal and the exit code, asserted
 * before any live authorization is spent on them.
 *
 * Two things this spec guards that the earlier ones did not need:
 *
 * 1. **RLD1 is CONSUMED.** Its classifier vocabulary, step id, exit code and counter are immutable
 *    evidence, so this file asserts they are untouched as well as asserting its own.
 * 2. **The hypothesis is not the proof.** RLD1's failed-probe usage was never observed and truncation
 *    at 4,096 was never proven, so both facts are first-class constants and both are pinned `false`.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';

import {
  createReasoningBudget8192Ledger,
  createReasoningDifferentialLedger,
  LEDGER_PHASES,
  REASONING_BUDGET_8192_MAX_ESTIMATED_COST_USD,
  REASONING_BUDGET_8192_MAX_PROVIDER_REQUESTS,
  REASONING_BUDGET_8192_PROBE_REQUESTS,
} from '../accounting.js';
import { CANDIDATE_MAX_COMPLETION_TOKENS, CANDIDATE_MODEL_ID } from '../candidate-release.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  planNeutralClientProbe,
  planReasoningBudget8192Probe,
  planReasoningDifferentialProbe,
  REASONING_BUDGET_8192_STEP_ID,
  REASONING_DIFFERENTIAL_STEP_ID,
} from '../internal/operational-acceptance-plan.js';
import { PROVIDER_OUTCOME_ROLE } from '../internal/provider-outcome-classes.js';
import {
  analyseReasoningBudget8192,
  REASONING_BUDGET_8192_CLASSIFICATIONS,
} from '../internal/reasoning-budget-8192-classification.js';
import type { ReasoningBudget8192Outcome } from '../internal/reasoning-budget-8192-classification.js';
import { REASONING_DIFFERENTIAL_CLASSIFICATIONS } from '../internal/reasoning-differential-classification.js';
import {
  OPERATOR_RUN_GOALS,
  REUSED_CREDENTIAL_NOTICES,
  SECOND_CREDENTIAL_NOTICES,
} from '../internal/run-goal.js';
import {
  REASONING_BUDGET_8192_BASELINE_BUDGET,
  REASONING_BUDGET_8192_BASELINE_CLASSIFICATION,
  REASONING_BUDGET_8192_CANDIDATE_BUDGET,
  REASONING_BUDGET_8192_ENDPOINT_FAMILY,
  REASONING_BUDGET_8192_MODEL_ID,
  REASONING_BUDGET_8192_REASONING_EFFORT,
  RLD1_FAILED_PROBE_USAGE_OBSERVED,
  RLD1_TRUNCATION_AT_BASELINE_PROVEN,
} from '../reasoning-budget-8192-identity.js';
import { REASONING_BUDGET_8192_OUTPUT_BUDGET } from '../reasoning-budget-8192-port.js';
import { REASONING_DIFFERENTIAL_CANDIDATE_EFFORT } from '../reasoning-differential-identity.js';
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

function outcome(over: Partial<ReasoningBudget8192Outcome> = {}): ReasoningBudget8192Outcome {
  return Object.freeze({
    stepId: REASONING_BUDGET_8192_STEP_ID,
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

describe('the identity: the budget moves, everything else is HELD', () => {
  it('sends 8192 against a 4096 baseline read from RLD1 itself', () => {
    expect(REASONING_BUDGET_8192_CANDIDATE_BUDGET).toBe(8192);
    expect(REASONING_BUDGET_8192_OUTPUT_BUDGET).toBe(8192);
    // The baseline is READ from the RLD1 port, never restated — so the number this receipt names is
    // the one that run actually put on the wire.
    expect(REASONING_BUDGET_8192_BASELINE_BUDGET).toBe(REASONING_DIFFERENTIAL_OUTPUT_BUDGET);
    expect(REASONING_BUDGET_8192_BASELINE_BUDGET).toBe(4096);
    expect(REASONING_BUDGET_8192_CANDIDATE_BUDGET).toBe(REASONING_BUDGET_8192_BASELINE_BUDGET * 2);
  });

  it('holds the reasoning effort, and reads it from RLD1 rather than restating it', () => {
    // The value RLD1 sent, HELD rather than re-tested. Reading the constant means the two runs
    // cannot disagree about what is being held, which is the basis for calling this one-variable.
    expect(REASONING_BUDGET_8192_REASONING_EFFORT).toBe('low');
    expect(REASONING_BUDGET_8192_REASONING_EFFORT).toBe(REASONING_DIFFERENTIAL_CANDIDATE_EFFORT);
  });

  it('holds the model and the endpoint', () => {
    expect(REASONING_BUDGET_8192_MODEL_ID).toBe(CANDIDATE_MODEL_ID);
    expect(REASONING_BUDGET_8192_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(REASONING_BUDGET_8192_ENDPOINT_FAMILY).toBe('CHAT_COMPLETIONS');
  });

  it('does NOT move the production budget, and stays far inside the capability ceiling', () => {
    // The 8,192 is a REQUEST bound living in a diagnostic identity. Production stays 4,096.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4096);
    expect(REASONING_BUDGET_8192_CANDIDATE_BUDGET).not.toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    // And the model CAPABILITY ceiling is untouched at 65,536, so the adapter's clamp never engages:
    // a diagnostic may narrow the request, never widen the ceiling.
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65536);
    expect(REASONING_BUDGET_8192_CANDIDATE_BUDGET).toBeLessThan(CANDIDATE_MAX_COMPLETION_TOKENS);
  });

  it('records what RLD1 observed, and what it did NOT', () => {
    expect(REASONING_BUDGET_8192_BASELINE_CLASSIFICATION).toBe(
      'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
    );
    // The two constants that stop a plausible hypothesis being read as a proven one. RLD1's totals
    // carried the ledger's fallback BOUNDS for the failed probe; nobody observed its usage, and
    // truncation at 4,096 was never proven.
    expect(RLD1_FAILED_PROBE_USAGE_OBSERVED).toBe(false);
    expect(RLD1_TRUNCATION_AT_BASELINE_PROVEN).toBe(false);
  });
});

describe('the plan: the SAME probe as RLD1, relabelled', () => {
  it('carries the identical schema and message objects, not copies', () => {
    const neutral = planNeutralClientProbe({ projectedSchema: SCHEMA, neutralMessages: MESSAGES });
    const budget = planReasoningBudget8192Probe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    expect(budget.schema).toBe(neutral.schema);
    expect(budget.messages).toBe(neutral.messages);
    expect(budget.probeKind).toBe(neutral.probeKind);
    expect(budget.messageSource).toBe('CAPTURED_NEUTRAL_CLIENT');
    expect(budget.derivedFromPath).toBe(neutral.derivedFromPath);
  });

  it('differs from the RLD1 probe in exactly the step id and the dimension label', () => {
    const rld1 = planReasoningDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const budget = planReasoningBudget8192Probe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const differing = (Object.keys(budget) as (keyof typeof budget)[]).filter(
      (key) => budget[key] !== rld1[key],
    );
    expect(differing.sort()).toStrictEqual(['probeDimension', 'stepId']);
    // The schema and messages are the SAME OBJECTS RLD1's planner produced.
    expect(budget.schema).toBe(rld1.schema);
    expect(budget.messages).toBe(rld1.messages);
  });

  it('has its OWN step id, and RLD1 keeps its own', () => {
    expect(REASONING_BUDGET_8192_STEP_ID).toBe(
      'B0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW_8192',
    );
    // RLD1 is CONSUMED. Its identifier is immutable evidence.
    expect(REASONING_DIFFERENTIAL_STEP_ID).toBe(
      'R0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_REASONING_LOW',
    );
    expect(REASONING_BUDGET_8192_STEP_ID).not.toBe(REASONING_DIFFERENTIAL_STEP_ID);
  });

  it('refuses a probe with no messages, before a request is spent', () => {
    expect(() =>
      planReasoningBudget8192Probe({ projectedSchema: SCHEMA, neutralMessages: [] }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING');
  });
});

describe('the classifier keeps RLD1’s split and does not touch RLD1’s vocabulary', () => {
  it('is a closed seven-member vocabulary with no generic bucket', () => {
    expect([...REASONING_BUDGET_8192_CLASSIFICATIONS]).toStrictEqual([
      'REASONING_LOW_8192_STRICT_ACCEPTED',
      'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID',
      'REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED',
      'REASONING_LOW_8192_STRICT_RATE_LIMITED',
      'REASONING_LOW_8192_STRICT_INFRA_INTERRUPTED',
      'REASONING_LOW_8192_STRICT_INCONCLUSIVE',
      'REASONING_LOW_8192_STRICT_LOCAL_VALIDATION_FAILED',
    ]);
  });

  it('leaves RLD1’s classifier vocabulary byte-identical', () => {
    // RLD1 is CONSUMED and its receipt names these tokens. Renaming or extending them would make
    // immutable evidence unreadable.
    expect([...REASONING_DIFFERENTIAL_CLASSIFICATIONS]).toStrictEqual([
      'REASONING_LOW_20B_STRICT_ACCEPTED',
      'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID',
      'REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED',
      'REASONING_LOW_20B_STRICT_RATE_LIMITED',
      'REASONING_LOW_20B_STRICT_INFRA_INTERRUPTED',
      'REASONING_LOW_20B_STRICT_INCONCLUSIVE',
      'REASONING_LOW_20B_STRICT_LOCAL_VALIDATION_FAILED',
    ]);
    // And the two vocabularies share no token at all.
    for (const token of REASONING_BUDGET_8192_CLASSIFICATIONS) {
      expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS, token).not.toContain(token);
    }
  });

  it('files a 400 carrying JSON_VALIDATE_FAILED as PROVIDER_OUTPUT_INVALID', () => {
    const analysis = analyseReasoningBudget8192(
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
    expect(analysis.classification).toBe('REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID');
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
  });

  it('files a 413 as a REQUEST rejection — the case that would invalidate the run', () => {
    // At 8,192 a 413 would say the request itself became unacceptable, which invalidates the
    // differential rather than answering it. It must never be filed as an output failure.
    const analysis = analyseReasoningBudget8192(
      outcome({
        providerHttpStatus: 413,
        providerHttpClass: 'PAYLOAD_TOO_LARGE_413',
        providerErrorType: 'INVALID_REQUEST_ERROR',
        providerErrorCode: 'OTHER_OR_ABSENT',
        providerCompleted: false,
        localValidationCompleted: false,
        localValidationPassed: false,
      }),
    );
    expect(analysis.classification).toBe('REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED');
  });

  it('accepts ONLY when the provider completed AND the full projector passed', () => {
    expect(analyseReasoningBudget8192(outcome()).classification).toBe(
      'REASONING_LOW_8192_STRICT_ACCEPTED',
    );
    expect(
      analyseReasoningBudget8192(outcome({ localValidationPassed: false })).classification,
    ).toBe('REASONING_LOW_8192_STRICT_LOCAL_VALIDATION_FAILED');
  });

  it('never reports LOCAL_VALIDATION_FAILED for a check that never ran', () => {
    expect(
      analyseReasoningBudget8192(
        outcome({
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification,
    ).toBe('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
  });

  it('files 429, infra and permission answers without ever reaching a budget verdict', () => {
    const nonVerdict = (httpClass: (typeof CANDIDATE_PROVIDER_HTTP_CLASSES)[number]): string =>
      analyseReasoningBudget8192(
        outcome({
          providerHttpClass: httpClass,
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      ).classification;

    expect(nonVerdict('RATE_LIMITED_429')).toBe('REASONING_LOW_8192_STRICT_RATE_LIMITED');
    for (const httpClass of [
      'CAPACITY_498',
      'CANCELLED_499',
      'SERVER_5XX',
      'TRANSPORT_THROW',
      'NOT_REACHED',
    ] as const) {
      expect(nonVerdict(httpClass), httpClass).toBe('REASONING_LOW_8192_STRICT_INFRA_INTERRUPTED');
    }
    for (const httpClass of [
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'NOT_FOUND_404',
      'OTHER_HTTP',
      'NONE',
    ] as const) {
      expect(nonVerdict(httpClass), httpClass).toBe('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
    }
  });

  it('reads every governed transport class without falling through', () => {
    for (const httpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      expect(PROVIDER_OUTCOME_ROLE[httpClass]).toBeDefined();
      const analysis = analyseReasoningBudget8192(
        outcome({
          providerHttpClass: httpClass,
          providerCompleted: httpClass === 'SUCCESS_2XX',
          localValidationCompleted: httpClass === 'SUCCESS_2XX',
          localValidationPassed: httpClass === 'SUCCESS_2XX',
        }),
      );
      expect(REASONING_BUDGET_8192_CLASSIFICATIONS, httpClass).toContain(analysis.classification);
    }
  });

  it('reports INCONCLUSIVE when the probe never ran at all', () => {
    const analysis = analyseReasoningBudget8192(undefined);
    expect(analysis.classification).toBe('REASONING_LOW_8192_STRICT_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
  });
});

describe('the goal, exit code and ledger are this run’s own', () => {
  it('adds ONE closed token and moves no earlier goal', () => {
    expect(OPERATOR_RUN_GOALS).toContain('POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL');
    expect(OPERATOR_RUN_GOALS.at(-1)).toBe(
      'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
    );
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    // RLD1's goal is still present and unmoved.
    expect(OPERATOR_RUN_GOALS).toContain('POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL');
    expect(new Set(OPERATOR_RUN_GOALS).size).toBe(OPERATOR_RUN_GOALS.length);
  });

  it('carries a per-goal notice in BOTH credential tables', () => {
    expect(
      SECOND_CREDENTIAL_NOTICES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL,
    ).toContain('8192');
    expect(
      REUSED_CREDENTIAL_NOTICES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL,
    ).toContain('Reusing the credential already read');
  });

  it('takes exit 32, and 0-31 keep meaning exactly what they meant', () => {
    expect(
      OPERATOR_EXIT_CODES.POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE,
    ).toBe(32);
    // RLD1 is CONSUMED at exit 31. That integer is immutable evidence of a run at the 4,096 budget.
    expect(OPERATOR_EXIT_CODES.POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE).toBe(31);
    expect(OPERATOR_EXIT_CODES.POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE).toBe(
      30,
    );
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('MAX_PROVIDER_REQUESTS=2 and MAX_COST_USD=1', () => {
    expect(REASONING_BUDGET_8192_PROBE_REQUESTS).toBe(1);
    expect(REASONING_BUDGET_8192_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(REASONING_BUDGET_8192_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('has its OWN counter, and the ledger refuses a third request', () => {
    const ledger = createReasoningBudget8192Ledger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    expect(ledger.reserve('reasoning-budget-8192-probe').ok).toBe(true);
    ledger.settle({ inputTokens: 1200, outputTokens: 1400 }, true);
    expect(ledger.reserve('reasoning-budget-8192-probe').ok).toBe(false);
    const snapshot = ledger.snapshot();
    expect(snapshot.totalProviderRequests).toBe(2);
    expect(snapshot.reasoningBudget8192ProbeProviderRequests).toBe(1);
    // RLD1's counter did NOT move: this run does not replay its request.
    expect(snapshot.reasoningDifferentialProbeProviderRequests).toBe(0);
    expect(snapshot.safetyProviderRequests).toBe(0);
    expect(snapshot.p10ProviderRequests).toBe(0);
  });

  it('is a NEW ledger phase, and RLD1’s ledger cannot count this probe', () => {
    expect(LEDGER_PHASES).toContain('reasoning-budget-8192-probe');
    expect(LEDGER_PHASES).toContain('reasoning-differential-probe');
    expect(new Set(LEDGER_PHASES).size).toBe(LEDGER_PHASES.length);
    const rld1 = createReasoningDifferentialLedger();
    expect(rld1.reserve('smoke').ok).toBe(true);
    rld1.settle(undefined, true);
    expect(rld1.snapshot().reasoningBudget8192ProbeProviderRequests).toBe(0);
  });
});

describe('usage provenance stays load-bearing', () => {
  it('reports PROVIDER_ONLY when every settlement carried reported usage', () => {
    const ledger = createReasoningBudget8192Ledger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    ledger.reserve('reasoning-budget-8192-probe');
    ledger.settle({ inputTokens: 1200, outputTokens: 1400 }, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.outputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(snapshot.costIsEstimated).toBe(false);
  });

  it('reproduces the RLD1 SHAPE — MIXED, with the ceiling as the bound', () => {
    // Exactly what RLD1's receipt showed: an observed smoke plus an unreported failed probe. The
    // totals carry the CONFIGURED CEILINGS, not the request budget, and never read PROVIDER_ONLY.
    const ledger = createReasoningBudget8192Ledger();
    ledger.reserve('smoke');
    ledger.settle({ inputTokens: 194, outputTokens: 57 }, true);
    ledger.reserve('reasoning-budget-8192-probe');
    ledger.settle(undefined, false);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputUsageProvenance).toBe('MIXED');
    expect(snapshot.outputUsageProvenance).toBe('MIXED');
    expect(snapshot.costIsEstimated).toBe(true);
    expect(snapshot.inputTokens).toBe(194 + 131072);
    expect(snapshot.outputTokens).toBe(57 + 65536);
    // And the bound is the CEILING, not the 8,192 the request asked for — which is precisely why a
    // fallback total can never be read as a generation length.
    expect(snapshot.outputTokens).not.toBe(57 + REASONING_BUDGET_8192_CANDIDATE_BUDGET);
  });
});
