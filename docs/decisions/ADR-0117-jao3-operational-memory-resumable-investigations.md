# ADR-0117 - JAO-3 operational memory and resumable investigations

**Status:** Accepted - offline domain, local schema and composition only. No runtime activation, no
managed migration, no production rollout, no provider route, no channel, no business effect. JAO-3
is **DEFAULT-OFF** and **SHADOW**.

**Date:** 2026-08-25

**Owned by:** QFJ-P12 - Advanced Intelligence and Future Agents, capability overlay **JAO - Jarvis
Autonomy & Operations**, slice **JAO-3 - Operational Memory and Resumable Investigations**.

**JAO-3 is an overlay id, not a major phase.** It renumbers nothing, `QFJ-P00` through `QFJ-P12`
remain unchanged, there is no `QFJ-P13`, JOS remains Jarvis OS and JAO remains Jarvis Autonomy &
Operations.

**Builds on:** [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md) (the
autonomy boundary), [ADR-0115](./ADR-0115-jao1-mastra-shadow-operations-supervisor-proof.md) (the
JAO-1 shadow operational-health proof) and
[ADR-0116](./ADR-0116-jao2-governed-specialist-delegation-proof.md) (the JAO-2 governed delegation
proof). None is modified. JAO-3 is an **additive sibling**: `apps/worker/src/jao/mastra-supervisor/**`
and `apps/worker/src/jao/governed-specialist-delegation/**` are untouched and both focused suites
still pass.

---

## Context

The merged overlay requires:

> Add non-authoritative durable investigation memory: evidence references, hypotheses, checkpoints,
> owner corrections, budgets, workflow state, expiry, and supersession.

and:

> Separate operational memory from business truth explicitly. A remembered authorization is never
> current permission.

Both clauses are load-bearing, and the second is the dangerous one. An investigation that ran
yesterday may legitimately have recorded "the owner approved X". Storing that is fine. Reading it
back tomorrow as permission to do X is a system that authorises itself from its own notes, and it
would arrive not through malice but through an ordinary-looking field called `approvalGranted` that
somebody added because it was true at the time.

JAO-1 proved a supervisor can perform one bounded read and one governed model call. JAO-2 proved
delegation can be bound to a governed specialist. Neither remembers anything: both lose everything
the moment the process ends, so neither can resume an investigation, and neither has had to answer
what it is safe to write down.

## Decision

Add JAO-3 at `apps/worker/src/jao/operational-memory/` as contracts, pure policy guards, a narrow
store port, a PostgreSQL adapter, a governed operations layer, and a **local** schema asset. It is
imported and started by nothing.

### 1. The memory is operational and non-authoritative, and says so on every record

Every investigation, and every telemetry event, carries
`memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE'` as a literal. A reader holding one of these records
cannot mistake it for business truth without deleting a field that will not parse as anything else.

**A remembered authorization is not current permission.** There is no `isAuthorized`, `canExecute`,
`canSend`, `approvalGranted`, `authorizationValid`, `authorizedAction` or `executionAllowed`
anywhere in the contracts, the schema or the public surface; every object is `strict`, so a caller
cannot introduce one; and a spec asserts each name absent from the input schemas, the **persisted
record** schemas, the SQL, and the built barrel.

That last point is where a mutation proof earned its place. The first version of the suite checked
only the input schemas and a fixture's keys. Adding `isAuthorized: z.boolean().optional()` to the
investigation contract passed every test: a fixture that never sets an optional field also never
reveals that it exists. The containment now asserts against the schema shapes themselves.

An evidence reference may **point at** a historical approval record. That is a pointer to something
that was true once. QuickFurno Core remains the only thing that can say what is true now, and the
evidence source-class vocabulary is deliberately authority-free -- there is no `APPROVAL_GRANT` and
no `AUTHORIZATION` to select.

### 2. Bounded artifacts only. No chain-of-thought, and nowhere to put one

Stored: bounded identifiers, closed status tokens, a short objective, a short checkpoint summary, a
short hypothesis statement, a short correction statement, evidence **references**, counters, budgets
and canonical instants.

Not stored, and structurally impossible: chain-of-thought, an internal scratchpad, a model or user
transcript, a provider request or response body, a credential, an arbitrary tool blob.

There is **no `json`/`jsonb` column and no unbounded text column** in the schema, and no open-ended
string in the contracts. Every text column carries a `CHECK` bounding its length, so an unbounded
value is refused by PostgreSQL rather than by a reviewer's attention. An unbounded field would
eventually carry exactly the thing this slice promises not to keep -- not through malice, but
because someone would have somewhere to put it.

Telemetry is held to the same rule and is **not a second memory store**: ids, counters, a status, a
duration and a closed outcome code. A telemetry pipeline is precisely where content carefully kept
out of a database tends to reappear.

### 3. Durable in PostgreSQL, and the restart boundary is the proof

The store is a local port with one PostgreSQL adapter over the existing `@qf-jarvis/event-backbone`
`DatabasePool` abstraction. **No new third-party dependency**, no direct `pg` dependency, no
module-level pool, no singleton, no `process.env` in library code: the pool arrives as a parameter
and the caller owns its lifecycle. Importing the adapter opens no socket and knows no host.

The integration proof creates an investigation and a checkpoint in one "process", **closes that
pool entirely**, and then resumes through a brand-new pool, adapter and operations layer -- and
reads the whole history back through a third. Calling another method on the same object is not a
restart; a fresh pool over a fresh connection is. An in-memory implementation passes every test
that never opens a connection, which is why this claim is not made on unit tests.

### 4. Optimistic concurrency, and the database has the last word

Every mutating operation carries `expectedRevision` and either advances the revision by exactly one
or fails closed as `REVISION_CONFLICT`. Two mechanisms, and neither is redundant:

- the in-process guard runs on the row the transaction has just locked with `SELECT ... FOR UPDATE`,
  giving a sequential stale writer a precise answer without a wasted write;
- the `WHERE ... AND revision = $expected` predicate in the write itself is what holds when two
  writers loaded simultaneously.

Underneath both, `UNIQUE (investigation_id, revision)` on the checkpoint and correction tables means
that if every guard in the adapter were deleted, two writers still could not both own revision 4.
That is what makes "no lost update" a property of the database rather than of the code that happened
to run.

### 5. Checkpoints are immutable; owner corrections are append-only

A checkpoint is written once. The adapter issues **no `UPDATE` or `DELETE` against any child
table** -- the only `UPDATE` target in the whole slice is the investigation header -- and a spec
asserts that over the SQL. No trigger enforces it, because a trigger would be a second, invisible
place where the rule lives.

Owner corrections supersede what they target and never erase it: both the correction and what it
corrected remain readable, which is the entire value of an auditable correction. `actor: 'FOUNDER'`
is an **injected label in an offline proof and is not authentication** -- JAO-3 verifies no
identity, and a correction changes what the investigation remembers and nothing else. It cannot set
approved, authorised or executable, because no such field exists to set.

### 6. Idempotency, because a resuming caller does not know what committed

Retryable writes carry a bounded `operationId`. The same id with the same semantic payload returns
the committed result and writes nothing -- no duplicate row, no revision increment. The same id
with a **different** payload fails closed rather than letting one id mean two things in the history.

Only a **digest** of the semantic payload is stored. Keeping the payload would put a second,
unbounded, unreviewed copy of every summary and correction statement beside the governed one -- and
it would be the copy nobody remembered to check for transcripts.

The replay check runs deliberately **before** the writability guards: a caller asking "did this
already happen" gets the truth, and re-refusing a write that is already durable would leave it
retrying forever.

### 7. Budgets survive restart and cannot be widened

`JAO3_BUDGET_LIMITS` -- 32 checkpoints, 8 evidence references and 4 hypotheses per checkpoint, 16
owner corrections, 16 resumes, a 7-day lifetime -- is written into the investigation row at
creation. Guards read the **persisted** budget, never the constant: a process consulting today's
constant would silently re-grant whatever the current code allows, which is exactly the restart
reset budgets exist to prevent.

Widening is not expressible -- resume and the append operations take no budget parameter at all --
and a persisted row claiming more than the ceiling is refused as corrupt by both the zod contract
and a database `CHECK`.

### 8. Expiry is semantic, and there is no scheduler

At or after `expiresAt`, resume and every write are refused as `INVESTIGATION_EXPIRED` -- computed
at the moment of use from the persisted instant and an injected clock. The boundary is closed: an
investigation expiring exactly now is expired.

**Expiry is not deletion.** The row stays where it is, still `OPEN`, still readable for audit,
because deleting the evidence of an investigation is not the same as ending it. There is no cron, no
sweeper, no timer and no background job -- ambient operation is JAO-5's to design and govern, and a
`setInterval` here would be JAO-3 quietly taking that on. There is also no destructive public
operation: no `pruneAll`, `clear`, `deleteInvestigation`, `clearAll` or `reset`. Retention is
separately governed.

### 9. Supersession and lifecycle

`OPEN` and `PAUSED` accept work. `COMPLETED`, `EXPIRED` and `SUPERSEDED` do not, and the decision is
a **total map** over the status vocabulary -- a status added without an entry does not compile,
because whether a new terminal state is resumable should not be decided by an omission. There is
deliberately no `RUNNING`: nothing advances an investigation while nobody is looking.

Supersession sets the status and the replacement pointer in one statement, refuses a self-reference,
and never merges two investigations: the old record keeps its own history and gains a pointer to
what replaced it. A superseded investigation cannot be resumed.

**Resume is always explicit** and is the only way `currentRunId` changes. `rootRunId` is fixed at
creation and appears in no `UPDATE` statement anywhere in the adapter.

### 10. Identity binding - the JAO-2 lesson applied

Three relations, enforced rather than assumed: the row loaded must be the investigation requested;
the writing run must be the investigation's **current** run, so a run displaced by an explicit
resume cannot keep appending; and `rootRunId` never drifts. Nothing is normalised -- a mismatch is
invalid provenance, and a checkpoint filed under a run that did not perform it is an audit trail
that quietly lies.

### 11. Errors: closed, content-free, and never optimistic about uncertainty

One closed vocabulary, one fixed message per code, chosen **by** the code and never built **from**
the input. A `pg` error carries the failing SQL, the constraint, the column, the bound parameters,
the host and often the user; none of it leaves the adapter, which reduces the driver error by
SQLSTATE alone and discards the rest.

**Database uncertainty never becomes `INVESTIGATION_NOT_FOUND` or a success.** "I could not look"
and "it is not there" are different facts, and a caller acting on the wrong one would create a
duplicate investigation or conclude that durable work never happened. A malformed persisted row
fails closed as `PERSISTED_STATE_INVALID` rather than being coerced into a plausible-looking result.

### 12. The schema is LOCAL. Managed migration is NOT adopted

`apps/worker/src/jao/operational-memory/schema/001_jao_investigation_memory.sql` creates its own
`qf_jarvis_jao3` schema and is applied **explicitly by the integration harness** to a disposable
test database.

It is deliberately **not** in `packages/event-backbone/src/persistence/migrations/`, which is the
managed history that `pnpm db:migrate` applies and that the deployed database carries. Appending to
that history would make JAO-3 arrive in a real database as a side effect of a routine migration
run -- adopted by nobody, reviewed as part of nothing, rolled out by accident.

The posture is exact:

```
durable schema        YES        managed migration adopted   NO
DB integration proof  YES        production schema applied   NO
```

**Managed migration adoption requires a separate, explicit production-activation review.** Schema
and code existence is not rollout. The SQL is forward-only, drops and alters nothing pre-existing,
uses no `CASCADE`, no trigger, no extension, no superuser feature and no environment-specific value;
its own schema means a managed `DROP SCHEMA qf_jarvis` cannot take it with it, and it cannot collide
with a managed object.

### 13. No Mastra, deliberately

JAO-1 and JAO-2 use `@mastra/core/workflows` because sequencing steps is what they prove. JAO-3
proves durability, and Mastra's in-process state is not durable: a harness holding any part of this
would be a second, weaker store beside the real one. **Removing Mastra entirely must not damage the
memory format**, which is only true while the format lives in the schema and these contracts. No
Mastra Memory, Storage, DB adapter, thread/message memory, MCP or scheduler is used, and a spec
asserts the slice imports no `@mastra` package at all.

## Authority

Unchanged, and JAO-3 adds nothing to it. **Recommend -> Authorize -> Execute.** QuickFurno Core
remains the sole business authority and the sole source of current business truth and authorization.
n8n executes only already-authorized intents. Providers deliver. The QF Model Gateway remains the
sole model authority. Mastra remains an orchestration harness and is not used here at all.

Jarvis may store non-authoritative operational investigation state. It does not own business truth,
and it does not turn memory into permission.

**Zero model calls, zero specialist calls, zero proposals, zero approval requests, zero execution
intents, zero Core calls, zero n8n, zero channel actions, zero business effects.** JAO-1 owns the
model-call proof and JAO-2 owns the delegation proof; combining them into JAO-3 would make three
slices depend on one another's containment.

## Non-goals

Not conversational memory, a CRM, a vendor or client database, a lead store, a business event source
of truth, an approval store, an execution queue, a QuickFurno Core replacement, a Riya continuity
replacement, Mastra Memory or Storage, or a background scheduler.

No sandbox or tool workbench (JAO-4). No ambient scheduling (JAO-5). No business-action proposals
(JAO-6). No new shared persistence package: one JAO consumer does not justify one, and a package
invented before its second caller would harden guesses into a contract. No new third-party
dependency -- `@mastra/core` stays exactly `1.61.0`, and the manifest does not change, so the
lockfile does not either.

## Consequences

JAO-4 and JAO-5 inherit a durable investigation record whose concurrency, idempotency, expiry and
supersession are already decided, so a sandbox or an ambient scheduler can be added without also
having to invent memory governance. JAO-5 in particular inherits expiry semantics that are already
correct without a sweeper, so the scheduler it introduces has one less thing to get right.

The cost is a schema that exists in the repository and in CI but in no managed database. That gap
is deliberate and must stay visible: anyone reading "JAO-3 is durable" should read it as "durable
where it has been applied", and the only place it has been applied is a disposable test database.

Rollback is removal or disablement of the JAO-3 directory. Nothing imports it, no worker entry
starts it, the existing projection runtime is unaffected, and JAO-1 and JAO-2 are unchanged. Any
later expansion -- managed migration adoption, a second consumer, ambient resume, a retention
policy, anything that reads this memory as authority -- requires its own review and its own ADR.
