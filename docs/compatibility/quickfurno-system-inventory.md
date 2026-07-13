# QuickFurno — System Inventory

**Status:** Compatibility baseline. **Read-only analysis. The QuickFurno repository was not modified.**
**Date:** 2026-07-13
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

|                      |                                                        |
| -------------------- | ------------------------------------------------------ |
| **Repository**       | `quickfurno-maker/quickfurno-marketplace`              |
| **Snapshot SHA**     | **`00706899b46ae16fa6170c70125708b63e0926a9`**         |
| **Snapshot date**    | 2026-07-03                                             |
| **Snapshot subject** | _"Add admin clarification response ingestion preview"_ |
| **Inspected**        | **583 files**, **170 directories** (excluding `.git`)  |

> **Every claim below was verified from implementation and SQL.** Where a README or design document contradicts the code, **the code is recorded as the truth and the contradiction is listed in [current-aos-to-jarvis-migration.md §7](./current-aos-to-jarvis-migration.md#7-documentation-vs-implementation-drift-found-in-core)**.
>
> **QuickFurno has no test suite.** There are **zero** test files in the repository — no `*.test.*`, no `*.spec.*`, no `__tests__`, and no test runner in `package.json`. The brief asked that behaviour be verified from "implementation, SQL and tests"; **the third source does not exist**, so implementation and SQL are the only evidence, and nothing here rests on a test having passed.

---

## 1. Stack

|                     |                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**       | Next.js **14.2.15**, App Router (`package.json:16`)                                                                                                            |
| **UI**              | React 18.3, Tailwind 3.4                                                                                                                                       |
| **Runtime**         | **Not pinned.** No `engines`, no `.nvmrc`, no `.node-version`. Only `@types/node: ^20.16.5` implies Node 20 — and that is a _types_ package, not a runtime pin |
| **Package manager** | **npm** (`package-lock.json`)                                                                                                                                  |
| **Database**        | **Supabase** PostgreSQL (Core's own project — **permanently forbidden to Jarvis**)                                                                             |
| **Data access**     | `@supabase/supabase-js` ^2.45, `@supabase/ssr` ^0.5 — PostgREST + **RPC**                                                                                      |
| **Edge**            | One Supabase Edge Function (Deno): `whatsapp-dispatch`                                                                                                         |
| **Tests**           | **None**                                                                                                                                                       |
| **Dependencies**    | **5 runtime deps total.** No AI SDK, no payment SDK, no queue, no ORM                                                                                          |

**There is no AI provider dependency and no AI provider call anywhere in the repository.** `AOS_AI_ENABLED = false`, and there is no code path behind it.

---

## 2. Domain modules

| Module                    | Location                                                                                                                                                   | What it is                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Client / lead capture** | `app/enquiry`, `app/actions.ts`, `services/leadService.ts`                                                                                                 | Public enquiry → one `leads` row                                  |
| **Lead quality**          | `services/leadQualityService.ts`                                                                                                                           | **Pure TypeScript** scoring. There is **no SQL scoring function** |
| **Clarification**         | `services/leadClarificationService.ts`                                                                                                                     | Preview-only. Answers are typed in by a superadmin                |
| **Requirement groups**    | `services/clientRequirementGroupService.ts`                                                                                                                | Multi-category grouping by phone + city + parent category         |
| **Vendor**                | `services/vendorService.ts`, `vendorAdminService.ts`, `publicVendorService.ts`                                                                             | Registration, profile, pipeline                                   |
| **Packages / credits**    | `services/packageService.ts`, `vendorPackageOrderService.ts`                                                                                               | Credits, package orders                                           |
| **Matching / assignment** | `services/leadMatchingEngine.ts`, `leadDeliveryService.ts`, `manualLeadAssignmentService.ts`, `delayedLeadFillService.ts`, `preferredVendorLeadService.ts` | **Five distinct assignment paths** (§6)                           |
| **AOS**                   | `lib/aos/**` (193 files)                                                                                                                                   | Agent scaffold + n8n bridge. **Advisory/preview only**            |
| **Admin**                 | `app/admin`, `services/adminService.ts`, `adminAuditService.ts`                                                                                            | Superadmin console                                                |
| **CRM / analytics**       | `lib/crm`, `lib/analytics`                                                                                                                                 | Read-only views over rule engines                                 |

---

## 3. Routes

**API routes (27).** Admin routes are superadmin-gated; AOS routes are shared-secret gated.

| Group                  | Routes                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin — vendors**    | `/api/admin/vendors`, `/[id]/status`, `/[id]/credits`, `/[id]/credit-log`, `/[id]/package`                                                                       |
| **Admin — assignment** | `/api/admin/lead-assignment-preview`, `/lead-assignment-approval`, `/lead-assignments/[id]`, `/recent`, `/failed`, `/logs`, `/process-due-lead-assignment-queue` |
| **Admin — config**     | `/api/admin/categories`, `/[id]`, `/[id]/active`, `/api/admin/aos-runtime-settings`                                                                              |
| **AOS**                | `/api/aos/events`, `/process-lead`, `/whatsapp-status`, `/failure`                                                                                               |
| **Public**             | `/api/categories`, `/api/cities`                                                                                                                                 |

**Pages.** Public marketing + category + vendor discovery; `/enquiry`; `/vendors/register`; `/vendor/dashboard/{leads,package,profile,support,notifications}`; `/admin/{dashboard,[section],login}`.

**Server actions** (`app/actions.ts`) carry most mutations — `submitLead`, `adminAssignLead`, `assignLeadManually`, `adminSaveLeadClarificationResponses`, and the superadmin operations.

---

## 4. Service boundaries — and the one that matters

**QuickFurno's authority is enforced in application code, not in the database.**

The authoritative business operations are **PostgreSQL functions** (`security definer`) invoked through **`adminClient()` — the Supabase service role, which bypasses row-level security.** RLS protects the _browser_ client; it does not constrain the server. Which operation runs is decided by which function the server code calls.

> **This is Core's business and Core may run it that way. But it settles one thing for Jarvis: the boundary between the two systems cannot be a database boundary.** A "read-only" credential into Core's database would be read-only by our restraint, not by the database's enforcement — because the credential that Core's own code uses is not constrained by RLS either.

---

## 5. Major tables

**69 tables.** The ones that carry business truth:

| Domain         | Tables                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead**       | `leads`, `lead_scores`, `lead_attribution`, `lead_status_updates`, `lead_timeline_events`, `lead_internal_notes`, `client_requirement_groups`, `lead_clarification_requests`, `lead_clarification_responses`                                         |
| **Vendor**     | `vendors`, `vendor_packages`, `vendor_package_orders`, `vendor_credit_logs`, `vendor_notifications`, `vendor_support_threads`, `vendor_support_messages`, `vendor_profile_change_requests`, `vendor_internal_notes`, `free_vendor_profile_interests` |
| **Assignment** | `lead_assignments`, `lead_assignment_queue`, `lead_assignment_approvals`, `lead_matching_runs`, `lead_delivery_logs`, `lead_auto_assignment_logs`, `bad_lead_reports`, `bad_lead_report_comments`                                                    |
| **Money**      | `payments`, `packages`                                                                                                                                                                                                                               |
| **Config**     | `service_categories`, `cities`, `localities`, `app_settings`, `marketplace_runtime_settings`, `aos_runtime_settings`                                                                                                                                 |
| **Comms**      | `whatsapp_logs`, `client_notification_logs`, `admin_notifications`                                                                                                                                                                                   |
| **Admin**      | `profiles`, `audit_logs`, `reviews`                                                                                                                                                                                                                  |
| **AOS**        | `aos_agent_logs` (**the only one written**), plus `aos_audit_logs`, `aos_failures`, `aos_approval_queue`, `aos_cost_logs`, `aos_agent_memory`, `aos_agent_*` — **created in SQL and never written by any code**                                      |
| **CRM**        | `crm_leads`, `crm_followups`, `crm_activities`, … — **schema only; no TypeScript reads or writes them**                                                                                                                                              |

**Roughly a third of the schema is unused scaffolding.** The AOS management tables and the CRM tables exist, are RLS'd, and are empty in practice. A migration named `crm_analytics_foundation_safe_placeholders` says so in its own filename.

---

## 6. RPCs — where the business rules actually live

**23 SQL functions.** The mutating ones are the real API:

| RPC                                                                                                                                         | Effect                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `assign_lead_to_paid_vendors_phase26a`                                                                                                      | **The production auto-matcher.** Assigns ≤3, deducts credits inline, logs to `vendor_credit_logs` |
| `admin_smart_assign_lead_to_vendors`                                                                                                        | Admin override / "recovery". Assigns **up to 9 total**                                            |
| `assign_lead_to_preferred_vendor`                                                                                                           | Assigns exactly 1. **No vendor-cap check, no city gate, no category gate**                        |
| `assign_client_selected_vendor_to_group`                                                                                                    | Client-picked vendor, capped per requirement group                                                |
| `assign_vendor_to_requirement_group`                                                                                                        | Group assignment                                                                                  |
| `assign_lead_to_vendors`                                                                                                                    | **Legacy.** The **only** path that queues `whatsapp_logs`. **No `≤3` clamp**                      |
| `deduct_vendor_credit` / `restore_vendor_credit`                                                                                            | 1 credit, FIFO package burn-down                                                                  |
| `check_duplicate_lead`                                                                                                                      | Exact phone+service+city match within 30 days                                                     |
| `get_public_eligible_vendors`, `update_vendor_visibility`, `expire_vendor_packages`, `assign_package_to_vendor`, `increment_vendor_credits` | Vendor visibility and credits                                                                     |
| `is_admin`, `owns_vendor`, `handle_new_user`, `get_setting_int`                                                                             | Auth and settings helpers                                                                         |

All are `security definer`, single-transaction, with `select … for update` row locks, and all restore the credit on `unique_violation`.

---

## 7. State machines

**Every status column is a `text` CHECK. No transitions are enforced anywhere in the codebase** — updates are bare `update({ status })` with no from-state validation.

| Entity                  | Column                             | Values                                                                                                                                                     | Transition enforcement                                  |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Vendor**              | `vendors.status`                   | `Pending` · `Approved` · `Rejected` · `Suspended`                                                                                                          | **None**                                                |
| **Lead (status)**       | `leads.status`                     | CHECK: `New` · `Verified` · `Assigned` · `Contacted` · `Site Visit Scheduled` · `Quotation Sent` · `Converted` · `Won` · `Lost` · `Duplicate` · `Bad Lead` | **None**                                                |
| **Lead (verification)** | `leads.verification_status`        | CHECK: `Pending` · `Verified` · `Rejected`                                                                                                                 | **None**                                                |
| **Assignment**          | `lead_assignments.vendor_status`   | `New` · `Contacted` · `Follow-up Needed` · `Site Visit Scheduled` · `Quotation Sent` · `Converted` · `Won` · `Lost`                                        | **None.** `Won → New` is permitted                      |
| **Assignment type**     | `lead_assignments.assignment_type` | `client_selected` · `auto_assigned` · `admin_assigned`                                                                                                     | —                                                       |
| **Approval**            | `lead_assignment_approvals.status` | `draft` · `preview_approved` · `preview_sent_to_aos` · `cancelled`                                                                                         | **No reject path exists.** `cancelled` is never written |
| **Package order**       | `payment_status`                   | `Pending` · `Paid` · `Failed` · `Refunded`                                                                                                                 | **None**                                                |

### The schema conflict a reader must know about

**The application writes lead status values that the committed CHECK constraints reject.**

`services/leadQualityService.ts:225-226` writes `verification_status` values `Quality Checked` / `Manual Review` / `Rejected Quality`, and `status` values `Hot Lead` / `Clarification Required` / `Nurture` / `Rejected Quality`. **None of these appear in either CHECK constraint**, and no migration ever drops those constraints.

Against the SQL **as committed**, every `createLead` insert would violate `leads_verification_status_check` (SQLSTATE 23514).

**The live database has therefore drifted from the migrations in the repository.** Migration `20260701000028_phase26a_live_schema_repair.sql` confirms this independently — its header records that the live database had a column the migrations never created. **So the migrations are not a faithful description of the running database**, and any Phase 11 work that assumes they are will be working from a map of a different building.

**Two additional inconsistencies in the same area:** `lib/config.ts:127` (`LEAD_STATUSES`, 6 values) and `lib/types.ts:6-9` (`LeadStatus`, 13 values) barely overlap; `Verified` and `Bad Lead` are absent from the type.

---

## 8. Feature flags and runtime settings

**Three separate settings tables, and they are easy to confuse:**

| Table                          | Purpose                                                                                                         | Consumed by                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `aos_runtime_settings`         | **Only one key**: `aos_n8n_master_router`. Lock 2 of the n8n gate. **No effect on assignment, credits or caps** | AOS event bridge                                                           |
| `marketplace_runtime_settings` | `max_vendors_per_lead`, `auto_assignment_mode`, `allow_trial_vendors_for_assignment`, …                         | **The preview engine only.** The production matcher reads **none of them** |
| `app_settings`                 | `max_vendors_per_lead`, `duplicate_lead_window_days`, …                                                         | SQL `get_setting_int`. **No application writer exists**                    |

**Feature flags** (`lib/aos/config/featureFlags.ts`): `N8N_ENABLED` and `N8N_OUTBOUND_WEBHOOK_ENABLED` default `false` **but are environment-overridable**. `WHATSAPP_SENDING_ENABLED`, `CREDIT_DEDUCTION_ENABLED`, `AUTO_ASSIGNMENT_ENABLED` are `false` with **no env path** — a code change is required to flip them.

---

## 9. Ownership boundaries

| Owner               | What                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuickFurno Core** | **Everything authoritative**: leads, clients, vendors, assignments, credits, payments, packages, categories, cities, consent, communication |
| **n8n**             | Execution. Currently gated off behind two locks                                                                                             |
| **Providers**       | Delivery (Meta WhatsApp Cloud API)                                                                                                          |
| **QF Jarvis**       | **Nothing in Core.** Derived, non-authoritative views only. **No table, no credential, no write, no read**                                  |

---

## 10. Known unfinished or preview-only features

Recorded so that nobody mistakes a scaffold for a system.

| Feature                                 | Reality                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI agents**                           | **30 registered, 0 with AI.** 5 have real deterministic rule engines (`lib/aos/agents/engines.ts`); **22 are unreachable stubs** whose `service.ts` has zero importers                                                               |
| **AOS approvals**                       | `lib/aos/approvals/*` — **zero callers**. No approval levels, no tiers, no escalation                                                                                                                                                |
| **AOS permission gate**                 | `checkAgentPermission` — **zero callers.** Gates nothing                                                                                                                                                                             |
| **AOS audit**                           | `auditWriter`, `auditLogger`, `agentLogger` — **pure object builders that persist nothing**                                                                                                                                          |
| **Lead assignment approval**            | **Inert.** `mode` is CHECK-locked to `'preview'`; it never assigns; there is **no reject path**                                                                                                                                      |
| **Nurture**                             | **Stub.** `status: "future_inactive"`. `Nurture` is a lead status nothing acts on                                                                                                                                                    |
| **Follow-up / CRM**                     | **Schema only.** No TypeScript touches `crm_leads` or `crm_followups`. The UI says "Scheduling new follow-ups is not enabled in this phase"                                                                                          |
| **Satisfaction / CSAT / NPS / closure** | **NOT IMPLEMENTED.** Zero hits across all SQL and TypeScript                                                                                                                                                                         |
| **Complaints**                          | **NOT IMPLEMENTED** as a client feature — the word appears only as unused AOS enum strings                                                                                                                                           |
| **Ratings / reviews**                   | `reviews` table exists; **no application code touches it.** No client rating flow                                                                                                                                                    |
| **Vendor accept/decline**               | **Does not exist.** Credits are deducted at assignment; a vendor cannot decline                                                                                                                                                      |
| **Replacement / reassignment**          | **Does not exist.** `replacementRules.ts` is an unimported 9-line stub. Approving a bad-lead report **restores no credit and assigns no replacement**                                                                                |
| **Payment gateway**                     | **None.** Payments are admin-recorded rows                                                                                                                                                                                           |
| **WhatsApp (AOS tool)**                 | Genuinely inert — always returns `skipped`                                                                                                                                                                                           |
| **WhatsApp (Edge Function)**            | ⚠️ **LIVE.** Calls the real Meta Graph API. Gated **only** by secret presence — **no AOS flag restrains it**. See the [migration map §7](./current-aos-to-jarvis-migration.md#7-documentation-vs-implementation-drift-found-in-core) |

---

## 11. The maximum-vendor rule — the headline business finding

**Core's documentation says the maximum is 3. Core's code permits 9.**

| Source                                                                                       | Value                                  |
| -------------------------------------------------------------------------------------------- | -------------------------------------- |
| `lib/config.ts:112` — `NORMAL_PRIMARY_VENDOR_LIMIT`                                          | **3** (auto-match)                     |
| **`lib/config.ts:113` — `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT`**                                  | **9** ← **the true per-lead ceiling**  |
| SQL `least(greatest(coalesce(p_total_limit, 3), 1), **9**)` — migrations `…31`, `…32`, `…33` | **9**                                  |
| `docs/quickfurno-aos-flow.md:195`                                                            | _"Maximum 3 vendors."_ ← **stale**     |
| `docs/quickfurno-security-boundaries.md:84`                                                  | `MAX_VENDORS_PER_LEAD = 3` ← **stale** |

The admin "recovery" mode assigns vendors 4 through 9. **They are not a separate pool** — `primary` and `recovery` are derived slices of **one** `DISTINCT COUNT(vendor_id)`, and **a bad-lead-reported assignment still occupies a slot**.

**This directly conflicts with the accepted Jarvis policy** — initial batch ≤3, exactly one replacement batch ≤3, **6 unique vendors per lead-category for all time**, no overlap ([ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md), [compatibility directive §4](../architecture/quickfurno-compatibility-directive.md)). Core has **no batch number, no replacement concept, and a ceiling of 9**.

### The owner decision (2026-07-13)

|                                  |                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner-approved target policy** | **3 initial + 3 replacement = 6 unique vendors per lead-category.** Exactly one replacement batch. **No overlap.** Replacement requires genuine dissatisfaction **and** explicit client confirmation |
| **Observed Core implementation** | **3 automatic / 9 manual recovery**, one combined distinct-vendor count, **no explicit replacement batch**                                                                                           |
| **Status**                       | **`core_remediation_required`** — a **Core implementation conflict**, not the approved policy                                                                                                        |
| **Remediation**                  | **Stage 3.1.3**, in the QuickFurno repository. **Hard gate before Phase 11**                                                                                                                         |

> **The observed 9 is recorded as evidence and is not overwritten by the target 6.** Normalizing it away would delete the reason the remediation exists — and a test asserts the manifest still says **9**, precisely so that nobody can tidy the conflict out of view.
>
> **Jarvis must never generate, recommend or normalize an assignment above the owner-approved limits.** Nothing in Stage 3.1.2 changes either system's behaviour.
