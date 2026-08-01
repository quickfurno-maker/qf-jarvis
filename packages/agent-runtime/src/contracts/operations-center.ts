/**
 * The Conversation Operations Center projection contract (QFJ-M1, ADR-0054 §L; QFJ-P08-A, ADR-0075).
 *
 * The safe, content-free projection fields an operator surface may see. ADR-0054 documented them as a
 * shape with no constructor and no producer; ADR-0075 adds the constructor, because QFJ-P08-A gives
 * the Jarvis composition root a query method that must produce a VALIDATED snapshot rather than an
 * object literal a caller assembled by hand.
 *
 * There is still no dashboard, no persistence and no message content here. QuickFurno Core owns the
 * authoritative conversation record; this is a read projection of safe tokens.
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import {
  CONVERSATION_STATES,
  RUNTIME_ACTORS,
  RUNTIME_PARTY_TYPES,
  type ConversationState,
  type RuntimeActor,
  type RuntimePartyType,
} from './vocabularies.js';

/**
 * The closed list of safe projection fields the operations center surfaces.
 *
 * `revision` was added by QFJ-P08-A (ADR-0075). Without it the query an operator SEES and the command
 * an operator ISSUES would not share a concurrency token: every control command carries an
 * `expectedRevision`, so a snapshot that omitted the revision would force an operator surface either
 * to perform an invisible second read — racing the one it just did — or to submit an unbound
 * mutation. Both defeat the point of `expectedRevision`, so the revision travels with the projection.
 */
export const CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS = [
  'conversationId',
  'revision',
  'assignedActor',
  'partyType',
  'conversationState',
  'lastActivityAt',
  'aiPaused',
  'humanTakeover',
  'escalationStatus',
  'followUpStatus',
  'deliveryStatePlaceholder',
  'auditRef',
] as const;
export type ConversationOperationsSnapshotField =
  (typeof CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS)[number];

/** A content-free operations-center snapshot. */
export interface ConversationOperationsSnapshot {
  readonly conversationId: string;
  /** The authoritative control revision. Pairs with a control command's `expectedRevision`. */
  readonly revision: number;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly conversationState: ConversationState;
  readonly lastActivityAt: string;
  readonly aiPaused: boolean;
  readonly humanTakeover: boolean;
  /** A safe status token; never message content. */
  readonly escalationStatus: string;
  /** A safe status token; never message content. */
  readonly followUpStatus: string;
  /** A placeholder for a future delivery-state token; never message content. */
  readonly deliveryStatePlaceholder: string;
  /** An opaque audit reference; never message content, subject, or PII. */
  readonly auditRef: string;
}

/** What a caller supplies. Identical in shape — there is nothing to derive inside the constructor. */
export interface ConversationOperationsSnapshotInput {
  readonly conversationId: string;
  readonly revision: number;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly conversationState: ConversationState;
  readonly lastActivityAt: string;
  readonly aiPaused: boolean;
  readonly humanTakeover: boolean;
  readonly escalationStatus: string;
  readonly followUpStatus: string;
  readonly deliveryStatePlaceholder: string;
  readonly auditRef: string;
}

/**
 * A safe token: 1–128 chars from an exact grammar, with no whitespace.
 *
 * The status and audit fields are TOKENS, not prose. Free text is the one shape through which a
 * message body, a customer detail or an operator's speculation would enter a projection this contract
 * promises is content-free, so a value containing a space is rejected rather than truncated.
 */
const SAFE_TOKEN = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const snapshotInputSchema = z
  .object({
    conversationId: SAFE_TOKEN,
    revision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    assignedActor: z.enum(RUNTIME_ACTORS),
    partyType: z.enum(RUNTIME_PARTY_TYPES),
    conversationState: z.enum(CONVERSATION_STATES),
    // The EXISTING M1 canonical-instant contract, reused verbatim. ADR-0075 neither broadens nor
    // tightens the repository's instant grammar; a projection is not the place to redefine time.
    lastActivityAt: z.string().refine(isCanonicalInstant),
    aiPaused: z.boolean(),
    humanTakeover: z.boolean(),
    escalationStatus: SAFE_TOKEN,
    followUpStatus: SAFE_TOKEN,
    deliveryStatePlaceholder: SAFE_TOKEN,
    auditRef: SAFE_TOKEN,
  })
  .strict();

/** A plain, non-array object with no inherited enumerable payload. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Build a frozen, validated operations snapshot.
 *
 * Throws `AgentRuntimeError('invalid-context')` on any invalid or unknown field.
 *
 * The constructor DERIVES NOTHING. In particular it does not compute `assignedActor` from
 * `partyType`/`humanTakeover`: `assignAgent` is M1's sole assignment authority, and a second place
 * that could decide an actor would be a second router. The caller supplies the already-deterministic
 * result of that one function.
 *
 * Nothing is trimmed, normalized or repaired — a projection that quietly fixed its input would attest
 * to values its source never produced. The caller's object is neither mutated nor frozen.
 */
export function createConversationOperationsSnapshot(
  input: ConversationOperationsSnapshotInput,
): ConversationOperationsSnapshot {
  if (!isPlainRecord(input)) {
    throw new AgentRuntimeError('invalid-context');
  }
  const parsed = snapshotInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-context');
  }
  const data = parsed.data;
  return Object.freeze({
    conversationId: data.conversationId,
    revision: data.revision,
    assignedActor: data.assignedActor,
    partyType: data.partyType,
    conversationState: data.conversationState,
    lastActivityAt: data.lastActivityAt,
    aiPaused: data.aiPaused,
    humanTakeover: data.humanTakeover,
    escalationStatus: data.escalationStatus,
    followUpStatus: data.followUpStatus,
    deliveryStatePlaceholder: data.deliveryStatePlaceholder,
    auditRef: data.auditRef,
  });
}
