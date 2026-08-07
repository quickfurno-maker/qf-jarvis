# ADR-0095 — RWC-P2B: durable PostgreSQL Riya conversation continuity

**Status.** Accepted (repository). **Merged** as PR #100 — reviewed head
`fb2f09da9df2dfcd0c6035b15e2939ae4867353e`, merge commit
`596a768fa9de53cddb3831ebfe5094bba4bbada9`. Composed into nothing: the store is an adapter for a
port RWC-P2C declared, and no application constructs it. (Status corrected under RWC-P2D; the
technical decisions below are unchanged.)

**Baseline.** RWC-P2C merged as PR #99 — reviewed head `127d89f965a3dcfa3745608390618d7b86b50dfd`,
merge commit `9b5c0d586b5a535f57f0052f2960e5fd1e3755d6`, over base
`beed86c57a1d8bd2d56d0b826eb0bef5009373ed`. This ADR begins from that mainline.

**Supersedes nothing.** It executes a verdict ADR-0094 already recorded:
`P2B_SCHEMA_VERDICT = SCHEMA_REQUIRED`.

**Owner correction.** A first implementation of this slice normalized the domain envelope into
per-field columns (`version`, `phase`, `discovery`, `field_provenance`, `summary_confirmed`,
`completion_evidence_ref`). That diverged from the owner-locked storage shape. An owner-correction
commit realigns the schema to a **single validated `state_json` JSONB envelope** plus the two
first-class relational columns the database must be the authority for — the tenant+conversation key and
the `continuity_revision` the compare-and-set binds on — and adds an explicit persistence codec and a
storage-level update-invariant trigger. A second, smaller owner-correction commit then closes one
remaining contract regression: `createInitialIfAbsent` now accepts **only** a revision-0 state, and the
guard trigger enforces born-at-zero on INSERT (§5, §8a). The sections below describe the corrected
design; where a choice changed from the first implementation, it says so.

## Context

RWC-P2A (ADR-0093) defined `RiyaConversationContinuityStateV1`. RWC-P2C (ADR-0094) declared
`RiyaContinuityStorePort` and deliberately shipped **no implementation** — the port existed so that
three durable requirements would be visible before any schema was written: a tenant-scoped key, an
atomic create-if-absent, and a compare-and-set. The only available store was a test-only in-memory
fake, excluded from the emitting build, which passes every test and loses every conversation on
restart.

This ADR supplies the missing durability and nothing else.

## Decision

### 1. Schema required, and exactly one table — a JSONB envelope with two first-class columns

Migration **0011** creates `qf_jarvis.riya_conversation_continuity`: one row per
`(tenant_id, conversation_id)`, with columns `tenant_id`, `conversation_id`, `continuity_revision`,
`state_json`, `created_at` and `updated_at`.

The domain state is kept as **one validated JSONB envelope**, `state_json`, and is deliberately **not**
normalized into a column per conversational field. Only the two things PostgreSQL must be the authority
for are lifted out as first-class relational columns: the tenant+conversation **key**, and the
`continuity_revision` the **compare-and-set predicate binds on**. Everything else — version, phase, the
ADR-0067 discovery snapshot, per-field provenance, summary confirmation, completion evidence — lives
inside `state_json`. This insulates the schema from conversational field growth: an eighth discovery
field is an ADR-0067 change, not an `ALTER TABLE` here, and there is exactly one serialization of the
domain rather than two that could drift.

`created_at` and `updated_at` are `TIMESTAMPTZ` stamped by the database (`clock_timestamp()`
defaults). They are operational metadata: neither is a business time, and neither versions the state —
`continuity_revision` alone does. `created_at` never changes; `updated_at` moves on every accepted
compare-and-set. (The first implementation carried no timestamps; the corrected shape adds them
because `updated_at` is the operational signal a JSONB-envelope row cannot otherwise expose.)

### 2. The key is `(tenantId, conversationId)`, and there is no conversation-only uniqueness

`PRIMARY KEY (tenant_id, conversation_id)`. ADR-0076 §3 removed the global-uniqueness assumption for
`conversationId`, so a unique index on the conversation alone would merge two tenants' conversations
into one row. There is deliberately none, an integration test asserts that no index of that shape
exists under **any** name, and every statement in the adapter keys on both parts.

### 3. `continuityRevision` is independent of the conversation-control revision

0008's `conversation_runtime_state.revision` versions runtime-safety control state and advances by
exactly one on every update, enforced by a trigger. `continuity_revision` versions the conversational
working state. They advance at different times for different reasons, and a single shared counter
would make a continuity write appear to an M1–M4 control gate as a control change.

### 4. This table is working state, not memory and not business truth

Not ADR-0016 agent memory: that contract governs derived, rebuildable, `authoritative: false`
records with non-empty `sourceEventIds`, shared **across** conversations. None of its literals appear
here. Not a transcript: no message history, recent turns, rolling summary or context window. Not
business truth: consent, opt-out, suppression, contact identity, city validity, vendor availability,
pricing, packages, lead creation and business `canSubmit` belong to QuickFurno Core, and no column
here could express one. No channel column — WEB and WhatsApp are the same governed Riya (ADR-0092).

### 5. Create-if-absent is arbitrated by the database, in two statements

**A continuity row is born at revision 0.** `createInitialIfAbsent` is INITIAL persistence, so the
adapter refuses a state whose `continuityRevision` is not `0` **before any connection is taken** — a
state already at revision 1, 2, … was reached by continuity mutations that never durably happened, and
admitting it would file a mid-conversation state as if it were a first turn. Every later revision is
reached ONLY through an exactly-`+1` `compareAndSet`. The database holds the same invariant
independently: the guard trigger's INSERT branch (§8a) requires `continuity_revision = 0`, so a direct
SQL insert at a nonzero revision is refused too. (This closes a regression in the first implementation,
which validated the state structurally but accepted a nonzero initial revision, and whose trigger
explicitly permitted an INSERT at any revision.)

1. `INSERT … ON CONFLICT (tenant_id, conversation_id) DO NOTHING RETURNING …`. The primary key
   decides the race; the process never does. A returned row is `CREATED`, already committed, so the
   answer is durable at the instant it is given.
2. Zero rows means a durable row won. The loser then reads it in a **new statement**.

**Why the loser's read must be a separate statement.** `INSERT … ON CONFLICT DO NOTHING` may WAIT on
a concurrent session's uncommitted conflicting row; when that session commits, the insert does
nothing — but the statement's snapshot was taken _before_ the wait, so a sibling `SELECT` branch of
the same statement is not guaranteed to see the row that just beat it. A one-CTE implementation would
therefore read "nothing is there" in the ordinary case of losing a race, and both answers available
from there are wrong: report `CREATED` for a conversation it did not create, or invent an initial
state that is not the durable one. A second statement under READ COMMITTED sees the committed winner.

**The loser returns the WINNER's state, never its own candidate — even when the two are equivalent.**
Returning the candidate would assert something the call cannot know: that what is durable matches
what was offered. Only the row proves that.

If the insert lost but the follow-up read finds no winner, that is `repository-invariant`. It is
**not** turned into `CREATED` and it is not retried: the table is never deleted from, and the adapter
holds no DELETE privilege, so a missing winner means the store's assumptions about the database are
wrong.

No pre-read-then-insert, no process mutex, no advisory lock, no retry loop, and no `SERIALIZABLE` —
which would create a retry obligation this boundary must not have.

### 6. Compare-and-set has exactly three outcomes

`UPDATED`, `REVISION_CONFLICT`, `NOT_FOUND` — the port's closed set. One `UPDATE … WHERE tenant_id =
$1 AND conversation_id = $2 AND continuity_revision = $9`; the predicate **is** the concurrency
control. Zero rows updated is then split by a separate existence read: no row → `NOT_FOUND`, a row →
`REVISION_CONFLICT`.

A conflict repairs nothing, merges nothing, chooses no provenance winner, retries nothing and does
not touch the stored row. Deciding what a conflicting update "meant" is RWC-P4's question.

**One mutation is one revision.** A compare-and-set is refused unless
`nextState.continuityRevision === expectedRevision + 1`, checked before any SQL runs. The adapter does
**not** fabricate the stored revision — what is written is the caller's `nextState` value — but it does
**validate** the one-step relationship, because a next state that skips, repeats or decrements a
revision is a caller defect (a lost step or a replay), not a legitimate continuity mutation. The
database holds the same rule independently: the BEFORE UPDATE trigger (§8a) requires
`continuity_revision = OLD + 1`, and the `state_revision_matches` CHECK pins the envelope revision to
the column, so a skipped revision is impossible from any writer.

_(Corrected from the first implementation, which stored an arbitrary next revision verbatim and
asserted a "jump" was allowed. The owner correction makes the exact one-step advance the contract.)_

### 7. Canonical validation on every boundary crossing, in both directions

Every state written is re-proved through `createRiyaConversationContinuityState` before any SQL runs;
every row read is rebuilt into a P2A input and passed through the **same** constructor before it
leaves the adapter. Nothing returns a raw row or raw JSON.

Reading matters as much as writing, because the database deliberately does **not** restate the
NeedDiscovery rules, the provenance/value pairing or the summary-readiness rule (§8). A partially
applied migration, a restore from an older dump or a hand-corrected row all arrive looking exactly
like data. A row that cannot pass the contract is a **refusal** — `repository-invariant` — never a
default, a repair, a partial result or a delete.

**Why a codec, not `JSON.stringify(state)`.** A constructed `NeedDiscovery` carries
`behaviourVersion: 1` and an explicit `undefined` for every value not discovered, and
`NeedDiscoveryInput` is `.strict()` and declares no `behaviourVersion` — so the **output** of the P2A
constructor is **not** a valid **input** to it. A naive `JSON.stringify(state)` persistence contract
would therefore produce durable rows that no later read could re-validate. The adapter owns an explicit
persistence codec (`internal/codec.ts`): `encodeContinuityState` projects a canonical state back to the
input shape the contract accepts — dropping `behaviourVersion` and every `undefined`-valued key, while
copying every _other_ key verbatim so an invented property is still refused by `.strict()` rather than
laundered — and `decodeContinuityState` rebuilds a canonical state by passing the stored envelope
through the same `createRiyaConversationContinuityState`, then cross-checks that the envelope's
identity and revision agree with the key columns. The codec changes SHAPE (output projection → input
projection), never CONTENT; P2A and `NeedDiscovery` are unchanged, and no rule is weakened to make
persistence simpler. This is the corrected design: the domain lives in one `state_json` envelope, and
the codec — not the column layout — reconciles it with the constructor's input/output asymmetry.

### 8. What the SQL constraints do, and everything they deliberately omit

The CHECKs validate the **envelope against its key columns** and nothing more: `state_json` is an
object; its `version` is the number `1`; its `tenantId`, `conversationId` and `continuityRevision`
equal the `tenant_id`, `conversation_id` and `continuity_revision` columns those values are indexed and
compared on (the revision guarded by a grammar check before the numeric cast, so a `1.5` or `1e0` is
refused rather than coerced). The first-class columns additionally carry the identifier grammar
(mirroring P2A exactly, including **not** copying 0008's `latest` exclusion, which would make the
database stricter than the contract) and the revision safe-integer bound.

Every **domain** rule is deliberately absent from SQL: the nine-phase vocabulary, the provenance/value
pairing, the `summaryConfirmed` phase relation, the summary-readiness rule and complete-iff-evidence
are all held by the constructor on every read and every write, never restated in SQL. Restating any of
them means reaching into the JSON and copying a rule that would then drift from ADR-0067/ADR-0093 in the
one place nobody reads when those change. Integration tests prove that a row violating each such rule
inserts cleanly (the DB does not stop it) and is refused on the way **out** as `repository-invariant`.

_(Corrected from the first implementation, which lifted `phase`, `summary_confirmed` and
`completion_evidence_ref` into columns and expressed the phase, summary and complete-iff-evidence rules
as SQL CHECKs. Those rules now live only in the constructor; the SQL constrains only the envelope↔column
agreement.)_

### 8a. A storage-level birth-and-update invariant, in addition to the adapter's

A BEFORE INSERT OR UPDATE trigger on the table enforces, on INSERT, that a row is **born at revision
0**; and on UPDATE, that the identity (`tenant_id`/`conversation_id`) is unchanged, that an
already-exhausted revision is not advanced, and that `continuity_revision` advances by **exactly one**.
This is defense in depth for the adapter's own create and compare-and-set: a migration, a console
session or a future second writer is a caller the adapter cannot police, and the trigger makes
born-at-zero, one-step-revision and immutable-identity hold against direct SQL too. Integration tests
drive direct SQL as the owning role to prove a nonzero-revision INSERT, a jump, a same-revision update
and an identity mutation are each rejected, and that a revision-0 INSERT is accepted. _(The update
rules and the trigger arrived in the storage-shape correction; the born-at-zero INSERT rule is the
final correction — the first implementation's trigger explicitly permitted an INSERT at any revision.)_

### 9. Least privilege, and no retention decision

`REVOKE ALL` from PUBLIC and from `anon`/`authenticated`/`service_role`. The conditional
`qf_jarvis_runtime` grant is `SELECT, INSERT` plus **column-scoped** `UPDATE` on exactly the three
columns a compare-and-set replaces — `continuity_revision`, `state_json`, `updated_at`. `tenant_id`,
`conversation_id` and `created_at` are outside the grant, so identity and creation time are immutable as
a **privilege** as well as by the §8a trigger — two independent guards. **No DELETE, no TRUNCATE**, no
deletion trigger and no retention policy: privacy and retention are not RWC-P2B's decision, and a
package that quietly implemented one would be making it.

### 10. Injected pool, local/CI only, composed into nothing

The adapter takes a `pg` Pool and nothing else — no connection string, host, credential or
environment name. Importing it connects nowhere, creates no pool, reads no environment and starts
nothing; the caller owns the pool's lifecycle.

Migration 0011 is **LOCAL/CI ONLY**. The managed QF-Jarvis database was not accessed by this phase
and its state is unchanged.

Nothing in the repository imports this package, and a containment test asserts it. RWC-P2C still
requires an injected store. There is no HTTP, endpoint, ingress, browser reachability, session,
cookie, CSRF, rate limiter, CORS or streaming.

## Consequences

Continuity survives a restart, and two processes compare revisions through the database rather than
through one process's memory. Twenty simultaneous first turns produce exactly one row and one
`CREATED`, and all twenty callers hold the same authoritative state.

The **private ingress adapter** remains the next slice after this one is reviewed and merged. It owns
what §2a of ADR-0094 requires: deriving or assigning `RuntimeDataClass` under governed server-side
policy, and never forwarding a browser-supplied classification. **RWC-P4** still owns continuity
evolution — phase transition, extraction and provenance merge — none of which exists here.

RUI-3A has not started. Live public Riya remains OFF.

## What would require a superseding ADR

Adding a conversation-only unique index · splitting the `state_json` envelope back into per-field
columns · storing a transcript, rolling summary, channel, contact detail or any Core-authority field ·
returning a raw row · letting database uncertainty become `undefined`, `CREATED`, `EXISTING`,
`REVISION_CONFLICT` or `NOT_FOUND` · a create loser returning its own candidate · repairing, merging or
retrying a revision conflict · fabricating the next revision in storage rather than validating the
caller's one-step advance · accepting a create at a nonzero revision or removing the born-at-zero
INSERT rule · relaxing the exactly-`+1` revision rule or removing the §8a guard trigger ·
restating any domain rule (phase, provenance, summary-readiness, complete-iff-evidence) as a SQL
constraint · granting DELETE or TRUNCATE · introducing a retention or erasure policy · composing this
adapter into an application, an endpoint or an ingress · applying 0011 to the managed database.
