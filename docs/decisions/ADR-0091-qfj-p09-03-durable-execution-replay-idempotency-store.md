# ADR-0091 — QFJ-P09.03 Durable Execution Replay / Idempotency Store (PostgreSQL, transport-neutral)

**Status:** Accepted — QFJ-P09.03. Transport-neutral; no transport, no deployment, no live send.
**Deciders:** Owner
**Relates to:** [ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md) · [ADR-0081](./ADR-0081-qfj-p08-durable-approval-queue-and-audit.md) · [ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)

## Context

QFJ-P09.02 built the B4 execution-dispatch verifier and deliberately shipped **no** production
replay store. Its `ExecutionReplayGuard` is REQUIRED and injected, with no default, because neither
available default is safe: an in-memory guard passes every test and loses its state on every
restart, and a permissive one turns "unknown" into "first seen".

That left the at-most-once promise — _"one execution intent may produce at most one provider call
initiation"_ (communication-model.md) — with an interface and no owner. On merged `main` the only
implementation of the guard was a test fake under `src/tests/`, excluded from the emitting build.

This slice supplies the missing durability, and only that.

## Decision

### 1. It is transport-neutral, and the wire protocol is still PROPOSED

`@qf-jarvis/postgres-execution-replay-store` holds no transport, endpoint, URL, webhook, workflow
id, HTTP client, n8n client, provider client or credential. Persisting a replay claim is **not**
adopting the Core → n8n envelope: not one of the three values stored is a transport artifact.

Real adopted Core → n8n transport remains deferred to a separately approved cross-system phase
involving QuickFurno Core and the execution side. Nothing here brings that closer by inventing an
endpoint, a header, a credential format or a workflow.

### 2. QFJ-P09.02 remains the contract owner

The store implements the EXISTING public `ExecutionReplayGuard`, unchanged. `execution-dispatch-runtime`
has **no production file modified by this slice** — the interface was already a type export, so the
adapter could be written against it without touching the boundary.

One test file in that package did change, because a merged fact changed: its leaf lock asserted
_"nothing imports this package"_, and something now does. The lock is restated rather than dropped,
and it did not weaken — the importer set is pinned EXACTLY, **no application may import the boundary
at all**, and a second assertion proves the one permitted importer is a storage adapter whose only
dependencies are the boundary and `pg`. If the replay store ever grew a client, the dispatch boundary
would have acquired a path to an effect through the one importer it allows, and that test fails.

Everything else P09.02 locked is untouched: exact replay carries no intent, seven runtime exports,
the distinct B4 domain and key purpose, the verifier-computed digest, no default replay guard, no
transport, no retry, no authority.

### 3. Three bound values, and INDEPENDENT uniqueness on two of them

A claim binds `executionIntentId`, `idempotencyKey` and the **verifier-computed** body digest —
ADR-0090 §7's rule, now durable.

Uniqueness is **independent**: `execution_intent_id` is the PRIMARY KEY and `idempotency_key`
carries its own UNIQUE constraint. A single composite key over the pair would accept two of the
three smuggling routes outright — `(A, k2)` does not collide with `(A, k1)`, and `(B, k1)` does not
collide with `(A, k1)` — so twenty concurrent claims reusing one key across twenty intents would all
have been told `first-seen`. A test proves exactly that case yields one winner and nineteen conflicts.

The digest is the third bind and catches the quietest case: the same id and key carrying **different
bytes**. Without it, an attacker who could replay an envelope with a mutated body would inherit the
original's idempotency.

#### 3a. UUID casing is representation; the other two fields are identity

Exactly one of the three is canonicalized, and the asymmetry is the decision.

- **`executionIntentId` IS lowercased, for storage comparison only.** UUID hexadecimal case is
  representation, not identity — `A1B2…` and `a1b2…` are the same UUID — and the `UUID` column
  agrees: it accepts either and returns canonical LOWERCASE text. The first draft accepted either
  case and returned the input unchanged, so an uppercase id could be INSERTED and then compared
  character by character against the lowercase form the database handed back. The **byte-identical
  replay of that same dispatch** failed that comparison and was classified `conflict`. That is not a
  cosmetic misnomer: `exact-replay` means "already done, suppress" while `conflict` is a fail-closed
  refusal, so the boundary refused a legitimate identical redelivery — precisely what the guard
  exists to recognise. Canonicalizing makes the value the adapter compares the value the database
  stores. It happens AFTER the shape check, so a malformed id is still refused rather than repaired.

- **`idempotencyKey` is NEVER normalized.** It is an opaque token chosen by the issuer, so `KEY-1`
  and `key-1` are two different tokens. Folding them would make two distinct claims collide — a way
  to LOSE a legitimate dispatch, not a way to catch a duplicate.

- **`bodyDigestHex` is NEVER normalized.** It is verifier output, defined as lowercase hex, so an
  uppercase digest did not come from the verifier and is REFUSED rather than lowercased.

The column stays `UUID`. Changing it to `TEXT` to preserve casing would have kept a representational
difference alive as if it were an identity, and given up the type that already canonicalizes.

### 4. The database arbitrates; the loser reconciles read-only

```
1. INSERT ... ON CONFLICT DO NOTHING RETURNING     -- the arbitration write
2. inserted?  -> first-seen                        -- already committed, so already durable
3. otherwise  -> SELECT ... WHERE id = $1 OR key = $2   -- NEW statement, NEW snapshot, read-only
```

`ON CONFLICT DO NOTHING` carries **no conflict target**. A targeted form would swallow a collision
on the intent id and raise `23505` for a collision on the idempotency key, so half the races this
store exists to arbitrate would arrive as driver exceptions instead of a classifiable answer.

**The classification is deliberately NOT one SQL CTE, and this is the load-bearing paragraph.** It
would be tidier to insert and select in a single statement. It would also be wrong, quietly.
`INSERT ... ON CONFLICT DO NOTHING` may WAIT on a concurrent session's uncommitted conflicting row;
when that session commits, the statement does nothing — but the statement's own snapshot was taken
before the wait, so a sibling `SELECT` branch of the SAME statement is not guaranteed to see the row
that just beat it. A classifier built on that reports "no durable row" for the ordinary, correct case
of losing a race, and the most natural reading of "no row" is the most dangerous answer available
here. **Same-statement snapshot visibility must not become the concurrency proof.**

So the reconciliation read is a separate statement under READ COMMITTED, where each statement takes
a fresh snapshot and the committed winner is guaranteed visible. This is the same principle
[ADR-0081](./ADR-0081-qfj-p08-durable-approval-queue-and-audit.md) already uses: let the database arbitrate
the race, then reconcile after the losing write path.

The reconciliation uses `OR`, not `AND`. An incoming claim can collide with the intent id of one row
and the idempotency key of a **different** one; an `AND` would find neither and report a repository
invariant for a contradiction that is plainly visible.

There is **no transaction** around the two statements. Wrapping them would hold the new row
uncommitted across a network round trip — delaying the durability of the one answer whose entire
value is that it is durable, and blocking every concurrent claimant on an uncommitted row for the
length of that trip.

There is **no retry loop**, no advisory lock, no process mutex, no Redis, and no raised isolation
level — `SERIALIZABLE` would manufacture a retry obligation this boundary must not have.

### 5. Exact replay writes nothing; conflict fails closed; uncertainty throws

- **`exact-replay`** — exactly one durable row matching all three values. No second row, no
  `claimed_at` refresh, no audit append, no mutation of any kind. A test reads the timestamp before
  and after and proves it did not move.
- **`conflict`** — two rows (the crossed collision), or one row that does not match all three. The
  store does not repair, overwrite, merge or pick a winner: deciding which of two contradictory
  claims was "meant" is a judgement no storage adapter is entitled to make.
- **Uncertainty THROWS.** Four bounded codes — `invalid-input`, `database-unavailable`,
  `schema-incompatible`, `repository-invariant` — each with a fixed, content-free message. No SQL,
  host, port, database name, connection string, credential, driver prose or row value escapes the
  package boundary. There is deliberately no `retryable` code inviting a caller to try again, and
  **no path from "the database did not answer" to `first-seen`**: the dispatch boundary converts a
  throw into `replay-guard-unavailable` and refuses.

**Zero rows after a reported conflict is a repository invariant, not a first-seen.** The arbitration
INSERT only reports zero inserted rows once a conflicting row is COMMITTED, and the table is
append-only, so the winner cannot have vanished between the two statements. If it is missing anyway,
the store's assumptions about the schema are wrong, and the tempting answer — "nothing is there, so
this must be new" — hands out a duplicate.

### 6. Durability is the point, and it is proved against a real server

A claim made through one pool is an `exact-replay` through a brand new one after the first is closed.
That is the failure an in-memory guard hides, and it is why the concurrency proofs run against real
PostgreSQL on twenty separate connections rather than against a mock. A separate test asserts the
harness genuinely produces twenty distinct backend PIDs, so a suite that quietly serialised itself
could not pass while claiming to have raced.

### 7. No executable intent payload is persisted

No `ExecutionIntentV1`, no action parameters, no recipient, no phone number, no email, no message
body, no communication content, no approval payload, no consent, no provider data, no credential, no
webhook, no URL, no workflow id and no provider result. Five columns: three bound values, a fixed
`record_version`, and `claimed_at`.

This is not tidiness. ADR-0090 §8 removed the intent from the exact-replay result precisely so that a
caller holding a replay observation has no executable instruction to act on a second time. A replay
store that persisted the intent and handed it back would reintroduce exactly what that change removed.

### 8. No tenant scope is invented

`ExecutionIntentV1` carries no tenant, organization, workspace or account identity, and no canonical
contract in this repository establishes one at B4 — a repository-wide scan of `packages/contracts`
finds none, and no migration `0001`–`0009` has such a column. Adding a scoping column here would
invent an authority model rather than record one, so uniqueness is global, exactly as the identifiers
themselves are.

### 9. No retention, and saying so is part of the decision

No TTL, no `DELETE`, no cleanup job, no sweeper, no archive, no partition expiry, no "keep 30 days".

Deleting a replay claim turns an old duplicate back into a `first-seen`, which is the precise failure
this table exists to prevent — and it is the operation a well-meaning cleanup job reaches for first.
The safe retention horizon depends on real transport retry/replay behaviour, which is not adopted.
`claimed_at` is recorded so a future, separately reviewed retention decision has something to reason
about; this slice defines no policy.

### 10. Migration 0010 is LOCAL/CI only

`0010_execution_replay_claim.sql`. Additive; `0001`–`0009` are byte-identical and `0009` still hashes
to `e834bc3c…`. One table, append-only trigger, `REVOKE ALL FROM PUBLIC`, and a conditional
`qf_jarvis_runtime` grant of `SELECT, INSERT` **only** — no `UPDATE` at table or column level, no
`DELETE`, no `TRUNCATE`. Unlike ADR-0081's slot pointer, nothing in this table is ever meant to move.

**The managed database was not accessed and was not migrated.** It continues to carry migration
`0001` only, exactly as before this slice.

UPDATE and DELETE are both refused by the database rather than only by the adapter, because the
adapter is one caller. A DELETE is the duplicate-enabling operation; an UPDATE is worse because it is
quieter — rebinding a stored intent id to a different key or digest would let a contradiction be
laundered into an exact replay.

## Consequences

- Migrations `0001`–`0010`; there is no `0011`. Managed database untouched.
- No Core connection, no n8n connection, no Meta, WhatsApp or provider connection, no credential.
- **No application composes the store.** It remains a durable adapter with tests until a later,
  separately authorized composition slice adopts it — and `apps/api` PRODUCTION/runtime code is
  unchanged.
- Adding `0010` moved a large number of repository-wide migration-set governance locks. Every one was
  moved to the new truth rather than relaxed, and one was **strengthened**: a bound written as
  `/^0010|^0[1-9]\d\d/` named 0010 and 0100–0999 while silently missing 0011–0099 — the exact range
  the next migration lands in — and is now a numeric comparison.
- Production rollout remains **OFF**, and live send remains **OFF**. **QFJ-P09 remains INCOMPLETE.**

## What this does NOT implement

Real adopted Core → n8n transport and composition · execution-time communications eligibility · the
18-state communication lifecycle runtime · provider dispatch, results and reconciliation · retention
or archival of replay claims · production rollout.

## Change-control rule

Adding a payload column, a tenant column, a retention policy, an `UPDATE` or `DELETE` privilege, a
retry loop, a public read or release method, or any transport export each require a superseding ADR.
So does moving the classification into a single statement: the two-statement shape is the decision,
not an implementation detail.

The same applies in both directions to §3a. Normalizing `idempotencyKey` or `bodyDigestHex`, or
ceasing to canonicalize `executionIntentId`, each require a superseding ADR — the first two would
silently merge two identities, and the last reintroduces the `conflict`-instead-of-`exact-replay`
defect this correction fixed.
