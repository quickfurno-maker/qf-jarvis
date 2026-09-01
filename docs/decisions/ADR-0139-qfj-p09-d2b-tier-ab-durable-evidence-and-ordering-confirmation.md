# ADR-0139 — QFJ-P09 D2b: Tier A/B durable evidence and ordering confirmation

**Status:** **Accepted / MERGED** as PR #181 — reviewed head `ede0be8f02b51002a9e677ab0792df801e3ed89d`, merge commit `88ddab543f693c849f710db8de287bac005aba74`.
**Baseline:** `182a9cb1c00cf1e3ad0225654992099208b992a0` (main after PR #180 / D4 / ADR-0140)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited; no Core code was read, accessed or modified in this slice**

**Docs-only and OFFLINE.** No production code, no contract, no event registry change, no migration, no
Core/Supabase/n8n/provider access, no message, rollout **OFF**.

## Prerequisites, all merged

| Slice                                      | ADR                                                                                      | PR   | Merge commit                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------ |
| D2 — Core protocol/event gap decision      | [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md)                | #178 | `fb23e46efbad66b6a82ecc9920c86548aeb058e1` |
| D2a — accepted-event provenance hardening  | [ADR-0138](./ADR-0138-qfj-p09-d2a-accepted-event-write-path-and-provenance-hardening.md) | #179 | `2027d3215a36e8fdbed6809d0f12a917bb71cdee` |
| D4 — trusted communication evidence reader | [ADR-0140](./ADR-0140-qfj-p09-d4-trusted-communication-evidence-read-capability.md)      | #180 | `182a9cb1c00cf1e3ad0225654992099208b992a0` |

---

## Context

**This is bounded confirmation, not a fresh architecture choice.** D2 already decided the option per
Tier A/B state and rejected the separate durable Jarvis log. What D2 left genuinely open is the
question the Model-2 design doc parked in §6.3:

> If Jarvis-local coordination evidence ever lives outside that stream, its ordering relative to Core
> evidence must be made deterministic by a mechanism decided later.

D2b closes that "later", and closes it in the only direction the accepted decisions leave available.
It exists so **D3** can define the first honest V2 contract without inventing a wire name, a
placeholder evidence token, or a durability claim that is not true.

The frozen fact base is the design doc's §6.1 replayability table: the complete communication canonical
event surface is five events, and **no canonical event records a communication draft, a submission, or
a schedule**. Nothing in this slice re-audits that.

---

## Decision

### 1. The five Tier A/B states

| State                     | D2 option       | Author                                         | Durable recorder                    | Durable in first MVP? | Exact evidence requirement                                                                       | Ordering if later durable                        | D3 first-union treatment                         | Fail-closed behaviour                     |
| ------------------------- | --------------- | ---------------------------------------------- | ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| `draft`                   | **C**           | Jarvis                                         | **none**                            | **NO**                | none — construction is not a durable fact                                                        | n/a                                              | **exclude**                                      | ephemeral runtime state only              |
| `authorization-requested` | **A**           | **Jarvis** authors the request                 | **Core** records receipt            | **CONDITIONAL**       | a durable **Core-recorded receipt/acceptance of an actually submitted `CommunicationRequestV1`** | the **same** accepted Core event-position stream | **exclude until the exact primitive is adopted** | absent receipt ⇒ state **unavailable**    |
| `scheduled`               | **A**           | **Jarvis** authors the scheduling coordination | **Core** records the occurrence     | **CONDITIONAL**       | a durable **Core-recorded scheduling occurrence, after lawful authorization**                    | the **same** accepted Core event-position stream | **exclude until the exact primitive is adopted** | absent occurrence ⇒ state **unavailable** |
| `follow-up-requested`     | **C**           | Jarvis                                         | **none in the prior lifecycle**     | **NO**                | a follow-up is a **new `CommunicationRequestV1` and a new lifecycle**                            | n/a                                              | **exclude**                                      | no inferred predecessor state             |
| `human-handoff-required`  | **C / BLOCKED** | Jarvis coordination                            | **none admitted for the first MVP** | **NO**                | a future **adopted, replayable** primitive, if a real consumer ever justifies one                | the same Core stream **only if adopted**         | **exclude**                                      | absent evidence ⇒ state **unavailable**   |

#### `draft` — Option C

Ephemeral, local coordination state. **Constructing a `CommunicationRequestV1` is not durable evidence
of anything**: construction ≠ submission. Jarvis may hold a draft in transient runtime context where a
workflow needs it, but there is no durable first-projection row, no rebuild requirement, and **D3 must
not require durable draft evidence**. No event name, no local durable log, no migration. Persisting a
draft _to make the projection look complete_ is exactly the move this forbids.

#### `authorization-requested` — Option A, conditional

Durable only when **Core has durably recorded receipt/acceptance of an actually submitted request**.
The chain stays separated end to end:

> constructed request **≠** submitted request **≠** Core receipt **≠** Core business authorization

**Core recording receipt does not make Core the author of Jarvis's decision.** Jarvis authors the ask;
Core records that it arrived. Those are different facts with different owners, and collapsing them
would hand Jarvis's own coordination decision to Core — or, worse, let Jarvis claim Core's.

Until C1/C2 adopts the exact lawful contract: the state stays **CONDITIONAL**, production rebuild must
not infer it, and **D3 must not fabricate an evidence variant tied to an event that does not exist**.

#### `scheduled` — Option A, conditional

Durable only when **Core has durably recorded that scheduling actually occurred, after lawful
authorization**.

**Not evidence, individually or together:** `CommunicationRequestV1.requestedTiming` · a requested
"send later" · a future timestamp · a Jarvis timer object · a queue delay · a scheduler intention · a
wall-clock comparison · an authorization on its own. A _request_ to schedule is not a _record_ that
anything was scheduled — the design doc already forbids that inference, and D2b keeps it forbidden.

#### `follow-up-requested` — Option C

No durable predecessor state in the first MVP. **A follow-up attempt is a new `CommunicationRequestV1`
and a new lifecycle**, not a retry-state inside the previous one. No separate durable follow-up log, no
cross-lifecycle inferred edge, and no D3 durable variant in the first implementation.

#### `human-handoff-required` — Option C / blocked

Excluded from the first durable projection. **A candidate contract existing is not a reason to adopt
it**: `qf.communication.human-handoff-requested` exists in this repository, but accepted S3/D2 did not
establish the adopted, replayable truth the first projection would need, and **D4 did not admit that
family**. No first D3 durable variant, no state recovery from `human-handoff-recorded`, and no
implication from a handoff request to `completed`. A later governed slice may revisit this if a real
consumer and an adopted replayable primitive justify it.

### 2. Option B stays rejected

A separate durable Jarvis coordination log remains **REJECTED_FOR_MVP**, and the reasons are worth
stating rather than assuming:

- it creates a **second replay and ordering domain**, which is the problem, not the solution;
- it then requires **cross-stream reconciliation** between Core positions and Jarvis positions — the
  determinism §6.3 asked for, purchased at the cost of inventing the very ambiguity it solves;
- it **duplicates authority and evidence ownership**, so two stores could disagree about one lifecycle;
- it likely costs a migration and a persistence surface;
- **Options A and C already cover the MVP consumer honestly**; and
- **full 18-state replay is not a launch gate** (ADR-0137), so nothing is blocked by declining it.

**No migration is allocated to implement the rejected option**, and none is allocated at all.

### 3. Ordering — one stream, conditionally

For any Tier-B state that later becomes durable through Option A:

```
Jarvis authors the coordination fact (request / scheduling intent)
  -> Core durably records receipt / occurrence
  -> Core publishes the adopted canonical event under normal Core event/outbox governance
  -> Jarvis authenticated ingestion (verify -> prepare -> persist, D2a-contained)
  -> the accepted event receives the existing gap-free projection position
  -> purpose-specific evidence admission, if the consumer needs it
  -> the communication-state projection consumes THE SAME ordered position stream
```

**No second ordering domain is created.** Explicitly rejected: wall-clock or `createdAt` ordering ·
`decidedAt` / `scheduledAt` ordering · UUID or `eventId` ordering · arrival-order assumptions ·
last-writer-wins · a local Jarvis sequence · dual-stream merge · any "Core position vs Jarvis position"
reconciliation.

The substrate already exists and is not being extended: `projection_event_position` is the gap-free,
commit-ordered position (ADR-0036), and **D4 already reads evidence by exactly that position**. An
Option-A fact that arrives as an adopted Core canonical event lands in the same stream by construction,
so the ordering question answers itself — which is precisely why Option B, which would have created a
second stream, is the one that had to be refused.

#### The qualification that keeps this honest

**D2b does not claim the authorization-request receipt or the scheduling occurrence already has an
adopted canonical event. Neither does.** The conclusion is conditional:

> **IF** an Option-A Tier-B primitive is adopted as a Core-recorded canonical event, it **MUST** enter
> the same accepted Core event-position stream. **No separate Jarvis ordering stream will be created.**

If a future adoption slice finds that its primitive _cannot_ enter that stream, **that slice must
reopen this decision** rather than quietly add an invisible ordering bridge.

### 4. Missing evidence

> **Missing evidence means state unavailable, not state inferred.**

Not synthesized, not guessed from timestamps, not reconstructed from a successor or predecessor state.
And, restating the design doc's §6.2 rule because it is what makes the rest hold: **a read-model row is
never its own evidence** — writing the projection row does not make the fact durable.

### 5. What D3 may implement now

> **D3's first implementation supports exactly six durable evidence-bearing states; the two conditional
> Tier-B states remain vocabulary/roadmap states and are not emitted until exact Core primitive
> contracts are adopted.**

| #   | State                     | D2 classification  | In first D3 contract? | Evidence source now                                                                                               | Reason                                                                                                                                |
| --- | ------------------------- | ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `rejected`                | durable Tier C     | **YES**               | `authorization-recorded` (refusal) — D4-supported target-family contract, read as trusted accepted-event evidence | target family selected by D2 and admitted by D4 for the OFFLINE six-state contract; **adopted/live Core emission is NOT established** |
| 2   | `authorized`              | durable Tier C     | **YES**               | `authorization-recorded` — same D4-supported contract                                                             | as above; WhatsApp-only per Q11                                                                                                       |
| 3   | `provider-accepted`       | durable Tier C     | **YES**               | `result-recorded` — same D4-supported contract                                                                    | as above                                                                                                                              |
| 4   | `delivered`               | durable Tier C     | **YES**               | `result-recorded` — same D4-supported contract                                                                    | as above                                                                                                                              |
| 5   | `read`                    | durable Tier C     | **YES**               | `result-recorded` — same D4-supported contract                                                                    | as above                                                                                                                              |
| 6   | `failed`                  | durable Tier C     | **YES**               | `result-recorded` — same D4-supported contract                                                                    | as above                                                                                                                              |
| 7   | `authorization-requested` | conditional Tier B | **NO**                | none — receipt primitive not adopted                                                                              | modelling it now needs a placeholder event or a fake receipt id                                                                       |
| 8   | `scheduled`               | conditional Tier B | **NO**                | none — scheduling primitive not adopted                                                                           | as above; `requestedTiming` is not evidence                                                                                           |
| 9   | `draft`                   | excluded           | **NO**                | none                                                                                                              | ephemeral; construction is not a durable fact                                                                                         |
| 10  | `execution-submitted`     | excluded           | **NO**                | none                                                                                                              | no proved durable Core submission artifact (Q7)                                                                                       |
| 11  | `answered`                | excluded           | **NO**                | none                                                                                                              | Core does not model voice outcomes                                                                                                    |
| 12  | `no-answer`               | excluded           | **NO**                | none                                                                                                              | as above                                                                                                                              |
| 13  | `busy`                    | excluded           | **NO**                | none                                                                                                              | as above                                                                                                                              |
| 14  | `follow-up-requested`     | excluded           | **NO**                | none                                                                                                              | a new request is a new lifecycle                                                                                                      |
| 15  | `human-handoff-required`  | excluded           | **NO**                | none admitted                                                                                                     | candidate contract ≠ adopted primitive                                                                                                |
| 16  | `completed`               | excluded           | **NO**                | none                                                                                                              | S3 found no distinct Core completion truth                                                                                            |
| 17  | `cancelled`               | excluded           | **NO**                | none                                                                                                              | rejected for MVP (Q8)                                                                                                                 |
| 18  | `expired`                 | excluded           | **NO**                | none                                                                                                              | rejected for MVP (Q9)                                                                                                                 |

**6 admitted + 12 not admitted = 18.** The vocabulary is unchanged; the first _implemented_ union is
six.

**Why the six are admissible without Core adoption.** D3 is an **OFFLINE contract implementation
against the D2/D4 evidence semantics** — not a claim that Core adoption is complete. The distinction
matters and collapses easily, so it is spelled out:

> candidate/published contract **≠** D2 target family **≠** D4-supported offline evidence shape
> **≠** adopted Core emission **≠** live Core emission

**No adopted or live emission for either family was established at the accepted S3 pin.** C3A
(`authorization-recorded`, gated on C1 + C2) and C3B (`result-recorded`, gated on the contract-fit
proof) remain **future Core adoption gates**; neither has landed, and D4 supporting a contract offline
did not make Core adoption true.

**Why not include the two conditional states as placeholders?** Because every available way to do it
lies. It would need a placeholder event name, a generic "pending Core evidence" token, a
caller-provided `eventId`, a fake receipt or scheduling id, an unadopted canonical event, or an
evidence enum whose existence implies durable replay that does not exist. **Even if repository
versioning rules permit a non-wire placeholder, D2b declines to use one**: a contract that can express
a state it cannot evidence invites exactly the inference this whole line of work has spent four slices
forbidding. The two states stay in the 18-state vocabulary and in D2's conditional subset; their D3
evidence variants arrive with their primitives.

---

## Consequences

- **D3 is unblocked, with an exact admitted state set** and no fiction to write around.
- **No event name was invented or reserved.** Not `qf.communication.request-received`, not
  `...authorization-requested-recorded`, not `...scheduled`, not `...schedule-recorded`, not
  `...follow-up-requested-recorded`. C1/C2 and future Core protocol adoption own exact wire contracts;
  D2b specifies **semantics, evidence requirement and ordering** only.
- **No second Jarvis durable log and no second ordering stream** exists or is planned.
- **D4 is untouched**: its allowlist is not widened, no Tier-B evidence is routed through its two
  authority/result families, no reader consumer is opened, its root/export containment is unchanged,
  and neither the event registry nor `safeParseCanonicalPayload` was modified.
- **No contract was created or changed.** `CommunicationStateRecordV1` stays immutable;
  `CommunicationAuthorizationV1` and `CommunicationResultV1` are unchanged; there is no
  `CommunicationAuthorizationV2` and no `qf.communication.state-recorded@3`; the `@2` event registry and
  D4's `@2`-wire / `V1`-artifact distinction are unchanged.
- **No migration.** `0013` is not allocated or reserved, and the `0010`–`0012` ledger drift remains
  separate governance debt, untouched here.
- **No live claim.** **No adopted or live emission for either Tier-C target family was established at
  the accepted S3 pin, and D2b makes no current-live emission claim.** C1 does not exist; no request-
  receipt or scheduling event exists; Core event/outbox applied state is unverified; the runtime is not
  active.
- **D5 still waits on D3 + D4 + D2b.** D4 being merged does not let D5 start before D3.

---

## Alternatives considered

- **Option B — a separate durable Jarvis coordination log.** Rejected, per §2. It would have made the
  ordering question harder in exchange for states nothing yet consumes.
- **Admitting `authorization-requested` or `scheduled` into the first D3 union behind a placeholder.**
  Rejected: it would encode a durability claim that is false, and a later reader would have no way to
  tell the placeholder from a real variant.
- **Inferring `scheduled` from `requestedTiming`.** Rejected — already forbidden by the design doc, and
  restated here because it is the most tempting shortcut on this list.
- **Adopting `qf.communication.human-handoff-requested` because the contract exists.** Rejected: a
  candidate contract is not an adopted primitive, and D4 did not admit that family.
- **Deciding ordering later, per state.** Rejected: that is what left §6.3 open. One conditional rule
  now is cheaper than a per-state bridge later, and it makes the failure mode explicit — a primitive
  that cannot join the stream forces a reopen rather than an invisible workaround.

---

## Posture

No production code. No contract, event registry, event-backbone, ingestion or projection change. No
Core modification, branch, PR, audit or re-pin. No managed Supabase. No n8n or provider access. No
message sent. **No migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
