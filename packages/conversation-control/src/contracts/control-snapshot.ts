/**
 * The conversation control FRAGMENT (QFJ-P08-A, ADR-0074).
 *
 * Four fields, and deliberately not the five-more that `jarvis-runtime`'s `ConversationControlState`
 * carries. This is NOT a copy of that type and must not become one: `tenantId`, `partyType`,
 * `dataClass`, `cancelled`, `subjectStatus`, `subjectRef` and `observedAt` are read by the M1/M2/M3/M4
 * gates and are owned there. A second package that also declared them would be a second definition of
 * what a conversation is, and the two would drift the first time either changed.
 *
 * What this package needs is the smallest thing that makes the reducer total: which conversation,
 * which revision, and the two booleans an operator may move. Everything else would be carried
 * through untouched, which is a good sign it does not belong here.
 *
 * Content-free by construction. There is no message, no reply, no prompt, no subject, no PII, no
 * delivery state, no Core outcome, no approval, no consent and no business field — and no field in
 * which one could be smuggled, because unknown keys are rejected.
 */
import { z } from 'zod';

import { ConversationControlError } from './errors.js';
import { EXACT_IDENTIFIER, REVISION, isPlainRecord } from '../internal/grammar.js';

/** What a caller supplies. Identical in shape to the canonical form — there is nothing to derive. */
export interface ConversationControlSnapshotInput {
  readonly conversationId: string;
  readonly revision: number;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

/** One frozen, validated control fragment. */
export interface ConversationControlSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

const snapshotSchema = z
  .object({
    conversationId: EXACT_IDENTIFIER,
    revision: REVISION,
    humanTakeover: z.boolean(),
    aiPaused: z.boolean(),
  })
  .strict();

/** The exact own keys a materialized snapshot carries. Every one, and nothing else. */
export const MATERIALIZED_SNAPSHOT_KEYS = [
  'conversationId',
  'revision',
  'humanTakeover',
  'aiPaused',
] as const;

/**
 * Build a frozen, validated control fragment.
 *
 * Throws `ConversationControlError('invalid-state')` on any invalid or unknown field.
 *
 * `humanTakeover === true` with `aiPaused === false` is ACCEPTED as an input. It is not a state this
 * package's own reducer can produce — taking ownership always forces the pause — but the authoritative
 * source is owned elsewhere and may legitimately be mid-migration or hand-corrected. Refusing to read
 * a state the reducer can safely repair (a subsequent `TAKE_OWNERSHIP` sets the pause) would fail
 * closed in the direction of leaving AI running, which is the wrong direction.
 *
 * The caller's object is neither mutated nor frozen: a validator that froze its argument would change
 * a data structure the caller still owns, and callers hand these in from a read they may reuse.
 */
export function createConversationControlSnapshot(
  input: ConversationControlSnapshotInput,
): ConversationControlSnapshot {
  if (!isPlainRecord(input)) {
    throw new ConversationControlError('invalid-state');
  }
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConversationControlError('invalid-state');
  }
  const data = parsed.data;
  return Object.freeze({
    conversationId: data.conversationId,
    revision: data.revision,
    humanTakeover: data.humanTakeover,
    aiPaused: data.aiPaused,
  });
}

/**
 * Re-validate a value that CLAIMS to be a materialized snapshot, returning the canonical record.
 *
 * INTERNAL. The reducer calls this on its argument rather than trusting the type: `ConversationControlSnapshot`
 * is a structural interface, so an object literal satisfies it at compile time without ever having
 * passed the constructor. The canonical result is returned and used — validating and then operating on
 * the caller's object would leave the reducer reading a mutable value it does not own.
 */
export function revalidateSnapshot(value: unknown): ConversationControlSnapshot {
  if (!isPlainRecord(value)) {
    throw new ConversationControlError('invalid-state');
  }
  const keys = Object.keys(value).sort();
  const expected = [...MATERIALIZED_SNAPSHOT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ConversationControlError('invalid-state');
  }
  return createConversationControlSnapshot(value as unknown as ConversationControlSnapshotInput);
}
