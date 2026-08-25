# ADR-0113 — QFJ-P12 / QVGE AVG-4: Aarohi outreach-workspace offline domain

**Status:** Accepted — offline domain only. No Control Plane UI, persistence, model generation,
approval submission runtime, provider, channel, credential, execution path, migration or rollout is
activated by this decision. Aarohi remains **PLANNED / DISABLED**.

**Date:** 2026-08-25

**Supersedes:** nothing. ADR-0002 and ADR-0007 remain authoritative for recommend/authorize/execute
and the separation between the approval interface and approval authority. ADR-0085 remains the
governing Aarohi boundary. ADR-0112 remains the canonical AVG-3 scoring/contact-eligibility decision.

---

## Context

AVG-3 gives a future workspace two facts that must remain visibly separate:

1. evidence-readiness priority, which helps a human order review work; and
2. a point-in-time Core-gated contact-eligibility verdict, which can refuse contact but never sends it.

AVG-4 is the first stage that needs a human-facing concept: a reviewer must be able to see the
prospect evidence, work on inert draft text, pause or reject that draft, and eventually ask the
existing QuickFurno approval path whether the proposal may proceed.

The repository already has shared approval and communication-authorization infrastructure. Aarohi
must not duplicate either one inside its agent package. In particular, an Aarohi workspace object
must never become a second `ApprovalRequestV1`, a local approval decision, a communication
authorization, an execution intent, or a provider request.

## Decision

### 1. A workspace review item composes evidence, priority and current Core gate without merging them

Add `buildWorkspaceReviewItem(profile, coreObservation)`.

The function accepts a canonical AVG-2 enrichment profile and a Core observation. It returns a frozen
review item containing:

- the canonical enrichment profile itself;
- the AVG-3 evidence-readiness priority assessment; and
- the separate AVG-3 contact-eligibility verdict.

A high priority does not rewrite a Core refusal. A low priority does not manufacture one. Malformed or
cross-prospect Core truth remains visible as a refusal inside an otherwise reviewable item.

A non-canonical profile is refused before a workspace item exists.

### 2. Draft text is inert workspace material

Add an immutable draft revision contract.

A draft has:

- one opaque `draftRef`;
- one `prospectRef` derived from the canonical profile used to create it;
- a monotonically increasing revision number;
- bounded canonical text;
- one opaque actor reference;
- one caller-supplied canonical UTC instant; and
- one of exactly three states: `OPEN`, `HELD`, `REJECTED`.

There is deliberately no `APPROVED`, `SENT`, `EXECUTED`, provider, destination, recipient, channel or
credential field.

Draft text is a proposal for human review. AVG-4 does not certify the text as factual, commercially
current, consented, deliverable or safe to send. Later stages own sales behavior, commercial truth,
channel integration and execution.

### 3. Draft changes are revisions, never in-place mutation

`reviseWorkspaceDraft` creates a new OPEN revision with new actor/time provenance.

`transitionWorkspaceDraft` creates a new revision for the small review lifecycle:

- `OPEN -> HELD`
- `HELD -> OPEN`
- `OPEN -> REJECTED`
- `HELD -> REJECTED`

`REJECTED` is terminal.

The previous revision object is never mutated. A later persistence layer may store this revision chain
as audit evidence, but AVG-4 itself stores nothing.

### 4. AVG-4 stops at approval-request readiness

Add `evaluateWorkspaceApprovalReadiness(draft, profile, coreObservation)`.

A positive result is exactly `READY_FOR_CORE_APPROVAL_REQUEST`.

That token means only:

- the draft is canonical and `OPEN`;
- the canonical profile describes the same prospect; and
- a fresh invocation of the AVG-3 Core gate currently returns eligible.

It does **not** create the repository's canonical approval request. It does not mark anything approved.
It does not record an approval decision. It does not create communication authorization. It does not
create an execution intent.

This is deliberate. ADR-0002 says Jarvis recommends, Core authorizes, n8n executes and providers
deliver. ADR-0007 allows Jarvis to host an approval interface, but a click is only a request and Core
owns the authoritative decision record.

The existing shared approval/communication packages remain the owners of those later contracts. AVG-4
adds no workspace dependency on them and no runtime composition.

### 5. Readiness always rechecks Core

A review item that was eligible earlier is not a standing permission.

When readiness is evaluated, the current Core observation is evaluated again through AVG-3. If Core now
reports prior contact, suppression, an existing relationship, ambiguity, unknown truth, unavailability
or an invalid/cross-prospect observation, readiness fails closed.

The two separation proofs remain load-bearing:

- priority 9/9 + Core `DO_NOT_CONTACT` -> not ready;
- priority 0/9 + Core `NOT_REGISTERED` -> ready.

### 6. No actual UI is activated by the domain contract

The roadmap calls AVG-4 a human-facing workspace. This ADR establishes the offline contract that a
future Control Plane surface can safely render.

It does not add a route, page, API, database table, runtime service or deployment. Those compositions
must preserve ADR-0007's rule that no optimistic/local approved state exists and must use the existing
shared approval boundary rather than reimplementing it.

## Public surface

AVG-4 adds:

- `AAROHI_AVG4_CONTRACT_VERSION`
- `MAX_WORKSPACE_DRAFT_LENGTH`
- `WORKSPACE_DRAFT_STATES`
- `WORKSPACE_DRAFT_REFUSALS`
- `WORKSPACE_APPROVAL_READINESS_OUTCOME`
- `WORKSPACE_APPROVAL_READINESS_REFUSALS`
- `workspaceDraftSchema`
- `parseWorkspaceDraft`
- `buildWorkspaceReviewItem`
- `createWorkspaceDraft`
- `reviseWorkspaceDraft`
- `transitionWorkspaceDraft`
- `evaluateWorkspaceApprovalReadiness`

The corresponding result/type shapes are immutable.

## Containment

Unchanged:

- no Aarohi runtime;
- no persistence or migration;
- no model call or draft generation service;
- no provider/channel credential;
- no contact destination;
- no Meta/Instagram/WhatsApp/n8n integration;
- no canonical approval-request duplication;
- no local approval decision;
- no communication authorization;
- no execution intent;
- no marketplace mutation;
- no package/pricing truth;
- no production activation.

The Aarohi package remains a leaf with `zod` as its only dependency.

## Tests required by this decision

The AVG-4 suite locks:

- review items preserve profile, priority and contact eligibility as separate fields;
- 9/9 priority cannot bypass Core suppression;
- 0/9 priority can remain Core-eligible;
- invalid Core observations remain fail-closed;
- canonical drafts begin `OPEN` at revision 1;
- draft text is bounded and canonicalized;
- authority/destination/channel/provider-shaped extra fields are refused;
- draft revisions are immutable;
- hold/reopen/reject transitions are closed and deterministic;
- `REJECTED` is terminal;
- revisions do not move backwards in time;
- only an OPEN matching draft may become approval-request-ready;
- readiness rechecks Core rather than trusting an earlier review;
- readiness exposes no approval decision, execution intent, destination or send authority;
- public exports remain exact;
- no package/app composes Aarohi at runtime.

## Consequences

AVG-4 now has a bounded offline workspace domain that can support a later human UI without creating a
new authority system.

The next overlay stage remains **AVG-5 — Instagram Conversation Integration**. AVG-5 is not activated
by this decision.
