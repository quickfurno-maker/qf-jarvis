/**
 * MemoryInvalidationRequestV1 — throw away what an agent remembers.
 *
 * Memory is derived and rebuildable (see agent-memory.ts), which means invalidating it
 * is always **safe** — the worst case is that it gets rebuilt from the canonical events
 * it came from. That property is what makes this contract possible at all: you can only
 * offer a "forget it" button on a store that is not the source of truth.
 *
 * ### The three reasons memory gets invalidated, and why they share one contract
 *
 * 1. **Core said something we did not know.** A derived summary is out of date. Cheap:
 *    drop it, rebuild it.
 *
 * 2. **The agent was wrong.** A human corrected a conclusion that memory has been
 *    carrying forward, and every future run reasons from the mistake until it is cleared.
 *
 * 3. **Someone exercised a deletion or anonymisation right.** This is the one that must
 *    not fail. When Core erases a client, the client's data must not survive inside an
 *    agent's derived memory — that is precisely the "fragments scattered through derived
 *    views" failure that data-ownership.md requires deletion to propagate into.
 *
 * They share a contract because the *mechanism* is identical and the *urgency* is not,
 * and `erasureRequestId` is what distinguishes them. A record invalidated for staleness
 * is housekeeping. A record invalidated because of an erasure request is a **legal
 * obligation**, and it carries the identity of the request that obliges it — so that
 * "did we actually delete everything?" is a query rather than a hope.
 *
 * ### Scope, and the reason `all` exists
 *
 * `all` invalidates an agent's entire memory. It looks alarming and it is not: rebuilding
 * from canonical events is a supported operation, and being *willing* to do it is what
 * keeps memory honest. An organisation that is afraid to clear a derived store has one
 * that is no longer derived.
 */

import { z } from 'zod';

import {
  correlationIdSchema,
  erasureRequestIdSchema,
  memoryInvalidationRequestIdSchema,
  memoryRecordIdSchema,
} from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { agentIdSchema } from '../common/systems.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const MEMORY_INVALIDATION_CONTRACT_VERSION = 1;

/**
 * How much to forget.
 *
 * - `record` — one memory record, by id.
 * - `subject` — everything an agent remembers about one entity. **This is the shape a
 *   deletion request takes**: forget everything you know about this client.
 * - `agent` — one agent's entire memory.
 * - `all` — every agent's memory. Rebuildable, therefore permissible.
 */
export const MEMORY_INVALIDATION_SCOPES = ['record', 'subject', 'agent', 'all'] as const;

export const memoryInvalidationScopeSchema = z.enum(MEMORY_INVALIDATION_SCOPES);
export type MemoryInvalidationScope = z.infer<typeof memoryInvalidationScopeSchema>;

const memoryInvalidationShapeSchema = z.strictObject({
  memoryInvalidationRequestId: memoryInvalidationRequestIdSchema,
  contractVersion: z.literal(MEMORY_INVALIDATION_CONTRACT_VERSION),

  scope: memoryInvalidationScopeSchema,

  /** Required for `record`, `subject`, and `agent`. Absent for `all`. */
  ownerAgent: agentIdSchema.optional(),
  /** Required for `record`. */
  memoryRecordId: memoryRecordIdSchema.optional(),
  /** Required for `subject`. The entity to be forgotten. */
  subjectReference: entityReferenceSchema.optional(),

  /**
   * The erasure request that obliges this, when there is one.
   *
   * Present: this is a deletion or anonymisation obligation, and its completion is
   * legally material. Absent: this is housekeeping. The distinction must be visible in
   * the record, because the two have very different consequences for failing quietly.
   */
  erasureRequestId: erasureRequestIdSchema.optional(),

  requestedBy: actorReferenceSchema,
  requestedAt: utcTimestampSchema,

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export const memoryInvalidationRequestV1Schema = memoryInvalidationShapeSchema.superRefine(
  (value, ctx) => {
    if (value.scope === 'record' && value.memoryRecordId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['memoryRecordId'],
        message: 'A "record"-scoped invalidation must name the memory record to invalidate',
      });
    }

    if (value.scope === 'subject' && value.subjectReference === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectReference'],
        message:
          'A "subject"-scoped invalidation must name the entity to be forgotten. This is the shape a deletion request takes, and an unnamed subject deletes nothing',
      });
    }

    // `record`, `subject`, and `agent` are all scoped to one agent's memory. `all` is
    // not, and an `ownerAgent` on it would be a contradiction that quietly narrows a
    // deletion somebody believed was total.
    if (value.scope !== 'all' && value.ownerAgent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ownerAgent'],
        message: `A "${value.scope}"-scoped invalidation must name the agent whose memory is being invalidated`,
      });
    }

    if (value.scope === 'all' && value.ownerAgent !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ownerAgent'],
        message:
          'An "all"-scoped invalidation covers every agent, so it must not name one. A scoped deletion that looks total is worse than one that admits its scope',
      });
    }

    // A record id on a subject-wide or agent-wide invalidation is ambiguous: did the
    // caller mean the one record, or everything? Refuse rather than guess.
    if (value.scope !== 'record' && value.memoryRecordId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['memoryRecordId'],
        message: `A "${value.scope}"-scoped invalidation must not name a single memory record`,
      });
    }

    if (value.scope !== 'subject' && value.subjectReference !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectReference'],
        message: `A "${value.scope}"-scoped invalidation must not name a single subject`,
      });
    }
  },
);

export type MemoryInvalidationRequestV1 = z.infer<typeof memoryInvalidationRequestV1Schema>;
