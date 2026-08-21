# ADR-0109 — QFJ-P09.04: durable execution dispatch composition

**Status:** Accepted — offline composition only (no transport adopted, no live send, no new migration,
no managed-database access, no provider, no rollout). QFJ-P09 remains **INCOMPLETE**.

**Date:** 2026-08-21

**Supersedes:** nothing. [ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md)
and [ADR-0091](./ADR-0091-qfj-p09-03-durable-execution-replay-idempotency-store.md) remain the owners
of everything they decided, and their bodies are unchanged.

---

## Context

QFJ-P09.02 made the dispatch boundary's `replayGuard` **required and defaultless**, and ADR-0090
recorded the reason in plain terms: an in-memory guard passes every test and loses its state on every
restart. QFJ-P09.03 then supplied the durable PostgreSQL implementation of exactly that guard.

ADR-0091 also recorded, accurately, that **no application composes it**.

So the repository held two merged halves of one capability and no seam between them. That is not a
missing feature — both halves work and both are proved. It is a missing _composition_, and its
absence has a specific cost: every caller has to assemble the two, and a caller who assembles them is
a caller who can assemble them **wrong** — with an in-memory guard, with a guard pointed at the wrong
database, or with no guard reaching the durable store at all.

The prior roadmap status said no QFJ-P09 successor slice was owner-locked, and that naming one would
mean inventing it. That is no longer true: the owner has locked this one.

## Decision

Add **QFJ-P09.04 — Durable Execution Dispatch Composition**: one narrow composition package,
`@qf-jarvis/execution-dispatch-composition`, that binds the merged P09.02 verifier to the merged
P09.03 durable store, and does nothing else.

### What it guarantees

A boundary built by `createDurableExecutionDispatchBoundary({ pool, registry, options? })` is durable
**by construction**. The guard is created inside the factory from the caller's pool, so there is no
seam through which a process-lifetime guard can enter — no parameter, no default, no override.

The composition returns the P09.02 result **verbatim**. It classifies nothing itself: wrapping those
closed dispositions and reason codes into a local taxonomy would destroy the classification the
boundary exists to produce, and a caller would lose the ability to tell a forged signature from an
expired intent from an unavailable store.

### What it deliberately is not

**No transport is adopted.** There is no URL, webhook, endpoint, HTTP client, n8n client, workflow id,
credential, provider client, message or recipient anywhere in the package. Nothing sends, executes,
schedules, retries, polls or queues. The Core → n8n wire protocol remains **PROPOSED**.

**No new authority is created for anybody.** The permanent flow is unchanged: Jarvis recommends,
QuickFurno Core authorizes and issues the intent, this boundary **verifies**, n8n executes behind a
future adopted transport, providers deliver, and results return to Core. Composing a verifier with a
store creates no authority that neither had, and the package exposes no `canExecute`, `canSend`,
`isAuthorized`, `executed`, `sent`, `delivered`, `consentValid` or `retryAllowed` — because none of
them would be true. A verified first-seen dispatch remains a bounded validation **observation**, and
it is not permission to become execution truth later.

**No schema.** Migration **0010** belongs to QFJ-P09.03 and is reused unchanged. Composition does not
justify schema: this package creates no migration, owns no table and issues no DDL. Migrations remain
`0001`–`0010` with no `0011`, and the managed database is untouched and still carries `0001`.

**No communication lifecycle, and no execution-time consent.** A communication action still requires
execution-time consent, opt-out, DNC, quiet-hours and attempt-limit revalidation by Core and the QF
Communications Runtime. This slice implements none of it, caches none of it and cannot express it.

**The pool stays the caller's.** Construction opens no connection and performs no I/O, exactly as the
underlying store does. Readiness is answered where it matters: the first claim against a database
without migration 0010 raises `schema-incompatible`, which the dispatch boundary already converts to
`replay-guard-unavailable` and a refusal. No probe is added that the verifier could never call, and
the package never closes a pool it did not open.

### Dependency direction

The composition depends **inward** on both packages; neither depends back on it. A spec asserts that
in both directions, including in their manifests — an arrow back would make the two lower packages
unusable without this one and would let transport concerns leak downward.

## Consequences

The repository now has one restart-durable dispatch-validation path that cannot be silently
downgraded to a process-lifetime one.

**QFJ-P09 remains INCOMPLETE.** Still absent after P09.04: a real adopted Core → n8n transport and its
composition, execution-time communications eligibility integration, the 18-state communication
lifecycle runtime, provider dispatch, results and reconciliation, and production rollout. **Live send
remains OFF.** No application composes this package, and wiring it into a running application is a
later, separately authorized slice.

The decisive proof is an integration test against a **real PostgreSQL** that destroys the first
composition and its pool entirely, builds a second composition over a **new** pool against the same
database, and replays the identical dispatch — expecting `exact-replay`. An in-memory guard would
report `first-seen` twice and fail. That single assertion is the only one that can tell a durable
composition apart from a convincing one, and it is the reason this slice is worth a package.

## Change-control

The transport remains unadopted and the wire protocol remains PROPOSED. Adopting either, composing
this package into an application, or granting any execution authority requires a superseding decision.
Nothing in this ADR authorizes a migration number, a provider, a channel, an endpoint or an
activation.
