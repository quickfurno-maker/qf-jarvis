# ADR-0138 — QFJ-P09 D2a: accepted-event write-path and provenance hardening

**Status:** **Proposed** — implementation on a feature branch, **PR open, NOT merged.**
**Baseline:** `fb23e46efbad66b6a82ecc9920c86548aeb058e1` (main after PR #178 / ADR-0137)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited, no Core code read or modified in this slice**

**Core-independent.** No live event transport, no Core modification, no managed Supabase, no
n8n/provider/Meta, no message sent, **no migration**, rollout **OFF**.

Supersedes nothing. Implements the `D2a` prerequisite locked by
[ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md) and re-affirmed
as mandatory by [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md) (Q15).

---

## Context

ADR-0135 chose **Model 2**: Jarvis derives a local communication-state projection from
**authenticated, adopted** primitive Core events. It also recorded, honestly, why that word
_authenticated_ was not yet earned:

> The evidence reader is a least-privilege **DATA-ACCESS** boundary, not an authentication boundary.
> Joining to `qf_jarvis.event` and re-parsing proves reachability and shape — **never origin**.

And ADR-0134 established the matching identity rule: **`eventId` is a name any caller can type, not a
credential.** Provenance comes only from the verify → prepare → persist path, never from a bare
envelope, a bare id, or a raw event-backbone row.

So before D2a the trust story had a hole that no amount of reader hardening could close: **if any
package could write a row into `qf_jarvis.event`, then a row's existence proved nothing about how it
got there.** D2a closes the write side so that D4's reader is allowed to call its output trusted.

---

## Audit at the exact baseline

This is the inventory the slice was designed against. It is reported in full because the brief
required it and because "there is only one caller" is exactly the assumption that makes a boundary
rot.

### 1. The low-level write primitive

| Symbol                                     | Where                                                                | Pre-D2a reachability                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `storeValidatedEvent`                      | defined `packages/event-backbone/src/persistence/event-store.ts:221` | **ROOT-EXPORTED** from `packages/event-backbone/src/index.ts` — importable by **every** package and app |
| `EventPersistenceRecord`                   | defined `event-store.ts:68`                                          | **ROOT-EXPORTED** as a type — so a caller could hand-build the exact argument                           |
| `persistPreparedEvent`                     | `packages/event-ingestion/src/ingest/persist-validated-event.ts:132` | already internal; `public-api.test.ts` asserted it is not exported                                      |
| `buildEventPersistenceRecord`              | same file, `:83`                                                     | already internal                                                                                        |
| `createEventIngestor`                      | `packages/event-ingestion/src/ingest/create-event-ingestor.ts:117`   | public — **correctly**; it is the trust boundary                                                        |
| `prepareValidatedEventFromVerifiedRawBody` | `ingest/prepare-validated-event.ts:214`                              | internal                                                                                                |
| `verifySignatureWithEvidence`              | `signature/verify.ts:158`                                            | internal                                                                                                |
| `recordEventConflict`                      | `persistence/conflict-store.ts`                                      | internal — already contained, and D2a follows that precedent                                            |

**Production callers of `storeValidatedEvent`: exactly one** —
`persist-validated-event.ts:137`, the governed ingestion bridge. Every other reference at the baseline
was a test, or a _negative_ text-scan in another package's containment test asserting that package
does not mention it.

**That single caller was not the point.** The bypass surface was not "who calls it today" but "who
_may_": nine-plus packages already depend on `@qf-jarvis/event-backbone`, and the writer sat on its
root barrel next to `createDatabasePool` and `withTransaction`. The file's own header said so:

> **That trust is a caller obligation, not a structural guarantee this package can enforce.** …
> nothing here — no type, no package boundary — prevents a caller from hand-building a record and
> storing an unauthenticated event.

D2a's job was to turn that sentence into a false statement.

### 2. Direct SQL writers to the canonical event table

| Location                                                                                                 | Kind                | Verdict                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| `event-store.ts:168` `INSERT INTO qf_jarvis.event`                                                       | runtime production  | **the one canonical writer**                            |
| `tests/event-log-persistence.integration.test.ts:79`                                                     | test fixture        | not production                                          |
| `tests/projection-ordering.integration.test.ts:96`                                                       | test fixture        | not production                                          |
| `migrations/0001_event_log.sql` (+ `0002`–`0007` referencing it)                                         | **DDL / migration** | **not a runtime bypass** — D2a does not flag migrations |
| `projection-event-reader.ts:34`, `projection-subject-reader.ts:44`, `projection-retry-exhaustion.ts:133` | `SELECT` / `JOIN`   | **read side** — untouched by D2a                        |

So the direct-SQL position was **already sound**; what it lacked was a test that would notice a
second writer appearing. It has one now.

### 3. Root exports, lint and existing boundary tests

- `packages/event-backbone/src/index.ts` exported a 39-symbol runtime surface including the writer.
- ESLint already used `no-restricted-imports` for purity boundaries, and — the direct precedent —
  **ADR-0044's subject-reader boundary**, a `files` + `ignores` block that bans a module for every
  handler except the one permitted to import it. D2a reuses that shape rather than inventing a
  framework.
- The surface was locked in **19 places**: `event-backbone`'s own `public-api.test.ts`, its
  `stage-3-4-5b-containment.test.ts` exports-map assertion, `apps/worker`'s consumer-view count, two
  `apps/api` package-API count tables, and fourteen mirrored `toHaveLength(39)` tripwires across
  unrelated packages. All were updated deliberately (see **Public API impact**).
- `scripts/check-dist-containment.mjs` governs **`event-ingestion`**, not `event-backbone`, and its
  "exports only `.`" rule applies to that package. `event-backbone` already published two
  `./internal/*` CLI subpaths, consumed in-process by `apps/worker`.

---

## Decision

**Make the governed ingestion path the only accepted-event write path repository application code can
compile and lint.** Four changes, smallest first.

### A. The write authority leaves the root barrel

`storeValidatedEvent` and `EventPersistenceRecord` are removed from
`@qf-jarvis/event-backbone`'s root. The **read-side outcome surface stays** — `StoredEvent`,
`DuplicateEvent`, `EventPersistenceOutcome`, `ConflictingEventDigestError`,
`EventPersistenceConsistencyError` — because callers must still handle outcomes and errors.

This is the "separate read types from write authority" rule applied literally: **the writer does not
ride along because its record type happened to be useful.**

The primitive is **not** deleted or hidden. It remains exported from its own module and is exercised
directly by the store's integration tests, exactly as `recordEventConflict` is real-but-unreachable
from the root. Pretending it does not exist would be a worse lie than the one D2a is fixing.

### B. Provenance comes from control flow, not caller data

A new module, `packages/event-backbone/src/persistence/event-write.ts`, publishes the only
cross-package write:

```ts
storeAuthenticatedEvent(pool: DatabasePool, write: AuthenticatedEventWrite)
```

It does **not** take a record. `AuthenticatedEventWrite` is a class with:

- a **`#private` field** (`#record`) — which makes it **nominally** typed, so **no object literal can
  satisfy it**; and
- a **`private constructor`** — so it cannot be `new`-ed by a TypeScript caller; and
- a **module-private `Symbol` mint guard** — because `private` is erased at runtime, a cast or a
  JavaScript caller would otherwise still construct one. Without the symbol, the constructor throws
  `UnmintedEventWriteError`.

There is **no `verified: true`, no `trusted: true`, no `source: 'ingestion'`, no boolean and no string
tag anywhere in this capability.** Those were considered and rejected: TypeScript's structural typing
makes every one of them forgeable by writing an object literal, which is precisely the "structurally
forgeable verified object" the brief forbids. The type-level rejection of all five forgeries is
asserted with `@ts-expect-error`, so if any of them ever starts compiling, **the build fails**.

The mint is `AuthenticatedEventWrite.fromVerifiedIngestion(record)`, and it is deliberately **not a
validator**. It cannot re-check a signature: the evidence types live in `@qf-jarvis/event-ingestion`
and the dependency direction is one-way (`event-ingestion → event-backbone`, never the reverse). Its
guarantee is **reachability, not cryptography** — and saying so plainly is the point of this
paragraph.

### C. One governed persistence entry

The capability is published on a narrow subpath,
`@qf-jarvis/event-backbone/internal/event-write`, following the existing `./internal/*` convention.
The bridge, `persist-validated-event.ts`, now builds the record from bound evidence, mints the
capability, and calls `storeAuthenticatedEvent`. **The record is built first and the mint happens
after** — so a mispaired evidence/prepared-event throws `EvidencePreparationMismatchError` before any
capability exists. There is one adapter; the trust logic is not cloned.

### D. Direct-SQL and import containment, tested

- **ESLint** bans both the package specifier and the deep relative form
  (`**/persistence/event-write.js`) across `packages/**/*.ts` and `apps/**/*.ts`, with `ignores`
  naming **exactly one production file**: `persist-validated-event.ts`. In-package tests of the
  capability, and the D2a tests that police this very boundary, are also exempted — the claim is about
  **production application code**, not about the tests enforcing it.
- **A repository-wide scan** asserts no second production `INSERT INTO qf_jarvis.event` exists, and
  separately asserts that **migrations and projection readers are not mistaken for bypasses** — DDL
  legitimately names the table, and the readers only `JOIN` it.
- **The lint rule is executed, not just read.** One test writes short-lived probe files at real
  package paths, runs the repository's real ESLint over them in a single pass, and asserts the rule
  fires — including on a file **next door to the writer**, proving the permission is file-exact rather
  than directory-wide. A configured-but-dead rule (shadowed by a later flat-config block, or with a
  `group` pattern that never matches) would pass a config-text check and fail this one.

---

## Consequences

### What is now true

- **`storeValidatedEvent` is unreachable from every package and app.** It is not on the barrel, and
  no subpath exposes it.
- **The one reachable writer cannot be called with caller data.** Five named forgeries fail to
  compile; `new` fails at compile time and throws at runtime.
- **The permission is one file, not one directory.**
- **A second production INSERT, a second importer, a widened `ignores`, or a re-export would fail a
  test** rather than passing review quietly.
- **The trust ordering is untouched.** D2a changed no verification, no parsing and no transaction:
  `createEventIngestor` still runs **verify → prepare → persist**, `storeAuthenticatedEvent` adds no
  behaviour beyond unwrapping, and the enforced `READ COMMITTED` isolation, single-transaction
  conflict recording and `eventId` idempotency semantics are byte-for-byte the same code.

### The exact claim

> **Within the qf-jarvis application trust model, a canonical event row reached through the governed
> event ingestion/persistence path cannot be established by another repository production import or
> runtime SQL writer without violating tested containment.**

### The exact limits — what D2a does NOT claim

- **NOT** "the database cryptographically proves every row was signed." It does not. **Whatever the
  database grants permit, a DBA, a migration, a psql session, or any other credential holder outside
  this repository can still write the table.** D2a is **repository/application-path** provenance
  hardening, not external DBA-proof provenance. No grant or role was changed, and none was needed for
  the claim above — a claim about _repository code paths_ is met by containing repository code paths.
- **NOT** a claim that Core emitted anything. No Core event is live, adopted, or wired.
- **NOT** a replacement for Core signatures. Q15 stands: Core must sign, and D2a is required
  _regardless_ — signing does not replace write-path containment, and containment does not replace
  signing. Both.
- **NOT** retroactive. Rows written before D2a carry whatever provenance they always did.
- **NOT** proof that a stored payload is the exact signed body. ADR-0135's honest finding stands: the
  raw signed bytes are not persisted, so post-hoc re-verification proves only that _a_ body with the
  stored digest was signed. D2a did not change that, and does not paper over it.
- **NOT** D4 or D5. No evidence reader and no projection was built here.

### Public API impact

`@qf-jarvis/event-backbone`'s root runtime surface goes **39 → 38**. That is one deliberate removal —
`storeValidatedEvent` — and `EventPersistenceRecord` left with it as a type, which never counted
toward the runtime surface.

Every repository consumer was inspected: **the only production importer was the ingestion bridge**,
which now uses the governed subpath. The package is workspace-private (`"private": true`), so **no
supported external contract depended on it.** The surface locks were updated **intentionally** in
19 places, each with the reason recorded at the site: `event-backbone`'s `public-api.test.ts` and
`stage-3-4-5b-containment.test.ts`, `apps/worker`'s consumer view, two `apps/api` count tables, and
fourteen mirrored tripwires. **No compatibility shim was added** — a shim preserving the unsafe writer
would have preserved the bypass.

### Migration posture

**NONE. No migration was allocated and `0013` is not reserved.** D2a is code- and module-level
hardening, exactly as ADR-0137 §6.3 anticipated. **No database role or grant was changed.** The audit
did not produce a case for one: the D2a claim is scoped to repository production paths, and grants
govern actors outside that scope — which is why the limitation above is stated rather than hidden
behind a migration that would not have closed it either.

### What this unblocks

**D4 (trusted evidence-read capability) may now rely on this repository/application-level trust
prerequisite, once this ADR is merged.** ADR-0135 locked D2a as D4's blocker; that blocker is
resolved at the repository trust level, and D4 remains subject to its own review.

**D2a does not unblock D5**, does not wait for **D2b** (parallel and independent, per ADR-0137 §6.2),
and does not wait for **C0/C1/C2/C3A/C3B**. Nothing here is activated: production rollout remains
**OFF** and the runtime is unchanged.

---

## Alternatives considered

- **Leave the writer exported and rely on the documented caller obligation.** Rejected — that is the
  status quo whose own header admitted it was not a structural guarantee. Review discipline is not
  containment.
- **A `{ verified: true }` / `{ trusted: true }` / `{ source: 'ingestion' }` discriminator.**
  Rejected — TypeScript is structurally typed, so any caller can write that object literal. This is
  the forgery class the brief names, and it is now a compile error under `@ts-expect-error`.
- **Delete `storeValidatedEvent` and inline the INSERT into the bridge.** Rejected — it would move a
  transactional, conflict-classifying, isolation-pinning primitive across a package boundary and put
  the write in a package that holds no pool, for no gain in containment.
- **A database role/grant split so the application role cannot INSERT.** Rejected **for this slice**,
  not forever. It would not strengthen the claim actually made (repository production paths), it
  needs a migration ADR-0137 declined to allocate, and the audit produced no evidence it is required.
  Recorded here as an option, not scheduled.
- **A generic capability framework for every sensitive primitive.** Rejected — the brief asked for the
  smallest safe hardening that fits the repository, and ADR-0044's boundary shape already fits.
- **Keeping a compatibility re-export.** Rejected — it would preserve the exact bypass D2a exists to
  close.

---

## Posture

No production behaviour changed. No contract, event registry, event-backbone schema, ingestion
semantic or projection changed. No Core modification, branch or PR. No managed Supabase. No n8n or
provider access. No message sent. **No migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
