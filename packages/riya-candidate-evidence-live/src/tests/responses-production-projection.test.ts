/**
 * POST-MD120B3 OWNER CORRECTION — the two layers of production acceptance, told apart.
 *
 * ### The defect this file exists to make impossible
 *
 * The first revision of the Responses endpoint differential decided `localValidationPassed` with
 * `structuredSchema.safeParse(...)`. That object is real and it is the gateway's own check at the
 * provider boundary — but it is the FIRST STAGE of production acceptance, not the whole of it.
 *
 * After the wire shape parses, `createRiyaConversationModelProfile(...).projectStructuredResult`
 * still requires: grounded citations the model was actually shown; an observation batch its canonical
 * constructor accepts, including the COMBINED duplicate, conflict and limit invariants; every
 * asserted service and location ref present in the availability snapshot; a prospective state the
 * reducer produces without refusing; and a claimed next-question plan that agrees with the
 * deterministic reducer's EXACTLY — phase and field order included.
 *
 * So a document can satisfy `WIRE_SCHEMA_SAFE_PARSE=PASS` while
 * `PRODUCTION_PROJECT_STRUCTURED_RESULT=FAIL`. Accepting one of those as
 * `RESPONSES_20B_STRICT_ACCEPTED` would be a FALSE-POSITIVE endpoint verdict — it would tell an owner
 * the Responses API repairs the strict path when production would refuse the very answer it returned,
 * which is the single worst thing this diagnostic could produce.
 *
 * These specs prove BOTH layers on BOTH fixtures, so the distinction cannot quietly collapse again.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from '../diagnostic-canary-materials.js';
import {
  captureNeutralClientRiyaRequest,
  NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
  NEUTRAL_CLIENT_DIAGNOSTIC_REQUEST,
} from '../neutral-client-diagnostic-request.js';
import { createRiyaEvaluationProfile } from '../riya-turn.js';
import { syntheticContinuityFor } from '../synthetic-context.js';
import { evolutionPayload } from './helpers/contract-valid-riya-response.js';

/** The turn request the neutral capture builds its profile from. Restated only to build a profile. */
const NEUTRAL_TURN_REQUEST = {
  caseId: NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
  syntheticUserText: NEUTRAL_CLIENT_DIAGNOSTIC_REQUEST.syntheticUserText,
  phase: 'NEED' as const,
  dataClass: NEUTRAL_CLIENT_DIAGNOSTIC_REQUEST.declaredDataClass,
  humanTakeoverActive: NEUTRAL_CLIENT_DIAGNOSTIC_REQUEST.humanTakeoverActive,
};

interface RiyaDocument {
  readonly reply: unknown;
  readonly evolution: {
    readonly version: number;
    readonly observations: unknown;
    readonly skipProjectDetails: boolean;
    readonly questionPlan: { readonly phase: string; readonly questionFields: readonly string[] };
  };
}

let captured: CapturedProductionRiyaRequest;
/** Built by the production reducer, so its claimed plan is the plan the reducer decides. */
let productionValid: RiyaDocument;
/** The SAME document with ONE field moved: a next-question phase the reducer did not decide. */
let wireValidProductionInvalid: RiyaDocument;

beforeAll(async () => {
  captured = await captureNeutralClientRiyaRequest();
  productionValid = evolutionPayload({
    current: syntheticContinuityFor('NEED', NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID),
    language: 'ENGLISH',
    citations: [],
  }) as RiyaDocument;
  // The invariant chosen is the reducer-agreement check, because it is the most stable one in the
  // production projector and the one the profile's own documentation calls the point of the
  // single-call design. The replacement phase is computed rather than hard-coded, so it can never
  // accidentally BE the decided phase: both values are members of the model-facing phase enum, so the
  // document stays wire-valid either way.
  const decidedPhase = productionValid.evolution.questionPlan.phase;
  wireValidProductionInvalid = {
    ...productionValid,
    evolution: {
      ...productionValid.evolution,
      questionPlan: {
        ...productionValid.evolution.questionPlan,
        phase: decidedPhase === 'SUMMARY' ? 'NEED' : 'SUMMARY',
      },
    },
  };
});

describe('the capture carries the FULL production acceptance authority', () => {
  it('exposes the projector as well as the first-stage wire schema', () => {
    expect(typeof captured.projectStructuredResult).toBe('function');
    expect(typeof captured.structuredWireSchema.safeParse).toBe('function');
  });

  it('the old shape-only field is GONE from the capture', () => {
    // A name that called `safeParse` "canonical" is what let shape stand in for acceptance. It is
    // not merely renamed away in prose — the field itself no longer exists, so nothing can reach it.
    expect(captured).not.toHaveProperty('canonicalStructuredSchema');
  });
});

describe('REQUIRED NEGATIVE — wire valid, production INVALID', () => {
  it('WIRE_SAFE_PARSE=PASS', () => {
    // Layer one passes. This is the whole danger: a shape-only gate would stop here and report
    // success.
    expect(captured.structuredWireSchema.safeParse(wireValidProductionInvalid).success).toBe(true);
  });

  it('FULL_PRODUCTION_PROJECTION=FAIL', () => {
    // Layer two refuses: the claimed next-question plan disagrees with the deterministic reducer.
    expect(captured.projectStructuredResult(wireValidProductionInvalid)).toBeUndefined();
  });

  it('the two layers genuinely DISAGREE on this document', () => {
    // Stated as one assertion so a future edit that made the fixture wire-invalid — and therefore
    // stopped testing the gap — fails loudly instead of passing for the wrong reason.
    const wire = captured.structuredWireSchema.safeParse(wireValidProductionInvalid).success;
    const production = captured.projectStructuredResult(wireValidProductionInvalid) !== undefined;
    expect({ wire, production }).toStrictEqual({ wire: true, production: false });
  });

  it('differs from the valid document in exactly the next-question phase', () => {
    // Proves the fixture isolates ONE production invariant rather than being broken in some
    // unrelated way that would make the negative result uninformative.
    expect(wireValidProductionInvalid.reply).toStrictEqual(productionValid.reply);
    expect(wireValidProductionInvalid.evolution.observations).toStrictEqual(
      productionValid.evolution.observations,
    );
    expect(wireValidProductionInvalid.evolution.questionPlan.questionFields).toStrictEqual(
      productionValid.evolution.questionPlan.questionFields,
    );
    expect(wireValidProductionInvalid.evolution.questionPlan.phase).not.toBe(
      productionValid.evolution.questionPlan.phase,
    );
  });
});

describe('REQUIRED POSITIVE — truly production valid', () => {
  it('WIRE_SAFE_PARSE=PASS', () => {
    expect(captured.structuredWireSchema.safeParse(productionValid).success).toBe(true);
  });

  it('FULL_PRODUCTION_PROJECTION=PASS, and yields a real projection', () => {
    // ACCEPTED must stay REACHABLE. A correction that only tightened the gate until nothing could
    // pass would be a different defect with the same test count.
    const projected = captured.projectStructuredResult(productionValid);
    expect(projected).toBeDefined();
    expect(projected?.reply).toBeDefined();
    expect(projected?.reply.kind).toBe('REPLY');
  });
});

describe('a wire-INVALID document is refused by BOTH layers', () => {
  it('a document missing required reply fields fails the wire schema and the projector', () => {
    const malformed = { reply: { kind: 'REPLY' } };
    expect(captured.structuredWireSchema.safeParse(malformed).success).toBe(false);
    expect(captured.projectStructuredResult(malformed)).toBeUndefined();
  });

  it('a non-object, a null and an empty object are all refused', () => {
    for (const value of [null, undefined, 42, 'text', {}, []]) {
      expect(captured.projectStructuredResult(value)).toBeUndefined();
    }
  });
});

describe('the projector is the profile the evaluation turn runs under', () => {
  it('the capture and a directly-built profile agree on BOTH fixtures', () => {
    // Shared CONSTRUCTION authority, proved by behaviour: the capture's projector and one built here
    // from the same request through the same exported helper reach the same verdicts. Instance
    // identity is deliberately not asserted — the profile is bound to one turn's context and fresh
    // deterministic instances are correct.
    const direct = createRiyaEvaluationProfile(NEUTRAL_TURN_REQUEST).profile;
    expect(direct.projectStructuredResult(productionValid)).toBeDefined();
    expect(direct.projectStructuredResult(wireValidProductionInvalid)).toBeUndefined();
    expect(captured.projectStructuredResult(productionValid)).toBeDefined();
    expect(captured.projectStructuredResult(wireValidProductionInvalid)).toBeUndefined();
  });

  it('the directly-built profile carries the SAME wire schema the capture rendered from', () => {
    const direct = createRiyaEvaluationProfile(NEUTRAL_TURN_REQUEST).profile;
    expect(direct.structuredSchema).toBe(captured.structuredWireSchema);
  });

  it('the evaluation turn builds its profile through the SAME one function', () => {
    // The structural half of the claim. `runRiyaEvaluationTurn` must not keep a second construction
    // site beside the helper — that is exactly how a capture and a turn drift apart.
    const turn = readTurnSource();
    expect(turn).toContain('createRiyaEvaluationProfile(request)');
    // Neither profile factory may be called anywhere else in the turn.
    expect(turn.match(/createRiyaConversationModelProfile\(/gu) ?? []).toHaveLength(1);
    expect(turn.match(/createRiyaGroundedReplyModelProfile\(/gu) ?? []).toHaveLength(1);
    // And both of those calls sit inside the helper, which is defined before the turn function.
    expect(turn.indexOf('export function createRiyaEvaluationProfile')).toBeLessThan(
      turn.indexOf('createRiyaConversationModelProfile('),
    );
    expect(turn.indexOf('createRiyaConversationModelProfile(')).toBeLessThan(
      turn.indexOf('export async function runRiyaEvaluationTurn'),
    );
  });
});

describe('the SAFETY-derived capture gets its own correctly-bound projector too', () => {
  it('the two captures carry independently-bound projectors', async () => {
    // The helper is per-request. A projector bound to the neutral turn must not be handed to the
    // safety-derived capture, or a future gate over that capture would validate against the wrong
    // continuity context.
    const safetyDerived = await captureProductionRiyaCanaryRequest();
    expect(typeof safetyDerived.projectStructuredResult).toBe('function');
    expect(safetyDerived.projectStructuredResult).not.toBe(captured.projectStructuredResult);
    // Both still refuse the plan-disagreeing document: they share the reducer, not the context.
    expect(safetyDerived.projectStructuredResult(wireValidProductionInvalid)).toBeUndefined();
  });
});

/** Read the turn's source. Kept in one place so the structural assertions above stay readable. */
function readTurnSource(): string {
  return readFileSync(fileURLToPath(new URL('../riya-turn.ts', import.meta.url)), 'utf8');
}
