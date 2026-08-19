/**
 * POST-SDH4 — the SPLIT observation representation, and the semantics it must not have changed.
 *
 * RUN SDH4 sent the real `anyOf` object union under `$.evolution.observations` array items and Groq
 * returned HTTP 400; the two probes containing it failed the same way while every other probe was
 * accepted. The repair replaces that array-of-union with a closed container carrying two separately
 * typed arrays, so the array a payload sits in becomes the operation discriminator.
 *
 * The whole risk of a representational change is that it quietly moves the accepted language. These
 * specs pin that it did not: every RWC-P4A rule the union expressed is still enforced, and the
 * cross-array invariants the schema cannot express are re-proved by the canonical constructor.
 */
import { describe, expect, it } from 'vitest';

import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';

import { createRiyaConversationModelProfile, parseRiyaModelProfileDetail } from '../profile.js';
import { riyaStructuredOutputSchema } from '../internal/output-schema.js';

const AVAILABILITY = parseCoreServiceAvailabilitySnapshotV1({
  version: 1,
  snapshotRef: 'core.snapshot.observation.repair.v1',
  taxonomyVersion: 1,
  cities: [{ ref: 'city.alpha', displayName: 'City Alpha' }],
  services: [{ ref: 'service.alpha', displayName: 'Service Alpha' }],
  availability: [{ serviceRef: 'service.alpha', cityRefs: ['city.alpha'] }],
});

const continuity = () =>
  createRiyaConversationContinuityState({
    version: 1,
    tenantId: 'tenant.observation.repair',
    conversationId: 'conv.observation.repair',
    continuityRevision: 1,
    phase: 'NEED',
    discovery: { completeness: 'MORE_DISCOVERY_REQUIRED' },
    summaryConfirmed: false,
  });

const profile = () =>
  createRiyaConversationModelProfile({
    current: continuity(),
    availabilitySnapshot: AVAILABILITY,
  });

/** Build a whole answer around one observation container, with a plan the reducer agrees with. */
function answer(
  observations: { readonly sets: readonly unknown[]; readonly clears: readonly unknown[] },
  canonicalForPlan: readonly Record<string, unknown>[] = [],
): unknown {
  const decided = evolveRiyaConversation({
    current: continuity(),
    batch: { version: 1, observations: canonicalForPlan as never, skipProjectDetails: false },
  }).questionPlan;
  return {
    reply: { kind: 'REPLY', replyBody: 'Thanks — noted.', reasonCode: null, citations: [] },
    evolution: {
      version: 1,
      observations,
      skipProjectDetails: false,
      questionPlan: { phase: decided.phase, questionFields: [...decided.questionFields] },
    },
  };
}

const SET = (field: string, value: string, provenance = 'user_stated') => ({
  field,
  value,
  provenance,
});
const CLEAR = (field: string) => ({ field, provenance: 'user_stated' });
const canonicalSet = (field: string, value: string, provenance = 'user_stated') => ({
  field,
  operation: 'SET',
  value,
  provenance,
});

/** One canonical observation, as the batch exposes it. Narrowed so no `any` reaches an assertion. */
interface CanonicalObservation {
  readonly field: string;
  readonly operation: string;
  readonly value?: string;
  readonly provenance: string;
}

/**
 * The canonical observations a projection produced.
 *
 * The profile's detail crosses as `unknown` by contract, so it is re-parsed through the production
 * guard rather than cast — the same path `parseRiyaModelProfileDetail` gives every other consumer.
 */
function canonicalObservations(projection: unknown): readonly CanonicalObservation[] {
  const detail = parseRiyaModelProfileDetail(
    (projection as { readonly detail?: unknown } | undefined)?.detail,
  );
  return detail?.observationBatch.observations ?? [];
}

describe('A/B/C/D — the operation is recovered from WHICH array a payload sat in', () => {
  it('A — SET only becomes a canonical SET carrying its value and provenance', () => {
    const projected = profile().projectStructuredResult(
      answer({ sets: [SET('budget', 'around 8 lakh')], clears: [] }, [
        canonicalSet('budget', 'around 8 lakh'),
      ]),
    );
    expect(projected).toBeDefined();
    const observations = canonicalObservations(projected);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      field: 'budget',
      operation: 'SET',
      value: 'around 8 lakh',
      provenance: 'user_stated',
    });
  });

  it('B — CLEAR only becomes a canonical CLEAR with NO value', () => {
    const projected = profile().projectStructuredResult(
      answer({ sets: [], clears: [CLEAR('budget')] }, []),
    );
    expect(projected).toBeDefined();
    const observation = canonicalObservations(projected)[0];
    expect(observation).toMatchObject({
      field: 'budget',
      operation: 'CLEAR',
      provenance: 'user_stated',
    });
    // Absence, not null. A CLEAR names no value at any layer.
    expect(observation === undefined ? undefined : 'value' in observation).toBe(false);
  });

  it('C — mixed SET + CLEAR both cross, in a deterministic sets-then-clears order', () => {
    const projected = profile().projectStructuredResult(
      answer({ sets: [SET('budget', 'around 8 lakh')], clears: [CLEAR('timeline')] }, [
        canonicalSet('budget', 'around 8 lakh'),
      ]),
    );
    expect(projected).toBeDefined();
    const observations = canonicalObservations(projected);
    expect(observations.map((one) => [one.field, one.operation])).toEqual([
      ['budget', 'SET'],
      ['timeline', 'CLEAR'],
    ]);
  });

  it('D — a model_inferred SET is accepted', () => {
    const projected = profile().projectStructuredResult(
      answer({ sets: [SET('budget', 'around 8 lakh', 'model_inferred')], clears: [] }, [
        canonicalSet('budget', 'around 8 lakh', 'model_inferred'),
      ]),
    );
    expect(projected).toBeDefined();
    expect(canonicalObservations(projected)[0]).toMatchObject({
      provenance: 'model_inferred',
    });
  });
});

describe('E/F/G — the language the schema refuses is exactly what it refused before', () => {
  const accepts = (observations: unknown): boolean =>
    riyaStructuredOutputSchema.safeParse(
      answer(observations as { sets: readonly unknown[]; clears: readonly unknown[] }),
    ).success;

  it('E — a model_inferred CLEAR is STRUCTURALLY impossible', () => {
    // An inference may not withdraw a fact. The clears item pins provenance to the literal, so this
    // is refused by the schema rather than by a later check.
    expect(accepts({ sets: [], clears: [{ field: 'budget', provenance: 'model_inferred' }] })).toBe(
      false,
    );
  });

  it('E — a CLEAR carrying a value is refused, including value:null', () => {
    // The clears item has no `value` property at all, so `.strict()` refuses the key whatever it
    // holds. Representing it as nullable would have ACCEPTED null and widened the language.
    expect(
      accepts({ sets: [], clears: [{ field: 'budget', provenance: 'user_stated', value: 'x' }] }),
    ).toBe(false);
    expect(
      accepts({ sets: [], clears: [{ field: 'budget', provenance: 'user_stated', value: null }] }),
    ).toBe(false);
  });

  it('E — a SET without a value is refused', () => {
    expect(accepts({ sets: [{ field: 'budget', provenance: 'user_stated' }], clears: [] })).toBe(
      false,
    );
  });

  it('F — an extra key in a set item, a clear item, or the container is refused', () => {
    expect(accepts({ sets: [{ ...SET('budget', 'x'), extra: 1 }], clears: [] })).toBe(false);
    expect(accepts({ sets: [], clears: [{ ...CLEAR('budget'), extra: 1 }] })).toBe(false);
    expect(accepts({ sets: [], clears: [], extra: 1 })).toBe(false);
  });

  it('F — an operation tag is now an EXTRA key, and refused', () => {
    // The tag moved to the array. Sending it anyway is an unknown property.
    expect(accepts({ sets: [{ ...SET('budget', 'x'), operation: 'SET' }], clears: [] })).toBe(
      false,
    );
  });

  it('F — both arrays are REQUIRED; an omitted one is refused', () => {
    // Groq strict mode has no absent property: "no clears" is an empty array, said out loud.
    expect(accepts({ sets: [] })).toBe(false);
    expect(accepts({ clears: [] })).toBe(false);
    expect(accepts({ sets: [], clears: [] })).toBe(true);
  });

  it('G — a malformed value or an unknown field is refused', () => {
    expect(
      accepts({ sets: [{ field: 'budget', value: '', provenance: 'user_stated' }], clears: [] }),
    ).toBe(false);
    expect(accepts({ sets: [SET('not_a_field', 'x')], clears: [] })).toBe(false);
    expect(
      accepts({ sets: [], clears: [{ field: 'not_a_field', provenance: 'user_stated' }] }),
    ).toBe(false);
  });
});

describe('H/I — the CROSS-ARRAY invariants the schema cannot express', () => {
  it('H — the same field in BOTH arrays takes the whole answer with it', () => {
    // Two arrays each bounded at seven cannot express "one observation per field across both". The
    // canonical constructor does, and a duplicate refuses the whole model answer rather than
    // silently dropping one side.
    const projected = profile().projectStructuredResult(
      answer({ sets: [SET('budget', 'around 8 lakh')], clears: [CLEAR('budget')] }),
    );
    expect(projected).toBeUndefined();
  });

  it('I — a COMBINED list over the canonical bound is refused, never truncated', () => {
    const fields = [
      'serviceInterest',
      'location',
      'propertyType',
      'scope',
      'budget',
      'timeline',
      'consultationPreference',
    ] as const;
    // Seven sets is exactly the ceiling and is schema-valid on its own...
    const sets = fields.map((field) => SET(field, 'x'));
    expect(riyaStructuredOutputSchema.safeParse(answer({ sets, clears: [] })).success).toBe(true);
    // ...and adding ANY clear pushes the combined list past it. The schema accepts the shape; the
    // canonical constructor refuses the meaning, which is the seam this repair depends on.
    const overflowing = answer({ sets, clears: [CLEAR('budget')] });
    expect(riyaStructuredOutputSchema.safeParse(overflowing).success).toBe(true);
    expect(profile().projectStructuredResult(overflowing)).toBeUndefined();
  });

  it('I — each provider array is still individually bounded', () => {
    const tooMany = Array.from({ length: 8 }, (_unused, index) => SET(`f${String(index)}`, 'x'));
    expect(
      riyaStructuredOutputSchema.safeParse(answer({ sets: tooMany, clears: [] })).success,
    ).toBe(false);
  });
});
