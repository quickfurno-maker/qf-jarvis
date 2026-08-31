/**
 * D4 — the purpose-specific trusted communication evidence reader (ADR-0140).
 *
 * These are unit tests against a mock `DatabaseClient` returning synthetic stored rows. No database
 * and no live Core are required, which is the point: the two event families D4 admits are D2 TARGET
 * families that Core does not emit today, so D4 is built and proved offline against published
 * contracts.
 *
 * The rows are deliberately built from real canonical artifacts. A fixture that hand-waved the
 * payload would prove the reader parses a shape nobody will ever store.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  ProjectionInputError,
  ProjectionStoredDataError,
} from '../projections/projection-errors.js';
import {
  readTrustedCommunicationEvidenceAtPosition,
  type TrustedCommunicationEvidence,
} from '../projections/communication-evidence-reader.js';

const AUTHORIZATION_TYPE = 'qf.communication.authorization-recorded';
const RESULT_TYPE = 'qf.communication.result-recorded';

const EVENT_ID = '4d9f2b0e-9a1c-4f3b-9d21-7c6e5a4b3c2d';
const COMMUNICATION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REQUEST_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const RESULT_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const INTENT_ID = '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80';
const EXECUTION_RESULT_ID = '5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091';
const DECISION_ID = '6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f809102';
const CORRELATION_ID = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f80910203';

/** A complete, canonical `CommunicationAuthorizationV1`. Overrides let each test bend ONE thing. */
function authorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    communicationRequestId: REQUEST_ID,
    issuer: 'quickfurno-core',
    outcome: 'authorized',
    authorizedChannel: 'whatsapp',
    approvalDecisionId: DECISION_ID,
    decidedAt: '2026-08-31T09:00:00.000Z',
    reasonCode: 'approved-by-policy',
    explanation: 'a free-text explanation that must never reach evidence',
    policy: { policyId: 'communication-policy', policyVersion: 3 },
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

/** A complete, canonical `CommunicationResultV1`, including the mandatory execution ids. */
function communicationResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    communicationResultId: RESULT_ID,
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    executionIntentId: INTENT_ID,
    executionResultId: EXECUTION_RESULT_ID,
    issuer: 'quickfurno-core',
    lifecycleState: 'delivered',
    outcome: 'succeeded',
    recordedAt: '2026-08-31T09:05:00.000Z',
    providerOccurredAt: '2026-08-31T09:04:59.000Z',
    providerEvidence: { providerReference: 'wamid.TEST-PROVIDER-REFERENCE' },
    reasonCode: 'delivered-to-recipient',
    explanation: 'free text that must never reach evidence',
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

/**
 * A lawful outcome/failure pairing for `lifecycleState`.
 *
 * `CommunicationResultV1` enforces real cross-field rules, and honouring them is the point: a fixture
 * that ignored them would prove D4 parses shapes Core could never record. Specifically, `succeeded`
 * is legal only for a state in which the message actually reached the recipient; `provider-accepted`
 * may never be `succeeded` (the provider taking it is not delivery); `failed` and `indeterminate`
 * each require a structured failure, and `indeterminate` must be classified for reconciliation and
 * must not claim a delivered state.
 */
const DELIVERED_STATES = ['delivered', 'read', 'answered', 'completed'];

function lawfulOutcome(lifecycleState: string): Record<string, unknown> {
  if (DELIVERED_STATES.includes(lifecycleState)) {
    return { outcome: 'succeeded' };
  }
  return {
    outcome: 'indeterminate',
    failure: {
      failureCode: 'awaiting-reconciliation',
      failureCategory: 'ambiguous',
      retryClassification: 'requires-reconciliation',
    },
  };
}

interface RowOverrides {
  readonly position?: unknown;
  readonly event_id?: unknown;
  readonly event_type?: unknown;
  readonly event_version?: unknown;
  readonly source?: unknown;
  readonly payload?: unknown;
}

/** A stored row as the reader's query would return it. */
function row(overrides: RowOverrides = {}): Record<string, unknown> {
  return {
    position: '7',
    event_id: EVENT_ID,
    event_type: AUTHORIZATION_TYPE,
    event_version: 1,
    source: 'quickfurno-core',
    payload: { authorization: authorization() },
    ...overrides,
  };
}

interface MockClient {
  readonly client: DatabaseClient;
  readonly query: ReturnType<typeof vi.fn>;
}

/** A client that returns `rows` once. Anything beyond `query` is absent on purpose. */
function mockClient(rows: readonly unknown[]): MockClient {
  const query = vi.fn().mockResolvedValue({ rows });
  return { client: { query } as unknown as DatabaseClient, query };
}

async function read(
  rows: readonly unknown[],
  position = 7n,
): Promise<TrustedCommunicationEvidence | null> {
  return readTrustedCommunicationEvidenceAtPosition(mockClient(rows).client, position);
}

describe('D4 — input and stored-data validation fail closed', () => {
  it.each([0n, -1n])('rejects a non-positive position (%s) before any SQL', async (position) => {
    const { client, query } = mockClient([row()]);

    await expect(
      readTrustedCommunicationEvidenceAtPosition(client, position),
    ).rejects.toBeInstanceOf(ProjectionInputError);
    // Before any SQL: a reader that queried first would have leaked an invalid position to the DB.
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a non-bigint position before any SQL', async () => {
    const { client, query } = mockClient([row()]);

    await expect(
      readTrustedCommunicationEvidenceAtPosition(client, 7 as unknown as bigint),
    ).rejects.toBeInstanceOf(ProjectionInputError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when no row maps to the position', async () => {
    // At projection time the runner has ALREADY resolved this position to an event. Absence is
    // corruption, not a benign miss, so returning null here would hide it.
    await expect(read([])).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it.each([['0'], ['007'], ['-1'], ['1e3'], ['abc'], ['']])(
    'fails closed on a malformed stored position (%s)',
    async (position) => {
      await expect(read([row({ position })])).rejects.toBeInstanceOf(ProjectionStoredDataError);
    },
  );

  it('fails closed when the stored position is not the requested one', async () => {
    // Silently returning another position's evidence would corrupt ordering without ever erroring.
    await expect(read([row({ position: '8' })], 7n)).rejects.toBeInstanceOf(
      ProjectionStoredDataError,
    );
  });

  it('fails closed on a non-canonical stored event id', async () => {
    await expect(read([row({ event_id: 'not-a-uuid' })])).rejects.toBeInstanceOf(
      ProjectionStoredDataError,
    );
  });

  it('fails closed when a target event does not carry the canonical Core source', async () => {
    // A consistency check, not the authentication anchor — D2a's write path is that.
    await expect(read([row({ source: 'qf-jarvis' })])).rejects.toBeInstanceOf(
      ProjectionStoredDataError,
    );
  });

  it.each([[2], [0], ['1'], [null]])(
    'fails closed on a KNOWN target family at unsupported version %s',
    async (event_version) => {
      // Deliberately NOT null: silently skipping an unknown version of a fact the projection relies
      // on would produce a quietly incomplete projection.
      await expect(read([row({ event_version })])).rejects.toBeInstanceOf(
        ProjectionStoredDataError,
      );
    },
  );

  it.each([[null], ['a string'], [[]], [{ authorization: {}, extra: 1 }], [{ wrong: {} }], [{}]])(
    'fails closed on a malformed payload wrapper (%#)',
    async (payload) => {
      await expect(read([row({ payload })])).rejects.toBeInstanceOf(ProjectionStoredDataError);
    },
  );

  it('fails closed on a canonically invalid authorization artifact', async () => {
    const payload = { authorization: authorization({ outcome: 'maybe' }) };

    await expect(read([row({ payload })])).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it('fails closed on a canonically invalid result artifact', async () => {
    // Missing the mandatory executionIntentId. D4 minimises AFTER a lawful parse; it never relaxes
    // the source contract to make a row parse.
    const invalid = communicationResult();
    delete invalid['executionIntentId'];

    await expect(
      read([row({ event_type: RESULT_TYPE, payload: { result: invalid } })]),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it('does NOT reclassify a database failure as a stored-data error', async () => {
    // Infrastructure failures must stay infrastructure failures for the runner's existing error
    // classification. Wrapping them here would make a connection blip look like data corruption.
    const boom = new Error('connection terminated unexpectedly');
    const client = { query: vi.fn().mockRejectedValue(boom) } as unknown as DatabaseClient;

    await expect(readTrustedCommunicationEvidenceAtPosition(client, 7n)).rejects.toBe(boom);
  });
});

describe('D4 — the SQL boundary', () => {
  it('issues exactly one parameterized, fully-qualified, position-keyed query', async () => {
    const { client, query } = mockClient([row()]);
    await readTrustedCommunicationEvidenceAtPosition(client, 7n);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, readonly unknown[]];

    expect(sql).toContain('qf_jarvis.projection_event_position');
    expect(sql).toContain('JOIN qf_jarvis.event');
    expect(sql).toContain('e.sequence = m.event_storage_sequence');
    expect(sql).toContain('WHERE m.position = $1');
    expect(params[0]).toBe('7');
    // The event types are parameters, not interpolated literals.
    expect(params).toContain(AUTHORIZATION_TYPE);
    expect(params).toContain(RESULT_TYPE);
  });

  it('opens no transaction, takes no lock, and writes nothing', async () => {
    const { client, query } = mockClient([row()]);
    await readTrustedCommunicationEvidenceAtPosition(client, 7n);

    const [sql] = query.mock.calls[0] as [string];
    for (const forbidden of ['BEGIN', 'COMMIT', 'INSERT', 'UPDATE', 'DELETE', 'pg_advisory']) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('selects only the minimal envelope, never subject, signature, digests or raw sequence', async () => {
    const { client, query } = mockClient([row()]);
    await readTrustedCommunicationEvidenceAtPosition(client, 7n);
    const [sql] = query.mock.calls[0] as [string];

    for (const column of [
      'subject_type',
      'subject_id',
      'signature',
      'semantic_event_digest',
      'body_digest',
      'causation_event_id',
      'occurred_at',
      'emitted_at',
    ]) {
      expect(sql).not.toContain(column);
    }
    // The raw storage identity is used ONLY for the join, and never selected back out.
    expect(sql).not.toContain('e.sequence AS');
    expect(sql).not.toContain('m.event_storage_sequence AS');
  });

  it('asks the database for a payload ONLY for the two target families', async () => {
    // Payload minimisation at the SQL boundary: an unrelated positioned event never sends its
    // payload across this boundary at all, rather than being read and then discarded.
    const { client, query } = mockClient([row()]);
    await readTrustedCommunicationEvidenceAtPosition(client, 7n);
    const [sql] = query.mock.calls[0] as [string];

    expect(sql).toContain('CASE');
    expect(sql).toContain('ELSE NULL');
  });
});

describe('D4 — admitted authorization evidence', () => {
  it('admits a rejection and minimises it', async () => {
    const payload = {
      authorization: authorization({
        outcome: 'rejected',
        authorizedChannel: undefined,
        approvalDecisionId: undefined,
        reasonCode: 'recipient-opted-out',
      }),
    };
    delete payload.authorization['authorizedChannel'];
    delete payload.authorization['approvalDecisionId'];

    const evidence = await read([row({ payload })]);

    expect(evidence).toStrictEqual({
      kind: 'communication-authorization',
      position: 7n,
      sourceEventId: EVENT_ID,
      communicationId: COMMUNICATION_ID,
      communicationRequestId: REQUEST_ID,
      outcome: 'rejected',
      reasonCode: 'recipient-opted-out',
      decidedAt: '2026-08-31T09:00:00.000Z',
      correlationId: CORRELATION_ID,
    });
  });

  it('admits a WhatsApp authorization and minimises it', async () => {
    const evidence = await read([row()]);

    expect(evidence).toStrictEqual({
      kind: 'communication-authorization',
      position: 7n,
      sourceEventId: EVENT_ID,
      communicationId: COMMUNICATION_ID,
      communicationRequestId: REQUEST_ID,
      outcome: 'authorized',
      authorizedChannel: 'whatsapp',
      reasonCode: 'approved-by-policy',
      decidedAt: '2026-08-31T09:00:00.000Z',
      correlationId: CORRELATION_ID,
    });
  });

  it.each([['sms'], ['email'], ['voice']])(
    'does NOT admit an authorization for %s, the runtime cannot execute it',
    async (channel) => {
      // A valid Core fact, but not evidence a WhatsApp-only runtime may act on. Admitting it would
      // silently authorize behaviour the runtime could not honour.
      const payload = { authorization: authorization({ authorizedChannel: channel }) };

      expect(await read([row({ payload })])).toBeNull();
    },
  );

  it('still admits a REJECTION regardless of the channel involved', async () => {
    // A refusal is a refusal; channel support has no bearing on whether a rejection happened.
    const auth = authorization({ outcome: 'rejected', reasonCode: 'do-not-contact' });
    delete auth['authorizedChannel'];
    delete auth['approvalDecisionId'];

    const evidence = await read([row({ payload: { authorization: auth } })]);

    expect(evidence?.kind).toBe('communication-authorization');
  });

  it('omits explanation, policy and approvalDecisionId', async () => {
    const evidence = await read([row()]);

    for (const forbidden of ['explanation', 'policy', 'approvalDecisionId', 'issuer']) {
      expect(evidence).not.toHaveProperty(forbidden);
    }
  });
});

describe('D4 — admitted result evidence', () => {
  const resultRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
    row({ event_type: RESULT_TYPE, payload: { result: communicationResult(overrides) } });

  it.each([['delivered'], ['read']])(
    'admits lifecycleState %s and minimises it',
    async (lifecycleState) => {
      const evidence = await read([
        resultRow({ lifecycleState, ...lawfulOutcome(lifecycleState) }),
      ]);

      expect(evidence).toStrictEqual({
        kind: 'communication-result',
        position: 7n,
        sourceEventId: EVENT_ID,
        communicationId: COMMUNICATION_ID,
        communicationResultId: RESULT_ID,
        lifecycleState,
        outcome: 'succeeded',
        recordedAt: '2026-08-31T09:05:00.000Z',
        reasonCode: 'delivered-to-recipient',
        correlationId: CORRELATION_ID,
      });
    },
  );

  it('admits provider-accepted, which the contract forbids from ever being "succeeded"', async () => {
    // The provider taking a message is not delivery, so this state routes to reconciliation. D4
    // admits the state and minimises the reconciliation failure alongside it.
    const evidence = await read([
      resultRow({ lifecycleState: 'provider-accepted', ...lawfulOutcome('provider-accepted') }),
    ]);

    expect(evidence).toStrictEqual({
      kind: 'communication-result',
      position: 7n,
      sourceEventId: EVENT_ID,
      communicationId: COMMUNICATION_ID,
      communicationResultId: RESULT_ID,
      lifecycleState: 'provider-accepted',
      outcome: 'indeterminate',
      recordedAt: '2026-08-31T09:05:00.000Z',
      reasonCode: 'delivered-to-recipient',
      failure: {
        failureCode: 'awaiting-reconciliation',
        retryClassification: 'requires-reconciliation',
      },
      correlationId: CORRELATION_ID,
    });
  });

  it('admits failed, and minimises the nested failure to a code and a retry class', async () => {
    const evidence = await read([
      resultRow({
        lifecycleState: 'failed',
        outcome: 'failed',
        reasonCode: 'provider-rejected',
        failure: {
          failureCode: 'provider-rejected',
          failureCategory: 'provider',
          retryClassification: 'retryable',
          description: 'a provider description that must never reach evidence',
        },
      }),
    ]);

    expect(evidence).toStrictEqual({
      kind: 'communication-result',
      position: 7n,
      sourceEventId: EVENT_ID,
      communicationId: COMMUNICATION_ID,
      communicationResultId: RESULT_ID,
      lifecycleState: 'failed',
      outcome: 'failed',
      recordedAt: '2026-08-31T09:05:00.000Z',
      reasonCode: 'provider-rejected',
      failure: { failureCode: 'provider-rejected', retryClassification: 'retryable' },
      correlationId: CORRELATION_ID,
    });
  });

  it('omits execution ids, provider evidence, timestamps and free text', async () => {
    const evidence = await read([resultRow()]);

    for (const forbidden of [
      'executionIntentId',
      'executionResultId',
      'explanation',
      'providerEvidence',
      'providerReference',
      'providerOccurredAt',
      'issuer',
      'contractVersion',
    ]) {
      expect(evidence).not.toHaveProperty(forbidden);
    }
  });

  it('parsed the FULL canonical artifact before stripping those fields', async () => {
    // The proof that minimisation is not relaxation: a result WITHOUT the mandatory execution ids
    // fails, even though the accepted evidence never exposes them.
    const withoutIds = communicationResult();
    delete withoutIds['executionIntentId'];
    delete withoutIds['executionResultId'];

    await expect(
      read([row({ event_type: RESULT_TYPE, payload: { result: withoutIds } })]),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });
});

describe('D4 — the states it deliberately declines', () => {
  it('returns null for an unrelated canonical event type', async () => {
    expect(await read([row({ event_type: 'qf.recommendation.issued', payload: null })])).toBeNull();
  });

  it.each([
    ['execution-submitted', 'no proved durable Core submission artifact'],
    ['answered', 'Core does not model voice outcomes'],
    ['no-answer', 'Core does not model voice outcomes'],
    ['busy', 'Core does not model voice outcomes'],
    ['follow-up-requested', 'Tier B, pending D2b'],
    ['human-handoff-required', 'Tier B, pending D2b'],
    ['cancelled', 'rejected for the MVP'],
    ['expired', 'rejected for the MVP'],
  ])('declines lifecycleState %s (%s) without inventing a state', async (lifecycleState) => {
    const result = communicationResult({
      lifecycleState,
      reasonCode: 'pending-reconciliation',
      ...lawfulOutcome(lifecycleState),
    });

    // Lawfully parsed, deliberately not admitted: null, never a substitute state.
    expect(await read([row({ event_type: RESULT_TYPE, payload: { result } })])).toBeNull();
  });

  it('declines completed — S3 found NO distinct Core completion truth', async () => {
    const result = communicationResult({
      lifecycleState: 'completed',
      ...lawfulOutcome('completed'),
    });

    expect(await read([row({ event_type: RESULT_TYPE, payload: { result } })])).toBeNull();
  });

  it('declines a RESULT-borne rejected — a rejection comes from an authorization refusal', async () => {
    const result = communicationResult({
      lifecycleState: 'rejected',
      outcome: 'failed',
      reasonCode: 'recipient-opted-out',
      failure: {
        failureCode: 'recipient-opted-out',
        failureCategory: 'policy',
        retryClassification: 'not-retryable',
      },
    });

    expect(await read([row({ event_type: RESULT_TYPE, payload: { result } })])).toBeNull();
  });

  it('admits no Tier-B state at all', async () => {
    // draft, authorization-requested and scheduled have no admitted path in D4 by construction:
    // there is no event family that could produce them here. D2b owns their durable evidence.
    const evidence = await read([row()]);

    expect(evidence?.kind).toBe('communication-authorization');
    expect(['authorization-requested', 'scheduled', 'draft']).not.toContain(evidence?.kind);
  });
});

describe('D4 — the evidence object itself', () => {
  it('is frozen, including the nested failure', async () => {
    const evidence = await read([
      row({
        event_type: RESULT_TYPE,
        payload: {
          result: communicationResult({
            lifecycleState: 'failed',
            outcome: 'failed',
            reasonCode: 'provider-rejected',
            failure: {
              failureCode: 'provider-rejected',
              failureCategory: 'provider',
              retryClassification: 'not-retryable',
            },
          }),
        },
      }),
    ]);

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen((evidence as { failure?: unknown }).failure as object)).toBe(true);
  });

  it('carries no subject, signature, digest or raw payload', async () => {
    const evidence = await read([row()]);

    for (const forbidden of [
      'subject',
      'subjectType',
      'subjectId',
      'signature',
      'semanticEventDigest',
      'bodyDigest',
      'payload',
      'sequence',
    ]) {
      expect(evidence).not.toHaveProperty(forbidden);
    }
  });

  it('cannot be structurally constructed', () => {
    // The type carries a module-private `unique symbol` brand, so an object literal with every
    // visible field still does not satisfy it. @ts-expect-error FAILS THE BUILD if this ever starts
    // compiling.
    //
    // The claim is exactly this and no more: arbitrary code cannot STRUCTURALLY construct the
    // evidence type. It is not a claim that TypeScript proves the row came from Core — that rests on
    // D2a's write-path containment plus this read path.
    // @ts-expect-error a structural look-alike is not trusted evidence
    const forged: TrustedCommunicationEvidence = {
      kind: 'communication-authorization',
      position: 1n,
      sourceEventId: EVENT_ID,
      communicationId: COMMUNICATION_ID,
      communicationRequestId: REQUEST_ID,
      outcome: 'authorized',
      reasonCode: 'approved-by-policy',
      decidedAt: '2026-08-31T09:00:00.000Z',
      correlationId: CORRELATION_ID,
    };

    expect(forged).toBeDefined();
  });
});
