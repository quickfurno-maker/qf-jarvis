# Jarvis Autonomy & Operations (JAO) capability overlay (JAO-0 ... JAO-7)

**Document status:** Canonical capability overlay owned by **QFJ-P12 - Advanced Intelligence and Future Agents**. Adopted under [ADR-0114](../decisions/ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md). Read with [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), [mvp-post-mvp-delivery-overlay.md](./mvp-post-mvp-delivery-overlay.md), and [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).

**Runtime status: DEFAULT-OFF / SHADOW.** JAO-0 is governance. JAO-1 through JAO-5 have merged
OFFLINE, default-off proofs: an exact-pinned `@mastra/core` dependency, two supervisor compositions,
one durable operational-memory composition, one virtual tool sandbox and one durable ambient monitor
governor now exist in `apps/worker/src/jao/`, and none of them is imported or started by any
production entry point.

JAO-3 adds a PostgreSQL schema and adapter, so this document no longer claims there is no memory
store and no database access. Both exist as source. **The JAO-3 schema is a LOCAL asset applied only
to a disposable test database; it is NOT in managed migration history, has been applied to no
managed database, and adopting it requires a separate production-activation review.**

JAO-4 adds a tool sandbox, so this document is explicit about what that sandbox is: a VIRTUAL
artifact sandbox over an injected bundle. **There is no host filesystem, host shell, command
execution, container, browser, network access, secret access, environment access or database access
anywhere in it, and no arbitrary-command isolation is claimed.** A future command-execution tool
class requires its own threat model and owner review.

JAO-5 adds ambient GOVERNANCE, so this document is explicit about what it does not add: **there is
no scheduler, cron entry, timer, queue consumer, webhook or event ingress anywhere in it, and none
is activated.** Ambient eligibility is decided by an explicit function a caller invokes. A production
scheduler or event ingress requires its own activation review.

Nothing beyond that is activated. There is still no autonomous loop, capability-broker package, MCP
server, provider route, credential, managed migration, n8n execution, channel action, production
mutation, deployment or rollout. Implementation is not activation.

## What this overlay is

JAO is the bounded Post-MVP autonomy and operations capability family for **Jarvis itself**. It gives future work a place to add long-running investigation, multi-step planning, specialist delegation, resumable operational work, approval-aware proposals, and carefully expanded autonomy without changing the canonical major-phase spine.

**JAO identifiers are overlay ids owned by QFJ-P12. They are not major phases.** They renumber nothing, `QFJ-P00` through `QFJ-P12` remain unchanged, and there is **no QFJ-P13**.

JAO is a sibling of the Aarohi `AVG-0 ... AVG-12` overlay. AVG governs Aarohi / QVGE. JAO governs the autonomy and operations layer above the existing trusted Jarvis kernel. Neither absorbs the other.

## Permanent architecture

JAO is **not** a second Jarvis, a replacement runtime, a second model gateway, a second approval system, a new business authority, or a parallel execution lifecycle.

Existing responsibilities remain where they are:

| Responsibility | Existing authority / seam |
| --- | --- |
| Jarvis and agent runtime kernel | `@qf-jarvis/jarvis-runtime`, `@qf-jarvis/agent-runtime` |
| Model/provider routing and budgets | QF Model Gateway |
| Evaluation, prompt and knowledge governance | existing QF evaluation / prompt / knowledge boundaries |
| Human/Core approval evidence | existing approval and Core-adapter boundaries |
| Communication authorization | existing communication-authorization boundary |
| Execution intent / dispatch provenance | existing execution-intent and dispatch boundaries |
| Operational read model | existing framework-neutral control-plane read contract |
| Business truth and authorization | **QuickFurno Core** |
| Approved external execution | **existing QF execution path through n8n/providers** |

JAO may coordinate these seams. It may not duplicate their authority.

## Mastra role

**Mastra is the selected orchestration framework for the first JAO supervisor implementation, not a QF authority layer.** It may provide supervisor/workflow mechanics, bounded tool orchestration, task decomposition, and resumable coordination behind QF contracts.

Mastra does not become the provider router, business authority, approval authority, consent authority, execution-intent issuer, communication authorization authority, provider/channel transport, or source of commercial/operational truth.

A future framework may replace Mastra without changing this authority model. The overlay is named for the capability, not the framework.

**JAO-0 installs no Mastra dependency.** Before JAO-1 adopts any package, that slice must verify exact package versions, Node/pnpm peer compatibility, license posture, transitive dependency/security impact, and whether every selected framework feature can be adapted without bypassing QF contracts.

## Permanent authority ceiling

1. **QuickFurno Core remains final business authority** for identity, registration, consent/suppression, packages, pricing, payments, activation, assignments, commercial outcomes, and business authorization.
2. **QF Model Gateway remains the governed production inference path.** JAO receives no raw provider credential and creates no second production router.
3. **Recommend -> authorize -> execute remains mandatory.** Broad investigation freedom never implies effect authority.
4. **Read-only is the default capability posture.**
5. Every capability is typed, versioned, allowlisted, scoped, bounded, observable, and revocable.
6. Unknown capability, unknown scope, missing policy, stale authority, or unavailable dependency fails closed.
7. Tool/model/memory output is never authoritative merely because Jarvis produced or remembered it.
8. Specialists keep their own scope and activation gates; delegation does not widen them.
9. Human takeover, pause, suspension, kill switches, and Core refusal remain superior to autonomy.
10. Self-improvement is evidence-first; production prompt/tool/policy/model promotion remains separately reviewed and reversible.

JAO must not hand a supervisor a general provider SDK, unrestricted HTTP client, arbitrary SQL client, unrestricted host shell/filesystem, browser session, or secret-bearing environment as a generic tool.

## Capability-broker boundary

A future **QF Capability Broker** is accepted as a logical boundary, not automatically as a package.

The first JAO-1 composition should expose only the narrow capabilities needed for its proof. A shared `@qf-jarvis/capability-broker` package is extracted only when multiple real consumers need the same governed contract, for example JAO plus a future MCP or premium-worker surface.

Each future capability should declare an id/version, exact schema, actor/scope, data class, read/write/effect class, timeout, cost/resource ceiling, provenance/audit metadata, failure taxonomy, and rollout/kill posture where relevant.

## The overlay

### JAO-0 - Autonomy Architecture and Mastra Compatibility Lock

Governance only. Locks QFJ-P12 ownership, overlay identity, Mastra-as-harness role, no-second-Jarvis/model-gateway rules, authority ceiling, logical capability boundary, shadow-first sequence, and dependency compatibility review.

### JAO-1 - Jarvis Operations Supervisor, Shadow MVP

Build the smallest useful supervisor over approved or synthetic operational observations:

```text
approved/synthetic operational snapshot
              |
              v
       JAO supervisor
              |
              v
      bounded read capability
              |
              v
   QF Model Gateway reasoning
              |
              v
 structured founder recommendation
              |
             STOP
```

The supervisor may investigate, correlate evidence, rank hypotheses, ask for missing evidence, and recommend a next step.

It performs **zero external business effect**: no communication send, Core mutation, n8n execution, provider/channel action, database write, deployment, or automatic remediation.

Exit requires deterministic fixtures for healthy operation, one explainable anomaly, missing evidence, tool failure, model failure, budget exhaustion, human pause, and prompt-injection/tool-abuse attempts, with bounded provenance/cost evidence.


**The offline SHADOW proof for this stage is recorded by
[ADR-0115](../decisions/ADR-0115-jao1-mastra-shadow-operations-supervisor-proof.md).**
Framework-specific Mastra code is confined to `apps/worker/src/jao/mastra-supervisor/`; the app root
does not activate it. The proof parses one injected control-plane snapshot, invokes one bounded L1
read capability, may make at most one provider-neutral call through the existing QF Model Gateway,
and returns an inert founder-facing shadow operational attention record. It adds no provider
credential, direct model route, persistence, migration, specialist delegation, Core/n8n/channel
execution, deployment or production rollout. JAO-1 remains **SHADOW / DEFAULT-OFF** after merge.

### JAO-2 - Governed Specialist Delegation

Delegate bounded analysis only to independently governed and active specialists/capabilities. A PLANNED/DISABLED specialist remains unavailable. Delegation never transfers authority.

**The offline SHADOW proof for this stage is recorded by
[ADR-0116](../decisions/ADR-0116-jao2-governed-specialist-delegation-proof.md).** It lives at
`apps/worker/src/jao/governed-specialist-delegation/` and is activated by nothing. One synthetic
delegation envelope reaches a local governed registry; availability is decided before invocation, so
PLANNED, DISABLED, unknown and wrong-capability requests are refused without the specialist being
called. The authority ceiling is enforced by rank on parsed data: an `L1_READ` supervisor may
delegate at most `L0_REASON`, and it may not exceed the specialist's own governed ceiling either.

The first specialist is **Riya, through her pure behaviour surface only** -- `decideRiyaTurn`, which
calls no model, holds no credential, touches no transport and creates no proposal. Riya's own role,
pause and takeover guards stay superior and her refusals are preserved rather than overridden.
`modelReplyEligible` is carried as DATA: JAO-2 makes **zero** model calls whatever its value.

Registry `ACTIVE` means available to this shadow adapter. It is **not** a statement that any
specialist's production channel is rolled out.

### JAO-3 - Operational Memory and Resumable Investigations

Add non-authoritative durable investigation memory: evidence references, hypotheses, checkpoints, owner corrections, budgets, workflow state, expiry, and supersession.

It must not become a second CRM, consent database, package catalog, payment ledger, vendor registry, assignment table, or activation source. A remembered authorization is not current permission.

**The offline SHADOW proof for this stage is recorded by
[ADR-0117](../decisions/ADR-0117-jao3-operational-memory-resumable-investigations.md).** It lives at
`apps/worker/src/jao/operational-memory/` and is activated by nothing. Investigation state is
durable in PostgreSQL and proved to survive a genuine restart: a checkpoint written through one pool
is resumed through a NEW pool, adapter and operations layer, and read back through a third.

Writes use optimistic `expectedRevision` compare-and-set with `UNIQUE (investigation_id, revision)`
underneath, so two resumed processes cannot lose an update. Retryable writes carry an `operationId`:
an exact replay returns the committed result and writes nothing, while the same id with a different
payload fails closed. Checkpoints are immutable, owner corrections are append-only, and budgets are
persisted so a restart cannot reset them.

Expiry is semantic and needs no scheduler -- an expired investigation refuses resume while its row
remains for audit -- and a superseded or completed investigation cannot be resumed. Resume is always
explicit; there is no background resume, timer or sweeper anywhere in the slice.

Memory carries `memoryClass: OPERATIONAL_NON_AUTHORITATIVE` on every record. Evidence is stored as
REFERENCES only, never payloads; no chain-of-thought, transcript or credential can be stored; and no
field exists anywhere that could express permission. **A remembered authorization is not current
permission**, and QuickFurno Core remains the only source of current business truth.

The JAO-3 schema is a **LOCAL** asset in its own `qf_jarvis_jao3` schema, applied explicitly by the
integration harness to a disposable test database. It is **not** managed migration history, and
managed adoption requires a separate production-activation review.

### JAO-4 - Sandbox and Tool Workbench

Add higher-power tools only inside isolated, least-privilege sandboxes and typed QF capability boundaries. Each tool class requires its own threat model, network/secret/filesystem policy, resource ceiling, approval posture, and rollback.

**The offline SHADOW proof for this stage is recorded by
[ADR-0118](../decisions/ADR-0118-jao4-sandbox-tool-workbench.md).** It lives at
`apps/worker/src/jao/sandbox-tool-workbench/` and is activated by nothing.

The first tool class is **VIRTUAL_ARTIFACT_READ_ONLY**: a caller injects a bounded bundle of
synthetic or sanitized diagnostic text, and four static versioned tools -- `artifact.list.v1`,
`artifact.read.v1`, `artifact.search-literal.v1`, `artifact.sha256.v1` -- answer questions about it
under hard ceilings.

**It is deliberately NOT a host-shell wrapper, container, command runner, browser, HTTP client or
VM.** There is no host filesystem in the slice at all -- `node:fs`, `node:os` and `node:path` are not
imported -- so virtual paths have nothing to traverse into. Network, secrets, environment, process,
shell, database, business effect and production mutation are all literal DENY on every tool
descriptor, enforced by parsing rather than by policy. **No arbitrary-command isolation is claimed;
a future command-execution class needs its own threat model and owner review.**

Registry authorization is bound to the implementation invoked across all security fields, so an
unknown, planned, disabled, version-mismatched or mismatched tool produces zero invocations. Search
is a LITERAL substring, never a caller-supplied pattern. Artifact content is untrusted DATA that
cannot create a call, alter the plan, install a tool, raise a budget or grant authority.

Tool output is bounded evidence marked `untrustedEvidence`, never permission. Zero model calls, zero
specialist calls, zero JAO-3 memory writes, zero production mutation. Approved remediation remains
JAO-6 / JAO-7 territory.

### JAO-5 - Controlled Ambient Operations

Add scheduled/event-triggered investigations over approved operational signals. Every monitor has a named owner, cadence/trigger, scope, budget, deduplication rule, expiry, quieting rule, and kill switch. Observation may create attention; it does not create business authority.

**The offline SHADOW proof for this stage is recorded by
[ADR-0119](../decisions/ADR-0119-jao5-controlled-ambient-operations.md).** It lives at
`apps/worker/src/jao/controlled-ambient-operations/` and is activated by nothing.

**There is no scheduler.** `runJao5AmbientCycle` is an explicit function; no timer, cron, queue,
webhook or event consumer exists or is started. What it proves is that schedule and event
eligibility are decided deterministically from DURABLE state -- so a restart cannot reset dedupe,
budgets, quieting, the last cadence slot, expiry or the kill switch, which is the way ambient
governance is usually bypassed.

Exactly two static monitors prove both trigger classes -- one 900-second cadence, one approved
`control-plane.system-health.changed.v1` signal -- and every clause of the requirement above is a
REQUIRED field on the definition, so a monitor missing an owner, budget, dedupe rule, expiry, quiet
rule or kill switch cannot be constructed. Scope is `CONTROL_PLANE_SYSTEM_HEALTH` only.

A claim is taken and committed BEFORE any investigation starts, and **no database transaction is
held across model inference**. Duplicate suppression is a database uniqueness constraint, so one
cadence slot or one event id can start at most one investigation -- across restart and under
concurrency. A crash after claim consumes the claim and never silently repeats it; downtime
collapses to one current slot rather than replaying a backlog. The kill switch is TERMINAL and there
is no unkill.

JAO-5 reuses the canonical JAO-1 shadow investigation rather than inventing a second engine, the QF
Model Gateway remains the only model path, and the public runner accepts no investigator callback.
Output is inert `SHADOW_OPERATIONAL_ATTENTION`: zero business effect, zero Core mutation, zero
execution intents, zero channel sends, zero n8n, zero JAO-3 writes, zero JAO-4 tool calls and zero
specialist delegation. The JAO-5 schema is LOCAL and is not managed migration history.

### JAO-6 - Governed Business-Action Proposals

Permit the supervisor to construct proposals that enter the **existing** recommendation -> Core/human authorization -> execution-intent path. No parallel execution system is introduced. Communication remains subject to execution-time consent/suppression eligibility.

### JAO-7 - Advanced Governed Autonomy

Policy-bounded multi-agent planning, long-running operations, capacity optimization, incident-remediation proposals, continuous evaluation, and carefully expanded reversible autonomy.

Advanced autonomy does not relax the permanent authority ceiling. Irreversible, financial, identity, consent, entitlement, destructive, or externally binding actions remain behind their governed authority class.

## Relation to Aarohi AVG

JAO and AVG are sibling overlays under QFJ-P12.

- AVG continues independently through its own roadmap.
- JAO-0 does **not** block AVG-5 or later AVG work.
- AVG does not require Mastra to progress.
- Future JAO delegation may call an Aarohi capability only after that capability is separately implemented and activated.
- JAO does not change the Core ACTIVE handoff from Aarohi to Anisha.

## Activation posture

Implementation is not activation. Shadow output authorizes nothing. Passing evaluation does not promote rollout.

**Current posture:** JAO-0 governance adopted. **JAO-1 through JAO-5 merged as OFFLINE,
DEFAULT-OFF, SHADOW proofs** -- present in the worker composition, activated by nothing; the JAO-3
and JAO-5 schemas are applied to no managed database, JAO-4 reaches no host, network or command, and
JAO-5 starts no scheduler. **JAO-6 and JAO-7 remain PLANNED / DISABLED.**

## JAO-0 exit gate

JAO-0 is complete when QFJ-P12 ownership, ADR-0114, this overlay, Mastra-as-harness, the authority ceiling, and the bounded JAO-1 shadow proof are recorded without adding a dependency, runtime, migration, credential, provider route, database access, external execution, deployment, or rollout.