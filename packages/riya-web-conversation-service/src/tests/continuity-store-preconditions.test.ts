/**
 * The continuity-store REVISION preconditions (RWC-P2B-R1, ADR-0095).
 *
 * `continuityRevision` is declared a MONOTONIC compare-and-set counter by RWC-P2A. These prove the
 * test-only fake enforces the two preconditions the port now states, so it can never certify a
 * caller the durable PostgreSQL store would refuse.
 *
 * That mattered in practice. The first durable implementation stored whatever next revision it was
 * handed, justified by this fake's permissiveness — and a review then proved two writers both
 * holding revision 5 could both be told `UPDATED`, silently destroying the first one's state. The
 * repository had already ruled on this shape once: `agent-runtime`'s orchestration contract records
 * that a conversation revision's domain "is fixed by the durable schema that owns it", and that a
 * fake is not evidence about a database. Both implementations now enforce the same rule.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import {
  InMemoryContinuityStore,
  InMemoryContinuityStoreError,
} from './fakes/in-memory-continuity-store.js';

function state(
  continuityRevision: number,
  locationRef?: string,
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    continuityRevision,
    phase: 'INTRO',
    discovery:
      locationRef === undefined
        ? {
            completeness: 'MORE_DISCOVERY_REQUIRED',
            missingFields: [...DISCOVERY_FIELDS_FROZEN],
          }
        : {
            locationRef,
            completeness: 'MORE_DISCOVERY_REQUIRED',
            missingFields: DISCOVERY_FIELDS_FROZEN.filter((f) => f !== 'location'),
          },
    ...(locationRef === undefined ? {} : { fieldProvenance: { location: 'user_stated' as const } }),
    summaryConfirmed: false,
  });
}

describe('createInitialIfAbsent is born at revision 0', () => {
  it('accepts a revision-0 initial state', async () => {
    const store = new InMemoryContinuityStore();
    const result = await store.createInitialIfAbsent({ state: state(0) });
    expect(result.disposition).toBe('CREATED');
    expect(result.state.continuityRevision).toBe(0);
  });

  it('rejects a nonzero initial revision as invalid input, not as arbitration', () => {
    const store = new InMemoryContinuityStore();
    for (const revision of [1, 5, 41]) {
      expect(() => store.createInitialIfAbsent({ state: state(revision) })).toThrow(
        InMemoryContinuityStoreError,
      );
    }
    // Nothing was stored: a refused precondition is not a half-applied create.
    expect(store.size).toBe(0);
  });
});

describe('compareAndSet requires exactly expectedRevision + 1', () => {
  it('rejects an EQUAL next revision — the lost-update case', () => {
    const store = new InMemoryContinuityStore();
    store.seed(state(0));
    // 0 -> 0. Accepting this leaves the stored revision unchanged, so a second writer still holding 0
    // would match and win too. Both told UPDATED; the first writer's state gone.
    expect(() => store.compareAndSet({ expectedRevision: 0, nextState: state(0) })).toThrow(
      InMemoryContinuityStoreError,
    );
  });

  it('rejects a BACKWARD next revision', () => {
    const store = new InMemoryContinuityStore();
    store.seed(state(5));
    expect(() => store.compareAndSet({ expectedRevision: 5, nextState: state(2) })).toThrow(
      InMemoryContinuityStoreError,
    );
  });

  it('rejects a SKIPPED next revision', () => {
    const store = new InMemoryContinuityStore();
    store.seed(state(5));
    expect(() => store.compareAndSet({ expectedRevision: 5, nextState: state(7) })).toThrow(
      InMemoryContinuityStoreError,
    );
  });

  it('accepts exactly +1 when the stored revision matches', async () => {
    const store = new InMemoryContinuityStore();
    store.seed(state(5));
    await expect(
      store.compareAndSet({ expectedRevision: 5, nextState: state(6, 'city.pune') }),
    ).resolves.toBe('UPDATED');
    const loaded = await store.load({ tenantId: 'tenant.a', conversationId: 'conv.1' });
    expect(loaded?.continuityRevision).toBe(6);
    expect(loaded?.discovery.locationRef).toBe('city.pune');
  });

  it('a stale second writer at the same expected revision gets REVISION_CONFLICT', async () => {
    const store = new InMemoryContinuityStore();
    store.seed(state(5));

    // Writer one advances 5 -> 6.
    await expect(
      store.compareAndSet({ expectedRevision: 5, nextState: state(6, 'city.pune') }),
    ).resolves.toBe('UPDATED');

    // Writer two still believes the row is at 5. Its request is WELL FORMED — 5 -> 6 is a legal
    // transition — so this is a genuine concurrency answer, not a precondition failure.
    await expect(
      store.compareAndSet({ expectedRevision: 5, nextState: state(6, 'city.mumbai') }),
    ).resolves.toBe('REVISION_CONFLICT');

    // And the winner survives untouched.
    const loaded = await store.load({ tenantId: 'tenant.a', conversationId: 'conv.1' });
    expect(loaded?.continuityRevision).toBe(6);
    expect(loaded?.discovery.locationRef).toBe('city.pune');
  });

  it('still answers NOT_FOUND for a well-formed request against no row', async () => {
    const store = new InMemoryContinuityStore();
    await expect(store.compareAndSet({ expectedRevision: 0, nextState: state(1) })).resolves.toBe(
      'NOT_FOUND',
    );
  });

  it('keeps the CAS outcome vocabulary at exactly three', () => {
    // A precondition failure THROWS; it never becomes a fourth outcome.
    const store = new InMemoryContinuityStore();
    store.seed(state(0));
    let threw = false;
    try {
      void store.compareAndSet({ expectedRevision: 0, nextState: state(0) });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
