# The Durable Event Backbone — QF Jarvis

**Status:** Phase 3 — **Stage 3.0 complete and approved (2026-07-12).** Phase 3 implementation **has not started.**
**Date:** 2026-07-12

The load-bearing infrastructure of the entire system. Everything above it inherits its correctness — and its failures.

**Nothing in this document is implemented.** Stage 3.0 is documentation only. There is no database, no dependency beyond Zod, no migration, no Compose file, no CI database service, no worker runtime, and no Phase 3 application code.

> **Stage 3.1 must not begin until this Stage 3.0 pull request is merged into `main` and separately authorized by the business owner.**

Decisions — **all Accepted by the business owner on 2026-07-12**: [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) (persistence) · [ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion, signatures, idempotency) · [ADR-0021](../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries, dead letters, replay) · [ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md) (projections, ordering, rebuild).

---

## What Phase 3 is

Phase 3 builds the **mechanism**, proven against fixtures. It does not build an integration.

**The only event source is a local, fixture-driven, conforming test emitter.** It never connects to QuickFurno Core, and it contains no network client. Live Core emitters are **Phase 11**.

This is a feature rather than a compromise. Replayable, fixture-driven ingestion is exactly what makes Phase 3's correctness **provable without waiting on another system** — and what will later make Phase 11's integration testable.

## What Phase 3 must not introduce

No agents. No AI or model SDK. No recommendations. No approval flow. No execution intents acted upon. No communication sending. No n8n. No provider integration. **No live QuickFurno Core connection.** No writes to QuickFurno business tables. **No QuickFurno Supabase credential.** No WhatsApp, no voice. No founder control-plane UI.

`apps/api` **remains a compileable boundary** — ingestion is a function, not an endpoint ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §10).

`apps/worker` **begins to run a loop.** This is a planned change, anticipated by name in [ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md) §2 — not scope creep.

---

## The shape of it

```
test emitter ──(signed fixture bytes, in-process)──▶  ingest()
                                                          │
                    verify Ed25519 ──▶ parse @qf-jarvis/contracts ──▶ dedupe
                                                          │
                                          ┌───────────────┴────────────────┐
                                          ▼                                ▼
                                event  (immutable log)          ingestion_rejection
                                          │                     event_conflict
                             ┌────────────┴────────────┐
                             ▼                         ▼
                    projection A (checkpoint)   projection B (checkpoint)
                             │                         │
                        rm_* tables              rm_* tables
                             │
                  failure ──▶ bounded retry ──▶ dead_letter + projection BLOCKED
                                                        │
                                     replay (audited)  /  quarantine (audited)
```

**One database. One log. No broker. No queue table.**

---

## The five rules everything else follows from

**1. The database enforces idempotency.** `UNIQUE (event_id)` plus `INSERT … ON CONFLICT DO NOTHING`. *At-least-once delivery producing exactly-once effect* stops being application logic racing itself and becomes an invariant the engine holds.

**2. Jarvis cannot forge its own input.** Ed25519 is asymmetric; Jarvis holds only Core's **public** key. A fully compromised Jarvis still cannot manufacture an event stream.

**3. Checkpoint and state move in one transaction.** A read model can never be ahead of or behind its own checkpoint, because there is no moment at which one has moved and the other has not.

**4. Visibly broken beats invisibly wrong.** A poison event **halts** its projection rather than skipping it. Every other projection keeps running.

**5. Replay is a first-class operation.** It is exercised aggressively now, while it is still harmless — before anything downstream depends on it.

---

## Ingestion

```ts
ingest(rawBody: Uint8Array, envelope: SignatureEnvelope, now: Date): Promise<IngestResult>
```

**Verify → parse → deduplicate → store.** In that order, and nothing is stored until all three succeed.

### Signature

Ed25519 over the **exact bytes received**, before anything parses them:

```
signingInput = "qf-jarvis-event-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ hex(sha256(rawBody))
```

No JSON canonicalisation — it has number and Unicode edge cases, and every one is a place where signer and verifier can silently disagree about what was signed. Signing raw bytes makes the whole class of bug unreachable.

**`now` is injected**, never read inside the verifier. Contract validation never sees a clock at all — Phase 2 *tests* that property, and it must not die here.

**Replay of a stored event does not re-verify the signature or the freshness window.** It was verified once, at acceptance. A six-month-old event replayed during a rebuild is *supposed* to be six months old.

### Deduplication

| Case | Outcome |
| --- | --- |
| Same `eventId`, **same** semantic content | **Benign duplicate.** Counted. Nothing reprocesses. Redelivery is normal |
| Same `eventId`, **different** semantic content | **CONFLICT — fail closed.** Recorded, counted, alertable. **The original stands, unmodified** |

**No conflicting duplicate may silently overwrite an accepted event.** The first acceptance wins, permanently — because a conflict means a Core bug, corruption in transit, or an attack, and "last write wins" resolves all three in the attacker's favour.

### Rejection is not dead-lettering

| | **Rejection** (boundary) | **Dead letter** (processing) |
| --- | --- | --- |
| What failed | Signature, freshness, contract validation, unknown type or version | A projection handler, on an **accepted** event |
| Enters the store? | **No** | **Yes** — it is already in the log |
| **Replayable?** | **No** — there is nothing valid to replay | **Yes** |

Rejection records carry a reason code, a key id, a body digest, and Phase 2's structured issues — **path, code, and message, and never the offending value.** *The validator that refuses a secret must not then record it.*

---

## Ordering — stated honestly

**The canonical envelope carries no aggregate sequence.** Its fields are `eventId, eventType, eventVersion, occurredAt, emittedAt, source, subject, correlationId, causationEventId, payload`.

**Phase 3 guarantees:**

- deterministic ingestion sequence;
- deterministic replay in ingestion sequence;
- preserved correlation and causation references;
- late-event-safe projection reducers.

**Phase 3 does not claim:**

- global business ordering;
- per-lead or per-aggregate sequence ordering;
- sequence-gap detection.

There is no sequence to detect a gap *in*. Per-aggregate ordering requires a future versioned envelope carrying an aggregate sequence — a **Phase 11 Core-integration decision**, and one that **must not be invented in Phase 3**.

**Determinism and correctness are obtained separately**, and this is the crux:

- **Determinism is free** — live and rebuild both traverse `sequence` order.
- **Correctness is not** — a reducer tracking latest state must compare `(occurredAt, eventId)` and advance only on strictly newer. Then a late event cannot clobber a newer fact, and the result is *still* identical on replay.

---

## Processing

Each projection takes a **PostgreSQL advisory lock** on its own name, reads `WHERE sequence > checkpoint ORDER BY sequence`, applies, and **advances its checkpoint in the same transaction as its state write**.

**No queue.** *A queue is not required for Phase 3's checkpoint-driven projection model. PostgreSQL already provides durable ordering, locking, retries, checkpoints and atomic state transitions. Adding another broker would introduce a second durability boundary and operational complexity without improving the approved Phase 3 exit criteria. This is a scope and simplicity decision, not a claim that ordered queue architectures are universally invalid.*

Projections run concurrently **with each other**; ordered within themselves. If throughput ever becomes a real constraint, sharding by projection comes first — and a partitioned or ordered-consumer queue is a legitimate option to reconsider **on evidence** ([ADR-0021](../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md)).

| | |
| --- | --- |
| Retryable | Transient DB error, deadlock, connection loss, `RetryableError` |
| Terminal | `TerminalError`, programming error, unknown projection version |
| Max attempts | **5** (configurable) |
| Backoff | Exponential + jitter, base 1s, cap 5m — **persisted**, so a crash-loop cannot reset it |

### A poison event halts its projection

It does **not** skip. A skipped event leaves a hole nobody can see and breaks the rebuild guarantee; a halted projection is loudly, visibly broken and stops nothing else.

The operator has two moves: **fix and replay**, or **quarantine** — an explicit, attributed decision recorded in an immutable ledger and **reproduced during rebuild**, so determinism survives.

**Automatic quarantine is not offered.** A decision to permanently ignore a fact about the business needs a person's name on it.

---

## Read models

Every projection has a **name**, a **version**, and a **checkpoint**. All derived, non-authoritative, rebuildable, and prefixed `rm_` so nobody mistakes them for truth.

**Reducers must be pure** — no clock, no randomness, no environment, no I/O, no unsorted iteration. Enforced by an ESLint rule on the projections directory, mirroring the one that keeps `packages/contracts` pure.

**Version bump ⇒ destroy and rebuild.** A derived store is not migrated. It is thrown away and recomputed — because migrating it would be treating it as if it held something irreplaceable, which it must never hold.

### The rebuild guarantee, as a test

Build live → serialise all `rm_*` rows deterministically → canonical JSON → **SHA-256 → digest A**. Destroy. Rebuild. **Digest B. Assert `A === B`.**

### Erasure survives rebuild, for free

The obvious fear is that rebuilding from the log resurrects erased data. It does not — **because the erasure is itself an event in the log.** A rebuild replays it, in order, and arrives at the same erased state.

Phase 3 therefore needs **no special erasure machinery** beyond *"projections handle erasure and memory-invalidation events."*

And that works **only because Phase 2 chose *reference, never reproduce*** — the log holds opaque Core references, not copies of people. An earlier decision quietly paid for a later one.

### One reference projection, and no more

**`rm_subject_activity`** — per subject: event count, first seen, last seen, erasure state. Domain-neutral, agent-free, and it exercises rebuild determinism, late-event tolerance, erasure, and version-bump rebuild.

**No agent-specific, client-, vendor-, lead-, or marketing-intelligence projection may be added in Phase 3.** Those are Phases 4–8. Building one now would be building a domain read model in the phase least equipped to know what belongs in it.

---

## Observability

**No external telemetry provider.** Phase 13 is the phase named for observability hardening, and it owns that.

Counters: `ingest_accepted` · `duplicate` · `conflicting_duplicate` · `validation_failure` · `signature_failure` · `retry` · `dead_letter` · `replay`. Gauges: `projection_lag` (= `max(event.sequence) − checkpoint`) · `projection_status` · `rebuild_result`.

**The tables are the durable metrics.** `event_conflict`, `dead_letter`, and `ingestion_rejection` are queryable, countable, and alertable — which satisfies *"duplicate-event and dead-letter metrics are instrumented"* without a metrics stack.

**Honest limitation:** Phase 3 has no UI and no alerting transport. *Visible* means **queryable and counted**, not paged at 3am. Real alerting is Phase 13, and saying so plainly is better than implying somebody will notice a table changing.

Structured JSON logs carry `correlationId`, `causationEventId`, `eventId`, `eventType`, `projection`, `reasonCode`. **Never a payload. Never a signature.**

---

## Privacy, and what is deliberately not decided

**Phase 3 uses synthetic Phase 2 fixtures only.** No live QuickFurno personal data, no contact information, no production recipient, no production event stream, no production Core connection.

**The legal classification and retention policy of a production canonical event log is deliberately not decided in Phase 3.**

The tension is real and should be named rather than glossed: [auditability-principles.md](../governance/auditability-principles.md) requires an append-only, immutable audit trail; [data-ownership.md](./data-ownership.md) says audit records fall under legal-retention rules rather than deletion rules — but the log carries **pseudonymous Core identifiers**, and a pseudonymous identifier linked to a person is still personal data. **Whether an immutable event log qualifies as a retained audit record is a legal question, not an engineering one.**

**Before Phase 11 permits a single live event, a separate owner-approved privacy and retention decision must define:** whether the event log is a retained audit record · legal retention periods · erasure and anonymisation behaviour · legal holds · pseudonymous identifier handling · unlinking or cryptographic-erasure options · deletion propagation · access-control requirements.

**Phase 3 must not hardcode an arbitrary production retention period, and must not claim that immutable storage overrides an applicable erasure requirement.**

What Phase 3 *does* provide is the mechanism that makes any of those answers implementable: erasure events are processable, derived models are rebuildable, and the erasure survives a rebuild.

---

## The test emitter

**The only event source in Phase 3**, and its production safety is **structural rather than disciplinary**:

- **No application declares it as a dependency**, so under pnpm's isolated `node_modules` an application **cannot resolve it**. The package manager enforces this, not a reviewer.
- It **throws at module load** in production mode.
- It contains **no network client at all** — there is no socket to point at Core, so pointing it at Core is not a mistake anyone can make.
- CI asserts that no application depends on it.

It loads Phase 2's **41 valid event fixtures**, signs them with test-only keys, and can deliberately produce: **identical duplicates · conflicting duplicates · invalid signatures · unknown key ids · expired signatures · unknown event types · unknown versions · retryable and terminal handler failures.**

Adversarial input is not an afterthought. It is the emitter's primary purpose.

---

## Proposed layout

**Nothing below exists yet.**

```
packages/
  contracts/            (unchanged)
  event-backbone/       @qf-jarvis/event-backbone
    src/
      persistence/      pool, transactions, migration runner, migrations/*.sql
      signature/        Ed25519 verify, key registry, reason codes        [PURE]
      ingestion/        ingest(), dedup, conflict detection
      projections/      framework, runner, checkpoint, rebuild
      replay/           dead-letter replay, full rebuild, audit
      readmodels/       rm_subject_activity  — the one reference projection
      observability/    counters, structured logger                       [PURE]
      tests/
  test-emitter/         @qf-jarvis/test-emitter  (private, production-guarded)
apps/
  worker/               runs the projection runner            ← starts a loop
  api/                  UNCHANGED — compileable boundary
```

**Two new packages, not three.** `packages/persistence` is **not** created: [ADR-0010](../decisions/ADR-0010-workspace-and-module-structure.md) §6 requires **two or more consumers** to justify a package, and it has one. **Extraction trigger, recorded now:** extract it when Phase 4's coordination layer needs to own its own migrations.

**`packages/event-backbone` is justified, and not speculatively.** At Phase 11, `apps/api` gains an HTTP webhook that must call **the same** `ingest()` — and *apps may never depend on apps*. Drawing the boundary now costs nothing; discovering it in Phase 11 costs a refactor that competes with the integration and loses.

---

## Stages

| Stage | What | Gate |
| --- | --- | --- |
| **3.0** | **This document and ADR-0019–0022** | ✅ **Complete and approved, 2026-07-12** |
| 3.1 | Persistence: `pg`, pool, migrator, event store, CI + dev database | **Blocked** — see below. Then: migrator idempotent; checksum guard; `UPDATE`/`DELETE` on `event` refused |
| 3.2 | Signature verification and key registry (pure) | All reason codes; injected clock; test keys refused in production |
| 3.3 | Ingestion, dedup, conflict detection | **Idempotency proven by deliberate redelivery** |
| 3.4 | Projection framework, runner, bounded retries | Poison contained; other projections unaffected |
| 3.5 | Dead letters and replay | **Dead letters visible and replayable** |
| 3.6 | `rm_subject_activity`, full rebuild | **Destroy and rebuild ⇒ identical digest** |
| 3.7 | Test emitter | Refuses in production; apps cannot resolve it |
| 3.8 | Metrics, structured logs, adversarial suite | **Duplicate and dead-letter metrics instrumented** |
| 3.9 | Documentation and exit audit | Phase 3 exit criteria demonstrably met |

**Stage 3.1 must not begin until this Stage 3.0 pull request is merged into `main` and separately authorized by the business owner.** Approval of the *decisions* is not authorisation to *implement* them — a design merged into `main` is a design somebody can build on; a design sitting on a branch is one that can still change.
