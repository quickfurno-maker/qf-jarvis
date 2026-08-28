# ADR-0132 — Aarohi real execution integration: planning and sequencing

**Status:** Accepted (planning only)
**Date:** 2026-08-29
**Phase ownership:** **QFJ-P09** (execution gateway and communication lifecycle), **QFJ-P10** (Core
integration and reconciliation) and **QFJ-P12** (Aarohi/QVGE composition). **No new phase is
created. There is no QFJ-P13 and no AVG-13.**
**Baseline:** `fbdaf00ccd98cf9b31d7dd1e177cf0ffbc4edd77` (merge of PR #172 / Aarohi offline
certification)
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0001](./ADR-0001-source-of-truth-boundary.md),
[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md),
[ADR-0005](./ADR-0005-human-and-policy-approval.md),
[ADR-0006](./ADR-0006-agent-responsibility-boundaries.md),
[ADR-0008](./ADR-0008-controlled-communication-capability.md),
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

The roadmap's own list of what remains absent after P09.05 is confirmed by the import graph:

1. an **adopted** Core → n8n transport and its composition (the B4 wire protocol is **PROPOSED**);
2. execution-time communications **eligibility** integration;
3. a **producer** of `CommunicationStateRecordV1`;
4. provider dispatch, provider results and **reconciliation**;
5. production rollout.

The gap is therefore not "Aarohi needs more domain work". Aarohi is done. The gap is that the
execution chain has every validator and no adopted protocol, no producer and no composition.

### The Core audit could not be re-run here, and that is stated rather than worked around

**No QuickFurno Core checkout exists in this environment.** A new read-only audit was therefore not
possible, and no Core fact has been invented to fill the space.

The governed Core-fact source used by this ADR is the read-only audit already recorded inside this
repository by ADR-0125, ADR-0126 and ADR-0127, taken at
`quickfurno-maker/quickfurno-marketplace` commit `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca`. Every
Core fact below is quoted from that recorded audit and is marked as requiring **re-verification at a
current commit before any implementation slice that depends on it**. That re-verification is itself
a prerequisite task in the plan, not an assumption.

## Decision

### 1. This is planning. It activates nothing.

No production code, no dependency, no migration, no transport, no credential, no provider call, no
n8n call, no Core read or write, no live send, and no change to production rollout — which remains
**OFF**. Aarohi's runtime remains **PLANNED / DISABLED**.

### 2. Phase ownership is assigned to existing phases

| Capability                                                                           | Canonical owner                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------- |
| Communication state record producer                                                  | **QFJ-P09**                               |
| Adopted Core → n8n transport and composition                                         | **QFJ-P09**, blocked on Core/n8n adoption |
| Execution-time eligibility integration                                               | **QFJ-P09**, authority is Core's          |
| Core protocol adoption (identity, registration, payment, activation, reconciliation) | **QFJ-P10**                               |
| Provider dispatch, results, Core reconciliation                                      | **QFJ-P10**                               |
| Same-acquisition post-registration continuation (GAP A)                              | **QFJ-P12**, blocked on P10               |
| Authoritative pre-activation case bridge (GAP B)                                     | **QFJ-P12**, blocked on P10               |
| Aarohi runtime composition                                                           | **QFJ-P12**, default OFF                  |
| Real-integration certification                                                       | **QFJ-P12**                               |
| Staged activation                                                                    | **out of scope**, separately governed     |

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

**What this buys.** A dependency-ordered sequence in which each step is small, reviewable and
fail-closed, with the Core-dependent steps clearly separated from the ones implementable entirely
inside qf-jarvis — so work can start immediately on the latter without waiting on Core.

**What it costs.** Two of the most-wanted capabilities — continuation after registration, and entry
to the activation boundary — are formally blocked on Core protocol adoption. That is the honest
state, and recording it as a blocker is more useful than a design that assumes a fact.

**The first implementation PR is `QFJ-P09.06` — the communication state record producer.** It is the
only canonical absent capability with no Core dependency: it composes two already-merged packages,
creates no transport and no authority, and its later lifecycle states are structurally blocked on
Core-issued artifact ids by the existing schema — which makes the Core dependency visible in code
rather than assumed in prose.

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
