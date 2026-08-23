/**
 * POST-SFD1 — two-stage local validation provenance and its localized reading, asserted OFFLINE.
 *
 * SFD1's unauthorized duplicate observation returned HTTP 200 with `localValidationPassed=false`.
 * That single boolean cannot say whether the document failed the WIRE SHAPE the provider was asked
 * for, or held the shape and then failed a later production invariant. Those point at entirely
 * different investigations, and the receipt could not tell them apart.
 *
 * Both stages come from the CAPTURED production request — the gateway's own `structuredWireSchema`
 * and production's own `projectStructuredResult`. No second Riya validator is written here, and a
 * spec below asserts the runner calls nothing else.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';

import type { CandidateTransportObservations } from '../candidate-transport-observation.js';
import {
  analyseLocalizedStructuredReply,
  LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS,
} from '../internal/localized-structured-reply-classification.js';
import type { LocalizedStructuredReplyOutcome } from '../internal/localized-structured-reply-classification.js';
import { createReasoningBudgetProbeRunner } from '../internal/reasoning-budget-probe.js';
import type {
  ReasoningBudgetObservation,
  ReasoningBudgetRunnerDeps,
  ReasoningBudgetSeam,
} from '../internal/reasoning-budget-probe.js';
import { STRICT_FALSE_CLASSIFICATIONS } from '../internal/strict-false-differential-classification.js';
import { REASONING_BUDGET_8192_CLASSIFICATIONS } from '../internal/reasoning-budget-8192-classification.js';
import { REASONING_DIFFERENTIAL_CLASSIFICATIONS } from '../internal/reasoning-differential-classification.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';

const STEP = 'X0_PROVENANCE_SPEC' as const;

/** A minimal observations double: the runner only records around one case. */
function observations(over: Partial<{ readonly httpStatus: number }> = {}): {
  readonly seam: CandidateTransportObservations;
} {
  const status = over.httpStatus ?? 200;
  return {
    seam: {
      duringCase: async (_stepId: string, run: () => Promise<void>) => {
        await run();
      },
      observationFor: () => ({
        providerTransportStarted: true,
        providerHttpStatus: status,
        providerHttpClass: status === 200 ? 'SUCCESS_2XX' : 'BAD_REQUEST_400',
        providerErrorType: status === 200 ? 'NONE' : 'INVALID_REQUEST_ERROR',
        providerErrorCode: status === 200 ? 'NONE' : 'JSON_VALIDATE_FAILED',
      }),
      observe: (transport: unknown) => transport,
    } as unknown as CandidateTransportObservations,
  };
}

const PROBE = Object.freeze({
  stepId: STEP,
  probeKind: 'EXACT_REPRESENTATIVE' as const,
  probeDimension: 'PROVENANCE',
  derivedFromPath: '$',
  messageSource: 'CAPTURED_NEUTRAL_CLIENT' as const,
  schema: { type: 'object' },
  messages: [{ role: 'user' as const, content: 'U' }],
});

function seamReturning(result: {
  readonly providerCompleted: boolean;
  readonly structuredValue?: unknown;
}): ReasoningBudgetSeam {
  return { invoke: () => Promise.resolve(result) };
}

/** A wire schema double. Only `safeParse` is ever called on the real one. */
function wireSchema(accepts: boolean | 'throws'): {
  readonly safeParse: (v: unknown) => { success: boolean };
} {
  return {
    safeParse: () => {
      if (accepts === 'throws') {
        throw new Error('WIRE-SCHEMA-DETAIL-MUST-NOT-APPEAR');
      }
      return { success: accepts };
    },
  };
}

async function runProbe(options: {
  readonly providerCompleted: boolean;
  readonly wireAccepts?: boolean | 'throws';
  readonly projectorReturns?: 'value' | 'undefined' | 'throws';
  readonly withWireSchema?: boolean;
}): Promise<ReasoningBudgetObservation<typeof STEP>> {
  const { seam } = observations({ httpStatus: options.providerCompleted ? 200 : 400 });
  const schema = wireSchema(options.wireAccepts ?? true) as unknown as NonNullable<
    ReasoningBudgetRunnerDeps<typeof STEP>['structuredWireSchema']
  >;
  const deps: ReasoningBudgetRunnerDeps<typeof STEP> = {
    stepId: STEP,
    completionBudget: 8192,
    reasoningEffort: 'low',
    providerForCompletionBudget: () =>
      seamReturning({
        providerCompleted: options.providerCompleted,
        ...(options.providerCompleted ? { structuredValue: { any: 'document' } } : {}),
      }),
    observations: seam,
    projectStructuredResult: () => {
      if (options.projectorReturns === 'throws') {
        throw new Error('PROJECTOR-DETAIL-MUST-NOT-APPEAR');
      }
      return options.projectorReturns === 'value' ? ({} as never) : undefined;
    },
    ...(options.withWireSchema === false ? {} : { structuredWireSchema: schema }),
  };
  const { outcome } = await createReasoningBudgetProbeRunner(deps)(PROBE);
  return outcome;
}

describe('the two-stage provenance the runner records', () => {
  it('reports NEITHER stage completed when the provider did not complete', async () => {
    const outcome = await runProbe({ providerCompleted: false });
    expect(outcome.wireValidationCompleted).toBe(false);
    expect(outcome.wireValidationPassed).toBe(false);
    expect(outcome.productionValidationCompleted).toBe(false);
    expect(outcome.productionValidationPassed).toBe(false);
  });

  it('runs BOTH stages on a completion, so localValidationPassed keeps its old meaning', async () => {
    // The policy chosen deliberately: the projector runs even when the wire parse already failed.
    // That keeps `localValidationPassed` exactly the projector's verdict, as it has always been, so
    // this addition cannot move any existing classification.
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: false,
      projectorReturns: 'undefined',
    });
    expect(outcome.wireValidationCompleted).toBe(true);
    expect(outcome.wireValidationPassed).toBe(false);
    expect(outcome.productionValidationCompleted).toBe(true);
    expect(outcome.productionValidationPassed).toBe(false);
    expect(outcome.localValidationCompleted).toBe(true);
    expect(outcome.localValidationPassed).toBe(false);
  });

  it('records wire PASS + production FAIL — the case SFD1 could not distinguish', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: true,
      projectorReturns: 'undefined',
    });
    expect(outcome.wireValidationPassed).toBe(true);
    expect(outcome.productionValidationPassed).toBe(false);
  });

  it('records both PASS on an acceptable document', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: true,
      projectorReturns: 'value',
    });
    expect(outcome.wireValidationPassed).toBe(true);
    expect(outcome.productionValidationPassed).toBe(true);
    expect(outcome.localValidationPassed).toBe(true);
  });

  it('treats a projector THROW as a refusal, and reads nothing from it', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: true,
      projectorReturns: 'throws',
    });
    expect(outcome.productionValidationCompleted).toBe(true);
    expect(outcome.productionValidationPassed).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain('PROJECTOR-DETAIL-MUST-NOT-APPEAR');
  });

  it('treats a wire-schema THROW as a wire refusal, and reads nothing from it', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: 'throws',
      projectorReturns: 'undefined',
    });
    expect(outcome.wireValidationCompleted).toBe(true);
    expect(outcome.wireValidationPassed).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain('WIRE-SCHEMA-DETAIL-MUST-NOT-APPEAR');
  });

  it('leaves the wire stage un-run when no wire schema is supplied — pre-existing callers unmoved', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      withWireSchema: false,
      projectorReturns: 'value',
    });
    expect(outcome.wireValidationCompleted).toBe(false);
    expect(outcome.wireValidationPassed).toBe(false);
    // The historical fields are untouched.
    expect(outcome.localValidationCompleted).toBe(true);
    expect(outcome.localValidationPassed).toBe(true);
  });

  it('emits only booleans and closed tokens — no document, schema or issue list', async () => {
    const outcome = await runProbe({
      providerCompleted: true,
      wireAccepts: false,
      projectorReturns: 'undefined',
    });
    const serialized = JSON.stringify(outcome);
    for (const forbidden of ['document', 'issues', 'zod', 'path', 'expected', 'received']) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe('the localized classifier', () => {
  const base = (
    over: Partial<LocalizedStructuredReplyOutcome> = {},
  ): LocalizedStructuredReplyOutcome =>
    Object.freeze({
      providerTransportStarted: true,
      providerHttpStatus: 200,
      providerHttpClass: 'SUCCESS_2XX' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
      providerCompleted: true,
      wireValidationCompleted: true,
      wireValidationPassed: true,
      productionValidationCompleted: true,
      productionValidationPassed: true,
      ...over,
    });

  it('is a closed eight-member vocabulary', () => {
    expect([...LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS]).toStrictEqual([
      'STRUCTURED_REPLY_ACCEPTED',
      'STRUCTURED_REPLY_WIRE_SCHEMA_INVALID',
      'STRUCTURED_REPLY_POST_WIRE_PRODUCTION_INVARIANT_FAILED',
      'STRUCTURED_REPLY_PROVIDER_OUTPUT_INVALID',
      'STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED',
      'STRUCTURED_REPLY_RATE_LIMITED',
      'STRUCTURED_REPLY_INFRA_INTERRUPTED',
      'STRUCTURED_REPLY_INCONCLUSIVE',
    ]);
  });

  it('shares no token with any CONSUMED run’s vocabulary', () => {
    // RLD1, RBD1 and SFD1 are consumed and their receipts name their own tokens.
    for (const token of LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS) {
      expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS, token).not.toContain(token);
      expect(REASONING_BUDGET_8192_CLASSIFICATIONS, token).not.toContain(token);
      expect(STRICT_FALSE_CLASSIFICATIONS, token).not.toContain(token);
    }
    // And those three are untouched.
    expect(REASONING_DIFFERENTIAL_CLASSIFICATIONS).toHaveLength(7);
    expect(REASONING_BUDGET_8192_CLASSIFICATIONS).toHaveLength(7);
    expect(STRICT_FALSE_CLASSIFICATIONS).toHaveLength(7);
    expect(
      OPERATOR_EXIT_CODES.POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE,
    ).toBe(33);
  });

  it('2xx + wire FAIL -> WIRE_SCHEMA_INVALID', () => {
    expect(
      analyseLocalizedStructuredReply(
        base({ wireValidationPassed: false, productionValidationPassed: false }),
      ).classification,
    ).toBe('STRUCTURED_REPLY_WIRE_SCHEMA_INVALID');
  });

  it('2xx + wire PASS + projector FAIL -> POST_WIRE_PRODUCTION_INVARIANT_FAILED', () => {
    expect(
      analyseLocalizedStructuredReply(base({ productionValidationPassed: false })).classification,
    ).toBe('STRUCTURED_REPLY_POST_WIRE_PRODUCTION_INVARIANT_FAILED');
  });

  it('2xx + both PASS -> ACCEPTED', () => {
    expect(analyseLocalizedStructuredReply(base()).classification).toBe(
      'STRUCTURED_REPLY_ACCEPTED',
    );
  });

  it('2xx with the WIRE STAGE NEVER RUN -> INCONCLUSIVE, whatever production said', () => {
    // The defect owner review found. The runner keeps the wire schema optional for backward
    // compatibility, so this shape is reachable -- and an earlier revision read it as ACCEPTED, or
    // worse as POST_WIRE_PRODUCTION_INVARIANT_FAILED, which names a stage that never ran.
    for (const productionValidationPassed of [true, false]) {
      expect(
        analyseLocalizedStructuredReply(
          base({
            wireValidationCompleted: false,
            wireValidationPassed: false,
            productionValidationCompleted: true,
            productionValidationPassed,
          }),
        ).classification,
        String(productionValidationPassed),
      ).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
    }
  });

  it('never infers a wire PASS from the production projector result', () => {
    // Even a projector that passed cannot stand in for an unobserved wire stage: the whole point of
    // this vocabulary is OBSERVED stage provenance.
    const analysis = analyseLocalizedStructuredReply(
      base({
        wireValidationCompleted: false,
        wireValidationPassed: true,
        productionValidationCompleted: true,
        productionValidationPassed: true,
      }),
    );
    expect(analysis.classification).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
  });

  it('2xx + wire PASS + production NOT COMPLETED -> INCONCLUSIVE', () => {
    expect(
      analyseLocalizedStructuredReply(
        base({ productionValidationCompleted: false, productionValidationPassed: false }),
      ).classification,
    ).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
  });

  it('2xx with NEITHER stage run -> INCONCLUSIVE, never a verdict about a check that never ran', () => {
    expect(
      analyseLocalizedStructuredReply(
        base({
          wireValidationCompleted: false,
          wireValidationPassed: false,
          productionValidationCompleted: false,
          productionValidationPassed: false,
        }),
      ).classification,
    ).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
  });

  it('json_validate_failed -> PROVIDER_OUTPUT_INVALID; any other 400/413 -> REQUEST_REJECTED', () => {
    const refused = (
      code: 'JSON_VALIDATE_FAILED' | 'OTHER_OR_ABSENT',
      httpClass: 'BAD_REQUEST_400' | 'PAYLOAD_TOO_LARGE_413',
    ): string =>
      analyseLocalizedStructuredReply(
        base({
          providerHttpStatus: httpClass === 'BAD_REQUEST_400' ? 400 : 413,
          providerHttpClass: httpClass,
          providerErrorType: 'INVALID_REQUEST_ERROR',
          providerErrorCode: code,
          providerCompleted: false,
          wireValidationCompleted: false,
          wireValidationPassed: false,
          productionValidationCompleted: false,
          productionValidationPassed: false,
        }),
      ).classification;

    expect(refused('JSON_VALIDATE_FAILED', 'BAD_REQUEST_400')).toBe(
      'STRUCTURED_REPLY_PROVIDER_OUTPUT_INVALID',
    );
    // SFD1's canonical run was exactly this shape: HTTP 413.
    expect(refused('OTHER_OR_ABSENT', 'PAYLOAD_TOO_LARGE_413')).toBe(
      'STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED',
    );
  });

  it('429, infra and permission answers reach no localization verdict', () => {
    const read = (httpClass: 'RATE_LIMITED_429' | 'SERVER_5XX' | 'UNAUTHORIZED_401'): string =>
      analyseLocalizedStructuredReply(
        base({
          providerHttpClass: httpClass,
          providerCompleted: false,
          wireValidationCompleted: false,
          wireValidationPassed: false,
          productionValidationCompleted: false,
          productionValidationPassed: false,
        }),
      ).classification;
    expect(read('RATE_LIMITED_429')).toBe('STRUCTURED_REPLY_RATE_LIMITED');
    expect(read('SERVER_5XX')).toBe('STRUCTURED_REPLY_INFRA_INTERRUPTED');
    expect(read('UNAUTHORIZED_401')).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
  });

  it('reports INCONCLUSIVE when the probe never ran at all', () => {
    const analysis = analyseLocalizedStructuredReply(undefined);
    expect(analysis.classification).toBe('STRUCTURED_REPLY_INCONCLUSIVE');
    expect(analysis.wireValidationCompleted).toBe(false);
    expect(analysis.productionValidationCompleted).toBe(false);
  });
});
