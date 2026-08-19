/**
 * POST-S11 REQUEST-CONTRACT REPAIR — the offline schema audit and the next differential matrix.
 *
 * S11 spent one live authorization establishing that the real projected Riya schema is rejected (D5,
 * HTTP 400 at a 512 cap, behind controls that passed). It could not say WHICH part. These specs make
 * the next authorization narrower: they audit the exact document that went on the wire against every
 * rule of the documented strict subset that can be checked without a provider, and they build the
 * reduction ladder from the real schema rather than from a hypothesis.
 *
 * Nothing here reaches a network. The schema is obtained through the same production capture path the
 * D7/D8 canaries use, which reaches no provider, no transport and no credential.
 */
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { beforeAll, describe, expect, it } from 'vitest';

import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import { planRiyaSchemaProbeMatrix } from '../internal/riya-schema-probe-matrix.js';
import {
  planRiyaSchemaRepairVerification,
  SCHEMA_REPAIR_VERIFICATION_STEP_IDS,
} from '../internal/riya-schema-repair-verification-plan.js';
import type { SchemaRepairVerificationProbe } from '../internal/riya-schema-repair-verification-plan.js';
import { inventoryStrictSchema } from '../internal/strict-schema-inventory.js';
import type { StrictSchemaInventory } from '../internal/strict-schema-inventory.js';

/** The exact document D5 put on the wire: the real Riya schema, through the real HF4-R7 projection. */
let projected: unknown;
let inventory: StrictSchemaInventory;

beforeAll(async () => {
  const captured = await captureProductionRiyaCanaryRequest();
  const result = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!result.ok) {
    throw new Error(`the real Riya schema must project: ${result.reason}`);
  }
  projected = result.schema;
  inventory = inventoryStrictSchema(projected);
});

describe('the exact D5 document, audited offline', () => {
  it('projects, and its root is a closed object', () => {
    expect(projected).toBeDefined();
    expect(inventory.rootIsObject).toBe(true);
  });

  it('violates NO offline-checkable rule of the documented strict subset', () => {
    // THE load-bearing result of this phase. Every object is closed, every declared property is
    // required, every array has items, no unsupported keyword or reference survived projection.
    //
    // So the D5 rejection is NOT explained by anything checkable without a provider, and guessing a
    // keyword and changing production would be exactly the move this evidence forbids. The reduction
    // ladder below is the answer instead.
    expect([...inventory.findings]).toEqual([]);
  });

  it('uses only the documented keyword and type vocabulary', () => {
    expect([...inventory.keywordsUsed]).toEqual([
      'additionalProperties',
      'anyOf',
      'enum',
      'items',
      'properties',
      'required',
      'type',
    ]);
    for (const type of inventory.typesUsed) {
      expect(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']).toContain(type);
    }
    // HF4-R7/R1 removed every reference form; a survivor would be a regression in the projection.
    expect(inventory.keywordsUsed).not.toContain('$ref');
    expect(inventory.keywordsUsed).not.toContain('$defs');
  });

  it('records the structure that makes it different from every canary that PASSED', () => {
    // D1, D3 and D4 were flat two-level objects. The real document is not, and these numbers are the
    // gap the next diagnostic has to close.
    expect(inventory.maxDepth).toBeGreaterThan(2);
    expect(inventory.arrayCount).toBeGreaterThan(0);
    expect(inventory.anyOfCount).toBeGreaterThan(0);
    expect(inventory.objectCount).toBeGreaterThan(1);
    expect(inventory.propertyCount).toBeGreaterThan(0);
  });

  it('POST-SDH4 — the ANYOF_ARRAY_ITEMS dimension is GONE from the production schema', () => {
    // S11 tested a closed object with a string enum (D1), a nullable anyOf PROPERTY (D3) and a
    // numeric singleton enum (D4), and never sent an array of any kind or `anyOf` in ITEMS position.
    // SDH4 then sent exactly that items-position union and Groq refused it.
    //
    // The other structures the canaries never exercised are still present and still worth naming.
    for (const present of ['SCALAR_ARRAY', 'OBJECT_ARRAY', 'NESTED_OBJECT'] as const) {
      expect(inventory.dimensions).toContain(present);
    }
    // The rejected one is not.
    expect(inventory.dimensions).not.toContain('ANYOF_ARRAY_ITEMS');
    expect(inventory.anyOfCount).toBeGreaterThan(0);
  });

  it('is deterministic — the same schema inventories identically twice', () => {
    expect(JSON.stringify(inventoryStrictSchema(projected))).toBe(JSON.stringify(inventory));
  });

  it('carries nothing content-bearing', () => {
    const serialized = JSON.stringify(inventory);
    // Paths and counts only: no schema document, no message, no client turn, no model answer.
    expect(serialized).not.toContain('additionalProperties:');
    expect(serialized).not.toContain('replyBody');
    for (const forbidden of ['Bearer', 'sk-', 'authorization']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('the inventory FINDS a violation when one exists', () => {
    // The audit must be capable of failing, or "no findings" means nothing.
    const broken = inventoryStrictSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array' } },
      required: ['a'],
      // additionalProperties deliberately absent
    });
    const violations = broken.findings.map((one) => one.violation);
    expect(violations).toContain('OBJECT_NOT_CLOSED');
    expect(violations).toContain('REQUIRED_MISSING_PROPERTY');
    expect(violations).toContain('ARRAY_WITHOUT_ITEMS');
  });

  it('the inventory rejects surviving references and unsupported compositions', () => {
    const withRef = inventoryStrictSchema({
      type: 'object',
      properties: { a: { $ref: '#/$defs/x' } },
      required: ['a'],
      additionalProperties: false,
      $defs: { x: { type: 'string' } },
    });
    expect(withRef.findings.map((one) => one.violation)).toContain('REFERENCE_SURVIVED');

    const withOneOf = inventoryStrictSchema({
      type: 'object',
      properties: { a: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(withOneOf.findings.map((one) => one.violation)).toContain('UNSUPPORTED_COMPOSITION');
  });
});

describe('POST-SDH4 — the historical R0-R8 matrix can no longer be planned, and that is the proof', () => {
  it('planning the historical matrix over the REPAIRED schema fails loudly', () => {
    // SDH4 sent `R4_ANYOF_ARRAY_ITEMS` — the real `anyOf` object union under
    // `$.evolution.observations` array items — and Groq returned HTTP 400. The repair removed that
    // composition, so the historical planner can no longer locate the fragment it is named after.
    //
    // It THROWS rather than quietly re-pointing R4 at some other shape, which is exactly right: every
    // SDH4 receipt already says what R4 meant, and a planner that silently changed it would make the
    // immutable evidence unreadable. The failure is therefore a regression proof that the rejected
    // fragment is gone.
    expect(() => planRiyaSchemaProbeMatrix(projected)).toThrow(/DIMENSION_NOT_LOCATED_ANYOFARRAY/u);
  });

  it('the repaired document contains NO anyOf under any array items', () => {
    // The same fact, asserted structurally rather than through the planner.
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) {
        return;
      }
      const record = node as Record<string, unknown>;
      if (record['type'] === 'array') {
        const items = record['items'];
        if (typeof items === 'object' && items !== null) {
          expect(Array.isArray((items as Record<string, unknown>)['anyOf'])).toBe(false);
        }
      }
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          value.forEach(walk);
        } else {
          walk(value);
        }
      }
    };
    walk(projected);
  });

  it('the repaired document still violates NO offline-checkable strict rule', () => {
    // The repair must not have introduced a new problem while removing the old one.
    expect([...inventoryStrictSchema(projected).findings]).toEqual([]);
  });
});

describe('POST-SDH4 — the verification matrix IS derived from the repaired schema', () => {
  let probes: readonly SchemaRepairVerificationProbe[];
  beforeAll(() => {
    probes = planRiyaSchemaRepairVerification(projected);
  });

  it('has one probe per governed step id, in order', () => {
    expect(probes.map((one) => one.stepId)).toEqual([...SCHEMA_REPAIR_VERIFICATION_STEP_IDS]);
    // Five, not nine: verifying one structural change needs fewer questions than isolating an
    // unknown one did.
    expect(probes).toHaveLength(5);
  });

  it('every probe is a closed object schema with no offline-checkable violation', () => {
    for (const probe of probes) {
      const audit = inventoryStrictSchema(probe.schema);
      expect(audit.rootIsObject, probe.stepId).toBe(true);
      expect(
        audit.findings.map((one) => one.violation),
        probe.stepId,
      ).toEqual([]);
    }
  });

  it('each probe carries a REAL fragment located by path, and V4 is the exact document', () => {
    const byId = new Map(probes.map((one) => [one.stepId, one]));
    expect(byId.get('V1_OBSERVATION_SETS_ARRAY')?.derivedFromPath).toBe(
      '$.evolution.observations.sets',
    );
    expect(byId.get('V2_OBSERVATION_CLEARS_ARRAY')?.derivedFromPath).toBe(
      '$.evolution.observations.clears',
    );
    // Object identity, not a rebuild.
    expect(byId.get('V4_EXACT_PROJECTED_RIYA')?.schema).toBe(projected);
  });

  it('exactly one control and one exact probe, and the two arrays are independent', () => {
    expect(probes.filter((one) => one.probeKind === 'CONTROL').map((one) => one.stepId)).toEqual([
      'V0_MINIMAL_CONTROL',
    ]);
    expect(probes.filter((one) => one.probeKind === 'EXACT').map((one) => one.stepId)).toEqual([
      'V4_EXACT_PROJECTED_RIYA',
    ]);
    // V2 is not V1 plus a field — each wraps its own real array.
    const dimensionsOf = (stepId: string): readonly string[] =>
      inventoryStrictSchema(probes.find((one) => one.stepId === stepId)?.schema).dimensions;
    expect(dimensionsOf('V1_OBSERVATION_SETS_ARRAY')).toContain('OBJECT_ARRAY');
    expect(dimensionsOf('V2_OBSERVATION_CLEARS_ARRAY')).toContain('OBJECT_ARRAY');
    // And the control carries neither array.
    expect(dimensionsOf('V0_MINIMAL_CONTROL')).not.toContain('OBJECT_ARRAY');
  });

  it('is deterministic — two plans over the same schema are byte-identical', () => {
    expect(JSON.stringify(planRiyaSchemaRepairVerification(projected))).toBe(
      JSON.stringify(probes),
    );
  });

  it('refuses to plan over a document that is not the repaired shape', () => {
    expect(() => planRiyaSchemaRepairVerification({ type: 'string' })).toThrow(/ROOT_NOT_OBJECT/u);
    // A document whose observations is still an ARRAY is the pre-repair shape; verifying against it
    // would be verifying the wrong thing.
    expect(() =>
      planRiyaSchemaRepairVerification({
        type: 'object',
        properties: {
          evolution: {
            type: 'object',
            properties: { observations: { type: 'array', items: { type: 'object' } } },
            required: ['observations'],
            additionalProperties: false,
          },
        },
        required: ['evolution'],
        additionalProperties: false,
      }),
    ).toThrow(/OBSERVATIONS_NOT_A_CONTAINER/u);
  });
});
