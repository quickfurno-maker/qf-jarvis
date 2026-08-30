/**
 * QFJ-P09 S2 readiness — CHARACTERIZATION of the communication-state evidence model (ADR-0134).
 *
 * **These specs assert what the contracts do TODAY, including where that is wrong.** They are not
 * approval of the current behaviour. Several of them pin a contradiction that ADR-0134 says must be
 * repaired by a versioned `CommunicationStateRecordV2`, and each one says so in as many words.
 *
 * Why pin a defect rather than fix it: the `rejected` deadlock is only visible when two schemas are
 * read together, and each is individually defensible. A one-sided "fix" — relaxing the state record,
 * or relaxing the authorization — would look correct in review and would silently destroy the
 * property `communication-model.md` is protecting. Pinning both halves makes any such change fail
 * here, loudly, next to a comment explaining what it broke.
 *
 * Nothing here weakens an existing assertion, changes a contract, or adds a failing test: every
 * expectation below passes against the contracts exactly as they stand on this baseline.
 */
import { describe, expect, it } from 'vitest';

import { validCommunicationRejectedOptOut } from '../fixtures/index.js';
import {
  COMMUNICATION_REFUSAL_REASONS,
  COMMUNICATION_REJECTION_REASONS,
  COMMUNICATION_STATES,
  communicationAuthorizationV1Schema,
  communicationResultV1Schema,
  communicationStateRecordV1Schema,
  STATES_JARVIS_MAY_NOT_ORIGINATE,
} from '../index.js';

const ID = (n: number): string => `${String(n).repeat(8)}-0000-4000-8000-000000000001`;

const COMMUNICATION = ID(1);
const REQUEST = ID(2);
const CORRELATION = ID(3);
const DECISION = ID(4);
const INTENT = ID(5);
const RESULT = ID(6);

/** A lawful Core refusal: opted out, no approval decision, no authorized channel. */
function rejectedAuthorization(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    communicationId: COMMUNICATION,
    communicationRequestId: REQUEST,
    issuer: 'quickfurno-core',
    outcome: 'rejected',
    decidedAt: '2026-08-30T10:00:00Z',
    reasonCode: 'recipient-opted-out',
    policy: { policyId: 'core.communication.policy', policyVersion: 4 },
    correlationId: CORRELATION,
    ...over,
  };
}

/** A state record with every mandatory field and no evidence id. */
function stateRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    communicationId: COMMUNICATION,
    contractVersion: 1,
    channel: 'whatsapp',
    state: 'rejected',
    recordedAt: '2026-08-30T10:00:01Z',
    recipient: { entityType: 'vendor', entityId: 'vendor.42' },
    purposeCode: 'vendor.follow-up',
    reasonCode: 'recipient-opted-out',
    correlationId: CORRELATION,
    ...over,
  };
}

describe('ADR-0134 §2 — the rejected deadlock (a DEFECT, pinned)', () => {
  it('a lawful Core refusal parses WITHOUT an approval decision', () => {
    expect(communicationAuthorizationV1Schema.safeParse(rejectedAuthorization()).success).toBe(
      true,
    );
  });

  it('a Core refusal is REFUSED if it names an approval decision', () => {
    // communication-model.md: a rejection "must not name an approval decision, because Core refused
    // it whether or not a human had approved it". This half is CORRECT and must not be relaxed.
    const parsed = communicationAuthorizationV1Schema.safeParse(
      rejectedAuthorization({ approvalDecisionId: DECISION }),
    );
    expect(parsed.success).toBe(false);
  });

  it('a rejected state record is REFUSED without an approval decision', () => {
    // This half CONTRADICTS the one above. `rejected` is in STATES_REQUIRING_DECISION, so the state
    // record demands exactly the field the authorization forbids.
    expect(communicationStateRecordV1Schema.safeParse(stateRecord()).success).toBe(false);
  });

  it('a rejected state record parses ONLY once an approval decision is attached', () => {
    expect(
      communicationStateRecordV1Schema.safeParse(stateRecord({ approvalDecisionId: DECISION }))
        .success,
    ).toBe(true);
  });

  it('the two schemas are therefore DISJOINT on a lawful refusal', () => {
    // The whole finding in one assertion: no single value of `approvalDecisionId` satisfies both.
    const withoutDecision = stateRecord();
    const withDecision = stateRecord({ approvalDecisionId: DECISION });
    const authorizationAccepts = (decisionId: string | undefined): boolean =>
      communicationAuthorizationV1Schema.safeParse(
        rejectedAuthorization(decisionId === undefined ? {} : { approvalDecisionId: decisionId }),
      ).success;
    const recordAccepts = (record: Record<string, unknown>): boolean =>
      communicationStateRecordV1Schema.safeParse(record).success;

    expect(authorizationAccepts(undefined) && recordAccepts(withoutDecision)).toBe(false);
    expect(authorizationAccepts(DECISION) && recordAccepts(withDecision)).toBe(false);
  });

  it('the shipped opt-out fixture already carries the forbidden approval decision', () => {
    // Not a criticism of the fixture: it is the only shape that parses. It is evidence that the
    // contradiction is already encoded in the repository's reference data.
    expect(validCommunicationRejectedOptOut.state).toBe('rejected');
    expect(validCommunicationRejectedOptOut.approvalDecisionId).toBeDefined();
    expect(validCommunicationRejectedOptOut.explanation).toContain('Core refused');
  });
});

describe('ADR-0134 §3.1 — CommunicationResultV1 cannot report a pre-execution outcome (DEFECT)', () => {
  function result(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      communicationResultId: ID(7),
      contractVersion: 1,
      communicationId: COMMUNICATION,
      issuer: 'quickfurno-core',
      lifecycleState: 'rejected',
      outcome: 'failed',
      recordedAt: '2026-08-30T10:00:01Z',
      reasonCode: 'recipient-opted-out',
      correlationId: CORRELATION,
      ...over,
    };
  }

  it('demands execution ids that cannot exist before dispatch', () => {
    const parsed = communicationResultV1Schema.safeParse(result());
    expect(parsed.success).toBe(false);
    const missing = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
    expect(missing).toContain('executionIntentId');
    expect(missing).toContain('executionResultId');
  });

  it('demands them for a pre-execution cancellation too', () => {
    expect(
      communicationResultV1Schema.safeParse(result({ lifecycleState: 'cancelled' })).success,
    ).toBe(false);
  });

  it('parses only once both execution ids are INVENTED', () => {
    // The point of this spec: the only way through is the move ADR-0134 forbids.
    const parsed = communicationResultV1Schema.safeParse(
      result({
        executionIntentId: INTENT,
        executionResultId: RESULT,
        failure: {
          failureCode: 'recipient-opted-out',
          failureCategory: 'policy',
          retryClassification: 'not-retryable',
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('ADR-0134 §3.3 — the record cannot cite four of the seven evidence artifacts', () => {
  const cite = (key: string): boolean =>
    communicationStateRecordV1Schema.safeParse(
      stateRecord({ approvalDecisionId: DECISION, [key]: ID(9) }),
    ).success;

  it('accepts the three execution-and-approval slots it has', () => {
    for (const key of ['approvalDecisionId', 'executionIntentId', 'executionResultId']) {
      expect(cite(key), key).toBe(true);
    }
  });

  it('has NO slot for the communication artifacts or a canonical event (DEFECT)', () => {
    for (const key of [
      'communicationRequestId',
      'communicationResultId',
      'communicationAuthorizationId',
      'handoffRecordId',
      'evidenceEventId',
    ]) {
      expect(cite(key), key).toBe(false);
    }
  });

  it('CommunicationAuthorizationV1 has no identity field to be cited by (DEFECT)', () => {
    const parsed = communicationAuthorizationV1Schema.safeParse(
      rejectedAuthorization({ communicationAuthorizationId: ID(9) }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe('ADR-0134 §3.5, §3.6 — the evidence table per state', () => {
  /** What the schema demands for each state, with every evidence id withheld. */
  function requirementsFor(state: string): readonly string[] {
    const parsed = communicationStateRecordV1Schema.safeParse(stateRecord({ state }));
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
  }

  it('requires no evidence at all for seven states, four of which are NOT Jarvis facts (DEFECT)', () => {
    const unevidenced = COMMUNICATION_STATES.filter((s) => requirementsFor(s).length === 0);
    expect([...unevidenced].sort()).toEqual([
      'authorization-requested',
      'cancelled',
      'completed',
      'draft',
      'expired',
      'follow-up-requested',
      'human-handoff-required',
    ]);
    // `draft`, `authorization-requested` and `follow-up-requested` are legitimately Jarvis's own
    // coordination facts. The other four are Core outcomes that anyone may currently mint.
  });

  it('lets provider-accepted rest on an execution INTENT, not a recorded result (DEFECT)', () => {
    // communication-state.ts: "execution submitted is not provider accepted". An intent proves
    // dispatch; provider acceptance is a fact only Core can record.
    expect(requirementsFor('provider-accepted')).toEqual(['executionIntentId']);
    expect(
      communicationStateRecordV1Schema.safeParse(
        stateRecord({ state: 'provider-accepted', executionIntentId: INTENT }),
      ).success,
    ).toBe(true);
  });

  it('cites an APPROVAL decision for authorized, not a communication authorization (DEFECT)', () => {
    expect(requirementsFor('authorized')).toEqual(['approvalDecisionId']);
    expect(requirementsFor('scheduled')).toEqual(['approvalDecisionId']);
  });

  it('correctly requires a Core-recorded result for every provider outcome', () => {
    for (const state of ['delivered', 'read', 'answered', 'no-answer', 'busy', 'failed']) {
      expect(requirementsFor(state), state).toEqual(['executionResultId']);
    }
  });

  it('requires a channel even where Core authorized none (DEFECT)', () => {
    const { channel: _omitted, ...withoutChannel } = stateRecord({ approvalDecisionId: DECISION });
    expect(communicationStateRecordV1Schema.safeParse(withoutChannel).success).toBe(false);
  });
});

describe('ADR-0134 §4 — STATES_JARVIS_MAY_NOT_ORIGINATE is inert and under-inclusive', () => {
  it('names only three of the states Jarvis must not originate', () => {
    expect([...STATES_JARVIS_MAY_NOT_ORIGINATE].sort()).toEqual([
      'authorized',
      'completed',
      'delivered',
    ]);
  });

  it('omits every other Core-owned and provider-reported state (DEFECT)', () => {
    for (const state of [
      'rejected',
      'execution-submitted',
      'provider-accepted',
      'read',
      'answered',
      'no-answer',
      'busy',
      'failed',
      'cancelled',
      'expired',
    ]) {
      expect(STATES_JARVIS_MAY_NOT_ORIGINATE, state).not.toContain(state);
    }
  });

  it('is not consulted by the state-record schema: listed states still parse (DEFECT)', () => {
    // The list is documentation shaped like a control. `completed` is in it AND needs no evidence.
    expect(
      communicationStateRecordV1Schema.safeParse(stateRecord({ state: 'completed' })).success,
    ).toBe(true);
  });
});

describe('ADR-0134 §3.8 — two published refusal vocabularies for the same refusals', () => {
  it('spells quiet hours and unverified identity differently in each list (DEFECT)', () => {
    const stateSide: readonly string[] = Object.values(COMMUNICATION_REJECTION_REASONS);
    const authorizationSide: readonly string[] = COMMUNICATION_REFUSAL_REASONS;

    expect(stateSide).toContain('prohibited-quiet-hours');
    expect(authorizationSide).toContain('quiet-hours');
    expect(stateSide).not.toContain('quiet-hours');

    expect(stateSide).toContain('unverified-recipient-identity');
    expect(authorizationSide).toContain('identity-unverified');
    expect(stateSide).not.toContain('identity-unverified');
  });

  it('agrees on the four refusals that matter most', () => {
    const authorizationSide: readonly string[] = COMMUNICATION_REFUSAL_REASONS;
    for (const shared of [
      'recipient-opted-out',
      'consent-withdrawn',
      'do-not-contact',
      'attempt-limit-reached',
    ]) {
      expect(Object.values(COMMUNICATION_REJECTION_REASONS), shared).toContain(shared);
      expect(authorizationSide, shared).toContain(shared);
    }
  });
});

describe('ADR-0134 §6 — the issuer literal is a constraint, not provenance', () => {
  it('a hand-constructed object carrying the Core literal parses exactly as well as a real one', () => {
    // No signature, no ingestion, no storage — just a string somebody typed. This is why S2 may not
    // treat a bare contract artifact as a Core fact.
    const fabricated = communicationAuthorizationV1Schema.safeParse(
      rejectedAuthorization({ reasonCode: 'anything-at-all' }),
    );
    expect(fabricated.success).toBe(true);
  });
});
