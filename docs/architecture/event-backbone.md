# The Durable Event Backbone — QF Jarvis

**Status:** Phase 3 — **Stages 3.0–3.1.4 complete and merged/accepted. Stage 3.2 (pure signature verification, in `@qf-jarvis/event-ingestion`) complete, owner-accepted and merged (PR #10, 2026-07-16). Managed-database readiness is established and migration `0001_event_log.sql` is applied. Stage 3.3 slices 1–2 (semantic digest, validated event preparation) are database-free internal units; Stage 3.3 slice 3 adds atomic, idempotent persistence — `storeValidatedEvent` plus migration `0002_event_runtime_grants.sql`. Stage 3.3.3 adds the two append-only boundary audit tables — `qf_jarvis.ingestion_rejection` and `qf_jarvis.event_conflict` — in migration `0003_ingestion_rejection_and_event_conflict.sql`, with in-transaction conflict recording ([ADR-0031](../decisions/ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md), Accepted). Stage 3.3.4 implemented the single dependency-injected `createEventIngestor` composition **only** — it composes the four existing Stage 3.2/3.3 primitives (verify → prepare → persist, recording rejections and letting a conflict commit-then-throw) in `@qf-jarvis/event-ingestion`, adding **no** migration ([ADR-0032](../decisions/ADR-0032-stage-3-3-4-full-ingest-composition.md), Accepted); it is **merged via PR #17** (merge commit `40830846c784fdd1e46c3535a2fa97292f32d1d8`). **Stage 3.3.5 — Concurrency, Duplicate-Key Decision and Managed Readiness — is merged (PR #18, merge commit `c07580147cb283d0acdc4357bee3ded45a83d82d`)** ([ADR-0033](../decisions/ADR-0033-stage-3-3-5-concurrency-duplicate-key-and-managed-readiness.md), Accepted): duplicate JSON object member names are rejected (contract-validation-failed / invalid-format), and concurrency, restart, and pre-commit/unknown-commit fault behaviour are proven against local PostgreSQL 17 at READ COMMITTED; managed readiness for `0002`/`0003` is **documented but no managed application occurred**. **Stage 3.3 is therefore complete.** **Stage 3.4 is in progress: Stage 3.4.1 (projection foundation) is COMPLETE and merged via PR #19 (merge commit `580568dcb342b8017bec25e93d6f8396ac9b3ef0`)** — migration `0004_projection_foundation.sql` (the projection checkpoint/attempt tables and two disposable metadata read models, ADR-0034). **Stage 3.4.2 (the INTERNAL, immutable projection registry, [ADR-0035](../decisions/ADR-0035-stage-3-4-2-projection-registry.md)) is implemented locally and pending independent review** — it adds **no** migration and **no** root export. **Stage 3.4 as a whole remains incomplete** (the advisory lock, runner, retries, handlers and rebuild are later Stage 3.4 slices, 3.4.3–3.4.5), **Stage 3.5 remains blocked**, and Phase 3 is NOT complete. HTTP endpoints and worker loops remain absent. Managed PostgreSQL still carries only `0001`; `0002`, `0003` and `0004` are unapplied, no managed migration is authorized, and there is no `0005`.**
**Date:** 2026-07-12

The load-bearing infrastructure of the entire system. Everything above it inherits its correctness — and its failures.

**What exists today (Stage 3.1):** the `@qf-jarvis/event-backbone` package — a validated database configuration, a connection pool, a transaction helper, a forward-only migration runner with checksum verification, and the **immutable canonical event log**. PostgreSQL 17 for local development and CI. **Stage 3.2 additionally exists**, as **pure Ed25519 signature verification in the separate `@qf-jarvis/event-ingestion` package** — database-free — complete, owner-accepted and merged via PR #10 on 2026-07-16 ([ADR-0027](../decisions/ADR-0027-stage-3-2-signature-verification-protocol.md), Accepted). **Stage 3.3 slice 3 additionally exists**, as **`storeValidatedEvent`** in this package — the race-safe, idempotent `INSERT ... ON CONFLICT DO NOTHING` that classifies a duplicate by its semantic digest and fails closed on a conflict ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8), with migration `0002_event_runtime_grants.sql` granting the runtime role least privilege. **Stage 3.3.3 additionally exists**, as the two **append-only, payload-free boundary audit tables** — `qf_jarvis.ingestion_rejection` (a bounded reason code plus safe evidence; ADR-0020 §9) and `qf_jarvis.event_conflict` (the refused delivery's digests, validated correlation id, and bounded signature evidence — never a payload; ADR-0020 §8 as narrowed by [ADR-0031](../decisions/ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md)) — in migration `0003_ingestion_rejection_and_event_conflict.sql`. `storeValidatedEvent` now records a conflict in the same transaction it classifies it, then throws; `recordIngestionRejection` is the public trusted append primitive; `recordEventConflict` is internal. **Stage 3.3.4 additionally exists**, as **`createEventIngestor`** in `@qf-jarvis/event-ingestion` — the dependency-injected factory (`pool`, `keyRegistry`, optional verification options) returning `ingest(rawBody, envelope, now)`. It composes the existing primitives in the fixed boundary order — verify-before-parse, then contract-validated preparation, then `storeValidatedEvent` — turning their outcomes into one frozen, discriminated `IngestResult` (`stored | duplicate | rejected`); a signature or preparation failure appends exactly one `ingestion_rejection` row (safe codes only) and returns only after it commits, while a conflict commits its audit row and throws. It adds **no** migration, endpoint, worker, or new vocabulary ([ADR-0032](../decisions/ADR-0032-stage-3-3-4-full-ingest-composition.md), Accepted), and is **merged (PR #17, merge commit `40830846c784fdd1e46c3535a2fa97292f32d1d8`)**. **Stage 3.3.5 additionally exists (merged via PR #18)**, as the **hardening and proofs** of that boundary ([ADR-0033](../decisions/ADR-0033-stage-3-3-5-concurrency-duplicate-key-and-managed-readiness.md), Accepted): an internal, iterative duplicate-object-key scanner refuses any JSON object with a repeated member name at any depth (compared by decoded name) **before** `JSON.parse` can collapse it last-wins — mapped through the existing `contract-validation-failed` / `invalid-format` vocabulary, persisting no sender-controlled text; concurrency, restart, pre-commit-failure, and unknown-commit (acknowledgement-loss) behaviour proven against real PostgreSQL 17 at READ COMMITTED (no SERIALIZABLE, no advisory lock); and the pg concurrent-query lifecycle warning eliminated at its test-only source. Stage 3.3.5 adds **no** migration and **no** public runtime export. **Stage 3.4.1 additionally exists (COMPLETE, merged via PR #19, merge commit `580568dcb342b8017bec25e93d6f8396ac9b3ef0`)**, as the **projection foundation** ([ADR-0034](../decisions/ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md), Accepted): migration `0004_projection_foundation.sql` adds `qf_jarvis.projection_checkpoint`, the append-only `qf_jarvis.projection_attempt`, and two disposable metadata-only read models, with internal checkpoint/attempt repositories (no public runtime export, no runner yet). **Stage 3.4.2 additionally exists (locally, pending independent review)**, as the **INTERNAL, immutable projection registry** ([ADR-0035](../decisions/ADR-0035-stage-3-4-2-projection-registry.md), Accepted): validated, copied and frozen `{name, version, apply}` definitions; exactly one active definition per projection name (a duplicate name is refused even at a different version — a deliberate **registry policy**, not a storage constraint: migration `0004` keys the checkpoint by `(projection_name, projection_version)` and ADR-0034 §4 derives the advisory-lock key from name **and** version, so two versions would in fact get distinct rows and distinct locks; side-by-side versions are out of scope for this slice); deterministic enumeration sorted by name; a metadata-only handler event (`sequence`, `eventType`, `eventVersion`, and an **immutable canonical UTC acceptance instant rather than a mutable `Date`**); construction-time registration only, with no runtime mutation and no plugin loader. It adds **no** migration, **no** root export, and **no** real handler — the two proof handlers are Stage 3.4.5.

**Most of the rest of this document is still design.** The atomic persistence primitive and its duplicate/conflict classification now exist (Stage 3.3 slice 3, above), and Stage 3.3.4 has composed them with verification and preparation into the **end-to-end `createEventIngestor` ingest function** (in `@qf-jarvis/event-ingestion`, not this package). Stage 3.4.1 has delivered the projection foundation — the checkpoint, attempt, and two read-model **tables** and their internal repositories (migration `0004`, merged via PR #19) — and Stage 3.4.2 has added the internal projection **registry** (ADR-0035, pending review), but there is still **no advisory-lock code and no runner**, **no bounded-retry runner logic**, **no dead letters**, **no replay**, **no quarantine**, **no populated read models**, **no test emitter**, and **no metrics** — and, by design at this point in the roadmap, **no HTTP endpoint** and **no worker loop**. **Signature verification, validated-event preparation, and the ingest composition all live in `@qf-jarvis/event-ingestion` (Stage 3.2 and Stage 3.3 slices 1–3 plus 3.3.4), not in this package.** **Stage 3.3 is complete (3.3.5 merged, PR #18); the current work is Stage 3.4**, of which 3.4.1 is the schema-and-repositories slice (merged, PR #19) and 3.4.2 is the registry slice (pending review); the lock, runner, retries, handlers and rebuild are later slices. `apps/api` and `apps/worker` remain compileable boundaries, and no live integration exists.

> The `UNIQUE (event_id)` constraint in migration `0001` lays the **foundation** for eventId idempotency. It is **not** the Stage 3.3 behaviour that distinguishes a benign duplicate from a conflicting one, and Stage 3.1 does not claim it is.

Decisions — **all Accepted by the business owner on 2026-07-12**: [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) (persistence) · [ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion, signatures, idempotency) · [ADR-0021](../decisions/ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries, dead letters, replay) · [ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md) (projections, ordering, rebuild) · [ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) (the deployment provider).

---

## Where the database lives

Three environments, **one engine, one schema, one set of migrations**.

| Environment | Database | Role |
| ----------- | -------- | ---- |
| **Local** | Loopback **PostgreSQL 17** | Development, and the destructive test database |
| **CI** | GitHub Actions **PostgreSQL 17** service | The integration-test database. Ephemeral, CI-only credentials |
| **Deployment** | **Dedicated Supabase-managed PostgreSQL 17** — the **QF-Jarvis** project | Jarvis's own database ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)) |

**The QF-Jarvis Supabase project is not QuickFurno Core's Supabase project, and Core's remains forbidden** — no credential, no connection string, no role, no read, no write ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md), [ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §2).

**Supabase is a Postgres host and nothing else.** No Auth, no Storage, no Realtime, no Edge Functions, no Data API, and **no `@supabase/supabase-js`** — every one of those is a capability the architecture deliberately withholds from Jarvis, which authorizes nothing, executes nothing, and delivers nothing. The driver stays `pg`; the configuration stays `DATABASE_URL`. **Nothing above the driver knows who the provider is**, which is what makes the decision reversible and the three environments comparable.

**PostgreSQL major 17 is the contract; patch levels are not.** Local and CI pin the exact image (17.10, in `compose.yml` and in CI) so a laptop and a runner agree with *each other*. The managed project runs a provider-chosen 17.6.x build, and **that divergence is expected and permitted**. Nothing here may depend on behaviour introduced in a specific 17.x patch, and a provider patch upgrade must not require a change to this repository ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §7).

### Everything lives in `qf_jarvis`. Nothing lives in `public`.

The event log, the migration history, both mutation-rejection functions, both triggers, every index and constraint — all in **`qf_jarvis`**, every reference **fully qualified**.

`public` is the shared, world-facing default: the schema a Data API reaches for first, and the schema every other tool assumes it may write to. **An immutable event log has no business living in a room with an unlocked door.** A private schema also makes the access question answerable in one place — revoke `USAGE` and every object inside is unreachable by name, whatever grants a provider hands its own roles after its next upgrade.

`anon`, `authenticated` and `service_role` are revoked by a **conditional `DO` block** that checks `pg_roles` first — because those roles are *Supabase's* and do not exist on a laptop, and an unconditional `REVOKE` would be a hard error locally and in CI. The identical migration therefore runs in all three environments. It **re-runs on every migration**, so a provider that re-grants during a platform upgrade is re-revoked rather than silently tolerated.

**Nothing depends on `search_path`** — an ambient `search_path` is a global variable set by whoever connected last, and correctness that rests on one fails the day a pooler hands back a different session.

The migrations are plain SQL against stock PostgreSQL 17 — no Supabase extension, no `auth.*` schema, no RLS policy. **A migration that only ran on Supabase would mean the thing CI proved is not the thing production runs**, which is the exact failure ADR-0019 rejected when it refused a SQLite/PostgreSQL dual dialect.

> ### Transaction-mode pooling would break session state — silently
>
> The persistence package depends on session state in more places than the migration runner: **`pg_advisory_lock()`** (the migration lock, and from Stage 3.4 each projection's lock), plus **`statement_timeout`** and **`application_name`** set on connect. Supabase's Supavisor pooler in **transaction mode** multiplexes many clients over few backends, so a lock could be taken on one session and released on another, and a session-level `SET` may not survive at all.
>
> **Supported: direct connections, and Supavisor session mode (port 5432). Not supported: Supavisor transaction mode (port 6543).**
>
> This is **enforced in `createDatabaseConfig`**, so it holds for every pool the package creates — not only `db:migrate`. It **throws rather than warns**, because under transaction pooling the migration runner would *appear* to work and would simply have stopped serialising two concurrent migrators. **A guarantee that fails quietly is worse than one that was never claimed.**
>
> A future component may introduce a separate transaction-mode connection **only after proving** it depends on no advisory lock, no prepared statement, and no session state. The migration runner and the projection runner will never qualify.
>
> **Managed-database readiness has been established, and migration `0001_event_log.sql` is applied.** Migrations `0002_event_runtime_grants.sql` (least-privilege runtime grants, Stage 3.3 slice 3), `0003_ingestion_rejection_and_event_conflict.sql` (the boundary audit tables, Stage 3.3.3) and `0004_projection_foundation.sql` (the projection foundation, Stage 3.4.1) are **implemented and verified locally but NOT applied to the managed database**, which carries migration `0001` alone. **No managed migration is authorized**, and because the default migrator applies every pending migration, a managed run would apply `0002`, `0003` and `0004` together. There is no `0005`.

### Deployment obligations this repository cannot enforce

- **`qf_jarvis` must never be added to Supabase's exposed-schema (Data API) configuration.** Not for debugging, not temporarily.
- **No Supabase API key** — `anon`, `service_role`, or otherwise — **may be used to reach event-backbone data.**
- **The runtime role is a dedicated PostgreSQL login role.** It must **not** be a superuser and must **not** own the schema or its tables — a table owner can `DISABLE TRIGGER`, which defeats immutability entirely.
- **The migration role and the runtime role are separate responsibilities**, and neither is a superuser.
- **Stage 3.1 creates no password-bearing login role and commits none.** Roles are a deployment artifact; a `CREATE ROLE ... LOGIN PASSWORD` in a migration is a credential in Git.

**These live outside Git and are only as good as the person clicking.** The revokes make a mistake far less dangerous. They do not make it impossible, and this document will not pretend otherwise ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md) §4).

**Phase 3 stores synthetic Phase 2 fixtures only.** The QF-Jarvis Supabase project must contain **no live QuickFurno personal data**. Provisioning a deployment database does not unblock production event-log retention: that remains an owner-approved **hard gate on Phase 11** ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §7). **Having somewhere to put the data is not permission to put it there.**

---

## The Stage 3.1 event table: one event, one representation

The envelope lives in **columns** — `event_id`, `event_type`, `event_version`, `occurred_at`, `emitted_at`, `source`, `subject_type`, `subject_id`, `correlation_id`, `causation_event_id`. The payload lives in **`payload` JSONB**.

**The complete canonical event is not _also_ stored as a JSONB blob.** Storing both would be two representations of one accepted fact, and two representations can disagree — a column saying one thing while the blob beside it says another, with **nothing to reconcile them against**, because the log *is* the record of last resort. A store whose entire purpose is to be trustworthy when everything else is in doubt must not itself be a source of doubt. So the contradiction is made **unrepresentable** rather than defended against: the persisted event is reconstructed from the envelope columns plus `payload`, and every field has exactly one place it is written.

`payload` is JSONB because its shape varies by event type; giving it a fixed schema would mean hard-coding all 41 Phase 2 contracts into SQL and re-migrating on every contract change.

### The two digests

| Column                  | Over what                                                                                                | For                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `semantic_event_digest` | The deterministic canonical JSON of the **entire parsed, validated canonical event** — envelope + payload | Semantic identity. What a duplicate will be compared on ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8) |
| `body_digest`           | The **exact bytes received**                                                                             | Evidence. The value the signature commits to                                   |

It is named `semantic_event_digest`, not `payload_digest`, because it digests the event and not the payload — and a name that says otherwise would be a lie by omission the first time somebody diffed two events whose payloads matched and whose envelopes did not.

**Stage 3.1 stored these and compared nothing.** Duplicate classification is **Stage 3.3 slice 3**,
now implemented: `storeValidatedEvent` compares an incoming `semantic_event_digest` against the
committed row for the same `event_id` and returns a benign duplicate on a match or fails closed on a
mismatch ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md)
§8). The `semantic_event_digest` value itself is produced by two database-free, INTERNAL Stage 3.3
slices in `@qf-jarvis/event-ingestion`: a deterministic canonical-JSON + SHA-256 digest
([ADR-0029](../decisions/ADR-0029-stage-3-3-semantic-digest-foundation.md)) and the validated
event preparation that feeds it an already-verified, contract-validated event
([ADR-0030](../decisions/ADR-0030-stage-3-3-validated-event-preparation.md)). The persistence
behaviour is implemented and verified locally; pending owner review; migration `0002` not applied to
the managed database.

> **Stage 3.3 slice 1 provides the pure semantic-digest computation** — deterministic canonical JSON + SHA-256 over the validated canonical event — **internally** in `@qf-jarvis/event-ingestion`, database-free ([ADR-0029](../decisions/ADR-0029-stage-3-3-semantic-digest-foundation.md), Accepted). It is **not exported** from the package root; only the internal validated-ingestion composition calls it. Its value is **now consumed by Stage 3.3 slice 3**: the slice-3 bridge carries it into `storeValidatedEvent`, which _compares_ it against the committed row to classify a benign duplicate versus a conflict. It is **not** the signing canonicalisation. Computing the digest and _using_ it to classify a duplicate against the stored log are still distinct steps — the classification is the persistence-touching slice 3, implemented and verified locally; pending owner review; migration `0002` not applied to the managed database.

### Constraints mirror the stable Phase 2 shapes

`event_type` and `subject_type` are lowercase machine tokens (1–64). `subject_id` is an opaque Core reference over `[A-Za-z0-9._:-]` (1–128) — **deliberately not a UUID**, because Core owns its identifier scheme, and **deliberately not a closed list of subject types**, because Core owns its entity taxonomy and Phase 3 has not integrated with Core. `source` is the literal `quickfurno-core`; `signature_algorithm` is the literal `ed25519`.

They are not a second copy of Zod. They are the cheap, stable checks that mean **a bug in some future ingestion path cannot write a row the contracts would have refused**.

### `schema_migration` is append-only too

The migration history is protected exactly as hard as the event log — a `BEFORE UPDATE OR DELETE` trigger and a `REVOKE`. **A control that can be edited by the thing it constrains is not a control:** an `UPDATE` of a recorded checksum defeats the reconciliation that checksumming exists for, and a `DELETE` re-opens an applied migration against a schema that already has it. The runner needs only `SELECT` and `INSERT`, and is written that way.

> **The same limit applies to both tables, and is not glossed.** A PostgreSQL **superuser** is not constrained by grants, and a table **owner** can disable a trigger. Therefore **the production application role must not be a superuser and must not own these tables, and the deployment's migration role must not be a superuser.** That is a deployment obligation; Stage 3.1 cannot discharge it.

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

Rejection records (`qf_jarvis.ingestion_rejection`, implemented in Stage 3.3.3 — [ADR-0031](../decisions/ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md)) carry a **bounded reason code**, an optional key id, an optional body digest, and **safe repository-owned issue codes** (a closed vocabulary, deterministically sorted and deduplicated) with an issue count and an independent truncation flag. `issue_codes` is the **distinct** set of safe codes the retained issues carry; `issue_count` is the **number of retained issues** (0..16); `issues_truncated` is an **independent** fact — the bounded upstream source dropped issues beyond its retained list — that the schema **cannot** infer from `issue_count` versus the distinct-code count (several retained issues may share one code, so `issue_count > cardinality(issue_codes)` with `issues_truncated = false` is valid). They store **no validator message, no field path, no payload, no raw body, no signature bytes, no event id, no correlation id, and no unbounded sender-controlled content** — the safe issue path/message that Stage 3.3 slice 2 produces are used to derive the codes and are not persisted. `reason_code` and `issue_codes` are repository-owned closed vocabularies, and `body_digest` is computed by Jarvis from the raw body (not copied from the sender). The **one** sender-derived field is the **optional `key_id`** — the *claimed* signing-key id from the sender-controlled envelope; it is sender-controlled but is accepted only in the strict 1–128-character machine-token format. *The validator that refuses a secret must not then record it.*

Conflict records (`qf_jarvis.event_conflict`, Stage 3.3.3) carry the refused delivery's `semantic_event_digest` and `body_digest` (one-way hashes), its validated `correlation_id`, and bounded signature evidence (algorithm, key id, signed-at) — **never a payload, signature bytes, or subject reference** (ADR-0020 §8 as narrowed by ADR-0031). The **original** accepted event's semantic digest is **not** copied; it is joined from the immutable `qf_jarvis.event` parent. `storeValidatedEvent` appends the conflict row **in the same transaction** that classifies the conflict, commits, then throws the typed error; every verified conflicting redelivery records a separate row. Both audit tables are **append-only** (a `BEFORE UPDATE OR DELETE` trigger and REVOKEs), and the runtime role holds **column-level** privileges only — INSERT on the caller columns, SELECT on `sequence`/`recorded_at` for `RETURNING`, and nothing else.

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

### Two metadata proof projections in Stage 3.4, and no more

**Stage 3.4 ships exactly two infrastructure-metadata proof projections** ([ADR-0034](../decisions/ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) §10), because the locked Stage 3.4 exit gate requires **at least two independent projections** — one projection cannot demonstrate that a blocked projection fails to stall another:

- **`rm_event_type_activity`** — per event type/version: event count, first and last ingestion sequence, first and last acceptance instant.
- **`rm_daily_event_acceptance`** — per acceptance day: accepted-event count, first and last ingestion sequence.

Both are domain-neutral, agent-free, non-authoritative, and **metadata-only** — no subject, correlation id, event id, payload, or free text — so erasure survives rebuild trivially.

**`rm_subject_activity`** — per subject: event count, first seen, last seen, erasure state — is **deferred to Stage 3.6**, where it exercises rebuild determinism, late-event tolerance, erasure, and version-bump rebuild. It is **not built in Stage 3.4**, and the two metadata projections above do **not** replace it.

**No agent, domain-intelligence, or authoritative business projection — client-, vendor-, lead-, or marketing-intelligence — may be added in Phase 3.** Those are Phases 4–8. Building one now would be building a domain read model in the phase least equipped to know what belongs in it. This is the widening recorded in ADR-0034 §10 of ADR-0022 §9's original "one reference projection": from one proof projection to two, with the ban on agent/domain/business projections **unchanged**.

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
      readmodels/       rm_event_type_activity, rm_daily_event_acceptance
                        — the two Stage 3.4 metadata proof projections
                        (rm_subject_activity is a later Stage 3.6 model)
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
| **3.0** | This document and ADR-0019–0022 | ✅ **Complete and approved, 2026-07-12** |
| **3.1** | Persistence: `pg`, pool, transactions, migrator, event log, CI + dev database | ✅ **Implemented, pending review.** Migrator idempotent; checksum guard refuses an edited migration; `UPDATE`/`DELETE` on `event` refused by trigger |
| 3.2 | Signature verification and key registry (pure) | All reason codes; injected clock; test keys refused in production |
| 3.3 | Ingestion, dedup, conflict detection | **Slices done: atomic idempotent persistence (`storeValidatedEvent`, slice 3), the append-only `ingestion_rejection` + `event_conflict` audit tables with in-transaction conflict recording (Stage 3.3.3, migration `0003`, ADR-0031), and the `createEventIngestor` composition (Stage 3.3.4, verify → prepare → persist, ADR-0032 — no new migration). Idempotency, conflict, concurrency, append-only, column-level runtime privilege, verify-before-parse ordering, and the rejection/conflict boundary rules proven against local PostgreSQL. Stage 3.3.4 is merged (PR #17). **Stage 3.3.5 (Concurrency, Duplicate-Key Decision and Managed Readiness, ADR-0033) is merged (PR #18) — no new migration, no public export:** duplicate JSON object keys rejected; concurrency, restart, and pre-commit/unknown-commit fault behaviour proven against local PostgreSQL at READ COMMITTED; managed readiness for `0002`/`0003` documented with no managed application. Migrations `0002` and `0003` not applied to the managed database (which carries `0001`). **Stage 3.3 is COMPLETE.** Live HTTP endpoints and worker loops are out of scope for Stage 3.3 (3.3.4 and 3.3.5 exclude them) — not its exit requirement** |
| 3.4 | Projections, checkpoints, bounded retries | **In progress. Stage 3.4.1 (projection foundation — migration `0004`, `projection_checkpoint`/`projection_attempt` + two disposable metadata read models, internal repositories; ADR-0034) is COMPLETE, merged via PR #19 (merge commit `580568dcb342b8017bec25e93d6f8396ac9b3ef0`). Stage 3.4.2 (the INTERNAL immutable projection registry; ADR-0035 — no migration, no root export) implemented locally, pending independent review. The two models are `rm_event_type_activity` and `rm_daily_event_acceptance`; `rm_subject_activity` stays deferred to Stage 3.6. Lock/runner/retries/handlers/rebuild are later slices (3.4.3–3.4.5); the full-stage gate remains: poison contained, other projections unaffected. `0004` is local/CI only; managed carries only `0001`; `0002`/`0003`/`0004` all pending; **no managed run is authorized** — the default migrator applies all pending migrations, so a run would apply `0002`, `0003` and `0004`. There is no `0005`.** |
| 3.5 | Dead letters and replay | **Dead letters visible and replayable** |
| 3.6 | `rm_subject_activity`, full rebuild | **Destroy and rebuild ⇒ identical digest** |
| 3.7 | Test emitter | Refuses in production; apps cannot resolve it |
| 3.8 | Metrics, structured logs, adversarial suite | **Duplicate and dead-letter metrics instrumented** |
| 3.9 | Documentation and exit audit | Phase 3 exit criteria demonstrably met |

**Stage 3.1 is reviewed and merged; Stage 3.2 (pure signature verification) is complete, owner-accepted and merged (PR #10, 2026-07-16). Managed-database readiness is established and migration `0001_event_log.sql` is applied. Stage 3.3 slice 3 (atomic, idempotent persistence), Stage 3.3.3 (the append-only `ingestion_rejection` and `event_conflict` tables, migration `0003`, ADR-0031), and Stage 3.3.4 (the `createEventIngestor` composition only, ADR-0032 — no new migration) **merged via PR #17 (merge commit `40830846c784fdd1e46c3535a2fa97292f32d1d8`)**. **Stage 3.3.5 (Concurrency, Duplicate-Key Decision and Managed Readiness, ADR-0033) is merged (PR #18, merge commit `c07580147cb283d0acdc4357bee3ded45a83d82d`); Stage 3.3 is COMPLETE.** Managed PostgreSQL is **`0001`-only**: migrations `0002_event_runtime_grants.sql`, `0003_ingestion_rejection_and_event_conflict.sql` and `0004_projection_foundation.sql` are **all unapplied**, and **no managed migration is authorized** (the default migrator applies every pending migration, so a run would apply `0002`, `0003` and `0004`). There is no `0005`. **Stage 3.4 is in progress: Stage 3.4.1 (projection foundation, ADR-0034, migration `0004`) is COMPLETE and merged via PR #19 (merge commit `580568dcb342b8017bec25e93d6f8396ac9b3ef0`); Stage 3.4.2 (the internal projection registry, ADR-0035, no migration) is implemented locally and pending independent review; Stage 3.4 as a whole is incomplete and Stage 3.5 remains blocked.** Migration `0004` is local/CI only; no managed readiness for `0004` is claimed and no managed migration is authorized. HTTP endpoints and worker loops remain absent; Phase 3 is NOT complete.** Approval of the *decisions* is not authorisation to *implement* them, and approval of one stage is not authorisation for the next.
