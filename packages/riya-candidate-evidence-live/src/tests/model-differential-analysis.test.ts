/**
 * POST-NRA1 — the GPT-OSS-120B model differential: identity, one-variable proof, and classifier.
 *
 * ### What this run has to get right
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` and received HTTP 400 with
 * `JSON_VALIDATE_FAILED` — the same class RA1 met on the adversarial safety-derived turn. OAD3's `O2`
 * had already shown the same exact schema accepted at this budget with synthetic tiny messages.
 *
 * So the open question is whether the MODEL is the differentiator, and a differential is worthless
 * unless it moves one variable. These specs prove that mechanically: same capture, same messages, same
 * raw schema, same projected schema, same budget — and a different model id.
 *
 * ### The entitlement trap
 *
 * The governed smoke runs against the 20B configuration. It cannot establish that this account may
 * call 120B at all, so a 401, 403 or 404 is an ENTITLEMENT answer and never a model verdict. Reading
 * "your account cannot call this model" as "120B also rejects our schema" would retire the
 * differential on evidence that never touched it, so the classifier specs pin that boundary
 * exhaustively over the whole governed class vocabulary.
 */
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { CANDIDATE_MAX_COMPLETION_TOKENS, CANDIDATE_MODEL_ID } from '../candidate-release.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import {
  analyseModelDifferential,
  MODEL_DIFFERENTIAL_CLASSIFICATIONS,
} from '../internal/model-differential-classification.js';
import type { ModelDifferentialOutcome } from '../internal/model-differential-classification.js';
import {
  MODEL_DIFFERENTIAL_STEP_ID,
  NEUTRAL_CLIENT_STEP_ID,
  planModelDifferentialProbe,
  planNeutralClientProbe,
} from '../internal/operational-acceptance-plan.js';
import { PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES } from '../internal/provider-outcome-classes.js';
import {
  MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
  MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
  SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT,
  SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL,
} from '../model-differential-identity.js';
import { MODEL_DIFFERENTIAL_COMPLETION_BUDGET } from '../model-differential-port.js';
import {
  captureNeutralClientRiyaRequest,
  NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
} from '../neutral-client-diagnostic-request.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

let captured: CapturedProductionRiyaRequest;
let projectedSchema: unknown;

beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the real Riya schema must project');
  }
  projectedSchema = projection.schema;
});

describe('the differential model is DIAGNOSTIC-ONLY and production is untouched', () => {
  it('the production candidate model is still GPT-OSS-20B', () => {
    // The obvious way to run a 120B probe is to point this constant somewhere else. That would
    // change what every other governed run sends.
    expect(CANDIDATE_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(CANDIDATE_MODEL_ID).not.toBe(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID);
  });

  it('the differential model is 120B and the baseline names the production one', () => {
    expect(MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID).toBe('openai/gpt-oss-120b');
    expect(MODEL_DIFFERENTIAL_BASELINE_MODEL_ID).toBe(CANDIDATE_MODEL_ID);
  });

  it('the smoke does NOT claim entitlement to the differential model', () => {
    // A passing smoke says the credential works. It runs against the baseline configuration, so it
    // cannot say the account may call 120B — which is why 401/403/404 is inconclusive below.
    expect(SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT).toBe(false);
    expect(SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL).toBe(MODEL_DIFFERENTIAL_BASELINE_MODEL_ID);
  });

  it('no production path imports the diagnostic model identity', () => {
    // The differential model must reach exactly one run goal. A production module importing it would
    // make a diagnostic constant part of routing.
    for (const productionModule of ['riya-turn.ts', 'candidate-release.ts', 'candidate-ports.ts']) {
      const source = readFileSync(`${SRC}${productionModule}`, 'utf8');
      expect(source, productionModule).not.toContain('model-differential-identity');
      expect(source, productionModule).not.toContain('gpt-oss-120b');
    }
  });
});

describe('the differential moves ONE variable and reuses NRA1 exactly', () => {
  it('reuses the SAME neutral capture, not a second fixture', async () => {
    const again = await captureNeutralClientRiyaRequest();
    expect(JSON.stringify(again.messages)).toBe(JSON.stringify(captured.messages));
    expect(NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID).toBe('riya.diagnostic.neutral-client.01');
  });

  it('the differential probe differs from the neutral probe ONLY in identity', () => {
    const neutral = planNeutralClientProbe({
      projectedSchema,
      neutralMessages: captured.messages,
    });
    const differential = planModelDifferentialProbe({
      projectedSchema,
      neutralMessages: captured.messages,
    });

    // Step id is the ONE thing that must differ, so the two runs stay distinguishable on a receipt.
    expect(neutral.stepId).toBe(NEUTRAL_CLIENT_STEP_ID);
    expect(differential.stepId).toBe(MODEL_DIFFERENTIAL_STEP_ID);
    expect(differential.stepId).toBe('M0_EXACT_NEUTRAL_CLIENT_GPT_OSS_120B_STRICT');

    // Everything the provider actually receives is IDENTICAL — by object identity, not equality.
    expect(differential.schema).toBe(neutral.schema);
    expect(differential.messages).toBe(neutral.messages);
    expect(differential.messageSource).toBe(neutral.messageSource);
    expect(differential.messageSource).toBe('CAPTURED_NEUTRAL_CLIENT');
    expect(differential.derivedFromPath).toBe(neutral.derivedFromPath);
    expect(differential.probeKind).toBe(neutral.probeKind);
  });

  it('the schema it carries IS the current production projection', () => {
    const differential = planModelDifferentialProbe({
      projectedSchema,
      neutralMessages: captured.messages,
    });
    expect(differential.schema).toBe(projectedSchema);
    const reprojected = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
    expect(reprojected.ok).toBe(true);
    if (reprojected.ok) {
      expect(JSON.stringify(differential.schema)).toBe(JSON.stringify(reprojected.schema));
    }
  });

  it('the budget is the production one and the ceiling is held fixed', () => {
    // Groq documents both GPT-OSS models at a 65,536 output maximum, so moving the ceiling would add
    // a second variable to a one-variable differential.
    expect(MODEL_DIFFERENTIAL_COMPLETION_BUDGET).toBe(4096);
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
    // And the port writes no literal of its own for either number.
    const port = readFileSync(`${SRC}model-differential-port.ts`, 'utf8');
    expect(port).not.toMatch(/4_?096/);
    expect(port).not.toMatch(/65_?536/);
  });

  it('the differential plan refuses a document it cannot carry', () => {
    expect(() =>
      planModelDifferentialProbe({
        projectedSchema: { type: 'string' },
        neutralMessages: captured.messages,
      }),
    ).toThrow('QFJ_NEUTRAL_CLIENT_ROOT_NOT_OBJECT');
    expect(() => planModelDifferentialProbe({ projectedSchema, neutralMessages: [] })).toThrow(
      'QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING',
    );
  });
});

/** One differential row, at the fields that matter. */
function probe(fields: Partial<ModelDifferentialOutcome>): ModelDifferentialOutcome {
  return {
    stepId: MODEL_DIFFERENTIAL_STEP_ID,
    providerTransportStarted: true,
    providerHttpStatus: 200,
    providerHttpClass: 'SUCCESS_2XX',
    providerErrorType: 'NONE',
    providerErrorCode: 'NONE',
    providerCompleted: true,
    ...fields,
  };
}

describe('the differential classifier keeps entitlement out of the verdict', () => {
  it('publishes exactly the five governed outcomes', () => {
    expect([...MODEL_DIFFERENTIAL_CLASSIFICATIONS]).toEqual([
      'STRICT_120B_ACCEPTED',
      'STRICT_120B_PROVIDER_REJECTED',
      'STRICT_120B_RATE_LIMITED',
      'STRICT_120B_INFRA_INTERRUPTED',
      'STRICT_120B_INCONCLUSIVE',
    ]);
  });

  it('HTTP 200 with a completed provider is ACCEPTED', () => {
    const analysis = analyseModelDifferential(probe({}));
    expect(analysis.classification).toBe('STRICT_120B_ACCEPTED');
    expect(analysis.providerHttpStatus).toBe(200);
  });

  it('HTTP 400 with JSON_VALIDATE_FAILED is a provider rejection, codes preserved', () => {
    // The result that would mean the strict failure reproduces across BOTH GPT-OSS models.
    const analysis = analyseModelDifferential(
      probe({
        providerHttpStatus: 400,
        providerHttpClass: 'BAD_REQUEST_400',
        providerErrorType: 'INVALID_REQUEST_ERROR',
        providerErrorCode: 'JSON_VALIDATE_FAILED',
        providerCompleted: false,
      }),
    );
    expect(analysis.classification).toBe('STRICT_120B_PROVIDER_REJECTED');
    expect(analysis.providerErrorType).toBe('INVALID_REQUEST_ERROR');
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
  });

  it.each(['PAYLOAD_TOO_LARGE_413', 'UNPROCESSABLE_422'] as const)(
    '%s is also a contract rejection',
    (providerHttpClass) => {
      const analysis = analyseModelDifferential(
        probe({ providerHttpClass, providerHttpStatus: 413, providerCompleted: false }),
      );
      expect(analysis.classification).toBe('STRICT_120B_PROVIDER_REJECTED');
    },
  );

  it('HTTP 429 is RATE_LIMITED, never a rejection', () => {
    const analysis = analyseModelDifferential(
      probe({
        providerHttpStatus: 429,
        providerHttpClass: 'RATE_LIMITED_429',
        providerCompleted: false,
      }),
    );
    expect(analysis.classification).toBe('STRICT_120B_RATE_LIMITED');
    expect(analysis.classification).not.toBe('STRICT_120B_PROVIDER_REJECTED');
  });

  it.each(['UNAUTHORIZED_401', 'FORBIDDEN_403', 'NOT_FOUND_404', 'OTHER_HTTP'] as const)(
    '%s is INCONCLUSIVE — an entitlement answer, never a model verdict',
    (providerHttpClass) => {
      const analysis = analyseModelDifferential(
        probe({ providerHttpClass, providerHttpStatus: 401, providerCompleted: false }),
      );
      expect(analysis.classification).toBe('STRICT_120B_INCONCLUSIVE');
      expect(analysis.classification).not.toBe('STRICT_120B_PROVIDER_REJECTED');
    },
  );

  it.each([
    'TRANSPORT_THROW',
    'SERVER_5XX',
    'CAPACITY_498',
    'CANCELLED_499',
    'NOT_REACHED',
  ] as const)('%s is INFRA_INTERRUPTED', (providerHttpClass) => {
    const analysis = analyseModelDifferential(
      probe({ providerHttpClass, providerHttpStatus: 0, providerCompleted: false }),
    );
    expect(analysis.classification).toBe('STRICT_120B_INFRA_INTERRUPTED');
  });

  it('a probe that never ran is INCONCLUSIVE', () => {
    const analysis = analyseModelDifferential(undefined);
    expect(analysis.classification).toBe('STRICT_120B_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
  });

  it('EVERY governed class produces a published token, and only 400/413/422 reject', () => {
    // The exhaustive form: a class added to the observation vocabulary cannot reach a verdict by
    // falling through, because the classifier switches on the total role map with no default branch.
    for (const providerHttpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      const analysis = analyseModelDifferential(
        probe({
          providerHttpClass,
          providerHttpStatus: 400,
          providerCompleted: providerHttpClass === 'SUCCESS_2XX',
        }),
      );
      expect(MODEL_DIFFERENTIAL_CLASSIFICATIONS, providerHttpClass).toContain(
        analysis.classification,
      );
      expect(analysis.classification === 'STRICT_120B_PROVIDER_REJECTED', providerHttpClass).toBe(
        PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES.includes(providerHttpClass),
      );
    }
  });

  it('duplicates no HTTP logic — it maps from the shared role map', () => {
    const source = readFileSync(`${SRC}internal/model-differential-classification.ts`, 'utf8');
    expect(source).toContain('PROVIDER_OUTCOME_ROLE');
    // No status-range arithmetic of its own: the shared allowlist is the single source of truth.
    expect(source).not.toMatch(/providerHttpStatus\s*[<>]=?\s*[45]\d\d/u);
  });
});
