# ADR-0078 — QFJ-P08-B Durable Runtime Composition and Startup Readiness

**Status:** Accepted — QFJ-P08-B3 (startup readiness + the internal `apps/api` composition; no HTTP, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0004](./ADR-0004-modular-monolith-first.md) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0064](./ADR-0064-production-credential-binding.md) · [ADR-0074](./ADR-0074-qfj-p08-a-conversation-control-command-foundation.md) · [ADR-0075](./ADR-0075-qfj-p08-a-writable-conversation-control-composition.md) · [ADR-0076](./ADR-0076-qfj-p08-b-tenant-scoped-authoritative-state.md) · [ADR-0077](./ADR-0077-qfj-p08-b-durable-postgres-conversation-state.md)

## Context

Baseline: `main` at `7eaf993353ad00b5c1e81318fd5a07a74b8d3fb0`, the merge of PR #80 (QFJ-P08-B2). Collision
checks on that baseline: migrations `0001`–`0008` present, `0008` at
`e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10`, no `0009`; `ADR-0078` unclaimed;
zero open PRs; `apps/api` root exports zero runtime symbols and runs no HTTP server.

ADR-0074 built the reducer. ADR-0075 composed a writable capability onto the ONE authoritative state
source. ADR-0076 ratified the identity model. ADR-0077 made it durable in PostgreSQL. And nothing
wired any of it together — so on merged `main` the only `authoritativeState` a real
`createJarvisRuntime` could receive was the in-process fake under `./testing`. **A human takeover
still died with the process.** Every part of the mechanism existed; the seam did not.

**One PR, not two.** The read-only inspection found no contradiction blocking the work, so the
readiness capability and the composition land together. Splitting them would have produced a package
capability with no caller and an application with nothing to check.

## Decision

### 1. A non-mutating `assertReady()` on the durable adapter

Added to the `PostgresConversationStateAdapter` **type** only: the package root still exports exactly
**3** runtime symbols and **4** types, and the adapter still does not implement
`readOperationsProjection`.

It verifies the runtime-visible B2 contract: both tables exist with every column the adapter reads or
writes (zero-row `SELECT … WHERE false`); the critical CHECK constraints exist; the composite state
primary key and the tenant-scoped command unique are compared **by definition, not by name**; the
foreign key exists; both row triggers exist **and fire**; and the CURRENT principal holds the minimum
privileges — `SELECT, INSERT` on both tables plus column-level `UPDATE` on the four operator-owned
columns.

Three choices are load-bearing:

**It is strictly non-mutating.** Every probe is a `SELECT`; `WHERE false` resolves every column and
returns nothing. No row is written, locked or provisioned, no transaction is opened, no advisory lock
taken. Readiness that changed what it checked would be a migration under another name.

**It compares two constraints by definition.** A primary key named `…_pk` on `conversation_id` alone
would satisfy any existence check while silently re-imposing the global-uniqueness assumption
ADR-0076 exists to remove. A plausible wrong schema is more dangerous than a missing one.

**It does not read `schema_migration`, and needs no privilege on it.** That table is migration-tooling
state. Requiring the runtime role to read it would grant a deployment principal visibility it has no
operational need for, and would make a _recorded_ migration rather than the _actual_ schema the thing
startup trusts — which is exactly what a hand-repaired database with an intact ledger row defeats.

A disabled trigger counts as missing. `REPLICA`-only counts as disabled: for this process it never
fires, and a guard that is present but silent is worse than one that is absent.

### 2. Two SQLSTATE classification corrections

`42501` insufficient_privilege now maps to `schema-incompatible` rather than `repository-invariant`. A
principal refused permission on its own tables has not found contradictory data; it is connected to a
database whose GRANTS are not the ones 0008 issues. A caller reading `repository-invariant` would go
looking for corrupt rows instead of a deployment misconfiguration.

And `error.code` is now only treated as a SQLSTATE when it _looks_ like one. `pg` puts the server's
five-character SQLSTATE there — but a connection that never reached a server puts a Node errno there
instead (`ECONNREFUSED`, `EPIPE`). Classifying an errno as a server rejection produced
`repository-invariant` for an unreachable database: the adapter reporting corrupt durable evidence
when nothing was ever reached. B3's startup-failure proof surfaced it. No new error code either way.

### 3. The composition is INTERNAL to `apps/api`

`apps/api/src/runtime/durable-jarvis-runtime.ts`, and deliberately **not** exported from the package
root, which stays at **zero** runtime exports. A composition root other packages could import would
stop being a boundary and become a library (ADR-0004). No HTTP server, route or health endpoint.

Two layers, because they have different owners:

- `composeDurableJarvisRuntime({ pool, runtimeConfig })` — for a caller that already owns a pool. It
  never closes that pool, not even on failure: closing something you did not create is how one
  subsystem's error becomes another's outage.
- `startDurableJarvisRuntime({ databaseConfig, runtimeConfig })` — creates the pool, composes, and on
  ANY failure closes the pool before rejecting. Returns a frozen `{ runtime, close }` and nothing
  else: the pool, the adapter, the `DatabaseConfig` and the connection string stay in the closure.

`provision` is deliberately unreachable from that lifecycle. Auto-provisioning a missing conversation
would be this application inventing `partyType` and `dataClass` — business facts only QuickFurno Core
may supply, which is precisely why ADR-0077 made provisioning a separate trusted method.

### 4. The order IS the safety property

pool → adapter → **readiness** → runtime. Readiness is awaited before `createJarvisRuntime` is
called, so a schema or grant mismatch produces a process that refuses to start rather than a runtime
that refuses every conversation. Every B2 path already fails closed — but failing closed one message
at a time, in production, with a real conversation waiting, is not the same as refusing to start.

There is no lazy first-use check, no fake source swapped for a real one later, and **no in-memory
fallback**. A fallback would trade the durability guarantee for availability at exactly the moment
durability matters, and nothing downstream could tell the difference.

### 5. Configuration is explicit input

The `DatabaseConfig` is supplied already validated, through `event-backbone`'s public API. B3
production reads no environment variable, no `DATABASE_URL`, and no secret file. Acquiring deployment
configuration belongs to a future executable bootstrap, exactly as ADR-0064 established for the
model credential: reusable code receives configuration; only a process boundary acquires it.

`DATABASE_URL` is read by ONE test-only harness, excluded from the emitting build, guarded by loopback
host, test-shaped database name, and a refusal of anything Supabase-, QuickFurno- or
production-shaped. The containment suite pins that to one file and one variable.

### 6. Provenance: `qfj.jarvis-runtime.p08b3`, injected by the application

The GENERIC `@qf-jarvis/jarvis-runtime` default stays `qfj.jarvis-runtime.p08b1` and is **not**
touched: it describes what the package is, and a library that renamed itself because an application
composed it differently would make provenance a moving target. The durable composition stamps
`p08b3`, so an audit can tell a PostgreSQL-backed turn from an in-memory one. Every other supplied
provenance reference passes through untouched, and `runtimeRef` is omitted from the caller's type so
a caller cannot claim durability it is not running on.

### 7. No migration, no schema write

B3 creates no migration and modifies none: the set stays `0001`–`0008`, byte-identical, with no
`0009`. It runs no migration at startup and attempts none on failure. Migrations are applied by test
setup, and in deployment by the existing separately-governed lane. Managed PostgreSQL still carries
`0001` only; `0002`–`0008` remain unapplied. No managed access of any kind was performed.

### 8. The operations projection stays honestly unavailable

The durable adapter does not implement `readOperationsProjection`, so
`readConversationOperationsSnapshot` returns `{ ok: false, reason: 'operations-unavailable' }`. No
governed writer exists for the six supplemental fields (ADR-0076 §9), and fabricating tokens to make
an interface light up is worse than an honest refusal.

### 9. A conversation REVISION is not an authored VERSION

B3's first attempt at the restart proof could not serve a freshly provisioned conversation, and the
cause turned out to be a **semantic-domain conflation pre-existing on merged `main`**: a generic
authored-version schema was being reused to validate conversation revisions.

An authored **VERSION** — a knowledge citation, a model reply citation, a proposal — is one-based and
small: there is no version 0 of a document that exists, and a version in the millions is a bug rather
than a catalogue. A conversation **REVISION** is a different thing entirely. It is a monotonic
compare-and-set counter over one conversation's safe state, and its domain is fixed by the durable
schema that owns it: migration 0008 requires every new state row to start at **0** and permits values
through `Number.MAX_SAFE_INTEGER` (`9007199254740991`).

Both were `z.int().min(1).max(1_000_000)`, at three sites in two packages:

| Package                 | Field                                     | Was       | Now        |
| ----------------------- | ----------------------------------------- | --------- | ---------- |
| `agent-runtime`         | `contextSchema.revision`                  | `VERSION` | `REVISION` |
| `agent-runtime`         | `proposalSchema.expectedRevision`         | `VERSION` | `REVISION` |
| `core-decision-adapter` | `coreCommandResponseSchema.boundRevision` | `VERSION` | `REVISION` |

Two real consequences. A conversation provisioned and never touched by an operator — revision 0,
which the durable trigger REQUIRES — could never be served. And any conversation whose revision passed
1,000,000 would have become permanently unservable, silently, long after deployment.

The `core-decision-adapter` site failed later and more misleadingly than the other two: a revision-0
conversation passed every M1/M2 gate, produced a model draft, reached Core, received a legitimate
`ACCEPTED` echoing `boundRevision: 0`, and was then discarded during response validation as
**`CORE_UNAVAILABLE`** — a bounds bug wearing the costume of a Core outage.

**`VERSION` was not widened.** It also governs `proposalVersion` and both citation versions, so
relaxing it would have admitted version 0 into three unrelated contracts to repair a fourth. Instead
each of the two files gained a **private** `REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER)`,
reaching only the revision-bearing fields. Neither constant is exported; no package root API changes.

At `Number.MAX_SAFE_INTEGER` a read, a gate and a proposal binding all remain valid; a
**state-changing** control command is still governed by the existing `revision-exhausted` semantics in
`@qf-jarvis/conversation-control`, which are untouched.

**Why nothing caught this earlier.** The in-memory fake starts at revision 1 — a value the durable
schema cannot produce. That is the precise reason a fake is not evidence about a database, and it is
why the correction is proved against a real revision-0 row rather than a fixture.

A sweep confirmed there are no other sites:
`agent-runtime/contracts/operations-center.ts` and `conversation-control/internal/grammar.ts` already
used `0..MAX_SAFE_INTEGER`; `jarvis-runtime` passes the revision through without re-validating it.

## Rejected alternatives

- **Lazy readiness on the first inbound turn.** Moves a deployment error into a live conversation.
- **An in-memory fallback when PostgreSQL is unavailable.** Silently discards the guarantee.
- **A `provision` on the returned lifecycle.** Auto-creating a conversation invents Core-owned facts.
- **Reading `DATABASE_URL` in `apps/api` production.** ADR-0064's boundary rule, unchanged.
- **Reading `schema_migration` at startup.** Trusts a recorded checksum over the actual schema, and
  needs a privilege the runtime role should not hold.
- **Exporting the composition from the `apps/api` root.** The application boundary would become a
  library, and the root API lock exists to prevent exactly that.
- **Requiring an EXACT privilege match at startup.** Least privilege is proved by 0008's own tests; a
  startup check that refused a principal holding MORE would fail every owner-run local database.
- **Widening the shared `VERSION` schema to unblock revision 0.** A one-line fix that would also
  have admitted `proposalVersion: 0` and citation `version: 0` — loosening three unrelated contracts
  to repair a fourth. Two private `REVISION` schemas instead.
- **Correcting only `agent-runtime` and leaving the Core response bound.** A revision-0 turn would
  have drafted, reached Core, been accepted, and then failed as `CORE_UNAVAILABLE`: a worse failure
  than the original, because it is expensive and misattributed.
- **Keeping the `PAUSE_AI`/`RESUME_AI` warm-up.** It moved a fresh conversation off revision 0 and
  would have left two meaningless commands in the durable audit of every new conversation, hiding a
  contract defect behind operator noise.

## Consequences

A human takeover now survives a real process restart through the real `createJarvisRuntime` path,
proved across four independent pools/adapters/runtimes with a database as the only continuity, and
with the model and Core call counts at zero for every blocked turn. The sequence runs on the natural
revisions the durable schema produces — `0 → 1 → 2 → 3`, with exactly three operator commands in the
ledger (`TAKE_OWNERSHIP`, `RELEASE_OWNERSHIP`, `RESUME_AI`) and no warm-up records. A freshly
provisioned revision-0 conversation is served directly. A database outage after startup
fails closed with no fallback. A schema, trigger, constraint or grant mismatch refuses at startup and
closes the pool it opened.

`apps/api` gains exactly three production workspace edges — `event-backbone`, `jarvis-runtime`,
`postgres-conversation-state` — and three test-only ones. No new third-party resolution; `pg` is in
neither list. The root API stays **0**, every package-root runtime API lock is unchanged, and the
`JarvisRuntime` object is still exactly three methods.

**QFJ-P08-B is complete when this merges.** Canonical QFJ-P08 is **not**: consent and opt-out state,
the approval request/decision runtime, and the operator interface remain unimplemented, and
`ApprovalRequestV1` still requires a `recommendationId` no producer exists for. **NEXT is QFJ-P05.05
Recommendation Runtime**, then a return to the P08 approval runtime. Production rollout remains OFF.

## Non-goals

No HTTP server, route or health endpoint. No operator API, UI or authentication. No production
provisioning or Core-synchronization caller. No operations-projection producer. No consent, approval
or recommendation runtime. No P09 transport, WhatsApp or n8n. No live Core, provider or LAN model
call. No persistent memory, dataset or training. No send, deliver, execute or authorize path. No
migration created or modified, and no `0009`. No managed database access, managed migration or
deployment.

## Change-control rule

`assertReady()`'s required-object lists are part of the B2 storage contract: adding a constraint or
trigger to migration 0008 in a later slice means adding it here, in the same change, or startup will
attest to a schema it no longer fully checks.
