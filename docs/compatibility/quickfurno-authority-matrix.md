# QuickFurno — Authority Matrix

**Status:** Compatibility baseline. **Read-only analysis.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

---

## The permanent rule

> ## **Jarvis recommends. QuickFurno Core authorizes. n8n executes. Providers deliver. Results return to Core.**

- **No Jarvis→n8n path.** Not now, not in any phase.
- **No Jarvis→provider path.** No WhatsApp API call, no telephony, no provider credential inside the Jarvis trust zone.
- **No Jarvis write path into any QuickFurno business table.** Not permanently, not temporarily, **not "just as a cache."**

**This is enforced structurally, not by policy.** `ExecutionIntentV1.issuer` is the literal `quickfurno-core` and `executor` the literal `n8n` — so **Jarvis cannot construct a valid execution intent**, even in error, even if an agent tried ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md), [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md)).

**Every action has exactly one authoritative owner, and it is never Jarvis.**

---

## Classification

| Code             | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| **CORE-DET**     | Core-only deterministic action. Jarvis has no role at all   |
| **REC**          | Jarvis may **recommend**. Inert until Core authorizes       |
| **FOUNDER**      | Requires **founder** approval before Core issues an intent  |
| **ADMIN**        | Requires **admin** approval before Core issues an intent    |
| **N8N**          | Executed by n8n **on an intent Core issued**                |
| **PROVIDER**     | Delivered by a provider (Meta WhatsApp, telephony)          |
| **🚫 FORBIDDEN** | **Jarvis may never do this, and may not even recommend it** |

---

## The matrix

| #   | Action                         | Authoritative owner                                        | Jarvis may                                                                                     | Approval                    | Executed by                |
| --- | ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- | -------------------------- |
| 1   | **Verify / reject a lead**     | **Core** (LeadLens)                                        | **REC** — advise quality, completeness, fraud signals                                          | ADMIN                       | Core                       |
| 2   | **Change consent**             | **Core** (Communication Core)                              | **🚫 FORBIDDEN**                                                                               | —                           | Core only                  |
| 3   | **Assign vendors to a lead**   | **Core**                                                   | **REC** — advise _matching readiness_. **Never names a vendor**                                | ADMIN                       | Core                       |
| 4   | **Deduct a credit**            | **Core**                                                   | **🚫 FORBIDDEN**                                                                               | —                           | Core (RPC, in-transaction) |
| 5   | **Refund a credit**            | **Core**                                                   | **🚫 FORBIDDEN**                                                                               | FOUNDER/ADMIN               | Core                       |
| 6   | **Activate a vendor**          | **Core**                                                   | **REC** — advise readiness                                                                     | ADMIN                       | Core                       |
| 7   | **Suspend a vendor**           | **Core**                                                   | **REC** — advise risk. **Never suspends**                                                      | ADMIN                       | Core                       |
| 8   | **Change a vendor's package**  | **Core**                                                   | **REC** — advise a recharge _conversation_                                                     | ADMIN                       | Core                       |
| 9   | **Record a payment**           | **Core**                                                   | **🚫 FORBIDDEN**                                                                               | —                           | Core (admin-recorded)      |
| 10  | **Send a WhatsApp message**    | **Core** authorizes · **n8n** executes · **Meta** delivers | **REC** — propose a `CommunicationRequestV1`. **Never sends**                                  | **FOUNDER** (first) → ADMIN | N8N → PROVIDER             |
| 11  | **Place a voice call**         | **Core** authorizes · **n8n** executes                     | **REC** — **only after messaging safety evidence** (Phase 11A)                                 | **FOUNDER**                 | N8N → PROVIDER             |
| 12  | **Reassign / replace vendors** | **Core**                                                   | **REC** — **only** with an explicit `ClientConfirmationV1`                                     | ADMIN                       | Core                       |
| 13  | **Resolve a complaint**        | **Core**                                                   | **REC** — advise, escalate, hand off to a human                                                | ADMIN                       | Core                       |
| 14  | **Campaign spend / budget**    | **Core**                                                   | **REC** — advise budget shift. **Jitin has no ad-provider credential and no budget authority** | **FOUNDER**                 | Core                       |
| 15  | **Change categories / cities** | **Core** (Superadmin)                                      | **REC** — advise demand/expansion                                                              | ADMIN                       | Core                       |
| 16  | **Modify runtime settings**    | **Core** (Superadmin)                                      | **🚫 FORBIDDEN**                                                                               | —                           | Core only                  |

---

## The four hard prohibitions, and why each is absolute

**Jarvis is never authoritative for money, consent, assignment, activation, suspension, or communication eligibility.** A test asserts this against the manifest, and it is a test that must never be "fixed" by relaxing it.

### Money (#4, #5, #9)

**Jarvis holds no balance, deducts nothing, refunds nothing, and records no payment.** Money-adjacent events carry **bands** (`low`/`medium`/`high`/`critical`), **never balances**.

A wallet figure inside a Jarvis contract would be **stale by construction** — a copy nobody reconciles — and it would invite somebody to reason about a real vendor's real money from it. Anisha recommends a recharge _conversation_. **She never touches the money.**

### Consent (#2)

**Consent is the QuickFurno Communication Core's, exclusively.** Jarvis holds **no** consent flag, no preference, no suppression list, no STOP/START interpretation, and no eligibility cache. This is enforced: **`CommunicationRequestV1` has no consent field, and one cannot be added** — the schema is strict.

Two rules that follow, and that may never be softened:

- **Unknown or stale consent is not permission.** A missing answer is a **no**.
- **Transactional no-objection is not marketing permission.** A client who accepted a delivery update **has not agreed to be marketed to**.

### Assignment (#3, #12)

**Riya never assigns. Kabir never assigns. No agent names a vendor** — `AssignmentBatchV1` **has no shape in which an agent could name one**, because the batch is created by Core and `issuer` is a literal.

**A replacement requires a `ClientConfirmationV1`** pointing at the canonical event in which the client **actually asked**. An agent noticing that a client has gone quiet, or a model scoring a conversation as unhappy, is **evidence — not confirmation**, and it may not become one by an agent being confident about it.

> The failure this prevents is concrete: **three new vendors are contacted about a real person's home renovation because a model decided their tone had cooled.** That is not recoverable. The vendors have been paid for in lead value, and the client has been shopped around without asking.

### Communication eligibility (#10, #11)

**Jarvis may not decide that a channel is acceptable, that a recipient is contactable, or that a message was delivered.** It proposes; the Communication Core decides; n8n executes; the provider delivers; **the truth of what happened comes back from Core.**

**No production communication before Phase 11 succeeds.** Voice only after messaging safety evidence.

---

## Authority conflicts found in Core

These are places where **Core's implemented reality conflicts with the accepted Jarvis model**. They are **owner decisions**, not adapter problems, and **Stage 3.1.2 resolves none of them.**

### Conflict 1 — the vendor cap. **9 in code, 3 in Core's docs, 6 in the canonical policy.**

| Source                                                                                                      | Value                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Core code — `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` (`lib/config.ts:113`)                                         | **9 per lead**                                                                                          |
| Core code — `NORMAL_PRIMARY_VENDOR_LIMIT` (`lib/config.ts:112`)                                             | 3 (auto-match only)                                                                                     |
| Core docs — `quickfurno-aos-flow.md:195`                                                                    | _"Maximum 3 vendors."_ ← **stale**                                                                      |
| **Canonical policy** ([ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md)) | **3 initial + 3 replacement = 6 lifetime per lead-category, no overlap, exactly one replacement batch** |

Core has **no batch number, no replacement concept, and no lifetime cap.** Its `primary` and `recovery` counts are **derived slices of one `DISTINCT COUNT`**, and a **bad-lead-reported assignment still occupies a slot**.

> ### RESOLVED BY THE OWNER, 2026-07-13 — `core_remediation_required`
>
> **The owner-approved policy stands: 3 initial + 3 replacement, 6 unique vendors per lead-category, no overlap, exactly one replacement batch.** Replacement requires **genuine dissatisfaction AND explicit client confirmation**. Core must revalidate category, location, eligibility, consent, capacity, package, credits and anti-abuse. A different category creates a **separate linked lead with its own cap**. **Jarvis and Riya may request a replacement; they may never assign.**
>
> **Core's observed 9-vendor model is a Core implementation conflict**, and it is remediated in **[Stage 3.1.3](../architecture/phased-roadmap.md)** — in the QuickFurno repository. **Hard gate before Phase 11.**
>
> **The observed 9 stays in the manifest as evidence.** An adapter must not silently reconcile the two — that would be a Jarvis projection asserting a cap the authoritative system does not enforce, which is the most dangerous kind of wrong: green, plausible, and false.

### Conflict 2 — the approval flow authorizes nothing.

`lead_assignment_approvals` is **inert**: `mode` is CHECK-locked to `'preview'`, it **never assigns**, and **there is no reject path** (`'cancelled'` exists in the CHECK and is never written). Meanwhile **every path that actually assigns requires no approval at all.**

**So Core today has an approval artifact that approves nothing, and real assignment paths that ask nobody.** The canonical model requires that an execution intent be issued **only** after authorization. **Core must acquire a real authorization step before it can honour that.**

### Conflict 3 — the AOS permission gate gates nothing.

`checkAgentPermission` and its `BLOCKED_ACTIONS` set have **zero callers**. `lib/aos/approvals/*` has **zero callers**. **They are not an authorization layer, and must never be mistaken for one.**

This is harmless today — the AOS writes no business tables, so there is nothing to gate. **It stops being harmless the moment an agent gains a write path**, and the scaffolding will look, to a reader in a hurry, exactly like the safety it is not.

### Conflict 4 — the audit trail cannot name the actor.

`audit_logs.admin_user_id` is **never written**. Credit grants, manual payments, manual assignment and runtime-setting changes are **not logged at all**.

**Authority without an audit trail is authority nobody can review after the fact.** The canonical model requires every authorization to be attributable ([auditability-principles.md](../governance/auditability-principles.md)). **Core cannot currently answer "who approved this?" for its most sensitive actions.**

### Conflict 5 — a live send path no flag can stop. ⚠️ **OWNER DECISION: PROHIBITED**

The `whatsapp-dispatch` Edge Function **calls the real Meta Graph API**, gated **only** by secret presence. It is **Deno** and **cannot** read the Next.js feature flags — so **`WHATSAPP_SENDING_ENABLED = false` is not a property of the system.** Core's README asserts the opposite.

> ## **`LIVE_WHATSAPP_BEFORE_PHASE_11A = PROHIBITED`** — owner decision, 2026-07-13
>
> The function is classified **`live_capable_not_authorized`**; remediation required before **`phase_11a`**.
>
> **Until Phase 11A:** it **must not be scheduled**, **must not be manually invoked for production delivery**, and **must not be given active Meta credentials**. **Queued `whatsapp_logs` rows do not constitute authorization to send.** **No Jarvis recommendation may directly trigger it.**
>
> Future live delivery runs **Core authorization → execution intent → n8n → approved provider adapter → provider result → authoritative Core result event**, with recipient resolution, consent, opt-out/DNC, communication eligibility, quiet hours, message purpose, approval level, idempotency, at-most-once execution and an audit trail **all checked by Core**.

**The general lesson is worth more than the specific bug: a feature flag in one runtime does not govern another.** The Next.js constants and the Deno Edge Function are separately deployed artifacts. **A safety flag the dangerous code path cannot see is not a safety flag — it is a comment that looks like one**, and it is more dangerous than no flag at all, because everybody believes it.

---

## What Jarvis owns

**Exactly this, and nothing that touches Core:**

- Its **own** recommendations, agent runs, evaluations, and founder-attention state.
- Its **own** derived, non-authoritative, rebuildable projections.
- Its **own** event log — **append-only, and containing no live personal data before the Phase 11 privacy gate.**
- Its **own** bounded agent memory: **`authoritative: false` is a literal and `true` does not parse.**

**When a derived view and Core disagree, Core wins, always, without discussion — and the view is rebuilt, not reconciled toward.**
