# Report 03 — Model Plan, Proposal, Core Decision, and Authority Proof

**Slice:** QFJ-M2 — Core Decision and Reply Orchestration Foundation. **ADR:** [ADR-0055](../../decisions/ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md).

## Model plan and draft validation

The reply plan binds exact references — the model port's `ProviderReleaseRef` (release/provider/model/version/config-digest/execution-class), prompt family/version, capability profile ref, and optional evaluation ref, plus the policy revision and the exact knowledge citations — with **no wildcard/`latest`** and no business-authority field. The minimized normalized inbound text is passed **only** to the model port. The draft the port returns is validated by a **strict** schema (proven): a fabricated or versionless citation (not in the plan's exact citation set), or any extra field such as a raw provider body/header or a chain-of-thought key, makes the draft **invalid** and no Core request is made. **No live model is called** in this slice (the fake records the invocation).

## Proposal contract

Every proposal is frozen, `PENDING_CORE_VALIDATION`, and carries **no** `send`/`execute`/`authorize`/`callN8n`/`commit`/`deliver` method (proven). The closed kinds `REPLY`, `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION`, `NO_ACTION` are all constructible and pending. Actor↔party scope is enforced at creation: a `RIYA` proposal on a `VENDOR` party (or `ANISHA` on a `CLIENT` party) is refused (`scope-violation`); deterministic assignment never produces a crossover (CLIENT→RIYA, VENDOR→ANISHA).

## Core decision port — the only business authority

The Core decision comes **solely** from the injected port; agent-runtime cannot fabricate `ACCEPTED`. Proven:

- a **missing** Core port fails closed to `CORE_UNAVAILABLE`;
- each outcome (`ACCEPTED`, `REJECTED`, `HUMAN_REVIEW_REQUIRED`, `RETRY_LATER`, `STALE_REVISION`) is returned safely and is **revision-bound** (`boundRevision`);
- the decision is immutable (frozen), and `ACCEPTED` carries **no** `send`/`deliver`/`execute` method — it means Core-approved **only**, never sent, delivered, executed, or persisted;
- the orchestration result exposes no `send`/`deliver`/`transmit`/`dispatch` — **there is no delivery command**.

QuickFurno Core is the final business authority; models/agents/Jarvis authorize and execute nothing; n8n later executes only a separately authorized delivery command; Riya stays client-only, Anisha vendor-only, Jarvis coordination.
