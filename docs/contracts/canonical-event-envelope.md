# The Canonical Event Envelope

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

Every fact that reaches QF Jarvis arrives in this shape. Decision: [ADR-0013](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md).

---

## The shape

```jsonc
{
  "eventId": "4f6b1e2a-0c3d-4e5f-8a9b-1c2d3e4f5a6b",
  "eventType": "qf.approval.decision-recorded",
  "eventVersion": 1,
  "occurredAt": "2026-07-11T09:00:00Z",
  "emittedAt": "2026-07-11T09:00:05Z",
  "source": "quickfurno-core",
  "subject": { "entityType": "client", "entityId": "CORE-CLIENT-00311" },
  "correlationId": "b0328f91-73a4-45c6-9b02-8d9eafb0c1d2",
  "causationEventId": "5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c", // optional
  "payload": {/* defined by eventType + eventVersion */},
}
```

| Field              | Type                      | Required | Meaning                                                                                                                          |
| ------------------ | ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `eventId`          | UUID                      | Yes      | **The idempotency identity.** The same event processed twice must have the effect of once, and this is what makes that decidable |
| `eventType`        | machine token             | Yes      | `qf.<aggregate>.<past-tense-fact>`. Registered, or rejected                                                                      |
| `eventVersion`     | positive integer          | Yes      | With `eventType`, identifies exactly one contract                                                                                |
| `occurredAt`       | RFC 3339 UTC              | Yes      | When the thing happened                                                                                                          |
| `emittedAt`        | RFC 3339 UTC              | Yes      | When Core said so. **Never before `occurredAt`**                                                                                 |
| `source`           | literal `quickfurno-core` | Yes      | Always Core. See below                                                                                                           |
| `subject`          | entity reference          | Yes      | What it is about, opaquely                                                                                                       |
| `correlationId`    | UUID                      | Yes      | Survives the whole chain                                                                                                         |
| `causationEventId` | UUID                      | No       | The event that caused this one. **May not be itself**                                                                            |
| `payload`          | per contract              | Yes      | Strictly validated against the registered schema                                                                                 |

Unknown fields are **rejected**. The envelope is strict.

---

## `source` is always QuickFurno Core

This is the field people will want to relax, so it is worth defending.

Every canonical event is emitted by Core, because **a fact is only a fact once Core has recorded it** ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)). This holds even when the underlying thing happened somewhere else entirely:

> A provider delivered a message. n8n observed it. n8n reported it. **Core recorded it. Core emitted the canonical event.**

The provider's own view of the delivery appears _inside_ an execution-result payload, as **reported evidence** — `reportingSystem` may name n8n or the QF Communications Runtime. But the envelope still says Core.

So a single event carries two distinct claims, and the contract keeps them apart:

- **The payload says:** "n8n reports the provider accepted this."
- **The envelope says:** "QuickFurno Core is telling you."

Collapsing those would make a provider's optimistic acknowledgement into business truth — which is precisely the failure that lets a founder believe a message arrived when it did not.

Note that this applies to `qf.recommendation.created` too. Jarvis _produces_ the recommendation — the payload says so, with `producingSystem: "qf-jarvis"` — but the **event** is Core's, emitted once Core has recorded the submission. The artifact's author and the event's authority are different questions.

---

## Identity: `eventId` is the idempotency key

At-least-once delivery is the only kind that exists. Anything that can be delivered can be delivered twice — a network retry, a replay after a fixed bug, a dead-letter reprocess ([engineering-principles.md](../governance/engineering-principles.md) §8).

`eventId` is what makes a duplicate _detectable_. Phase 3's exit criteria require proving idempotency by **deliberately redelivering events**; this field is the reason that is possible.

---

## Ordering: `emittedAt` may not precede `occurredAt`

An event announced before it happened is a clock fault or a forgery. Either way it is not processed.

The check is **between the two fields**, never against the current time. This is deliberate and it is load-bearing: a replayed event from last month must still validate today. A validator that compares a timestamp to `now` would reject the entire event history the first time anyone tried to rebuild a read model from it — and rebuilding read models from history is a first-class feature, not a recovery hack.

## Causation: an event may not cause itself

`causationEventId === eventId` is refused.

The audit chain is walked **backwards** — effect → result → intent → approval → recommendation → evidence → events — and that walk is what makes an incident recoverable rather than merely alarming ([auditability-principles.md](../governance/auditability-principles.md)). A self-causing event turns that walk into an infinite loop, which means the one tool you need during an incident is the tool that hangs.

## Correlation survives the chain

One `correlationId` ties source events, the recommendation, the approval decision, the execution intent, the execution result, and closure into a single thread. Without it, the backward walk requires a join nobody can reconstruct after the fact.

---

## Parsing

```ts
import { parseCanonicalEvent, safeParseCanonicalEvent } from '@qf-jarvis/contracts';
```

1. Read `eventType` and `eventVersion` from the envelope head.
2. Look them up in the **static registry**.
3. Validate the whole envelope against exactly that contract.

**Failure behavior:**

| Input                   | Result                                          |
| ----------------------- | ----------------------------------------------- |
| Unknown `eventType`     | **Rejected** — `unknown_contract`               |
| Unknown `eventVersion`  | **Rejected** — and **never** downgraded to v1   |
| Missing type or version | Rejected                                        |
| Malformed payload       | Rejected, with the field path                   |
| Unknown extra field     | Rejected                                        |
| Anything at all         | Nothing is executed. Parsing is a pure function |

The registry is **static** — built from source, closed over, and exposing no mutator. Adding an event type is a code change, which means a diff, which means a reviewer. A registry that accepts schemas at runtime is a registry that can be taught to accept a payload nobody reviewed.

---

## What the envelope does not carry

- **No signature.** Signature verification is a transport concern at a trust boundary, and it arrives with the transport in Phase 3 ([trust-boundaries.md](../architecture/trust-boundaries.md)).
- **No delivery metadata** — no retry count, no queue name, no partition. Those belong to the transport, and putting them here would bind the contract to an infrastructure choice nobody has made.
- **No status.** An event is a statement that something _happened_. It is never an instruction, and it is never a question.
