# Projection Authoring Guide (Stage 3.4)

**Status:** Stage 3.4.1 (foundation). The runner and the first two projection handlers arrive in
later Stage 3.4 slices; this guide is the contract a handler MUST satisfy, locked now so the
foundation and the handlers agree.

**Governing decisions:** [ADR-0021](../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md),
[ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md),
[ADR-0034](../decisions/ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md).

---

## What a projection is

A projection is a **pure function of the immutable event log**, replayed in ingestion (`sequence`)
order, that maintains one or more disposable `rm_*` read-model tables. It is **not** authoritative: it
can be destroyed and rebuilt from the log at any time, and a rebuild must produce byte-identical rows
(ADR-0022 §7).

## The handler contract

A projection handler is `apply(client, event)`. It MUST:

- be **deterministic** — the same event at the same read-model state produces the same write, every
  time and on every machine;
- take an **immutable, already-frozen event** and read only from it (metadata for the Stage 3.4
  models: `sequence`, `event_type`, `event_version`, `accepted_at`);
- write **only** through the **same borrowed transaction client** it is given, and **only** to its own
  `rm_*` table(s);
- use **deterministic, sequence-aware updates** — see "Idempotency is not free" below;
- be **explicitly versioned** — a change to a handler's logic is a new `version`, and a version bump
  destroys the derived state and rebuilds from `0` (ADR-0022 §6). There is no read-model migration.

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
- **The same event sequence must never increment an aggregate twice.** Correctness rests on the
  checkpoint advancing exactly one sequence step per successful commit (the persistence boundary
  enforces `last_sequence + 1`), so under normal operation each event is applied once. But a handler
  must be written so that if the SAME event is ever re-presented (e.g. a rebuild, or a retry after an
  ambiguous commit), it does not double-count.
- **Where direct same-event reapplication must be harmless, the update must include an event-sequence
  guard** — e.g. only apply when the event's sequence is strictly greater than the row's
  `last_event_sequence`, so a re-presented lower-or-equal sequence is a no-op. Do not assume
  `ON CONFLICT` provides this.
- **Handler SQL must not assume `ON CONFLICT` alone provides deduplication.** Determinism plus a
  sequence-aware update is what makes a rebuild byte-identical (ADR-0022 §7).

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
  handler's writes back to the SAVEPOINT, records a bounded `failed` attempt with a **closed safe
  error code** (never the exception text), and either schedules a retry (`next_attempt_at`) or, on the
  fifth failure, **blocks** the projection at that event. No later event is processed or skipped
  (ADR-0021 §3).
- A handler must therefore fail with information the runner can classify into a safe code — never with
  data that must be stored. **No raw error, message, or stack trace is ever persisted.**

## Data minimization

The Stage 3.4 read models contain only immutable event **metadata**. If a future projection genuinely
needs richer data, that is a **new privacy decision** and a new ADR — not something a handler may reach
for on its own. Because the models hold no personal data, erasure survives rebuild for free (ADR-0022
§8): an erasure event is simply another metadata event to count.
