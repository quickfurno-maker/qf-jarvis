# ADR-0114 - QFJ-P12 Jarvis Autonomy & Operations (JAO) and Mastra supervisor boundary

**Status:** Accepted - governance and documentation only. No runtime package, Mastra dependency, migration, database access, provider route, credential, channel, n8n execution, deployment, or rollout is introduced. JAO remains **PLANNED / DISABLED**.
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md), [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md), [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md).

## Context

Baseline: `main` at `b9ec2d7854073492e927f82f836d36efb1c24232`, the merge of PR #155 (AVG-4). On this baseline `ADR-0113` belongs to AVG-4 and `ADR-0114` is unclaimed.

QF Jarvis already has the trusted kernel an autonomous supervisor would otherwise be tempted to rebuild: provider-neutral model routing/governance, agent/Jarvis runtimes, governed knowledge/prompts, evaluation evidence, human/Core approval boundaries, communication authorization, execution-intent provenance, dispatch/replay protection, operational read contracts, and specialist packages.

The missing capability is above those seams: a bounded Jarvis supervisor that can investigate operational conditions over time, decompose a problem, use narrow tools, delegate analysis, resume work, and present evidence-backed recommendations without becoming a second business or execution authority.

The canonical Post-MVP delivery scope already includes advanced Jarvis autonomy: multi-agent planning, long-running workflows, specialist delegation, approval-aware autonomous execution, incident remediation, capacity optimization, continuous evaluation, and policy-bounded automation.

The owner selected Mastra as the framework to evaluate for that supervisor role. The design question is therefore not how to replace Jarvis with Mastra, but where Mastra can sit so it increases reasoning freedom without weakening the controls the repository already built.

## Decision

### 1. Adopt JAO under QFJ-P12

Adopt **Jarvis Autonomy & Operations (JAO)** as a QFJ-P12 capability overlay:

- `JAO-0` - Autonomy Architecture and Mastra Compatibility Lock
- `JAO-1` - Jarvis Operations Supervisor, Shadow MVP
- `JAO-2` - Governed Specialist Delegation
- `JAO-3` - Operational Memory and Resumable Investigations
- `JAO-4` - Sandbox and Tool Workbench
- `JAO-5` - Controlled Ambient Operations
- `JAO-6` - Governed Business-Action Proposals
- `JAO-7` - Advanced Governed Autonomy

The canonical overlay is [jarvis-autonomy-operations-roadmap-overlay.md](../architecture/jarvis-autonomy-operations-roadmap-overlay.md).

JAO ids are overlay ids, not major phases. `QFJ-P00` through `QFJ-P12` remain unchanged. There is no QFJ-P13.

JAO is a sibling of Aarohi's AVG overlay. It does not absorb AVG, rename AVG, or move Aarohi out of QFJ-P12.

### 2. Mastra is a harness, not an authority layer

Mastra is the selected orchestration framework for the first JAO supervisor implementation, subject to an exact dependency/compatibility review before JAO-1 adopts package versions.

Mastra may provide supervisor/workflow mechanics, bounded tool orchestration, task decomposition, and resumable coordination **behind QF contracts**.

Mastra does not become the business authority, provider router, approval/consent authority, execution-intent issuer, communication authorization authority, provider/channel transport, or source of operational/commercial truth.

The JAO authority model is framework-neutral so Mastra may later be replaced without moving QF authority.

### 3. Preserve the existing trusted kernel

JAO composes existing seams and must not rebuild them.

- Jarvis/agent runtimes remain the governed runtime kernel.
- QF Model Gateway remains the only governed production inference path.
- Existing evaluation/prompt/knowledge boundaries remain authoritative for their domains.
- Existing approval and communication-authorization boundaries remain the path for authority evidence.
- Existing execution-intent and dispatch boundaries remain the execution provenance/verification path.
- QuickFurno Core remains final business authority.
- n8n/providers perform effects only through the existing governed execution model.

There is no Mastra mode that bypasses these seams.

### 4. Broad reasoning, narrow effects

JAO should maximize freedom to observe, investigate, compare evidence, form hypotheses, plan, decompose, delegate, and recommend while minimizing ambient effect authority.

Read-only is the default capability posture. Every capability is typed, versioned, allowlisted, scoped, bounded, observable, revocable, and fail-closed.

No raw provider SDK, general HTTP client, arbitrary SQL client, unrestricted shell/filesystem, browser session, or secret-bearing environment is handed to the supervisor as a generic tool.

### 5. Capability Broker is a logical seam first

Accept a future **QF Capability Broker** concept: the boundary where a supervisor sees bounded QF capabilities instead of raw infrastructure clients.

JAO-0 deliberately creates no broker package. JAO-1 should implement only its narrow adapter. Extract a shared package only when multiple genuine consumers need the same contract, such as JAO plus a future MCP/premium-worker surface.

### 6. Model calls remain behind QF Model Gateway

A JAO supervisor receives no raw production provider credential and creates no independent provider routing policy.

Any JAO model use is adapted to QF Model Gateway so provider identity, capability/data-class policy, budgets, rollout, provenance, structured-output validation, and evaluation remain governed by existing QF boundaries.

Mastra-native provider configuration is not the production architecture.

### 7. Memory is context, never business truth

Future operational memory may hold investigation state, evidence references, hypotheses, checkpoints, owner corrections, budgets, expiry, and resumable workflow state.

It must not become a second CRM, consent database, package catalog, payment ledger, vendor registry, assignment table, or activation source.

A remembered approval is not current permission. Authority/freshness are re-established at the owning boundary.

### 8. JAO-1 is shadow-only

The first implementation target is:

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

JAO-1 may detect one operational anomaly, gather bounded evidence, explain hypotheses, and recommend a next step.

It performs no external business effect: no communication send, Core mutation, n8n execution, provider/channel action, database write, deployment, or automatic remediation.

### 9. Specialist delegation never expands authority

JAO may later delegate only to independently governed and active specialists/capabilities. Delegation cannot activate a PLANNED/DISABLED agent.

Aarohi AVG work proceeds independently. JAO-0 does not block AVG-5 and does not require Mastra for AVG. A future JAO -> Aarohi delegation still obeys the AVG activation gates and the Core ACTIVE handoff to Anisha.

### 10. JAO-0 installs nothing

Before JAO-1 introduces Mastra dependencies, that slice must record exact packages/versions, Node/pnpm peer compatibility, license posture, transitive dependency/security impact, and the mapping from each framework feature to its constraining QF seam.

A dependency review may narrow or reject a Mastra feature without changing JAO ownership.

## Rejected alternatives

**Create QFJ-P13.** Rejected. QFJ-P12 already owns advanced intelligence/future agents.

**Put Mastra inside AVG-12.** Rejected. AVG is Aarohi-specific; JAO is cross-Jarvis autonomy/operations.

**Replace Jarvis runtime or Model Gateway with Mastra defaults.** Rejected. That would create a second source of policy and invalidate existing authority/provenance proofs.

**Let Mastra call providers/infrastructure directly.** Rejected. Direct provider, DB, Core, n8n, channel, shell, filesystem, or arbitrary HTTP access turns reasoning infrastructure into ambient authority.

**Create a shared broker package now.** Rejected. The logical seam is accepted, but shared code waits for multiple genuine consumers.

**Treat Mastra memory/tool approvals as QF authority.** Rejected. Framework state is orchestration state; Core and QF contracts remain authoritative.

## Consequences

- Advanced Jarvis autonomy now has a canonical home under QFJ-P12 without a new major phase.
- Aarohi AVG work continues independently.
- Mastra can be evaluated/introduced without replacing the existing Jarvis kernel.
- The first autonomy implementation is read-only/shadow, so disabling its composition is sufficient rollback.
- Future MCP/premium-worker surfaces can reuse the same capability model when a shared broker becomes justified.
- Framework replacement remains possible because authority is QF-owned, not Mastra-owned.

## Non-goals

JAO-0 does not install/version-lock Mastra, implement a supervisor, create persistent autonomy memory or MCP, add a broker package/tool sandbox/migration/table, make a live provider call, add any Core/n8n/channel integration, change Riya/Aarohi/Anisha behaviour, change model/prompt/evaluation/rollout settings, deploy anything, or activate autonomous action.

## Change-control rule

JAO's QFJ-P12 ownership, Mastra-as-harness boundary, no-second-model-gateway rule, and permanent authority ceiling may be changed only by a superseding ADR.

Later slices may implement JAO stages, select exact Mastra versions, extract a shared broker, or advance rollout without replacing this decision provided the authority ceiling remains intact.
