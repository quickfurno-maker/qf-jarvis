# Contracts — QF Jarvis

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-12

The shared contracts every later phase depends on. Implemented in [`@qf-jarvis/contracts`](../../packages/contracts/).

The revised requirements these contracts now encode are recorded in [quickfurno-compatibility-directive.md](../architecture/quickfurno-compatibility-directive.md), which is authoritative.

---

## What Phase 2 is

**Phase 2 creates contracts. It does not create transport.**

A contract is an agreement about a _shape_: what a canonical event looks like, what a recommendation must carry, what an execution intent may say. Agreeing that shape before anything depends on it is the first engineering principle in this repository — _"a contract that emerged from an implementation is a description of that implementation, not an agreement between systems"_ ([engineering-principles.md](../governance/engineering-principles.md) §1).

So this phase produces schemas, types, fixtures, and tests. It produces nothing that runs.

## What Phase 2 explicitly does not do

| Deferred to    | What                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Phase 3**    | Event transport, ingestion, idempotent processing, dead letters, replay                                  |
| **Phase 4**    | The coordination layer, routing, consolidation, **lifecycle transition enforcement**                     |
| **Phases 5–8** | The agents — Kabir, Riya, Anisha, Jitin. **No AI, no prompts, no model SDK, no model gateway**           |
| **Phase 9**    | The approval submission path                                                                             |
| **Phase 10**   | n8n and the communications runtime — **built and tested, reaching nobody**                               |
| **Phase 11**   | **QuickFurno Core integration** — the live emitters, the authorization interface, the Communication Core |
| **Phase 11A**  | **The first real message.** No production communication before Phase 11 succeeds                         |
| **Phase 14**   | The evaluation loop that consumes the learning contracts                                                 |

**No current QuickFurno Core emitter is assumed to exist.** This matters enough to say plainly: **we have not integrated with Core, and we do not know what it can emit today.**

The client, vendor, assignment, and governance events in this repository are **target contracts** — the shape Core's events _will_ take. They are deliberately thin: an opaque reference, a stable reason code, and a small governed bag of derived signals. They do **not** reproduce Core's records, because _that_ is the part we cannot invent, and it is the part that would rot the instant Core's schema differed by one field.

> **The adapter absorbs the difference; the contract does not bend.**

See [event-catalog.md](./event-catalog.md) for the full reasoning and the directive-to-canonical name mapping.

### And nothing here can learn anything

The memory and learning contracts define **shapes**, not behaviour. There is no model gateway, no provider integration, no training pipeline, and no data flowing anywhere. Claude and ChatGPT are _named_ as the initial reasoning providers behind a future gateway; neither is wired to anything. **No data becomes training data automatically, and in Phase 2 no data becomes anything at all.**

## The contracts cannot cause an effect

Worth stating explicitly, because it is the property everything else rests on.

A `RecommendationV1` is a structured proposal. It has no `send` method, no provider address, no credential, and no `approved` field. An `ExecutionIntentV1` describes an authorized action — and **Jarvis cannot construct a valid one**, because the issuer must be QuickFurno Core and the executor must be n8n, and those are literals in the schema, not conventions in a comment.

Even a fully compromised agent, emitting a maliciously crafted recommendation, has at most _proposed_ something that a human or a policy will then decline. That containment is the strongest security argument for the whole boundary, and Phase 2 is where it stops being an argument and starts being a type ([security-principles.md](../governance/security-principles.md)).

---

## The documents

| Document                                                                  | What it covers                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Contract principles](./contract-principles.md)                           | The rules every contract obeys, and why each one exists                             |
| [Canonical event envelope](./canonical-event-envelope.md)                 | The envelope, its fields, identity, ordering, causation                             |
| [Event catalog](./event-catalog.md)                                       | The **41** registered events, and the directive-to-canonical name mapping           |
| [Recommendation contract](./recommendation-contract.md)                   | `RecommendationV1` and the lifecycle record                                         |
| [Approval and execution contracts](./approval-and-execution-contracts.md) | `ApprovalRequestV1`, `ApprovalDecisionV1`, `ExecutionIntentV1`, `ExecutionResultV1` |
| [Communication contract](./communication-contract.md)                     | Request, authorization, result — and the eighteen authoritative states              |
| [Assignment and reassignment](./assignment-and-reassignment.md)           | The vendor batch policy, client confirmation, and cross-category linked leads       |
| [Memory and learning](./memory-and-learning.md)                           | Agent memory, provenance, evaluation, and training eligibility                      |
| [Versioning and compatibility](./versioning-and-compatibility.md)         | How a contract changes, and how it never changes                                    |
| [Privacy and data minimization](./privacy-and-data-minimization.md)       | What may never appear in a contract, and what enforces that                         |
| [Testing and fixtures](./testing-and-fixtures.md)                         | The fixtures, the tests, and what they prove                                        |

## Decisions

All seven were **Accepted** by the business owner on **2026-07-12**, alongside Phase 2 itself.

- [ADR-0012 — Runtime contract validation](../decisions/ADR-0012-runtime-contract-validation.md)
- [ADR-0013 — Canonical event envelope and versioning](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md)
- [ADR-0014 — Governed lifecycle contracts](../decisions/ADR-0014-governed-lifecycle-contracts.md) — the authorized-effect chain
- [ADR-0015 — Complete client journey and reassignment policy](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md)
- [ADR-0016 — Agent memory and learning boundaries](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)
- [ADR-0017 — Live communication sequencing](../decisions/ADR-0017-live-communication-sequencing.md)
- [ADR-0018 — Governed request, communication-authority, and control contracts](../decisions/ADR-0018-governed-request-communication-and-control-contracts.md) — asking is not deciding; eligibility is not authorization

**Every contract in the package is governed by exactly one of ADR-0014, ADR-0015, ADR-0016, or ADR-0018.** The scope table is in [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md#scope--what-this-adr-governs-and-what-it-does-not).

## Who produces and consumes what

| Contract                            | Produced by                                                            | Authoritative?                              | Consumed by (later)                       |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| **Canonical event**                 | **QuickFurno Core**, always                                            | **Yes** — Core recorded it                  | Jarvis ingestion (Phase 3)                |
| **RecommendationV1**                | QF Jarvis                                                              | **No — advisory, and inert**                | Core's authorization path (Phase 9)       |
| **RecommendationLifecycleRecordV1** | Jarvis, for its own states; Core, for the states only Core can produce | Mixed — see the doc                         | Jarvis, evaluation (Phase 14)             |
| **ApprovalRequestV1**               | **QF Jarvis**                                                          | **No — it asks, and carries no authority**  | Core's authorization interface (Phase 11) |
| **ApprovalDecisionV1**              | **QuickFurno Core**                                                    | **Yes**                                     | Jarvis, reflected never anticipated       |
| **ExecutionIntentV1**               | **QuickFurno Core**                                                    | **Yes**                                     | n8n (Phase 10)                            |
| **ExecutionResultV1**               | Reported by n8n or the runtime; **recorded by Core**                   | Authoritative once **Core** records it      | Jarvis, to close the lifecycle            |
| **CommunicationRequestV1**          | **QF Jarvis**                                                          | **No — it asks. It cannot send**            | The Communication Core (Phase 11)         |
| **CommunicationAuthorizationV1**    | **QuickFurno Communication Core**                                      | **Yes** — this is the consent decision      | Jarvis, reflected never anticipated       |
| **CommunicationResultV1**           | **QuickFurno Core** records it                                         | **Yes**                                     | Jarvis, to close the lifecycle            |
| **CommunicationStateRecordV1**      | Jarvis, for drafts; Core, for everything authoritative                 | Mixed — see the doc                         | The control plane (Phase 12)              |
| **ClientReassignmentRequestV1**     | **QF Jarvis** (Riya)                                                   | **No — advisory. It cannot name a vendor**  | Core (Phase 11)                           |
| **ClientReassignmentDecisionV1**    | **QuickFurno Core**                                                    | **Yes**                                     | Jarvis, reflected                         |
| **AssignmentBatchV1**               | **QuickFurno Core**                                                    | **Yes** — **Riya cannot construct one**     | Jarvis, derived view                      |
| **AdditionalServiceRequestV1**      | **QF Jarvis** (Riya)                                                   | **No — advisory**                           | Core (Phase 11)                           |
| **LinkedLeadCreatedV1**             | **QuickFurno Core**                                                    | **Yes**                                     | Jarvis, derived view                      |
| **AgentRunRecordV1**                | QF Jarvis                                                              | Its own record of its own run               | Evaluation (Phase 14)                     |
| **AgentMemoryRecordV1**             | QF Jarvis                                                              | **No — `authoritative: false`, by literal** | The agent that owns it                    |
| **TrainingEligibilityDecisionV1**   | A named **human** (or approved policy)                                 | **Yes** — and there is no default           | Any future learning pipeline              |
| **ErasureRequestV1 / RecordV1**     | **QuickFurno Core**                                                    | **Yes**                                     | Every derived store in Jarvis             |

The pattern to notice: **everything Jarvis produces is either advisory, or a record of its own reasoning. It produces nothing authoritative, and it produces nothing that can act.**
