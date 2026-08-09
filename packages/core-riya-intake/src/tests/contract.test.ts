/**
 * RWC-P6A — the Core Riya intake contracts (ADR-0101 §30–§31).
 *
 * Three artifacts, one theme: **Jarvis asks, Core answers, and nothing in between may be forged.**
 *
 * The request is powerless by construction, the state carries evidence rather than booleans, and the
 * result's `ACCEPTED` case is the single door through which a completion evidence reference can ever
 * reach a conversation. Most of the specs below are therefore refusals — the interesting failures are
 * the plausible-looking values that must not get through.
 */
import { idempotencyKeySchema } from '@qf-jarvis/contracts';
import { describe, expect, it } from 'vitest';

import {
  CORE_RIYA_INTAKE_CONTRACT_VERSION,
  CORE_RIYA_INTAKE_ERROR_CODES,
  CoreRiyaIntakeError,
  createCoreRiyaIntakeSubmissionRequestV1,
  parseCoreRiyaIntakeStateV1,
  parseCoreRiyaIntakeSubmissionLookupV1,
  parseCoreRiyaIntakeSubmissionResultV1,
} from '../index.js';
import { syntheticIntakeState } from '../testing/index.js';

const refuses = (run: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CoreRiyaIntakeError);
  expect((thrown as CoreRiyaIntakeError).code).toBe(code);
};

// ---------------------------------------------------------------------------
// The intake state.
// ---------------------------------------------------------------------------

function state(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    stateRef: 'core.intake.state.1',
    subjectRef: 'subject.1',
    contact: { state: 'READY', evidenceRef: 'core.contact.1' },
    consent: { state: 'GRANTED', evidenceRef: 'core.consent.1' },
    ...over,
  };
}

describe('contact state: evidence exactly when something happened', () => {
  it('MISSING without evidence is accepted', () => {
    const parsed = parseCoreRiyaIntakeStateV1(state({ contact: { state: 'MISSING' } }));
    expect(parsed.contact.state).toBe('MISSING');
    // ABSENT, not present-holding-undefined: an own key holding `undefined` is a different object.
    expect('evidenceRef' in parsed.contact).toBe(false);
  });

  it('MISSING WITH evidence is refused', () => {
    // Evidence of an absence is not a thing. Permitting it would let a caller attach a reference to
    // nothing and have the state look answered.
    refuses(
      () =>
        parseCoreRiyaIntakeStateV1(
          state({ contact: { state: 'MISSING', evidenceRef: 'core.contact.1' } }),
        ),
      'invalid-intake-state',
    );
  });

  it('READY with evidence is accepted', () => {
    const parsed = parseCoreRiyaIntakeStateV1(state());
    expect(parsed.contact).toStrictEqual({ state: 'READY', evidenceRef: 'core.contact.1' });
  });

  it('READY WITHOUT evidence is refused', () => {
    // A bare "ready" is a claim, and a claim is worth nothing when it is challenged.
    refuses(
      () => parseCoreRiyaIntakeStateV1(state({ contact: { state: 'READY' } })),
      'invalid-intake-state',
    );
  });
});

describe('consent state: every decision is evidenced, including the refusals', () => {
  it('MISSING without evidence is accepted', () => {
    const parsed = parseCoreRiyaIntakeStateV1(state({ consent: { state: 'MISSING' } }));
    expect('evidenceRef' in parsed.consent).toBe(false);
  });

  it('MISSING with evidence is refused', () => {
    refuses(
      () =>
        parseCoreRiyaIntakeStateV1(
          state({ consent: { state: 'MISSING', evidenceRef: 'core.consent.1' } }),
        ),
      'invalid-intake-state',
    );
  });

  for (const decision of ['GRANTED', 'DECLINED', 'OPTED_OUT']) {
    it(`${decision} requires evidence`, () => {
      // A refusal is as much a thing that happened as an agreement -- and the one most likely to be
      // challenged later.
      refuses(
        () => parseCoreRiyaIntakeStateV1(state({ consent: { state: decision } })),
        'invalid-intake-state',
      );
      const parsed = parseCoreRiyaIntakeStateV1(
        state({ consent: { state: decision, evidenceRef: 'core.consent.1' } }),
      );
      expect(parsed.consent.state).toBe(decision);
    });
  }

  it('DECLINED and OPTED_OUT are DIFFERENT states', () => {
    // Declining one intake is not withdrawing from contact altogether. Collapsing them would either
    // over-apply a refusal or -- far worse -- under-apply an opt-out.
    const declined = parseCoreRiyaIntakeStateV1(
      state({ consent: { state: 'DECLINED', evidenceRef: 'core.consent.1' } }),
    );
    const optedOut = parseCoreRiyaIntakeStateV1(
      state({ consent: { state: 'OPTED_OUT', evidenceRef: 'core.consent.1' } }),
    );
    expect(declined.consent.state).not.toBe(optedOut.consent.state);
  });
});

describe('the state carries no personal or business data', () => {
  const rejected: Record<string, unknown> = {
    'a non-object': 'nope',
    null: null,
    'an array': [],
    'a wrong version': state({ version: 2 }),
    'an extra top-level key': state({ phone: '9876543210' }),
    'an extra contact key': state({
      contact: { state: 'READY', evidenceRef: 'core.contact.1', phone: '9876543210' },
    }),
    'an extra consent key': state({
      consent: { state: 'GRANTED', evidenceRef: 'core.consent.1', statementText: 'I agree' },
    }),
    'an unknown contact state': state({ contact: { state: 'PARTIAL' } }),
    'an unknown consent state': state({ consent: { state: 'MAYBE' } }),
    'a canSubmit claim': state({ canSubmit: true }),
    'a lead reference': state({ leadRef: 'lead.1' }),
  };
  for (const [label, value] of Object.entries(rejected)) {
    it(`refuses ${label}`, () => {
      refuses(() => parseCoreRiyaIntakeStateV1(value), 'invalid-intake-state');
    });
  }

  for (const forged of ['client@example.com', '+919876543210', 'I agree to be contacted', 'a b']) {
    it(`refuses an evidence reference shaped like "${forged}"`, () => {
      // The grammar has no `@`, no `+`, no whitespace. An email, an E.164 number and a sentence are
      // all unrepresentable -- which is what stops evidence becoming a place contact data hides.
      refuses(
        () =>
          parseCoreRiyaIntakeStateV1(state({ contact: { state: 'READY', evidenceRef: forged } })),
        'invalid-intake-state',
      );
    });
  }

  it('refuses a subjectRef that is not opaque', () => {
    refuses(
      () => parseCoreRiyaIntakeStateV1(state({ subjectRef: 'client@example.com' })),
      'invalid-intake-state',
    );
  });

  it('is deeply frozen and does not retain the caller object', () => {
    const input = state();
    const before = JSON.stringify(input);
    const parsed = parseCoreRiyaIntakeStateV1(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.contact)).toBe(true);
    expect(Object.isFrozen(parsed.consent)).toBe(true);
    expect(parsed.contact).not.toBe((input as { contact: unknown }).contact);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('errors name nothing they refused', () => {
    let message = '';
    try {
      parseCoreRiyaIntakeStateV1(state({ subjectRef: 'subject.secret-internal-name' }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    // That value is actually valid, so force a real failure with it present alongside a bad field.
    try {
      parseCoreRiyaIntakeStateV1(
        state({ subjectRef: 'subject.secret-internal-name', contact: { state: 'READY' } }),
      );
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of ['secret-internal-name', 'evidenceRef', 'zod', 'expected']) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// The submission request.
// ---------------------------------------------------------------------------

const DISCOVERY = {
  serviceInterestRef: 'svc.one',
  locationRef: 'city.alpha',
  budgetNote: 'around 8 lakh',
  timelineNote: 'next month',
  completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
};

const KEY = `riya-intake.${'a'.repeat(64)}`;

function request(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    producingSystem: 'qf-jarvis',
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    subjectRef: 'subject.1',
    continuityRevision: 7,
    intakeStateRef: 'core.intake.state.1',
    availabilitySnapshotRef: 'snap.1',
    taxonomyVersion: 7,
    discovery: DISCOVERY,
    summaryConfirmed: true,
    idempotencyKey: KEY,
    ...over,
  };
}

describe('the submission request is powerless by construction', () => {
  it('accepts the minimum canonical request', () => {
    const built = createCoreRiyaIntakeSubmissionRequestV1(request());
    expect(built.contractVersion).toBe(CORE_RIYA_INTAKE_CONTRACT_VERSION);
    expect(built.producingSystem).toBe('qf-jarvis');
    expect(built.summaryConfirmed).toBe(true);
    expect(Object.isFrozen(built)).toBe(true);
  });

  it('producingSystem is a LITERAL, so it cannot be claimed by anything else', () => {
    refuses(
      () =>
        createCoreRiyaIntakeSubmissionRequestV1(request({ producingSystem: 'quickfurno-core' })),
      'invalid-submission-request',
    );
  });

  it('re-proves the discovery through the REAL constructor', () => {
    // Not "looks like a discovery". A second copy of ADR-0067's rules here is how this package and
    // that contract would come to disagree about what a valid snapshot is.
    refuses(
      () =>
        createCoreRiyaIntakeSubmissionRequestV1(
          request({ discovery: { ...DISCOVERY, serviceInterestRef: 'not a valid ref!' } }),
        ),
      'invalid-submission-request',
    );
    refuses(
      () =>
        createCoreRiyaIntakeSubmissionRequestV1(
          request({ discovery: { ...DISCOVERY, unknownField: 'x' } }),
        ),
      'invalid-submission-request',
    );
  });

  it('requires all four summary-required values', () => {
    for (const key of ['serviceInterestRef', 'locationRef', 'budgetNote', 'timelineNote']) {
      // Rebuilt without the key rather than deleted from a copy: an own key holding `undefined` is
      // not the same as an absent one, and absence is what a missing value looks like.
      const partial = Object.fromEntries(
        Object.entries({ ...DISCOVERY, completeness: 'MORE_DISCOVERY_REQUIRED' }).filter(
          ([name]) => name !== key,
        ),
      );
      refuses(
        () => createCoreRiyaIntakeSubmissionRequestV1(request({ discovery: partial })),
        'invalid-submission-request',
      );
    }
  });

  it('summaryConfirmed must be the literal true', () => {
    refuses(
      () => createCoreRiyaIntakeSubmissionRequestV1(request({ summaryConfirmed: false })),
      'invalid-submission-request',
    );
  });

  const forbiddenKeys: Record<string, Record<string, unknown>> = {
    'raw contact': { phone: '9876543210' },
    'an email': { email: 'client@example.com' },
    'a name': { customerName: 'A Person' },
    'a consent boolean': { consentGranted: true },
    'field provenance': { fieldProvenance: { location: 'user_confirmed' } },
    'a lead reference': { leadRef: 'lead.1' },
    'a canSubmit claim': { canSubmit: true },
    'an outcome': { outcome: 'ACCEPTED' },
    'arbitrary metadata': { metadata: { note: 'x' } },
    'a transcript': { transcript: 'hello' },
    'model output': { replyBody: 'Thanks!' },
    'a reason prose field': { reason: 'the client is keen' },
  };
  for (const [label, extra] of Object.entries(forbiddenKeys)) {
    it(`refuses ${label}`, () => {
      refuses(
        () => createCoreRiyaIntakeSubmissionRequestV1(request(extra)),
        'invalid-submission-request',
      );
    });
  }

  it('requires the idempotency key, the snapshot ref and the taxonomy version', () => {
    for (const key of ['idempotencyKey', 'availabilitySnapshotRef', 'taxonomyVersion']) {
      const partial = Object.fromEntries(
        Object.entries(request()).filter(([name]) => name !== key),
      );
      refuses(() => createCoreRiyaIntakeSubmissionRequestV1(partial), 'invalid-submission-request');
    }
  });

  it('does not mutate the caller object', () => {
    const input = request();
    const before = JSON.stringify(input);
    createCoreRiyaIntakeSubmissionRequestV1(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Idempotency governance.
// ---------------------------------------------------------------------------

describe('the idempotency key agrees with the repository contract', () => {
  it('the preferred RWC-P6B form satisfies the existing `idempotencyKeySchema`', () => {
    // The key is derived in P6B, not here. What this pins is that the shape P6B intends is already
    // legal to the shared contract -- so the two cannot be discovered to disagree at composition time.
    const preferred = `riya-intake.${'0123456789abcdef'.repeat(4)}`;
    expect(preferred).toHaveLength(76);
    expect(idempotencyKeySchema.safeParse(preferred).success).toBe(true);
    expect(
      createCoreRiyaIntakeSubmissionRequestV1(request({ idempotencyKey: preferred }))
        .idempotencyKey,
    ).toBe(preferred);
  });

  it('a key that this contract accepts is one the shared schema accepts', () => {
    for (const key of [KEY, 'riya-intake.abc123', 'a'.repeat(16)]) {
      expect({ key, shared: idempotencyKeySchema.safeParse(key).success }).toStrictEqual({
        key,
        shared: true,
      });
    }
  });

  it('a too-short key is refused', () => {
    refuses(
      () => createCoreRiyaIntakeSubmissionRequestV1(request({ idempotencyKey: 'short' })),
      'invalid-submission-request',
    );
  });
});

// ---------------------------------------------------------------------------
// The submission result.
// ---------------------------------------------------------------------------

function result(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    idempotencyKey: KEY,
    outcome: 'ACCEPTED',
    completionEvidenceRef: 'core.intake.evidence.1',
    ...over,
  };
}

describe('the submission result: ACCEPTED is the only door to completion evidence', () => {
  it('ACCEPTED requires completion evidence', () => {
    const parsed = parseCoreRiyaIntakeSubmissionResultV1(result());
    expect(parsed.outcome).toBe('ACCEPTED');
    expect(parsed.completionEvidenceRef).toBe('core.intake.evidence.1');
    const without = Object.fromEntries(
      Object.entries(result()).filter(([name]) => name !== 'completionEvidenceRef'),
    );
    refuses(() => parseCoreRiyaIntakeSubmissionResultV1(without), 'invalid-submission-result');
  });

  it('ACCEPTED carries no reason code', () => {
    refuses(
      () => parseCoreRiyaIntakeSubmissionResultV1(result({ reasonCode: 'all-good' })),
      'invalid-submission-result',
    );
  });

  for (const outcome of ['NOT_READY', 'REJECTED', 'HUMAN_REVIEW_REQUIRED']) {
    it(`${outcome} forbids completion evidence and requires a reason`, () => {
      refuses(
        () => parseCoreRiyaIntakeSubmissionResultV1(result({ outcome })),
        'invalid-submission-result',
      );
      const withoutEvidence = Object.fromEntries(
        Object.entries(result({ outcome })).filter(([name]) => name !== 'completionEvidenceRef'),
      );
      refuses(
        () => parseCoreRiyaIntakeSubmissionResultV1(withoutEvidence),
        'invalid-submission-result',
      );
      const parsed = parseCoreRiyaIntakeSubmissionResultV1({
        ...withoutEvidence,
        reasonCode: 'consent-missing',
      });
      expect(parsed.outcome).toBe(outcome);
      expect('completionEvidenceRef' in parsed).toBe(false);
    });
  }

  it('the idempotency key is echoed exactly', () => {
    // A result that does not name the submission it answers is unattributable -- which matters most
    // in the recovery path, where the whole question is "is this the answer to MY submission?".
    expect(parseCoreRiyaIntakeSubmissionResultV1(result()).idempotencyKey).toBe(KEY);
  });

  it('carries no contact, consent or business payload', () => {
    for (const extra of [
      { phone: '9876543210' },
      { consentGranted: true },
      { leadRef: 'lead.1' },
      { explanation: 'we could not reach the client' },
    ]) {
      refuses(
        () => parseCoreRiyaIntakeSubmissionResultV1(result(extra)),
        'invalid-submission-result',
      );
    }
  });

  it('a reason code is a token, not a sentence', () => {
    const base = Object.fromEntries(
      Object.entries(result({ outcome: 'REJECTED' })).filter(
        ([name]) => name !== 'completionEvidenceRef',
      ),
    );
    expect(
      parseCoreRiyaIntakeSubmissionResultV1({ ...base, reasonCode: 'consent-missing' }).reasonCode,
    ).toBe('consent-missing');
    refuses(
      () =>
        parseCoreRiyaIntakeSubmissionResultV1({
          ...base,
          reasonCode: 'The client has not consented yet.',
        }),
      'invalid-submission-result',
    );
  });

  it('an unknown outcome is refused', () => {
    refuses(
      () => parseCoreRiyaIntakeSubmissionResultV1(result({ outcome: 'MAYBE' })),
      'invalid-submission-result',
    );
  });
});

// ---------------------------------------------------------------------------
// The lookup.
// ---------------------------------------------------------------------------

describe('the submission lookup reports; it never authorizes', () => {
  it('NOT_FOUND forbids a result', () => {
    const parsed = parseCoreRiyaIntakeSubmissionLookupV1({
      contractVersion: 1,
      status: 'NOT_FOUND',
    });
    expect(parsed.status).toBe('NOT_FOUND');
    expect('result' in parsed).toBe(false);
    refuses(
      () =>
        parseCoreRiyaIntakeSubmissionLookupV1({
          contractVersion: 1,
          status: 'NOT_FOUND',
          result: result(),
        }),
      'invalid-lookup-result',
    );
  });

  it('FOUND requires a result', () => {
    refuses(
      () => parseCoreRiyaIntakeSubmissionLookupV1({ contractVersion: 1, status: 'FOUND' }),
      'invalid-lookup-result',
    );
    const parsed = parseCoreRiyaIntakeSubmissionLookupV1({
      contractVersion: 1,
      status: 'FOUND',
      result: result(),
    });
    expect(parsed.result?.completionEvidenceRef).toBe('core.intake.evidence.1');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.result)).toBe(true);
  });

  it('a FORGED nested result is re-proved, not trusted because it arrived in a wrapper', () => {
    // Otherwise the lookup would be the one path into continuity's completion evidence that skipped
    // every rule the result parser enforces.
    refuses(
      () =>
        parseCoreRiyaIntakeSubmissionLookupV1({
          contractVersion: 1,
          status: 'FOUND',
          // REJECTED carrying completion evidence: impossible through the result parser.
          result: result({ outcome: 'REJECTED', reasonCode: 'nope' }),
        }),
      'invalid-lookup-result',
    );
  });

  it('an unknown status and extra keys are refused', () => {
    refuses(
      () => parseCoreRiyaIntakeSubmissionLookupV1({ contractVersion: 1, status: 'PENDING' }),
      'invalid-lookup-result',
    );
    refuses(
      () =>
        parseCoreRiyaIntakeSubmissionLookupV1({
          contractVersion: 1,
          status: 'NOT_FOUND',
          retryAfter: 30,
        }),
      'invalid-lookup-result',
    );
  });
});

describe('the package surface', () => {
  it('exposes exactly four bounded error codes, frozen', () => {
    expect([...CORE_RIYA_INTAKE_ERROR_CODES]).toStrictEqual([
      'invalid-intake-state',
      'invalid-submission-request',
      'invalid-submission-result',
      'invalid-lookup-result',
    ]);
    expect(Object.isFrozen(CORE_RIYA_INTAKE_ERROR_CODES)).toBe(true);
  });

  it('the synthetic fixture is a real parsed state', () => {
    const fixture = syntheticIntakeState();
    expect(fixture.contact.state).toBe('READY');
    expect(fixture.consent.state).toBe('GRANTED');
    expect(Object.isFrozen(fixture)).toBe(true);
  });
});
