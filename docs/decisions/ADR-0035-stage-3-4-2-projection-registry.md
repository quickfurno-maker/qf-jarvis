# ADR-0035 — Stage 3.4.2: the internal projection registry

**Status:** Accepted (2026-07-19, under the owner's standing Stage 3.4 authorization)
**Deciders:** Owner
**Phase:** 3 — Stage 3.4.2

**Relates to:** [ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md) (processing, retries, dead letters, replay) · [ADR-0022](./ADR-0022-projections-ordering-and-rebuild-determinism.md) (projections, ordering, rebuild determinism) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (canonical payload privacy boundary) · [ADR-0034](./ADR-0034-stage-3-4-projections-checkpoints-and-bounded-retries.md) (Stage 3.4.1 projection foundation)

---

## Context

Stage 3.4.1 delivered the projection **schema and repositories** — `projection_checkpoint`, the append-only `projection_attempt`, two disposable metadata read models, and the internal checkpoint/attempt stores (migration `0004`, merged via PR #19, merge commit `580568dcb342b8017bec25e93d6f8396ac9b3ef0`).

What does not yet exist is any notion of **which projections exist**. The repositories key everything by `(projection_name, projection_version)`, but nothing declares that set, validates it, or hands a runner a definition to execute. Stage 3.4.3's runner cannot be written until there is something to run.

This slice supplies exactly that and nothing more: an **internal, immutable registry of projection definitions**. No runner, no lock, no retries, no handlers.

## Decision

### 1. A projection definition is a name, a version, and one handler

`ProjectionDefinition` carries a repository-owned validated `ProjectionName` (Stage 3.4.1 vocabulary), a positive version, and a single `apply(client, event): Promise<void>` handler. It is a **description**, not a runner: nothing in this layer opens a transaction, takes a lock, reads an event, writes a checkpoint, records an attempt, or decides to retry.

### 2. The handler sees event METADATA ONLY

`ProjectionEvent` carries exactly four fields:

| Field          | Meaning                                  |
| -------------- | ---------------------------------------- |
| `sequence`     | the event's monotonic ingestion sequence |
| `eventType`    | the canonical event type                 |
| `eventVersion` | the positive integer contract version    |
| `acceptedAt`   | the canonical UTC acceptance instant     |

It carries **no** payload, subject id, correlation id, event id, source, signature, free text, environment value, or provider detail.

This is the enforcement point for ADR-0034 §10's privacy claim. A handler that cannot see personal data cannot write it into a read model, so erasure survives rebuild trivially. Widening this interface widens what **every** projection may persist, so it is an ADR-gated decision rather than a convenience edit.

### 3. The acceptance instant is an immutable canonical value, not a `Date`

`CanonicalInstant` is a branded ISO-8601 string with millisecond precision and a literal `Z`.

A `Date` is **mutable**: a handler handed one could call `setTime` and corrupt state shared with the runner or a sibling handler. A string cannot be mutated, sorts and compares correctly, and has exactly one representation per instant — so two runs producing the same instant produce the same bytes, which is what rebuild determinism requires (ADR-0022 §3).

### 4. One active definition per projection name — duplicates rejected even across versions

Registration fails closed on a repeated name **even when the versions differ**.

**This is a registry policy, not a storage constraint — an earlier draft of this ADR claimed otherwise and was wrong.** Migration `0004` keys `projection_checkpoint` by **`(projection_name, projection_version)`** (constraint `projection_checkpoint_pk`), and ADR-0034 §4 derives the advisory-lock key deterministically from the projection **name and version**. Two differing versions would therefore occupy **distinct checkpoint rows** and take **distinct advisory locks**; they would not inherently contend for either.

The rejection is instead a deliberate Stage 3.4.2 decision:

- **one active definition per logical projection name** within one registry;
- **a version bump replaces** the active definition, rather than silently leaving two definitions running under one logical name;
- **side-by-side versions are out of scope for this slice.** Deliberately operating two versions of a projection concurrently — for a shadow rebuild or a staged cutover — is a real strategy, but it needs its own ADR plus a distinct logical naming and deployment policy so that operators can tell the two apart. It is not something a registry should permit by accident.

A version bump rebuilds from sequence 0 under the new `(name, version)` identity (ADR-0022 §6).

### 5. Fail closed on everything malformed — and treat the caller as hostile

Rejected: invalid or non-string names; versions that are zero, negative, fractional, infinite, `NaN`, unsafe, or beyond the storable `INTEGER` range; missing or non-function handlers; non-object definitions; a non-array registry input; an empty registry; and a registry whose reported length exceeds the fixed bound `MAX_PROJECTION_REGISTRY_SIZE` (**1024**). An empty registry is a configuration mistake, not a valid deployment.

Validation additionally assumes the candidate object is **adversarial**, because a definition can be assembled from configuration or another module:

- **Semantic instant validation, not shape matching.** A regex accepts `2026-02-30T02:46:50.123Z`, `2026-13-19T…`, `…T24:00:00.000Z`, `…T02:60:00.000Z` and `…T23:59:60.000Z` — none of which is a real instant. `isCanonicalInstant` therefore requires a **byte-exact round trip**: parse, re-serialise with the intrinsic serialiser, and demand equality with the input. An impossible date either fails to parse or silently rolls over (Feb 30 → Mar 2, hour 24 → next midnight), and the rolled-over serialisation no longer matches. It never throws and never surfaces a native parse error.
- **Intrinsic `Date` conversion.** A `Date` is converted using the intrinsic `Date.prototype.toISOString` captured at module load, invoked with the supplied object as receiver — never `value.toISOString()` or `value.getTime()`, both of which a subclass can override to return arbitrary text. The intrinsic call doubles as a brand check: it throws for anything lacking a `[[DateValue]]` slot, so a plain object impersonating a `Date` cannot pass.
- **Single-snapshot reads.** `name`, `version` and `apply` are each read **exactly once** into locals; only those locals are validated, and only those same locals are frozen. A getter therefore cannot return a valid value to the validator and a different one to the copier.
- **Repository-controlled array snapshot.** The registry never calls the caller's `slice` (an ordinary, overridable own property); it copies through an indexed loop under its own control, with a validated `length`.
- **Contained caller failures.** A throwing getter, a throwing proxy trap, a revoked proxy, or a hostile `length` becomes a typed `…-unreadable` error. The `catch` around caller-controlled reads is **unconditional** — it never re-inspects or rethrows the caught value — so a caller that deliberately throws a `ProjectionRegistryError`, a subclass, or an error carrying a secret `message`/`code`/`cause` cannot have it survive; every deliberate classification (non-array, empty, duplicate, too-large) is instead raised **outside** any caller-controlled `catch`. The original error is **discarded, not wrapped**: it is caller-controlled and would carry its text along as `cause`.
- **Bounded snapshot — a construction-time DoS/configuration safeguard.** The reported `length` is checked against `MAX_PROJECTION_REGISTRY_SIZE` (**1024**) **before any element is read**, so a sparse array or a proxy whose `length` trap returns `Number.MAX_SAFE_INTEGER` cannot drive the copy loop even once. Phase 3 defines exactly two proof projections, so the bound is deliberately generous — it never constrains legitimate use, only a hostile or misconfigured input. It is internal to the projection-registry module and is **not** exported from the package root.
- **Runtime-normalised error codes.** Both error types accept **only a code**, but the static type is not a runtime guarantee — a caller can `as`-cast an unbounded secret into the code position. Each constructor therefore normalises its argument against the closed message table (via `hasOwnProperty`, never `in`); an unrecognised value collapses to the safe fallback (`projection-definition-invalid` / `projection-registry-invalid`), so neither `message` **nor** `code` can ever carry caller text.

### 6. Definitions are copied and frozen; the caller is never trusted

Each definition is validated and **copied onto a fresh frozen object**, and the input array is copied before use. Mutating the caller's array or objects after construction cannot change the registry, and extra properties are dropped rather than silently carried along.

The registry exposes **no mutable array and no `Map`** — only `get`, `has`, a frozen `list()`, and `size`. Handing out the backing collection would let any caller add, remove, or reorder projections after construction, which is precisely the mutability this type exists to prevent. `list()` is sorted by projection name using code-unit comparison (not `localeCompare`, whose result varies with runtime locale data and would make enumeration order environment-dependent).

### 7. Registration is construction-time only; the registry stays INTERNAL

There is no `register()`, no `unregister()`, no plugin loader, and no runtime mutation. Adding a projection is a code change and a migration, not a runtime call. A projection set that can change mid-cycle cannot be reasoned about for ordering, isolation, or rebuild determinism.

**No root package export is added in this slice.** The event-backbone barrel is unchanged and its 39-symbol surface is asserted by an exact snapshot in `public-api.test.ts`, so any future widening fails a test rather than passing unnoticed.

### 8. No singleton, and no real handlers yet

This slice ships **no** populated registry instance containing the two proof projections. `rm_event_type_activity` and `rm_daily_event_acceptance` handlers are **Stage 3.4.5**, together with the isolation proof. Unit tests use dummy handlers only.

### 9. Errors are typed and safe

`ProjectionDefinitionError` and `ProjectionRegistryError` carry a stable `code` and a **fixed, repository-owned message**.

**Fixed by construction, not by convention.** Each error class exposes a constructor that accepts **only a code**; the message is looked up from a closed, module-private table keyed on that code. There is deliberately **no public constructor path accepting an arbitrary string**, so no call site can pass caller text even by mistake. A caller's thrown error is discarded rather than retained as `cause`.

No error embeds the offending value, a handler's source text, a stringified object, a payload, or any unbounded caller input — a payload or sender-derived string must not cross this boundary ([ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md)), and a definition can be built from caller-supplied data. Even the duplicated projection name is withheld: the type stays safe by construction rather than by the caller happening to pass trusted data. Callers branch on `code`, never by parsing a message.

### 10. Managed status — unchanged

Managed PostgreSQL remains **`0001`-only**. Migrations `0002`, `0003` and `0004` remain **unapplied**, and **no managed migration is authorized** — the supersession recorded in ADR-0034 §13a still stands. This slice adds **no migration**; there is no `0005`.

## Consequences

**Positive.** The projection set becomes a single, validated, immutable, deterministically-ordered value that the Stage 3.4.3 runner can consume without defensive copying. The metadata-only handler interface makes the privacy guarantee structural rather than a review convention. Fail-closed validation moves an entire class of deployment mistakes to construction time.

**Negative — accepted.** Projections cannot be added at runtime, which is deliberate and permanent for Phase 3. The registry has no consumer yet — the runner arrives in Stage 3.4.3 — so this slice ships a foundation whose value is only realised by the next one. Rejecting duplicate names across versions means a version bump is a replacement rather than a parallel rollout; a side-by-side rebuild strategy, if ever wanted, needs its own ADR and a distinct name.

## Explicit exclusions

Stage 3.4.2 does **not** add: a SQL migration of any kind (no `0005`); advisory-lock SQL or lock-key derivation; transactions, `SAVEPOINT` logic, event reads, or runner results; retry/backoff constants or retry execution; either proof-projection handler; read-model writes; rebuild or version-bump execution; dead letters, replay, quarantine, or unblock (Stage 3.5); a scheduler, worker loop, HTTP endpoint, or any `apps/` change; a package-root or `package.json` export; and any Supabase, managed-database, Core, n8n, WhatsApp, or provider access.
