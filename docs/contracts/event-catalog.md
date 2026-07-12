# Event Catalog

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-12

**Forty-one registered events**, all at version 1: six architecture lifecycle events, and thirty-five **target** events covering the client journey, vendor assignment, the vendor journey, privacy, policy, and communication authority.

---

## Naming convention

```
qf.<aggregate>.<past-tense-fact>
```

Lowercase, dot-separated, always past tense. `qf.` names the QuickFurno canonical namespace, so an event from anywhere else is distinguishable on sight.

**Past tense is not a style preference.** An event is a statement that something _happened_. `qf.communication.state-recorded` is a fact. `qf.communication.send` would be an instruction — and the moment a consumer can be instructed by an event, the event bus has become a command channel, and any producer on it has become an authority. The naming convention is the first line of defence against that, and it is recorded in [ADR-0013](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md).

---

## The change from the earlier position

The first draft of this catalog registered **six** events and argued, at length, that domain events must wait for Core integration:

> _Writing `leadCreatedEventV1` now would mean inventing a payload shape for a system nobody has looked at._

**That argument was right, and it is answered — not by looking at Core, but by making the payloads carry almost nothing.**

The revised requirements ([quickfurno-compatibility-directive.md](../architecture/quickfurno-compatibility-directive.md)) need the agents to reason about the client and vendor journeys, and an agent cannot reason about an event that has no shape. So the target events exist. What makes them safe is the **design rule** below.

### Reference, never reproduce

A target payload names **which** entity and **what happened**. It does not reproduce Core's record of that entity.

There is no `leadPayload` carrying a budget, a city, a phone number, and a requirement description — because _that_ is the part we genuinely cannot invent, and it is also the part that would rot the instant Core's schema differed by one field.

What a target payload actually carries:

| Field                       | What it is                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject` (on the envelope) | An **opaque Core reference**. Core owns what a lead _is_                                                                                            |
| `reasonCode`                | A **stable machine token**. Why this event exists                                                                                                   |
| `detail`                    | Optional bounded text                                                                                                                               |
| `signals`                   | A small **governed** bag of derived values — refusing credentials, contacts, raw provider content, and model internals, by key _and_ by value shape |
| A few event-specific fields | A band, a timestamp, a related reference                                                                                                            |

An adapter that has to map Core's real lead record onto _that_ has an easy job. An adapter that had to map it onto an invented forty-field lead schema would have an impossible one — and would end up **bending the contract**, which is the failure the whole arrangement exists to prevent.

> **The adapter absorbs the difference; the contract does not bend.** — [phased-roadmap.md](../architecture/phased-roadmap.md), Phase 11

### These are target contracts

**No claim is made that QuickFurno Core emits any of them today.** We have not integrated with Core. Establishing the live emitters is **Phase 11's** work. Fixtures use synthetic references throughout, and every one of them is obviously fake.

### Bands, never amounts

The money-adjacent vendor events — recharge opportunity, package readiness — carry a **band**. No balance, no amount, no currency, no credit count.

Jarvis's view of a wallet is derived and **non-authoritative** ([data-ownership.md](../architecture/data-ownership.md)). A balance on one of these events would be a number that is _wrong by construction_ — stale the instant it is emitted — and its presence would invite exactly one thing: somebody reasoning about how much money a real vendor has, from a copy nobody reconciles.

---

## Name mapping — directive names to canonical names

The revised directive names events in `snake_case` (`client.requirement_completed`). The canonical registry uses this repository's existing convention (`qf.client.requirement-completed`), per ADR-0013.

**The mapping is one-to-one, and the conventions are not mixed silently.** The canonical name is the one in the registry, in the code, and on the wire.

### Client and assignment

| Directive name                         | Canonical event type                      |
| -------------------------------------- | ----------------------------------------- |
| `client.requirement_completed`         | `qf.client.requirement-completed`         |
| `client.followup_due`                  | `qf.client.follow-up-due-detected` ¹      |
| `client.followup_completed`            | `qf.client.follow-up-completed`           |
| `client.satisfaction_recorded`         | `qf.client.satisfaction-recorded`         |
| `client.dissatisfaction_recorded`      | `qf.client.dissatisfaction-recorded`      |
| `client.complaint_recorded`            | `qf.client.complaint-recorded`            |
| `client.reassignment_requested`        | `qf.client.reassignment-requested`        |
| `client.reassignment_authorized`       | `qf.client.reassignment-authorized`       |
| `client.reassignment_rejected`         | `qf.client.reassignment-rejected`         |
| `assignment.batch_created`             | `qf.assignment.batch-created`             |
| `assignment.batch_completed`           | `qf.assignment.batch-completed`           |
| `client.additional_service_identified` | `qf.client.additional-service-identified` |
| `client.additional_service_confirmed`  | `qf.client.additional-service-confirmed`  |
| `client.additional_service_rejected`   | `qf.client.additional-service-rejected`   |
| `lead.linked_created`                  | `qf.lead.linked-created`                  |
| `client.review_requested`              | `qf.client.review-requested`              |
| `client.lifecycle_closed`              | `qf.client.lifecycle-closed`              |

¹ **The one rename that is not cosmetic.** `followup_due` is a _state_ — "a follow-up IS due" — and it reads as an instruction. What actually _happened_ is that something **detected** a follow-up had fallen due. The canonical name says so, because an event that instructs is an event that has made its producer an authority.

### Vendor

| Directive name                         | Canonical event type                      |
| -------------------------------------- | ----------------------------------------- |
| `vendor.registration_started`          | `qf.vendor.registration-started`          |
| `vendor.profile_completed`             | `qf.vendor.profile-completed`             |
| `vendor.verification_requested`        | `qf.vendor.verification-requested`        |
| `vendor.activated`                     | `qf.vendor.activated`                     |
| `vendor.inactivity_detected`           | `qf.vendor.inactivity-detected`           |
| `vendor.performance_updated`           | `qf.vendor.performance-updated`           |
| `vendor.package_readiness_changed`     | `qf.vendor.package-readiness-changed`     |
| `vendor.recharge_opportunity_detected` | `qf.vendor.recharge-opportunity-detected` |
| `vendor.complaint_recorded`            | `qf.vendor.complaint-recorded`            |
| `vendor.retention_risk_detected`       | `qf.vendor.retention-risk-detected`       |
| `vendor.winback_candidate_detected`    | `qf.vendor.winback-candidate-detected`    |

### Governance, privacy, and communication authority

| Directive name                          | Canonical event type                       |
| --------------------------------------- | ------------------------------------------ |
| deletion/anonymisation requested        | `qf.privacy.erasure-requested`             |
| deletion/anonymisation recorded         | `qf.privacy.erasure-recorded`              |
| policy version changed                  | `qf.policy.version-changed`                |
| communication authorization recorded    | `qf.communication.authorization-recorded`  |
| communication execution result recorded | `qf.communication.result-recorded`         |
| human handoff requested                 | `qf.communication.human-handoff-requested` |
| human handoff recorded                  | `qf.communication.human-handoff-recorded`  |

---

## The architecture lifecycle events

The original six. Facts about the recommend → authorize → execute → report chain that this architecture owns outright.

| Event type                                   | Payload              | What it means                                                                                         |
| -------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `qf.recommendation.created`                  | `{ recommendation }` | Jarvis produced a recommendation; Core recorded it. **The recommendation is inert**                   |
| `qf.recommendation.lifecycle-state-recorded` | `{ record }`         | A recommendation moved to a new lifecycle state                                                       |
| `qf.approval.decision-recorded`              | `{ decision }`       | **Core recorded an authoritative approval decision.** This event _is_ the authorization becoming real |
| `qf.execution.intent-issued`                 | `{ intent }`         | Core issued a bounded, expiring execution intent to n8n                                               |
| `qf.execution.result-recorded`               | `{ result }`         | Core recorded an execution result reported by n8n or the runtime                                      |
| `qf.communication.state-recorded`            | `{ record }`         | A governed communication moved to a new lifecycle state                                               |

---

## The events that carry the reassignment policy

Worth calling out, because the schema does the work rather than the consumer:

- **`qf.assignment.batch-created`** carries an `AssignmentBatchV1`, and **every limit is enforced inside it**: three per batch, two batches, six unique vendors per lead-category, no overlap between batches, explicit client confirmation on a replacement, and `issuer` the literal `quickfurno-core`. **An invalid batch cannot reach a consumer through this event.**

- **`qf.client.dissatisfaction-recorded`** is _evidence_. It is emphatically **not** a reassignment, and it authorizes nothing. Acting on it requires the client to explicitly ask.

- **`qf.lead.linked-created`** carries four independence literals that can only be `true`. A linked lead cannot inherit its parent's consent, verification, scoring, or matching, because `false` does not parse.

---

## `qf.communication.authorization-recorded` is the consent boundary made visible

It carries Core's decision — authorized, or **rejected with a machine-readable reason**, including `recipient-opted-out`, `consent-withdrawn`, `do-not-contact`, `suppressed`, and `stop-received`.

**This is the event that proves a refusal happened**, which is what turns "Core enforces consent" from an architectural assertion into an auditable fact.

Note there is no `opted-out` communication _state_. That would be a nineteenth state, and it would fork the lifecycle — letting a consumer handle `rejected` while quietly ignoring "opted out", which is the one refusal that must never be ignored.

---

## Every registered event has a fixture, and a test enforces it

A test asserts that **every registered `type@version` has a valid fixture**, and that there are no fixtures for unregistered contracts. **A contract cannot be registered and left unexercised.**

---

## Adding an event type

1. Define the payload schema in its domain module, built through `observationPayload(...)` so the governed base cannot be forgotten.
2. Add it to `event-catalog.ts` with `defineCanonicalEvent`, which applies the envelope rules for you.
3. Register it in `event-registry.ts`.
4. Add a valid fixture. **The registry-coverage test fails without one.**
5. Add invalid fixtures for its meaningful boundary failures.

The registry is static and lives in source control precisely so that step 3 is a **diff a human reviews**. There is no `register()` function, and that is deliberate: a registry that accepts schemas at runtime is a registry an attacker can teach to accept a payload nobody reviewed.
