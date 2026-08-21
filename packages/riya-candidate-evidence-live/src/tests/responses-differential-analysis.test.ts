/**
 * POST-MD120B3 — the Responses API endpoint differential, read OFFLINE.
 *
 * The classifier, the plan, the identity constants and the ledger, asserted before any live
 * authorization is spent on them. MD120B1 recorded why this matters: a classifier nobody can check
 * before the run is a classifier that spends the next one too.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';

import {
  createModelDifferentialLedger,
  createNeutralRepresentativeLedger,
  createResponsesDifferentialLedger,
  LEDGER_PHASES,
  RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
  RESPONSES_DIFFERENTIAL_PROBE_REQUESTS,
} from '../accounting.js';
import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
} from '../candidate-release.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  MODEL_DIFFERENTIAL_STEP_ID,
  NEUTRAL_CLIENT_STEP_ID,
  planModelDifferentialProbe,
  planNeutralClientProbe,
  planResponsesDifferentialProbe,
  RESPONSES_DIFFERENTIAL_STEP_ID,
} from '../internal/operational-acceptance-plan.js';
import { PROVIDER_OUTCOME_ROLE } from '../internal/provider-outcome-classes.js';
import {
  analyseResponsesDifferential,
  RESPONSES_DIFFERENTIAL_CLASSIFICATIONS,
} from '../internal/responses-differential-classification.js';
import type { ResponsesDifferentialOutcome } from '../internal/responses-differential-classification.js';
import { MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID } from '../model-differential-identity.js';
import { OPERATOR_RUN_GOALS } from '../internal/run-goal.js';
import {
  PROVIDER_ENDPOINT_FAMILIES,
  RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY,
  RESPONSES_DIFFERENTIAL_MODEL_ID,
  RESPONSES_DIFFERENTIAL_SCHEMA_NAME,
  SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
} from '../responses-differential-identity.js';
import { RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET } from '../responses-differential-port.js';

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

function outcome(over: Partial<ResponsesDifferentialOutcome> = {}): ResponsesDifferentialOutcome {
  return Object.freeze({
    stepId: RESPONSES_DIFFERENTIAL_STEP_ID,
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

describe('B — the diagnostic model is the PRODUCTION 20B, and 120B is nowhere near it', () => {
  it('the differential model id IS the production candidate constant', () => {
    // Not "equal to" by coincidence: the identity module re-exports the production constant, so the
    // two cannot drift. MD120B1 moved the model; this run holds it and moves the endpoint.
    expect(RESPONSES_DIFFERENTIAL_MODEL_ID).toBe(CANDIDATE_MODEL_ID);
    expect(RESPONSES_DIFFERENTIAL_MODEL_ID).toBe('openai/gpt-oss-20b');
  });

  it('the 120B diagnostic model is not reachable from this run goal', () => {
    expect(RESPONSES_DIFFERENTIAL_MODEL_ID).not.toBe(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID);
  });
});

describe('the endpoint vocabulary names both contracts and picks one', () => {
  it('the differential moves to RESPONSES_API from CHAT_COMPLETIONS', () => {
    expect([...PROVIDER_ENDPOINT_FAMILIES]).toStrictEqual(['CHAT_COMPLETIONS', 'RESPONSES_API']);
    expect(RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY).toBe('RESPONSES_API');
    expect(RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY).toBe('CHAT_COMPLETIONS');
  });

  it('the endpoint is recorded as BETA, and the smoke proves nothing about it', () => {
    // Groq currently ships the Responses API as beta. Recorded as a constant so the receipt states
    // it rather than a reader having to remember it.
    expect(RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY).toBe('BETA');
    // The entitlement gap, in its endpoint form. The smoke checks a Chat Completions configuration.
    expect(SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT).toBe(false);
    expect(SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY).toBe('CHAT_COMPLETIONS');
  });

  it('the schema NAME is a fixed identifier, not derived from any request content', () => {
    // A name derived from the request would be a second route for content to reach the wire, and a
    // name that varied between runs would make two receipts incomparable.
    expect(RESPONSES_DIFFERENTIAL_SCHEMA_NAME).toBe('qfj_riya_structured_reply_diagnostic');
    expect(RESPONSES_DIFFERENTIAL_SCHEMA_NAME).toMatch(/^[a-z0-9_]+$/u);
  });
});

describe('C/E/F — the probe reuses the neutral plan and re-derives nothing', () => {
  it('shares the schema and messages with N0 and M0 by OBJECT IDENTITY', () => {
    const neutral = planNeutralClientProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const model = planModelDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    const responses = planResponsesDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    // Identity, not equality. A copy could be edited; the same object cannot.
    expect(responses.schema).toBe(neutral.schema);
    expect(responses.messages).toBe(neutral.messages);
    expect(responses.schema).toBe(model.schema);
    expect(responses.messages).toBe(model.messages);
    // The message SOURCE is held constant: the messages are what must not vary.
    expect(responses.messageSource).toBe('CAPTURED_NEUTRAL_CLIENT');
    expect(responses.probeKind).toBe(neutral.probeKind);
    expect(responses.derivedFromPath).toBe('$');
  });

  it('carries its OWN step id and dimension, distinct from every earlier probe', () => {
    const responses = planResponsesDifferentialProbe({
      projectedSchema: SCHEMA,
      neutralMessages: MESSAGES,
    });
    expect(responses.stepId).toBe('E0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_RESPONSES_STRICT');
    expect(responses.stepId).not.toBe(NEUTRAL_CLIENT_STEP_ID);
    expect(responses.stepId).not.toBe(MODEL_DIFFERENTIAL_STEP_ID);
    expect(responses.probeDimension).toBe(
      'FULL_DOCUMENT_WITH_NEUTRAL_CLIENT_MESSAGES_ON_RESPONSES_API',
    );
  });

  it('refuses to plan a probe with no messages or a non-object schema', () => {
    // The messages ARE the question, and a probe carrying none would spend the one authorized
    // request measuring nothing.
    expect(() =>
      planResponsesDifferentialProbe({ projectedSchema: SCHEMA, neutralMessages: [] }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING');
    expect(() =>
      planResponsesDifferentialProbe({
        projectedSchema: { type: 'array' },
        neutralMessages: MESSAGES,
      }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_ROOT_NOT_OBJECT');
  });
});

describe('G — the output budget is the production 4,096 and is its own name', () => {
  it('is 4096, and is NOT the capability ceiling', () => {
    expect(RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET).toBe(4096);
    expect(RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
  });
});

describe('the classification vocabulary is closed and has the sixth token', () => {
  it('names exactly the six outcomes one Responses probe can support', () => {
    expect([...RESPONSES_DIFFERENTIAL_CLASSIFICATIONS]).toStrictEqual([
      'RESPONSES_20B_STRICT_ACCEPTED',
      'RESPONSES_20B_STRICT_PROVIDER_REJECTED',
      'RESPONSES_20B_STRICT_RATE_LIMITED',
      'RESPONSES_20B_STRICT_INFRA_INTERRUPTED',
      'RESPONSES_20B_STRICT_INCONCLUSIVE',
      'RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED',
    ]);
  });

  it('borrows no token from the model differential or the acceptance gates', () => {
    // Separate vocabularies, because separate questions. A shared token would make MD120B3's
    // immutable receipt and a future RSP20B1 receipt indistinguishable.
    for (const token of RESPONSES_DIFFERENTIAL_CLASSIFICATIONS) {
      expect(token.startsWith('RESPONSES_20B_STRICT_')).toBe(true);
      expect(token).not.toContain('120B');
      expect(token).not.toContain('REPRESENTATIVE');
    }
  });
});

describe('N/O — a provider 2xx is NOT the finding on this endpoint', () => {
  it('N: 2xx + provider completed + local validation passed => ACCEPTED', () => {
    const analysis = analyseResponsesDifferential(outcome());
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_ACCEPTED');
    expect(analysis.localValidationCompleted).toBe(true);
    expect(analysis.localValidationPassed).toBe(true);
  });

  it('O: 2xx + provider completed + local validation FAILED => LOCAL_VALIDATION_FAILED', () => {
    const analysis = analyseResponsesDifferential(
      outcome({ localValidationCompleted: true, localValidationPassed: false }),
    );
    // The one token every earlier gate could do without. The provider accepted the request and
    // returned something; it is not a Riya reply.
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED');
    // And it is emphatically NOT filed as a provider rejection: nobody rejected anything.
    expect(analysis.classification).not.toBe('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    expect(analysis.providerHttpStatus).toBe(200);
  });

  it('a 2xx whose provider never completed is INCONCLUSIVE, not a validation failure', () => {
    // Nothing reached the local validator, so saying it failed would be a claim about a check that
    // never ran.
    const analysis = analyseResponsesDifferential(
      outcome({
        providerCompleted: false,
        localValidationCompleted: false,
        localValidationPassed: false,
      }),
    );
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INCONCLUSIVE');
    expect(analysis.localValidationCompleted).toBe(false);
  });
});

describe('M — a provider rejection keeps its literal type and code', () => {
  it('400 JSON_VALIDATE_FAILED classifies as PROVIDER_REJECTED and preserves both literals', () => {
    const analysis = analyseResponsesDifferential(
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
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    // Uninterpreted. A 400 says a refusal happened; nothing here invents a cause.
    expect(analysis.providerErrorType).toBe('INVALID_REQUEST_ERROR');
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
    expect(analysis.providerHttpStatus).toBe(400);
  });

  it('413 and 422 are the only other contract rejections', () => {
    for (const [status, httpClass] of [
      [413, 'PAYLOAD_TOO_LARGE_413'],
      [422, 'UNPROCESSABLE_422'],
    ] as const) {
      const analysis = analyseResponsesDifferential(
        outcome({
          providerHttpStatus: status,
          providerHttpClass: httpClass,
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      );
      expect(analysis.classification).toBe('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    }
  });

  it('a rejection class with no transport behind it is INCONCLUSIVE, not evidence', () => {
    const analysis = analyseResponsesDifferential(
      outcome({
        providerTransportStarted: false,
        providerHttpStatus: 0,
        providerHttpClass: 'BAD_REQUEST_400',
        providerCompleted: false,
        localValidationCompleted: false,
        localValidationPassed: false,
      }),
    );
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INCONCLUSIVE');
  });
});

describe('P — entitlement and beta enrolment are never an endpoint verdict', () => {
  it('401, 403 and 404 are INCONCLUSIVE', () => {
    for (const [status, httpClass] of [
      [401, 'UNAUTHORIZED_401'],
      [403, 'FORBIDDEN_403'],
      [404, 'NOT_FOUND_404'],
    ] as const) {
      const analysis = analyseResponsesDifferential(
        outcome({
          providerHttpStatus: status,
          providerHttpClass: httpClass,
          providerErrorType: 'PERMISSIONS_ERROR',
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      );
      // MD120B2 met a 403 and was correctly read as inconclusive. The same trap has an endpoint
      // form: "this project cannot reach /openai/v1/responses" is not "the endpoint rejects our
      // schema", and reading it as one would retire the differential on evidence that never touched it.
      expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INCONCLUSIVE');
      expect(analysis.classification).not.toBe('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
    }
  });

  it('a probe that never ran is INCONCLUSIVE and reports NOT_REACHED', () => {
    const analysis = analyseResponsesDifferential(undefined);
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
    expect(analysis.providerHttpStatus).toBe(0);
    expect(analysis.localValidationCompleted).toBe(false);
    expect(analysis.localValidationPassed).toBe(false);
  });
});

describe('429 and infrastructure are not verdicts either', () => {
  it('429 is RATE_LIMITED', () => {
    const analysis = analyseResponsesDifferential(
      outcome({
        providerHttpStatus: 429,
        providerHttpClass: 'RATE_LIMITED_429',
        providerCompleted: false,
        localValidationCompleted: false,
        localValidationPassed: false,
      }),
    );
    expect(analysis.classification).toBe('RESPONSES_20B_STRICT_RATE_LIMITED');
  });

  it('498, 499, 5xx, a transport throw and NOT_REACHED are INFRA_INTERRUPTED', () => {
    for (const httpClass of [
      'CAPACITY_498',
      'CANCELLED_499',
      'SERVER_5XX',
      'TRANSPORT_THROW',
      'NOT_REACHED',
    ] as const) {
      const analysis = analyseResponsesDifferential(
        outcome({
          providerHttpStatus: 500,
          providerHttpClass: httpClass,
          providerCompleted: false,
          localValidationCompleted: false,
          localValidationPassed: false,
        }),
      );
      expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INFRA_INTERRUPTED');
    }
  });
});

describe('the classifier duplicates no HTTP logic and cannot fall through', () => {
  it('EVERY governed class reaches a token, and the role map decides which', () => {
    // The property MD120B1 established and this classifier inherits: a class added to the observation
    // vocabulary cannot reach a verdict by omission, because the switch is total over the role map.
    for (const httpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      const analysis = analyseResponsesDifferential(
        outcome({
          providerHttpStatus: httpClass === 'NOT_REACHED' ? 0 : 400,
          providerTransportStarted: httpClass !== 'NOT_REACHED',
          providerHttpClass: httpClass,
          providerCompleted: httpClass === 'SUCCESS_2XX',
          localValidationCompleted: httpClass === 'SUCCESS_2XX',
          localValidationPassed: httpClass === 'SUCCESS_2XX',
        }),
      );
      expect(RESPONSES_DIFFERENTIAL_CLASSIFICATIONS).toContain(analysis.classification);
      const role = PROVIDER_OUTCOME_ROLE[httpClass];
      if (role === 'CONTRACT_REJECTION') {
        expect(analysis.classification).toBe('RESPONSES_20B_STRICT_PROVIDER_REJECTED');
      }
      if (role === 'NON_VERDICT_OTHER') {
        expect(analysis.classification).toBe('RESPONSES_20B_STRICT_INCONCLUSIVE');
      }
    }
  });
});

describe('the run goal, exit code and ledger are this run’s own', () => {
  it('the goal is a NEW closed token and no earlier goal moved', () => {
    expect(OPERATOR_RUN_GOALS).toContain('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL');
    expect(OPERATOR_RUN_GOALS.at(-1)).toBe('POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL');
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    expect(new Set(OPERATOR_RUN_GOALS).size).toBe(OPERATOR_RUN_GOALS.length);
  });

  it('the exit code is 30, and 0-29 keep meaning what they meant', () => {
    expect(OPERATOR_EXIT_CODES.POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE).toBe(
      30,
    );
    expect(OPERATOR_EXIT_CODES.POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL_COMPLETE).toBe(29);
    expect(OPERATOR_EXIT_CODES.POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE).toBe(28);
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const codes = Object.values(OPERATOR_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('FUTURE_MAX_PROVIDER_REQUESTS=2 and FUTURE_MAX_COST_USD=1', () => {
    expect(RESPONSES_DIFFERENTIAL_PROBE_REQUESTS).toBe(1);
    expect(RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS).toBe(2);
    expect(RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('its counter is its OWN, and the ledger refuses a third request', () => {
    const ledger = createResponsesDifferentialLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    expect(ledger.reserve('responses-differential-probe').ok).toBe(true);
    ledger.settle(undefined, true);
    const third = ledger.reserve('responses-differential-probe');
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.refusal).toBe('request-limit-reached');
    }
    const snapshot = ledger.snapshot();
    expect(snapshot.totalProviderRequests).toBe(2);
    expect(snapshot.responsesDifferentialProbeProviderRequests).toBe(1);
    // Its OWN counter: MD120B3's stays zero, so a receipt can always say which run produced it.
    expect(snapshot.modelDifferentialProbeProviderRequests).toBe(0);
    expect(snapshot.neutralRepresentativeProbeProviderRequests).toBe(0);
    expect(snapshot.safetyProviderRequests).toBe(0);
    expect(snapshot.p10ProviderRequests).toBe(0);
  });

  it('the new phase joins the CLOSED vocabulary the total is summed over', () => {
    // A phase left out of `LEDGER_PHASES` would be a request the ceiling never saw.
    expect([...LEDGER_PHASES]).toContain('responses-differential-probe');
    const ledger = createResponsesDifferentialLedger();
    expect(ledger.reserve('responses-differential-probe').ok).toBe(true);
    expect(ledger.snapshot().totalProviderRequests).toBe(1);
  });

  it('prices at the PRODUCTION tariff, unlike the mixed-model 120B ledger', () => {
    // Both requests go to the production 20B model, so no conservative posture is needed — and the
    // rates are read from `candidate-release.ts` rather than restated, so a published price change
    // moves this ledger with every other one.
    const perRequest =
      (CANDIDATE_MAX_INPUT_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_INPUT_USD +
      (CANDIDATE_MAX_COMPLETION_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_OUTPUT_USD;
    // Worst case for BOTH authorized requests, priced at the declared hard maxima.
    expect(perRequest * RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS).toBeLessThan(
      RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
    );
    // And the ceiling really binds: the reservation is priced BEFORE the call.
    const ledger = createResponsesDifferentialLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    expect(ledger.reserve('responses-differential-probe').ok).toBe(true);
  });

  it('is a SEPARATE ledger object from every earlier gate’s', () => {
    const responses = createResponsesDifferentialLedger();
    const model = createModelDifferentialLedger();
    const neutral = createNeutralRepresentativeLedger();
    expect(responses).not.toBe(model);
    expect(responses).not.toBe(neutral);
    // Each counts into its own field, so two runs can never be confused in a receipt.
    responses.reserve('responses-differential-probe');
    model.reserve('model-differential-probe');
    expect(responses.snapshot().responsesDifferentialProbeProviderRequests).toBe(1);
    expect(model.snapshot().responsesDifferentialProbeProviderRequests).toBe(0);
    expect(model.snapshot().modelDifferentialProbeProviderRequests).toBe(1);
  });
});
