/**
 * RWC-P2A — the Riya conversational continuity contract (ADR-0093).
 *
 * These prove the state a caller may build. The companion `containment.test.ts` proves what the
 * package cannot do at all.
 *
 * The theme throughout: this contract REFUSES rather than repairs. A value with no provenance, a
 * provenance with no value, a `CONTACT` phase with an unconfirmed summary — each is a snapshot
 * contradicting itself, and inferring the missing half would be this package inventing exactly the
 * thing the field exists to record.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField, NeedDiscoveryInput } from '@qf-jarvis/riya-agent';
import { describe, expect, it } from 'vitest';

import {
  createRiyaConversationContinuityState,
  RIYA_CONVERSATION_CONTINUITY_ERROR_CODES,
  RIYA_CONVERSATION_PHASES,
  RIYA_FIELD_PROVENANCE_SOURCES,
  RiyaConversationContinuityError,
} from '../index.js';
import type {
  RiyaContinuityFieldProvenanceMap,
  RiyaConversationContinuityStateInput,
  RiyaConversationPhase,
} from '../index.js';
// INTERNAL, and only from a spec in the same package: the precedence ranks are a recorded contract
// decision that must be checkable without being exported (exporting them would be exporting the
// first half of the merge RWC-P4 owns).
import { DISCOVERY_VALUE_KEY, PROVENANCE_PRECEDENCE_RANK } from '../internal/field-map.js';

const ALL_FIELDS: readonly DiscoveryField[] = DISCOVERY_FIELDS_FROZEN;

/** Nothing discovered yet: every field outstanding, no values, no provenance. */
function emptyDiscovery(): NeedDiscoveryInput {
  return {
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: [...ALL_FIELDS],
  };
}

/** A minimal valid state at a given phase. */
function stateInput(
  over: Partial<RiyaConversationContinuityStateInput> = {},
): RiyaConversationContinuityStateInput {
  return {
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    continuityRevision: 0,
    phase: 'INTRO',
    discovery: emptyDiscovery(),
    summaryConfirmed: false,
    ...over,
  };
}

/** A discovery snapshot in which exactly `known` fields carry a value. */
function discoveryWith(known: readonly DiscoveryField[]): NeedDiscoveryInput {
  const values: Record<string, string> = {};
  for (const field of known) {
    values[DISCOVERY_VALUE_KEY[field]] = field === 'scope' ? 'A two-bedroom refit.' : 'ref.value.1';
  }
  return {
    ...values,
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: ALL_FIELDS.filter((field) => !known.includes(field)),
  };
}

function expectCode(build: () => unknown, code: string, label = code): void {
  expect(build, label).toThrow(RiyaConversationContinuityError);
  try {
    build();
    expect.unreachable(`${label} should have thrown`);
  } catch (error: unknown) {
    expect((error as RiyaConversationContinuityError).code, label).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1-5. Vocabulary.
// ---------------------------------------------------------------------------

describe('the vocabularies are frozen and closed', () => {
  it('(1) records exactly the nine RWC-P0B phases, in order', () => {
    expect([...RIYA_CONVERSATION_PHASES]).toStrictEqual([
      'INTRO',
      'NEED',
      'LOCATION',
      'PROJECT_DETAILS',
      'BUDGET_TIMELINE',
      'SUMMARY',
      'CONTACT',
      'CONSENT',
      'COMPLETE',
    ]);
  });

  it('(2) carries no alias, no UI vocabulary and no channel-specific phase', () => {
    for (const forbidden of [
      'PREFERENCES',
      'CONFIRM',
      'MATCH',
      'PROJECT',
      'DETAILS',
      'DISCOVERY',
      'QUALIFICATION',
      'FOLLOW_UP',
      'WEB_INTRO',
      'WHATSAPP_INTRO',
    ]) {
      expect([...RIYA_CONVERSATION_PHASES], forbidden).not.toContain(forbidden);
    }
  });

  it('(3) records exactly the five provenance sources, in precedence order', () => {
    expect([...RIYA_FIELD_PROVENANCE_SOURCES]).toStrictEqual([
      'model_inferred',
      'server_runtime',
      'user_selected',
      'user_stated',
      'user_confirmed',
    ]);
  });

  it('(4) carries no provenance alias', () => {
    for (const forbidden of ['inferred', 'user', 'system', 'default', 'unknown', 'model']) {
      expect([...RIYA_FIELD_PROVENANCE_SOURCES], forbidden).not.toContain(forbidden);
    }
  });

  it('(5) records the precedence ranks WITHOUT exporting a merge reducer', () => {
    // model_inferred < server_runtime < user_selected == user_stated < user_confirmed.
    expect(PROVENANCE_PRECEDENCE_RANK).toStrictEqual({
      model_inferred: 1,
      server_runtime: 2,
      user_selected: 3,
      user_stated: 3,
      user_confirmed: 4,
    });
    // Choosing a chip and typing the same words are the same act of telling us. Ranking one above
    // the other would let a surface affordance change how much a client's own words counted.
    expect(PROVENANCE_PRECEDENCE_RANK.user_selected).toBe(PROVENANCE_PRECEDENCE_RANK.user_stated);
    expect(PROVENANCE_PRECEDENCE_RANK.user_confirmed).toBeGreaterThan(
      PROVENANCE_PRECEDENCE_RANK.user_stated,
    );
    expect(PROVENANCE_PRECEDENCE_RANK.model_inferred).toBeLessThan(
      PROVENANCE_PRECEDENCE_RANK.server_runtime,
    );
    // Every source is ranked; a new one cannot arrive unranked.
    expect(Object.keys(PROVENANCE_PRECEDENCE_RANK).sort()).toStrictEqual(
      [...RIYA_FIELD_PROVENANCE_SOURCES].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Summary readiness. The owner correction.
// ---------------------------------------------------------------------------

/** The four RWC-P0B/P1B fields a conversation must have learned before a summary can be shown. */
const REQUIRED_BEFORE_SUMMARY: readonly DiscoveryField[] = [
  'serviceInterest',
  'location',
  'budget',
  'timeline',
];

/** A discovery snapshot that IS summary-ready, plus provenance accounting for each value. */
function summaryReady(over: { readonly without?: DiscoveryField } = {}): {
  discovery: NeedDiscoveryInput;
  fieldProvenance: RiyaContinuityFieldProvenanceMap;
} {
  const present = REQUIRED_BEFORE_SUMMARY.filter((field) => field !== over.without);
  const provenance: Record<string, string> = {};
  for (const field of present) {
    provenance[field] = 'user_stated';
  }
  return {
    discovery: discoveryWith(present),
    fieldProvenance: provenance,
  };
}

describe('a summary cannot be shown before the conversation has learned enough', () => {
  // The defect this suite exists to prevent: the first version accepted SUMMARY -- and CONTACT,
  // CONSENT and COMPLETE -- with an entirely EMPTY discovery. This package claims to validate
  // whether a state is one Riya could legitimately be in, and "show the client a summary of nothing
  // and ask them to confirm it" is not such a state. It is also the shape a lost or half-applied
  // update leaves behind, which is exactly when a summary card would be rendered blank.
  //
  // RWC-P0B/P1B froze the four: service, city, budget, timeline. In current NeedDiscovery those are
  // serviceInterestRef, locationRef, budgetNote and timelineNote.

  it('(1) SUMMARY with all four required fields and an unconfirmed summary is accepted', () => {
    const state = createRiyaConversationContinuityState(
      stateInput({ phase: 'SUMMARY', summaryConfirmed: false, ...summaryReady() }),
    );
    expect(state.phase).toBe('SUMMARY');
    expect(state.summaryConfirmed).toBe(false);
  });

  it('(2) SUMMARY with all four and a confirmed summary is accepted', () => {
    const state = createRiyaConversationContinuityState(
      stateInput({ phase: 'SUMMARY', summaryConfirmed: true, ...summaryReady() }),
    );
    expect(state.summaryConfirmed).toBe(true);
  });

  it('(3-6) removing any ONE required field refuses SUMMARY', () => {
    for (const field of REQUIRED_BEFORE_SUMMARY) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({ phase: 'SUMMARY', ...summaryReady({ without: field }) }),
          ),
        'invalid-phase-state',
        `SUMMARY without ${field}`,
      );
    }
  });

  it('(7, 8) CONTACT and CONSENT require all four AND a confirmed summary', () => {
    for (const phase of ['CONTACT', 'CONSENT'] as const) {
      expect(
        createRiyaConversationContinuityState(
          stateInput({ phase, summaryConfirmed: true, ...summaryReady() }),
        ).phase,
        phase,
      ).toBe(phase);
      for (const field of REQUIRED_BEFORE_SUMMARY) {
        expectCode(
          () =>
            createRiyaConversationContinuityState(
              stateInput({ phase, summaryConfirmed: true, ...summaryReady({ without: field }) }),
            ),
          'invalid-phase-state',
          `${phase} without ${field}`,
        );
      }
    }
  });

  it('(9, 10) COMPLETE requires all four, a confirmed summary and evidence', () => {
    const complete = {
      phase: 'COMPLETE' as const,
      summaryConfirmed: true,
      completionEvidenceRef: 'qf.confirm.outcome.0001',
    };
    expect(
      createRiyaConversationContinuityState(stateInput({ ...complete, ...summaryReady() }))
        .completionEvidenceRef,
    ).toBe('qf.confirm.outcome.0001');
    for (const field of REQUIRED_BEFORE_SUMMARY) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({ ...complete, ...summaryReady({ without: field }) }),
          ),
        'invalid-phase-state',
        `COMPLETE without ${field}`,
      );
    }
  });

  it('(11) the OPTIONAL fields never block a summary', () => {
    // `propertyType`, `scope` and `consultationPreference` are genuinely optional. Requiring them
    // would quietly redefine what "ready to summarise" means, and would strand conversations that
    // legitimately never needed them.
    const ready = summaryReady();
    for (const optional of ['propertyType', 'scope', 'consultationPreference'] as const) {
      expect(ready.discovery).not.toHaveProperty(DISCOVERY_VALUE_KEY[optional]);
    }
    expect(
      createRiyaConversationContinuityState(stateInput({ phase: 'SUMMARY', ...ready })).phase,
    ).toBe('SUMMARY');
  });

  it('(12) any valid provenance source satisfies readiness — user_confirmed is NOT required', () => {
    // Readiness is about whether the four values EXIST, not about how strongly they are held.
    // Requiring `user_confirmed` here would silently import a merge rule RWC-P4 owns, and would
    // make it impossible to render the summary card the client is meant to confirm.
    for (const source of RIYA_FIELD_PROVENANCE_SOURCES) {
      const provenance: Record<string, string> = {};
      for (const field of REQUIRED_BEFORE_SUMMARY) {
        provenance[field] = source;
      }
      expect(
        createRiyaConversationContinuityState(
          stateInput({
            phase: 'SUMMARY',
            discovery: discoveryWith(REQUIRED_BEFORE_SUMMARY),
            fieldProvenance: provenance,
          }),
        ).phase,
        source,
      ).toBe('SUMMARY');
    }
  });

  it('(13) an OPAQUE locationRef satisfies readiness structurally — no city validation', () => {
    // RWC-P5 owns canonical City Context. P2A asks only whether a location was learned, never what
    // it resolves to: no catalogue lookup, no availability check, no `projectCity`, and no geocode.
    for (const opaque of ['city.blr', 'area.indiranagar', 'loc.560038', 'catalogue.ref.99']) {
      const provenance: Record<string, string> = {};
      for (const field of REQUIRED_BEFORE_SUMMARY) {
        provenance[field] = 'user_stated';
      }
      const discovery = {
        ...discoveryWith(REQUIRED_BEFORE_SUMMARY),
        locationRef: opaque,
      } as NeedDiscoveryInput;
      const state = createRiyaConversationContinuityState(
        stateInput({
          phase: 'SUMMARY',
          discovery,
          fieldProvenance: provenance,
        }),
      );
      expect(state.discovery.locationRef, opaque).toBe(opaque);
    }
  });

  it('does NOT require completeness === SUFFICIENT_FOR_CORE_REVIEW', () => {
    // ADR-0067 completeness answers a DIFFERENT question -- whether Core may review a lead proposal
    // -- and borrowing it as a summary gate would silently redefine it. The accepted states above
    // all carry MORE_DISCOVERY_REQUIRED.
    const ready = summaryReady();
    expect(ready.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
    expect(
      createRiyaConversationContinuityState(stateInput({ phase: 'SUMMARY', ...ready })).discovery
        .completeness,
    ).toBe('MORE_DISCOVERY_REQUIRED');
  });

  it('readiness is NOT required before SUMMARY', () => {
    // The five earlier phases are where the four fields are still being learned. Requiring them
    // there would make every conversation invalid until the moment it became summarisable.
    for (const phase of [
      'INTRO',
      'NEED',
      'LOCATION',
      'PROJECT_DETAILS',
      'BUDGET_TIMELINE',
    ] as const) {
      expect(createRiyaConversationContinuityState(stateInput({ phase })).phase, phase).toBe(phase);
    }
  });
});

// ---------------------------------------------------------------------------
// 6-11. Valid states.
// ---------------------------------------------------------------------------

describe('valid states', () => {
  it('(6) a minimal INTRO state parses and is deeply frozen', () => {
    const state = createRiyaConversationContinuityState(stateInput());
    expect(state.version).toBe(1);
    expect(state.phase).toBe('INTRO');
    expect(state.continuityRevision).toBe(0);
    expect(state.summaryConfirmed).toBe(false);
    expect(state.completionEvidenceRef).toBeUndefined();
    expect(state.fieldProvenance).toStrictEqual({});
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.fieldProvenance)).toBe(true);
    expect(Object.isFrozen(state.discovery)).toBe(true);
  });

  it('(7, 8) SUMMARY permits an unconfirmed and a confirmed summary', () => {
    // Summary-ready, so the only variable under test is the confirmation flag.
    expect(
      createRiyaConversationContinuityState(stateInput({ phase: 'SUMMARY', ...summaryReady() }))
        .summaryConfirmed,
    ).toBe(false);
    expect(
      createRiyaConversationContinuityState(
        stateInput({ phase: 'SUMMARY', summaryConfirmed: true, ...summaryReady() }),
      ).summaryConfirmed,
    ).toBe(true);
  });

  it('(9, 10) CONTACT and CONSENT require a confirmed summary', () => {
    for (const phase of ['CONTACT', 'CONSENT'] as const) {
      expect(
        createRiyaConversationContinuityState(
          stateInput({ phase, summaryConfirmed: true, ...summaryReady() }),
        ).phase,
      ).toBe(phase);
    }
  });

  it('(11) COMPLETE parses with a confirmed summary and bounded evidence', () => {
    const state = createRiyaConversationContinuityState(
      stateInput({
        phase: 'COMPLETE',
        summaryConfirmed: true,
        completionEvidenceRef: 'qf.confirm.outcome.0001',
        ...summaryReady(),
      }),
    );
    expect(state.phase).toBe('COMPLETE');
    expect(state.completionEvidenceRef).toBe('qf.confirm.outcome.0001');
  });
});

// ---------------------------------------------------------------------------
// 12-17. Identity and revision.
// ---------------------------------------------------------------------------

describe('identity is tenant + conversation, and the revision is its own', () => {
  it('(12, 13) both identifiers are required and bounded', () => {
    for (const bad of ['', ' ', 'has space', 'a@b.com', '+919876543210', 'x'.repeat(129)]) {
      expectCode(
        () => createRiyaConversationContinuityState(stateInput({ tenantId: bad })),
        'invalid-input',
        `tenantId=${bad.slice(0, 12)}`,
      );
      expectCode(
        () => createRiyaConversationContinuityState(stateInput({ conversationId: bad })),
        'invalid-input',
        `conversationId=${bad.slice(0, 12)}`,
      );
    }
  });

  it('(13) a conversation id alone is never the key: the same id under two tenants is two states', () => {
    // ADR-0076 §3 removed global uniqueness of `conversationId`. A continuity state that keyed on it
    // alone would merge two tenants' conversations into one.
    const a = createRiyaConversationContinuityState(stateInput({ tenantId: 'tenant.a' }));
    const b = createRiyaConversationContinuityState(stateInput({ tenantId: 'tenant.b' }));
    expect(a.conversationId).toBe(b.conversationId);
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it('(14, 15) revision 0 and positive integers are accepted', () => {
    for (const revision of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
      expect(
        createRiyaConversationContinuityState(stateInput({ continuityRevision: revision }))
          .continuityRevision,
      ).toBe(revision);
    }
  });

  it('(16) negative, fractional and unsafe revisions are refused', () => {
    for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expectCode(
        () => createRiyaConversationContinuityState(stateInput({ continuityRevision: revision })),
        'invalid-input',
        `revision=${String(revision)}`,
      );
    }
  });

  it('(17) there is no channel field, and one cannot be supplied', () => {
    const state = createRiyaConversationContinuityState(stateInput());
    expect(Object.keys(state)).not.toContain('channel');
    for (const field of ['channel', 'surface', 'origin', 'providerMessageRef']) {
      expectCode(
        () =>
          createRiyaConversationContinuityState({
            ...stateInput(),
            [field]: 'WEB',
          }),
        'invalid-input',
        field,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 18-21. NeedDiscovery reuse.
// ---------------------------------------------------------------------------

describe('need discovery is REUSED, never duplicated', () => {
  it('(18) the embedded discovery is the real ADR-0067 contract', () => {
    const state = createRiyaConversationContinuityState(
      stateInput({
        discovery: discoveryWith(['serviceInterest']),
        fieldProvenance: { serviceInterest: 'user_stated' },
      }),
    );
    // `behaviourVersion` is stamped by `createNeedDiscovery` and by nothing here -- proof the
    // snapshot came through the real constructor rather than being copied in.
    expect(state.discovery.behaviourVersion).toBe(1);
    expect(state.discovery.serviceInterestRef).toBe('ref.value.1');
    expect(state.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
  });

  it('(19) the returned discovery is independent of the caller object', () => {
    const input = stateInput({
      discovery: discoveryWith(['location']),
      fieldProvenance: { location: 'user_selected' },
    });
    const state = createRiyaConversationContinuityState(input);
    // Mutating the caller's input afterwards must not reach the frozen state.
    (input.discovery as { locationRef?: string }).locationRef = 'MUTATED';
    expect(state.discovery.locationRef).toBe('ref.value.1');
    expect(Object.isFrozen(state.discovery)).toBe(true);
  });

  it('(20) an invalid discovery is refused with its own code', () => {
    // The one combination ADR-0067 calls a lie: sufficient for review while fields are missing.
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({
            discovery: {
              completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
              missingFields: ['budget'],
            },
          }),
        ),
      'invalid-discovery',
    );
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({
            discovery: { completeness: 'NOT_A_COMPLETENESS' } as unknown as NeedDiscoveryInput,
          }),
        ),
      'invalid-discovery',
    );
  });

  it('(21) no second requirement draft exists on the state', () => {
    const state = createRiyaConversationContinuityState(stateInput());
    // A parallel draft would immediately become a second source of truth about the same project.
    for (const forbidden of [
      'requirement',
      'requirements',
      'draft',
      'service',
      'subcategory',
      'projectCity',
      'projectArea',
      'propertyType',
      'budgetRange',
      'timeline',
      'notes',
    ]) {
      expect(Object.keys(state), forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(state).sort()).toStrictEqual([
      'completionEvidenceRef',
      'continuityRevision',
      'conversationId',
      'discovery',
      'fieldProvenance',
      'phase',
      'summaryConfirmed',
      'tenantId',
      'version',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 22-27. Provenance invariants.
// ---------------------------------------------------------------------------

describe('provenance must account for exactly the values that are there', () => {
  it('(22) a present value without provenance is refused', () => {
    expectCode(
      () =>
        createRiyaConversationContinuityState(stateInput({ discovery: discoveryWith(['budget']) })),
      'invalid-provenance',
    );
  });

  it('(23) provenance for an absent value is refused', () => {
    // The fossil of a field the client corrected away. Keeping it would let a later merge resurrect
    // a claim about something that is no longer stated.
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({ fieldProvenance: { budget: 'user_stated' } }),
        ),
      'invalid-provenance',
    );
  });

  it('(24) an unknown provenance key is refused', () => {
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({
            fieldProvenance: { notAField: 'user_stated' } as RiyaContinuityFieldProvenanceMap,
          }),
        ),
      'invalid-input',
    );
  });

  it('(25) a provenance value outside the closed set is refused', () => {
    for (const bad of ['inferred', 'USER_STATED', 'system', '']) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({
              discovery: discoveryWith(['scope']),
              fieldProvenance: { scope: bad } as unknown as RiyaContinuityFieldProvenanceMap,
            }),
          ),
        'invalid-input',
        bad,
      );
    }
  });

  it('(26) a field cannot be missing and present at the same time', () => {
    const contradictory: NeedDiscoveryInput = {
      timelineNote: 'Within a month.',
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: [...ALL_FIELDS],
    };
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({
            discovery: contradictory,
            fieldProvenance: { timeline: 'user_stated' },
          }),
        ),
      'invalid-provenance',
    );
  });

  it('(27) every one of the seven discovery fields is covered, both ways', () => {
    // A mapping gap would leave one field silently unchecked, and it would be whichever one nobody
    // wrote a test for. So the loop IS the test.
    expect(ALL_FIELDS).toHaveLength(7);
    for (const field of ALL_FIELDS) {
      const withValue = discoveryWith([field]);
      // Present + provenance -> accepted, and the provenance survives.
      const ok = createRiyaConversationContinuityState(
        stateInput({ discovery: withValue, fieldProvenance: { [field]: 'user_confirmed' } }),
      );
      expect(ok.fieldProvenance[field], field).toBe('user_confirmed');
      // Present + no provenance -> refused.
      expectCode(
        () => createRiyaConversationContinuityState(stateInput({ discovery: withValue })),
        'invalid-provenance',
        `${field} unaccounted`,
      );
      // Absent + provenance -> refused.
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({ fieldProvenance: { [field]: 'model_inferred' } }),
          ),
        'invalid-provenance',
        `${field} stale`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 28-33. Phase invariants.
// ---------------------------------------------------------------------------

describe('phase, summary confirmation and completion evidence agree or the state is refused', () => {
  const BEFORE: readonly RiyaConversationPhase[] = [
    'INTRO',
    'NEED',
    'LOCATION',
    'PROJECT_DETAILS',
    'BUDGET_TIMELINE',
  ];
  const AFTER: readonly RiyaConversationPhase[] = ['CONTACT', 'CONSENT', 'COMPLETE'];

  it('(28) a phase before SUMMARY cannot claim the summary was confirmed', () => {
    for (const phase of BEFORE) {
      expectCode(
        () => createRiyaConversationContinuityState(stateInput({ phase, summaryConfirmed: true })),
        'invalid-phase-state',
        phase,
      );
    }
  });

  it('(29) a phase after SUMMARY cannot claim it was not', () => {
    for (const phase of AFTER) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({
              phase,
              summaryConfirmed: false,
              ...summaryReady(),
              ...(phase === 'COMPLETE' ? { completionEvidenceRef: 'qf.confirm.1' } : {}),
            }),
          ),
        'invalid-phase-state',
        phase,
      );
    }
  });

  it('(30) SUMMARY itself permits both', () => {
    expect(
      createRiyaConversationContinuityState(stateInput({ phase: 'SUMMARY', ...summaryReady() }))
        .phase,
    ).toBe('SUMMARY');
    expect(
      createRiyaConversationContinuityState(
        stateInput({ phase: 'SUMMARY', summaryConfirmed: true, ...summaryReady() }),
      ).phase,
    ).toBe('SUMMARY');
  });

  it('(31) a non-COMPLETE phase cannot carry completion evidence', () => {
    for (const phase of RIYA_CONVERSATION_PHASES.filter((p) => p !== 'COMPLETE')) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({
              phase,
              summaryConfirmed: !BEFORE.includes(phase),
              // Summary-ready throughout, so the ONLY defect under test is the stray evidence.
              ...summaryReady(),
              completionEvidenceRef: 'qf.confirm.1',
            }),
          ),
        'invalid-phase-state',
        phase,
      );
    }
  });

  it('(32) COMPLETE without evidence is refused', () => {
    expectCode(
      () =>
        createRiyaConversationContinuityState(
          stateInput({ phase: 'COMPLETE', summaryConfirmed: true, ...summaryReady() }),
        ),
      'invalid-phase-state',
    );
  });

  it('(33) completion evidence stays an OPAQUE bounded reference', () => {
    // It records that a governed confirm boundary completed. It is not a lead payload, and the
    // grammar makes it impossible for one to be smuggled through it.
    for (const bad of [
      'a@b.com',
      '+919876543210',
      'Client agreed on the phone',
      '{"leadId":"1"}',
      'x'.repeat(129),
    ]) {
      expectCode(
        () =>
          createRiyaConversationContinuityState(
            stateInput({
              phase: 'COMPLETE',
              summaryConfirmed: true,
              completionEvidenceRef: bad,
            }),
          ),
        'invalid-input',
        bad.slice(0, 14),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 34-40. Authority, privacy and immutability.
// ---------------------------------------------------------------------------

describe('the state cannot express business authority or personal data', () => {
  const forbiddenFields = {
    '(34) contact': ['name', 'fullName', 'phone', 'phoneNumber', 'email', 'contact'],
    '(35) consent / submission': [
      'consent',
      'consentGiven',
      'optOut',
      'suppression',
      'canSubmit',
      'businessCanSubmit',
      'confirmNonce',
    ],
    '(36) lead / vendor / pricing': [
      'leadId',
      'assignment',
      'vendorId',
      'vendorAvailability',
      'preferredVendor',
      'packagePrice',
      'pricing',
      'isDuplicate',
    ],
    '(37) channel / provider': [
      'channel',
      'webSessionToken',
      'cookie',
      'csrf',
      'ipAddress',
      'userAgent',
    ],
    '(38) transcript / summary blob': [
      'transcript',
      'history',
      'messages',
      'recentTurns',
      'conversationSummary',
      'rollingSummary',
      'contextWindow',
    ],
  } as const;

  for (const [label, fields] of Object.entries(forbiddenFields)) {
    it(`${label} fields are refused`, () => {
      for (const field of fields) {
        expectCode(
          () =>
            createRiyaConversationContinuityState({
              ...stateInput(),
              [field]: 'x',
            }),
          'invalid-input',
          field,
        );
      }
    });
  }

  it('(39) any unknown field at all is refused, not ignored', () => {
    expectCode(
      () =>
        createRiyaConversationContinuityState({
          ...stateInput(),
          somethingNobodyReviewed: 1,
        } as RiyaConversationContinuityStateInput),
      'invalid-input',
    );
  });

  it('(40) mutating the caller input cannot mutate the returned state', () => {
    const provenance: Record<string, string> = { serviceInterest: 'user_stated' };
    const input = stateInput({
      discovery: discoveryWith(['serviceInterest']),
      fieldProvenance: provenance,
    });
    const state = createRiyaConversationContinuityState(input);

    provenance['serviceInterest'] = 'model_inferred';
    provenance['budget'] = 'model_inferred';

    expect(state.fieldProvenance.serviceInterest).toBe('user_stated');
    expect(state.fieldProvenance.budget).toBeUndefined();
    // And the state itself refuses direct mutation.
    expect(() => {
      (state as { phase: string }).phase = 'COMPLETE';
    }).toThrow();
  });
});

describe('errors are bounded and content-free', () => {
  it('exposes exactly four codes, frozen', () => {
    expect([...RIYA_CONVERSATION_CONTINUITY_ERROR_CODES]).toStrictEqual([
      'invalid-input',
      'invalid-discovery',
      'invalid-provenance',
      'invalid-phase-state',
    ]);
    expect(Object.isFrozen(RIYA_CONVERSATION_CONTINUITY_ERROR_CODES)).toBe(true);
  });

  it('never quotes the offending value or names the failing field', () => {
    // The input is conversational: a zod message could carry a client's own words about their home
    // into a log or an alert.
    // Whitespace makes it fail the identifier grammar, so it genuinely reaches the error path.
    const secret = 'My Secret Home Address';
    let message = '';
    try {
      createRiyaConversationContinuityState(stateInput({ tenantId: secret }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(secret);
    for (const forbidden of ['tenantId', 'zod', 'regex', 'expected', 'received', 'path']) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
