/**
 * The continuity store port (RWC-P2C, ADR-0094).
 *
 * An INTERFACE, and deliberately no implementation. RWC-P2B decides whether a durable schema is
 * needed and what it looks like; this port is the evidence that decision will be made against.
 *
 * ### Why three methods, when a turn only uses two
 *
 * `load` and `createInitialIfAbsent` are what a turn needs. `compareAndSet` is declared and
 * **never called by this service**, because RWC-P4 owns continuity evolution.
 *
 * It is declared anyway, and that is the point of the slice. RWC-P2A created `continuityRevision`
 * as its own counter; if the port omitted the operation that counter exists for, P2B would design a
 * schema without knowing it needed optimistic concurrency, and would discover it after the table
 * existed. Declaring it now makes three durable requirements visible before any schema is written:
 * a tenant-scoped key, an atomic create-if-absent, and a compare-and-set.
 *
 * ### There is no default implementation, and there must not be
 *
 * A deterministic in-memory fake lives under `src/tests/` and is excluded from the emitting build.
 * An in-memory default would pass every test and lose every conversation on restart — which is
 * precisely the failure this port exists to make impossible to ship by accident. The service
 * constructor REQUIRES an injected store.
 */
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

/**
 * The key. Tenant AND conversation, never a conversation alone.
 *
 * ADR-0076 §3 removed the global-uniqueness assumption for `conversationId`, so a store keyed on it
 * alone would merge two tenants' conversations into one.
 */
export interface RiyaContinuityStoreKey {
  readonly tenantId: string;
  readonly conversationId: string;
}

/** What an atomic create-if-absent reports. */
export interface RiyaContinuityCreateResult {
  /** `CREATED` when this call wrote the row; `EXISTING` when another call had already won. */
  readonly disposition: 'CREATED' | 'EXISTING';
  /** The AUTHORITATIVE state after the call — the winner's, not necessarily the one supplied. */
  readonly state: RiyaConversationContinuityStateV1;
}

/** The closed answers a compare-and-set may give. */
export const RIYA_CONTINUITY_CAS_OUTCOMES = ['UPDATED', 'REVISION_CONFLICT', 'NOT_FOUND'] as const;

export type RiyaContinuityCasOutcome = (typeof RIYA_CONTINUITY_CAS_OUTCOMES)[number];

/** The injected continuity store. Every method may perform I/O, so every method is async. */
export interface RiyaContinuityStorePort {
  /** Read one conversation's state, or `undefined` if it has none yet. */
  load(key: RiyaContinuityStoreKey): Promise<RiyaConversationContinuityStateV1 | undefined>;

  /**
   * Create the initial state if none exists, atomically for one `(tenantId, conversationId)`.
   *
   * Two simultaneous first turns may compute the same candidate; only the store decides which one
   * won, and both callers must then use the state it returns. A read-then-write in the service
   * would race, and the race would produce two conversations that each believe they are the first.
   */
  createInitialIfAbsent(input: {
    readonly state: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCreateResult>;

  /**
   * Replace the state only if the stored revision still matches. NOT called by this service.
   *
   * Declared so RWC-P2B knows the schema must support optimistic concurrency before it designs one.
   */
  compareAndSet(input: {
    readonly expectedRevision: number;
    readonly nextState: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCasOutcome>;
}
