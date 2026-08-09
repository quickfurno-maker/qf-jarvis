/**
 * RWC-P5 — Core availability in the Riya model interaction (ADR-0100 §29).
 *
 * The slice exists to close one gap: before it, a structurally valid `locationRef` the model invented
 * reached P4A, satisfied summary readiness, and became a conversation Riya believed. Core owns which
 * cities it operates in and which services it sells where; Jarvis interprets language, and must never
 * decide the catalogue.
 *
 * Two checks do the work, and the second is the one that is easy to miss:
 *
 * 1. **Every ref the model asserts must exist in the snapshot.** Straightforward.
 * 2. **The PROSPECTIVE final state must be possible.** A batch can be individually valid and still
 *    combine with what the conversation already holds to produce a service/city pair Core does not
 *    serve. Continuity V1 has no field for "both fine, pair impossible", and structural presence of
 *    both would make that state look summary-ready — so the answer is refused instead, and the state
 *    can never exist.
 *
 * Refusal is always WHOLE-ANSWER. The model drafted its reply against its own claim, so deleting one
 * observation would leave text that no longer matches what gets persisted, and RWC-P4B forbids a
 * second model call to fix it.
 */
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createRiyaConversationModelProfile } from '../index.js';
import { MAX_RIYA_USER_CONTENT_CHARS } from '../internal/input-projection.js';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

/** `wardrobe` is sold in `loc.pune` only, which makes `wardrobe` + `loc.mumbai` the unavailable pair. */
const SNAPSHOT: CoreServiceAvailabilitySnapshotV1 = syntheticAvailabilitySnapshot({
  cities: [
    { ref: 'loc.pune', displayName: 'Pune' },
    { ref: 'loc.mumbai', displayName: 'Mumbai' },
  ],
  services: [
    { ref: 'modular-kitchen', displayName: 'Modular Kitchen' },
    { ref: 'wardrobe', displayName: 'Wardrobe' },
  ],
  availability: [
    { serviceRef: 'modular-kitchen', cityRefs: 'ALL' },
    { serviceRef: 'wardrobe', cityRefs: ['loc.pune'] },
  ],
});

function state(
  over: Partial<Parameters<typeof createRiyaConversationContinuityState>[0]> = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 0,
    phase: 'INTRO',
    discovery: {
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
    },
    summaryConfirmed: false,
    ...over,
  });
}

/** Evolve a fresh conversation, so a spec can start from a realistic mid-conversation state. */
function holding(
  facts: readonly { readonly field: string; readonly value: string }[],
): RiyaConversationContinuityStateV1 {
  return evolveRiyaConversation({
    current: state(),
    batch: {
      version: 1,
      observations: facts.map((f) => ({
        field: f.field,
        operation: 'SET',
        value: f.value,
        provenance: 'user_stated',
      })) as never,
      skipProjectDetails: false,
    },
  }).state;
}

const SET = (field: string, value: string): Record<string, unknown> => ({
  field,
  operation: 'SET',
  value,
  provenance: 'user_stated',
});

const REPLY = {
  kind: 'REPLY',
  replyBody: 'Thanks — that helps. Could you tell me a little more?',
  citations: [],
} as const;

/** A well-formed answer whose claimed plan is the one the reducer actually decides. */
function answerFor(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const decided = evolveRiyaConversation({
    current,
    batch: { version: 1, observations: observations as never, skipProjectDetails: false },
  });
  return {
    reply: REPLY,
    evolution: {
      version: 1,
      observations,
      skipProjectDetails: false,
      questionPlan: {
        phase: decided.questionPlan.phase,
        questionFields: [...decided.questionPlan.questionFields],
      },
    },
  };
}

const project = (
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
  snapshot: CoreServiceAvailabilitySnapshotV1 = SNAPSHOT,
): unknown =>
  createRiyaConversationModelProfile({
    current,
    availabilitySnapshot: snapshot,
  }).projectStructuredResult(answerFor(current, observations));

const userContent = (
  current: RiyaConversationContinuityStateV1,
  message: string | undefined,
  snapshot: CoreServiceAvailabilitySnapshotV1 = SNAPSHOT,
): string =>
  createRiyaConversationModelProfile({
    current,
    availabilitySnapshot: snapshot,
  }).buildUserContent({ normalizedText: message } as never);

// ---------------------------------------------------------------------------
// What the model is shown.
// ---------------------------------------------------------------------------

describe('the authority context in the one user message', () => {
  it('appears as its own sibling, never inside `known`', () => {
    // `known` is what this conversation believes. `coreAvailability` is what the business currently
    // sells and where. Folding one into the other would invite the model to treat a catalogue entry
    // as something the client said — or a client's words as a catalogue fact.
    const payload = JSON.parse(userContent(state(), 'hello')) as {
      known: Record<string, unknown>;
      coreAvailability: Record<string, unknown>;
    };
    expect(Object.keys(payload.known)).toStrictEqual([]);
    expect(Object.keys(payload.coreAvailability).sort()).toStrictEqual([
      'availability',
      'cities',
      'services',
    ]);
  });

  it('carries the canonical refs and display names, and the availability rows', () => {
    const payload = JSON.parse(userContent(state(), 'hello')) as {
      coreAvailability: {
        cities: { ref: string; displayName: string }[];
        services: { ref: string; displayName: string }[];
        availability: { serviceRef: string; cityRefs: string | string[] }[];
      };
    };
    expect(payload.coreAvailability.cities).toStrictEqual([
      { ref: 'loc.mumbai', displayName: 'Mumbai' },
      { ref: 'loc.pune', displayName: 'Pune' },
    ]);
    expect(payload.coreAvailability.services.map((s) => s.ref)).toStrictEqual([
      'modular-kitchen',
      'wardrobe',
    ]);
    expect(payload.coreAvailability.availability).toStrictEqual([
      { serviceRef: 'modular-kitchen', cityRefs: 'ALL' },
      { serviceRef: 'wardrobe', cityRefs: ['loc.pune'] },
    ]);
  });

  it('drops the snapshot evidence the model does not reason about', () => {
    // `snapshotRef` and `taxonomyVersion` say WHICH view this is. That is contract evidence, not
    // something a model uses — and every identifier sent is one that can come back in an answer.
    const content = userContent(state(), 'hello');
    expect(content).not.toContain('snapshotRef');
    expect(content).not.toContain('taxonomyVersion');
    expect(content).not.toContain('snap.synthetic');
  });

  it('carries no alias, area or identity field', () => {
    const content = userContent(
      holding([
        { field: 'serviceInterest', value: 'modular-kitchen' },
        { field: 'location', value: 'loc.pune' },
      ]),
      'hello',
    ).toLowerCase();
    for (const forbidden of [
      'alias',
      'synonym',
      'projectarea',
      'arearef',
      'pincode',
      'browsingcity',
      'useroverrodecity',
      'tenantid',
      'conversationid',
      'vendor',
      'price',
      'package',
    ]) {
      expect({ forbidden, present: content.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('is still deterministic: the same turn is byte-identical', () => {
    expect(userContent(state(), 'hello')).toBe(userContent(state(), 'hello'));
  });

  it('the raised bound is 12288, and a payload at it is still sent', () => {
    expect(MAX_RIYA_USER_CONTENT_CHARS).toBe(12_288);
    const overhead = userContent(state(), '').length;
    const fits = 'y'.repeat(MAX_RIYA_USER_CONTENT_CHARS - overhead);
    expect(userContent(state(), fits).length).toBe(MAX_RIYA_USER_CONTENT_CHARS);
  });

  it('a payload over the bound is refused before the gateway, not truncated', () => {
    expect(() => userContent(state(), 'x'.repeat(MAX_RIYA_USER_CONTENT_CHARS + 1))).toThrow();
  });

  it('a REALISTIC maximum turn fits: full snapshot, all known fields, 4096-char message', () => {
    // The bound has to survive the worst legitimate turn, not just a convenient one. This is that
    // turn: thirty cities, twenty-five services, every discovery field populated at its own limit,
    // and an inbound message at the M1 maximum.
    const cities = Array.from({ length: 30 }, (_unused, index) => ({
      ref: `loc.c${String(index)}`,
      displayName: `City Number ${String(index)}`,
    }));
    const services = Array.from({ length: 25 }, (_unused, index) => ({
      ref: `svc.s${String(index)}`,
      displayName: `Service Number ${String(index)}`,
    }));
    const big = syntheticAvailabilitySnapshot({
      cities,
      services,
      availability: services.map((service, index) =>
        index === 0
          ? { serviceRef: service.ref, cityRefs: cities.slice(0, 4).map((c) => c.ref) }
          : { serviceRef: service.ref, cityRefs: 'ALL' as const },
      ),
    });
    const loaded = createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: 4,
      phase: 'SUMMARY',
      discovery: {
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: [],
        serviceInterestRef: 'svc.s1',
        locationRef: 'loc.c1',
        propertyTypeRef: 'prop.apartment-3bhk',
        scopeSummary: 'x'.repeat(500),
        budgetNote: 'y'.repeat(120),
        timelineNote: 'z'.repeat(120),
        consultationPreferenceRef: 'consult.video',
      },
      fieldProvenance: {
        serviceInterest: 'user_stated',
        location: 'user_stated',
        propertyType: 'user_stated',
        scope: 'user_stated',
        budget: 'user_stated',
        timeline: 'user_stated',
        consultationPreference: 'user_stated',
      },
      summaryConfirmed: false,
    });
    const content = userContent(loaded, 'm'.repeat(4096), big);
    expect(content.length).toBeLessThanOrEqual(MAX_RIYA_USER_CONTENT_CHARS);
  });
});

// ---------------------------------------------------------------------------
// Individual refs.
// ---------------------------------------------------------------------------

describe('every ref the model asserts must exist in the snapshot', () => {
  it('accepts an active service ref', () => {
    expect(project(state(), [SET('serviceInterest', 'modular-kitchen')])).toBeDefined();
  });

  it('accepts an active city ref', () => {
    expect(project(state(), [SET('location', 'loc.pune')])).toBeDefined();
  });

  it('refuses the WHOLE answer for a service Core does not list', () => {
    // Structurally a perfectly valid reference — which is exactly the failure this closes.
    expect(project(state(), [SET('serviceInterest', 'svc.invented')])).toBeUndefined();
  });

  it('refuses the WHOLE answer for a city Core does not list', () => {
    expect(project(state(), [SET('location', 'loc.atlantis')])).toBeUndefined();
  });

  it('a refused ref takes the reply with it, so nothing partial escapes', () => {
    const projected = project(state(), [
      SET('serviceInterest', 'modular-kitchen'),
      SET('location', 'loc.atlantis'),
    ]);
    // Not "a projection carrying only the valid half". Nothing at all: the reply was drafted against
    // both claims, and keeping one would leave text that contradicts what is stored.
    expect(projected).toBeUndefined();
  });

  it('non-catalogue fields are untouched by Core authority', () => {
    // `budget`, `timeline`, `scope` and the rest are conversational notes, not catalogue entries.
    // Core has no opinion on them and this check must not invent one.
    expect(
      project(state(), [SET('budget', 'around 8 lakh'), SET('timeline', 'next month')]),
    ).toBeDefined();
  });

  it('a CLEAR is not a claim about the catalogue', () => {
    // Withdrawing a fact asserts nothing about what Core sells, so it needs no snapshot check — and
    // the fact being withdrawn may well be one Core no longer lists.
    const known = holding([{ field: 'budget', value: 'around 8 lakh' }]);
    expect(
      project(known, [{ field: 'budget', operation: 'CLEAR', provenance: 'user_stated' }]),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The prospective final pair.
// ---------------------------------------------------------------------------

describe('the prospective final state must be a state Core allows', () => {
  it('accepts an available pair supplied in ONE turn', () => {
    expect(
      project(state(), [SET('serviceInterest', 'modular-kitchen'), SET('location', 'loc.mumbai')]),
    ).toBeDefined();
  });

  it('refuses an unavailable pair supplied in ONE turn', () => {
    // Both refs are individually active. `wardrobe` is simply not sold in `loc.mumbai`.
    expect(
      project(state(), [SET('serviceInterest', 'wardrobe'), SET('location', 'loc.mumbai')]),
    ).toBeUndefined();
  });

  it('the preferred retention for a both-new unsupported pair IS accepted', () => {
    // What the evaluated prompt should do instead: keep the service, omit the incompatible city, and
    // explain it in the reply. The validator does not enforce this by deleting anything — it simply
    // refuses the impossible state, and this is the shape that is not impossible.
    const projected = project(state(), [SET('serviceInterest', 'wardrobe')]);
    expect(projected).toBeDefined();
    const detail = (projected as { detail: { observationBatch: { observations: unknown[] } } })
      .detail;
    expect(detail.observationBatch.observations).toHaveLength(1);
  });

  it('EXISTING service + new incompatible location is refused', () => {
    const known = holding([{ field: 'serviceInterest', value: 'wardrobe' }]);
    // The batch alone is fine: `loc.mumbai` is an active city. It is the COMBINATION with what the
    // conversation already holds that Core does not allow — which is why the check runs against the
    // evolved state rather than the batch.
    expect(project(known, [SET('location', 'loc.mumbai')])).toBeUndefined();
    // Keeping the existing service and omitting the city is accepted.
    expect(project(known, [SET('budget', 'around 8 lakh')])).toBeDefined();
  });

  it('EXISTING location + new incompatible service is refused', () => {
    const known = holding([{ field: 'location', value: 'loc.mumbai' }]);
    expect(project(known, [SET('serviceInterest', 'wardrobe')])).toBeUndefined();
    // A service that IS available there is accepted.
    expect(project(known, [SET('serviceInterest', 'modular-kitchen')])).toBeDefined();
  });

  it('`ALL` means every city in this snapshot', () => {
    for (const city of ['loc.pune', 'loc.mumbai']) {
      expect(
        project(state(), [SET('serviceInterest', 'modular-kitchen'), SET('location', city)]),
      ).toBeDefined();
    }
  });

  it('an EMPTY city list means the service pairs with nothing', () => {
    const nowhere = syntheticAvailabilitySnapshot({
      cities: [{ ref: 'loc.pune', displayName: 'Pune' }],
      services: [{ ref: 'wardrobe', displayName: 'Wardrobe' }],
      availability: [{ serviceRef: 'wardrobe', cityRefs: [] }],
    });
    // The service alone is still assertable — it is a real catalogue entry.
    expect(project(state(), [SET('serviceInterest', 'wardrobe')], nowhere)).toBeDefined();
    // Pairing it with the one listed city is not.
    expect(
      project(state(), [SET('serviceInterest', 'wardrobe'), SET('location', 'loc.pune')], nowhere),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A catalogue ref at the frozen Riya maximum.
// ---------------------------------------------------------------------------

describe('a 64-character catalogue ref survives the whole path', () => {
  // The compatibility bound the P5 contract now enforces is 64, because that is what the frozen
  // `NeedDiscovery` REFERENCE can store. This proves the bound is not merely a refusal rule but a
  // genuinely usable one: a ref exactly AT the limit is emitted by the model, accepted here, and
  // persisted by the real P4A reducer.
  const MAX_SERVICE = `svc.${'s'.repeat(60)}`;
  const MAX_CITY = `loc.${'c'.repeat(60)}`;

  const MAX_SNAPSHOT: CoreServiceAvailabilitySnapshotV1 = syntheticAvailabilitySnapshot({
    cities: [{ ref: MAX_CITY, displayName: 'A City' }],
    services: [{ ref: MAX_SERVICE, displayName: 'A Service' }],
    availability: [{ serviceRef: MAX_SERVICE, cityRefs: 'ALL' }],
  });

  it('the fixture really is at the limit', () => {
    expect(MAX_SERVICE).toHaveLength(64);
    expect(MAX_CITY).toHaveLength(64);
  });

  it('the pair is emitted, validated and EVOLVED into continuity', () => {
    const projected = project(
      state(),
      [SET('serviceInterest', MAX_SERVICE), SET('location', MAX_CITY)],
      MAX_SNAPSHOT,
    );
    expect(projected).toBeDefined();

    // And it really does persist: the same canonical batch through the real reducer produces a state
    // holding both 64-character refs. Without this, the contract would be validating something
    // `createNeedDiscovery` refuses.
    const batch = (projected as { detail: { observationBatch: never } }).detail.observationBatch;
    const evolved = evolveRiyaConversation({ current: state(), batch });
    expect(evolved.changed).toBe(true);
    expect(evolved.state.discovery.serviceInterestRef).toBe(MAX_SERVICE);
    expect(evolved.state.discovery.locationRef).toBe(MAX_CITY);
    expect(evolved.state.discovery.serviceInterestRef).toHaveLength(64);
    expect(evolved.state.discovery.locationRef).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// An empty active catalogue.
// ---------------------------------------------------------------------------

describe('an empty active catalogue is shown honestly, and constrains everything', () => {
  /** Core is readable and currently offering nothing. That is an answer, not a failure. */
  const EMPTY: CoreServiceAvailabilitySnapshotV1 = syntheticAvailabilitySnapshot({
    cities: [],
    services: [],
    availability: [],
  });

  it('the model is shown three empty arrays, not a missing section', () => {
    // Omitting `coreAvailability` when it is empty would be ambiguous in exactly the wrong way: the
    // model could read absence as "no constraint" rather than "nothing is on offer".
    const payload = JSON.parse(userContent(state(), 'hello', EMPTY)) as {
      coreAvailability: { cities: unknown[]; services: unknown[]; availability: unknown[] };
    };
    expect(payload.coreAvailability.cities).toStrictEqual([]);
    expect(payload.coreAvailability.services).toStrictEqual([]);
    expect(payload.coreAvailability.availability).toStrictEqual([]);
  });

  it('no service ref can be asserted against an empty catalogue', () => {
    expect(project(state(), [SET('serviceInterest', 'modular-kitchen')], EMPTY)).toBeUndefined();
  });

  it('no city ref can be asserted against an empty catalogue', () => {
    expect(project(state(), [SET('location', 'loc.pune')], EMPTY)).toBeUndefined();
  });

  it('a reply with NO observations is still perfectly valid', () => {
    // This is the whole point of showing the model an honest empty view: it can still answer, and the
    // right answer is a reply that records nothing about a catalogue with nothing in it.
    expect(project(state(), [], EMPTY)).toBeDefined();
  });

  it('a non-catalogue fact is still recordable while the catalogue is empty', () => {
    // Core owns the catalogue, not the conversation. A budget the client stated is still a fact.
    expect(project(state(), [SET('budget', 'around 8 lakh')], EMPTY)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A catalogue that changed under a live conversation.
// ---------------------------------------------------------------------------

describe('continuity that has become invalid under a newer snapshot', () => {
  /** A conversation that was perfectly valid when it happened. */
  const settled = (): RiyaConversationContinuityStateV1 =>
    holding([
      { field: 'serviceInterest', value: 'wardrobe' },
      { field: 'location', value: 'loc.pune' },
    ]);

  /** Core stopped selling wardrobes in Pune. Nothing about the conversation changed. */
  const withdrawn = syntheticAvailabilitySnapshot({
    cities: [
      { ref: 'loc.pune', displayName: 'Pune' },
      { ref: 'loc.mumbai', displayName: 'Mumbai' },
    ],
    services: [
      { ref: 'modular-kitchen', displayName: 'Modular Kitchen' },
      { ref: 'wardrobe', displayName: 'Wardrobe' },
    ],
    availability: [
      { serviceRef: 'modular-kitchen', cityRefs: 'ALL' },
      { serviceRef: 'wardrobe', cityRefs: [] },
    ],
  });

  it('is NOT auto-cleared: a catalogue change is not a user correction', () => {
    // P4A's `CLEAR` is user-origin only, deliberately. Synthesizing one here would forge a
    // correction the client never made, and would do it silently.
    const current = settled();
    expect(current.discovery.serviceInterestRef).toBe('wardrobe');
    expect(current.discovery.locationRef).toBe('loc.pune');
    // The model still RUNS — this state reaches `buildUserContent` and the client's next sentence
    // gets its chance to repair things.
    expect(() => userContent(current, 'is that still possible?', withdrawn)).not.toThrow();
  });

  it('a turn that does not repair it is refused, so nothing escapes', () => {
    const projected = project(settled(), [SET('budget', 'around 8 lakh')], withdrawn);
    expect(projected).toBeUndefined();
  });

  it('a client correction that makes the state valid again IS accepted', () => {
    // The client switches to a service that is available where they are. The prospective state
    // becomes possible, so the answer stands — and the repair came from the client, not from us.
    const projected = project(settled(), [SET('serviceInterest', 'modular-kitchen')], withdrawn);
    expect(projected).toBeDefined();
  });

  it('a correction to the wrong thing is still refused', () => {
    // Moving city does not help when the service is sold nowhere.
    expect(project(settled(), [SET('location', 'loc.mumbai')], withdrawn)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Everything P4A and P4B already owned is untouched.
// ---------------------------------------------------------------------------

describe('P5 changes authority, not semantics', () => {
  it('provenance is unchanged: Core validation does not confirm anything', () => {
    // Validating the ref proves Core lists it. It does NOT prove the client meant that ref, and it is
    // certainly not the client agreeing to it — RWC-P6 owns confirmation.
    const projected = project(state(), [SET('location', 'loc.pune')]);
    const detail = (
      projected as {
        detail: { observationBatch: { observations: { provenance: string }[] } };
      }
    ).detail;
    expect(detail.observationBatch.observations[0]?.provenance).toBe('user_stated');
  });

  it('the model still cannot claim an origin only a person or the server may', () => {
    const current = state();
    const answer = answerFor(current, [SET('location', 'loc.pune')]) as {
      evolution: Record<string, unknown>;
    };
    for (const provenance of ['user_confirmed', 'user_selected', 'server_runtime']) {
      expect(
        createRiyaConversationModelProfile({
          current,
          availabilitySnapshot: SNAPSHOT,
        }).projectStructuredResult({
          ...answer,
          evolution: {
            ...answer.evolution,
            observations: [{ ...SET('location', 'loc.pune'), provenance }],
          },
        }),
      ).toBeUndefined();
    }
  });

  it('the question-plan agreement is still exact, and still P4A-authoritative', () => {
    const current = state();
    const answer = answerFor(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { ...answer.evolution.questionPlan, phase: 'SUMMARY' },
      },
    };
    expect(
      createRiyaConversationModelProfile({
        current,
        availabilitySnapshot: SNAPSHOT,
      }).projectStructuredResult(wrong),
    ).toBeUndefined();
  });

  it('the detail is still exactly a version and a canonical batch', () => {
    const projected = project(state(), [SET('location', 'loc.pune')]);
    const detail = (projected as { detail: Record<string, unknown> }).detail;
    expect(Object.keys(detail).sort()).toStrictEqual(['observationBatch', 'version']);
    // No availability, no snapshot, no catalogue leaks back out through the detail.
    const serialized = JSON.stringify(detail);
    for (const forbidden of ['coreAvailability', 'availability', 'displayName', 'snapshotRef']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
