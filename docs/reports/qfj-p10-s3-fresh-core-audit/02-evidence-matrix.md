# QFJ-P10 S3 — Core evidence index

**Companion to** [01-current-core-capability-audit.md](./01-current-core-capability-audit.md).
**All rows are read from one pinned commit. Nothing here was executed, applied or mutated.**

|                |                                                                                |
| -------------- | ------------------------------------------------------------------------------ |
| Repository     | `quickfurno-maker/quickfurno-marketplace`                                      |
| **Pinned SHA** | **`af7c2bb4f5a83731666fe059e963d1824cddd7b6`**                                 |
| Branch at pin  | `main`                                                                         |
| Method         | read-only detached checkout outside the qf-jarvis tree; static inspection only |

---

## 1. Evidence index

| #   | File path (@ pinned SHA)                                                                        | Symbol / table / migration                                | Finding                                                                                                                               | Classification                     |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| E1  | `docs/QF-Jarvis-Integration-Boundary.md`                                                        | whole doc, 102 lines                                      | Core has a written Jarvis boundary: system of record, inert recommendations, approval requests, signed events, controlled action APIs | `CANDIDATE_OR_PROPOSED_ONLY`       |
| E2  | `docs/QF-Jarvis-Integration-Boundary.md` §"Authority boundaries"                                | Phase 4 Policy Engine                                     | _"An `approved` recommendation does NOT bypass it"_                                                                                   | `AUTHORITATIVE_PRESENT`            |
| E3  | `docs/QF-Jarvis-Integration-Boundary.md` §"Event persistence (deferred)"                        | roadmap                                                   | 5F-A contract → Phase 6 taxonomy → Phase 7 signed delivery → later persistence                                                        | `CANDIDATE_OR_PROPOSED_ONLY`       |
| E4  | `lib/events/eventEnvelope.ts:60`                                                                | `CanonicalEventEnvelope`                                  | canonical envelope for the future Jarvis boundary; _"inert TYPES + METADATA only"_                                                    | `CANDIDATE_OR_PROPOSED_ONLY`       |
| E5  | `supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql:119`               | `public.domain_events`                                    | durable domain events, idempotency-keyed; _"for future … processing"_; **UNAPPLIED live**                                             | `PRESENT_BUT_NOT_AUTHORITATIVE`    |
| E6  | `…20260706000146…sql:163,181`                                                                   | `public.outbox_events`                                    | transactional outbox; status `pending→processing→sent→completed`, `cancelled`; bounded attempts                                       | `PRESENT_BUT_NOT_AUTHORITATIVE`    |
| E7  | `supabase/migrations/20260708000170_unified_communication_core.sql` header                      | 5-table communication core                                | no plaintext destination; append-only delivery trace; least-privilege grants                                                          | `AUTHORITATIVE_PRESENT`            |
| E8  | `…20260708000170…sql:87`                                                                        | `communication_messages.status`                           | `queued, dispatching, accepted, sent, delivered, read, failed, retry_scheduled, dead_letter, cancelled`                               | `AUTHORITATIVE_PRESENT`            |
| E9  | `…20260708000170…sql:139`                                                                       | `communication_delivery_events.normalized_event_type`     | `accepted, sent, delivered, read, failed` — **accepted ≠ delivered**                                                                  | `AUTHORITATIVE_PRESENT`            |
| E10 | `…20260708000170…sql` (webhook receipts)                                                        | `communication_webhook_receipts`                          | de-dup partitioned by `signature_valid`                                                                                               | `AUTHORITATIVE_PRESENT`            |
| E11 | `supabase/migrations/20260711000200_communication_consent_evidence_and_state_hardening.sql:102` | `communication_consent_events`                            | append-only consent evidence: scope, action, state_before/after, reason, policy_version, idempotency                                  | `AUTHORITATIVE_PRESENT`            |
| E12 | `…20260711000200…sql:289,302,372,383`                                                           | `communication_preferences`, `communication_suppressions` | preference `state` is either allowed or blocked; suppression carries destination_hash, expiry and deactivation                        | `AUTHORITATIVE_PRESENT`            |
| E13 | `services/communicationConsentDecisionService.ts` (501 lines)                                   | `decideCommunicationConsent`                              | _"the SOLE read-only consent/suppression DECISION authority"_                                                                         | `AUTHORITATIVE_PRESENT`            |
| E14 | `services/outboundConsentEnforcementService.ts` (397 lines)                                     | enforcement coordinator                                   | _"CommunicationService, provider adapters, Meta, SMS, n8n and Jarvis consume ONLY the closed outcome"_                                | `AUTHORITATIVE_PRESENT`            |
| E15 | `services/outboundConsentEnforcementService.ts:70–81`                                           | `OutboundConsentDenyCode`, `OutboundConsentOutcome`       | closed machine-readable codes; `CONSENT_SUPPRESSED`, `CONSENT_NOT_GRANTED`, …, `CONSENT_AUTHORITY_UNAVAILABLE`                        | `AUTHORITATIVE_PRESENT`            |
| E16 | `services/outboundConsentEnforcementService.ts` header                                          | consent ≠ send authorization                              | an `allow` is the consent layer only; transport/deadline/template/runtime remain separate                                             | `AUTHORITATIVE_PRESENT`            |
| E17 | `supabase/migrations/20260620000001_create_tables.sql:41,44`                                    | `vendors.status`, `vendors.is_active`                     | `Pending, Approved, Rejected, Suspended` + separate boolean — **no ACTIVE member**                                                    | `ABSENT` (as a live fact)          |
| E18 | `supabase/migrations/20260630000018_vendor_actions_credits_package_sync.sql:42`                 | `vendors.package_status`                                  | `none, active, expired, cancelled, trial` — a **package** fact                                                                        | `PRESENT_BUT_NOT_AUTHORITATIVE`    |
| E19 | `supabase/migrations/20260620000001_create_tables.sql:98,112`                                   | `payment_status`                                          | now CHECK-constrained `Pending, Paid, Failed, Refunded` — **historical delta**                                                        | `AUTHORITATIVE_PRESENT`            |
| E20 | `supabase/migrations/20260701000023_vendor_package_orders.sql:69`                               | `order_status`                                            | now CHECK-constrained `created, cancelled, expired` — **historical delta**                                                            | `AUTHORITATIVE_PRESENT`            |
| E21 | `supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql:189`                | `public.handle_new_user()`                                | _"Creates no vendor, client, credit, package, verification or assignment state"_                                                      | `AUTHORITATIVE_PRESENT`            |
| E22 | `services/campaignCommunicationResultService.ts` header                                         | campaign result reconciler                                | Core-owned reconciliation of intent from canonical message; explicitly not an n8n route                                               | `AUTHORITATIVE_PRESENT` (internal) |
| E23 | `services/automationRecoveryService.ts` header                                                  | `recover_v1`, `reconcile_v1`                              | two lanes, each _"driven by its own signed request"_                                                                                  | `AUTHORITATIVE_PRESENT` (internal) |
| E24 | `supabase/migrations/` (101 files)                                                              | table inventory                                           | 100+ tables incl. `idempotency_records`, `workflow_instances`, `communication_*`                                                      | context                            |

**Line numbers are from the pinned checkout.** Where a claim rests on a file header rather than a
single line, the symbol and file are cited instead.

---

## 2. Static migration audit (no execution)

| Aspect               | Observation                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrations           | **101** in `supabase/migrations/`, plus 7 legacy files in `db/`                                                                                                                                                    |
| Tables               | 100+ created via `create table if not exists public.*`                                                                                                                                                             |
| CHECK / enums        | extensively used — communication status, consent scope/action/state, package/payment/order status, outbox status                                                                                                   |
| Uniqueness / FKs     | `communication_messages.idempotency_key` unique; delivery-event uniqueness per `(provider, event, message, type)`; webhook de-dup partitioned on `signature_valid`; `domain_events.idempotency_key` unique partial |
| RLS / policies       | communication tables: RLS enabled, anon/authenticated revoked (deny-all), least-privilege `service_role` grants                                                                                                    |
| Grants / roles       | delivery events: `SELECT + INSERT` only — no update/delete path                                                                                                                                                    |
| Functions / triggers | `handle_new_user()` onboarding trigger; consent command writer RPCs; workflow-kernel atomic step functions                                                                                                         |
| **Applied to live?** | **`domain_events` / `outbox_events` are explicitly UNAPPLIED on the live database** (E1/E3). No other applied-state claim is made — this audit read files, not a database.                                         |

**No migration was run. No managed Supabase connection was opened. No seed, reset or provisioning
script was executed.**

---

## 3. Bounded absence proofs

Each searched across `supabase/migrations`, `services`, `lib` and `app`, with synonyms.

| Claim                            | Terms searched                                                                            | Hits                         | Conclusion |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| No prospect ↔ vendor correlation | `prospect_id`, `acquisition_case`, `vendor_prospect`, `prospect_vendor`, `prospect`       | 0 / 0 / 0 / 0 / 4 incidental | **ABSENT** |
| No Core human-handoff fact       | `handoff` across the 101-migration table inventory and the 89-service list                | no table, no service         | **ABSENT** |
| No dispatch-only event           | `dispatch` in `packages`-equivalent event catalog (`lib/events`, `domain_events` writers) | no dispatch event type       | **ABSENT** |
| No Core → Jarvis event channel   | `eventEnvelope` consumers, outbox publishers to an external system                        | contract only, no consumer   | **ABSENT** |

An `ABSENT` row means _not found by these bounded searches at this SHA_ — not that it can never exist.

---

## 4. What this index deliberately does not do

It does not adopt an event, name a protocol, propose a schema, choose an ADR-0135 option, or classify
anything from live data. Every ambiguity is left as `AMBIGUOUS_REQUIRES_D2` in the main report.
