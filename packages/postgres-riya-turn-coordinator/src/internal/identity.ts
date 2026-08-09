/**
 * The two NON-CONTENT digests a claim is identified by (RWC-P8, ADR-0104).
 *
 * ### What is hashed, and — much more importantly — what is not
 *
 * Neither preimage contains a single word the client wrote. `normalizedText` is not a parameter of
 * either function, so it cannot be included by accident.
 *
 * That is a deliberate privacy position rather than an oversight. A SHA-256 of a message is still a
 * durable fingerprint of what a person said: it identifies the sentence, survives deletion of the
 * sentence, and answers "did this person write exactly this?" for anyone holding a guess. A ledger
 * built to stop duplicate work has no business being able to answer that.
 *
 * ### The consequence, stated plainly
 *
 * Because the text is not part of the identity, reusing the same logical identifiers with DIFFERENT
 * words is a REPLAY, and the new words are never processed. That is the fail-closed direction: the
 * alternative is one logical message producing two different Riya turns. A caller with new words has
 * a correct move available — mint a new `messageId` and a new `channelTurnRef` — and the contract
 * says so.
 *
 * ### Why the source digest is channel-scoped
 *
 * `channelTurnRef` is opaque and per-channel. The same string can legitimately be a web turn
 * reference on one surface and a provider message reference on another, and treating those as the
 * same source turn would let a WhatsApp delivery suppress an unrelated web turn.
 *
 * ### Excluded from BOTH preimages
 *
 * No `requestId` (transport identity, and a fresh one per retry is the whole reason this layer
 * exists), no `issuedAt`, no continuity revision, no availability snapshot or taxonomy version, no
 * model, prompt or provider, no reply, no Core decision, no clock reading and no nonce. Every one of
 * them varies between two attempts at the SAME message, and any of them would make a retry look new.
 *
 * Neither preimage is logged, stored or returned.
 */
import { createHash } from 'node:crypto';

const sha256Hex = (preimage: string): string =>
  createHash('sha256').update(preimage, 'utf8').digest('hex');

/** SHA-256 over `[1, channel, channelTurnRef]`. The channel-scoped SOURCE identity of one turn. */
export function sourceTurnDigest(input: {
  readonly channel: string;
  readonly channelTurnRef: string;
}): string {
  return sha256Hex(JSON.stringify([1, input.channel, input.channelTurnRef]));
}

/**
 * SHA-256 over the full immutable claim identity.
 *
 * Its job is to catch a caller reusing a message id while changing something that must not change:
 * a later `receivedAt`, an upgraded data class, a different subject. Each is a DIFFERENT turn wearing
 * an existing claim's key, and each must be a refusal rather than a silent acceptance.
 */
export function turnIdentityDigest(input: {
  readonly channel: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly receivedAt: string;
  readonly sourceTurnDigest: string;
  readonly dataClass: string;
  readonly subjectRef?: string;
}): string {
  return sha256Hex(
    JSON.stringify([
      1,
      input.channel,
      input.tenantId,
      input.conversationId,
      input.messageId,
      input.receivedAt,
      input.sourceTurnDigest,
      input.dataClass,
      input.subjectRef ?? null,
    ]),
  );
}

/**
 * The PostgreSQL advisory-lock key for one conversation.
 *
 * SHA-256 over `[tenantId, conversationId]`, first eight bytes read as a signed big-endian int64 —
 * which is exactly the domain `pg_try_advisory_lock(bigint)` accepts.
 *
 * A hash collision is survivable and is worth saying why: two unrelated conversations would
 * OVER-SERIALIZE, taking turns instead of running concurrently. They could never read each other's
 * data, because every ledger statement is additionally scoped by the real tenant and conversation
 * columns. Slower is a cost; mixed conversations would be a defect, and this shape cannot produce one.
 */
export function conversationLockKey(input: {
  readonly tenantId: string;
  readonly conversationId: string;
}): bigint {
  const digest = createHash('sha256')
    .update(JSON.stringify([input.tenantId, input.conversationId]), 'utf8')
    .digest();
  return digest.readBigInt64BE(0);
}
