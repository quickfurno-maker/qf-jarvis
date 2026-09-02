/**
 * D5 — the `communication-state` projection handler (QFJ-P09 D5, ADR-0142).
 *
 * Unit tests against a mock `DatabaseClient` and a stubbed D4 reader. The database behaviour that only
 * PostgreSQL can prove — the CHECK constraints, the position-guarded upsert, `previous_state`, replay
 * and rebuild — lives in `communication-state-projection.integration.test.ts`; this file proves the
 * mapping, the validation boundary and the fail-closed rules.
 *
 * The mapping is deliberately a copy rather than a decision: D4 has already refused a non-WhatsApp
 * authorization, a lifecycle state outside the four result-backed ones, and every unrelated event. So
 * what these tests guard is that D5 does not *add* anything — no invented state, no re-added stripped
 * field, and no clock.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  applyCommunicationState,
  communicationStateProjection,
  COMMUNICATION_STATE_PROJECTION_NAME,
  COMMUNICATION_STATE_PROJECTION_VERSION,
} from '../projections/handlers/communication-state.js';
import * as reader from '../projections/communication-evidence-reader.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';
import { ProjectionStoredDataError } from '../projections/projection-errors.js';

const COMMUNICATION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REQUEST_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const RESULT_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const EVENT_ID = '4d9f2b0e-9a1c-4f3b-9d21-7c6e5a4b3c2d';
const CORRELATION_ID = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f80910203';

const DECIDED_AT = '2026-09-01T09:00:00.000Z';
const RECORDED_AT = '2026-09-01T09:05:00.000Z';

/** A positioned event. Its `acceptedAt` is deliberately DIFFERENT from every evidence instant. */
function projectionEvent(position = 7n): ProjectionEvent {
  return {
    position,
    eventType: 'qf.communication.authorization-recorded',
    eventVersion: 2,
    acceptedAt: toCanonicalInstant(new Date('2026-12-25T00:00:00.000Z')),
  };
}

function authorizationEvidence(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'communication-authorization',
    position: 7n,
    sourceEventId: EVENT_ID,
    communicationId: COMMUNICATION_ID,
    communicationRequestId: REQUEST_ID,
    outcome: 'authorized',
    authorizedChannel: 'whatsapp',
    reasonCode: 'approved-by-policy',
    decidedAt: DECIDED_AT,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

function resultEvidence(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'communication-result',
    position: 7n,
    sourceEventId: EVENT_ID,
    communicationId: COMMUNICATION_ID,
    communicationResultId: RESULT_ID,
    lifecycleState: 'delivered',
    outcome: 'succeeded',
    recordedAt: RECORDED_AT,
    reasonCode: 'delivered-to-recipient',
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

interface Applied {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly evidence: Record<string, unknown>;
  readonly query: ReturnType<typeof vi.fn>;
}

/** Run the handler with a stubbed reader, returning what reached the database. */
async function apply(evidence: unknown, position = 7n): Promise<Applied> {
  const spy = vi
    .spyOn(reader, 'readTrustedCommunicationEvidenceAtPosition')
    .mockResolvedValue(evidence as never);
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const client = { query } as unknown as DatabaseClient;

  try {
    await applyCommunicationState(client, projectionEvent(position));
  } finally {
    spy.mockRestore();
  }

  const call = query.mock.calls[0] as [string, readonly unknown[]] | undefined;
  const sql = call?.[0] ?? '';
  const params = call?.[1] ?? [];
  // The handler passes evidence as a JSON string; anything else means it was never written.
  const evidenceJson = typeof params[6] === 'string' ? params[6] : '{}';
  return { sql, params, evidence: JSON.parse(evidenceJson) as Record<string, unknown>, query };
}

describe('D5 — the projection identity', () => {
  it('is a stable name and version matching migration 0013', () => {
    expect(COMMUNICATION_STATE_PROJECTION_NAME).toBe('communication-state');
    expect(COMMUNICATION_STATE_PROJECTION_VERSION).toBe(1);
    expect(communicationStateProjection.name).toBe('communication-state');
    expect(communicationStateProjection.version).toBe(1);
  });
});

describe('D5 — the six state mappings', () => {
  it('maps a refusal to `rejected`', async () => {
    const { params, evidence } = await apply(
      authorizationEvidence({
        outcome: 'rejected',
        authorizedChannel: undefined,
        reasonCode: 'recipient-opted-out',
      }),
    );

    expect(params[1]).toBe('rejected');
    expect(evidence['outcome']).toBe('rejected');
    expect(evidence['kind']).toBe('communication-authorization');
  });

  it('maps a WhatsApp authorization to `authorized`', async () => {
    const { params, evidence } = await apply(authorizationEvidence());

    expect(params[1]).toBe('authorized');
    expect(evidence['outcome']).toBe('authorized');
    expect(evidence['authorizedChannel']).toBe('whatsapp');
  });

  it.each([
    ['provider-accepted', 'indeterminate'],
    ['delivered', 'succeeded'],
    ['read', 'succeeded'],
    ['failed', 'failed'],
  ])('maps result lifecycle %s to state %s', async (lifecycleState, outcome) => {
    const failure =
      outcome === 'succeeded'
        ? {}
        : {
            failure: {
              failureCode: outcome === 'failed' ? 'provider-rejected' : 'awaiting-reconciliation',
              retryClassification:
                outcome === 'failed' ? 'not-retryable' : 'requires-reconciliation',
            },
          };
    const { params, evidence } = await apply(
      resultEvidence({ lifecycleState, outcome, ...failure }),
    );

    expect(params[1]).toBe(lifecycleState);
    // The state and the evidence lifecycle state are one fact written once.
    expect(evidence['lifecycleState']).toBe(lifecycleState);
    expect(evidence['kind']).toBe('communication-result');
  });
});

describe('D5 — exact field mapping', () => {
  it('copies identity, reason and correlation verbatim from the evidence', async () => {
    const { params } = await apply(authorizationEvidence());

    expect(params[0]).toBe(COMMUNICATION_ID);
    expect(params[2]).toBe(2); // contractVersion
    expect(params[4]).toBe('approved-by-policy');
    expect(params[5]).toBe(CORRELATION_ID);
  });

  it('takes recordedAt from the authorization `decidedAt`', async () => {
    const { params } = await apply(authorizationEvidence());

    expect(params[3]).toBe(DECIDED_AT);
  });

  it('takes recordedAt from the result `recordedAt`', async () => {
    const { params } = await apply(resultEvidence());

    expect(params[3]).toBe(RECORDED_AT);
  });

  it('never lets a clock or the event acceptance instant become state', async () => {
    // `projectionEvent` deliberately carries a far-future acceptedAt. If a wall clock or acceptedAt
    // ever leaked into the row, rebuild determinism would be gone and this catches it.
    const before = new Date().toISOString().slice(0, 10);
    const { params } = await apply(authorizationEvidence());
    const stored = String(params[3]);

    expect(stored).toBe(DECIDED_AT);
    expect(stored.startsWith(before)).toBe(false);
    expect(stored).not.toContain('2026-12-25');
  });

  it('writes the position the runner supplied, not one of its own', async () => {
    const { params } = await apply(authorizationEvidence(), 41n);

    expect(params[7]).toBe('41');
  });

  it('retains sourceEventId as an audit pointer only', async () => {
    const { evidence, params } = await apply(authorizationEvidence());

    expect(evidence['sourceEventId']).toBe(EVENT_ID);
    // It is carried INSIDE evidence and is never a column, a key, or an authority input.
    expect(params).not.toContain(EVENT_ID);
  });
});

describe('D5 — minimisation is preserved, not undone', () => {
  it('omits authorizedChannel entirely on a refusal', async () => {
    const { evidence } = await apply(
      authorizationEvidence({ outcome: 'rejected', authorizedChannel: undefined }),
    );

    // Absent, not `undefined`: the V2 rejected variant has no such field, and JSON round-trips prove
    // the key never reached the row.
    expect('authorizedChannel' in evidence).toBe(false);
  });

  it('keeps only failureCode and retryClassification', async () => {
    const { evidence } = await apply(
      resultEvidence({
        lifecycleState: 'failed',
        outcome: 'failed',
        reasonCode: 'provider-rejected',
        failure: { failureCode: 'provider-rejected', retryClassification: 'not-retryable' },
      }),
    );
    const failure = evidence['failure'] as Record<string, unknown>;

    expect(Object.keys(failure).sort()).toStrictEqual(['failureCode', 'retryClassification']);
  });

  it('omits failure entirely when the evidence carries none', async () => {
    const { evidence } = await apply(resultEvidence());

    expect('failure' in evidence).toBe(false);
  });

  it.each([
    ['executionIntentId'],
    ['executionResultId'],
    ['providerEvidence'],
    ['providerReference'],
    ['providerOccurredAt'],
    ['explanation'],
    ['failureCategory'],
    ['description'],
    ['recipient'],
    ['purposeCode'],
    ['policy'],
    ['approvalDecisionId'],
  ])('never writes %s', async (forbidden) => {
    const { evidence, params } = await apply(resultEvidence());

    expect(evidence).not.toHaveProperty(forbidden);
    // The quoted KEY form: a reason code may legitimately contain such a word as free-form text
    // (`delivered-to-recipient`), but a forbidden FIELD would serialize as `"recipient":`.
    expect(JSON.stringify(params)).not.toContain(`"${forbidden}"`);
  });
});

describe('D5 — fail closed, and invent nothing', () => {
  it('writes NOTHING when the reader returns null', async () => {
    const { query } = await apply(null);

    // Not admitted by D4's purpose. A row here would be an invented state.
    expect(query).not.toHaveBeenCalled();
  });

  it('propagates a reader error and writes nothing', async () => {
    const boom = new ProjectionStoredDataError('A stored event id is not a canonical event id.');
    const spy = vi
      .spyOn(reader, 'readTrustedCommunicationEvidenceAtPosition')
      .mockRejectedValue(boom);
    const query = vi.fn();
    const client = { query } as unknown as DatabaseClient;

    await expect(applyCommunicationState(client, projectionEvent())).rejects.toBe(boom);
    expect(query).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('propagates an infrastructure failure unchanged', async () => {
    // A connection blip must stay an infrastructure failure for the runner's classification, not be
    // swallowed into a silently missing state.
    const boom = new Error('connection terminated unexpectedly');
    const spy = vi
      .spyOn(reader, 'readTrustedCommunicationEvidenceAtPosition')
      .mockRejectedValue(boom);
    const client = { query: vi.fn() } as unknown as DatabaseClient;

    await expect(applyCommunicationState(client, projectionEvent())).rejects.toBe(boom);
    spy.mockRestore();
  });

  it('validates against the CANONICAL V2 schema before persisting, and refuses a bad record', async () => {
    // A malformed reason code cannot satisfy V2. The write must not happen, and the error must carry
    // no communication value.
    const spy = vi
      .spyOn(reader, 'readTrustedCommunicationEvidenceAtPosition')
      .mockResolvedValue(authorizationEvidence({ reasonCode: 'Not A Machine Token' }) as never);
    const query = vi.fn();
    const client = { query } as unknown as DatabaseClient;

    await expect(applyCommunicationState(client, projectionEvent())).rejects.toBeInstanceOf(
      ProjectionStoredDataError,
    );
    expect(query).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('D5 — the SQL boundary', () => {
  it('issues ONE fully-qualified, parameterized, position-guarded upsert', async () => {
    const { sql, query } = await apply(authorizationEvidence());

    expect(query).toHaveBeenCalledTimes(1);
    expect(sql).toContain('INSERT INTO qf_jarvis.rm_communication_state');
    expect(sql).toContain('ON CONFLICT (communication_id) DO UPDATE SET');
    expect(sql).toContain('WHERE EXCLUDED.last_position > rm.last_position');
  });

  it('sets previous_state from the row being replaced, never from the incoming evidence', async () => {
    const { sql } = await apply(authorizationEvidence());

    // `rm.state` is the PERSISTED prior state. Anything else here would be an inference.
    expect(sql).toContain('previous_state   = rm.state');
    // On insert it is NULL: there is no prior row to take context from.
    expect(sql).toMatch(/VALUES[\s\S]*NULL/);
  });

  it('opens no transaction, takes no lock, and never reads the event log directly', async () => {
    const { sql } = await apply(authorizationEvidence());

    for (const forbidden of ['BEGIN', 'COMMIT', 'pg_advisory', 'FROM qf_jarvis.event', 'DELETE']) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
