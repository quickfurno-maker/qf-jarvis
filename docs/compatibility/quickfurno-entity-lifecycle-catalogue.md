# QuickFurno — Entity Lifecycle Catalogue

**Status:** Compatibility baseline. **Read-only analysis. The QuickFurno repository was not modified.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

**22 entities.** Every one is **owned by QuickFurno Core**. Jarvis is authoritative for **none** of them, holds derived non-authoritative views only, and mutates nothing.

**Sensitivity:** 🔴 direct personal data · 🟠 indirect/pseudonymous · 🟡 commercial · ⚪ operational/config.

> **Transitions are documented, not enforced.** **No entity in QuickFurno has any transition validation.** Every status change is a bare `update({ status })` with no from-state check — `Won → New`, `Rejected → Approved` and `Suspended → Approved` are all permitted. The "valid transitions" below are the ones the code _intends_, and a Jarvis projection **must not assume Core enforced them.**

---

## 1. Lead 🔴

|                     |                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core.** Jarvis never creates, scores, verifies or rejects a lead                                                                                             |
| **Identifier**      | `leads.id` (uuid)                                                                                                                                              |
| **Creation**        | Public enquiry → server action `submitLead` → **one** direct PostgREST insert (`services/leadService.ts:111`). **The only lead-insert site in the repository** |
| **States**          | CHECK: `New` · `Verified` · `Assigned` · `Contacted` · `Site Visit Scheduled` · `Quotation Sent` · `Converted` · `Won` · `Lost` · `Duplicate` · `Bad Lead`     |
| **Also written**    | ⚠️ `Quality Checked` · `Hot Lead` · `Clarification Required` · `Nurture` · `Rejected Quality` — **none of which are in the CHECK constraint**                  |
| **Transitions**     | **None enforced**                                                                                                                                              |
| **Related**         | `lead_scores`, `lead_assignments`, `client_requirement_groups`, `lead_clarification_requests`, `bad_lead_reports`                                              |
| **Sensitivity**     | 🔴 `name`, `phone`, `email`, `city`, `area`, `locality`, `message`                                                                                             |
| **Deletion**        | **No erasure path exists.** No delete, no anonymise, no retention policy                                                                                       |
| **Source**          | `services/leadService.ts`, `supabase/migrations/20260620000001_create_tables.sql:60-70`                                                                        |
| **Jarvis interest** | **Kabir** — advisory lead quality, completeness, plausibility, fraud signals                                                                                   |

> ### Two facts a Phase 11 adapter must not discover late
>
> **1. The committed SQL rejects the statuses the app writes.** `leads_verification_status_check` permits only `Pending`/`Verified`/`Rejected`, and the app writes `Quality Pending`, `Quality Checked`, `Manual Review`, `Rejected Quality`. Against the migrations as committed, **every `createLead` insert would violate the constraint (SQLSTATE 23514).** Since leads clearly are being created, **the live database has drifted from the migrations** — confirmed independently by `20260701000028_phase26a_live_schema_repair.sql`, whose header records a live column the migrations never created. **The migrations are not a faithful description of the running database.**
>
> **2. `leads.message` is a free-text dumping ground for the most sensitive data.** There are **no `latitude`/`longitude` columns on `leads`.** The enquiry form captures GPS and **interpolates the coordinates into free text** — `` `GPS: ${lat}, ${lng}` `` — which lands in `leads.message` (`components/.../ClientEnquiryModal.tsx:714`). Clarification answers are appended there too. **An adapter that mapped "the requirement text" into a derived signal would carry a client's precise home coordinates across the privacy boundary.** The governed payload refuses `body`/`notes`/`freetext`/`raw` **by key** precisely to prevent this.

---

## 2. Client 🔴

|                     |                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core**                                                                                                                                  |
| **Identifier**      | **⚠️ None. There is no `clients` table.** A "client" is a **normalized phone number** on `leads`, grouped via `client_requirement_groups` |
| **Creation**        | Implicit — a client exists because a lead does                                                                                            |
| **States**          | **None.** No client lifecycle exists                                                                                                      |
| **Sensitivity**     | 🔴                                                                                                                                        |
| **Jarvis interest** | **Riya** — the complete client journey                                                                                                    |

> **The canonical model assumes a client entity that Core does not have.** `qf.client.*` events (13 of them) reference a client; Core has a phone string. **For Core to emit any client event, Core must first have a client identity.** That is a Core change, not a mapping. It is the second-largest structural gap after assignment batching.

---

## 3. Requirement group 🟠

|                     |                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core** · **Identifier** `client_requirement_groups.id`                                                         |
| **Creation**        | `findOrCreateRequirementGroup` — key: normalized phone + city + parent category group, within a **3-day window** |
| **Related**         | Parent groups: `Interior` · `Sofa` · `Painting` · `Civil Work`                                                   |
| **Jarvis interest** | Riya — linked multi-category requirements                                                                        |

> **"A multi-category enquiry becomes multiple leads" is NOT IMPLEMENTED.** There is exactly one lead-insert site and no fan-out loop; every entry point creates **one single-category lead**. Further, `findOrCreateRequirementGroup` has **one caller** — the client-selected-vendor path — so **normal funnel leads never get a `requirement_group_id` at all.**
>
> The canonical model requires cross-category needs to become **separate, linked leads** with independent consent, verification and scoring (`qf.lead.linked-created`). Core has no such mechanism.

---

## 4. Vendor 🔴

|                            |                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**                  | **Core.** Jarvis never verifies, activates, suspends or ranks a vendor                                                                                    |
| **Identifier**             | `vendors.id` (uuid); auth via `vendors.user_id → profiles.id → auth.users`                                                                                |
| **Creation**               | 6-step registration wizard → `adminClient().auth.admin.createUser` → `registerVendor`                                                                     |
| **States**                 | `vendors.status`: `Pending` · `Approved` · `Rejected` · `Suspended`. Separate boolean `is_active`                                                         |
| **Transitions**            | **None enforced.** `Rejected → Approved` and `Suspended → Approved` are permitted. **There is no "unsuspend"** — recovery is done by calling `approve`    |
| **Forced at registration** | `status: Pending`, `verification_status: Pending`, `paid_status: Unpaid`, `public_visibility: false`                                                      |
| **Sensitivity**            | 🔴 `owner_name`, `phone`, `whatsapp_number`, `email`, **`gst_number`** (government tax ID), full office address, **`latitude`/`longitude`** (precise GPS) |
| **Source**                 | `services/vendorService.ts`, `vendorAdminService.ts`                                                                                                      |
| **Jarvis interest**        | **Anisha** — advisory vendor lifecycle. **Never controls verification, activation, eligibility, ranking, packages, wallets, credits or money**            |

> ### `vendors.verification_status` is a write-once dead field, and it silently breaks a whole feature
>
> It is set to `'Pending'` at registration and **never written again by any code path.** But `'pending'` is in the **blocking set** for direct assignment (`vendorEligibility.ts:220`, `preferredVendorLeadService.ts:77-84`, and SQL `20260702000037:83`).
>
> **Therefore the preferred-vendor and client-selected direct-assignment paths can never succeed for any vendor created through the live registration wizard.** The auto-match RPC does not check `verification_status`, so it is unaffected — which is exactly why nobody has noticed.
>
> **A second dead-field pair:** `vendors.rating` and `completed_projects` are **read by every ranking function and written by nothing.** Every real vendor scores a permanent `+0` on both. **Vendor performance is ranked on two columns that are always zero.**

---

## 5. Vendor package 🟡

|                     |                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core** · **Identifier** `vendor_packages.id`                                                                |
| **States**          | `Active` · `Expired` · `Consumed` · `Cancelled`; `payment_status`: `Pending` · `Paid` · `Failed` · `Refunded` |
| **Creation**        | RPC `assign_package_to_vendor` — **hard-requires `payment_status = 'Paid'`**                                  |
| **Note**            | `expire_vendor_packages()` exists; **no scheduler ever calls it**                                             |
| **Jarvis interest** | Anisha — package readiness. **Bands, never balances**                                                         |

---

## 6. Package order 🟡

|                     |                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core** · **Identifier** `vendor_package_orders.id`                                                                                                                                               |
| **States**          | `order_status`: `created` · `cancelled` · `expired` · `payment_status`: `not_started` · `pending` · `paid` · `failed` · `refunded` · `activation_status`: `not_activated` · `activated` · `failed` |
| **Reality**         | **An inert intent record.** Insert hardcodes `payment_status: "not_started"`, `payment_provider: "not_connected"`. **A vendor clicking "buy" creates a row and nothing else happens**              |
| **Jarvis interest** | Anisha — recharge _conversation_, never the transaction                                                                                                                                            |

---

## 7. Payment 🟡

|                     |                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core, exclusively and permanently**                                                                                                                                                                 |
| **States**          | `Pending` · `Paid` · `Failed` · `Refunded`                                                                                                                                                            |
| **Reality**         | **There is NO payment gateway.** Zero hits for razorpay/stripe/paytm/phonepe/payu/cashfree. Money is **100% admin-recorded**: `createManualPayment` → `markPaymentPaid` → `assignPackageAfterPayment` |
| **Jarvis interest** | **NONE. Jarvis is never authoritative for money and never records, initiates or approves a payment**                                                                                                  |

---

## 8. Lead assignment 🔴

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**           | **Core, exclusively** · **Identifier** `lead_assignments.id`                                                                         |
| **Creation**        | **Five distinct paths** — auto-match, admin smart/recovery, preferred-vendor, client-selected, legacy                                |
| **States**          | `vendor_status`: `New` · `Contacted` · `Follow-up Needed` · `Site Visit Scheduled` · `Quotation Sent` · `Converted` · `Won` · `Lost` |
| **Types**           | `assignment_type`: `client_selected` · `auto_assigned` · `admin_assigned`                                                            |
| **Transitions**     | **None enforced.** `Won → New` is permitted                                                                                          |
| **Uniqueness**      | `unique (lead_id, vendor_id)` — the real duplicate-assignment guard                                                                  |
| **Credits**         | **1 credit deducted at assignment, inside the RPC transaction.** **There is no accept/decline step — a vendor cannot decline**       |
| **Sensitivity**     | 🔴 exposes client `phone` to eligible vendors                                                                                        |
| **Jarvis interest** | **Observation only. Jarvis never assigns, and `AssignmentBatchV1` has no shape in which an agent could name a vendor**               |

> ### The maximum is 9, not 3 — and this is the headline conflict
>
> |                                                             |                                       |
> | ----------------------------------------------------------- | ------------------------------------- |
> | `NORMAL_PRIMARY_VENDOR_LIMIT` (`lib/config.ts:112`)         | **3** — auto-match                    |
> | **`ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` (`lib/config.ts:113`)** | **9** ← **the true per-lead ceiling** |
> | Core's own docs (`quickfurno-aos-flow.md:195`)              | _"Maximum 3 vendors."_ ← **stale**    |
>
> Admin "recovery" mode assigns vendors 4–9. **They are not a separate pool** — `primary` and `recovery` are derived slices of **one** `DISTINCT COUNT(vendor_id)`. **A bad-lead-reported assignment still occupies a slot.**
>
> The canonical policy is initial ≤3 (batch 1), **exactly one** replacement batch ≤3 (batch 2), **6 unique vendors per lead-category for all time**, no overlap. **Core has no batch number, no replacement concept, and a ceiling of 9.** This is a **business-rule conflict for the owner**, not something an adapter may quietly reconcile.

---

## 9. Assignment queue item ⚪

|                     |                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifier** `lead_assignment_queue.id`                                                                                                                     |
| **States**          | `queued` · `matched_preview` · `resolved` (free text — **no CHECK**)                                                                                                 |
| **Defect**          | **Queue rows created by the preview engine are never processed** — the processor filters to only 2 of ~8 `queue_reason` values. The rest can only be cleared by hand |
| **Jarvis interest** | **None.** Core-internal mechanics                                                                                                                                    |

---

## 10. Matching run ⚪

|                     |                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifier** `lead_matching_runs.id`                                                     |
| **States**          | `started` · `skipped` · `waiting` · `matched` · `failed` (+ manual variants)                      |
| **Value**           | `matching_snapshot` carries skipped vendors **with reasons** and the vendors that lost to the cap |
| **Jarvis interest** | **Kabir** — high-value evidence for matching-readiness advice. **Read-only**                      |

---

## 11. Quality score 🟠

|                     |                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | **Core (LeadLens).** **Kabir advises alongside it and never replaces it**                                                                                           |
| **Identifier**      | `lead_scores.id`                                                                                                                                                    |
| **Algorithm**       | **Pure TypeScript** (`leadQualityService.ts:81`). **There is no SQL scoring function**                                                                              |
| **Buckets**         | contact ≤25 · location ≤20 · requirement ≤20 · intent ≤20 · fraud penalty ≤25; clamped 0–100                                                                        |
| **Classes**         | `A+` ≥85 · `A` ≥70 · `B` ≥50 · `C` ≥30 · `D` <30                                                                                                                    |
| **Hard blocks**     | `missing_share_consent` · `invalid_phone` · `duplicate_lead` · `fake_or_test_name` · `missing_city` · `missing_service` · `score_below_auto_distribution_threshold` |
| **Auto-distribute** | score ≥70 **and** class A/A+ **and** no hard block                                                                                                                  |
| **Sensitivity**     | 🟠 · ⚠️ **`lead_scores` has NO RLS**                                                                                                                                |

---

## 12. Clarification request 🟠 · 13. Clarification response 🔴

|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifiers** `lead_clarification_requests.id`, `lead_clarification_responses.id`  |
| **States**          | `preview_prepared` → `completed_upgraded` \| `completed_still_incomplete`                   |
| **Trigger**         | Class `B`, or action `clarification_required`                                               |
| **Ingestion**       | **A superadmin types the answers into the CRM by hand.** There is **no inbound WhatsApp**   |
| **Rescoring**       | Happens — but an upgraded lead goes to `Manual Review`, **not back into auto-distribution** |
| **Sensitivity**     | 🔴 `answer_value` is the client's own words · ⚠️ **both tables have NO RLS**                |
| **Jarvis interest** | Kabir — completeness. **No canonical clarification event exists → contract gap**            |

---

## 14. Bad-lead report 🟠

|                     |                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifier** `bad_lead_reports.id`                                                                               |
| **States**          | `Pending` · `Under Review` · `Valid` · `Invalid` · `Resolved` · `Rejected` · `Approved`                                   |
| **Defect**          | **Two incompatible admin vocabularies write to one column** (`Approved`/`Rejected` vs `Under Review`/`Valid`/`Invalid`/…) |
| **Window**          | 24h (legacy path only — the current structured path **does not check it**)                                                |
| **Jarvis interest** | Anisha/Kabir — quality signal. **Never decides a refund**                                                                 |

> **Approving a bad-lead report refunds nothing and replaces nobody.** `credit_restored` is **hardcoded `false`**. The `restore_vendor_credit` RPC exists and is **never called from any refund path** — its only callers are `unique_violation` rollbacks. **`credit_restored` can only ever be `false`.** The vendor keeps a bad lead, loses the credit, and the slot stays consumed.

---

## 15. Complaint

**NOT IMPLEMENTED.** There is no complaint table and no client complaint feature; the word appears only as unused AOS enum strings. The canonical events `qf.client.complaint-recorded` and `qf.vendor.complaint-recorded` have **no Core counterpart** → **contract gap, Phase 11.**

---

## 16. Notification ⚪

|                     |                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifier** `vendor_notifications.id`                                                                                                |
| **Created by**      | **Only 3 places**: profile-change approve, profile-change reject, admin support reply. **Nothing emits credit, lead or package notifications** |
| **Jarvis interest** | None directly — communication authority is **the QuickFurno Communication Core's**, exclusively                                                |

---

## 17. WhatsApp message 🔴

|                     |                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------- |
| **Owner**           | **Core + provider (Meta)** · **Identifier** `whatsapp_logs.id`                            |
| **States**          | `Pending` → `Sent` \| `Failed`                                                            |
| **Written by**      | **Only the legacy `assign_lead_to_vendors` RPC**                                          |
| **Sensitivity**     | 🔴 **`phone` and `message` stored in the clear** — both the vendor's and the **client's** |
| **Jarvis interest** | **NONE. Jarvis has no provider path, no WhatsApp credential, and never sends anything**   |

> ⚠️ **The `whatsapp-dispatch` Edge Function calls the real Meta Graph API v20.0.** Its **only** gate is the presence of `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`. It is **Deno and cannot read the Next.js feature flags**, so `WHATSAPP_SENDING_ENABLED = false` **does not restrain it**, and `README.md:42` ("No WhatsApp sending yet") is **false**. Setting two secrets sends real messages to real people.

---

## 18. Support thread ⚪ · 19. Category ⚪ · 20. City ⚪

| Entity             | Owner             | States                                                 | Note                                                                                                                                   |
| ------------------ | ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Support thread** | Core              | `open` · `admin_replied` · `vendor_replied` · `closed` | **`closed` is never set** — no close function exists                                                                                   |
| **Category**       | Core (Superadmin) | `is_active`                                            | **No FK from vendors** — categories are **denormalized text** matched by **three divergent label/synonym rulesets**. 7 canonical names |
| **City**           | Core (Superadmin) | `is_active`                                            | **Only 2 cities are live** (Pune, Mumbai)                                                                                              |

**Jarvis interest in all three: advisory only. Jarvis never changes a category, a city, or a support outcome.**

---

## 21. Runtime setting ⚪

|                           |                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**                 | **Core (Superadmin), exclusively**                                                                                                                            |
| **Three separate tables** | `aos_runtime_settings` (one key: the n8n lock) · `marketplace_runtime_settings` (**preview engine only**) · `app_settings` (**no application writer exists**) |
| **Sensitivity**           | ⚠️ **`marketplace_runtime_settings` has NO RLS** — under Supabase's default grants it is **anon-writable**, and it holds runtime kill-switches                |
| **Jarvis interest**       | **NONE. Jarvis never modifies a runtime setting. An agent that could change its own operating parameters could authorize itself, one indirection removed**    |

---

## 22. Audit record ⚪

|                     |                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | Core · **Identifier** `audit_logs.id`                                                                                                                                                          |
| **Defect**          | ⚠️ **The actor is never recorded.** `recordAuditLog` writes 4 of 9 columns; **`admin_user_id`, `ip_address` and `user_agent` are always NULL.** The audit trail **cannot answer "who did it"** |
| **Coverage**        | Only 6 action types. **Credit grants, manual payments, manual assignment, bad-lead decisions and runtime-setting changes are NOT logged**                                                      |
| **Also**            | `audit_logs` is **write-only** — never read back into any UI                                                                                                                                   |
| **Jarvis interest** | **None (Core's audit is Core's).** Jarvis keeps its **own** audit of its **own** recommendations — because the authority is Core's, the audit of authority is Core's                           |

---

## Summary

|                                              |                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entities catalogued**                      | **22**                                                                                                                                                                    |
| **Owned by Core**                            | **22 (all)**                                                                                                                                                              |
| **Owned by Jarvis**                          | **0**                                                                                                                                                                     |
| **Not implemented in Core**                  | **Complaint**; and _within_ other entities: client identity, replacement/reassignment, refunds, vendor accept/decline, satisfaction, closure, ratings, nurture, follow-up |
| **State machines with enforced transitions** | **0 of 22**                                                                                                                                                               |
