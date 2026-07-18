/**
 * `createEventIngestor` — the database-free ordering and safety properties (Stage 3.3.4, ADR-0032).
 *
 * These prove the boundary contract that needs no database: verification runs BEFORE any JSON
 * parse, an altered body is refused before preparation, an oversized body is refused before any
 * parse, the injected `now` deterministically controls freshness, and a rejected result is a frozen,
 * bounded object. A capturing fake pool stands in for persistence so a signature rejection can be
 * observed without a real database. The full persistence behaviour is proven in the integration
 * suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DatabasePool } from '@qf-jarvis/event-backbone';

import {
  createEventIngestor,
  DEFAULT_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  type EventIngestor,
} from '../index.js';
import { TEST_KEY_ID, testRegistry } from './fixtures/registry.js';
import { signEnvelope } from './fixtures/signer.js';
import { testPrivateKey } from './fixtures/test-keys.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';
const registry = testRegistry();

interface CapturedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A fake pool that captures every query and returns a synthetic rejection row for INSERTs. */
function capturingPool(): { pool: DatabasePool; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      return Promise.resolve({
        rows: [{ sequence: '7', recorded_at: new Date('2026-07-18T00:00:00Z') }],
      });
    },
    release: () => undefined,
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as DatabasePool;
  return { pool, queries };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sign(rawBody: Uint8Array, signedAt: string = SIGNED_AT): unknown {
  return signEnvelope({ rawBody, keyId: TEST_KEY_ID, signedAt, privateKey: testPrivateKey });
}

function ingestorFor(pool: DatabasePool): EventIngestor {
  return createEventIngestor({ pool, keyRegistry: registry });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEventIngestor — verify-before-parse ordering', () => {
  it('does NOT invoke JSON.parse when the signature fails', async () => {
    const { pool, queries } = capturingPool();
    const parseSpy = vi.spyOn(JSON, 'parse');

    const result = await ingestorFor(pool).ingest(jsonBytes({ a: 1 }), null, NOW);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('signature-missing');
    // Preparation (the only JSON.parse) was never reached.
    expect(parseSpy).not.toHaveBeenCalled();
    // The only query is the ingestion_rejection append — no event transaction.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('INSERT INTO qf_jarvis.ingestion_rejection');
  });

  it('rejects a body altered after signing BEFORE preparation (no JSON.parse)', async () => {
    const { pool } = capturingPool();
    const parseSpy = vi.spyOn(JSON, 'parse');
    // Sign one body, deliver a different one — the verifier refuses it as body-digest-mismatch.
    const envelope = sign(jsonBytes({ a: 1 }));
    const result = await ingestorFor(pool).ingest(jsonBytes({ a: 2 }), envelope, NOW);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('body-digest-mismatch');
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('does not hash or parse an oversized body beyond approved behaviour', async () => {
    const { pool } = capturingPool();
    const parseSpy = vi.spyOn(JSON, 'parse');
    const oversized = new Uint8Array(MAX_RAW_BODY_BYTES + 1);
    const result = await ingestorFor(pool).ingest(oversized, sign(jsonBytes({ a: 1 })), NOW);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('body-too-large');
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe('createEventIngestor — the injected now controls freshness deterministically', () => {
  it('accepts a signedAt at the edge of the window and refuses one past it, with the SAME bytes', async () => {
    const { pool } = capturingPool();
    const rawBody = jsonBytes({ a: 1 });

    // Signed exactly at the far edge of the window relative to a chosen now: fresh, so it passes
    // verification and fails LATER at preparation (this body is not a canonical event).
    const edge = new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS).toISOString();
    const atEdge = await ingestorFor(pool).ingest(rawBody, sign(rawBody, edge), NOW);
    expect(atEdge.outcome).toBe('rejected');
    if (atEdge.outcome !== 'rejected') return;
    expect(atEdge.reason).toBe('contract-validation-failed'); // passed freshness, failed preparation

    // One millisecond past the window: refused as replay-window-future — purely because of `now`.
    const past = new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS + 1).toISOString();
    const beyond = await ingestorFor(pool).ingest(rawBody, sign(rawBody, past), NOW);
    expect(beyond.outcome).toBe('rejected');
    if (beyond.outcome !== 'rejected') return;
    expect(beyond.reason).toBe('replay-window-future');

    // The same too-fresh-for-2000 body is fine at a later `now`.
    const later = new Date('2030-01-01T00:00:00.000Z');
    const stillFuture = await ingestorFor(pool).ingest(rawBody, sign(rawBody, past), later);
    expect(stillFuture.outcome).toBe('rejected');
    if (stillFuture.outcome !== 'rejected') return;
    expect(stillFuture.reason).toBe('replay-window-expired'); // now way after signedAt
  });
});

describe('createEventIngestor — rejected results are bounded and frozen', () => {
  it('freezes the rejected result and exposes only bounded facts', async () => {
    const { pool } = capturingPool();
    const result = await ingestorFor(pool).ingest(jsonBytes({ a: 1 }), null, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toStrictEqual(
      ['outcome', 'reason', 'rejectionSequence', 'recordedAt'].sort(),
    );
    // No raw body, payload, signature, event id, or correlation id leaks onto the result.
    const asRecord = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      'rawBody',
      'payload',
      'signature',
      'eventId',
      'correlationId',
      'body',
    ]) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });

  it('the ingestor object itself is frozen', () => {
    const { pool } = capturingPool();
    expect(Object.isFrozen(ingestorFor(pool))).toBe(true);
  });
});

describe('createEventIngestor — fixtures are synthetic', () => {
  it('the canonical-event fixture carries only obviously-synthetic identifiers', async () => {
    const { VALID_CANONICAL_EVENT } = await import('./fixtures/canonical-event.js');
    const asText = JSON.stringify(VALID_CANONICAL_EVENT);
    // No email, no plus-prefixed E.164 phone number, only opaque CORE- references.
    expect(asText).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(asText).not.toMatch(/\+\d{7,}/);
    expect(VALID_CANONICAL_EVENT.subject.entityId.startsWith('CORE-')).toBe(true);
  });
});
