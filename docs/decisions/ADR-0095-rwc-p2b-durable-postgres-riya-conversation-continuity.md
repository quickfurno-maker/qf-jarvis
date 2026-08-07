# ADR-0095 — RWC-P2B: durable PostgreSQL Riya conversation continuity

**Status.** Accepted (repository). Implemented on `rwc-p2b-postgres-riya-conversation-continuity-store`,
**not merged**, and composed into nothing.

**Baseline.** RWC-P2C merged as PR #99 — reviewed head `127d89f965a3dcfa3745608390618d7b86b50dfd`,
merge commit `9b5c0d586b5a535f57f0052f2960e5fd1e3755d6`, over base
`beed86c57a1d8bd2d56d0b826eb0bef5009373ed`. This ADR begins from that mainline.

**Supersedes nothing.** It executes a verdict ADR-0094 already recorded:
`P2B_SCHEMA_VERDICT = SCHEMA_REQUIRED`.

## Context

RWC-P2A (ADR-0093) defined `RiyaConversationContinuityStateV1`. RWC-P2C (ADR-0094) declared
`RiyaContinuityStorePort` and deliberately shipped **no implementation** — the port existed so that
three durable requirements would be visible before any schema was written: a tenant-scoped key, an
atomic create-if-absent, and a compare-and-set. The only available store was a test-only in-memory
fake, excluded from the emitting build, which passes every test and loses every conversation on
restart.

This ADR supplies the missing durability and nothing else.

## Decision

### 1. Schema required, and exactly one table

Migration **0011** creates `qf_jarvis.riya_conversation_continuity`: one row per
`(tenant_id, conversation_id)`, with `version`, `continuity_revision`, `phase`, `discovery`,
`field_provenance`, `summary_confirmed` and `completion_evidence_ref`. No operational timestamps —
the repository's durable-store convention (0008's state table) does not carry them, and adding a
column because it might be useful is how a working-state row becomes an audit record nobody designed.

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
here. Not business truth: consent, opt-out, suppression, contact identity, city validity, vendor
availability, pricing, packages, lead creation and business `canSubmit` belong to QuickFurno Core, and
no column here could express one. No channel column — WEB and WhatsApp are the same governed Riya
(ADR-0092).

**Content-minimised, not content-free — and the precise claim is the honest one.** The table stores no
transcript, raw message history, recent-turn history, rolling/conversation/memory summary, raw model
reply or draft, contact data, or independent free-text blob. It _does_ store the P2A/ADR-0067
structured `NeedDiscovery` snapshot, and that snapshot legitimately carries **bounded textual notes**:
`scopeSummary` (≤500 chars), `budgetNote` and `timelineNote` (≤120 each). An earlier draft of the
migration claimed "no free text at all"; that was untrue and contradicted its own next sentence, and
the wording has been corrected in both the migration and the table comment. A sweeping privacy claim
that a reader can falsify by opening the schema is worse than a narrow one they can rely on.

### 5. Create-if-absent is arbitrated by the database, in two statements

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

### 6a. The revision is born at 0 and advances by exactly one — and why that was a correction

The first implementation stored whatever `nextState.continuityRevision` it was handed, on the
reasoning that the port only required the stored revision to match and the in-memory fake did no
more. **That was wrong, and a technical review proved it against a real database:**

```
seeded at revision 5
writer1 CAS(expected=5, next.rev=5) -> UPDATED   state = city.pune
writer2 CAS(expected=5, next.rev=5) -> UPDATED   state = city.mumbai
LOST UPDATE: both writers won at the same revision
backwards CAS 5 -> 2                -> UPDATED   stored rev 2
```

A next revision equal to the expected one leaves the stored value unchanged, so a second writer still
holding it matches the predicate and wins too — both told `UPDATED`, the first writer's state
silently destroyed. Optimistic concurrency was not weakened; for that caller it was absent.

The justification also did not survive scrutiny. RWC-P2A calls this field a **monotonic**
compare-and-set counter, and the repository had already fixed what that phrase means: `agent-runtime`'s
orchestration contract records that a conversation revision's "domain is fixed by the durable schema
that owns it", 0008 implements exactly that for the sibling control counter, and the same note records
— from a real incident — that _"a fake is not evidence about a database."_ Deferring to the fake was
the precise reasoning the repository had already rejected.

**Owner ruling, locked:** a durable row is **born at `continuityRevision = 0`**, and every successful
replacement sets it to **exactly `expectedRevision + 1`**. Not merely greater-than: a gap would leave
the counter an arbitrary increasing tag whose jumps nobody can account for.

The adapter **verifies** this; it never fabricates a revision. A violation is **`invalid-input`,
refused before a connection is taken** — a malformed request is a caller defect, not a concurrency
answer, so it must never be reported as `REVISION_CONFLICT`. The CAS outcome vocabulary stays at
exactly three.

This does **not** collapse the two counters (§3). They remain different columns in different tables
with different ownership, advanced independently and never compared. They share only the CAS counter
semantics: initial 0, one accepted mutation = +1.

### 6b. The database owns the invariant, and the storage shape it owns it over

A guard function and a `BEFORE INSERT OR UPDATE` trigger hold the rule structurally: an INSERT must
be at revision 0; an UPDATE may not change the identity, may not advance an exhausted revision, and
must set exactly `OLD + 1`. It is **not** a reducer — it decides no phase transition, merges no
discovery or provenance, computes nothing and never rewrites `NEW` into compliance. It exists so the
property survives a future second adapter, a migration, or a console session, rather than resting on
one adapter's promise. The P2C store port now states both preconditions, and its test-only in-memory
fake enforces them, so the fake can no longer certify a caller the durable store would refuse.

An alternate persistence design was published on this branch during review — commit `78ad1eb`
("align continuity persistence envelope and db invariants"), extended by `645fc56` — which replaced
the nine relational columns with a single `state_json` envelope plus `created_at`/`updated_at`. The
owner **rejected** that storage model for RWC-P2B and directed a non-destructive reversal. Both
commits remain permanently in branch history as superseded work; the accepted design is the reviewed
nine-column schema recorded here. Nothing about the revision ruling above depends on which shape was
chosen — it was adopted from that line and applies identically.

### 7. Canonical validation on every boundary crossing, in both directions

Every state written is re-proved through `createRiyaConversationContinuityState` before any SQL runs;
every row read is rebuilt into a P2A input and passed through the **same** constructor before it
leaves the adapter. Nothing returns a raw row or raw JSON.

Reading matters as much as writing, because the database deliberately does **not** restate the
NeedDiscovery rules, the provenance/value pairing or the summary-readiness rule (§8). A partially
applied migration, a restore from an older dump or a hand-corrected row all arrive looking exactly
like data. A row that cannot pass the contract is a **refusal** — `repository-invariant` — never a
default, a repair, a partial result or a delete.

One consequence discovered in implementation and worth recording: a constructed `NeedDiscovery`
carries `behaviourVersion` and explicit `undefined`s, and `NeedDiscoveryInput` is `.strict()` — so
the output shape is **not** a valid input to the constructor that produced it. The column therefore
stores the **input projection**. Storing the output shape would have produced durable rows that no
reader could ever accept.

### 8. What the SQL constraints do, and one they deliberately omit

They validate evidence: identifier grammar (mirroring P2A exactly, including **not** copying 0008's
`latest` exclusion, which would make the database stricter than the contract and render some valid
states unstorable), `version = 1`, revision bounds, the nine phases, `jsonb_typeof = 'object'`, the
`summaryConfirmed` phase relation, and `phase = 'COMPLETE'` **iff** completion evidence is present.

The SUMMARY-readiness rule is deliberately **absent** from SQL. Expressing it means reaching into the
discovery JSON and restating which four ADR-0067 fields matter — a second, independently drifting copy
of the rule in the one place nobody reads when ADR-0067 changes. The canonical constructor enforces it
on every read and write, and an integration test proves a row violating it cannot survive the adapter.

### 9. Least privilege, and no retention decision

`REVOKE ALL` from PUBLIC and from `anon`/`authenticated`/`service_role`. The conditional
`qf_jarvis_runtime` grant is `SELECT, INSERT` plus **column-scoped** `UPDATE` on the six mutable
columns — so identity is immutable as a privilege rather than as a trigger the adapter must be
trusted not to work around. **No DELETE, no TRUNCATE**, no deletion trigger and no retention policy:
privacy and retention are not RWC-P2B's decision, and a package that quietly implemented one would be
making it.

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

Adding a conversation-only unique index · storing a transcript, rolling summary, channel, contact
detail or any Core-authority field · returning a raw row · letting database uncertainty become
`undefined`, `CREATED`, `EXISTING`, `REVISION_CONFLICT` or `NOT_FOUND` · a create loser returning its
own candidate · repairing, merging or retrying a revision conflict · computing the next revision in
storage · restating the NeedDiscovery or summary-readiness rules in SQL · granting DELETE or TRUNCATE
· introducing a retention or erasure policy · composing this adapter into an application, an endpoint
or an ingress · applying 0011 to the managed database.
