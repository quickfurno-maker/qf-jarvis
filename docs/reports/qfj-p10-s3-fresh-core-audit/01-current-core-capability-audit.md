# QFJ-P10 S3 — fresh read-only QuickFurno Core capability audit

**Status:** Read-only audit, **presented for owner acceptance on PR #177 — NOT delivered, complete or
merged.** **No Core modification, no Supabase access, no n8n/provider access, no message sent, no
migration, no activation.**
**Owning decision:** [ADR-0136](../../decisions/ADR-0136-qfj-p10-s3-fresh-quickfurno-core-audit.md)
(**Proposed**, PR #177 open)
**Jarvis baseline:** `eebee71e4e156608e2e04e60802b9d24b33140f5` (merge of PR #176 / ADR-0135)
**Slice:** **S3 / D1** under [ADR-0132](../../decisions/ADR-0132-aarohi-real-execution-integration-planning.md)
and [ADR-0135](../../decisions/ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md).

> **PR #177 presents the S3 audit for owner acceptance. If merged, D2 becomes the next execution
> step.** Until then S3 is **audited on this feature branch, awaiting owner acceptance**.

## Pinned Core commit

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Repository           | `quickfurno-maker/quickfurno-marketplace` (public)                                            |
| Branch               | `main`                                                                                        |
| **Pinned SHA**       | **`af7c2bb4f5a83731666fe059e963d1824cddd7b6`**                                                |
| Commit title         | `Merge pull request #51 from quickfurno-maker/mvp/qf-mvp-80-02-gate06-repair`                 |
| Commit timestamp     | `2026-08-30T15:19:52Z`                                                                        |
| Audit start (UTC)    | `2026-08-31T03:38:05Z`                                                                        |
| Historical audit SHA | `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca` (ADR-0125/0126/0127; **historical evidence only**) |

`main` was resolved **once** at audit start and pinned. Everything below is read from that SHA only.

### Method, and exactly what it can certify

Read-only detached checkout outside the qf-jarvis tree; static inspection of migrations, services,
routes, libraries and docs. **No branch, commit, push or PR in Core. No managed Supabase connection,
no migration run, no seed, no live data.** Where code was insufficient, findings are classified
`AMBIGUOUS_REQUIRES_D2` rather than settled from live data.

**What S3 independently certifies:** the contents of the repository at the pinned SHA — schema
definitions, service behaviour, routes, tests, typed constants and documentation.

**What S3 does NOT certify:** the **managed live database applied-state**. S3 read files, not a
database. Where this report cites applied-state, it is citing **Core's own repository documentation**,
attributed as such.

**Checkout limitation:** six files failed to materialise on Windows for path-length reasons — five
`.png` mockups and one `.docx` under `QuickFurno_Codex_Implementation_Kit/`. **Zero** are in `app/`,
`db/`, `lib/`, `services/`, `supabase/`, `automation/` or `scripts/`.

---

## 0. Headline

**Core has changed substantially since the historical audit, and the concrete implementation now
visible was never audited before.**

Two findings dominate:

1. **Core independently describes the same architecture Jarvis chose.**
   `docs/QF-Jarvis-Integration-Boundary.md` states QuickFurno is the system of record, Jarvis holds no
   authoritative copy, Jarvis recommendations are inert and authorise nothing, and an approved
   recommendation does **not** bypass the policy engine. **This corroborates Model 2 from the other
   side of the boundary.**
2. **The event transport Model 2 needs is a CONTRACT, not a capability.**
   `lib/events/eventEnvelope.ts` is explicitly _"inert TYPES + METADATA only"_, and it is **not wired**
   to `domain_events` / `outbox_events` at the pinned code. **Core's own documentation states that
   migration is unapplied on the live database** — S3 did not independently verify that. **This
   confirms ADR-0135's caution: candidate contracts are not adopted Core emissions.**

**Model 2 remains viable. No finding requires reopening ADR-0135.**

---

## 1. Domain A — identity / prospect → vendor continuity

**Classification: `ABSENT` (unchanged from historical GAP A).**

| Term               | Hits                                          |
| ------------------ | --------------------------------------------- |
| `prospect_id`      | **0**                                         |
| `acquisition_case` | **0**                                         |
| `vendor_prospect`  | **0**                                         |
| `prospect_vendor`  | **0**                                         |
| `prospect` (any)   | 4 (incidental prose; no correlation contract) |

`leads.vendor_id` and `lead_assignments` link **client leads to vendors** — a different concept from
vendor-acquisition prospect continuity. **GAP A is unchanged.**

---

## 2. Domain B — registration

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` for "registration complete"; the auth-account
question is now settled in the negative.**

`supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql:189`,
`public.handle_new_user()`, creates a `public.profiles` row and its own comment states it **"Creates
no vendor, client, credit, package, verification or assignment state."**

> **Auth account creation is NOT registration.** Now explicit in Core, not inferred.

`vendors.verification_status` and `vendors.status` exist, but there is still **no readable
registration-process surface addressable for an unregistered party** — the historical finding
**stands**.

---

## 3. Domain C — payment / package / commercial

**Classification: `AUTHORITATIVE_PRESENT` (constrained). Genuine change to a previously audited
finding.**

| Field                                                       | Constraint at pinned SHA                          | Source                                        |
| ----------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| `payments.payment_status`, `vendor_packages.payment_status` | `('Pending','Paid','Failed','Refunded')`          | `20260620000001_create_tables.sql:98,112`     |
| `vendor_package_orders.order_status`                        | `('created','cancelled','expired')`               | `20260701000023_vendor_package_orders.sql:69` |
| `vendors.package_status`                                    | `('none','active','expired','cancelled','trial')` | `20260630000018…sql:42`                       |

The historical audit recorded these as _"unconstrained `text` with no CHECK"_. **CHANGED.** Still
vendor-id keyed, so **not prospect-addressable**; and `package_status='active'` remains a _package_
fact — **paid ≠ active vendor**.

---

## 4. Domain D — authoritative "this party is live"

**Classification: `ABSENT` as a single fact (unchanged GAP B).**

| Field                    | Vocabulary                                | Meaning                                      |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| `vendors.status`         | `Pending, Approved, Rejected, Suspended`  | approval/moderation — **no `ACTIVE` member** |
| `vendors.is_active`      | boolean                                   | a separate enable/disable flag               |
| `vendors.package_status` | `none, active, expired, cancelled, trial` | a commercial package state                   |

**GAP B is unchanged.**

---

## 5. Domain E — communication authority, split by what the source actually proves

The historical audit did **not** say communication authority was absent. It recorded that
**execution-time eligibility authority belonged to the QuickFurno Communication Core / QF
Communications Runtime, with no adopted Jarvis-facing protocol.** What was never audited is the
**concrete Core implementation**, which is now visible. The split below reports only what executable
source proves.

### 5.A Consent / suppression decision authority — `AUTHORITATIVE_PRESENT`

`services/communicationConsentDecisionService.ts` (501 lines) is, in Core's own words, the **"SOLE
read-only communication-consent + suppression PRECEDENCE authority."**

Backed by real schema: `communication_consent_events` (append-only evidence — scope, action,
`state_before`/`state_after`, reason, `policy_version`, idempotency), `communication_preferences`
(allowed / blocked) and `communication_suppressions` (destination hash, expiry, deactivation), from
`20260711000200_communication_consent_evidence_and_state_hardening.sql:102` onward. STOP/DNC arrive
through inbound consent commands (`20260712000300`, `20260713000100`, plus
`inboundConsentCommandService`, `consentCommandResponseService`, `consentAckWorkerService`).

### 5.B Outbound consent enforcement coordinator — `AUTHORITATIVE_PRESENT`

`services/outboundConsentEnforcementService.ts` (397 lines) is the **"SOLE OUTBOUND CONSENT
ENFORCEMENT COORDINATOR"**, converting a decision into **one closed outcome**. Its refusal codes are
machine-readable and closed — `CONSENT_SUPPRESSED`, `CONSENT_NOT_GRANTED`,
`UNCLASSIFIED_MESSAGE_TYPE`, `CONSENT_ENFORCEMENT_INVALID`, `CONSENT_AUTHORITY_INTEGRITY`,
`CONSENT_AUTHORITY_UNAVAILABLE` — the outcome is a discriminated union validated in full, and caller-
chosen scope/identity is refused. It **fails closed**.

It names Jarvis explicitly: _"CommunicationService, provider adapters, Meta, SMS, n8n and Jarvis
consume ONLY the closed outcome."_

### 5.C Full business / send authorization — **NOT proved by consent**

The same file states it outright:

> **CONSENT ≠ SEND AUTHORIZATION.** An `allow` means the CONSENT LAYER passed and nothing more. The
> authentication action, transport policy, auth deadline, transactional basis, template/mapping gate,
> provider runtime gate and canary all remain **SEPARATE authorities that must ALSO pass**.

Core's boundary doc assigns **business communication authorization to the Phase 4 Policy Engine**.
That is **design evidence** for where the authority sits; this audit did **not** trace the Phase 4
engine's full executable surface.

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` as a single provable "send is authorized" fact —
consent is necessary but insufficient.** Retained and unweakened: **Core can deny consent despite
human approval**, and **an approved recommendation cannot bypass policy or consent.**

### 5.D Jarvis-facing request → authorization wire surface — `CANDIDATE_OR_PROPOSED_ONLY`

The boundary doc names **Recommendation APIs** and the chain `agent recommendation → QuickFurno
authorization → consent/suppression → channel/provider decision → CommunicationService → provider`,
but Phase 5F-A ships **no Jarvis code, no endpoint, no agent role, no service-role grant.** The
_shape_ is agreed; the _adopted protocol_ is not.

### 5.E A `CommunicationAuthorizationV1`-equivalent artifact returned to Jarvis — **NOT ESTABLISHED**

`AMBIGUOUS_REQUIRES_D2`. The closed consent outcome is **not** a complete
`CommunicationAuthorizationV1` equivalent: it answers the consent layer only, carries no authorized
channel, no approval-decision citation and no Jarvis-facing identity.

---

## 6. Domain F — candidate event adoptability

**Classification: `CANDIDATE_OR_PROPOSED_ONLY` across the board.**

`lib/events/eventEnvelope.ts:60` defines `CanonicalEventEnvelope` _"for the future Jarvis integration
boundary (signed events) … **inert TYPES + METADATA only** … creates no table, no event bus, no
outbox, no consumer, and no execution path."_

**Rule applied to every row: generic persistence capacity ≠ persistence of the specific business
fact.**

| Jarvis candidate                           | Core owns the exact fact?                                                             | The exact fact persisted?                                           | Emission | Adoption                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- | -------------------------------------- |
| `qf.communication.authorization-recorded`  | **partly** — consent decision yes (5.A/5.B); full send authorization not proved (5.C) | consent evidence **yes** (`communication_consent_events`)           | **none** | **medium**, scoped to consent          |
| `qf.communication.result-recorded`         | **YES** — provider outcomes                                                           | **YES** (`communication_messages`, `communication_delivery_events`) | **none** | **medium**                             |
| `qf.communication.human-handoff-requested` | **NOT ESTABLISHED** — no Core handoff fact                                            | no                                                                  | none     | **blocked by missing truth**           |
| `qf.communication.human-handoff-recorded`  | **NOT ESTABLISHED**                                                                   | no                                                                  | none     | **blocked by missing truth**           |
| `qf.execution.intent-issued`               | **NOT ESTABLISHED** — see §6.1                                                        | **NOT ESTABLISHED**                                                 | none     | **blocked / ambiguous, pending D2/S5** |
| `qf.execution.result-recorded`             | **YES**                                                                               | **YES**                                                             | none     | **medium**                             |
| `qf.communication.state-recorded@2`        | compatibility/history only                                                            | —                                                                   | —        | **not proposed**                       |

### 6.1 `qf.execution.intent-issued` — generic outbox is NOT ExecutionIntent persistence

`lib/aos/workflow/workflowTypes.ts:41` defines `OutboxCommandRequest` as
`{ commandType: string; payload?: JsonRecord; idempotencyKey: string; … }` — **entirely generic**, and
the only `commandType` in the repository is `"test.noop"`
(`lib/aos/workflow/qfKernelTestWorkflow.ts:63`).

Bounded search for an ExecutionIntent semantic across `app`, `lib`, `services`, `supabase`, `scripts`,
`automation`:

| Term                | Hits  |
| ------------------- | ----- |
| `ExecutionIntent`   | **0** |
| `execution_intent`  | **0** |
| `executionIntent`   | **0** |
| `intent-issued`     | **0** |
| `ExecutionIntentV1` | **0** |

> **Correction to the first revision of this report:** it listed this candidate as _persisted →
> `outbox_events` (unapplied)_. That was unsupported. A generic outbox can carry _some_ command; it
> does not persist an `ExecutionIntentV1` fact. **Core ownership: NOT ESTABLISHED. Persistence of the
> exact fact: NOT ESTABLISHED.**

---

## 7. Domain G — event / outbox / reconciliation capability

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` — defined in source; live applied-state not
independently certified by S3.**

`supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql` defines **`domain_events`**
(line 119) and **`outbox_events`** (line 163) with idempotency keys, bounded attempts, retry
scheduling and a `pending → processing → sent → completed` status set.

Three distinct statements, deliberately kept apart:

|                                   | Status                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migration / schema definition** | **PRESENT in source** at the pinned SHA                                                                                                                                                            |
| **Jarvis envelope wiring**        | **definitively NOT WIRED** at the pinned code                                                                                                                                                      |
| **Managed live applied-state**    | **`AMBIGUOUS_REQUIRES_D2`** — _Core's own boundary documentation states the migration is unapplied on the live database_; **S3 did not query live schema and does not independently certify this** |

| Question                   | Finding                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Core → Jarvis protocol     | **ABSENT** (contract only)                                                                                                                    |
| Jarvis → Core protocol     | **ABSENT** (recommendation APIs named, not built)                                                                                             |
| Core → n8n protocol        | see §9 — an automation supervisor transport exists; **the Jarvis B4 protocol does not**                                                       |
| n8n → Core result protocol | **PARTIALLY PRESENT** — signature-gated webhook receipts + append-only delivery events                                                        |
| Retry / idempotency        | **PRESENT** — bounded attempts, `next_retry_at`, unique idempotency keys, plus `idempotency_records`                                          |
| Signing capability         | **PRESENT** — `communication_webhook_receipts.signature_valid` gates de-duplication; automation recover/reconcile routes take signed requests |

Core's roadmap (its boundary doc): **5F-A** pure contract (current) → **Phase 6** event taxonomy →
**Phase 7** signed integration/execution delivery → later canonical persistence.

---

## 8. Domain H — `execution-submitted` / dispatch

**Classification: `AMBIGUOUS_REQUIRES_D2` — unchanged from ADR-0135, with better detail.**

Core distinguishes dispatch phases in two places: `outbox_events.status`
(`pending → processing → sent → completed`, with `sent_at` ≠ `completed_at`) and
`communication_messages.status` (`queued → dispatching → accepted → sent`, with `accepted_at` ≠
`sent_at`).

**But** no event is emitted at any transition (§7), and this is Core's **automation/communication**
transport — **not** an `ExecutionIntentV1`-shaped issuance (§6.1: zero ExecutionIntent hits). Whether
Jarvis's `execution-submitted` should bind here, to an outbox `sent`, or to a future Phase-7 signed
dispatch fact is **a D2 decision**. **No dispatch event name is invented.**

---

## 9. Domain I — cancellation

**Two different facts wear the same word. This is the most important mapping trap in the audit.**

### 9.1 What the bounded writer audit found

Searched across `services`, `lib`, `app`, `scripts` at the pinned SHA:

| Term                                       | Hits           | Outcome                                                                           |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `status: "cancelled"`                      | 2              | one is a campaign, one a CRM task                                                 |
| `cancelCommunication`                      | **0**          | **no such operation exists**                                                      |
| `cancellation`                             | 4              | incidental                                                                        |
| `cancelled`                                | 79             | mostly unrelated entities (campaigns, CRM tasks, profile changes, package status) |
| `canceled`                                 | 1              | incidental                                                                        |
| `revoke` / `abort`                         | 11 / 45        | unrelated                                                                         |
| admin/API cancel route for a communication | **none found** | —                                                                                 |

**The only authoritative writer of `communication_messages.status = 'cancelled'`** is the private
`CommunicationService.terminalizeBeforeClaim(...)` (`services/communicationService.ts:1042`), reached
from exactly one place (line 1010):

> _"DENY — a definitive consent refusal. CANCEL it: `cancelled` is a legal edge from both `queued` and
> `retry_scheduled`, it is terminal, and it is NOT `failed` (nothing failed — we chose not to send)."_

### 9.2 The classification, and the trap

|                                                                                                      | Classification                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Cancellation **vocabulary / storage capacity**                                                       | **PRESENT_BUT_NOT_AUTHORITATIVE** — a status value is not a business operation |
| An authoritative **consent-refusal terminalization**                                                 | **AUTHORITATIVE_PRESENT** (one internal writer, consent-deny only)             |
| An authoritative **communication-cancellation operation or durable business fact** in Jarvis's sense | **ABSENT / `AMBIGUOUS_REQUIRES_D2`**                                           |

> **Core can represent `cancelled`, but S3 did not prove an authoritative communication-cancellation
> operation or durable business fact.**

**The trap:** `communication-model.md` defines Jarvis's `cancelled` as _"Cancelled before execution,
while cancellation was still permitted"_ — an actor decided to stop it. **Core's `cancelled` currently
means "consent said no",** which is Jarvis's **`rejected`**. **Mapping Core's `cancelled` onto Jarvis's
`cancelled` would silently record a consent refusal as a user cancellation.** D2 must not do that.

`automationRecoveryService` reinforces the absence: reconciliation _"READS `communication_messages` …
never writes it, never re-dispatches it and **never cancels it**."_

> **Correction to the first revision:** it said _"the fact now exists in Core's tables"_. Only the
> **vocabulary** exists, plus one consent-deny writer that means something else.

---

## 10. Domain J — expiry

**Classification: `AMBIGUOUS_REQUIRES_D2`.**

Expiry vocabulary exists (`order_status='expired'`, `package_status='expired'`,
`communication_suppressions.expires_at`, authentication deadlines), but **no durable
communication/execution expiry record with an owning clock** was found, and nothing establishes expiry
as a _recorded outcome_ rather than a computed comparison.

**Jarvis must not infer authoritative expiry from `now > expires_at`.** Unresolved, exactly as
ADR-0135 left it.

---

## 11. Domain K — channel semantics

**Classification: `AUTHORITATIVE_PRESENT` vocabulary, with one constraint worth noting.**

`communication_templates.channel` and `communication_messages.channel` are
`check (channel = 'whatsapp')`; `communication_consent_events.channel` ∈ `('whatsapp','sms','rcs')`.
Enforcement is per-channel — _"A WhatsApp decision NEVER authorizes an SMS send."_ A separate SMS path
exists.

Core can refuse **before** channel authorization (consent precedes the channel/provider decision).
**Whether Core may switch channel is `AMBIGUOUS_REQUIRES_D2`.** No V2 `channel` shape is chosen here.

---

## 12. Domain M — provider result / reconciliation

**`AUTHORITATIVE_PRESENT` for the state distinctions; `ABSENT` for a Core → Jarvis channel.**

`communication_delivery_events.normalized_event_type` ∈ **`accepted, sent, delivered, read, failed`**
(line 139), append-only, uniquely keyed per `(provider, event, message, type)`.

> **`provider-accepted` IS distinct from `delivered` in Core's schema** — Jarvis's core distinction is
> independently mirrored.

`communication_webhook_receipts` de-duplicates partitioned by `signature_valid`, so a forged body
cannot occupy a legitimate redelivery's slot. Reconciliation exists **inside Core**
(`campaignCommunicationResultService`, `automationRecoveryService`), but there is **no Core → Jarvis
reconciliation event or contract** — that historical finding **stands**.

Core does **not** model `answered`, `no-answer` or `busy` (no voice path at this SHA), and `completed`
has no distinct Core representation.

---

## 13. Domain L — Tier A/B durable coordination evidence (D2b input)

| Jarvis state              | Core primitive recording the Jarvis act?                                  | Finding                                                                   |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `draft`                   | **none** — pre-submission by definition                                   | stays Jarvis-local/ephemeral; ADR-0135 Option C fits. **Not chosen here** |
| `authorization-requested` | **none adopted** — Recommendation APIs named, unbuilt                     | **CANDIDATE**, needs D2                                                   |
| `scheduled`               | **partial** — `communication_messages.scheduled_at` exists                | **CANDIDATE**, needs D2                                                   |
| `follow-up-requested`     | **none found**                                                            | **ABSENT**                                                                |
| `human-handoff-required`  | **none found** — no handoff table among 100+, no handoff service among 89 | **blocked by missing truth**                                              |

> **D2b candidate reordering:** ADR-0135 rated `human-handoff-required` the leading Tier-B candidate
> **conditional on S3**, because a canonical _contract_ exists in `@qf-jarvis/contracts`. This audit
> finds **no corresponding Core fact**, so it is blocked by missing truth; `scheduled` and
> `authorization-requested` have the clearer path. **This is the condition resolving inside ADR-0135's
> own framing — not a decision changing.**

---

## 14. Domain N — execution-time eligibility

**`AUTHORITATIVE_PRESENT` inside Core for consent/suppression; `ABSENT` as an adopted Jarvis- or
n8n-facing protocol.**

Core can re-check consent, suppression, scope and channel immediately before dispatch — that is what
`outboundConsentEnforcementService` does, failing closed. Frequency/attempt limits exist
(`communicationFrequencyPolicyService`, `20260728001600`). **Quiet hours: not found as a named control
— `AMBIGUOUS_REQUIRES_D2`.** No adopted query surface for n8n or a runtime. **S6 is not designed here.**

---

## 15. Domain O — security / trust

**`PRESENT`, capability only. No secret value was read or printed.**

Webhook signature verification is load-bearing (`signature_valid` partitions de-duplication); signed
internal requests exist for automation recover/reconcile; provider-account binding is required for
delivery events and consent-ack intents; RLS is deny-all for API roles on communication tables with
least-privilege `service_role` grants; delivery events get `SELECT + INSERT` only.

**No agent is a database role** — the boundary doc states the agent labels, including `qf_jarvis`, are
_"not Supabase users, not PostgreSQL roles, not service-role identities, and not provider
credentials."_

**Unsigned current routes are not Jarvis authority**, and none was treated as such. **The existing
signing domain must not be assumed reusable** for a Jarvis trust purpose.

---

## 16. Historical delta

Two categories, kept separate so a newly audited domain is never phrased as a historical absence.

### 16.1 Previously audited findings — genuine changes (**3**)

| #   | Question                   | Historical @`06b1e22`                                                                             | Current @`af7c2bb`                                                                                                         | Impact                               |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | payment / order status     | unconstrained `text`, no CHECK                                                                    | **CHECK-constrained vocabularies**                                                                                         | prospect-addressability still absent |
| 2   | execution-time eligibility | authority = Communication Core / QF Communications Runtime; **no adopted Jarvis-facing protocol** | authority **unchanged**; the **concrete implementation is now visible and fails closed**; still no adopted Jarvis protocol | S6 more tractable                    |
| 3   | result reconciliation      | absent                                                                                            | **exists inside Core**; still no Core → Jarvis channel                                                                     | D2 input                             |

### 16.2 Previously audited findings — unchanged (**4**)

| #   | Question                         | Status                                                  |
| --- | -------------------------------- | ------------------------------------------------------- |
| 4   | prospect ↔ vendor correlation    | **ABSENT** — GAP A stands                               |
| 5   | authoritative party-live fact    | **ABSENT** — GAP B stands                               |
| 6   | registration-process read        | **still absent** (auth ≠ registration now explicit)     |
| 7   | execution authorization protocol | still **PROPOSED**; Core's boundary doc agrees on shape |

### 16.3 NOT AUDITED HISTORICALLY — newly audited (**8**)

| #   | Domain                                     | Current finding                                                                     |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| 8   | concrete Core communication implementation | unified communication core, consent evidence, enforcement coordinator               |
| 9   | Core event / outbox                        | defined in source; envelope unwired; live applied-state not independently certified |
| 10  | dispatch evidence                          | phases distinguishable; no event; not ExecutionIntent-shaped                        |
| 11  | cancellation evidence                      | vocabulary + one consent-deny writer; **no cancellation operation**                 |
| 12  | expiry evidence                            | vocabulary only; no owning clock                                                    |
| 13  | Tier A/B recording options                 | handoff absent; scheduled/request clearer                                           |
| 14  | channel semantics                          | messages pinned `whatsapp`; consent models three                                    |
| 15  | commercial / package truth                 | authoritative read, constrained                                                     |

**Genuine historical changes: 3. Unchanged: 4. Newly audited: 8.**

---

## 17. Model 2 check

**Model 2 remains VIABLE. No ADR-0135 reopen is required.**

Corroboration, from Core's own words: QuickFurno is the system of record and _"Jarvis holds no
authoritative copy"_; a recommendation is _"inert data"_ that _"authorizes nothing"_; _"an `approved`
recommendation does NOT bypass"_ the policy engine; _"n8n remains the execution fabric, not the second
brain."_

Every ADR-0135 caution is **confirmed**: candidate ≠ live emission; `execution-submitted` unresolved;
Tier A/B sources unsettled; and a reader cannot manufacture provenance — Core grants Jarvis no database
role at all.

**No OWNER ARCHITECTURE REOPEN candidate is raised.**

---

## 18. D2 decision queue

| #          | Question                          | Finding                                                                                                                          | Why it blocks                 | Smallest future decision                                                                                                 | Depends on          | Must NOT assume                                                                                      |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| **D2-Q1**  | prospect ↔ vendor continuity      | `ABSENT`                                                                                                                         | GAP A blocks S8               | adopt one durable correlation fact                                                                                       | Core work           | that `leads.vendor_id` is acquisition continuity                                                     |
| **D2-Q2**  | registration completion           | no process read                                                                                                                  | blocks continuation           | adopt a readable completion fact                                                                                         | Core work           | that an auth user is a registered vendor                                                             |
| **D2-Q3**  | payment / prospect addressability | constrained, vendor-keyed                                                                                                        | blocks pre-registration reads | decide whether a prospect-addressable read can exist                                                                     | D2-Q1               | that paid ⇒ active                                                                                   |
| **D2-Q4**  | authoritative party-live fact     | `ABSENT`                                                                                                                         | GAP B blocks S9               | adopt one "party is live" fact                                                                                           | Core work           | that `package_status='active'` or `is_active` means live                                             |
| **D2-Q5**  | communication authorization       | consent enforcement present (5.A/5.B); **full business authorization not proved** (5.C); **no Jarvis-facing artifact** (5.D/5.E) | blocks S4                     | settle three separately: the business-authorization surface, the Jarvis wire protocol, and the response artifact         | Core Phase 6/7      | that a consent `allow` is a send authorization or a `CommunicationAuthorizationV1`                   |
| **D2-Q6**  | adopted primitive events          | `CANDIDATE_ONLY`                                                                                                                 | blocks Tier-C projection      | choose which primitives Core emits first                                                                                 | D2-Q14              | that a contract implies an emission                                                                  |
| **D2-Q7**  | dispatch / submission evidence    | **UNRESOLVED**; no ExecutionIntent semantic in Core                                                                              | blocks `execution-submitted`  | bind the state to a named Core dispatch fact                                                                             | D2-Q6, Core Phase 7 | that a generic outbox row is an execution intent                                                     |
| **D2-Q8**  | cancellation                      | vocabulary + consent-deny writer only                                                                                            | blocks `cancelled`            | **first establish/adopt an authoritative cancellation operation and durable fact — then expose it as evidence**          | D2-Q6               | that Core's `cancelled` means Jarvis's `cancelled` (it currently means consent refusal ⇒ `rejected`) |
| **D2-Q9**  | expiry evidence                   | vocabulary only                                                                                                                  | blocks `expired`              | identify the owning clock and recorded outcome                                                                           | Core work           | that `now > expires_at` is authoritative                                                             |
| **D2-Q10** | Tier A/B evidence + ordering      | handoff absent; scheduled/request clearer                                                                                        | blocks D2b, D3, D5            | pick ADR-0135 Option A/B/C per state                                                                                     | D2-Q5, D2-Q6        | that a Jarvis contract implies a Core fact                                                           |
| **D2-Q11** | channel semantics                 | messages pinned `whatsapp`                                                                                                       | blocks V2 `channel`           | decide proposed vs authorized representation                                                                             | D2-Q5               | that Core will always name a channel                                                                 |
| **D2-Q12** | provider-result reconciliation    | internal only                                                                                                                    | blocks S7                     | adopt a Core → Jarvis reconciliation event                                                                               | D2-Q6               | that internal reconciliation reaches Jarvis                                                          |
| **D2-Q13** | execution-time eligibility        | present, unexposed                                                                                                               | blocks S6                     | decide whether n8n/runtime may query Core                                                                                | D2-Q5               | that Jarvis may cache any answer                                                                     |
| **D2-Q14** | Core event/outbox capability      | defined in source; wiring absent; live state uncertified                                                                         | blocks every Tier-C fact      | **verify governed Core applied-state, then adopt/wire authoritative event/outbox persistence and publication as needed** | Core Phase 6/7      | that a repository migration is a live capability, **or that S3 verified live state**                 |
| **D2-Q15** | signature / trust protocol        | webhook + signed-route **capability** exists                                                                                     | blocks trusted ingestion      | agree a Jarvis trust purpose, domain separation and key model                                                            | D2-Q14, Jarvis D2a  | **that the existing signing domain is reusable**                                                     |

**Nothing above is designed, adopted or implemented here.**

---

## 19. Posture

No Core branch, commit, push or PR. No managed Supabase access. No migration run. No n8n, provider or
Meta access. No message sent. No secret value read or printed. No Jarvis production code, contract,
event registry, event-backbone, ingestion or projection change. **No migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged. S3 awaits owner acceptance on
PR #177.**
