# QFJ-P10 S3 — fresh read-only QuickFurno Core capability audit

**Status:** Read-only audit. **No Core modification, no Supabase access, no n8n/provider access, no
message sent, no migration, no activation.**
**Owning decision:** [ADR-0136](../../decisions/ADR-0136-qfj-p10-s3-fresh-quickfurno-core-audit.md)
**Jarvis baseline:** `eebee71e4e156608e2e04e60802b9d24b33140f5` (merge of PR #176 / ADR-0135)
**Slice:** **S3 / D1** under [ADR-0132](../../decisions/ADR-0132-aarohi-real-execution-integration-planning.md)
and [ADR-0135](../../decisions/ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md).

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

### Method and limits

Read-only detached checkout outside the qf-jarvis tree; static inspection of migrations, services,
routes, libraries and docs. **No branch, commit, push or PR was made in Core. No managed Supabase
connection, no migration run, no seed, no live data.** Where code was insufficient, the finding is
classified `AMBIGUOUS_REQUIRES_D2` rather than settled from live data.

**One checkout limitation, recorded honestly:** six files failed to materialise on Windows for
path-length reasons — five `.png` reference mockups and one `.docx` under
`QuickFurno_Codex_Implementation_Kit/`. **Zero** are in `app/`, `db/`, `lib/`, `services/`,
`supabase/`, `automation/` or `scripts/`, so no audit-relevant file was missed.

---

## 0. Headline

**Core has changed profoundly since the historical audit, and mostly in Jarvis's favour.** The
historical picture — "no communication authority, no event mechanism, no reconciliation" — is
obsolete. At the pinned SHA Core has **101 migrations**, a **unified communication core**, an
**append-only consent-evidence model with a sole decision authority**, a **provider webhook/delivery
trace with signature validation**, a **workflow kernel with `domain_events` and `outbox_events`**, and
— decisively — a **written integration boundary for QF Jarvis**.

**Two findings dominate everything else:**

1. **Core has independently designed the same architecture Jarvis chose.**
   `docs/QF-Jarvis-Integration-Boundary.md` states QuickFurno is the system of record, Jarvis holds no
   authoritative copy, Jarvis submits inert recommendations that authorise nothing, and an approved
   recommendation does **not** bypass the policy engine. **This corroborates Model 2 from the other
   side of the boundary.**
2. **The event transport Model 2 needs is a CONTRACT, not a capability.**
   `lib/events/eventEnvelope.ts` is explicitly _"inert TYPES + METADATA only"_, and the
   `domain_events` / `outbox_events` migration is **committed but UNAPPLIED on the live database**,
   with the envelope **not wired to it**. **This confirms ADR-0135's caution exactly: candidate
   contracts are not adopted Core emissions.**

**Model 2 remains viable. No finding requires reopening ADR-0135.**

---

## 1. Domain A — identity / prospect → vendor continuity

**Classification: `ABSENT` (unchanged from historical GAP A).**

Bounded search across `supabase/migrations`, `services`, `lib` and `app`:

| Term               | Hits                                          |
| ------------------ | --------------------------------------------- |
| `prospect_id`      | **0**                                         |
| `acquisition_case` | **0**                                         |
| `vendor_prospect`  | **0**                                         |
| `prospect_vendor`  | **0**                                         |
| `prospect` (any)   | 4 (incidental prose; no correlation contract) |

`leads.vendor_id` and `lead_assignments` link **client leads to vendors** — a different concept from
vendor-acquisition prospect continuity. There is still **no durable, unique, queryable
pre-registration prospect → final vendor-id correlation**, and no authoritative read exposing one.

**GAP A is unchanged.** An acquisition flow still cannot later read registration/payment/activation
facts for a party it met before registration without guessing.

---

## 2. Domain B — registration

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` for "registration complete"; the auth-account
question is now `AUTHORITATIVE_PRESENT` and settled in the negative.**

`supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql:189`,
`public.handle_new_user()`, creates a `public.profiles` row for a new auth user and its own comment
states it **"Creates no vendor, client, credit, package, verification or assignment state."**

> **Auth account creation is NOT registration.** This is now explicit in Core, not inferred.

`vendors.verification_status` ∈ `('Pending','Verified','Rejected')` and `vendors.status` ∈
`('Pending','Approved','Rejected','Suspended')` exist, but there is still **no readable
registration-process/step/status surface addressable for an unregistered party** — the historical
"registration is a write, with no process read" finding **stands**.

---

## 3. Domain C — payment / package / commercial

**Classification: `AUTHORITATIVE_PRESENT` (constrained), and this is a genuine CHANGE.**

The historical audit recorded `payment_status` / `order_status` / `activation_status` as
_"unconstrained `text` with no CHECK."_ **That is no longer true at the pinned SHA:**

| Field                                                       | Constraint at pinned SHA                          | Source                                                      |
| ----------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `payments.payment_status`, `vendor_packages.payment_status` | `('Pending','Paid','Failed','Refunded')`          | `20260620000001_create_tables.sql:98,112`                   |
| `vendor_package_orders.order_status`                        | `('created','cancelled','expired')`               | `20260701000023_vendor_package_orders.sql:69`               |
| `vendors.package_status`                                    | `('none','active','expired','cancelled','trial')` | `20260630000018_vendor_actions_credits_package_sync.sql:42` |

**Historical finding CHANGED: these are now CHECK-constrained vocabularies rather than free text.**

Still **vendor-id keyed**, so **not prospect-addressable** — that half of the historical finding
stands. And `package_status = 'active'` remains a _package_ fact: **paid ≠ active vendor** (§4).

---

## 4. Domain D — authoritative "this party is live"

**Classification: `ABSENT` as a single fact (unchanged GAP B).**

Three similarly named fields mean three different things, and none is "this party is live as a vendor":

| Field                    | Vocabulary                                | What it actually means                                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| `vendors.status`         | `Pending, Approved, Rejected, Suspended`  | an **approval/moderation** state — **there is still no `ACTIVE` member** |
| `vendors.is_active`      | boolean                                   | a separate enable/disable flag                                           |
| `vendors.package_status` | `none, active, expired, cancelled, trial` | a **commercial package** state, lowercase `active`                       |

`20260620000001_create_tables.sql:41,44` and `20260630000018:42`. There is **no single authoritative
read and no event** meaning "this party is live". **GAP B is unchanged**, and Jarvis's `ACTIVE`
remains an abstraction over a fact Core does not publish.

---

## 5. Domain E — communication authority

**Classification: `AUTHORITATIVE_PRESENT` — and the largest change in the entire audit.**

The historical audit found no Jarvis-facing communication authority. At the pinned SHA Core has a
complete one.

### 5.1 The Communication Core exists

`supabase/migrations/20260708000170_unified_communication_core.sql` creates
`communication_templates`, `communication_messages`, `communication_delivery_events`,
`communication_webhook_receipts`, `communication_automation_catalog`, with security invariants stated
in the migration header: **no plaintext destination column** (only `destination_hash` +
`destination_masked`), no plaintext OTP/token/secret, and `communication_delivery_events` is
**append-only** (`ON DELETE RESTRICT`, service_role gets `SELECT + INSERT` only).

`communication_messages.status` (line 87) is a real lifecycle:

```
queued · dispatching · accepted · sent · delivered · read · failed ·
retry_scheduled · dead_letter · cancelled
```

with `accepted_at`, `sent_at`, `delivered_at`, `read_at`, `failed_at`, `scheduled_at`,
`attempt_count`, `max_attempts`, `next_retry_at`, `provider_message_id`, `idempotency_key` (unique)
and `policy_decision_id`.

### 5.2 Consent, suppression and preference are modelled with evidence

`20260711000200_communication_consent_evidence_and_state_hardening.sql:102` creates
`communication_consent_events` — an evidence table with `target_type` (`preference` | `suppression`),
`channel` (`whatsapp`/`sms`/`rcs`), `scope` (`authentication` | `transactional` | `marketing` |
`global`), `action`, `state_before` / `state_after` (`absent`/`allowed`/`blocked`/`active`/`inactive`),
`reason`, `evidence_type`, `policy_version`, `actor_type`, `source_event_type`/`source_event_id`, and a
64-hex `idempotency_key`.

Alongside it: `communication_preferences` (`state ∈ allowed|blocked`) and
`communication_suppressions` (`destination_hash`, `reason`, active/deactivated, `expires_at`).

STOP/DNC semantics are implemented through inbound consent commands —
`20260712000300_communication_consent_command_writer_rpc.sql`,
`20260713000100_communication_consent_ack_intents.sql`, with
`services/inboundConsentCommandService.ts`, `consentCommandResponseService.ts`,
`consentAckWorkerService.ts`.

### 5.3 There is ONE decision authority, and one enforcement coordinator

`services/communicationConsentDecisionService.ts` (501 lines) is named in Core's own comments as
**"the SOLE read-only consent/suppression DECISION authority."**

`services/outboundConsentEnforcementService.ts` (397 lines) is **"the SOLE OUTBOUND CONSENT
ENFORCEMENT COORDINATOR"**, and its header is directly on point for Jarvis:

> **AUTHORITY.** QuickFurno Core is the sole consent authority. … **CommunicationService, provider
> adapters, Meta, SMS, n8n and Jarvis consume ONLY the closed outcome below** — none of them ever
> sees a disposition, a preference row, or a suppression row.
>
> **CONSENT ≠ SEND AUTHORIZATION.** An `allow` means the CONSENT LAYER passed and nothing more. The
> authentication action, transport policy, auth deadline, transactional basis, template/mapping gate,
> provider runtime gate and canary all remain SEPARATE authorities that must ALSO pass.

**Rejection is machine-readable and closed.** `OutboundConsentDenyCode` includes
`CONSENT_SUPPRESSED`, `CONSENT_NOT_GRANTED`, `UNCLASSIFIED_MESSAGE_TYPE`; plus
`CONSENT_ENFORCEMENT_INVALID`, `CONSENT_AUTHORITY_INTEGRITY` and `CONSENT_AUTHORITY_UNAVAILABLE`.
The outcome is a **discriminated union validated in full** — the file explicitly refuses to trust a
duck-typed `{ kind: "allow" }`.

**Caller-chosen scope is refused.** The input carries no caller-selected consent scope, identity
confidence, principal or policy version: _"A caller that could choose its own scope or claim its own
identity would be interpreting consent. Every one of those is DERIVED here."_

### 5.4 Can Core refuse despite founder/human approval? — YES

`docs/QF-Jarvis-Integration-Boundary.md`: _"**Phase 4 Policy Engine** remains the business
communication authorization authority. An `approved` recommendation does **NOT** bypass it.
Attribution (`decision_source_type = agent`, a logical agent label) authorizes nothing."_

**This independently matches Jarvis's own rule that founder approval never overrides an opt-out.**

### 5.5 Can Jarvis submit a request-equivalent today?

**`CANDIDATE_OR_PROPOSED_ONLY`.** The boundary doc names **Recommendation APIs** (`AgentRecommendation`
/ `CommunicationRecommendation`) as the intended surface, and describes the required chain:

> `agent recommendation → QuickFurno authorization → consent/suppression → channel/provider decision
→ CommunicationService → provider`

but Phase 5F-A explicitly ships **no Jarvis code, no endpoint, no agent role, no service-role grant**.
So the _shape_ is agreed; the _adopted wire protocol_ is not. Whether a `CommunicationAuthorizationV1`
equivalent is returned in a Jarvis-consumable form is **`AMBIGUOUS_REQUIRES_D2`**.

---

## 6. Domain F — candidate event adoptability

**Classification: `CANDIDATE_OR_PROPOSED_ONLY` across the board.**

`lib/events/eventEnvelope.ts:60` defines `CanonicalEventEnvelope` with `eventId`, `eventType`,
`eventVersion`, `occurredAt`, `recordedAt`, `sourceSystem`, `actorType`, `actorId`, `entityType`,
`correlation_id` / `causation_id` / `trace_id`, `risk_level`, `approval_required`, and a sanitized
`safePayload`. Its header is unambiguous:

> PURE, FUTURE-COMPATIBILITY canonical event-envelope CONTRACT **for the future Jarvis integration
> boundary (signed events)**. It is **inert TYPES + METADATA only** … creates no table, no event bus,
> no outbox, no consumer, and no execution path.

| Jarvis candidate                           | Does Core own the fact?                           | Persisted?                                                | Where                                                         | Emission mechanism | Adoption size                                       |
| ------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| `qf.communication.authorization-recorded`  | **YES** — consent decision + policy authorization | **YES** (evidence + decision path)                        | `communication_consent_events`, decision/enforcement services | **none wired**     | **medium** — the fact exists; the emission does not |
| `qf.communication.result-recorded`         | **YES** — provider outcomes                       | **YES**                                                   | `communication_messages`, `communication_delivery_events`     | **none wired**     | **medium**                                          |
| `qf.communication.human-handoff-requested` | **not found** as a Core-recorded Jarvis artifact  | —                                                         | —                                                             | —                  | **blocked by missing truth**                        |
| `qf.communication.human-handoff-recorded`  | **not found**                                     | —                                                         | —                                                             | —                  | **blocked by missing truth**                        |
| `qf.execution.intent-issued`               | partially — see §8                                | `outbox_events` (unapplied)                               | —                                                             | **none wired**     | **blocked / ambiguous**                             |
| `qf.execution.result-recorded`             | **YES**                                           | `communication_delivery_events`, automation attempt state | **none wired**                                                | **medium**         |
| `qf.communication.state-recorded@2`        | compatibility/history only                        | —                                                         | —                                                             | —                  | **not proposed for adoption**                       |

**No event was adopted or implemented by this audit.**

---

## 7. Domain G — event / outbox / reconciliation capability

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` — the machinery exists in the repository and is
UNAPPLIED on the live database.**

`supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql` defines:

- **`domain_events`** (line 119) — `event_type`, `entity_type/id`, `payload_version`, `payload_json`,
  `trace_id`, `correlation_id`, `causation_id`, `idempotency_key` (unique, partial),
  `processing_status ∈ pending|processing|processed|failed|dead_letter`. Its own comment says
  _"for **future** QuickFurno workflow processing."_
- **`outbox_events`** (line 163) — a **transactional outbox** with `command_type`, `payload_json`,
  `idempotency_key`, `status ∈ pending|processing|sent|completed|retry_scheduled|failed|dead_letter|cancelled`,
  `attempt_count`/`max_attempts` (bounded by CHECK), `next_retry_at`, `locked_at`/`locked_by`,
  `sent_at`, `completed_at`, `last_error`.

Writers exist in code (`lib/aos/workflow/domainEventService.ts`, `outboxService.ts`,
`lib/events/eventEnvelope.ts`, `services/inboundWhatsAppMessageService.ts`).

**But the boundary doc states plainly that this migration is UNAPPLIED on the live database and the
envelope is NOT wired to it**, and that canonical persistence is deferred.

| Question                               | Finding                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reusable authoritative event emission? | **capability present, not applied**                                                                                                                            |
| Transactional outbox?                  | **YES, defined** (`outbox_events`), unapplied                                                                                                                  |
| Durable-before-publish?                | the outbox shape supports it; **not proven live**                                                                                                              |
| Retry / idempotency?                   | **YES** — bounded attempts, `next_retry_at`, unique `idempotency_key`; plus a global `idempotency_records` table                                               |
| Current **Core → Jarvis** protocol     | **ABSENT** (contract only)                                                                                                                                     |
| Current **Jarvis → Core** protocol     | **ABSENT** (recommendation APIs named, not built)                                                                                                              |
| Current **Core → n8n** protocol        | **PARTIALLY PRESENT** — signed automation transport routes exist (§8)                                                                                          |
| Current **n8n → Core** result protocol | **PARTIALLY PRESENT** — webhook receipts + delivery events (§12)                                                                                               |
| Signing mechanism                      | **PRESENT** — `communication_webhook_receipts.signature_valid` gates de-duplication; automation recovery/reconcile routes are described as **signed requests** |

Core's own roadmap in the boundary doc places this work: **Phase 5F-A** pure contract (current) →
**Phase 6** canonical event taxonomy → **Phase 7** signed integration/execution delivery and the n8n
execution fabric → later canonical persistence.

---

## 8. Domain H — `execution-submitted` / dispatch

**Classification: `AMBIGUOUS_REQUIRES_D2` — but materially better than Jarvis assumed.**

ADR-0135 locked _issuance ≠ dispatch_ and left the evidence unresolved. Core **does** now distinguish
dispatch phases, in two places:

- `outbox_events.status`: `pending → processing → sent → completed`, plus `retry_scheduled`, `failed`,
  `dead_letter`, `cancelled`, with **`sent_at` distinct from `completed_at`**.
- `communication_messages.status`: `queued → dispatching → accepted → sent → …`, with `accepted_at`
  and `sent_at` distinct.

So Core **can** distinguish _created_ / _dispatch-attempted_ (`processing`, `dispatching`) /
_dispatch-accepted_ (`sent`, `accepted`) / _dispatch-failed_ (`failed`, `dead_letter`).

**What remains unresolved:** no event is emitted at any of those transitions (§7), and this dispatch
model belongs to Core's **automation/communication** transport — it is **not** an
`ExecutionIntentV1`-shaped Core → n8n intent issuance. Whether Jarvis's `execution-submitted` should
bind to `communication_messages.status = 'dispatching'/'accepted'`, to an outbox `sent`, or to a
future Phase-7 signed dispatch fact is **a D2 decision, not an audit finding**.

**No dispatch event name is invented here.**

---

## 9. Domain I — cancellation

**Classification: `PRESENT_BUT_NOT_AUTHORITATIVE` — and this is a genuine CHANGE.**

ADR-0134 recorded that **no canonical artifact could evidence a pre-execution cancellation**. At the
pinned SHA, Core has cancellation _state_ in three places:

- `communication_messages.status` includes **`cancelled`** (line 87);
- `outbox_events.status` includes **`cancelled`** (line 181 constraint);
- `vendor_package_orders.order_status` includes `cancelled`.

**What is still missing:** a canonical **event** or Jarvis-readable **result** proving cancellation,
and an audited actor/reason for the cancellation itself. So the _fact_ now exists in Core's tables; the
_evidence surface_ Jarvis would consume does not.

**This is the single most improved gap since ADR-0134**, and it is a direct D2 input.

---

## 10. Domain J — expiry

**Classification: `AMBIGUOUS_REQUIRES_D2`.**

Expiry vocabulary exists — `vendor_package_orders.order_status = 'expired'`,
`vendors.package_status = 'expired'`, `communication_suppressions.expires_at`,
`password_reset_grants`, and authentication deadline handling in the transport-policy services. But
**no durable communication/execution expiry record with an owning clock** was found, and nothing
establishes that expiry is a _recorded outcome_ rather than a computed comparison.

**Jarvis must not infer authoritative expiry from `now > expires_at`.** The authoritative expiry fact
for a communication or an execution intent remains **undetermined**, exactly as ADR-0135 left it.

---

## 11. Domain K — channel semantics

**Classification: `AUTHORITATIVE_PRESENT`, with a constrained vocabulary — and a live constraint
Jarvis must note.**

- `communication_templates.channel` and `communication_messages.channel` are **`check (channel =
'whatsapp')`** — a single-channel constraint at this SHA.
- `communication_consent_events.channel` ∈ `('whatsapp','sms','rcs')`.
- Enforcement is explicitly per-channel: _"A WhatsApp decision NEVER authorizes an SMS send — the
  channel is part of the decision input."_ RCS is excluded from the enforcement path (no send path).
- A separate SMS path exists (`runtimeSmsAdapterFactory`, `smsProviderSelection`, Exotel integration).

**Core can refuse before any channel authorization** (consent decision precedes channel/provider
decision in the documented chain). **Whether Core may switch channel is `AMBIGUOUS_REQUIRES_D2`** —
the messages table pins `whatsapp`, while consent models three channels.

**No V2 `channel` shape is chosen here** — this is exactly the input ADR-0135 §8.3 deferred.

---

## 12. Domain M — provider result / reconciliation

**Classification: `AUTHORITATIVE_PRESENT` for the state distinctions; `PRESENT_BUT_NOT_AUTHORITATIVE`
for Core → Jarvis reconciliation.**

`communication_delivery_events.normalized_event_type` ∈ **`accepted, sent, delivered, read, failed`**
(line 139), append-only, one trace row per `(provider, provider_event_id, provider_message_id,
normalized_event_type)`.

> **`provider-accepted` IS distinct from `delivered` in Core's schema.** Jarvis's core distinction is
> independently mirrored.

`communication_webhook_receipts` de-duplicates on `(provider, provider_event_id)` and on
`(provider, payload_hash)`, **partitioned by `signature_valid`** so a forged body can never occupy a
legitimate redelivery's slot.

Reconciliation services exist: `services/campaignCommunicationResultService.ts` (_"the Core-owned
boundary that lets QF-MVP-50 reconcile a campaign communication INTENT from its canonical
communication MESSAGE"_) and `services/automationRecoveryService.ts` (`recover_v1` / `reconcile_v1`,
each _"driven by its own signed request"_).

**But there is still no Core → Jarvis reconciliation event or contract.** The historical
"reconciliation absent" finding is **partly changed**: reconciliation now exists _inside Core_; the
_Jarvis-facing_ channel does not.

Mapping to Jarvis's eighteen states: Core can distinguish `accepted`/`sent`/`delivered`/`read`/`failed`
and `cancelled`; it does **not** model `answered`, `no-answer` or `busy` (no voice path at this SHA),
and `completed` has no distinct Core representation.

---

## 13. Domain L — Tier A/B durable coordination evidence (D2b input)

ADR-0135 left four Tier A/B states with **no durable ordered replay source** and one CONDITIONAL.
Current Core evidence:

| Jarvis state              | Core primitive recording the Jarvis act?                                                                                           | Could it cross the boundary as receipt/occurrence?                                                | Finding                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `draft`                   | **none**                                                                                                                           | a draft is pre-submission by definition — Core has nothing to record                              | **stays Jarvis-local or ephemeral.** ADR-0135 Option C is the natural fit; **not chosen here**      |
| `authorization-requested` | **none adopted** — the boundary doc names Recommendation APIs, unbuilt                                                             | **yes, in principle** — this is exactly the _"agent recommendation"_ step of the documented chain | **CANDIDATE**, needs D2 protocol adoption                                                           |
| `scheduled`               | **partial** — `communication_messages.scheduled_at` exists, with a constraint that an ephemeral destination can never be scheduled | **yes**, if Jarvis's schedule becomes a Core-recorded message                                     | **CANDIDATE**, needs D2                                                                             |
| `follow-up-requested`     | **none found** — no follow-up/task record tying a new request to a prior outcome                                                   | —                                                                                                 | **ABSENT**                                                                                          |
| `human-handoff-required`  | **none found** in Core (no handoff table or service)                                                                               | —                                                                                                 | **downgraded**: Jarvis's `qf.communication.human-handoff-requested` has **no Core-side fact today** |

**Bounded absence:** no `handoff` table appears in the 101-migration table inventory, and no handoff
service exists among the 89 services.

> **Correction to an ADR-0135 assumption, in Jarvis's favour to know now:** ADR-0135 treated
> `human-handoff-required` as the **most** likely Tier-B candidate because a canonical _contract_
> exists in `@qf-jarvis/contracts`. This audit finds **no corresponding Core fact at the pinned SHA**,
> so its adoption is **blocked by missing truth**, not merely unadopted. Meanwhile `scheduled` and
> `authorization-requested` — which ADR-0135 rated UNRESOLVED — have the **clearer** Core-side path.
> **This reorders D2b's candidates; it does not change Model 2.**

**No ADR-0135 Option A/B/C is chosen here.**

---

## 14. Domain N — execution-time eligibility

**Classification: `AUTHORITATIVE_PRESENT` inside Core; `ABSENT` as an adopted Jarvis/n8n-facing
protocol.**

Core **can** authoritatively re-check consent, suppression, scope and channel immediately before
dispatch — that is precisely what `outboundConsentEnforcementService` does, and it fails closed on
`CONSENT_AUTHORITY_UNAVAILABLE`. Frequency/attempt limits exist
(`communicationFrequencyPolicyService.ts`, `20260728001600_qf_mvp_frequency_policy_history_hardening`).

**Quiet hours:** not found as an explicit named control at this SHA — `AMBIGUOUS_REQUIRES_D2`.

**Can n8n or a runtime ask Core?** No adopted protocol. The signed automation routes are Core-owned
recovery/reconcile lanes, not an eligibility query surface. **S6 is not designed here.**

---

## 15. Domain O — security / trust

**Classification: `PRESENT`, capability only — no secret value was read or printed.**

- **Webhook signature verification exists** and is load-bearing:
  `communication_webhook_receipts.signature_valid` partitions the de-duplication indexes, so an
  unsigned or forged body _cannot_ occupy a legitimate redelivery's slot.
- **Signed internal requests exist** for the automation recovery/reconcile routes.
- **Provider account binding** is required for delivery events and consent-ack intents
  (`20260720000100`, `20260721000100`).
- **RLS is deny-all for API roles** on communication tables, with least-privilege `service_role`
  grants; delivery events get `SELECT + INSERT` only.
- **No agent is a database role.** The boundary doc states the logical agent labels — including
  `qf_jarvis` — are _"not Supabase users, not PostgreSQL roles, not service-role identities, and not
  provider credentials."_

**Unsigned current routes are not Jarvis authority**, and none was treated as such.

---

## 16. Historical delta table

| #   | Question                          | Historical @`06b1e22`                                | Current @`af7c2bb`                                                                 | Changed?              | Impact                               |
| --- | --------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- | ------------------------------------ |
| 1   | prospect ↔ vendor correlation     | absent                                               | **absent** (bounded search, §1)                                                    | **NO**                | GAP A stands                         |
| 2   | registration-process read         | write-only; no process read                          | **still no process read**; auth ≠ registration now explicit                        | **partly**            | GAP stands, better documented        |
| 3   | payment / prospect addressability | unconstrained text; vendor-id keyed                  | **CHECK-constrained**; still vendor-id keyed                                       | **YES (constraints)** | prospect-addressability still absent |
| 4   | authoritative party-live fact     | no ACTIVE status                                     | **still none**; three distinct "active-ish" fields                                 | **NO**                | GAP B stands                         |
| 5   | package / commercial truth        | authoritative read, adopted                          | unchanged + constrained                                                            | minor                 | fine                                 |
| 6   | execution-time eligibility        | Communication Core authoritative, no Jarvis protocol | **Communication Core now EXISTS in Core**, fails closed; still no adopted protocol | **YES (major)**       | S6 far more tractable                |
| 7   | execution authorization protocol  | contracts exist, wire PROPOSED                       | **still proposed**; Core boundary doc agrees on shape                              | **partly**            | D2 input                             |
| 8   | result reconciliation             | absent                                               | **exists inside Core**; no Core → Jarvis channel                                   | **YES (partly)**      | D2 input                             |
| 9   | communication authorization       | not audited as a Core capability                     | **sole decision authority + closed enforcement outcome**                           | **YES (major)**       | Model 2 corroborated                 |
| 10  | Core event / outbox               | not audited historically                             | **defined, UNAPPLIED, not wired**                                                  | **NEW**               | confirms ADR-0135                    |
| 11  | dispatch evidence                 | NOT AUDITED HISTORICALLY                             | phase distinctions exist; no event                                                 | **NEW**               | §8, D2                               |
| 12  | cancellation evidence             | NOT AUDITED HISTORICALLY                             | **state exists**; no event/result                                                  | **NEW**               | §9, D2                               |
| 13  | expiry evidence                   | NOT AUDITED HISTORICALLY                             | vocabulary only; no owning clock                                                   | **NEW**               | §10, unresolved                      |
| 14  | Tier A/B recording options        | NOT AUDITED HISTORICALLY                             | handoff absent; scheduled/request clearer                                          | **NEW**               | §13, reorders D2b                    |
| 15  | channel semantics                 | NOT AUDITED HISTORICALLY                             | messages pinned `whatsapp`; consent 3 channels                                     | **NEW**               | §11, D2                              |

---

## 17. Model 2 check

**Model 2 remains VIABLE. No ADR-0135 reopen is required.**

Positive corroboration, from Core's own words:

- _"QuickFurno remains the system of record … Jarvis holds no authoritative copy."_ → matches Model 2's
  local-view rule.
- _"A recommendation is inert data; it authorizes nothing."_ → matches S1's powerless request.
- _"An `approved` recommendation does NOT bypass [the Policy Engine]."_ → matches _founder approval
  does not override an opt-out_.
- _"n8n remains the execution fabric, not the second brain."_ → matches the execution boundary.
- Consent decision is a **sole authority** with a **closed, machine-readable** outcome → matches
  `CommunicationAuthorizationV1`'s intent.

Constraints confirmed rather than contradicted:

- Candidate contracts are **not** live Core emissions → **ADR-0135 §2 was right**.
- `execution-submitted` evidence stays unresolved → **ADR-0135 §8 was right**.
- Tier A/B durable sources are still not settled → **ADR-0135 §8a was right**; only the _ranking_ of
  candidates changes (§13).

**One item for owner attention, not a reopen:** ADR-0135 named
`qf.communication.human-handoff-requested` the leading Tier-B candidate. This audit finds no Core-side
handoff fact at the pinned SHA, so that candidate is **blocked by missing truth** while `scheduled`
and `authorization-requested` look more tractable. That is a **D2b input reordering**, fully inside
ADR-0135's stated "conditional on S3" framing.

---

## 18. D2 decision queue

| #          | Question                                        | Finding                                   | Why it blocks                         | Smallest future decision                               | Depends on          | Must NOT assume                                           |
| ---------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------------------ | ------------------- | --------------------------------------------------------- |
| **D2-Q1**  | prospect ↔ vendor continuity                    | `ABSENT`                                  | GAP A blocks S8                       | adopt one durable correlation fact at registration     | Core work           | that `leads.vendor_id` is acquisition continuity          |
| **D2-Q2**  | registration completion                         | no process read                           | blocks continuation                   | adopt a readable registration-completion fact          | Core work           | that an auth user is a registered vendor                  |
| **D2-Q3**  | payment / prospect addressability               | constrained, vendor-keyed                 | blocks pre-registration payment reads | decide whether a prospect-addressable read can exist   | D2-Q1               | that paid ⇒ active                                        |
| **D2-Q4**  | authoritative party-live fact                   | `ABSENT`                                  | GAP B blocks S9                       | adopt one "party is live" fact                         | Core work           | that `package_status='active'` or `is_active` means live  |
| **D2-Q5**  | communication authorization submission/response | shape agreed, protocol unbuilt            | blocks S4                             | adopt the recommendation → authorization wire protocol | Core Phase 6/7      | that the enforcement outcome is already Jarvis-consumable |
| **D2-Q6**  | adopted authorization/result primitive events   | `CANDIDATE_ONLY`                          | blocks Tier-C projection              | choose which primitives Core emits first               | D2-Q14              | that a contract implies an emission                       |
| **D2-Q7**  | dispatch / submission evidence                  | `AMBIGUOUS`                               | blocks `execution-submitted`          | bind the state to a named Core dispatch fact           | D2-Q6, Core Phase 7 | that `intent-issued` proves dispatch                      |
| **D2-Q8**  | cancellation evidence                           | state exists, no event                    | blocks `cancelled`                    | expose the existing cancellation state as a fact       | D2-Q6               | that a status column is a canonical event                 |
| **D2-Q9**  | expiry evidence                                 | vocabulary only                           | blocks `expired`                      | identify the owning clock and the recorded outcome     | Core work           | that `now > expires_at` is authoritative                  |
| **D2-Q10** | Tier A/B durable evidence + ordering            | handoff absent; scheduled/request clearer | blocks D2b, D3, D5                    | pick ADR-0135 Option A/B/C per state                   | D2-Q5, D2-Q6        | that a Jarvis contract implies a Core fact                |
| **D2-Q11** | channel semantics                               | messages pinned `whatsapp`                | blocks V2 `channel`                   | decide proposed vs authorized representation           | D2-Q5               | that Core will always name a channel                      |
| **D2-Q12** | provider-result reconciliation                  | internal only                             | blocks S7                             | adopt a Core → Jarvis reconciliation event             | D2-Q6               | that internal reconciliation reaches Jarvis               |
| **D2-Q13** | execution-time eligibility                      | present, unexposed                        | blocks S6                             | decide whether n8n/runtime may query Core              | D2-Q5               | that Jarvis may cache any answer                          |
| **D2-Q14** | Core event/outbox transport capability          | defined, **UNAPPLIED**                    | blocks every Tier-C fact              | apply and wire the canonical persistence target        | Core Phase 6/7      | that an unapplied migration is a capability               |
| **D2-Q15** | signature / trust protocol                      | webhook + signed-route capability exists  | blocks trusted ingestion              | agree the Core → Jarvis signing purpose and key model  | D2-Q14, Jarvis D2a  | that existing webhook signing is the Jarvis protocol      |

**Nothing above is designed, adopted or implemented here.**

---

## 19. Posture

No Core branch, commit, push or PR. No managed Supabase access. No migration run. No n8n, provider or
Meta access. No message sent. No secret value read or printed. No Jarvis production code, contract,
event registry, event-backbone, ingestion or projection change. **No migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
