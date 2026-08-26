# ADR-0121 - JAO-7 advanced governed autonomy

**Status:** Accepted - offline composition and local durable state only. No Core submission, no
approval decision, no execution intent, no execution of a Core-issued intent, no n8n, provider or
channel call, no managed migration, no scheduler, no runtime activation, no business effect. JAO-7 is
**DEFAULT-OFF** and **SHADOW**.

**Date:** 2026-08-26

**Owned by:** QFJ-P12 - Advanced Intelligence and Future Agents, capability overlay **JAO - Jarvis
Autonomy & Operations**, slice **JAO-7 - Advanced Governed Autonomy**. This is the final canonical
JAO overlay stage.

**JAO-7 is an overlay id, not a major phase.** It renumbers nothing, `QFJ-P00` through `QFJ-P12`
remain unchanged, there is no `QFJ-P13`, JOS remains Jarvis OS.

**Builds on:** [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md) and
ADR-0115 through [ADR-0120](./ADR-0120-jao6-governed-business-action-proposals.md). None is modified.
JAO-7 REUSES JAO-2's governed specialist delegation and JAO-4's virtual workbench through their
public barrels, and touches neither.

**Reuses, and does not re-implement:**
[ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md) (`recommendation-runtime`),
[ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md) (`approval-runtime`) and
[ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md)
(`execution-intent-runtime`), over the contracts `@qf-jarvis/contracts` has owned since Phase 2.

---

## Context

The canonical overlay requires:

> **JAO-7 - Advanced Governed Autonomy.** Policy-bounded multi-agent planning, long-running
> operations, capacity optimization, incident-remediation proposals, continuous evaluation, and
> carefully expanded reversible autonomy.
>
> Advanced autonomy does not relax the permanent authority ceiling. Irreversible, financial,
> identity, consent, entitlement, destructive, or externally binding actions remain behind their
> governed authority class.

The second paragraph is the load-bearing one, and it decides what this slice is allowed to be.

### The limitation this ADR refuses to paper over

**The live Core -> n8n execution transport is not adopted here.** The repository has contracts,
validation, correlation, replay governance and durable boundary proofs. It does not have a production
transport that JAO-7 could honestly invoke.

So this proof does not claim that Jarvis executed a Core intent, sent anything to n8n, remediated
production, changed a live system, or submitted anything to Core. It claims something smaller and
true: that a long-running autonomous mission can be planned, evaluated, paused, resumed, killed,
expired, correlated against externally supplied Core artifacts, rehearsed in a virtual sandbox,
verified, and rolled back - all durably, and all without acquiring a single new authority.

---

## Decision

### 1. The control loop, and where it stops

    bounded mission
      -> static policy-bounded plan
      -> bounded evidence / governed specialist work
      -> continuous evaluation after every step
      -> canonical remediation RecommendationV1
      -> canonical POWERLESS ApprovalRequestV1
      -> PAUSE
      -> externally supplied Core authority artifacts
      -> exact approval + execution-intent correlation
      -> OFFLINE REVERSIBLE REHEARSAL ONLY
      -> verify
      -> success OR automatic virtual rollback
      -> terminal audited state.

Success for this slice is **more coordination and recovery, not more authority**.

### 2. Two static missions, and only two

|                     | Mission A                                 | Mission B                                 |
| ------------------- | ----------------------------------------- | ----------------------------------------- |
| id / version        | `jao7.client-sales-stall-remediation` / 1 | `jao7.synthetic-capacity-remediation` / 1 |
| subject             | `client`                                  | `capacity-pool` (synthetic)               |
| recommendation type | `client.sales-stall-remediation`          | `capacity.incident-remediation`           |
| action / version    | `operator.task.create` / 1                | `capacity.concurrency-adjustment` / 1     |
| risk                | `low-risk-reversible`                     | `low-risk-reversible`                     |
| approval            | `delegated-approver`                      | `delegated-approver`                      |
| specialist calls    | **1** (Riya, via JAO-2)                   | 0                                         |
| tool calls          | 0                                         | up to 2 (JAO-4)                           |
| model calls         | **0**                                     | **0**                                     |
| lifetime            | 2 days                                    | 1 day                                     |
| sandbox             | `VIRTUAL_OPERATOR_TASK_LEDGER`            | `VIRTUAL_CAPACITY_POOL`                   |

Mission A proves multi-agent planning and proves the boundary at the same time: Riya analyses client
sales signals - the only scope her governed behaviour covers - and the remediation is an **internal
operator task** that never reaches the client. "Riya said the conversation stalled" is advice; "send
the client a message" would be `client-or-vendor-facing-communication`, a risk class no active JAO-7
mission may carry.

`requiredRisk` and `requiredApproval` are `z.literal` on the policy schema. A future mission that
tried to declare a money-related or communication-facing class would not fail a policy check - it
would **fail to load**.

### 3. Policy-bounded planning means the plan is data somebody reviewed

There is no planner that generates steps and no LLM in the loop. A plan is `policy.planSteps`: a
fixed sequence drawn from a closed step vocabulary, reviewed as part of the policy, finite,
non-recursive, unable to spawn a child plan or grow at runtime, and containing no step that takes a
callback.

`jao7PlanDigest` is written onto the run at creation and re-checked on **every** claim, so a policy
edited mid-flight stops an in-flight run rather than silently re-scoping it. A caller cannot supply a
plan because the request schema has no field for one.

### 4. Multi-agent planning is a reviewed step, and the specialist actually decides something

Mission A includes exactly one delegation through the canonical JAO-2 boundary - registry, adapter
and workflow all constructed inside this slice from its own imports. There is no public parameter for
a specialist registry, adapter or delegate callback. Riya's input is built from client-sales signals
only; the request schema is strict and has no field for vendor or capacity data, so contamination is
a refusal rather than a convention.

**Owner review of PR #163 found the delegation ceremonial, and it was.** The advisory was required,
then discarded, and the proposal was built from `operatorTask` parameters the CALLER supplied:
changing what Riya concluded changed nothing about what was proposed. JAO-2 had already proved a
specialist can be CALLED; what JAO-7 has to prove is that one CONTRIBUTES inside a larger governed
plan.

So the advisory now DECIDES the remediation, through TOTAL reviewed maps:

- the **disposition** decides the task class, the due window and the priority band - how urgent this
  is, and who should look at it;
- the **intent** decides the reason code - what a reader is told the task is about;
- the **reason** decides whether a remediation may be derived at all: a pause, a takeover and a scope
  violation all mean "Riya did not analyse this", and a remediation derived from an analysis that did
  not happen would be a fabrication.

Both maps are total over JAO-7's own reviewed vocabulary, and a spec asserts those vocabularies are
exactly Riya's - so if Riya grows a disposition, the spec fails and a human reviews the new one. A
conclusion outside them **fails closed**, as does a refusal: proposing an internal sales task off a
`REFUSE` would be JAO-7 inventing a conclusion the specialist explicitly declined to reach.

Riya gains no authority whatsoever by this. She still cannot propose, approve, execute or send, and
every value she can cause to appear in the action is a member of a closed enum somebody reviewed.
What she can do is be the REASON a particular internal task is the one proposed - which is exactly,
and only, what advice is. The derived decision is persisted as five closed columns plus a digest of
the bounded advisory it came from, because a derivation that vanished on restart would be no
derivation at all. There is no `operatorTask` field on the request any more.

### 5. Capacity optimisation is deterministic, and the target is never supplied

`decideJao7Capacity` is a pure function of closed metric bands. The request schema has **no
`targetConcurrency` field**, so there is nothing to smuggle, and the reviewed bounds are literal:
never below 1, never above 32, never more than ±2 in one step, and **a high error rate never buys an
increase** - adding concurrency to an unhealthy dependency is how a degradation becomes an incident.

The reason code says what is true. Two branches used to report `over-provisioned-idle`: the
high-error backoff, and the steady-state hold. Neither is an idle pool, and that token is what a
human approves against - an audit trail that records the right action for the wrong stated reason is
a trail somebody will one day reason from. They are now `high-error-rate-backoff` and
`steady-state-no-adjustment`, and `over-provisioned-idle` is reserved for the pool that actually is
idle.

### 6. Continuous evaluation is deterministic, and it cannot be talked round

A deterministic evaluation after every significant step, durably recorded. Not an always-on
background model loop: a background evaluator that could change a run's direction while nobody was
watching would be a second autonomous actor inside an autonomy proof.

The evaluator is a pure function from bounded structured state to a closed verdict. It sees no free
text, no specialist prose, no artifact content and no model output, so it cannot lower an approval,
create a Core artifact, override a kill, ignore an expiry, or **turn a failed verification into a
success**. That last branch is the one that would make every other control decorative.

### 7. Durable control state, and what it deliberately cannot hold

A local `qf_jarvis_jao7` schema: the run, its steps, its evaluations, its operation replay records,
one authority observation and one virtual sandbox row. Budgets, kill, expiry, plan digest, step count
and sandbox state are all rows, because a budget a restart forgets is a budget an unstable system
silently removes - and an unstable system restarts most.

There is no jsonb column, no unbounded text column, no raw approval decision, no raw execution
intent, no model transcript, no credential, no contact detail and no business record. **The schema is
a LOCAL asset**, applied explicitly by the integration harness to a disposable test database,
deliberately outside event-backbone's managed migration history, wired to no startup path, and
applied to no managed database. Managed adoption requires a separate production-activation review.

### 8. Every transition is an explicit call

`createJao7AutonomyRun`, `advanceJao7AutonomyRun`, `resumeJao7AutonomyRun`, `pauseJao7AutonomyRun`,
`killJao7AutonomyRun`, `readJao7AutonomyRun`. There is no `setInterval`, cron entry, timer, queue
consumer, webhook, ambient subscription or daemon loop anywhere in the slice. A paused run resumes
when somebody resumes it, and a run awaiting authority waits forever if nobody answers.

Each step is three phases: **claim** under a row lock (state, kill, expiry, pause, plan digest, step
eligibility and budget re-checked and committed), **work** with no transaction open, **finalise**
exactly once with its evaluation. A crash between claim and work leaves a visible `CLAIMED` step and
a spent budget - the conservative direction, because a spent budget costs an explicit resume while an
unspent one costs a second specialist call nobody authorised.

**The claim is bound to its operation id, and a replay is served rather than re-performed.** It used
to return `replayed: true` for ANY pre-existing `CLAIMED` row, whatever id had created it, before the
revision, kill, expiry, plan and budget checks ran - and the coordinator ignored the flag and did the
work again. One charged specialist call, two invocations of Riya. Governance now runs first and all
of it; the claim writes a replay record like every other mutation; a different operation id gets
`STEP_ALREADY_CLAIMED`; the same id with a changed payload gets `OPERATION_CONFLICT`; and a replay
returns the state its claim committed without entering the work phase at all. A step stranded by a
lost process therefore stays claimed until somebody decides explicitly what to do about it, which is
the conservative direction and the reason the budget is charged where it is.

**The plan position moves only when the verdict says it may.** Every completed step used to advance
the index, including a `VALIDATE_AUTHORITY_EVIDENCE` step that had correlated NOTHING - so a run
reported as `AWAITING_AUTHORITY` was already pointing at `REHEARSE_REVERSIBLE_EFFECT`, and only the
run state stood between that position and a rehearsal. Progression is now a closed decision derived
from the verdict by a total function, an incomplete or rejected validation RETAINS its position, and
the step table is keyed per attempt so a retained position can be attempted again under the reviewed
`maxSteps` bound. A rehearsal is additionally ineligible without a JUST-PROVEN exact chain: the state
the claim moved the run out of, a recorded successful correlation, and that correlation bound to this
run's own proposal identity.

Authority observations are recorded per attempt, with at most one SUCCESSFUL chain per run enforced
by a partial unique index. The table used to be keyed by run alone, so the first incomplete attempt
consumed the only slot and locked the run out of ever recording the chain it was waiting for.

### 9. Kill, pause and expiry are superior - with one deliberate exception

Kill is terminal, durable and has no `unkill`. The compare-and-set runs **first and always**, terminal
row included: JAO-5's owner review found an early return above the CAS on exactly this path, and
JAO-7 does not repeat it. Expiry blocks forward work. Pause resumes only explicitly.

**Safety rollback is superior to both, and it is on the PUBLIC surface.** Refusing to roll back
synthetic state that was already applied would leave the sandbox dirty with no path back, and a
control that strands the state it created is not a control. Rollback can only ever restore the
captured BEFORE value, so being superior costs nothing - and a terminal run stays terminal while its
sandbox is cleaned.

`rollbackJao7AutonomyRehearsal` is the one verb this surface gained in the PR #163 correction. It
takes a run id and an operation id, and there is no target, value, state or force flag on it. It is
public because the guarantee is: the previous proof reached through the raw store, which no public
caller has, and a guarantee only an internal test can exercise is not a guarantee.

A failed rollback is now DURABLE. `rollback_attempted_at` and `rolled_back_at` used to be one column,
and the consistency check then made a `ROLLBACK_FAILED` row unwritable - a failure state that cannot
be persisted is a failure state that does not exist, which is the opposite of failing safe. The
attempt is counted in the row and bounded by the reviewed policy AND by a database CHECK, and a
second database constraint records a restored value if and only if a rollback actually restored
something. A pause that would strand applied, unverified synthetic state is refused outright: verify
it or roll it back, both of which are explicit calls and both of which are available.

### 10. The authority gate, and the honest label on it

At `AWAIT_AUTHORITY` the run stops. Moving past it requires an `ApprovalDecisionV1` and an
`ExecutionIntentV1` supplied from OUTSIDE, validated by the canonical runtimes.

**JAO-7 creates neither, and cannot.** There is no constructor for either artifact in this slice or
in the packages it imports: the approval runtime only validates a decision Core has already issued,
and the execution-intent runtime only validates an intent Core has already issued and has no method
that creates one. There is no Core transport to fetch one from and no n8n client to hand one to.

`executionIntentV1Schema` does most of the structural work: it establishes that the issuer is
`quickfurno-core`, the executor is `n8n`, delivery is at-most-once, an idempotency key is present, and
the parameters carry no contact detail, credential or smuggled retry permission. None of that is
restated in this slice.

**What correlation proves, and what it does not.** A structurally valid injected Core artifact proves
CORRELATION in this offline proof: that the artifacts describe exactly this recommendation, action,
fingerprint and parameters. It does **not** prove production source authentication. The posture
literal says so - `INJECTED_OFFLINE_CORE_FIXTURE` - and pretending otherwise would be the one lie
this slice most needs not to tell.

A correlated approval **without** a matching intent is a real state, and it stops there. A rejected
or changes-requested decision never reaches the sandbox.

### 11. Jarvis never executes the execution intent

A validated `ExecutionIntentV1` names `n8n` as its executor. JAO-7 records a bounded OBSERVATION -
digests, ids and a correlation code - and stops. It does not become n8n because it happens to be
holding the intent, and `executionIntentExecuted: false` is a literal on every result.

### 12. The persisted authority observation is history, never permission

Digests and identities only. There is no column into which a raw artifact or an `approved`,
`can_execute`, `is_authorized` or `send_allowed` boolean could go, and no run state named
`AUTHORIZED`, `CAN_EXECUTE` or `SEND_ALLOWED` - because a system that can express a state eventually
reaches it, and a row that could be read as a grant is a row somebody eventually reads as one, months
later, with the artifact long expired.

The one state that comes close is deliberately verbose:
`AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL`.

### 13. The reversible effect is a VIRTUAL REHEARSAL, and the name is part of the control

It changes exactly two integers in a JAO-7 row. It reaches no host filesystem, process, environment
or network; no provider, channel, n8n, Core or business table; and it produces no `ExecutionResultV1`,
because nothing executed.

It is never called `EXECUTION`, `LIVE_APPLY` or `PRODUCTION_APPLY`. That is not decoration: the most
likely way this slice becomes dangerous is not a missing check but somebody reading `applyEffect` in
a year and wiring it to something real because the name suggested that was the intent.

It may consume the exact approved action as **simulation input** after correlation. It simulates what
the action would do if Core issued it and n8n ran it; it does not run the Core-issued intent.

- **Mission A**: a virtual operator-task ledger. Present, and BOUND to the approved action's
  fingerprint - presence alone would verify for a task created by something else entirely.
- **Mission B**: a virtual concurrency integer moved to the computed target.

Verification is `EXACT_MATCH_AGAINST_TARGET` and nothing looser, because a verification that accepted
"close enough" would make the rollback path unreachable in exactly the cases it exists for. At most
one apply, at most one rollback attempt, rollback restores **only** the captured BEFORE state, and a
failed rollback is terminal `FAILED_SAFE` rather than a retry storm.

### 13b. The carried proposal is re-proved from its own bytes

JAO-7 persists no `RecommendationV1`: a stored copy is a second copy, free to drift from the one a
human saw. What it persists is the proposal BINDING - recommendation id, action id and fingerprint -
and a caller returning to the authority gate carries the artifacts back.

The check used to be three string comparisons over an object cast into place after a single `typeof`
test. The canonical schemas were never run, and the fingerprint was READ OUT of the carried object
rather than recomputed from it - so the value under test was supplied by the same caller as the value
it was tested against. A caller could carry back a recommendation whose action had been rewritten
entirely, keep the three identity strings, and have that action rehearsed.

The artifacts are now parsed by their canonical contracts, required to describe one another, and the
fingerprint is RECOMPUTED from the final action bytes with the same canonical function that produced
the stored one. That is what makes the binding a binding: the stored digest measures action CONTENT,
so an action whose content changed cannot reproduce it, whatever identity it wears. The reviewed
policy is re-applied on top - recommendation type, action type, contract version, risk, approval
level and the governed parameter shape - so a well-formed artifact from a different mission is
refused too, and the rehearsal consumes the PARSED object.

The authority digests are full canonical semantic digests over the parsed artifacts, not six identity
fields. The old digest could not tell two decisions apart when they differed only in their per-action
verdicts or their approver - and the per-action verdict is exactly what a partial approval turns on.
They remain one-way SHA-256 over a canonical serialisation: nothing reusable is stored, and the
artifact cannot be recovered from them.

Every mutation's replay digest covers every field that governs it, with `nowMs` and the operation id
excluded for reasons that are stated where they are excluded. `RECORD_AUTHORITY` is its own operation
kind; it used to replay under `FINALIZE_STEP`, so the audit trail named the wrong mutation - and a
trail that misnames what happened is worse than one that says nothing, because a reader trusts it.

### 14. Public composition is pinned by having no parameter at all

The public entry points take a `DatabasePool`, a clock and optional content-free telemetry. There is
no parameter for a planner, mission registry, policy, recommendation runtime, approval runtime,
execution-intent runtime, JAO-2 registry or adapter, JAO-4 tool implementation, evaluator, rehearsal
effect, rollback effect or raw store.

The canonical mission policies and registry are PRIVATE governance state - JAO-6's owner-review
lesson, inherited: `Object.freeze` is shallow, and a public reference to a policy record is a public
ability to rewrite reviewed governance. Policies are JSON-like and deeply frozen by construction;
introspection returns a fresh, detached, primitive-only copy. The closed vocabularies are frozen at
runtime too, because `as const` is a compile-time note and the array that ships is otherwise writable.

---

## Authority

Unchanged, and unchangeable by this slice:

> **Jarvis recommends. QuickFurno Core authorizes and owns business truth. n8n executes approved
> intents. Providers deliver. Results return to Core.**

Confidence is never authority. There is no emergency override, debug bypass, timeout-to-approve,
silence-means-consent, self-approval, model-confidence approval, remembered approval, or retry that
widens authority. Human and Core pause, kill and refusal remain superior.

JAO-7 may TEST correlation of a Core decision whose `decidedBy` is a valid POLICY actor - level-4
policy automation is Core's to operate for low-risk reversible actions after evaluation. JAO-7 does
not create that decision, does not define Core's policy engine, and does not auto-approve.

---

## Non-goals

- Submitting anything to Core, or adopting a Core transport.
- Creating, forging or locally validating an approval decision or an execution intent.
- Executing a Core-issued intent, under any name.
- Any communication, voice call, payment, vendor activation, identity or consent mutation, lead
  assignment, deletion, bulk action or production deploy.
- A production scheduler, event ingress, queue or webhook.
- Managed migration adoption.
- Production activation. **Implementation is not activation.**

---

## Consequences

JAO-7 is imported and started by nothing. `apps/worker/src/index.ts` and the worker production entry
are unchanged, and a spec walks the worker source tree to prove nothing outside the slice and its own
suites imports it.

The supply-chain posture is unchanged: **zero new third-party dependencies**. One `workspace:*` link
was added - `@qf-jarvis/execution-intent-runtime` - to a package this repository already builds and
governs, and which can only validate an intent, never create one.

What this buys is narrow and worth stating plainly. When a production Core submission path and a
Core -> n8n transport are eventually built, they will be attached to a coordinator that already
plans finitely, evaluates every step, survives restart, refuses to move without externally issued
authority, and can undo what it rehearsed. The transport is the easy part; the controls around it are
what took seven slices.

The result contract is declared rather than `unknown`, and it is parsed before it is returned: the
schema that exists to prove a result is well-formed used to prove nothing about the five fields
carrying every durable fact, and nothing ever ran it. It now also refuses a result whose outcome
contradicts its state. The two failure fixtures that used to be optional booleans on the PUBLIC
request schema live in the internal composition beside the store and the clock - neither could ever
grant anything, but a public knob that exists to break a safety check is a public knob somebody
eventually flips.

**Production transport and adoption remain a separate, later, separately reviewed integration.**
