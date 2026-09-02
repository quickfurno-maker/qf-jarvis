/**
 * D5 — the communication-state projection against real PostgreSQL 17 (QFJ-P09 D5, ADR-0142).
 *
 * Proves on the actual schema (migration 0013) what only a real database can prove: the six-state and
 * contract-version CHECKs, the reason-code grammar, the position-guarded upsert, `previous_state`
 * taken from the replaced row, replay idempotency, staleness, rebuild determinism, and the
 * least-privilege grant.
 *
 * The projection is driven EXPLICITLY here — it is deliberately absent from the production registry,
 * because D5 is implemented and testable offline while rollout stays OFF.
 *
 * Loopback-guarded; FAILS (never skips) without DATABASE_URL, per repository CI policy.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultMigrationsDirectory,
  withClient,
  withTransaction,
  type DatabasePool,
} from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import {
  communicationStateProjection,
  COMMUNICATION_STATE_PROJECTION_NAME,
  COMMUNICATION_STATE_PROJECTION_VERSION,
} from '../projections/handlers/communication-state.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { captureRebuildHorizon, rebuildProjection } from '../projections/projection-rebuild.js';
import { runProjectionWorker } from '../projections/projection-worker.js';
import {
  closeTestPool,
  createProjectionPool,
  createTestPool,
  ensureProjectionRoleExists,
  resetTestDatabase,
} from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p09d5-commstate' });

const AUTHORIZATION_TYPE = 'qf.communication.authorization-recorded';
const RESULT_TYPE = 'qf.communication.result-recorded';

/** The ONE ingestible version for these families (ADR-0140): `@2`. `@1` is not in the registry. */
const EVENT_VERSION = 2;

const COMMUNICATION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REQUEST_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const RESULT_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const INTENT_ID = '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80';
const EXECUTION_RESULT_ID = '5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091';
const DECISION_ID = '6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f809102';
const CORRELATION_ID = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f80910203';

const DELIVERED_STATES = ['delivered', 'read'];

/**
 * A complete, canonical `CommunicationAuthorizationV1`.
 *
 * An override of `undefined` REMOVES the key rather than setting it to `undefined`: the real contract
 * checks `!== undefined`, and an explicitly-undefined key is still a key on a strict object. A fixture
 * that ignored the cross-field rules would prove D5 handles payloads Core could never record.
 */
function authorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    communicationRequestId: REQUEST_ID,
    issuer: 'quickfurno-core',
    outcome: 'authorized',
    authorizedChannel: 'whatsapp',
    approvalDecisionId: DECISION_ID,
    decidedAt: '2026-08-31T09:00:00.000Z',
    reasonCode: 'approved-by-policy',
    explanation: 'a free-text explanation that must never reach the read model',
    policy: { policyId: 'communication-policy', policyVersion: 3 },
    correlationId: CORRELATION_ID,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

/** A lawful outcome/failure pairing, honouring the real `CommunicationResultV1` cross-field rules. */
function lawfulOutcome(lifecycleState: string): Record<string, unknown> {
  if (DELIVERED_STATES.includes(lifecycleState)) {
    return { outcome: 'succeeded' };
  }
  if (lifecycleState === 'failed') {
    return {
      outcome: 'failed',
      failure: {
        failureCode: 'provider-rejected',
        failureCategory: 'permanent',
        retryClassification: 'not-retryable',
      },
    };
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

function communicationResult(
  lifecycleState: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    communicationResultId: RESULT_ID,
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    executionIntentId: INTENT_ID,
    executionResultId: EXECUTION_RESULT_ID,
    issuer: 'quickfurno-core',
    lifecycleState,
    recordedAt: '2026-08-31T09:05:00.000Z',
    providerOccurredAt: '2026-08-31T09:04:59.000Z',
    providerEvidence: { providerReference: 'wamid.TEST-PROVIDER-REFERENCE' },
    reasonCode: 'delivered-to-recipient',
    explanation: 'free text that must never reach the read model',
    correlationId: CORRELATION_ID,
    ...lawfulOutcome(lifecycleState),
    ...overrides,
  };
}

function record(eventType: string, payload: Record<string, unknown>): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: EVENT_VERSION,
    source: 'quickfurno-core',
    subjectType: 'communication',
    subjectId: COMMUNICATION_ID,
    occurredAt: '2026-08-31T09:00:00Z',
    emittedAt: '2026-08-31T09:00:05Z',
    correlationId: CORRELATION_ID,
    causationEventId: null,
    payload,
    semanticEventDigest: Buffer.alloc(32, 0xa1),
    bodyDigest: Buffer.alloc(32, 0xb2),
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'test-key',
    signatureSignedAt: '2026-08-31T09:00:06Z',
    signature: Buffer.alloc(64, 0xc3),
  };
}

const authorizationEvent = (overrides: Record<string, unknown> = {}): EventPersistenceRecord =>
  record(AUTHORIZATION_TYPE, { authorization: authorization(overrides) });

const resultEvent = (
  lifecycleState: string,
  overrides: Record<string, unknown> = {},
): EventPersistenceRecord =>
  record(RESULT_TYPE, { result: communicationResult(lifecycleState, overrides) });

/** An event of an entirely unrelated family — D4 does not admit it, so D5 must write nothing. */
const unrelatedEvent = (): EventPersistenceRecord =>
  record('qf.recommendation.created', { synthetic: true });

async function seed(events: readonly EventPersistenceRecord[]): Promise<void> {
  for (const event of events) {
    await storeValidatedEvent(admin, event);
  }
}

const fixedNow: CanonicalInstant = toCanonicalInstant('2026-09-02T00:00:00.000Z');

async function driveCommunicationState(): Promise<void> {
  // Explicit registry: D5 is NOT in the production registry, and this drives it without activating it.
  await runProjectionWorker({
    pool: admin,
    registry: createProjectionRegistry([communicationStateProjection]),
    now: () => fixedNow,
    sleep: () => Promise.resolve(),
    maxCycles: 50,
  });
}

interface StateRow {
  readonly communication_id: string;
  readonly state: string;
  readonly contract_version: number;
  readonly recorded_at: Date;
  readonly reason_code: string;
  readonly correlation_id: string;
  readonly previous_state: string | null;
  readonly evidence: Record<string, unknown>;
  readonly last_position: string;
}

async function readRow(communicationId = COMMUNICATION_ID): Promise<StateRow | null> {
  return withClient(admin, async (client) => {
    const result = await client.query<StateRow>(
      `SELECT communication_id, state, contract_version, recorded_at, reason_code, correlation_id,
              previous_state, evidence, last_position
         FROM qf_jarvis.rm_communication_state
        WHERE communication_id = $1`,
      [communicationId],
    );
    return result.rows[0] ?? null;
  });
}

/** The whole table as a stable, ordered snapshot — the rebuild comparison without a new digest spec. */
async function snapshot(): Promise<string> {
  return withClient(admin, async (client) => {
    const result = await client.query<{ snapshot: string | null }>(
      `SELECT string_agg(row_to_json(t)::text, E'\\n' ORDER BY t.communication_id) AS snapshot
         FROM (SELECT communication_id, state, contract_version, recorded_at, reason_code,
                      correlation_id, previous_state, evidence, last_position
                 FROM qf_jarvis.rm_communication_state) t`,
    );
    return result.rows[0]?.snapshot ?? '';
  });
}

beforeEach(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

describe('D5 — the six states land on the real schema', () => {
  it('writes an authorization as `authorized`, with the evidence instant and no free text', async () => {
    await seed([authorizationEvent()]);
    await driveCommunicationState();

    const row = await readRow();
    expect(row?.state).toBe('authorized');
    expect(row?.contract_version).toBe(2);
    expect(row?.recorded_at.toISOString()).toBe('2026-08-31T09:00:00.000Z');
    expect(row?.reason_code).toBe('approved-by-policy');
    expect(row?.correlation_id).toBe(CORRELATION_ID);
    expect(row?.previous_state).toBeNull();

    const evidence = row?.evidence ?? {};
    expect(evidence['authorizedChannel']).toBe('whatsapp');
    expect(JSON.stringify(evidence)).not.toContain('free-text');
    expect(evidence).not.toHaveProperty('approvalDecisionId');
    expect(evidence).not.toHaveProperty('policy');
  });

  it('writes a refusal as `rejected`, with NO authorized channel at all', async () => {
    await seed([
      authorizationEvent({
        outcome: 'rejected',
        // A refusal authorizes no channel AND rests on no approval decision — both are contract rules.
        authorizedChannel: undefined,
        approvalDecisionId: undefined,
        reasonCode: 'recipient-opted-out',
      }),
    ]);
    await driveCommunicationState();

    const row = await readRow();
    expect(row?.state).toBe('rejected');
    expect(row?.evidence).not.toHaveProperty('authorizedChannel');
  });

  it.each([['provider-accepted'], ['delivered'], ['read'], ['failed']])(
    'writes result lifecycle %s as the same state',
    async (lifecycleState) => {
      await seed([resultEvent(lifecycleState)]);
      await driveCommunicationState();

      const row = await readRow();
      expect(row?.state).toBe(lifecycleState);
      expect(row?.evidence['lifecycleState']).toBe(lifecycleState);
      expect(row?.recorded_at.toISOString()).toBe('2026-08-31T09:05:00.000Z');
      // Provider detail and execution ids never reach the read model.
      for (const forbidden of [
        'providerEvidence',
        'providerReference',
        'providerOccurredAt',
        'executionIntentId',
        'executionResultId',
        'explanation',
        'failureCategory',
      ]) {
        expect(row?.evidence).not.toHaveProperty(forbidden);
      }
    },
  );

  it('keeps only the minimised failure on a failed result', async () => {
    await seed([resultEvent('failed')]);
    await driveCommunicationState();

    const failure = (await readRow())?.evidence['failure'] as Record<string, unknown>;
    expect(Object.keys(failure).sort()).toStrictEqual(['failureCode', 'retryClassification']);
  });

  it('writes NOTHING for an event D4 does not admit', async () => {
    await seed([unrelatedEvent()]);
    await driveCommunicationState();

    expect(await readRow()).toBeNull();
    // The checkpoint still advances: the event was processed, and no state was invented.
    const checkpoint = await withClient(admin, (client) =>
      client
        .query<{ last_position: string }>(
          `SELECT last_position FROM qf_jarvis.projection_checkpoint
            WHERE projection_name = $1 AND projection_version = $2`,
          [COMMUNICATION_STATE_PROJECTION_NAME, COMMUNICATION_STATE_PROJECTION_VERSION],
        )
        .then((r) => r.rows[0]?.last_position ?? null),
    );
    expect(checkpoint).toBe('1');
  });
});

describe('D5 — ordering, previous_state and idempotency', () => {
  it('advances through a lifecycle, carrying previous_state from the row replaced', async () => {
    await seed([
      authorizationEvent(),
      resultEvent('provider-accepted'),
      resultEvent('delivered'),
      resultEvent('read'),
    ]);
    await driveCommunicationState();

    const row = await readRow();
    expect(row?.state).toBe('read');
    // The PERSISTED prior state, not an inference from a lifecycle graph.
    expect(row?.previous_state).toBe('delivered');
    expect(row?.last_position).toBe('4');
  });

  it('is a no-op on replay: re-running the worker changes nothing', async () => {
    await seed([authorizationEvent(), resultEvent('delivered')]);
    await driveCommunicationState();
    const first = await snapshot();

    await driveCommunicationState();
    expect(await snapshot()).toBe(first);
  });

  it('a re-presented position does not mutate previous_state', async () => {
    await seed([authorizationEvent(), resultEvent('delivered')]);
    await driveCommunicationState();
    expect((await readRow())?.previous_state).toBe('authorized');

    // Re-apply the SAME position directly. The guard is `>`, so an equal position is refused.
    await withTransaction(admin, (client) =>
      communicationStateProjection.apply(client, {
        position: 2n,
        eventType: RESULT_TYPE,
        eventVersion: EVENT_VERSION,
        acceptedAt: fixedNow,
      }),
    );

    const row = await readRow();
    expect(row?.previous_state).toBe('authorized'); // NOT 'delivered'
    expect(row?.state).toBe('delivered');
    expect(row?.last_position).toBe('2');
  });

  it('a STALE position cannot overwrite newer state', async () => {
    await seed([authorizationEvent(), resultEvent('read')]);
    await driveCommunicationState();
    expect((await readRow())?.state).toBe('read');

    // Re-apply position 1 (the authorization) after position 2 has landed.
    await withTransaction(admin, (client) =>
      communicationStateProjection.apply(client, {
        position: 1n,
        eventType: AUTHORIZATION_TYPE,
        eventVersion: EVENT_VERSION,
        acceptedAt: fixedNow,
      }),
    );

    const row = await readRow();
    expect(row?.state).toBe('read');
    expect(row?.last_position).toBe('2');
    expect(row?.previous_state).toBe('authorized');
  });

  it('keeps one CURRENT row per communication — never a local history table', async () => {
    await seed([authorizationEvent(), resultEvent('provider-accepted'), resultEvent('delivered')]);
    await driveCommunicationState();

    const count = await withClient(admin, (client) =>
      client
        .query<{ count: string }>(
          `SELECT count(*)::text AS count FROM qf_jarvis.rm_communication_state`,
        )
        .then((r) => r.rows[0]?.count),
    );
    expect(count).toBe('1');
  });
});

describe('D5 — rebuild determinism', () => {
  it('a full destroy-and-rebuild reproduces the live table exactly', async () => {
    await seed([
      authorizationEvent(),
      unrelatedEvent(),
      resultEvent('provider-accepted'),
      resultEvent('delivered'),
    ]);
    await driveCommunicationState();
    const live = await snapshot();

    const rebuilt = await withTransaction(admin, async (client) => {
      const horizon = await captureRebuildHorizon(client);
      await client.query('DELETE FROM qf_jarvis.rm_communication_state');
      const result = await rebuildProjection({
        client,
        definition: communicationStateProjection,
        horizon,
      });
      expect(result.appliedPositions).toBe(horizon);
      const inner = await client.query<{ snapshot: string | null }>(
        `SELECT string_agg(row_to_json(t)::text, E'\\n' ORDER BY t.communication_id) AS snapshot
           FROM (SELECT communication_id, state, contract_version, recorded_at, reason_code,
                        correlation_id, previous_state, evidence, last_position
                   FROM qf_jarvis.rm_communication_state) t`,
      );
      return inner.rows[0]?.snapshot ?? '';
    });

    // Byte-identical, INCLUDING previous_state and recorded_at: nothing here came from a clock.
    expect(rebuilt).toBe(live);
  });
});

describe('D5 — migration 0013 constraints are real', () => {
  const insert = (overrides: Record<string, string>) =>
    withClient(admin, (client) =>
      client.query(
        `INSERT INTO qf_jarvis.rm_communication_state
           (communication_id, state, contract_version, recorded_at, reason_code, correlation_id,
            previous_state, evidence, last_position)
         VALUES ($1::uuid, $2, $3::smallint, $4::timestamptz, $5, $6::uuid, $7, $8::jsonb, $9::bigint)`,
        [
          overrides['communication_id'] ?? randomUUID(),
          overrides['state'] ?? 'delivered',
          overrides['contract_version'] ?? '2',
          overrides['recorded_at'] ?? '2026-08-31T09:05:00.000Z',
          overrides['reason_code'] ?? 'delivered-to-recipient',
          overrides['correlation_id'] ?? CORRELATION_ID,
          overrides['previous_state'] ?? null,
          overrides['evidence'] ?? '{"tier":"tier-c"}',
          overrides['last_position'] ?? '1',
        ],
      ),
    );

  it('accepts each of the six durable states', async () => {
    for (const state of [
      'rejected',
      'authorized',
      'provider-accepted',
      'delivered',
      'read',
      'failed',
    ]) {
      await expect(insert({ state })).resolves.toBeDefined();
    }
  });

  it.each([
    ['queued'],
    ['sent'],
    ['completed'],
    ['authorization-requested'],
    ['scheduled'],
    ['DELIVERED'],
    [''],
  ])('refuses %s — it is not one of the six', async (state) => {
    await expect(insert({ state })).rejects.toThrow(
      /rm_communication_state_state_is_durable_v2_state/,
    );
  });

  it('refuses a previous_state outside the six, but allows NULL', async () => {
    await expect(insert({ previous_state: 'queued' })).rejects.toThrow(
      /rm_communication_state_previous_state_is_durable_v2_state/,
    );
    await expect(insert({ previous_state: 'authorized' })).resolves.toBeDefined();
  });

  it.each([['1'], ['3'], ['0']])(
    'refuses contract_version %s — this table is V2 only',
    async (v) => {
      await expect(insert({ contract_version: v })).rejects.toThrow(
        /rm_communication_state_contract_version_is_v2/,
      );
    },
  );

  it.each([['Not A Token'], ['UPPER'], ['trailing-'], ['.leading'], ['a__b'], ['']])(
    'refuses reason code %s',
    async (reason_code) => {
      await expect(insert({ reason_code })).rejects.toThrow(
        /rm_communication_state_reason_code_is_machine_token/,
      );
    },
  );

  it('refuses a reason code longer than 64 characters', async () => {
    await expect(insert({ reason_code: 'a'.repeat(65) })).rejects.toThrow(
      /rm_communication_state_reason_code_is_machine_token/,
    );
  });

  it('refuses a non-positive position', async () => {
    await expect(insert({ last_position: '0' })).rejects.toThrow(
      /rm_communication_state_last_position_positive/,
    );
  });

  it.each([['"a string"'], ['[]'], ['1'], ['null']])(
    'refuses evidence %s — it must be an object',
    async (evidence) => {
      await expect(insert({ evidence })).rejects.toThrow(
        /rm_communication_state_evidence_is_object|null value/,
      );
    },
  );

  it('enforces one row per communication', async () => {
    const communication_id = randomUUID();
    await expect(insert({ communication_id })).resolves.toBeDefined();
    await expect(insert({ communication_id })).rejects.toThrow(/rm_communication_state_pk/);
  });

  it('has NO erasure tombstone or subject reference — an owner decision (ADR-0142)', async () => {
    const columns = await withClient(admin, (client) =>
      client
        .query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'qf_jarvis' AND table_name = 'rm_communication_state'
            ORDER BY column_name`,
        )
        .then((r) => r.rows.map((row) => row.column_name)),
    );

    expect(columns).toStrictEqual([
      'communication_id',
      'contract_version',
      'correlation_id',
      'evidence',
      'last_position',
      'previous_state',
      'reason_code',
      'recorded_at',
      'state',
    ]);
    // No wall-clock column either: every instant here comes from the evidence.
    for (const absent of [
      'erased',
      'erased_at',
      'erased_at_position',
      'subject_type',
      'subject_id',
      'created_at',
      'updated_at',
    ]) {
      expect(columns).not.toContain(absent);
    }
  });
});

describe('D5 — least-privilege grant', () => {
  it('projection_runtime can upsert the read model, but never delete it or read the payload', async () => {
    // Re-provision with the projection role present BEFORE migrating, so 0013's conditional grant applies.
    const password = `p09d5_${randomUUID().replace(/-/g, '')}`;
    await resetTestDatabase(admin);
    await ensureProjectionRoleExists(admin, password);
    await runMigrations(admin, defaultMigrationsDirectory());
    await seed([authorizationEvent()]);

    const projectionPool = createProjectionPool(password, 'qf-p09d5-grant');
    try {
      await withClient(projectionPool, async (client) => {
        // 0013 deliberately does NOT broaden the event-log grant. The role still cannot read the
        // payload — the boundary three existing least-privilege tests assert — because D5 is not
        // activated and nothing runs as this role. That grant belongs to the activation slice.
        await expect(
          client.query(`SELECT event_id, source, payload FROM qf_jarvis.event`),
        ).rejects.toThrow(/permission denied/);

        // It can upsert the read model.
        await expect(
          client.query(
            `INSERT INTO qf_jarvis.rm_communication_state
               (communication_id, state, contract_version, recorded_at, reason_code, correlation_id,
                previous_state, evidence, last_position)
             VALUES ($1::uuid, 'authorized', 2, now(), 'approved-by-policy', $2::uuid, NULL,
                     '{"tier":"tier-c"}'::jsonb, 1)`,
            [randomUUID(), CORRELATION_ID],
          ),
        ).resolves.toBeDefined();

        // But it may NOT destroy it: a rebuild destroy stays a trusted admin operation.
        await expect(client.query(`DELETE FROM qf_jarvis.rm_communication_state`)).rejects.toThrow(
          /permission denied/,
        );
        await expect(client.query(`TRUNCATE qf_jarvis.rm_communication_state`)).rejects.toThrow(
          /permission denied|must be owner/,
        );

        // And it still may not write the event log.
        await expect(client.query(`DELETE FROM qf_jarvis.event`)).rejects.toThrow(
          /permission denied/,
        );
      });
    } finally {
      await closeTestPool(projectionPool);
    }
  });
});
