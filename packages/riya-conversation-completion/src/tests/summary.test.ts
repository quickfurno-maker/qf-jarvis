/**
 * RWC-P6A — structured summary edit and confirmation (ADR-0101 §32–§33).
 *
 * Two claims carry this file.
 *
 * 1. **RWC-P4A still owns every discovery decision.** Precedence, `CLEAR`, missing fields,
 *    completeness, confirmation invalidation and phase regression are all asserted here as
 *    OUTCOMES — which is the only honest way to prove delegation: if this package had grown its own
 *    reducer, these would still pass individually and diverge the first time P4A was corrected.
 * 2. **Core availability is not optional because a model was not involved.** A structured edit is
 *    exactly the path that could bypass RWC-P5, so the specs check both the asserted reference and
 *    the prospective pair.
 */
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import {
  confirmRiyaSummary,
  createRiyaSummaryEditV1,
  evolveRiyaSummaryEdit,
  RiyaConversationCompletionError,
} from '../index.js';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

/** `wardrobe` is sold in `loc.pune` only — so `wardrobe` + `loc.mumbai` is the unavailable pair. */
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

/** A summary-ready conversation: the four required values, none yet confirmed. */
function atSummary(
  over: Partial<Parameters<typeof createRiyaConversationContinuityState>[0]> = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 4,
    phase: 'SUMMARY',
    discovery: {
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
      missingFields: [],
      serviceInterestRef: 'modular-kitchen',
      locationRef: 'loc.pune',
      budgetNote: 'around 8 lakh',
      timelineNote: 'next month',
    },
    fieldProvenance: {
      serviceInterest: 'model_inferred',
      location: 'user_stated',
      budget: 'user_stated',
      timeline: 'user_stated',
    },
    summaryConfirmed: false,
    ...over,
  });
}

const edit = (
  edits: readonly { field: string; operation: string; value?: string }[],
): ReturnType<typeof createRiyaSummaryEditV1> => createRiyaSummaryEditV1({ version: 1, edits });

const refuses = (run: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RiyaConversationCompletionError);
  expect((thrown as RiyaConversationCompletionError).code).toBe(code);
};

// ---------------------------------------------------------------------------
// The edit payload.
// ---------------------------------------------------------------------------

describe('the structured edit payload', () => {
  it('accepts a minimal SET and a minimal CLEAR', () => {
    expect(
      edit([{ field: 'budget', operation: 'SET', value: 'around 9 lakh' }]).edits,
    ).toHaveLength(1);
    expect(edit([{ field: 'scope', operation: 'CLEAR' }]).edits).toHaveLength(1);
  });

  const rejected: Record<string, unknown> = {
    'zero edits': { version: 1, edits: [] },
    'a duplicated field': {
      version: 1,
      edits: [
        { field: 'budget', operation: 'SET', value: 'a' },
        { field: 'budget', operation: 'SET', value: 'b' },
      ],
    },
    'a caller-chosen provenance': {
      version: 1,
      edits: [{ field: 'budget', operation: 'SET', value: 'a', provenance: 'user_confirmed' }],
    },
    'a caller-chosen skipProjectDetails': {
      version: 1,
      skipProjectDetails: true,
      edits: [{ field: 'budget', operation: 'SET', value: 'a' }],
    },
    'a SET with no value': { version: 1, edits: [{ field: 'budget', operation: 'SET' }] },
    'a CLEAR with a value': {
      version: 1,
      edits: [{ field: 'budget', operation: 'CLEAR', value: 'a' }],
    },
    'an unknown field': { version: 1, edits: [{ field: 'mood', operation: 'CLEAR' }] },
    'an unknown operation': { version: 1, edits: [{ field: 'budget', operation: 'DELETE' }] },
    'an evidence quote': {
      version: 1,
      edits: [{ field: 'budget', operation: 'SET', value: 'a', evidenceQuote: 'they said so' }],
    },
    'a confidence': {
      version: 1,
      edits: [{ field: 'budget', operation: 'SET', value: 'a', confidence: 0.9 }],
    },
    'a wrong version': { version: 2, edits: [{ field: 'scope', operation: 'CLEAR' }] },
  };
  for (const [label, value] of Object.entries(rejected)) {
    it(`refuses ${label}`, () => {
      refuses(() => createRiyaSummaryEditV1(value), 'invalid-summary-edit');
    });
  }

  it('a caller cannot choose provenance, because this IS the surface that mints it', () => {
    // The absence of the field is the design. A caller able to choose would be a caller able to write
    // `user_confirmed` for something a model guessed.
    refuses(
      () =>
        createRiyaSummaryEditV1({
          version: 1,
          edits: [{ field: 'budget', operation: 'SET', value: 'a', provenance: 'model_inferred' }],
        }),
      'invalid-summary-edit',
    );
  });
});

// ---------------------------------------------------------------------------
// The edit action.
// ---------------------------------------------------------------------------

describe('a structured edit runs only at SUMMARY', () => {
  for (const phase of [
    'INTRO',
    'NEED',
    'LOCATION',
    'PROJECT_DETAILS',
    'BUDGET_TIMELINE',
  ] as const) {
    it(`refuses at ${phase}`, () => {
      const current = createRiyaConversationContinuityState({
        version: 1,
        tenantId: TENANT,
        conversationId: CONVERSATION,
        continuityRevision: 1,
        phase,
        discovery: {
          completeness: 'MORE_DISCOVERY_REQUIRED',
          missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
        },
        summaryConfirmed: false,
      });
      refuses(
        () =>
          evolveRiyaSummaryEdit({
            current,
            edit: edit([{ field: 'budget', operation: 'SET', value: 'a' }]),
            availabilitySnapshot: SNAPSHOT,
          }),
        'action-not-permitted',
      );
    });
  }

  for (const phase of ['CONTACT', 'CONSENT'] as const) {
    it(`refuses at ${phase}: editing there would mean inventing a transition back to SUMMARY`, () => {
      const current = atSummary({ phase, summaryConfirmed: true, continuityRevision: 5 });
      refuses(
        () =>
          evolveRiyaSummaryEdit({
            current,
            edit: edit([{ field: 'budget', operation: 'SET', value: 'a' }]),
            availabilitySnapshot: SNAPSHOT,
          }),
        'action-not-permitted',
      );
    });
  }
});

describe('a structured edit delegates every discovery decision to RWC-P4A', () => {
  it('a SET applies, and is stamped user_confirmed', () => {
    const result = evolveRiyaSummaryEdit({
      current: atSummary(),
      edit: edit([{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.changed).toBe(true);
    expect(result.state.discovery.budgetNote).toBe('around 12 lakh');
    expect(result.state.fieldProvenance.budget).toBe('user_confirmed');
  });

  it('editing a value INVALIDATES a prior confirmation', () => {
    // P4A's rule, observed through this surface: the summary the client agreed to no longer exists.
    const confirmed = atSummary({ summaryConfirmed: true });
    const result = evolveRiyaSummaryEdit({
      current: confirmed,
      edit: edit([{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.summaryConfirmed).toBe(false);
  });

  it('re-stating the SAME value strengthens provenance without invalidating the confirmation', () => {
    const confirmed = atSummary({ summaryConfirmed: true });
    const result = evolveRiyaSummaryEdit({
      current: confirmed,
      edit: edit([{ field: 'serviceInterest', operation: 'SET', value: 'modular-kitchen' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    // The value did not move, so what the client read is intact.
    expect(result.state.summaryConfirmed).toBe(true);
    expect(result.state.fieldProvenance.serviceInterest).toBe('user_confirmed');
  });

  it('a lower-rank value becomes user_confirmed', () => {
    const result = evolveRiyaSummaryEdit({
      current: atSummary(),
      edit: edit([{ field: 'serviceInterest', operation: 'SET', value: 'modular-kitchen' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.fieldProvenance.serviceInterest).toBe('user_confirmed');
  });

  it('CLEARING a required value regresses the phase, through P4A', () => {
    const result = evolveRiyaSummaryEdit({
      current: atSummary(),
      edit: edit([{ field: 'budget', operation: 'CLEAR' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.discovery.budgetNote).toBeUndefined();
    expect(result.state.phase).not.toBe('SUMMARY');
    expect(result.state.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
    expect(result.state.discovery.missingFields).toContain('budget');
  });

  it('CLEARING an optional value leaves the summary intact', () => {
    const withScope = atSummary({
      discovery: {
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: [],
        serviceInterestRef: 'modular-kitchen',
        locationRef: 'loc.pune',
        budgetNote: 'around 8 lakh',
        timelineNote: 'next month',
        scopeSummary: 'full refit',
      },
      fieldProvenance: {
        serviceInterest: 'user_stated',
        location: 'user_stated',
        budget: 'user_stated',
        timeline: 'user_stated',
        scope: 'user_stated',
      },
    });
    const result = evolveRiyaSummaryEdit({
      current: withScope,
      edit: edit([{ field: 'scope', operation: 'CLEAR' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.discovery.scopeSummary).toBeUndefined();
    expect(result.state.phase).toBe('SUMMARY');
  });

  it('the result is exactly what the REAL reducer would have produced', () => {
    // The delegation proof. Not "an equivalent state" -- the same state, byte for byte.
    const current = atSummary();
    const mine = evolveRiyaSummaryEdit({
      current,
      edit: edit([{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    const theirs = evolveRiyaConversation({
      current,
      batch: {
        version: 1,
        observations: [
          {
            field: 'budget',
            operation: 'SET',
            value: 'around 12 lakh',
            provenance: 'user_confirmed',
          },
        ] as never,
        skipProjectDetails: false,
      },
    });
    expect(JSON.stringify(mine.state)).toBe(JSON.stringify(theirs.state));
  });
});

describe('a structured edit still answers to Core availability', () => {
  it('accepts a service and a city Core lists', () => {
    expect(
      evolveRiyaSummaryEdit({
        current: atSummary(),
        edit: edit([{ field: 'location', operation: 'SET', value: 'loc.mumbai' }]),
        availabilitySnapshot: SNAPSHOT,
      }).state.discovery.locationRef,
    ).toBe('loc.mumbai');
  });

  it('refuses a service Core does not list', () => {
    refuses(
      () =>
        evolveRiyaSummaryEdit({
          current: atSummary(),
          edit: edit([{ field: 'serviceInterest', operation: 'SET', value: 'svc.invented' }]),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('refuses a city Core does not list', () => {
    refuses(
      () =>
        evolveRiyaSummaryEdit({
          current: atSummary(),
          edit: edit([{ field: 'location', operation: 'SET', value: 'loc.atlantis' }]),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('refuses a PROSPECTIVE pair Core does not serve', () => {
    // Both refs are individually active; it is the COMBINATION with what the conversation already
    // holds that Core does not allow. This is the case a per-edit check alone would miss.
    refuses(
      () =>
        evolveRiyaSummaryEdit({
          current: atSummary({
            discovery: {
              completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
              missingFields: [],
              serviceInterestRef: 'wardrobe',
              locationRef: 'loc.pune',
              budgetNote: 'around 8 lakh',
              timelineNote: 'next month',
            },
            fieldProvenance: {
              serviceInterest: 'user_stated',
              location: 'user_stated',
              budget: 'user_stated',
              timeline: 'user_stated',
            },
          }),
          edit: edit([{ field: 'location', operation: 'SET', value: 'loc.mumbai' }]),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('an empty availability list refuses the pair', () => {
    const nowhere = syntheticAvailabilitySnapshot({
      cities: [{ ref: 'loc.pune', displayName: 'Pune' }],
      services: [{ ref: 'modular-kitchen', displayName: 'Modular Kitchen' }],
      availability: [{ serviceRef: 'modular-kitchen', cityRefs: [] }],
    });
    refuses(
      () =>
        evolveRiyaSummaryEdit({
          current: atSummary(),
          edit: edit([{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }]),
          availabilitySnapshot: nowhere,
        }),
      'action-not-permitted',
    );
  });

  it('a malformed snapshot is refused with its own code', () => {
    refuses(
      () =>
        evolveRiyaSummaryEdit({
          current: atSummary(),
          edit: edit([{ field: 'budget', operation: 'SET', value: 'a' }]),
          availabilitySnapshot: { version: 1, cities: 'all' } as never,
        }),
      'invalid-availability-snapshot',
    );
  });

  it('CLEARING a catalogue field is allowed: it asserts nothing about the catalogue', () => {
    const result = evolveRiyaSummaryEdit({
      current: atSummary(),
      edit: edit([{ field: 'location', operation: 'CLEAR' }]),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.discovery.locationRef).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Confirmation.
// ---------------------------------------------------------------------------

describe('confirming the summary', () => {
  it('advances to CONTACT, sets the flag, and adds no evidence', () => {
    const current = atSummary();
    const result = confirmRiyaSummary({ current, availabilitySnapshot: SNAPSHOT });
    expect(result.state.phase).toBe('CONTACT');
    expect(result.state.summaryConfirmed).toBe(true);
    expect(result.state.completionEvidenceRef).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it('strengthens EVERY present value to user_confirmed', () => {
    const current = atSummary();
    // One of them starts weaker, so the strengthening is visible rather than incidental.
    expect(current.fieldProvenance.serviceInterest).toBe('model_inferred');
    const result = confirmRiyaSummary({ current, availabilitySnapshot: SNAPSHOT });
    for (const field of ['serviceInterest', 'location', 'budget', 'timeline'] as const) {
      expect({ field, provenance: result.state.fieldProvenance[field] }).toStrictEqual({
        field,
        provenance: 'user_confirmed',
      });
    }
  });

  it('no ABSENT field gains provenance: the client did not agree to a blank', () => {
    const result = confirmRiyaSummary({ current: atSummary(), availabilitySnapshot: SNAPSHOT });
    for (const field of ['propertyType', 'scope', 'consultationPreference'] as const) {
      expect({ field, provenance: result.state.fieldProvenance[field] }).toStrictEqual({
        field,
        provenance: undefined,
      });
    }
    expect(result.state.discovery.scopeSummary).toBeUndefined();
  });

  it('confirmation is EXACTLY one revision, even though the merge also moved', () => {
    const current = atSummary();
    const result = confirmRiyaSummary({ current, availabilitySnapshot: SNAPSHOT });
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
  });

  it('and exactly one revision when every present value was ALREADY user_confirmed', () => {
    // P4A reports no change here, but the phase moved and the flag flipped -- so the conversation
    // did change, and one structured confirmation is one revision either way.
    const alreadyConfirmed = atSummary({
      fieldProvenance: {
        serviceInterest: 'user_confirmed',
        location: 'user_confirmed',
        budget: 'user_confirmed',
        timeline: 'user_confirmed',
      },
    });
    const result = confirmRiyaSummary({
      current: alreadyConfirmed,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.state.continuityRevision).toBe(alreadyConfirmed.continuityRevision + 1);
    expect(result.state.phase).toBe('CONTACT');
  });

  it('a later model-rank observation cannot undo a confirmed value', () => {
    // The consequence of Option 1, stated as behaviour: P4A never overwrites `user_confirmed` from
    // below, so confirmation genuinely protects what the client approved.
    const confirmed = confirmRiyaSummary({
      current: atSummary(),
      availabilitySnapshot: SNAPSHOT,
    }).state;
    // Bring it back to SUMMARY to exercise the reducer (CONTACT is out of P4A's scope by design).
    const backAtSummary = createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: confirmed.continuityRevision,
      phase: 'SUMMARY',
      discovery: {
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: [],
        serviceInterestRef: 'modular-kitchen',
        locationRef: 'loc.pune',
        budgetNote: 'around 8 lakh',
        timelineNote: 'next month',
      },
      fieldProvenance: { ...confirmed.fieldProvenance },
      summaryConfirmed: true,
    });
    const attempted = evolveRiyaConversation({
      current: backAtSummary,
      batch: {
        version: 1,
        observations: [
          { field: 'budget', operation: 'SET', value: 'guessed', provenance: 'model_inferred' },
        ] as never,
        skipProjectDetails: false,
      },
    });
    expect(attempted.state.discovery.budgetNote).toBe('around 8 lakh');
  });
});

describe('confirmation refuses what it must', () => {
  it('refuses anywhere but SUMMARY', () => {
    for (const phase of ['NEED', 'BUDGET_TIMELINE'] as const) {
      const current = createRiyaConversationContinuityState({
        version: 1,
        tenantId: TENANT,
        conversationId: CONVERSATION,
        continuityRevision: 1,
        phase,
        discovery: {
          completeness: 'MORE_DISCOVERY_REQUIRED',
          missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
        },
        summaryConfirmed: false,
      });
      refuses(
        () => confirmRiyaSummary({ current, availabilitySnapshot: SNAPSHOT }),
        'action-not-permitted',
      );
    }
  });

  it('refuses an already-confirmed summary', () => {
    refuses(
      () =>
        confirmRiyaSummary({
          current: atSummary({ summaryConfirmed: true }),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('refuses a conversation a person asked to look at', () => {
    // P6 does not overrule human review, and must not silently convert it to SUFFICIENT.
    refuses(
      () =>
        confirmRiyaSummary({
          current: atSummary({
            discovery: {
              completeness: 'HUMAN_REVIEW_REQUIRED',
              missingFields: [],
              serviceInterestRef: 'modular-kitchen',
              locationRef: 'loc.pune',
              budgetNote: 'around 8 lakh',
              timelineNote: 'next month',
            },
          }),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('refuses when the service is no longer listed', () => {
    const withdrawn = syntheticAvailabilitySnapshot({
      cities: [{ ref: 'loc.pune', displayName: 'Pune' }],
      services: [{ ref: 'wardrobe', displayName: 'Wardrobe' }],
      availability: [{ serviceRef: 'wardrobe', cityRefs: 'ALL' }],
    });
    refuses(
      () => confirmRiyaSummary({ current: atSummary(), availabilitySnapshot: withdrawn }),
      'action-not-permitted',
    );
  });

  it('refuses when the city is no longer listed', () => {
    const withdrawn = syntheticAvailabilitySnapshot({
      cities: [{ ref: 'loc.mumbai', displayName: 'Mumbai' }],
      services: [{ ref: 'modular-kitchen', displayName: 'Modular Kitchen' }],
      availability: [{ serviceRef: 'modular-kitchen', cityRefs: 'ALL' }],
    });
    refuses(
      () => confirmRiyaSummary({ current: atSummary(), availabilitySnapshot: withdrawn }),
      'action-not-permitted',
    );
  });

  it('refuses when the pair stopped being sold since the summary was rendered', () => {
    const withdrawn = syntheticAvailabilitySnapshot({
      cities: [
        { ref: 'loc.pune', displayName: 'Pune' },
        { ref: 'loc.mumbai', displayName: 'Mumbai' },
      ],
      services: [{ ref: 'modular-kitchen', displayName: 'Modular Kitchen' }],
      availability: [{ serviceRef: 'modular-kitchen', cityRefs: ['loc.mumbai'] }],
    });
    refuses(
      () => confirmRiyaSummary({ current: atSummary(), availabilitySnapshot: withdrawn }),
      'action-not-permitted',
    );
  });

  it('refuses at the revision ceiling rather than wrapping', () => {
    // A wrapped revision would make a stale compare-and-set succeed.
    refuses(
      () =>
        confirmRiyaSummary({
          current: atSummary({ continuityRevision: Number.MAX_SAFE_INTEGER }),
          availabilitySnapshot: SNAPSHOT,
        }),
      'action-not-permitted',
    );
  });

  it('refuses a non-canonical state', () => {
    const forged = {
      ...atSummary(),
      // A provenance map that disagrees with the discovery: the shape a half-applied update leaves.
      discovery: { ...atSummary().discovery, propertyTypeRef: 'prop.flat' },
    } as RiyaConversationContinuityStateV1;
    refuses(
      () => confirmRiyaSummary({ current: forged, availabilitySnapshot: SNAPSHOT }),
      'invalid-state',
    );
  });

  it('does not mutate the caller state', () => {
    const current = atSummary();
    const before = JSON.stringify(current);
    confirmRiyaSummary({ current, availabilitySnapshot: SNAPSHOT });
    expect(JSON.stringify(current)).toBe(before);
  });
});
