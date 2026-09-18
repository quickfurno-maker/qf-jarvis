# ADR-0154 — Native Temporal durable orchestration and QuickFurno Core Automation boundary

**Status:** Accepted — implementation prepared; repository merge/deployment requires a writable project connection
**Date:** 2026-09-17
**Supersedes:** the execution-fabric portion of ADR-0002/ADR-0153 that named the retired external workflow engine.

## Context

Jarvis needs multi-hour and multi-day agent journeys: client satisfaction follow-ups, vendor response
waiting, cross-category discovery, prospect acquisition, human-review waiting, crash recovery, retry and
reconciliation. These are orchestration concerns, not business-authority concerns.

QuickFurno now owns its own **Core Automation** execution subsystem. The external workflow engine is
removed from the active architecture.

Mastra's Temporal integration exists, but the package is currently marked experimental. For the
production boundary Jarvis therefore uses the stable native Temporal TypeScript SDK directly. Mastra
remains the intelligence/agent layer and is invoked from Temporal Activities.

## Permanent boundary after this ADR

> Jarvis recommends and reasons.
> Temporal remembers and coordinates.
> QuickFurno Core authorizes.
> QuickFurno Core Automation executes authorized effects.
> Providers deliver.
> QuickFurno Core records business truth and emits canonical events.

No line in this decision permits Temporal or Jarvis to become a business authority.

## Decision

### 1. Native Temporal SDK

Use pinned `@temporalio/*` 1.24.0 packages for the durable control plane. Do not place the experimental
`@mastra/temporal` package on the production path.

Temporal owns:

- durable timers and waits;
- restart/crash recovery;
- workflow signals from canonical Core events;
- activity retry/backoff for technical failures;
- long-running journey progress;
- Continue-As-New history bounding;
- operator visibility of workflow state.

Temporal does **not** own leads, vendors, assignments, consent, payments, packages, communication
eligibility, approvals or execution truth.

### 2. Temporal history is content-minimized

Workflow arguments, signals, queries and activity results contain only opaque identifiers, stable reason
codes, control state and content-free Core outcomes. Raw conversation text, model output, phone numbers,
emails, addresses, provider payloads and credentials never enter Temporal history.

The Activity process may temporarily hold model output and a `CoreDecisionRequest`. It must submit that
request through Action Kernel before returning. Its return value is content-free.

### 3. Action Kernel becomes a shared package

ADR-0153 kept Action Kernel app-internal because it had one consumer. Temporal creates the genuine
second consumer: `apps/api` and `apps/temporal-worker`. The extraction trigger is now satisfied, so the
kernel moves to `@qf-jarvis/action-kernel`.

Action Kernel remains a submission firewall, not an authorization engine. Even a Core `ACCEPTED`
receipt carries `executionAuthority: NONE` and `canExecute: false`.

### 4. One durable workflow, multiple bounded journey owners

A generic `jarvisDurableJourneyWorkflow` coordinates four explicit journey classes:

| Journey         | Owning agent |
| --------------- | ------------ |
| CLIENT_SUCCESS  | Riya         |
| VENDOR_SUCCESS  | Anisha       |
| PROSPECT_GROWTH | Aarohi       |
| FOUNDER_TASK    | Jarvis       |

Cross-agent ownership does not parse at the shared contract boundary.

The workflow is intentionally generic. Domain behaviour stays in the owning agent/planner, not in the
workflow engine.

### 5. Core events wake journeys

`apps/api` uses Temporal `signalWithStart` for race-safe "start if absent, otherwise wake existing"
behaviour. The stable workflow ID is derived from journey kind + opaque journey ID.

A Core canonical event can wake a sleeping workflow immediately. If no event arrives, the durable timer
advances the journey. A worker/server restart does not lose the wait.

### 6. Continue-As-New

After 100 cycles, an idle journey continues as new. A pending signal is processed before the boundary so
no Core event is discarded. This keeps histories bounded for journeys that may live for months.

### 7. Core Automation replaces the retired executor

Shared system contracts now name `quickfurno-core-automation` as the execution subsystem. Execution
intents remain Core-issued, at-most-once and idempotency-bound. Temporal is not a valid executor and is
not a valid reporting authority for provider outcomes.

## Failure rules

- Core unavailable -> the activity returns a content-free retry/wait disposition; no external effect is
  fabricated.
- Same proposal identity with changed content -> Action Kernel refuses before a second Core submission.
- Ambiguous execution result -> QuickFurno Core requires reconciliation before another attempt.
- Temporal unavailable -> new orchestration cannot advance, but Core business truth is unaffected.
- Temporal history loss must never mean business-state loss because business truth is never stored there.

## Consequences

This architecture makes Jarvis materially more capable without making it more dangerous: journeys can
survive days, restarts and transient failures, while business authority remains concentrated in
QuickFurno Core.
