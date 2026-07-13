# QuickFurno → Jarvis — Canonical Event Mapping

**Status:** Compatibility baseline. **Read-only analysis. No emitter, ingester or endpoint was built.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

---

## The finding that frames everything else

> ## **QuickFurno Core emits none of the 41 canonical events. Not one.**

Not "emits them in a different shape" — **emits none of them.** The canonical catalogue was always declared a **target** ([compatibility directive §10](../architecture/quickfurno-compatibility-directive.md): _"No claim is made that QuickFurno Core emits any of them today"_). This document is where that stops being a comfortable assumption and becomes **a measured gap with a named resolution phase**.

**And the events Core does emit cannot be ingested as they are**, because the transport loses them ([migration map §2](./current-aos-to-jarvis-migration.md#2-emission-semantics--why-this-cannot-be-the-event-source)): emission is fire-and-forget, failures are **swallowed and reported as success**, there is no queue, no retry, and no stable idempotency key.

**Every mapping below is therefore conditional on the [durable Core outbox](./quickfurno-core-adapter-design.md#a-durable-core-outbox) existing. Until it does, there is nothing safe to ingest.**

---

## Shared envelope facts

Every canonical event carries the same envelope ([ADR-0013](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md)):

| Field               | Rule                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`eventId`**       | **The idempotency key.** Core must generate it **once**, durably, in the same transaction as the business change. ⚠️ Core today fabricates ids from `Date.now()` + `Math.random()` when absent — **useless as a key** |
| **`subject`**       | An **opaque** `{ entityType, entityId }`. Character set `[A-Za-z0-9._:-]` **excludes `@` and `+`**, so an email and an E.164 phone are **structurally unable to appear**                                              |
| **`correlationId`** | The client journey / business thread                                                                                                                                                                                  |
| **`causationId`**   | The event that caused this one. **Core must thread it, and today threads nothing**                                                                                                                                    |
| **`occurredAt`**    | Core's clock, not the relay's                                                                                                                                                                                         |
| **Payload**         | A **stable `reasonCode`** plus a small **governed** bag of derived signals. **`body`, `notes`, `freetext` and `raw` are refused by key**                                                                              |
| **Signature**       | **Ed25519**, verified at the Jarvis boundary. **Core signs nothing today**                                                                                                                                            |

### Prohibited in every payload, without exception

**Phone · email · address · GPS coordinates · name · password · token · API key · raw provider content · model chain-of-thought · wallet balances · currency amounts.**

Money-adjacent events carry **bands** (`low`/`medium`/`high`/`critical`), **never balances**.

> ### The specific trap in Core's data
>
> **`leads.message` contains GPS coordinates as plaintext** (the enquiry form interpolates `` `GPS: ${lat}, ${lng}` `` into free text) **and clarification answers.** There are no `latitude`/`longitude` columns on `leads` — the coordinates are _in the requirement text_.
>
> **An adapter that mapped "the lead's requirement" into a derived signal would carry a client's precise home location across the privacy boundary in a field nobody thinks of as sensitive.** `derivedObservationSchema` refuses `body`/`notes`/`freetext`/`raw` **by key** for exactly this reason. **Map reason codes and bounded signals. Never Core's free text.**

---

## A. Core operations that SHOULD emit a canonical event

Legend — **Status**: ✅ canonical event exists · ⚠️ exists but Core lacks the semantics · ❌ **contract gap** (no canonical event).

| #   | Source operation           | Source table / RPC                        | Current n8n event                                     | Canonical event                           | v   | Subject         | Status                                 | Resolution                                                     |
| --- | -------------------------- | ----------------------------------------- | ----------------------------------------------------- | ----------------------------------------- | --- | --------------- | -------------------------------------- | -------------------------------------------------------------- |
| 1   | Lead captured              | `leads` insert (`leadService.ts:111`)     | `lead.created`                                        | `qf.client.requirement-completed`         | 1   | `lead`          | ⚠️                                     | Phase 11                                                       |
| 2   | Lead scored                | `lead_scores`                             | `lead.scored`                                         | —                                         | —   | —               | **unsupported**                        | Core's score stays Core's                                      |
| 3   | Lead qualified             | `leadQualityService`                      | `lead.qualified`                                      | `qf.client.requirement-completed`         | 1   | `lead`          | ⚠️                                     | Phase 11                                                       |
| 4   | Clarification required     | `lead_clarification_requests`             | `lead.clarification_required`                         | **none**                                  | —   | `lead`          | ❌ **GAP**                             | **Phase 11**                                                   |
| 5   | Clarification answered     | `lead_clarification_responses`            | _(none)_                                              | **none**                                  | —   | `lead`          | ❌ **GAP**                             | **Phase 11**                                                   |
| 6   | Lead rejected on quality   | `leads.status`                            | `lead.rejected_quality`                               | **none**                                  | —   | `lead`          | ❌ **GAP**                             | **Phase 11**                                                   |
| 7   | Lead marked duplicate      | `check_duplicate_lead`                    | _(none)_                                              | **none**                                  | —   | `lead`          | ❌ **GAP**                             | **Phase 11**                                                   |
| 8   | **Vendors assigned**       | `assign_lead_to_paid_vendors_phase26a`    | `lead.assignment_approved`                            | `qf.assignment.batch-created`             | 1   | `lead`          | ⚠️ **CONFLICT**                        | **Owner**                                                      |
| 9   | Assignment completed       | `lead_assignments`                        | `lead.assigned` _(orphan)_                            | `qf.assignment.batch-completed`           | 1   | `lead`          | ⚠️                                     | Phase 11                                                       |
| 10  | **Credit deducted**        | `deduct_vendor_credit`                    | _(none)_                                              | **none**                                  | —   | `vendor`        | ❌ **GAP**                             | **Phase 11** — **band only, never a balance**                  |
| 11  | Vendor registered          | `registerVendor`                          | _(none)_                                              | `qf.vendor.registration-started`          | 1   | `vendor`        | ✅                                     | Phase 11                                                       |
| 12  | Vendor profile completed   | `vendors`                                 | _(none)_                                              | `qf.vendor.profile-completed`             | 1   | `vendor`        | ✅                                     | Phase 11                                                       |
| 13  | Verification requested     | `vendors.verification_status`             | _(none)_                                              | `qf.vendor.verification-requested`        | 1   | `vendor`        | ⚠️ **dead field**                      | Phase 11                                                       |
| 14  | Vendor approved            | `setVendorStatus('Approved')`             | _(none)_                                              | `qf.vendor.activated`                     | 1   | `vendor`        | ✅                                     | Phase 11                                                       |
| 15  | **Vendor suspended**       | `setVendorStatus('Suspended')`            | _(none)_                                              | **none**                                  | —   | `vendor`        | ❌ **GAP**                             | **Phase 11**                                                   |
| 16  | **Vendor rejected**        | `setVendorStatus('Rejected')`             | _(none)_                                              | **none**                                  | —   | `vendor`        | ❌ **GAP**                             | **Phase 11**                                                   |
| 17  | Low credit detected        | `remaining_credits <= 3`                  | `vendor.low_credit` _(never emitted)_                 | `qf.vendor.package-readiness-changed`     | 1   | `vendor`        | ✅                                     | Phase 11 — **band**                                            |
| 18  | Recharge opportunity       | `free_vendor_profile_interests`           | `vendor.recharge_prompt_preview`                      | `qf.vendor.recharge-opportunity-detected` | 1   | `vendor`        | ✅                                     | Phase 11 — **band**                                            |
| 19  | Package activated          | `assign_package_to_vendor`                | _(none)_                                              | `qf.vendor.package-readiness-changed`     | 1   | `vendor`        | ✅                                     | Phase 11                                                       |
| 20  | Package expired            | `expire_vendor_packages` _(no scheduler)_ | _(none)_                                              | `qf.vendor.package-readiness-changed`     | 1   | `vendor`        | ✅                                     | Phase 11                                                       |
| 21  | **Payment recorded**       | `payments`                                | _(none)_                                              | **none**                                  | —   | `vendor`        | ❌ **GAP**                             | **Phase 11** — **Jarvis may never be authoritative for money** |
| 22  | Bad-lead reported          | `bad_lead_reports`                        | _(none)_                                              | `qf.vendor.complaint-recorded`            | 1   | `vendor`        | ⚠️                                     | Phase 11                                                       |
| 23  | Vendor inactivity          | _(not implemented)_                       | _(none)_                                              | `qf.vendor.inactivity-detected`           | 1   | `vendor`        | ⚠️ Core lacks it                       | Phase 11                                                       |
| 24  | Vendor performance         | _(not implemented — always 0)_            | _(none)_                                              | `qf.vendor.performance-updated`           | 1   | `vendor`        | ⚠️ Core lacks it                       | Phase 11                                                       |
| 25  | Client follow-up due       | _(not implemented)_                       | `client.followup_due` _(orphan)_                      | `qf.client.follow-up-due-detected`        | 1   | `client`        | ⚠️                                     | Phase 11                                                       |
| 26  | Client rating due          | _(not implemented)_                       | `client.rating_due` _(orphan)_                        | `qf.client.review-requested`              | 1   | `client`        | ⚠️                                     | Phase 11                                                       |
| 27  | Satisfaction recorded      | **NOT IMPLEMENTED**                       | _(none)_                                              | `qf.client.satisfaction-recorded`         | 1   | `client`        | ⚠️ Core lacks it                       | Phase 11                                                       |
| 28  | Complaint recorded         | **NOT IMPLEMENTED**                       | `complaint.created` _(orphan)_                        | `qf.client.complaint-recorded`            | 1   | `client`        | ⚠️ Core lacks it                       | Phase 11                                                       |
| 29  | **Reassignment requested** | **NOT IMPLEMENTED**                       | _(none)_                                              | `qf.client.reassignment-requested`        | 1   | `client`        | ⚠️ **Core lacks it entirely**          | **Owner**                                                      |
| 30  | Linked lead created        | **NOT IMPLEMENTED**                       | _(none)_                                              | `qf.lead.linked-created`                  | 1   | `lead`          | ⚠️ Core lacks it                       | Phase 11                                                       |
| 31  | Client lifecycle closed    | **NOT IMPLEMENTED**                       | _(none)_                                              | `qf.client.lifecycle-closed`              | 1   | `client`        | ⚠️ Core lacks it                       | Phase 11                                                       |
| 32  | WhatsApp state change      | `whatsapp_logs` / Edge Fn                 | `whatsapp.status_updated` _(orphan; updates nothing)_ | `qf.communication.state-recorded`         | 1   | `communication` | ⚠️                                     | Phase 11 — **one of 18 states**                                |
| 33  | Erasure requested          | **NOT IMPLEMENTED**                       | _(none)_                                              | `qf.privacy.erasure-requested`            | 1   | _(subject)_     | ⚠️ **Core has no erasure path at all** | **Phase 11 privacy gate**                                      |

**Producer for every row above: `quickfurno-core`. Never Jarvis.**
**Consumers:** Kabir (lead/quality) · Riya (client) · Anisha (vendor) · Jitin (aggregate only — **no individuals**) · Jarvis (coordination; **holds no domain facts**).

---

## B. Ordering, idempotency and delivery

| Property                    | Requirement                                                                                                                                                                                                                                                                               | Core today                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Idempotency key**         | `eventId`, generated **once**, in the business transaction                                                                                                                                                                                                                                | ❌ Fabricated from `Date.now()` + `Math.random()`    |
| **Delivery**                | **At-least-once, durable, acknowledged.** Redelivery expected and safe                                                                                                                                                                                                                    | ❌ **Best-effort. A failed webhook is a lost event** |
| **Ordering**                | **Deterministic ingestion order only.** Jarvis does **not** claim business or per-aggregate ordering — the envelope carries **no aggregate sequence**, so **there is no sequence to detect a gap in** ([ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md)) | ❌ No ordering guarantee                             |
| **Correlation / causation** | Preserved end to end                                                                                                                                                                                                                                                                      | ❌ Not threaded                                      |
| **Signature**               | Ed25519, verified before parsing                                                                                                                                                                                                                                                          | ❌ Unsigned                                          |

**Reducers must be late-event-safe.** Per-aggregate ordering would require a future versioned envelope carrying a sequence, **which requires Core to emit one — a Phase 11 decision that must not be invented here.**

---

## C. Contract gaps — the complete list

**9 gaps.** Each is a business transition that **currently emits no canonical event**, with a named resolution phase. **No contract was changed in Stage 3.1.2.**

| #   | Gap                               | Subject  | Why it matters                                                                    | Resolution   |
| --- | --------------------------------- | -------- | --------------------------------------------------------------------------------- | ------------ |
| 1   | Lead clarification **requested**  | `lead`   | Kabir's core signal                                                               | **Phase 11** |
| 2   | Lead clarification **answered**   | `lead`   | Triggers rescoring                                                                | **Phase 11** |
| 3   | Lead **rejected on quality**      | `lead`   | A rejection is a business fact                                                    | **Phase 11** |
| 4   | Lead marked **duplicate**         | `lead`   | Suppresses downstream work                                                        | **Phase 11** |
| 5   | **Credit deducted**               | `vendor` | Money moved. **Band, never a balance**                                            | **Phase 11** |
| 6   | **Vendor suspended**              | `vendor` | The inverse of `activated`                                                        | **Phase 11** |
| 7   | **Vendor rejected**               | `vendor` | Terminal registration outcome                                                     | **Phase 11** |
| 8   | **Payment recorded**              | `vendor` | **Jarvis may never be authoritative for money** — the event is observational only | **Phase 11** |
| 9   | **Free-vendor interest captured** | `vendor` | Recharge intelligence                                                             | **Phase 11** |

**Every gap resolves in Phase 11 or by owner decision. None is resolved by inventing a contract now** — a payload invented for a system whose real shape we have now _seen_ would be worse than one invented in ignorance, because it would look authoritative.

---

## D. Where a mapping is not enough

**These require Core to change, and no adapter can substitute.**

**Assignment batching.** Core has **no batch number, no replacement batch, and a 9-vendor ceiling** counted from one pool. The canonical model needs `batchNumber ∈ {1,2}`, ≤3 per batch, **6 lifetime per lead-category, no overlap**. → **[Authority matrix, Conflict 1](./quickfurno-authority-matrix.md#conflict-1--the-vendor-cap-9-in-code-3-in-cores-docs-6-in-the-canonical-policy). Owner decision.**

**Client identity.** **There is no `clients` table.** A client is a normalized phone string. **13 `qf.client.*` events reference a client that Core does not have as an entity.**

**Reassignment.** Does not exist in Core — no table, no RPC, no status. The canonical model requires an explicit `ClientConfirmationV1`. **There is nothing to map.**

**Communication state.** Canonical = **18 states**. Core's `whatsapp-status` endpoint accepts **any string**, defaults to `"unknown"`, and **updates nothing**.

**Erasure.** Core has **no deletion or anonymisation path for any entity.** `qf.privacy.erasure-*` has no counterpart. **This is a hard gate on the Phase 11 privacy decision, not a mapping task.**
