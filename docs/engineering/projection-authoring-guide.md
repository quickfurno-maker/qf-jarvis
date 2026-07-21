# Projection Authoring Guide (Stage 3.4)

**Status:** Stage 3.4.1 (foundation) is **complete and merged via PR #19**. **Stage 3.4.2 (the
internal projection registry) is merged via PR #20** (merge commit
`b1782fb85508144b3be96d0acd62a5e93722f64b`). **Stage 3.4.3 (gap-free, commit-ordered projection
ordering — migration `0005`, ADR-0036) is complete and merged via PR #21** (merge commit
`f6123c1e66a596efc2742ed281c7d6d8d2aa5f4e`). **Stage 3.4.4 (the internal projection runner
`runProjectionOnce` — advisory lock, deterministic equal-jitter backoff, the seven frozen outcomes,
checkpoint/attempt reconciliation, guarded tri-state SQLSTATE classification, and
transaction-state-tracked client disposal; ADR-0037, code-only, no new migration) is COMPLETE and
merged via PR #22 (merge commit `d7c9fbfb286040b7d8f32f927d7185d92d46c52f`).** **Stage 3.4.5A (the
internal projection worker/scheduler `runProjectionWorker` — deterministic traversal, isolation, no
busy-spin, bounded injected time/sleep, graceful shutdown; ADR-0038, code-only, no new migration)
is COMPLETE and merged via PR #23 (merge commit `9d271bbae3121f49f78a74ff6abb3969dcfb7fc6`).**
**Stage 3.4.5B (the two real read-model handlers `event-type-activity` and `daily-event-acceptance`,
the internal production registry composition, and `apps/worker` activation; code-only, no migration,
no package-root export) is committed and pushed on branch `stage-3.4.5b-projection-handlers` and under
review in Draft PR #24; not merged and not complete.** The runner, advisory lock, worker/scheduler, and now the two real handlers **exist**;
the controlled rebuild is Stage 3.4.5C (a distinct slice from Stage 3.6's `rm_subject_activity`);
**Stage 3.4 as a whole remains incomplete**, and Stage 3.5 (dead letters, replay, quarantine, unblock) remains later work.
This guide is the contract a handler MUST satisfy, locked now so the foundation, the registry, the
runner, the worker, and the handlers agree.

**Governing decisions:** [ADR-0021](../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md),
[ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md),
[ADR-0034](../decisions/ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md),
[ADR-0035](../decisions/ADR-0035-stage-3-4-2-projection-registry.md),
[ADR-0036](../decisions/ADR-0036-stage-3-4-3-gap-free-projection-ordering.md),
[ADR-0037](../decisions/ADR-0037-stage-3-4-4-projection-runner.md).

> **Managed database.** Managed PostgreSQL remains **`0001`-only**. Migrations `0002`, `0003`, `0004`
> and `0005` remain **unapplied**, and **no managed migration is authorized** (ADR-0034 §13a, ADR-0036).
> Because the default migrator applies every pending migration, a run would apply `0002`→`0005`; there
> is no `0006`.

> **Projection cursor.** A handler's event carries the gap-free, commit-ordered **projection position**
> (ADR-0036), never the raw storage identity `qf_jarvis.event.sequence`. The checkpoint advances one
> `position` at a time (`= last_position + 1`); positions are dense and commit-ordered, so a benign
> duplicate or aborted ingest cannot create a gap that stalls or skips a projection.

---

## What a projection is

A projection is a **pure function of the immutable event log**, replayed in **projection-position**
order (the gap-free, commit-ordered cursor of ADR-0036, NOT the raw storage `sequence`), that maintains
one or more disposable `rm_*` read-model tables. It is **not** authoritative: it
can be destroyed and rebuilt from the log at any time, and a rebuild must produce byte-identical rows
(ADR-0022 §7).

## The handler contract

A projection handler is `apply(client, event)`. It MUST:

- be **deterministic** — the same event at the same read-model state produces the same write, every
  time and on every machine;
- take an **immutable, already-frozen event** and read only from it (metadata for the Stage 3.4
  models: the gap-free `position` (ADR-0036, NOT the raw storage `sequence`), `eventType`, `eventVersion`, `acceptedAt`);
- write **only** through the **same borrowed transaction client** it is given, and **only** to its own
  `rm_*` table(s);
- use **deterministic, position-aware updates** — see "Idempotency is not free" below;
- be **explicitly versioned** — a change to a handler's logic is a new `version`, and a version bump
  destroys the derived state and rebuilds from `0` (ADR-0022 §6). There is no read-model migration.

## How a handler is registered (Stage 3.4.2)

A handler reaches the runner only through the **internal, immutable projection registry**
([ADR-0035](../decisions/ADR-0035-stage-3-4-2-projection-registry.md)). What that means for an author:

- A definition is `{ name, version, apply }`. The `name` is repository-owned, bounded lowercase
  kebab-case; the `version` is a positive safe integer.
- **Registration is construction-time only.** There is no `register()` call, no plugin loader, and no
  way to add a projection while the process is running. Adding a projection is a code change.
- **One active definition per name**, and a duplicate name is rejected **even at a different
  version**. This is a deliberate **registry policy**, not a storage constraint: migration `0004`
  keys the checkpoint by `(projection_name, projection_version)` and ADR-0034 §4 derives the
  advisory-lock key from the name **and** version, so two versions would in fact get distinct rows
  and distinct locks. The registry refuses them anyway so that one logical projection name means
  one active definition. A version bump _replaces_ the definition; running versions side by side
  is out of scope for Stage 3.4.2 and would need its own ADR and distinct logical naming.
- Your definition object is **copied and frozen**, and each of `name`, `version` and `apply` is read
  **exactly once**. Mutating it afterwards changes nothing, extra properties are dropped, and a
  getter cannot pass validation and then hand over a different value.
- The `event` your handler receives is **metadata only** — `position` (the gap-free, commit-ordered projection cursor, ADR-0036, never the raw storage `sequence`), `eventType`, `eventVersion`,
  and `acceptedAt`. The acceptance instant is an **immutable canonical UTC string, not a `Date`**, so
  you cannot mutate shared state through it and two runs produce identical bytes. It is validated
  **semantically**, not just by shape: an impossible instant such as `2026-02-30T…` or `…T24:00:00…`
  is refused because it does not survive a byte-exact round trip.
- Enumeration is **deterministic**, sorted by projection name.

Registry construction **fails closed** on an invalid name, a non-positive/fractional/infinite/unsafe
version, a missing or non-function handler, a malformed definition, a duplicate name, an empty
registry, a registry larger than the fixed bound, or an input it cannot plainly read (a throwing
getter, a throwing or revoked proxy, a hostile `length`). Its errors carry a stable `code` — itself
runtime-normalised to a known value — and a message chosen from a closed repository-owned table;
there is no constructor path that accepts arbitrary text, so nothing of your handler's source, your
objects, or any unbounded input can appear in `code`, `message`, `stack`, or `cause`.

A registry holds at most **`MAX_PROJECTION_REGISTRY_SIZE` (1024)** projections; a larger reported
length is rejected **before any element is read**, as a construction-time denial-of-service and
configuration safeguard. Phase 3 has two proof projections, so the bound never constrains legitimate
use. It is an internal repository constant — not exported from the package root.

**The production registry is composed in Stage 3.4.5B** (committed and pushed, under review in Draft PR #24). The
internal worker/scheduler (Stage 3.4.5A) drives whatever registry it is given; the production
composition holds the two real proof projections. **Mind the name-vs-table distinction:** the two
projection _names_ are the lowercase kebab-case **`event-type-activity`** and
**`daily-event-acceptance`** — these key the checkpoint, the advisory lock, and the deterministic
backoff — while **`rm_event_type_activity`** and **`rm_daily_event_acceptance`** are the read-model
_tables_ those handlers write. An `rm_*` string contains underscores and is therefore never itself a
valid projection name (see `projection-name.ts`).

## Idempotency is not free

The **exactly-once effect on a read model is provided primarily by two things**: the **per-projection
advisory lock** (only one runner processes a projection at a time) and the **atomic transaction** that
advances the read-model state and the checkpoint together (ADR-0021 §1, ADR-0022 §5). A handler does
not have to re-derive that guarantee — but it must not **undermine** it.

In particular:

- **`INSERT ... ON CONFLICT ... DO UPDATE` is NOT automatically idempotent.** It deduplicates on the
  conflict KEY, nothing more. An aggregate upsert that INCREMENTS a counter
  (`... DO UPDATE SET event_count = event_count + 1`) is **not** idempotent: applying the same event
  twice increments the counter twice. `ON CONFLICT` alone provides **no** deduplication of the effect.
- **The same event position must never increment an aggregate twice.** Correctness rests on the
  checkpoint advancing exactly one position step per successful commit (the persistence boundary
  enforces `last_position + 1` over the gap-free projection position, ADR-0036), so under normal
  operation each event is applied once. But a handler must be written so that if the SAME event is ever
  re-presented (e.g. a rebuild, or a retry after an ambiguous commit), it does not double-count.
- **Where direct same-event reapplication must be harmless, the update must include a projection-position
  guard** — e.g. only apply when the event's position is strictly greater than the row's
  `last_event_position`, so a re-presented lower-or-equal position is a no-op. Do not assume
  `ON CONFLICT` provides this.
- **Handler SQL must not assume `ON CONFLICT` alone provides deduplication.** Determinism plus a
  **projection-position-aware** update (guarding on the gap-free `position`, ADR-0036, never the raw
  storage `sequence`) is what makes a rebuild byte-identical (ADR-0022 §7).

A projection handler MUST NOT:

- call `COMMIT` or `ROLLBACK`, or create/release a `SAVEPOINT` — the runner owns the transaction;
- open an independent database connection or pool;
- make any external request (network, filesystem, process, provider, Core, n8n, WhatsApp);
- read the clock (`Date.now`, `new Date()` for values) — timestamps in a read model come from the
  **event**, never from `now`;
- use randomness, environment variables, or any value that differs between runs;
- mutate the checkpoint or the attempt table — the runner owns those (the handler has no reason to
  touch them and, at the database layer, checkpoint/attempt writes are the runner's path);
- persist a **payload**, subject id, correlation id, event id, phone, email, address, GPS, transcript,
  payment data, or any free text — persisting a payload requires a separately accepted privacy
  decision, and the Stage 3.4 models take **metadata only**;
- hold or assert **authoritative business state** — a read model derives, it does not decide.

## Failure semantics (what the runner does, so a handler author knows what to expect)

- A handler **rejects deterministically** (throws) when it cannot apply an event. The runner rolls the
  handler's writes back to the SAVEPOINT, records **one** bounded `failed` attempt with a **closed safe
  error code** (`projection-handler-failed`, never the exception text), and either schedules a retry
  (`next_attempt_at`) or, on the **fifth** failure, **blocks** the projection at that event. No later
  event is processed or skipped (ADR-0021 §3, ADR-0037).
- **The retry maximum is five, fixed.** It is a repository constant (dependency-injectable in tests),
  **never** environment-configurable (ADR-0034 §6). There is **one** handler-failure bucket, not a
  `RetryableError`/`TerminalError` split: the runner classifies by inspecting the caught value's
  SQLSTATE as a closed **tri-state** (ADR-0037 §6). A value with **no own `code`** (an ordinary `Error`
  or a thrown primitive), or one with a well-formed **handler-side** SQLSTATE, is this deterministic
  failure. Do not author against `RetryableError`/`TerminalError` — those are design vocabulary and
  **not implemented**.
- **Retry timing is deterministic and persisted.** The backoff is deterministic equal-jitter (base 1s
  ×8, cap 5m) computed as a pure function of the **validated** `(name, version, position, failure)` and
  stored in `next_attempt_at` — there is no `Math.random`, no wall clock, and no scheduler yet. Two
  processes and a restart compute the same schedule (ADR-0037 §3).
- An **infrastructure** failure — a recognised infrastructure SQLSTATE, a well-formed-but-unrecognised
  SQLSTATE, **or an unreadable `code`** (an accessor/getter, a non-string, or a malformed value) — is
  **not** a handler rejection: the runner records **no** attempt, rolls the whole transaction back, and
  throws. The classifier inspects any **property-bearing** thrown value — an **object or a function** —
  so throwing a function with a hidden `code`, or hiding your `code` behind a getter, does **not** make
  you a deterministic failure: an accessor is treated as unreadable (conservative infrastructure), the
  getter is never invoked, and a revoked object/function `Proxy` fails closed without leaking a raw
  exception. A thrown handler value is always **discarded**, never persisted, wrapped as `cause`, or
  allowed to dictate its own classification. Fail with information the runner can classify into a safe
  code, never with data that must be stored. **No raw error, message, or stack trace is ever persisted.**
- **Invalid invocation input is a caller error, not a runner outcome.** A non-canonical injected `now`
  (or, in the backoff derivation, a malformed name or unsafe version) fails closed with the repository's
  `ProjectionInputError` **before** a client is acquired — it is a programming error, distinct from the
  five operational runner-failure codes (ADR-0037 §8).
- A **blocked** projection is **observation-only** in Stage 3.4 (ADR-0034 §8): it is queryable but has
  no auto-unblock and no manual mutation. A dead-letter table, quarantine ledger, and replay/unblock —
  and any notion of a "terminal" outcome beyond the fifth-failure block — are **Stage 3.5**.

## Data minimization

The Stage 3.4 read models contain only immutable event **metadata**. If a future projection genuinely
needs richer data, that is a **new privacy decision** and a new ADR — not something a handler may reach
for on its own. Because the models hold no personal data, erasure survives rebuild for free (ADR-0022
§8): an erasure event is simply another metadata event to count.
