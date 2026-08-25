# Jarvis Autonomy & Operations (JAO) capability overlay (JAO-0 ... JAO-7)

**Document status:** Canonical capability overlay owned by **QFJ-P12 - Advanced Intelligence and Future Agents**. Adopted under [ADR-0114](../decisions/ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md). Read with [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), [mvp-post-mvp-delivery-overlay.md](./mvp-post-mvp-delivery-overlay.md), and [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).

**Runtime status: PLANNED / DISABLED. JAO-0 is governance only.** No Mastra dependency, supervisor runtime, autonomous loop, capability-broker package, memory store, MCP server, provider route, credential, database access, n8n execution, channel action, deployment, or rollout is activated here.

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

### JAO-3 - Operational Memory and Resumable Investigations

Add non-authoritative durable investigation memory: evidence references, hypotheses, checkpoints, owner corrections, budgets, workflow state, expiry, and supersession.

It must not become a second CRM, consent database, package catalog, payment ledger, vendor registry, assignment table, or activation source. A remembered authorization is not current permission.

### JAO-4 - Sandbox and Tool Workbench

Add higher-power tools only inside isolated, least-privilege sandboxes and typed QF capability boundaries. Each tool class requires its own threat model, network/secret/filesystem policy, resource ceiling, approval posture, and rollback.

### JAO-5 - Controlled Ambient Operations

Add scheduled/event-triggered investigations over approved operational signals. Every monitor has a named owner, cadence/trigger, scope, budget, deduplication rule, expiry, quieting rule, and kill switch. Observation may create attention; it does not create business authority.

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

**Current posture: JAO-0 governance adopted; JAO-1 through JAO-7 PLANNED / DISABLED.**

## JAO-0 exit gate

JAO-0 is complete when QFJ-P12 ownership, ADR-0114, this overlay, Mastra-as-harness, the authority ceiling, and the bounded JAO-1 shadow proof are recorded without adding a dependency, runtime, migration, credential, provider route, database access, external execution, deployment, or rollout.