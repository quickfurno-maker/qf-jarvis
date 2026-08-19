/**
 * POST-SRV1 — the operational acceptance PLAN and its CLASSIFIER, proved without a network.
 *
 * ### What these specs are guarding
 *
 * Two defects have already been shipped and caught by an owner in this family of harnesses, and both
 * are invisible to a spec that only checks the happy path.
 *
 * The first is a plan that quietly measures the wrong thing: a probe derived from a hand-written
 * fragment rather than from the real projected document, or a "representative" probe that carries the
 * synthetic messages after all. So the plan specs assert PROVENANCE — same object identity, real
 * projected subtree, captured messages — not merely that four probes came back.
 *
 * The second is a classifier whose precedence masks the finding, which happened twice: S11 assumed a
 * single cause, and PR #132 inverted acceptance precedence outright. So the classifier specs walk
 * every branch and, for each, also assert what the OTHER buckets say — because a summary token that is
 * right while its buckets are wrong is a receipt an owner cannot act on.
 */
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { beforeAll, describe, expect, it } from 'vitest';

import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import { SYNTHETIC_CANARY_MESSAGES } from '../diagnostic-canary-port.js';
import {
  OPERATIONAL_ACCEPTANCE_STEP_IDS,
  planOperationalAcceptance,
} from '../internal/operational-acceptance-plan.js';
import type {
  OperationalAcceptanceProbe,
  OperationalAcceptanceStepId,
} from '../internal/operational-acceptance-plan.js';
import {
  analyseOperationalAcceptance,
  OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS,
} from '../internal/operational-acceptance-classification.js';
import type { OperationalAcceptanceOutcome } from '../internal/operational-acceptance-classification.js';

let captured: CapturedProductionRiyaRequest;
let projectedSchema: unknown;
let probes: readonly OperationalAcceptanceProbe[];

beforeAll(async () => {
  captured = await captureProductionRiyaCanaryRequest();
  const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!projection.ok) {
    throw new Error('the real Riya schema must project');
  }
  projectedSchema = projection.schema;
  probes = planOperationalAcceptance({
    projectedSchema,
    syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
    representativeMessages: captured.messages,
  });
});

function probeFor(stepId: OperationalAcceptanceStepId): OperationalAcceptanceProbe {
  const found = probes.find((one) => one.stepId === stepId);
  if (found === undefined) {
    throw new Error(`the plan must contain ${stepId}`);
  }
  return found;
}

describe('the plan derives every probe from the ONE real projected document', () => {
  it('plans exactly O0-O3, in order, once each', () => {
    expect(probes.map((one) => one.stepId)).toEqual([...OPERATIONAL_ACCEPTANCE_STEP_IDS]);
    expect(probes).toHaveLength(4);
  });

  it('O0 carries the minimal CONTROL schema and nothing from the real document', () => {
    const control = probeFor('O0_MINIMAL_CONTROL_OPERATIONAL');
    expect(control.probeKind).toBe('CONTROL');
    expect(control.schema).toEqual({
      type: 'object',
      properties: { ok: { type: 'string', enum: ['OK'] } },
      required: ['ok'],
      additionalProperties: false,
    });
    // A control built from the real document would not be a control.
    expect(control.schema).not.toBe(projectedSchema);
  });

  it('O1 is derived from the REAL projected $.evolution subtree, by identity', () => {
    const group = probeFor('O1_EVOLUTION_GROUP_OPERATIONAL');
    expect(group.derivedFromPath).toBe('$.evolution');
    const realEvolution = (
      (projectedSchema as { properties: Record<string, unknown> }).properties
    )['evolution'];
    const wrapped = group.schema as { properties: Record<string, unknown> };
    // Object IDENTITY, not deep equality: a re-derived or hand-written copy would pass `toEqual`
    // while measuring a document the provider is never sent.
    expect(wrapped.properties['evolution']).toBe(realEvolution);
    expect(wrapped.properties['evolution']).not.toBe(projectedSchema);
  });

  it('O2 IS the current projected production Riya schema, not a copy of it', () => {
    const exact = probeFor('O2_EXACT_SYNTHETIC_OPERATIONAL');
    expect(exact.schema).toBe(projectedSchema);
    // And the projection is the production one, re-derived here independently of the plan.
    const reprojected = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
    expect(reprojected.ok).toBe(true);
    if (reprojected.ok) {
      expect(exact.schema).toEqual(reprojected.schema);
    }
  });

  it('O3 carries EXACTLY the same schema object as O2', () => {
    const synthetic = probeFor('O2_EXACT_SYNTHETIC_OPERATIONAL');
    const representative = probeFor('O3_EXACT_REPRESENTATIVE_OPERATIONAL');
    // The pair's entire evidentiary value: identical by CONSTRUCTION, so a disagreement between them
    // cannot be a schema difference someone failed to notice.
    expect(representative.schema).toBe(synthetic.schema);
    expect(JSON.stringify(representative.schema)).toBe(JSON.stringify(synthetic.schema));
    expect(representative.derivedFromPath).toBe(synthetic.derivedFromPath);
  });

  it('O0, O1 and O2 carry the synthetic messages; O3 carries the CAPTURED ones', () => {
    for (const stepId of [
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
    ] as const) {
      const probe = probeFor(stepId);
      expect(probe.messageSource).toBe('SYNTHETIC_TINY');
      expect(probe.messages).toBe(SYNTHETIC_CANARY_MESSAGES);
    }
    const representative = probeFor('O3_EXACT_REPRESENTATIVE_OPERATIONAL');
    expect(representative.messageSource).toBe('CAPTURED_REPRESENTATIVE');
    // From `captureProductionRiyaCanaryRequest()`, by identity — never reconstructed.
    expect(representative.messages).toBe(captured.messages);
    expect(representative.messages).not.toBe(SYNTHETIC_CANARY_MESSAGES);
    expect(representative.messages.length).toBeGreaterThan(0);
  });

  it('the plan refuses to run rather than silently measure three probes as four', () => {
    expect(() =>
      planOperationalAcceptance({
        projectedSchema: { type: 'string' },
        syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
        representativeMessages: captured.messages,
      }),
    ).toThrow('QFJ_OPERATIONAL_ACCEPTANCE_ROOT_NOT_OBJECT');
    expect(() =>
      planOperationalAcceptance({
        projectedSchema: { type: 'object', properties: {} },
        syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
        representativeMessages: captured.messages,
      }),
    ).toThrow('QFJ_OPERATIONAL_ACCEPTANCE_EVOLUTION_NOT_LOCATED');
    expect(() =>
      planOperationalAcceptance({
        projectedSchema,
        syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
        // O3 is the point of the run; a plan whose strongest probe carried nothing would be a plan
        // that measured O2 twice and reported it as a representative result.
        representativeMessages: [],
      }),
    ).toThrow('QFJ_OPERATIONAL_ACCEPTANCE_REPRESENTATIVE_MESSAGES_MISSING');
  });
});

/** An accepted row: the provider TOOK the request. */
function ok(stepId: OperationalAcceptanceStepId): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 200,
    providerHttpClass: 'SUCCESS_2XX',
    providerErrorType: 'NONE',
    providerErrorCode: 'NONE',
    providerCompleted: true,
  };
}

/** A rejected row. Defaults to the code SRV1 actually saw, so precedence is walked over real data. */
function refused(
  stepId: OperationalAcceptanceStepId,
  providerErrorCode: 'JSON_VALIDATE_FAILED' | 'OTHER_OR_ABSENT' = 'JSON_VALIDATE_FAILED',
): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 400,
    providerHttpClass: 'BAD_REQUEST_400',
    providerErrorType: 'INVALID_REQUEST_ERROR',
    providerErrorCode,
    providerCompleted: false,
  };
}

/** Never settled: the wire threw. Distinct from a refusal, and it must stay distinct. */
function threw(stepId: OperationalAcceptanceStepId): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 0,
    providerHttpClass: 'TRANSPORT_THROW',
    providerErrorType: 'OTHER_OR_ABSENT',
    providerErrorCode: 'NONE',
    providerCompleted: false,
  };
}

const ALL: readonly OperationalAcceptanceStepId[] = OPERATIONAL_ACCEPTANCE_STEP_IDS;

describe('the classifier reports the strongest supported claim and never more', () => {
  it('publishes exactly the six governed outcomes', () => {
    expect([...OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS]).toEqual([
      'OPERATIONAL_CONTROL_INVALID',
      'OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
      'OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED',
      'OPERATIONAL_FULL_SCHEMA_REJECTED',
      'OPERATIONAL_EVOLUTION_GROUP_REJECTED',
      'MIXED_OR_INCONCLUSIVE',
    ]);
  });

  it('a refused CONTROL invalidates the run whatever the rest did', () => {
    const analysis = analyseOperationalAcceptance([
      refused('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      ok('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    // Three accepted probes must NOT buy a headline: the envelope itself was refused, so nothing
    // after it is attributable to the schema or the messages.
    expect(analysis.classification).toBe('OPERATIONAL_CONTROL_INVALID');
    expect(analysis.acceptedStepIds).toEqual([
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
      'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
    ]);
    expect(analysis.rejectedStepIds).toEqual(['O0_MINIMAL_CONTROL_OPERATIONAL']);
  });

  it('an ACCEPTED O3 is the headline, and a surprising O1 rejection cannot overturn it', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      refused('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      ok('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe('OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED');
    // The rejection stays VISIBLE as a fact about that fragment rather than being dropped.
    expect(analysis.rejectedStepIds).toEqual(['O1_EVOLUTION_GROUP_OPERATIONAL']);
  });

  it('O2 accepted with O3 refused implicates the MESSAGE SHAPE and says only that', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      refused('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe('OPERATIONAL_REPRESENTATIVE_MESSAGE_SHAPE_REJECTED');
    expect(analysis.rejectedStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);
    expect(analysis.inconclusiveStepIds).toEqual([]);
  });

  it('O1 accepted with O2 and O3 refused implicates the FULL DOCUMENT', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      refused('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      refused('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe('OPERATIONAL_FULL_SCHEMA_REJECTED');
    expect(analysis.acceptedStepIds).toEqual([
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'O1_EVOLUTION_GROUP_OPERATIONAL',
    ]);
  });

  it('O1, O2 and O3 all refused says the budget was not what SRV1 was seeing', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      refused('O1_EVOLUTION_GROUP_OPERATIONAL'),
      refused('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      refused('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe('OPERATIONAL_EVOLUTION_GROUP_REJECTED');
    expect(analysis.acceptedStepIds).toEqual(['O0_MINIMAL_CONTROL_OPERATIONAL']);
  });

  it('an incomplete matrix or a transport throw supports no conclusion', () => {
    const missing = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
    ]);
    expect(missing.classification).toBe('MIXED_OR_INCONCLUSIVE');
    expect(missing.inconclusiveStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);

    const thrown = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      threw('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    // A wire that never answered is NOT a refusal: reading it as one would invent a provider verdict.
    expect(thrown.classification).toBe('MIXED_OR_INCONCLUSIVE');
    expect(thrown.rejectedStepIds).toEqual([]);
    expect(thrown.inconclusiveStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);
  });

  it('EVERY declared step id lands in exactly one bucket, in every branch', () => {
    const matrices: readonly (readonly OperationalAcceptanceOutcome[])[] = [
      [],
      ALL.map((id) => ok(id)),
      ALL.map((id) => refused(id)),
      ALL.map((id) => threw(id)),
      [
        ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
        refused('O1_EVOLUTION_GROUP_OPERATIONAL'),
        threw('O2_EXACT_SYNTHETIC_OPERATIONAL'),
        ok('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
      ],
    ];
    for (const matrix of matrices) {
      const analysis = analyseOperationalAcceptance(matrix);
      const all = [
        ...analysis.acceptedStepIds,
        ...analysis.rejectedStepIds,
        ...analysis.inconclusiveStepIds,
      ];
      // No id is dropped, and none is double-counted — a bucket that lost a rejection would let a
      // reader conclude a probe was never sent.
      expect([...all].sort()).toEqual([...ALL].sort());
      expect(new Set(all).size).toBe(ALL.length);
      expect(OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS).toContain(analysis.classification);
    }
  });

  it('the provider error code survives the analysis unchanged, per rejected step', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      refused('O1_EVOLUTION_GROUP_OPERATIONAL', 'JSON_VALIDATE_FAILED'),
      refused('O2_EXACT_SYNTHETIC_OPERATIONAL', 'OTHER_OR_ABSENT'),
      refused('O3_EXACT_REPRESENTATIVE_OPERATIONAL', 'JSON_VALIDATE_FAILED'),
    ]);
    // "400 with json_validate_failed" and "400 with something else" are different findings, and an
    // analysis that flattened them would cost the next authorization.
    expect(analysis.rejectedErrorCodes).toEqual([
      { stepId: 'O1_EVOLUTION_GROUP_OPERATIONAL', providerErrorCode: 'JSON_VALIDATE_FAILED' },
      { stepId: 'O2_EXACT_SYNTHETIC_OPERATIONAL', providerErrorCode: 'OTHER_OR_ABSENT' },
      { stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL', providerErrorCode: 'JSON_VALIDATE_FAILED' },
    ]);
    // Accepted and never-settled steps contribute no code, so the list cannot be read as a count.
    expect(analysis.rejectedErrorCodes).toHaveLength(analysis.rejectedStepIds.length);
  });
});
