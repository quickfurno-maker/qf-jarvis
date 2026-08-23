/**
 * Identity, history, ordering, and the canonical evidence rules (QFJ-P09.05, ADR-0110).
 *
 * The matrix spec sweeps the graph. This one holds a single legal edge still and varies exactly one
 * invariant at a time, which is the only way to show that each refusal is caused by the thing it
 * names rather than by something else the fixture happened to break.
 *
 * The base edge is `authorized -> execution-submitted`: a real edge from the approved model, and one
 * where both records carry Core evidence, so the evidence rules are exercised on the same path
 * rather than on a specially chosen easy one.
 */
import { describe, expect, it } from 'vitest';
import {
  safeParseCommunicationStateRecord,
  type CommunicationState,
  type CommunicationStateRecordV1,
} from '@qf-jarvis/contracts';

import {
  COMMUNICATION_LIFECYCLE_REFUSAL_REASONS,
  evaluateCommunicationLifecycleTransition,
  type CommunicationLifecycleRefusalReason,
} from '../index.js';
import { EARLIER, LATER, RECIPIENT, stateRecord, withoutEvidence } from './fixtures.js';

const CURRENT = stateRecord({ state: 'authorized', recordedAt: EARLIER });
const NEXT = stateRecord({
  state: 'execution-submitted',
  previousState: 'authorized',
  recordedAt: LATER,
});

function reasonOf(result: { ok: boolean } & Partial<{ reason: string }>): string | undefined {
  return result.ok ? undefined : result.reason;
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

describe('the base edge', () => {
  it('is lifecycle-consistent', () => {
    expect(evaluateCommunicationLifecycleTransition({ current: CURRENT, next: NEXT }).ok).toBe(
      true,
    );
  });

  it('returns a frozen verdict, on both branches', () => {
    const consistent = evaluateCommunicationLifecycleTransition({ current: CURRENT, next: NEXT });
    expect(Object.isFrozen(consistent)).toBe(true);

    const refused = evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({ state: 'delivered', previousState: 'authorized', recordedAt: LATER }),
    });
    expect(Object.isFrozen(refused)).toBe(true);
  });

  it('carries no permission, delivery or execution field on the consistent verdict', () => {
    const result: Record<string, unknown> = {
      ...evaluateCommunicationLifecycleTransition({ current: CURRENT, next: NEXT }),
    };
    // A consistent transition describes a movement. It is not a grant, and it is not evidence that
    // anything reached a person -- so none of these may ever appear here.
    expect(Object.keys(result)).toEqual(['ok']);
    for (const forbidden of [
      'canSend',
      'canExecute',
      'isAuthorized',
      'consentValid',
      'eligible',
      'sent',
      'delivered',
      'providerSucceeded',
      'permissionGranted',
    ]) {
      expect(result[forbidden], forbidden).toBeUndefined();
    }
  });

  it('mutates neither record', () => {
    const currentBefore = snapshot(CURRENT);
    const nextBefore = snapshot(NEXT);
    evaluateCommunicationLifecycleTransition({ current: CURRENT, next: NEXT });
    evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({ state: 'read', previousState: 'authorized', recordedAt: LATER }),
    });
    expect(snapshot(CURRENT)).toBe(currentBefore);
    expect(snapshot(NEXT)).toBe(nextBefore);
  });
});

describe('identity continuity', () => {
  const cases: readonly {
    readonly label: string;
    readonly next: CommunicationStateRecordV1;
    readonly reason: CommunicationLifecycleRefusalReason;
  }[] = [
    {
      label: 'communicationId',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        communicationId: '00000000-0000-4000-8000-000000000001',
      }),
      reason: 'communication-id-mismatch',
    },
    {
      label: 'channel',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        channel: 'voice',
      }),
      reason: 'channel-mismatch',
    },
    {
      label: 'recipient entityId',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        recipient: { entityType: RECIPIENT.entityType, entityId: 'vendor-9001' },
      }),
      reason: 'recipient-mismatch',
    },
    {
      label: 'recipient entityType',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        recipient: { entityType: 'client', entityId: RECIPIENT.entityId },
      }),
      reason: 'recipient-mismatch',
    },
    {
      label: 'purposeCode',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        purposeCode: 'client-status-update',
      }),
      reason: 'purpose-code-mismatch',
    },
    {
      label: 'correlationId',
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        correlationId: '00000000-0000-4000-8000-000000000002',
      }),
      reason: 'correlation-id-mismatch',
    },
  ];

  it.each(cases)('refuses when $label changed mid-lifecycle', ({ next, reason }) => {
    const result = evaluateCommunicationLifecycleTransition({ current: CURRENT, next });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe(reason);
  });

  it('leaves the Core evidence ids free to appear as the lifecycle advances', () => {
    // `approvalDecisionId`, `executionIntentId` and `executionResultId` are NOT continuity fields.
    // A draft has none of them and a delivered record has all three, so requiring them to stay
    // identical would refuse the ordinary, correct path. The canonical schema governs them.
    const draft = stateRecord({ state: 'draft', recordedAt: EARLIER });
    const bare: Record<string, unknown> = { ...draft };
    delete bare['approvalDecisionId'];
    delete bare['executionIntentId'];
    delete bare['executionResultId'];

    const result = evaluateCommunicationLifecycleTransition({
      current: bare as unknown as CommunicationStateRecordV1,
      next: stateRecord({
        state: 'authorization-requested',
        previousState: 'draft',
        recordedAt: LATER,
      }),
    });
    expect(result.ok).toBe(true);
  });
});

describe('previousState becomes required coordination evidence at the boundary', () => {
  it('refuses a non-initial candidate that carries no previousState', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({ state: 'execution-submitted', recordedAt: LATER }),
    });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('previous-state-missing');
  });

  it('refuses a candidate whose previousState names a state it did not come from', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'scheduled',
        recordedAt: LATER,
      }),
    });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('previous-state-mismatch');
  });

  it('does not repair the record: a missing previousState stays missing', () => {
    const candidate = stateRecord({ state: 'execution-submitted', recordedAt: LATER });
    evaluateCommunicationLifecycleTransition({ current: CURRENT, next: candidate });
    expect(candidate.previousState).toBeUndefined();
  });

  it('still lets the canonical schema treat previousState as optional on a single record', () => {
    // The record contract is untouched by this slice: a stored record with no previousState remains
    // perfectly valid on its own. Only a record offered as a MOVEMENT has to evidence its departure.
    const parsed = safeParseCommunicationStateRecord(
      stateRecord({ state: 'execution-submitted', recordedAt: LATER }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('timestamp non-regression', () => {
  it('accepts an equal recordedAt', () => {
    // Second-granularity instants are legal in the canonical timestamp contract, so two records
    // written inside the same second share a value. Refusing that would invent sub-second
    // sequencing precision this slice does not own.
    const result = evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: EARLIER,
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a candidate recorded strictly before the record it claims to follow', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: stateRecord({ state: 'authorized', recordedAt: LATER }),
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: EARLIER,
      }),
    });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('timestamp-regression');
  });

  it('accepts a fractional-second advance', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: stateRecord({ state: 'authorized', recordedAt: '2026-08-23T10:00:00.100Z' }),
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: '2026-08-23T10:00:00.200Z',
      }),
    });
    expect(result.ok).toBe(true);
  });
});

describe('the canonical record schema stays load-bearing', () => {
  /**
   * Each case strips the one artifact the canonical schema makes mandatory for that state.
   *
   * The assertion is deliberately made twice: once against `safeParseCommunicationStateRecord`, to
   * show that the SCHEMA is what rejects the record, and once against the runtime, to show that the
   * runtime refuses rather than proceeding. If this package had copied the evidence table, the first
   * assertion could pass while the second was enforced by a private duplicate free to drift.
   */
  const cases: readonly {
    readonly state: CommunicationState;
    readonly from: CommunicationState;
    readonly field: 'approvalDecisionId' | 'executionIntentId' | 'executionResultId';
  }[] = [
    { state: 'rejected', from: 'authorization-requested', field: 'approvalDecisionId' },
    { state: 'authorized', from: 'authorization-requested', field: 'approvalDecisionId' },
    { state: 'scheduled', from: 'authorized', field: 'approvalDecisionId' },
    { state: 'execution-submitted', from: 'authorized', field: 'executionIntentId' },
    { state: 'provider-accepted', from: 'execution-submitted', field: 'executionIntentId' },
    { state: 'delivered', from: 'provider-accepted', field: 'executionResultId' },
    { state: 'read', from: 'delivered', field: 'executionResultId' },
    { state: 'answered', from: 'provider-accepted', field: 'executionResultId' },
    { state: 'no-answer', from: 'provider-accepted', field: 'executionResultId' },
    { state: 'busy', from: 'provider-accepted', field: 'executionResultId' },
    { state: 'failed', from: 'provider-accepted', field: 'executionResultId' },
  ];

  it.each(cases)('$state without $field is not a valid record', ({ state, from, field }) => {
    const stripped = withoutEvidence(
      stateRecord({ state, previousState: from, recordedAt: LATER }),
      field,
    );
    expect(safeParseCommunicationStateRecord(stripped).success).toBe(false);

    const asNext = evaluateCommunicationLifecycleTransition({
      current: stateRecord({ state: from, recordedAt: EARLIER }),
      next: stripped,
    });
    expect(asNext.ok).toBe(false);
    expect(reasonOf(asNext)).toBe('next-record-invalid');
  });

  it.each(cases)(
    '$state without $field is refused in the CURRENT position too',
    ({ state, field }) => {
      const stripped = withoutEvidence(stateRecord({ state, recordedAt: EARLIER }), field);
      const result = evaluateCommunicationLifecycleTransition({
        current: stripped,
        next: stateRecord({ state: 'completed', previousState: state, recordedAt: LATER }),
      });
      expect(result.ok).toBe(false);
      expect(reasonOf(result)).toBe('current-record-invalid');
    },
  );

  it('refuses a state value the canonical vocabulary does not contain', () => {
    // An unknown state never reaches the transition table: the canonical parse rejects it first,
    // which is why the table needs no fallback branch.
    const alien = { ...stateRecord({ state: 'draft' }), state: 'opted-out' };
    const result = evaluateCommunicationLifecycleTransition({
      current: null,
      next: alien as unknown as CommunicationStateRecordV1,
    });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('next-record-invalid');
  });

  it('reports a broken current record before it looks at the candidate', () => {
    // Both records are defective. The premise -- where the lifecycle stands -- is reported first, so
    // the caller is not sent to fix the wrong one.
    const result = evaluateCommunicationLifecycleTransition({
      current: withoutEvidence(stateRecord({ state: 'authorized' }), 'approvalDecisionId'),
      next: withoutEvidence(
        stateRecord({ state: 'execution-submitted', previousState: 'authorized' }),
        'executionIntentId',
      ),
    });
    expect(reasonOf(result)).toBe('current-record-invalid');
  });

  it('refuses structurally absent input rather than throwing', () => {
    const result = evaluateCommunicationLifecycleTransition(
      undefined as unknown as { current: null; next: CommunicationStateRecordV1 },
    );
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('next-record-invalid');
  });
});

describe('the refusal vocabulary', () => {
  it('is exactly thirteen closed, content-free reasons', () => {
    expect([...COMMUNICATION_LIFECYCLE_REFUSAL_REASONS]).toEqual([
      'current-record-invalid',
      'next-record-invalid',
      'initial-state-not-draft',
      'initial-previous-state-present',
      'communication-id-mismatch',
      'channel-mismatch',
      'recipient-mismatch',
      'purpose-code-mismatch',
      'correlation-id-mismatch',
      'previous-state-missing',
      'previous-state-mismatch',
      'timestamp-regression',
      'transition-not-allowed',
    ]);
    expect(Object.isFrozen(COMMUNICATION_LIFECYCLE_REFUSAL_REASONS)).toBe(true);
  });

  it('has no generic bucket a refusal could be laundered into', () => {
    for (const generic of ['invalid', 'other', 'unknown', 'error', 'failed']) {
      expect(COMMUNICATION_LIFECYCLE_REFUSAL_REASONS, generic).not.toContain(generic);
    }
  });

  it('quotes nothing that arrived: a refusal names no recipient, purpose or correlation', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: CURRENT,
      next: stateRecord({
        state: 'execution-submitted',
        previousState: 'authorized',
        recordedAt: LATER,
        recipient: { entityType: 'vendor', entityId: 'vendor-secret-9001' },
      }),
    });
    const serialized = snapshot(result);
    expect(serialized).not.toContain('vendor-secret-9001');
    expect(serialized).not.toContain(RECIPIENT.entityId);
    expect(serialized).not.toContain('vendor-availability-check');
    expect(serialized).toBe('{"ok":false,"reason":"recipient-mismatch"}');
  });
});
