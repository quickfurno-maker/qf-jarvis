/**
 * POST-PR-131 SCHEMA DIFFERENTIAL HARNESS — the pure analysis, and its accounting.
 *
 * The S11 classifier collapsed a matrix carrying two independent findings into one causal token. The
 * repair there was to fix a precedence; here there is deliberately no precedence between feature
 * probes at all, because the probes are independent — R2 is a different real fragment, not R1 plus an
 * array. These specs pin that: every rejection survives into the reported set, and no single one is
 * ever promoted to "the cause".
 *
 * Pure fixtures throughout. No provider, no credential, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  SCHEMA_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  SCHEMA_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
  SCHEMA_DIFFERENTIAL_PROBE_REQUESTS,
  createSchemaDifferentialDiagnosticLedger,
} from '../accounting.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import { SCHEMA_PROBE_STEP_IDS } from '../internal/riya-schema-probe-matrix.js';
import type { SchemaProbeStepId } from '../internal/riya-schema-probe-matrix.js';
import {
  analyseSchemaProbeMatrix,
  SCHEMA_DIFFERENTIAL_CLASSIFICATIONS,
} from '../internal/schema-differential-classification.js';
import type { SchemaProbeOutcome } from '../internal/schema-differential-classification.js';
import { OPERATOR_RUN_GOALS } from '../internal/run-goal.js';

/** An accepted probe. */
function ok(stepId: SchemaProbeStepId): SchemaProbeOutcome {
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

/** A probe the PROVIDER refused. Reached the boundary and came back 400. */
function refused(stepId: SchemaProbeStepId): SchemaProbeOutcome {
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

/** A probe that never settled. Says nothing about the schema. */
function threw(stepId: SchemaProbeStepId): SchemaProbeOutcome {
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

/** The whole matrix accepted, with the named step ids overridden. */
function matrix(
  overrides: Partial<Record<SchemaProbeStepId, SchemaProbeOutcome>> = {},
): readonly SchemaProbeOutcome[] {
  return SCHEMA_PROBE_STEP_IDS.map((stepId) => overrides[stepId] ?? ok(stepId));
}

describe('the control is the only precedence', () => {
  it('a refused control is DIAGNOSTIC_INVALID_CONTROL, whatever else happened', () => {
    // Even with every other probe accepted, an unestablished envelope makes them unattributable.
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R0_MINIMAL_CONTROL: refused('R0_MINIMAL_CONTROL') }),
    );
    expect(analysis.classification).toBe('DIAGNOSTIC_INVALID_CONTROL');
  });

  it('a control that never settled is also INVALID_CONTROL', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R0_MINIMAL_CONTROL: threw('R0_MINIMAL_CONTROL') }),
    );
    expect(analysis.classification).toBe('DIAGNOSTIC_INVALID_CONTROL');
  });

  it('a matrix with no control at all is INVALID_CONTROL, not accepted', () => {
    const withoutControl = matrix().filter((one) => one.stepId !== 'R0_MINIMAL_CONTROL');
    expect(analyseSchemaProbeMatrix(withoutControl).classification).toBe(
      'DIAGNOSTIC_INVALID_CONTROL',
    );
  });

  it('an empty matrix is INVALID_CONTROL', () => {
    expect(analyseSchemaProbeMatrix([]).classification).toBe('DIAGNOSTIC_INVALID_CONTROL');
  });
});

describe('R8 ACCEPTED decides the summary, and every rejection is still preserved', () => {
  it('R2 rejected + R8 accepted is EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP', () => {
    // THE precedence fix. R8 is the exact D5 shape under this envelope: if the provider took it, the
    // historical D5 rejection is not reproduced in this run, and an isolated wrapper rejection cannot
    // headline the diagnostic as though the production schema were still refused.
    //
    // The previous revision returned ISOLATED_SCHEMA_FEATURE_REJECTION here.
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R2_SCALAR_ARRAY: refused('R2_SCALAR_ARRAY') }),
    );
    expect(analysis.classification).toBe('EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP');
    // The isolated finding survives in full — evidence about that wrapper shape, not hidden.
    expect([...analysis.rejectedStepIds]).toEqual(['R2_SCALAR_ARRAY']);
    expect([...analysis.acceptedStepIds]).toContain('R8_EXACT_PROJECTED_RIYA');
  });

  it('MULTIPLE wrapper rejections + R8 accepted keeps the acceptance summary and every id', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({
        R1_NUMERIC_ENUM_AS_NUMBER: refused('R1_NUMERIC_ENUM_AS_NUMBER'),
        R3_OBJECT_ARRAY: refused('R3_OBJECT_ARRAY'),
        R4_ANYOF_ARRAY_ITEMS: refused('R4_ANYOF_ARRAY_ITEMS'),
      }),
    );
    expect(analysis.classification).toBe('EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP');
    expect([...analysis.rejectedStepIds]).toEqual([
      'R1_NUMERIC_ENUM_AS_NUMBER',
      'R3_OBJECT_ARRAY',
      'R4_ANYOF_ARRAY_ITEMS',
    ]);
    expect([...analysis.acceptedStepIds]).toContain('R8_EXACT_PROJECTED_RIYA');
  });

  it('a GROUP rejection + R8 accepted also keeps the acceptance summary', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R7_EVOLUTION_GROUP: refused('R7_EVOLUTION_GROUP') }),
    );
    expect(analysis.classification).toBe('EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP');
    expect([...analysis.rejectedStepIds]).toEqual(['R7_EVOLUTION_GROUP']);
    expect([...analysis.acceptedStepIds]).toContain('R6_REPLY_GROUP');
  });
});

describe('when R8 is REJECTED, the wrappers say what kind of rejection it is', () => {
  it('R4 rejected + R8 rejected is ISOLATED_SCHEMA_FEATURE_REJECTION, both preserved', () => {
    // No monotonicity is assumed in either direction: this combination is OBSERVED, not derived.
    // A provider may refuse a minimal wrapper and accept the full document, or the reverse, and
    // finding out which is the entire purpose of an orthogonal matrix.
    const analysis = analyseSchemaProbeMatrix(
      matrix({
        R4_ANYOF_ARRAY_ITEMS: refused('R4_ANYOF_ARRAY_ITEMS'),
        R8_EXACT_PROJECTED_RIYA: refused('R8_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('ISOLATED_SCHEMA_FEATURE_REJECTION');
    expect([...analysis.rejectedStepIds]).toEqual([
      'R4_ANYOF_ARRAY_ITEMS',
      'R8_EXACT_PROJECTED_RIYA',
    ]);
  });

  it('several wrappers rejected + R8 rejected names no unique root cause', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({
        R2_SCALAR_ARRAY: refused('R2_SCALAR_ARRAY'),
        R5_NESTED_OBJECT_GROUP: refused('R5_NESTED_OBJECT_GROUP'),
        R8_EXACT_PROJECTED_RIYA: refused('R8_EXACT_PROJECTED_RIYA'),
      }),
    );
    expect(analysis.classification).toBe('ISOLATED_SCHEMA_FEATURE_REJECTION');
    // All three survive. Promoting one would be a guess.
    expect(analysis.rejectedStepIds).toHaveLength(3);
  });

  it('all wrappers accepted + R8 rejected is FULL_SCHEMA_COMPOSITION_REJECTED', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R8_EXACT_PROJECTED_RIYA: refused('R8_EXACT_PROJECTED_RIYA') }),
    );
    expect(analysis.classification).toBe('FULL_SCHEMA_COMPOSITION_REJECTED');
    expect([...analysis.rejectedStepIds]).toEqual(['R8_EXACT_PROJECTED_RIYA']);
  });
});

describe('the all-accepted reading', () => {
  it('everything accepted is the low-cap acceptance token, and nothing wider', () => {
    const analysis = analyseSchemaProbeMatrix(matrix());
    expect(analysis.classification).toBe('EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP');
    expect(analysis.rejectedStepIds).toHaveLength(0);
    expect(analysis.acceptedStepIds).toHaveLength(9);
    // The token names the cap it was established at, so it cannot be read as a statement about the
    // operational Riya budget or the production message shape.
    expect(analysis.classification).toContain('LOW_CAP');
  });
});

describe('incomplete matrices report uncertainty, not a finding', () => {
  it('a probe that never settled makes the whole reading MIXED_OR_INCONCLUSIVE', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R5_NESTED_OBJECT_GROUP: threw('R5_NESTED_OBJECT_GROUP') }),
    );
    expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
    expect([...analysis.inconclusiveStepIds]).toEqual(['R5_NESTED_OBJECT_GROUP']);
  });

  it('probes that never ran are reported as inconclusive rather than omitted', () => {
    // A ceiling cut the run short after four probes. The three lists must still reconstruct the
    // whole declared matrix, or a reader would not know what was skipped.
    const partial = [
      ok('R0_MINIMAL_CONTROL'),
      ok('R1_NUMERIC_ENUM_AS_NUMBER'),
      ok('R2_SCALAR_ARRAY'),
    ];
    const analysis = analyseSchemaProbeMatrix(partial);
    expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
    const all = [
      ...analysis.acceptedStepIds,
      ...analysis.rejectedStepIds,
      ...analysis.inconclusiveStepIds,
    ];
    expect(all.sort()).toEqual([...SCHEMA_PROBE_STEP_IDS].sort());
  });

  it('a transport throw is never counted as a schema rejection', () => {
    const analysis = analyseSchemaProbeMatrix(
      matrix({ R3_OBJECT_ARRAY: threw('R3_OBJECT_ARRAY') }),
    );
    expect(analysis.rejectedStepIds).not.toContain('R3_OBJECT_ARRAY');
    expect(analysis.inconclusiveStepIds).toContain('R3_OBJECT_ARRAY');
  });
});

describe('the vocabulary is closed', () => {
  it('the classification list is exactly the governed set', () => {
    expect([...SCHEMA_DIFFERENTIAL_CLASSIFICATIONS]).toEqual([
      'DIAGNOSTIC_INVALID_CONTROL',
      'ISOLATED_SCHEMA_FEATURE_REJECTION',
      'FULL_SCHEMA_COMPOSITION_REJECTED',
      'EXACT_PROJECTED_RIYA_SCHEMA_ACCEPTED_LOW_CAP',
      'MIXED_OR_INCONCLUSIVE',
    ]);
  });

  it('the analysis carries no field a provider body could occupy', () => {
    const serialized = JSON.stringify(analyseSchemaProbeMatrix(matrix()));
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

describe('the dedicated ledger', () => {
  it('the governed ceilings are ten requests and one dollar', () => {
    expect(SCHEMA_DIFFERENTIAL_PROBE_REQUESTS).toBe(9);
    expect(SCHEMA_DIFFERENTIAL_MAX_PROVIDER_REQUESTS).toBe(10);
    expect(SCHEMA_DIFFERENTIAL_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('accepts one smoke plus nine probes, and REFUSES the eleventh request', () => {
    const ledger = createSchemaDifferentialDiagnosticLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    for (let index = 0; index < SCHEMA_DIFFERENTIAL_PROBE_REQUESTS; index += 1) {
      const reservation = ledger.reserve('schema-probe');
      expect(reservation.ok, `probe ${String(index)}`).toBe(true);
      ledger.settle(undefined, true);
    }
    const eleventh = ledger.reserve('schema-probe');
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.refusal).toBe('request-limit-reached');
    }
  });

  it('counts probes APART from the historical canary diagnostic', () => {
    const ledger = createSchemaDifferentialDiagnosticLedger();
    ledger.reserve('smoke');
    ledger.settle(undefined, true);
    ledger.reserve('schema-probe');
    ledger.settle(undefined, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.schemaProbeProviderRequests).toBe(1);
    // S11's D1-D8 counter stays at zero: a receipt must be able to say which matrix ran.
    expect(snapshot.diagnosticProviderRequests).toBe(0);
    expect(snapshot.safetyProviderRequests).toBe(0);
    expect(snapshot.p10ProviderRequests).toBe(0);
    expect(snapshot.totalProviderRequests).toBe(2);
  });
});

describe('the historical S11 goal is untouched', () => {
  it('both diagnostic goals exist and are distinct', () => {
    expect([...OPERATOR_RUN_GOALS]).toEqual([
      'FULL_EVIDENCE',
      'SAFETY_REPLICATION',
      'REQUEST_CONTRACT_DIAGNOSTIC',
      'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
      'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
      'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
      'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
    ]);
  });

  it('the two diagnostics have different exit codes', () => {
    // A script reading `$LASTEXITCODE` must be able to tell the matrices apart.
    expect(OPERATOR_EXIT_CODES.REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE).toBe(23);
    expect(OPERATOR_EXIT_CODES.SCHEMA_DIFFERENTIAL_DIAGNOSTIC_COMPLETE).toBe(24);
    // And every pre-existing code keeps its integer.
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    expect(OPERATOR_EXIT_CODES.SAFETY_REPLICATION_COMPLETE).toBe(22);
  });
});
