/**
 * AgentMemoryRecordV1 — what an agent remembers, and everything that stops that from
 * becoming a second source of truth.
 *
 * Agent memory is the most dangerous thing in this repository, and it is worth being
 * precise about why. Every other artifact here is a *statement about a moment*: a
 * recommendation, a decision, a result. Memory is a statement that **persists and is
 * reused**, and a persistent, reused, agent-owned store of business facts is — however
 * it is described in the design document — a second copy of QuickFurno Core's data that
 * drifts, that nobody reconciles, and that an agent will eventually reason from in
 * preference to the truth.
 *
 * ADR-0001 forbids that. This contract is how the forbidding is made structural.
 *
 * ### The four literals
 *
 * - **`authoritative: false`** — a literal, so `true` does not parse. Memory is never
 *   truth. When memory and Core disagree, **Core wins, always, without discussion**.
 *   There is no field in which memory could claim otherwise.
 *
 * - **`rebuildable: true`** — a literal, so `false` does not parse. Every memory record
 *   must be derivable again from the canonical events that produced it. This is what
 *   makes memory *disposable*, and disposability is what stops it becoming load-bearing.
 *   A memory that cannot be rebuilt is a memory that must be preserved, and a memory
 *   that must be preserved has quietly become a database of record.
 *
 * The two literals are the same guarantee stated from both ends: memory is derived, and
 * derived things can be thrown away.
 *
 * ### Isolation: agents do not read each other's memories
 *
 * `ownerAgent` scopes the record, and `subjectReferences` is checked against what that
 * agent is allowed to know about. Anisha may not hold client-relationship memory; Kabir
 * may not hold vendor-performance memory. A specialist that notices something outside
 * its domain **raises a signal and Jarvis routes it** — it does not remember it
 * (agent-model.md).
 *
 * This is enforced, not requested. `MEMORY_SUBJECT_OWNERSHIP` below is a closed map, and
 * a memory record whose subject falls outside its owner's domain does not parse.
 *
 * Why it matters: the moment an agent can accumulate context outside its domain, the
 * bounded-specialist model is over. Anisha starts reasoning about client satisfaction,
 * Kabir starts reasoning about vendor quality, and the responsibility matrix becomes a
 * description of what the system used to do.
 *
 * ### Deletion-aware by construction
 *
 * `erasureState` is mandatory. When Core deletes or anonymises a client, every memory
 * record about that client must reflect it — and because the field is required, a record
 * that has *not* been updated is **detectably stale** rather than invisibly wrong
 * (data-ownership.md). The propagation mechanism is Phase 11's; the representation that
 * makes it checkable is this.
 *
 * ### What memory may not contain
 *
 * No chain-of-thought. No raw model output. No prompts. No credentials. No contact
 * details. `derivedSignals` is a governed container, and those are refused by key and by
 * value shape. `derivedSummary` is bounded text meant to be read by a human — it is a
 * conclusion, not a transcript of how the conclusion was reached.
 */

import { z } from 'zod';

import { correlationIdSchema, eventIdSchema, memoryRecordIdSchema } from '../common/identifiers.js';
import { agentIdSchema, type AgentId } from '../common/systems.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { createGovernedJsonObjectSchema } from '../common/governed-parameters.js';
import { dataClassificationSchema, erasureStateSchema } from '../common/classification.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { isAtOrBefore, isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { policyReferenceSchema } from '../common/policy.js';

export const AGENT_MEMORY_CONTRACT_VERSION = 1;

export const MAX_MEMORY_SUBJECTS = 10;
export const MAX_MEMORY_SOURCE_EVENTS = 100;

/**
 * What each agent is allowed to remember *about*.
 *
 * A closed map, taken from the approved agent model. The entity types here are the
 * subjects a memory record may name — not QuickFurno Core's entity taxonomy, which is
 * Core's and is not enumerated anywhere in Phase 2 (see entity-reference.ts).
 *
 * Read this as the bounded-specialist model, expressed as data:
 *
 * - **Riya** — the client journey. Clients, their leads, their requirements.
 * - **Anisha** — the vendor journey. Vendors, and nothing else.
 * - **Kabir** — lead quality. Leads, and nothing else.
 * - **Jitin** — growth, and only in aggregate. Cities, categories, campaigns — note that
 *   Jitin has **no client and no vendor subject at all**. Marketing intelligence does
 *   not require remembering individual people, so it is not permitted to.
 * - **Jarvis** — coordination artifacts. Recommendations, agent runs, evaluations, and
 *   founder attention. Note what is *absent*: no client, no vendor, no lead. **Jarvis
 *   owns the connecting, never the concluding** (agent-model.md), and an agent that
 *   remembered domain facts would be concluding.
 */
export const MEMORY_SUBJECT_OWNERSHIP: Readonly<Record<AgentId, readonly string[]>> = {
  riya: ['client', 'lead', 'requirement'],
  anisha: ['vendor'],
  kabir: ['lead'],
  jitin: ['city', 'category', 'campaign'],
  jarvis: ['recommendation', 'agent-run', 'evaluation', 'founder-attention'],
};

/**
 * Derived signals: bounded, governed, and refused if they carry anything they should not.
 *
 * The always-forbidden set applies — credentials, contact details, raw provider content,
 * model internals — and cannot be opted out of. `summary` and `note` are additionally
 * refused, because a free-text blob smuggled in here would be exactly the unbounded
 * memory this contract exists to prevent.
 */
export const derivedSignalsSchema = createGovernedJsonObjectSchema(['note', 'notes', 'freetext']);

const agentMemoryShapeSchema = z.strictObject({
  memoryRecordId: memoryRecordIdSchema,
  contractVersion: z.literal(AGENT_MEMORY_CONTRACT_VERSION),

  /** Whose memory this is. Scopes what it is allowed to be about. */
  ownerAgent: agentIdSchema,

  /** What it is about. Checked against the owner's permitted domain, below. */
  subjectReferences: z.array(entityReferenceSchema).min(1).max(MAX_MEMORY_SUBJECTS),

  /**
   * The canonical events this was derived from. **Non-empty, always.**
   *
   * This is the field that makes `rebuildable: true` mean something. A memory record
   * that cannot name the events it came from cannot be rebuilt from them — so it is not
   * derived, it is *invented*, and an invented memory is a fact the system made up about
   * a real client.
   */
  sourceEventIds: z.array(eventIdSchema).min(1).max(MAX_MEMORY_SOURCE_EVENTS),

  /** The conclusion, for a human to read. Not the reasoning that produced it. */
  derivedSummary: boundedText(TEXT_LIMITS.summary),
  derivedSignals: derivedSignalsSchema.optional(),

  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
  /** Optional. Memory that goes stale should say when. */
  expiresAt: utcTimestampSchema.optional(),

  policy: policyReferenceSchema,
  dataClassification: dataClassificationSchema,

  /** Literal `true`. Memory that cannot be rebuilt has become a database of record. */
  rebuildable: z.literal(true),
  /** Literal `false`. Core wins, always. There is no field in which to claim otherwise. */
  authoritative: z.literal(false),

  /** Mandatory, so an un-propagated deletion is detectable rather than invisible. */
  erasureState: erasureStateSchema,

  reasonCode: reasonCodeSchema,

  correlationId: correlationIdSchema,
});

export const agentMemoryRecordV1Schema = agentMemoryShapeSchema.superRefine((value, ctx) => {
  if (!isAtOrBefore(value.createdAt, value.updatedAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'updatedAt must not precede createdAt',
    });
  }

  if (value.expiresAt !== undefined && !isStrictlyBefore(value.createdAt, value.expiresAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiresAt must be strictly after createdAt',
    });
  }

  // Memory isolation. An agent remembering something outside its domain is the first
  // step by which a bounded specialist stops being bounded.
  const permitted = MEMORY_SUBJECT_OWNERSHIP[value.ownerAgent];

  value.subjectReferences.forEach((subject, index) => {
    if (!permitted.includes(subject.entityType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectReferences', index, 'entityType'],
        message: `Agent "${value.ownerAgent}" may not hold memory about a "${subject.entityType}". Its permitted subjects are: ${permitted.join(', ')}. A specialist that notices something outside its domain raises a signal; it does not remember it`,
      });
    }
  });
});

export type AgentMemoryRecordV1 = z.infer<typeof agentMemoryRecordV1Schema>;
