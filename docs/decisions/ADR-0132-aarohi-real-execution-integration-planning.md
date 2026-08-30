# ADR-0132 — Aarohi real execution integration: planning and sequencing

**Status:** Accepted (planning only)
**Date:** 2026-08-28
**Phase ownership:** **QFJ-P08** (consent, approval and human control), **QFJ-P09** (execution
gateway and communication lifecycle), **QFJ-P10** (Core integration and reconciliation) and
**QFJ-P12** (Aarohi/QVGE composition). **No new phase is created. There is no QFJ-P13 and no
AVG-13.**
**Baseline:** `fbdaf00ccd98cf9b31d7dd1e177cf0ffbc4edd77` (merge of PR #172 / Aarohi offline
certification)
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0001](./ADR-0001-source-of-truth-boundary.md),
[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md),
[ADR-0005](./ADR-0005-human-and-policy-approval.md),
[ADR-0006](./ADR-0006-agent-responsibility-boundaries.md),
[ADR-0008](./ADR-0008-controlled-communication-capability.md),
[ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md),
[ADR-0082](./ADR-0082-qfj-p08-core-approval-submission-and-authenticated-operator-boundary.md),
[ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md),
[ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md),
[ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md),
[ADR-0091](./ADR-0091-qfj-p09-03-durable-execution-replay-idempotency-store.md),
[ADR-0109](./ADR-0109-qfj-p09-04-durable-execution-dispatch-composition.md),
[ADR-0110](./ADR-0110-qfj-p09-05-communication-lifecycle-transition-runtime.md),
[ADR-0125](./ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md),
[ADR-0126](./ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md),
[ADR-0127](./ADR-0127-qfj-p12-avg10-aarohi-payment-activation-handoff-offline-domain.md),
[ADR-0131](./ADR-0131-qfj-p12-aarohi-full-offline-certification-closeout.md), and
[communication-model.md](../architecture/communication-model.md).

Plan: [aarohi-real-execution-integration-plan.md](../architecture/aarohi-real-execution-integration-plan.md).

---

## Context

Aarohi AVG-0…AVG-12 is implemented and certified as an OFFLINE domain (ADR-0131). The certification
established exactly one sentence — internal coherence and containment — and explicitly not
readiness. The next question is the sequencing one: **what is the shortest safe path from a certified
offline domain to a real, governed execution integration, with production rollout still OFF?**

This ADR answers that question and nothing else. **It activates nothing.**

### What the audit found, and it is the reason this is a planning ADR

Five execution and approval foundations are merged and none of them is composed into a live path:

| Package                                          | Slice         | Composed by an application?            |
| ------------------------------------------------ | ------------- | -------------------------------------- |
| `@qf-jarvis/approval-runtime`                    | QFJ-P08       | yes, widely                            |
| `@qf-jarvis/approval-core-adapter`               | ADR-0082      | transport INJECTED, none adopted       |
| `@qf-jarvis/communication-authorization-runtime` | ADR-0083      | **no** — tests only                    |
| `@qf-jarvis/execution-intent-runtime`            | ADR-0084      | **no** — one offline JAO-7 correlation |
| `@qf-jarvis/execution-dispatch-runtime`          | ADR-0090      | **no** — composition and tests         |
| `@qf-jarvis/postgres-execution-replay-store`     | ADR-0091      | **no** — composition and tests         |
| `@qf-jarvis/execution-dispatch-composition`      | ADR-0109      | **no importer at all**                 |
| `@qf-jarvis/communication-lifecycle-runtime`     | ADR-0110      | **no importer at all**                 |
| `@qf-jarvis/aarohi-agent`                        | ADR-0085…0131 | **no importer at all**, by assertion   |

The roadmap lists outstanding work under **two** phases, and both lists matter here.

**QFJ-P08 remains INCOMPLETE**, with three items outstanding verbatim: the live Core transport for
communication authorization, **a producer for `CommunicationRequestV1`**, and the operator surface's
HTTP, UI and authentication provider.

**QFJ-P09 remains INCOMPLETE**, with these outstanding, confirmed against the import graph:

1. an **adopted** Core → n8n transport and its composition (the B4 wire protocol is **PROPOSED**);
2. execution-time communications **eligibility** integration;
3. a **producer** of `CommunicationStateRecordV1`;
4. provider dispatch, provider results and **reconciliation**;
5. production rollout.

**The two producers are different concerns and this ADR keeps them apart.** An earlier revision of
this planning package named only the P09 state-record producer and left the P08 request producer
unowned — an owner review caught it. They are not interchangeable: `CommunicationRequestV1` is what
Jarvis ASKS Core for, and `CommunicationStateRecordV1` is what records where a communication got to.
The dependency runs one way and is visible in the contracts — the request carries `communicationId`,
`recipient` and `purposeCode`, three of the five identity fields the state record requires for
continuity, and `channel` is settled only by Core's authorization, which may name a channel Jarvis
did not propose (ADR-0083).

The gap is therefore not "Aarohi needs more domain work". Aarohi is done. The gap is that the
execution chain has every validator and no adopted protocol, no producer and no composition.

### The Core audit could not be re-run here, and that is stated rather than worked around

**No QuickFurno Core checkout exists in this environment.** A new read-only audit was therefore not
possible, and no Core fact has been invented to fill the space.

The governed Core-fact source used by this ADR is the read-only audit already recorded in this
repository by ADR-0125, ADR-0126 and ADR-0127, taken at
`quickfurno-maker/quickfurno-marketplace` commit `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca`. Every
Core fact below is quoted from that recorded audit and is **historical evidence**, not a current
certification.

**Core has moved since.** Owner review observed current marketplace `main` at
`c70ae7da8f59f03cbb099ae390e9aec98d2c3b06`, and **none of the historical findings has been
re-certified against it here.** A fresh read-only audit at a current pinned commit is therefore a
hard prerequisite of Core protocol adoption and of every slice downstream of it. Nothing in this ADR
may proceed on the historical audit alone, and no fact has been carried forward as though it had
been re-proved.

## Decision

### 1. This is planning. It activates nothing.

No production code, no dependency, no migration, no transport, no credential, no provider call, no
n8n call, no Core read or write, no live send, and no change to production rollout — which remains
**OFF**. Aarohi's runtime remains **PLANNED / DISABLED**.

### 2. Phase ownership is assigned to existing phases

| Capability                                                                           | Canonical owner                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------- |
| `CommunicationRequestV1` producer                                                    | **QFJ-P08**                               |
| Live Core transport for communication authorization                                  | **QFJ-P08**, blocked on Core adoption     |
| `CommunicationStateRecordV1` producer                                                | **QFJ-P09**                               |
| Adopted Core → n8n transport and composition                                         | **QFJ-P09**, blocked on Core/n8n adoption |
| Execution-time eligibility integration                                               | **QFJ-P09**, authority is Core's          |
| Core protocol adoption (identity, registration, payment, activation, reconciliation) | **QFJ-P10**                               |
| Provider dispatch, results, Core reconciliation                                      | **QFJ-P10**                               |
| Same-acquisition post-registration continuation (GAP A)                              | **QFJ-P12**, blocked on P10               |
| Authoritative pre-activation case bridge (GAP B)                                     | **QFJ-P12**, blocked on P10               |
| Aarohi runtime composition                                                           | **QFJ-P12**, default OFF                  |
| Real-integration certification                                                       | **QFJ-P12**                               |
| Staged activation                                                                    | **out of scope**, separately governed     |

### 2a. The QFJ-P08 `CommunicationRequestV1` producer slice

A bounded future **QFJ-P08 communication-request-producer slice**. No subphase id is invented: P08's
merged slices are named (`P08-A`, `P08-B`, and the ADR-named approval and authorization runtimes),
and no numeric id is canonically allocated for this one.

It **builds a canonical `CommunicationRequestV1` from already-governed communication action
context**, and it is POWERLESS. It:

- does **not** establish consent;
- does **not** establish contact eligibility;
- does **not** establish authorization;
- does **not** create an `ExecutionIntentV1`;
- does **not** send and does **not** execute;
- does **not** persist a consent, STOP, opt-out, DNC, suppression or eligibility cache;
- does **not** let founder or human approval override Core communication authority;
- **feeds** the later Core communication-authorization interaction rather than replacing it;
- preserves that **an approval is not permission to contact anyone**;
- preserves that **a prior communication authorization is not a reusable future permission slip**;
- leaves execution-time eligibility revalidation to Core and the QF Communications Runtime.

Producing a request is asking. It is the first half of a question whose answer is Core's.

### 3. The permanent flow is unchanged

Core → signed events/contracts → Jarvis → recommendation/approval request → Core or human
authorization → n8n execution → provider delivery → result to Core → result event to Jarvis.

Aarohi never calls a provider or n8n. n8n executes and authorizes nothing. A provider delivers and
decides nothing. Jarvis mints no business truth.

### 4. The two AVG-10 gaps stay open, and the conditions for closing them are named

**GAP A — same-acquisition post-registration continuation.** May be closed only by a **new,
separate, fail-closed continuation boundary** that proves, from a Core-authoritative fact, that a
registered vendor is the same party as an existing governed acquisition case. It may **never** be
closed by adding `REGISTERED` to `ELIGIBLE_CORE_STATUSES`. At the audited commit no
prospect ↔ vendor correlation contract exists — every per-party Core read is keyed by a Core vendor
id that Aarohi structurally does not hold — so **the gap is currently unclosable and stays open.**

**GAP B — bridge into `AWAITING_CORE_ACTIVATION`.** May be closed only by an adopted
Core-authoritative fact that justifies entry. Payment does not. A conversation claim, a provider
receipt, a model inference and Aarohi's own case state do not. At the audited commit **Core has no
ACTIVE vendor status at all** — `vendors.status` is `('Pending','Approved','Rejected','Suspended')`,
"active" is a separate boolean `is_active`, and `package_status` uses a lowercase `active` — so
**the gap is currently unclosable and stays open.** Whatever closes it,
`completeCoreActiveHandoff(...)` remains the ONLY route into `HANDED_OFF_TO_ANISHA`.

### 5. Execution-time eligibility is Core's, and Jarvis may never cache it

The authority is the **QuickFurno Communication Core**, inside QuickFurno Core. The **QF
Communications Runtime** — outside this repository, on the execution side, reached only by n8n under
an authorized execution intent — re-validates at execution time as a second line of defence.

Jarvis stores no consent, opt-out, suppression, STOP/START, do-not-contact or eligibility answer,
and a prior authorization is never a future permission slip.

### 6. Result truth returns through Core, never from the provider

A provider result and an n8n outcome are transport facts. They become business truth only after Core
records them, and reach Jarvis only as an authoritative Core event or contract. No versioned
Core → Jarvis reconciliation contract exists today; that is a **QFJ-P10 prerequisite**, not
something this ADR invents.

### 7. Rollout boundary

**Production rollout remains OFF.** The final gate separating "real integration implemented" from
"staged activation authorized" is a **separate owner decision with its own ADR**, and neither this
ADR, nor the offline certification, nor any evaluation result, nor any autonomy level may be cited
as authority for it.

## Consequences

> **Status correction (2026-08-30).** **S1 is MERGED** under
> [ADR-0133](./ADR-0133-qfj-p08-powerless-communication-request-producer.md) (PR #174). **S2 is
> BLOCKED** under
> [ADR-0134](./ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md): this ADR's statement
> that S2 has _"no Core dependency"_ was proved to hold for **one** of the eighteen lifecycle states
> (`draft`). `rejected`, `cancelled` and `expired` have no lawful representation; five further states
> parse on insufficient or no evidence; and two cite a human approval rather than Core's
> communication authorization. **S2 is split by fact ownership into S2a (Jarvis-local), S2b (Jarvis
> coordination over trusted Core authority) and S2c (Core-authoritative states projected from
> authenticated Core events); only S2a is free of a Core prerequisite.**
>
> **Authorship decision (2026-08-30).**
> [ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md)
> adopts **Model 2**: Jarvis derives a LOCAL communication-state projection from authenticated,
> **adopted** primitive Core events, and authors only its own coordination facts. **No
> `qf.communication.state-recorded@3` is required**, though targeted Core primitive adoption may
> still be needed for facts S3 finds absent, and trusting the projection additionally requires
> write-path hardening (`D2a`). The next execution step is **S3 — a fresh read-only Core audit**
> at a current pinned commit, because `cancelled`, `expired` and `execution-submitted` evidence
> remain unresolved. Nothing else in this ADR changes, and
> no activation posture changes.

**What this buys.** A dependency-ordered sequence in which each step is small, reviewable and
fail-closed, with the Core-dependent steps clearly separated from the ones implementable entirely
inside qf-jarvis — so work can start immediately on the latter without waiting on Core.

**What it costs.** Two of the most-wanted capabilities — continuation after registration, and entry
to the activation boundary — are formally blocked on Core protocol adoption. That is the honest
state, and recording it as a blocker is more useful than a design that assumes a fact.

**Migration governance.** **This ADR allocates no migration and justifies none.** It does not and
may not pre-decide the persistence needs of slices that have not been designed: an adopted Core
protocol, a reconciliation path or a runtime composition may each reveal one. **Every implementation
slice must independently prove whether schema work is required**, and a migration may be allocated
only under the canonical migration-ledger policy. No number is pre-reserved here. A prerequisite for
any future allocation: the ledger's prose is stale — migrations `0010`, `0011` and `0012` exist on
disk with no ledger rows — and that drift must be reconciled first. **Reconciling it is outside this
planning ADR's scope**, and is recorded as governance debt rather than as permission to allocate.

**The first implementation PR is the QFJ-P08 `CommunicationRequestV1` producer.** This corrects an
earlier revision of this ADR, which recommended the P09 state-record producer first. Both are
implementable entirely inside qf-jarvis, so the tie is broken by dependency direction: the state
record's identity fields originate in the request, and the merged
`communication-authorization-runtime` already consumes a `CommunicationRequestV1` and has nothing to
consume. The state-record producer follows immediately, and its later lifecycle states remain
structurally blocked on Core-issued artifact ids by the existing schema — which makes the Core
dependency visible in code rather than assumed in prose.

## Alternatives considered

**Starting with the Aarohi runtime composition.** Rejected. Composing Aarohi first would produce a
runtime with nothing lawful to do: no producer, no adopted transport, no eligibility integration and
no reconciliation. It would also be the single most tempting place to add a shortcut.

**Adopting the B4 wire protocol now.** Rejected. Adoption is bilateral; Core and the execution side
have not adopted it, and inventing an endpoint, header, signature or key format to unblock a plan is
exactly the failure this repository has avoided since ADR-0090.

**Closing GAP A by widening the cold gate to `REGISTERED`.** Rejected permanently. It would convert a
bounded acquisition-completion problem into general permission to cold-acquire registered vendors.

**Closing GAP B from payment.** Rejected permanently. Payment is not activation, and the audited Core
has no activation lifecycle to read.

**Creating QFJ-P13 or AVG-13.** Rejected. Every capability here has an existing canonical owner.

## Compliance

- **ADR-0001 / ADR-0002.** Core owns truth and authority. A request carries none.
- **ADR-0005 / ADR-0008.** Approval is Core's; communication capability stays controlled.
- **ADR-0131.** Offline certification is evidence, never activation authority.
- **Runtime remains PLANNED / DISABLED. Production rollout remains OFF.**
