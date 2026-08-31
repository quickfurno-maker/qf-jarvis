# ADR-0136 — QFJ-P10 S3 fresh QuickFurno Core audit

**Status:** **Proposed** — read-only audit on a feature branch, **PR #177 open, NOT merged**.
**S3 is presented for owner acceptance; it is not delivered, complete or closed.** If PR #177 is
merged, **D2** becomes the next execution step.
**Date:** 2026-08-31
**Phase ownership:** **QFJ-P10** (Core integration and reconciliation). Slice **S3** of
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md), step **D1** of
[ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md). **No new phase
is created. There is no QFJ-P13 and no AVG-13.**
**Jarvis baseline:** `eebee71e4e156608e2e04e60802b9d24b33140f5` (merge of PR #176)
**Pinned Core commit:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6`
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0134](./ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md),
[ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md) — **both are
locked input** — plus [ADR-0125](./ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md),
[ADR-0126](./ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md),
[ADR-0127](./ADR-0127-qfj-p12-avg10-aarohi-payment-activation-handoff-offline-domain.md) (the
historical audit) and [communication-model.md](../architecture/communication-model.md).

Report: [01-current-core-capability-audit.md](../reports/qfj-p10-s3-fresh-core-audit/01-current-core-capability-audit.md) ·
Evidence: [02-evidence-matrix.md](../reports/qfj-p10-s3-fresh-core-audit/02-evidence-matrix.md).

---

## Context

ADR-0132 made a fresh read-only Core audit a hard prerequisite for every Core-dependent slice, and
ADR-0135 made it **D1 — the next execution step**, because `cancelled`, `expired`,
`execution-submitted` and the Tier A/B durable evidence sources were all unresolved, and because
freezing `CommunicationStateRecordV2` before re-auditing Core would encode assumptions.

The historical audit (ADR-0125/0126/0127) was taken at marketplace commit `06b1e22…` and was retained
as **historical evidence, never a current certification**. This ADR supplies the current facts.

**S3 supplies Core facts. It does not redesign the solution.**

## Decision

### 1. One Core commit, pinned once

`quickfurno-maker/quickfurno-marketplace`, branch `main`, resolved once at audit start
(`2026-08-31T03:38:05Z`) and pinned at **`af7c2bb4f5a83731666fe059e963d1824cddd7b6`**
(_"Merge pull request #51 from quickfurno-maker/mvp/qf-mvp-80-02-gate06-repair"_,
`2026-08-30T15:19:52Z`). Every finding is read from that SHA only, by static inspection of a read-only
detached checkout outside the qf-jarvis tree.

**No Core branch, commit, push or PR. No managed Supabase access. No migration run. No n8n, provider
or Meta access. No message sent. No secret value read or printed.**

### 2. Core has changed substantially, and much of it was never audited before

At the pinned SHA Core has **101 migrations**, a **unified communication core**, an **append-only
consent-evidence model with a sole consent decision authority and a closed consent enforcement
outcome**, a **signature-gated provider webhook and append-only delivery trace**, a **workflow kernel
defining `domain_events` and `outbox_events`**, and a **written QF Jarvis integration boundary**.

**The historical audit did NOT say communication authority was absent.** It recorded that
execution-time eligibility authority belonged to the **QuickFurno Communication Core / QF
Communications Runtime**, with **no adopted Jarvis-facing protocol**. What was never audited is the
**concrete Core implementation**, which is now visible; **Core event/outbox and Core → Jarvis
reconciliation were NOT AUDITED HISTORICALLY**. This report separates genuinely changed
previously-audited findings (**3**) from unchanged ones (**4**) and newly audited domains (**8**), and
never phrases a newly audited domain as a historical absence.

### 3. Core independently describes the same architecture Jarvis chose

`docs/QF-Jarvis-Integration-Boundary.md` states, in Core's own words: QuickFurno is the **system of
record** and _"Jarvis holds no authoritative copy"_; Jarvis submits **recommendations** that are
_"inert data"_ and _"authorize nothing"_; _"an `approved` recommendation does **NOT** bypass"_ the
policy engine; _"n8n remains the execution fabric, not the second brain"_; and the required chain is
`agent recommendation → QuickFurno authorization → consent/suppression → channel/provider decision →
CommunicationService → provider`.

`services/outboundConsentEnforcementService.ts` names Jarvis explicitly as a consumer of **one closed
authorization outcome**, and states **consent ≠ send authorization**.

**Model 2 is corroborated from the other side of the boundary.**

### 4. The transport Model 2 needs is a CONTRACT, not a capability

`lib/events/eventEnvelope.ts` is _"inert TYPES + METADATA only"_ and is **definitively NOT WIRED** to
`domain_events` / `outbox_events` at the pinned code. **Core's own boundary documentation states that
migration is unapplied on the live database — S3 did not query live schema and does not independently
certify managed applied-state.** Three statements are kept apart: **schema definition PRESENT in
source**, **envelope wiring definitively ABSENT**, **live applied-state `AMBIGUOUS_REQUIRES_D2`
(Core documentation says unapplied)**. Core's roadmap places signed integration delivery at **Phase
7**, after a Phase 6 event taxonomy.

**This confirms ADR-0135 §2: candidate contracts are not adopted Core emissions.** Nothing in this
audit adopts, implements or schedules an event.

### 5. Findings that move a locked question

| Question                               | Movement                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consent / suppression authority**    | historically **authority already assigned to the Communication Core, implementation never audited** → now visible and **`AUTHORITATIVE_PRESENT`** in the consent scope: sole decision authority, closed machine-readable consent codes, fails closed. **Consent ≠ send authorization** — full business authorization is `PRESENT_BUT_NOT_AUTHORITATIVE`, and no Jarvis-facing authorization artifact is established |
| **`cancelled`**                        | ADR-0134 _no artifact_ → **vocabulary exists**, plus ONE consent-deny terminalization writer. **No cancellation operation exists** (`cancelCommunication`: 0 hits; no cancel route). **Core's `cancelled` currently means consent refusal — which is Jarvis's `rejected`, not Jarvis's `cancelled`**                                                                                                                |
| **`provider-accepted` vs `delivered`** | → **independently mirrored** in `communication_delivery_events.normalized_event_type`                                                                                                                                                                                                                                                                                                                               |
| **Dispatch phases**                    | → Core **can** distinguish created / attempted / accepted / failed in its automation-communication transport; **no event emitted**, and **no ExecutionIntent semantic exists in Core at all** (5 term variants, 0 hits)                                                                                                                                                                                             |
| **Payment / order status**             | historical _unconstrained text_ → **CHECK-constrained vocabularies**                                                                                                                                                                                                                                                                                                                                                |
| **Auth account ≠ registration**        | → now **explicit** in `handle_new_user()`'s own comment                                                                                                                                                                                                                                                                                                                                                             |

### 6. Findings that do NOT move

- **GAP A** — no prospect ↔ vendor correlation. Bounded search: `prospect_id`, `acquisition_case`,
  `vendor_prospect`, `prospect_vendor` all **zero hits**.
- **GAP B** — no authoritative "this party is live". `vendors.status` still has **no `ACTIVE`
  member**; `is_active` and `package_status` mean different things.
- **No registration-process read** for an unregistered party.
- **No Core → Jarvis reconciliation channel** — reconciliation exists _inside_ Core only.
- **`expired`** — vocabulary exists, but no durable expiry record with an owning clock.
  **`now > expires_at` remains non-authoritative.**

### 7. One D2b candidate reordering — not an ADR-0135 reopen

ADR-0135 §8a named `qf.communication.human-handoff-requested` the leading Tier-B candidate for
`human-handoff-required`, **conditional on S3**. This audit finds **no Core-side handoff fact** at the
pinned SHA — no handoff table among 100+ tables, no handoff service among 89 — so that candidate is
**blocked by missing truth**, not merely unadopted. Meanwhile `scheduled` (Core has
`communication_messages.scheduled_at`) and `authorization-requested` (the documented recommendation
step) have the **clearer** Core-side path.

**This reorders D2b's candidates inside ADR-0135's own "conditional on S3" framing. It changes no
decision and requires no reopen.**

### 8. Model 2 remains viable; ADR-0135 is not reopened

No finding contradicts Model 2. Every ADR-0135 caution is **confirmed**: candidate ≠ live emission;
`execution-submitted` unresolved; Tier A/B sources unsettled; a reader cannot manufacture provenance
(Core grants Jarvis no database role at all — the agent labels are _"not Supabase users, not
PostgreSQL roles, not service-role identities"_).

**No OWNER ARCHITECTURE REOPEN candidate is raised.**

### 9. Fifteen D2 questions, evidence-driven

The audit closes with a **D2 decision queue** (report §18): D2-Q1…D2-Q15, each with its finding, why
it blocks, the smallest future decision, dependencies and a must-not-assume. **No D2 schema, endpoint,
header, signature or event name is invented.**

### 10. Status reconciliation

PR #176 merged at `eebee71e4e156608e2e04e60802b9d24b33140f5`, so **ADR-0135 and the Model-2 design
document become Accepted / MERGED**. The roadmap and integration plan record that S3 is
**audited on this feature branch and awaiting owner acceptance on PR #177**, and that **D2 becomes
the next execution step only if and when PR #177 is accepted and merged**. **S3 is not called
delivered, complete, merged or closed. ADR-0135's findings are not rewritten.**

### 11. Three classifications the first revision overstated

**11.1 Generic outbox capacity is not ExecutionIntent persistence.** `OutboxCommandRequest` is
`{ commandType: string; payload?: JsonRecord; … }` and the only `commandType` in the repository is
`"test.noop"`. A bounded search for `ExecutionIntent`, `execution_intent`, `executionIntent`,
`intent-issued` and `ExecutionIntentV1` returns **0 hits each**. So for `qf.execution.intent-issued`:
**Core ownership NOT ESTABLISHED; persistence of the exact fact NOT ESTABLISHED; emission none;
adoption blocked/ambiguous pending D2/S5.** The same rule — **generic persistence capacity ≠
persistence of the specific business fact** — was applied to every candidate-event row.

**11.2 Cancellation vocabulary is not an authoritative cancellation fact.** A bounded writer audit
finds `cancelCommunication` **0 hits**, no admin or API communication-cancel route, and exactly one
authoritative writer of `communication_messages.status='cancelled'`: the private
`terminalizeBeforeClaim(…)`, reached **only** on a consent DENY. So: **cancellation vocabulary /
storage capacity `PRESENT_BUT_NOT_AUTHORITATIVE`; consent-deny terminalization
`AUTHORITATIVE_PRESENT`; an authoritative communication-cancellation operation or durable business
fact `ABSENT` / `AMBIGUOUS_REQUIRES_D2`.**

> **Core can represent `cancelled`, but S3 did not prove an authoritative communication-cancellation
> operation or durable business fact** — and **Core's `cancelled` currently means a consent refusal,
> which maps to Jarvis's `rejected`, not to Jarvis's `cancelled`.** D2 must not conflate them.

**11.3 The existing n8n transport is not the Jarvis B4 protocol.** `automationRecoveryService`'s
`recover_v1` / `reconcile_v1` are an **automation supervisor / claim / recovery transport** —
_"n8n supplies three transport fields and nothing else … CORE SELECTS EVERYTHING"_ — serving Core's
own QF-MVP automation purpose. The **Jarvis canonical Core → n8n execution-intent dispatch protocol
(ADR-0090 B4 / S5) is NOT ADOPTED / `CANDIDATE_OR_PROPOSED_ONLY`**, and **the existing signing domain
must not be assumed reusable** for a Jarvis trust purpose. `execution-submitted` stays
`AMBIGUOUS_REQUIRES_D2`.

## Consequences

- **If accepted, D2 can be taken against current facts** rather than a year-old audit. Until PR #177
  merges, S3 remains presented rather than delivered.
- The **consent** half of the integration is far more tractable than ADR-0132 assumed — Core already
  owns consent, suppression, a delivery trace and signature-gated webhooks. **Full business/send
  authorization and a Jarvis-facing authorization artifact remain unproved**, so S4 is not
  unblocked by this alone.
- The **event-transport half is the true blocker**: the `domain_events`/`outbox_events` schema is
  **defined in source** and the Jarvis envelope is **unwired at the pinned code**. **Core's own
  boundary documentation says the workflow-kernel migration is unapplied on the live database, but
  S3 did not independently inspect managed applied-state** — D2-Q14 must verify governed
  applied-state before deciding what must be applied or wired. Either way, **every Tier-C projection
  fact still waits on Core Phase 6/7**.
- GAP A and GAP B remain open, so S8 and S9 remain blocked exactly as ADR-0132 said.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Trust the historical audit.** Rejected by ADR-0132's own hard prerequisite — and it would have
  been insufficient: **three previously-audited findings materially changed, four remained unchanged,
  and eight domains had not been audited historically.**
- **Query live Supabase to settle ambiguity.** Refused. Out of scope, and the boundary is read-only;
  ambiguities are recorded as `AMBIGUOUS_REQUIRES_D2` instead.
- **Adopt an event because a Core fact exists.** Refused: a fact in a table is not an emission, and the
  persistence target is explicitly deferred by Core.
- **Reopen ADR-0135 on the handoff finding.** Rejected: ADR-0135 already marked that candidate
  conditional on S3, so this is the condition resolving, not a decision changing.

## Compliance

Every finding cites a file, symbol, table or migration at the pinned SHA (evidence index E1–E25), with
bounded absence searches for each `ABSENT` claim. Classifications use the required vocabulary. **No
Core modification, no Supabase, no n8n/provider, no message sent, no Jarvis production code, no
contract, no event registry, no persistence and no migration** — `0013` is not allocated and the
`0010`–`0012` ledger drift is untouched.

**Production rollout OFF. Runtime activation unchanged. PR #177 presents this audit for owner
acceptance; if merged, D2 — the Core protocol/event gap decision — becomes the next execution
step.**
