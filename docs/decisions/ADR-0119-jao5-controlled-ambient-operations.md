# ADR-0119 - JAO-5 controlled ambient operations

**Status:** Accepted - offline domain, local schema and composition only. No production scheduler,
no event consumer, no managed migration, no runtime activation, no business effect. JAO-5 is
**DEFAULT-OFF** and **SHADOW**.

**Date:** 2026-08-25

**Owned by:** QFJ-P12 - Advanced Intelligence and Future Agents, capability overlay **JAO - Jarvis
Autonomy & Operations**, slice **JAO-5 - Controlled Ambient Operations**.

**JAO-5 is an overlay id, not a major phase.** It renumbers nothing, `QFJ-P00` through `QFJ-P12`
remain unchanged, there is no `QFJ-P13`, JOS remains Jarvis OS.

**Builds on:** [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md),
[ADR-0115](./ADR-0115-jao1-mastra-shadow-operations-supervisor-proof.md) (JAO-1),
[ADR-0116](./ADR-0116-jao2-governed-specialist-delegation-proof.md) (JAO-2),
[ADR-0117](./ADR-0117-jao3-operational-memory-resumable-investigations.md) (JAO-3) and
[ADR-0118](./ADR-0118-jao4-sandbox-tool-workbench.md) (JAO-4). None is modified. JAO-5 is an
**additive sibling**: every earlier slice is untouched and every focused suite still passes.

---

## Context

The merged overlay requires:

> Add scheduled/event-triggered investigations over approved operational signals. Every monitor has
> a named owner, cadence/trigger, scope, budget, deduplication rule, expiry, quieting rule, and kill
> switch. Observation may create attention; it does not create business authority.

That sentence is the whole design. Ambient operation is where an agent platform stops being
something a person invokes and starts being something that acts on its own schedule -- and the
failure mode is not dramatic. It is a monitor somebody added without an owner, that nobody could
switch off, that fired every ninety seconds after a restart reset its budget, and that produced
enough attention to be ignored.

## Decision

Build a **DURABLE AMBIENT MONITOR GOVERNOR** at
`apps/worker/src/jao/controlled-ambient-operations/`, imported and started by nothing.

### 1. Ambient does not mean running. There is no scheduler here

`runJao5AmbientCycle` is a function somebody calls. There is no `setInterval`, no recurring
`setTimeout`, no cron entry or package, no BullMQ, Redis or queue consumer, no webhook, no
EventEmitter subscription and no background thread anywhere in this slice, and a spec asserts every
one of those absences over comment-stripped source.

What the cycle proves is that schedule and event ELIGIBILITY are decided **deterministically from
durable state and an injected instant**. That is the hard part and the part a real scheduler would
have to be built on top of. A production scheduler or event ingress is a separate activation review.

### 2. Exactly two static monitors, and every clause of the sentence is a required field

|         | `jao5.system-health.interval.v1` | `jao5.system-health.changed.v1`                            |
| ------- | -------------------------------- | ---------------------------------------------------------- |
| trigger | `SCHEDULED_INTERVAL`, 900s       | `APPROVED_EVENT`, `control-plane.system-health.changed.v1` |
| owner   | `jarvis.operations`              | `jarvis.operations`                                        |
| scope   | `CONTROL_PLANE_SYSTEM_HEALTH`    | `CONTROL_PLANE_SYSTEM_HEALTH`                              |
| budget  | 4 / hour                         | 6 / hour                                                   |
| dedupe  | cadence slot                     | event id                                                   |
| expiry  | 7-day enrollment ceiling         | 7-day enrollment ceiling                                   |
| quiet   | 1800s attention / 300s failure   | same                                                       |
| kill    | terminal, CAS, irreversible      | same                                                       |

Owner, trigger, scope, budget, dedupe, expiry, quieting and kill are all **required** on the
definition schema, so a monitor missing any one of them cannot be constructed -- "every monitor has
an owner" is enforced by parsing rather than by whoever reviews the next monitor somebody adds.
`ownerId` is a stable accountable ROLE, not personal PII.

`availability` has one value and it is spelled `ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY`. Plain
`ACTIVE` would eventually be read as "running in production", and it is not.

There is no `handler`, `callback`, `fn`, `script`, `command`, `url`, `query` or `webhook` field: a
definition says WHEN an investigation may start, never what runs. A definition carrying executable
behaviour would make the registry a loader and the governance decorative.

### 3. Static definition is not activation. Enrollment is, and it expires

A durable monitor INSTANCE binds a definition digest, an owner, `SHADOW` mode, an enrolled instant,
an expiry, a quiet-until, a kill instant, the last claimed slot and a revision. The digest is what
binds an instance to the exact definition it was reviewed against -- a definition edited later no
longer matches, and the enrollment fails closed rather than silently governing something else.

**`KILLED` is terminal and there is no `unkill` anywhere in this slice.** A kill switch a stale
process can clear is not a kill switch. Reactivation means enrolling a NEW instance, which is an
explicit auditable act with its own expiry rather than a state transition somebody can race.

### 4. Durability, because a restart must not be the bypass

Every gate is backed by a row in a local `qf_jarvis_jao5` schema: the instance, the budget window,
the investigation run and the operation replay record. If a restart reset dedupe, budgets,
quieting, the last scheduled slot, the kill switch or expiry, then **restarting would be the
bypass** -- and an unstable system restarts most.

The last invariant is a database constraint rather than an application check: `UNIQUE (dedupe_key)`
on the run table is what makes at-most-one-start true under concurrency and across restart. If every
guard in the adapter were deleted, two processes still could not both claim one cadence slot or one
event id.

**The schema is a LOCAL asset**, applied explicitly by the JAO-5 integration harness to a disposable
test database. It is deliberately not in event-backbone's managed migration history, is not wired to
`pnpm db:migrate`, and has been applied to no managed database. Managed adoption requires a separate
production-activation review.

Only governance and provenance are persisted. No control-plane snapshot, no event payload, no model
prompt or result, no chain-of-thought, no attention body, no diagnosis, no recommended next step, no
credential and no business record: there is no json/jsonb column and no unbounded text column in the
schema, and a spec dumps the run table and asserts the attention text is absent.

### 5. Claim before investigate, and no transaction spans model inference

```
PHASE A  one transaction: lock the instance FOR UPDATE, verify the definition binding, kill,
         expiry, status, quiet, trigger, dedupe; reserve one budget unit; insert the run;
         advance the schedule; COMMIT
PHASE B  canonical JAO-1 investigation -- NO transaction, NO row lock
PHASE C  a second short transaction: finalize exactly once, apply quieting
```

Holding the lock across Phase B would put a network round trip to a model provider inside a database
transaction: one slow provider stalls the row, every other cycle blocks behind it, and a connection
pool empties while nothing is wrong with the database.

Every gate is re-checked **under the lock**, not merely before it. That closes the window between a
cycle's own pre-check and its claim -- a kill that commits in between must still refuse, and a spec
proves it by calling the store directly after a kill so the pre-check has already passed.

### 6. Crash after claim: duplicate suppression beats automatic retry

If the process dies between claim and finalize, the claim stays and the budget stays consumed,
because external work may already have begun and nothing can know whether it did. The same trigger
identity will not run again -- the uniqueness constraint refuses it. There is no sweeper, no
automatic retry and no resurrection.

That is a deliberate trade. **A duplicated investigation means a duplicated model call and a second
piece of attention about the same thing; a missed one means the next cadence slot picks it up.** The
safety target is AT-MOST-ONE start per dedupe identity, and this proof does not pretend model
execution is transactional.

### 7. Downtime must not become a catch-up storm

Cadence slots are computed from the enrollment anchor, not from "last run plus cadence" -- a
last-run offset drifts every time a cycle is late and resets whatever the process last remembered.

If twenty intervals were missed, replaying them would mean twenty model calls the moment the system
comes back, which is exactly when it is least healthy. The first-proof rule is blunt: **at most ONE
scheduled claim per monitor per cycle, and it is the CURRENT slot.** Missed slots are collapsed, not
queued. Investigating the present is what an operator wants; a backlog of stale snapshots is not.

### 8. Boundaries are closed on purpose

At or after `expiresAt` there is no claim, computed at the moment of use with no sweeper, and the
row stays for audit. At exactly `quietUntil` the monitor is eligible again. An off-by-one at either
boundary is a rule that does not hold at the only moment anyone would test it.

Attention quiets for 1800s, a refusal for 300s, and `NO_ANOMALY` adds nothing -- cadence and dedupe
already bound the rate, and quieting a healthy system would delay the first real signal.

### 9. One investigation engine, and one model path

JAO-5 does not invent a second investigation engine. It imports `runJao1ShadowSupervisor`,
`createSnapshotSystemHealthCapability` and `createJao1ModelGatewayBridge`, and JAO-1's bounds --
SHADOW mode, one capability call, one model call, zero retries -- remain superior and untouched.
The **QF Model Gateway is the only model path**, and a spec counts the gateway invocation.

Malformed events and invalid snapshots are pre-validated with the CANONICAL parser JAO-1 itself
uses, before a durable claim is taken, so a malformed signal cannot exhaust a monitor's budget --
and no diagnostic logic is duplicated to do it.

### 10. No public injection of the investigator OR of persistence

The JAO-4 owner-review lesson, applied twice -- the second time because owner review of PR #161
found the half that had been missed.

A public investigator callback would let a caller replace the thing every gate exists to govern, and
the containment specs read this source tree; they cannot read a function supplied from outside it.
That much was pinned from the start.

**A public `Jao5AmbientStore` parameter was the same defect wearing different clothes.** The store is
not a passive substrate. `claimAmbientRun` receives the trigger kind, trigger reference, dedupe key,
scheduled slot, event id, definition digest, budget window and per-window limit AS CALLER-SUPPLIED
VALUES. The adapter re-checks each against the locked row -- but it cannot reconstruct canonical
monitor policy, so it cannot know whether the slot was genuinely due, whether the event matched the
monitor's own type and scope, or whether those budget numbers are the reviewed ones. A public caller
holding a store could therefore bypass `runJao5AmbientCycle` entirely and claim under bounds of its
own choosing, or hand in a store implementation that recorded whatever it liked. The public surface
would have stopped being the governance boundary it claims to be.

The correction is **composition pinning, not a brand**: a brand can be copied as easily as a
descriptor (the JAO-4 lesson). The public surface now takes a `DatabasePool` -- the trusted
persistence INFRASTRUCTURE boundary, exactly as `ModelGateway` is the trusted inference boundary --
and CONSTRUCTS the canonical Postgres store itself. There is no parameter left to displace, and the
raw seam (`Jao5AmbientStore`, `Jao5Claim`, `Jao5ClaimRequest`, `Jao5FinalizeRequest`,
`createJao5PostgresStore`, `enrollJao5MonitorInternal`, `killJao5MonitorInternal`) is exported from
no barrel. `Jao5AmbientRunRecord` remains public: it is a strictly-decoded, read-only audit record
with no way to write anything.

Internal seams -- `runJao5AmbientCycleInternal`, `Jao5InternalMonitorOperationDependencies` and the
raw store -- exist for trusted source-level and test composition, reachable only by direct module
path.

Proved **behaviourally**, not just by type: a hostile investigator AND a hostile store are forced
into the public runner through a deliberate cast, and neither is ever consulted. A type-level proof
alone would survive a mutation, because a mutation proof runs Vitest and Vitest strips types --
which is exactly what happened on the first attempt here.

### 10a. The kill switch is compare-and-set on every path, including the terminal one

The reviewed kill returned early when the row was already `KILLED`. That early return sat ABOVE the
compare-and-set and ABOVE the replay insert, so on the one path the kill switch exists for it had
NEITHER declared property: any `expectedRevision` was accepted, and no replay record was written --
which meant the same operation id could be resubmitted later carrying a different revision and be
accepted a second time.

Now the order is fixed and unconditional. The replay guard runs before the row lock and again after
it (an honest retry that lost the lock must replay, not fail as a false conflict). The
compare-and-set then runs ALWAYS, terminal row or not. If the instance is already `KILLED` the
operation is a durable **terminal no-op**: `killed_at` is not overwritten -- it records when the kill
actually happened -- and a replay record IS written, so that operation id is idempotent from then on
exactly like a kill that changed something.

There is still no `unkill`.

### 10b. Run history is decoded, and identifiers are checked before any SQL runs

`listAmbientRuns` used to cast rows to the record type. A cast is not a check: a row the database can
still hold -- a refusal code outside the closed vocabulary, a negative cadence slot, an event id no
bounded identifier would accept -- would come back typed as governed history and be read as though
JAO-5 had asserted it. The audit trail is the only thing an owner has after the fact, so **a record
that reads correctly and is wrong is worse than one that refuses to be read**. Every row is now
parsed by `jao5AmbientRunRecordSchema`; a row that no longer satisfies the contract is a
`STORE_FAILED` refusal.

Two consistency rules the database CAN express were added to the schema as defence in depth: a
refusal code belongs to a `REFUSED` outcome and to nothing else, and the attention flag must agree
with the outcome.

Both read paths (`listAmbientRuns`, `countClaimedInWindow`) now parse their identifier and window
BEFORE borrowing a connection. Parameterized SQL made those calls safe; it did not make them
checked, and an adapter that never states its own domain boundary is one refactor away from a query
builder that interpolates.

### 11. Attention is not authority

The only outcome is JAO-1's own inert `SHADOW_OPERATIONAL_ATTENTION`. There is no `APPROVED_ACTION`,
`EXECUTION`, `REMEDIATION` or `AUTHORIZATION` in the vocabulary. `businessEffect` and
`productionMutation` are literals, and `coreMutations`, `executionIntentsCreated`, `channelSends`,
`n8nExecutions`, `specialistCalls`, `memoryWrites` and `toolCalls` are literal zeros on the result.

The `sourcePosture` literal on an injected event is a CLOSED FIRST-PROOF POSTURE and **not
production authentication**. A caller supplying it has not been authenticated by anything. A
production event ingress needs source authentication, authorization, replay control, redaction and
its own rollout review.

**Attention is surfaced, not merely counted.** The reviewed cycle incremented `attentionCreated` and
discarded the attention itself, which told a caller that something needed a human and refused to say
what. `Jao5AmbientRunResult` now carries JAO-1's own bounded inert attention IN MEMORY, and the
contract enforces the correspondence: `attentionPresent` is true exactly when `attention` is
non-null, and both hold exactly for an `ATTENTION_CREATED` outcome. JAO-1's schema permits a
`REFUSED` result that still carries an attention object; JAO-5 does not surface one, because
"attention was created" and "the investigation refused" must not both be true of a single run.

Surfacing is not persisting. The attention body still never reaches the store (the finalize request
carries only `attentionPresent`) and never reaches telemetry (which carries only the count). A spec
dumps the run table and asserts the attention text is absent, and a second spec reads the telemetry
emit site and the telemetry contract for any field a body could travel in.

### 12. A failed durable write does not erase work that happened

Phase C -- the finalize -- catches its own failure. It used to fall through to the generic refusal
handler, which returned a null ambient run id and a null JAO-1 run id while the cycle counters still
said one claim was made and one investigation started: a record contradicting itself and losing the
identity of work that demonstrably occurred.

`Jao5AmbientRunResult` now states persistence as its own fact. `persistenceStatus` is
`FINALIZED`, `FINALIZE_FAILED` or `NOT_CLAIMED`, with `persistenceRefusalReason` non-null exactly
when the finalize failed, and the contract requires claim identity to be present exactly when the
status is not `NOT_CLAIMED`. An unclassified throw in that phase is reported as `STORE_FAILED`, not
`WORKFLOW_FAILED`: the phase that failed was persistence, and blaming the workflow would misattribute
a write failure to an investigation that had already finished.

The durable row stays `CLAIMED` and the budget unit stays spent. A model call that already happened
cannot be un-spent by a write that did not land, and the same trigger identity does not re-open.

## Authority

Unchanged. **Recommend -> Authorize -> Execute.** QuickFurno Core remains the final business
authority. The QF Model Gateway remains the sole governed inference path. The existing approval and
execution-intent boundaries remain the only effect path. n8n executes only already-authorized
intents.

JAO-5 adds autonomous OBSERVATION and INVESTIGATION-START GOVERNANCE. It adds no autonomous business
action. JAO-6 owns business-action proposals; JAO-7 owns any later expansion of governed autonomy.

**Zero JAO-3 writes, zero JAO-4 tool calls, zero JAO-2 specialist delegation.** The first proof
observes `CONTROL_PLANE_SYSTEM_HEALTH` and nothing else -- no vendor, client, lead, payment,
package, consent, activation or WhatsApp signal.

## Non-goals

No production scheduler or event consumer. No cron, queue, timer or webhook. No second investigation
engine, model router or prompt. No business-action proposal (JAO-6). No remediation (JAO-6/JAO-7).
No shared package: two JAO consumers of a stable contract would justify one, and there is one.
No new dependency -- `apps/worker/package.json`, `tsconfig.build.json` and `pnpm-lock.yaml` are
unchanged and `@mastra/core` stays exactly `1.61.0`.

## Consequences

JAO-6 inherits a governor whose owner, budget, dedupe, expiry, quieting and kill semantics are
already decided and already durable, so a proposal slice can be built without also having to invent
ambient governance.

The cost is worth stating plainly: **this proves governance, not operation.** Nothing runs on its own
after this merges. The value bought is that when a scheduler is eventually added, it will be added
against a boundary that already exists, rather than defining one on the way in -- and the scheduler
is the easy part.

Rollback is removal of the JAO-5 directory, or killing every enrolled instance. Nothing imports it,
no worker entry starts it, no managed database carries its schema, and JAO-1 through JAO-4 are
unchanged. Any later expansion -- a real scheduler, an event ingress, a second scope, a business
signal, a higher autonomy level, managed migration adoption -- requires its own review and its own
ADR.
