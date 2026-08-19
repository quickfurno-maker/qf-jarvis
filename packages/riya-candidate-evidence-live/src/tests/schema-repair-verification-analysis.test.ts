/**
 * POST-SDH4 — the V0-V4 verification analysis.
 *
 * The precedence here has been wrong once already: an earlier revision counted ANY non-V4 rejection
 * as an observation-level finding, so `V3 + V4 rejected` reported
 * `REPAIRED_OBSERVATION_SCHEMA_REJECTED` in a run where BOTH observation arrays had been accepted on
 * their own. That is an attribution the evidence does not support — V3 carries a whole group and its
 * rejection says the group failed, not which member did.
 *
 * These specs pin each of the three exact-rejected cases as a distinct claim, and pin that only V1
 * and V2 can ever drive an observation-level conclusion.
 *
 * Pure fixtures. No provider, no credential, no network.
 */
import { describe, expect, it } from 'vitest';

import { SCHEMA_REPAIR_VERIFICATION_STEP_IDS } from '../internal/riya-schema-repair-verification-plan.js';
import type { SchemaRepairVerificationStepId } from '../internal/riya-schema-repair-verification-plan.js';
import {
  analyseSchemaRepairVerification,
  SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS,
} from '../internal/schema-repair-verification-classification.js';
import type { SchemaRepairProbeOutcome } from '../internal/schema-repair-verification-classification.js';

function ok(stepId: SchemaRepairVerificationStepId): SchemaRepairProbeOutcome {
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

/** Refused BY the provider: it reached the boundary and came back 400. */
function refused(stepId: SchemaRepairVerificationStepId): SchemaRepairProbeOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 400,
    providerHttpClass: 'BAD_REQUEST_400',
    providerErrorType: 'INVALID_REQUEST_ERROR',
    providerErrorCode: 'OTHER_OR_ABSENT',
    providerCompleted: false,
  };
}

/** Never settled. Says nothing about the schema. */
function threw(stepId: SchemaRepairVerificationStepId): SchemaRepairProbeOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 0,
    providerHttpClass: 'TRANSPORT_THROW',
    providerErrorType: 'NONE',
    providerErrorCode: 'NONE',
    providerCompleted: false,
  };
}

function matrix(
  overrides: Partial<Record<SchemaRepairVerificationStepId, SchemaRepairProbeOutcome>> = {},
): readonly SchemaRepairProbeOutcome[] {
  return SCHEMA_REPAIR_VERIFICATION_STEP_IDS.map((stepId) => overrides[stepId] ?? ok(stepId));
}

describe('the control is the first precedence', () => {
  it('a refused control is CONTROL_INVALID whatever else happened', () => {
    expect(
      analyseSchemaRepairVerification(matrix({ V0_MINIMAL_CONTROL: refused('V0_MINIMAL_CONTROL') }))
        .classification,
    ).toBe('CONTROL_INVALID');
  });

  it('an absent or unsettled control is also CONTROL_INVALID', () => {
    expect(analyseSchemaRepairVerification([]).classification).toBe('CONTROL_INVALID');
    expect(
      analyseSchemaRepairVerification(matrix({ V0_MINIMAL_CONTROL: threw('V0_MINIMAL_CONTROL') }))
        .classification,
    ).toBe('CONTROL_INVALID');
  });
});

describe('incompleteness outranks every schema finding', () => {
  it('a probe that never settled makes the reading MIXED_OR_INCONCLUSIVE', () => {
    const analysis = analyseSchemaRepairVerification(
      matrix({
        V1_OBSERVATION_SETS_ARRAY: threw('V1_OBSERVATION_SETS_ARRAY'),
        V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
    expect([...analysis.inconclusiveStepIds]).toEqual(['V1_OBSERVATION_SETS_ARRAY']);
  });

  it('probes that never ran are reported rather than omitted', () => {
    const analysis = analyseSchemaRepairVerification([ok('V0_MINIMAL_CONTROL')]);
    expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
    const all = [
      ...analysis.acceptedStepIds,
      ...analysis.rejectedStepIds,
      ...analysis.inconclusiveStepIds,
    ];
    expect(all.sort()).toEqual([...SCHEMA_REPAIR_VERIFICATION_STEP_IDS].sort());
  });
});

describe('V4 ACCEPTED decides the summary, and wrapper rejections survive', () => {
  it('V4 accepted with V1 rejected is still the acceptance token', () => {
    const analysis = analyseSchemaRepairVerification(
      matrix({ V1_OBSERVATION_SETS_ARRAY: refused('V1_OBSERVATION_SETS_ARRAY') }),
    );
    expect(analysis.classification).toBe('REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP');
    expect([...analysis.rejectedStepIds]).toEqual(['V1_OBSERVATION_SETS_ARRAY']);
    expect([...analysis.acceptedStepIds]).toContain('V4_EXACT_PROJECTED_RIYA');
  });

  it('everything accepted is the acceptance token with no rejections', () => {
    const analysis = analyseSchemaRepairVerification(matrix());
    expect(analysis.classification).toBe('REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP');
    expect(analysis.rejectedStepIds).toHaveLength(0);
    expect(analysis.acceptedStepIds).toHaveLength(5);
  });
});

describe('when V4 is REJECTED, only V1/V2 can name an OBSERVATION finding', () => {
  it('V1 + V4 rejected is REPAIRED_OBSERVATION_SCHEMA_REJECTED', () => {
    const analysis = analyseSchemaRepairVerification(
      matrix({
        V1_OBSERVATION_SETS_ARRAY: refused('V1_OBSERVATION_SETS_ARRAY'),
        V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('REPAIRED_OBSERVATION_SCHEMA_REJECTED');
    expect([...analysis.rejectedStepIds]).toEqual([
      'V1_OBSERVATION_SETS_ARRAY',
      'V4_EXACT_PROJECTED_RIYA',
    ]);
  });

  it('V2 + V4 rejected is REPAIRED_OBSERVATION_SCHEMA_REJECTED', () => {
    const analysis = analyseSchemaRepairVerification(
      matrix({
        V2_OBSERVATION_CLEARS_ARRAY: refused('V2_OBSERVATION_CLEARS_ARRAY'),
        V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('REPAIRED_OBSERVATION_SCHEMA_REJECTED');
    expect([...analysis.rejectedStepIds]).toEqual([
      'V2_OBSERVATION_CLEARS_ARRAY',
      'V4_EXACT_PROJECTED_RIYA',
    ]);
  });

  it('THE CORRECTED CASE — V3 + V4 rejected with V1/V2 accepted is a GROUP finding', () => {
    // The bug this replaces: the old predicate counted any non-V4 rejection, so this reported
    // REPAIRED_OBSERVATION_SCHEMA_REJECTED even though both observation arrays were ACCEPTED alone.
    // V3 carries a whole group; its rejection cannot name a member.
    const analysis = analyseSchemaRepairVerification(
      matrix({
        V3_EVOLUTION_GROUP: refused('V3_EVOLUTION_GROUP'),
        V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('REPAIRED_EVOLUTION_GROUP_REJECTED');
    expect(analysis.classification).not.toBe('REPAIRED_OBSERVATION_SCHEMA_REJECTED');
    // Both observation arrays stood on their own, and that is visible.
    expect([...analysis.acceptedStepIds]).toContain('V1_OBSERVATION_SETS_ARRAY');
    expect([...analysis.acceptedStepIds]).toContain('V2_OBSERVATION_CLEARS_ARRAY');
    expect([...analysis.rejectedStepIds]).toEqual([
      'V3_EVOLUTION_GROUP',
      'V4_EXACT_PROJECTED_RIYA',
    ]);
  });

  it('an observation rejection outranks a group rejection when BOTH are present', () => {
    // V1 refused alone is a fact about the repair itself, which is the stronger claim.
    const analysis = analyseSchemaRepairVerification(
      matrix({
        V1_OBSERVATION_SETS_ARRAY: refused('V1_OBSERVATION_SETS_ARRAY'),
        V3_EVOLUTION_GROUP: refused('V3_EVOLUTION_GROUP'),
        V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('REPAIRED_OBSERVATION_SCHEMA_REJECTED');
    expect(analysis.rejectedStepIds).toHaveLength(3);
  });

  it('ONLY V4 rejected is a FULL SCHEMA composition finding', () => {
    const analysis = analyseSchemaRepairVerification(
      matrix({ V4_EXACT_PROJECTED_RIYA: refused('V4_EXACT_PROJECTED_RIYA') }),
    );
    expect(analysis.classification).toBe('REPAIRED_FULL_SCHEMA_COMPOSITION_REJECTED');
    expect([...analysis.rejectedStepIds]).toEqual(['V4_EXACT_PROJECTED_RIYA']);
  });
});

describe('the vocabulary is closed and distinct from the historical one', () => {
  it('the classification list is exactly the governed set', () => {
    expect([...SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS]).toEqual([
      'CONTROL_INVALID',
      'REPAIRED_EXACT_SCHEMA_ACCEPTED_LOW_CAP',
      'REPAIRED_OBSERVATION_SCHEMA_REJECTED',
      'REPAIRED_EVOLUTION_GROUP_REJECTED',
      'REPAIRED_FULL_SCHEMA_COMPOSITION_REJECTED',
      'MIXED_OR_INCONCLUSIVE',
    ]);
  });

  it('no historical SDH4 token can be produced from a verification matrix', () => {
    // SDH4's tokens describe the PRE-repair schema. A verification run must never emit one.
    for (const historical of [
      'ISOLATED_SCHEMA_FEATURE_REJECTION',
      'FULL_SCHEMA_COMPOSITION_REJECTED',
      'EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP',
      'DIAGNOSTIC_INVALID_CONTROL',
    ]) {
      expect([...SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS]).not.toContain(historical);
    }
  });

  it('carries no field a provider body could occupy', () => {
    const serialized = JSON.stringify(analyseSchemaRepairVerification(matrix()));
    for (const forbidden of [
      'Bearer',
      'sk-',
      'authorization',
      'replyBody',
      'additionalProperties',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
