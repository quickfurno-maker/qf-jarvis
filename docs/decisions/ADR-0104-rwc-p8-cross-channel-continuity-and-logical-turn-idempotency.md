# ADR-0104 — RWC-P8: cross-channel continuity and durable logical-turn idempotency

- **Status:** Accepted — RWC-P8 implementation on branch, NOT MERGED
- **Date:** 2026-08-09
- **Depends on:** ADR-0092 (governed web runtime channel), ADR-0093/0095 (continuity contract and its
  durable store), ADR-0094 (the private conversation service), ADR-0097 (private ingress and its
  replay guard), ADR-0098/0099 (RWC-P4A/P4B), ADR-0100 (RWC-P5), ADR-0101/0102 (RWC-P6),
  ADR-0103 (RWC-P7)
- **Baseline:** RWC-P7 merged as PR #108 — merge commit
  `0a24b9530e6dbf119f58ec2cf502162440c9de66`.

RWC-P8 is an INTERNAL Riya customer-journey slice. It is **not** canonical QFJ-P08, which remains
Consent, Approval and Human Control.

## Context

Two problems, and they turn out to have one shape.

**A conversation should survive a change of surface.** A client starts in a browser and continues on
WhatsApp. Today that is two conversations, because nothing links them.

**A logical message must run once.** ADR-0097's ingress replay guard is keyed on
`(caller, requestId)`, protects one signed request inside its freshness window, and is process-local.
All three properties are correct for what it does and none of them is what a conversation needs: a
trusted caller can re-sign the SAME logical message under a fresh `requestId` — a retry after a
timeout, a queue redelivery, a second replica picking up the work — and every transport guard in the
deployment would correctly let it through. Riya would run a second model turn, take a second Core
decision, and possibly create a second enquiry about one sentence.

The shape both share is: **what is the canonical identity of this conversation, and of this message?**
RWC-P8 answers both, and refuses to guess either.

## Decision

### 1. Cross-channel continuity comes from the CALLER, and from nothing else

There is one Riya brain and one continuity row. A conversation is continuous across channels when —
and only when — the trusted caller supplies the same canonical `(tenantId, conversationId)`.

Jarvis does **not** infer linkage from a phone number, an email, a cookie, a session, a provider or
WhatsApp id, a model's reading of the text, or timing. **`subjectRef` is NOT a linking key.**

This is the most important restraint in the slice. Identity resolution is genuinely hard, it belongs
to the final QuickFurno handshake, and a wrong guess here would attach one person's project to another
person's chat — a failure that would look like a working feature right up until it was catastrophic.
Consuming a canonical identity somebody else is accountable for is the only safe version of this.

### 2. One channel-neutral turn, and the existing WEB contract is untouched

`RiyaConversationTurnV1` carries `channel: 'WEB' | 'WHATSAPP'` and `channelTurnRef`.
`RiyaWebConversationTurnV1` keeps its exact shape and its `webTurnRef`; `handleTurn` becomes a thin
wrapper that fixes `channel: 'WEB'` and maps the reference. The private wire gains no `channel` field.

**One factory, one processor.** `createRiyaWebConversationService` now returns a subtype with
`handleChannelTurn` beside `handleTurn`. A second factory would be a second Riya with extra steps, and
a per-channel reducer, prompt or memory is exactly what ADR-0092 refused.

`INTERNAL` is not representable. Only CLIENT inbound turns exist here.

### 3. Continuity V1 stays channel-free

No `channel`, `lastChannel`, `channelHistory`, `webTurnRef`, `whatsappRef`, `messageId`, provider id,
phone or link map. Migration 0011 is unchanged, byte for byte. A channel in the continuity row would
be the beginning of a second Riya; the CLAIM ledger is a different table for a different question.

### 4. Transport identity and logical identity are different layers, and both stay

`requestId` is transport identity. Logical identity is `messageId` plus the channel-scoped source
identity, within a tenant and conversation. The ingress replay guard remains defence in depth and is
unchanged; RWC-P8 sits beneath it and catches what it structurally cannot.

### 5. Immutable message identity, and the privacy decision that follows

For a retry of the same logical message the caller MUST preserve `tenantId`, `conversationId`,
`messageId`, `channel`, `channelTurnRef`, `receivedAt`, `dataClass` and the presence and value of
`subjectRef`. New or corrected words require a NEW `messageId` **and** a NEW `channelTurnRef`.

**Jarvis stores no client prose and no fingerprint of it.** No `normalized_text`, no transcript, no
reply — and no SHA-256 of any of them. A hash of a message is still a durable fingerprint of what a
person wrote: it identifies the sentence, survives deletion of the sentence, and answers "did this
person say exactly this?" for anyone holding a guess. A ledger built to stop duplicate work has no
business being able to answer that.

The consequence is deliberate and fail-closed: **reusing the same identifiers with different words is
a REPLAY, and the changed text is never processed.** The alternative is one logical message producing
two different Riya turns. A caller with new words has a correct move available, and the contract says
what it is.

### 6. Two non-content digests

```
sourceTurnDigest   = SHA-256( JSON.stringify([1, channel, channelTurnRef]) )
turnIdentityDigest = SHA-256( JSON.stringify([1, channel, tenantId, conversationId, messageId,
                                              receivedAt, sourceTurnDigest, dataClass,
                                              subjectRef ?? null]) )
```

Lowercase 64 hex. Excluded from both: `normalizedText`, `requestId`, `issuedAt`, the continuity
revision, the availability snapshot and taxonomy version, model, prompt and provider, the reply, the
Core decision, any clock reading and any nonce. Every one of them varies between two attempts at the
SAME message, and any of them would make a retry look new. Neither preimage is logged, stored or
returned.

The source digest is channel-scoped because the same opaque string can legitimately be a web turn
reference on one surface and a provider message reference on another.

### 7. Migration 0012 — one table, and it is not a transcript

`qf_jarvis.riya_logical_turn_claims`, keyed `(tenant_id, conversation_id, message_id)`, with source
uniqueness scoped to `(tenant_id, conversation_id, source_turn_digest)`. Channels `WEB | WHATSAPP`;
states `PROCESSING | COMPLETED | INDETERMINATE`.

No column for message text or its digest, a reply, `channel_turn_ref`, `provider_message_ref`,
`subject_ref`, contact detail, continuity, consent, lead, vendor, price, model, prompt, `request_id`,
`issued_at`, a signature or a token. A trigger enforces born-`PROCESSING`, immutable identity and
**terminal is terminal** — a re-opened claim would turn this table from a safety mechanism into a
duplicate-turn generator. The runtime role gets `SELECT`, `INSERT` and `UPDATE` on the two
finalization columns only: **no `DELETE`, no `TRUNCATE`**, and no retention sweeper in this slice,
because a deletable claim is a re-runnable message.

Repository and LOCAL/CI only. Nothing is applied to a managed database.

### 8. A session advisory lock, and no transaction across the model

One TEXT turn per `(tenantId, conversationId)`, enforced by `pg_try_advisory_lock` on a key derived
`SHA-256([tenantId, conversationId])`, first eight bytes as a signed big-endian int64.
**Non-blocking**: a wait would queue a client's turn behind another for an unbounded time, and the
honest answer to "somebody else is mid-turn" is BUSY now.

A hash collision would OVER-SERIALIZE two unrelated conversations — slower, never mixed, because every
ledger statement is additionally scoped by the real tenant and conversation columns.

The lease owns ONE dedicated `PoolClient` for its whole life, so the lock and the statements that rely
on it cannot land on different connections. There is **no** `BEGIN`, `SERIALIZABLE` or
`SELECT ... FOR UPDATE` held across an inference: idle-in-transaction for the length of a model call
is how a Postgres deployment falls over under load, and a session lock gives the same exclusion with
none of it. The database releases it when the session ends — the behaviour a crashed replica needs.

**Unlock safety.** Every exit calls `pg_advisory_unlock` and requires `true`. If the unlock throws,
returns `false`, or could not be attempted, the physical connection is DESTROYED rather than returned
to the pool. A leaked session lock on a reused connection would block an unrelated conversation
forever with nothing in the application to explain why. One reconnect is cheap; a conversation is not.

### 9. Two stages, and the gap between them is the point

`begin` acquires and classifies but writes NOTHING. A turn can still fail its continuity load or its
availability read afterwards, and those failures happen before any model, Core call or write — so they
must leave the message RETRYABLE. A row written at `begin` would mark a message spent that never ran.

`startProcessing` inserts the durable claim IMMEDIATELY before the runtime. Everything after it is
potentially spent and is never re-run automatically.

The exact order: validate → `begin` → load or create continuity → identity re-proof → ONE availability
read → (safe failure ⇒ `releaseUnstarted`, no row) → envelope → `startProcessing` → ONE runtime method
by phase → RWC-P4B compare-and-set if pre-summary → build result → `complete` → **then** return.

`complete` before the return, not after: a finalization lost after the caller already held the reply
would leave the ledger saying `PROCESSING` while a client had the answer, and the retry would be
classified as recoverable rather than spent.

### 10. Classification under the lock

No row → `ACQUIRED`, unstarted, no insert. Same message and source and identity → `COMPLETED` is
`REPLAYED`, `INDETERMINATE` is `INDETERMINATE`. Same message with a different source, a different
identity digest or a different channel → `CONFLICT`. Same source under a different message id →
`CONFLICT`. Contradictory rows → fail closed as a repository invariant.

**And the central crash rule.** A `PROCESSING` row found by a caller that HOLDS the conversation lock
means the previous processor does not hold it, so it is gone. We cannot know whether it reached a
model, a Core decision or a durable write. The claim is marked `INDETERMINATE` once, and that message
is never run again automatically. Deliberately unhelpful, and deliberately safe: the alternative is
re-running a message that may already have created a real enquiry about somebody's home.

### 11. Counts, and zero downstream work on a refusal

One `begin` per turn. `BUSY`, `REPLAYED`, `CONFLICT` and `INDETERMINATE` each cost **zero** continuity
reads, zero availability reads, zero runtime, model, Core and compare-and-set. An acquired turn that
fails its preflight performs zero `startProcessing` and one `releaseUnstarted`. A started turn
performs at most one `startProcessing`, one runtime call, one model call, and one of `complete` or
`indeterminate`. There is no automatic retry anywhere in the service.

### 12. No reply cache, and no cached text on a replay

The ledger stores no model output. A `REPLAYED` turn returns a bounded service error and no text:
fabricating one would make a replay indistinguishable from a fresh answer to the client receiving it.

### 13. RWC-P4B, P5, P6 and P7 are unchanged

The P4B compare-and-set and its bounded reconciliation stay, even though text turns are now
serialized — RWC-P6's structured actions and any future writer can still race. Stale-reply suppression
stays. RWC-P5's one availability read per turn stays. RWC-P7's post-summary reply-only path still
performs zero observations and zero continuity compare-and-set; finalizing a claim is not a continuity
mutation. Semantic RAG stays off.

### 14. No live WhatsApp, and no QuickFurno repository

No webhook, Meta client, token, phone number, provider SDK, n8n, outbound send, template or media
handling, public route or delivery status. A WhatsApp channel turn may produce an `authorizedReply` as
an application capability; RWC-P8 sends nothing and records no delivery. A future trusted adapter
calls the channel-neutral service added here.

The private ingress production code is unchanged and stays **OFF / NOT DEPLOYED**.

## Consequences

- WEB and WHATSAPP are two surfaces of one Riya, with one continuity row and no channel-specific
  behaviour anywhere.
- Two text turns for one conversation cannot run concurrently, across replicas.
- One logical inbound message cannot trigger a second Riya turn after it is spent, whatever the
  transport did.
- Crash ambiguity fails closed rather than re-running.
- No client text, and no fingerprint of client text, becomes durable idempotency data.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- cross-channel linkage is the caller's canonical `(tenantId, conversationId)` ONLY; Jarvis infers
  nothing, and `subjectRef` is not a linking key;
- continuity V1 stays channel-free, and migration 0011 stays byte-identical;
- no message text and no digest of message text is ever durable;
- the raw `channelTurnRef` is never persisted;
- the transport replay guard and the logical-turn ledger are SEPARATE layers, and both stay;
- one session advisory lock per conversation, on a dedicated client, with no transaction across the
  model call, and an uncertain unlock destroys the session;
- a claim is written at `startProcessing` and never at `begin`;
- `complete` runs before the result and the body leave the service;
- an orphaned `PROCESSING` claim becomes `INDETERMINATE` and never re-runs;
- there is no automatic retry, no reply cache and no claim deletion;
- migration 0012 is repository and LOCAL/CI only.
