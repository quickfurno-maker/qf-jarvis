# ADR-0136 — QFJ-P10 S3 fresh QuickFurno Core audit

**Status:** Proposed (read-only audit; implemented on a feature branch / PR, **not merged**)
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

### 2. Core has changed profoundly, and mostly toward Jarvis

At the pinned SHA Core has **101 migrations**, a **unified communication core**, an **append-only
consent-evidence model with a sole decision authority and a closed enforcement outcome**, a
**signature-gated provider webhook and append-only delivery trace**, a **workflow kernel defining
`domain_events` and `outbox_events`**, and a **written QF Jarvis integration boundary**.

The historical picture — no communication authority, no event mechanism, no reconciliation — is
**obsolete**.

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

`lib/events/eventEnvelope.ts` is _"inert TYPES + METADATA only"_; the `domain_events` /
`outbox_events` migration is **committed but UNAPPLIED on the live database**, with the envelope **not
wired to it**. Core's own roadmap places signed integration delivery at **Phase 7**, after a Phase 6
event taxonomy.

**This confirms ADR-0135 §2 exactly: candidate contracts are not adopted Core emissions.** Nothing in
this audit adopts, implements or schedules an event.

### 5. Findings that move a locked question

| Question                               | Movement                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Communication authority**            | historical _absent_ → **`AUTHORITATIVE_PRESENT`**: sole consent decision authority, closed machine-readable refusal codes, fails closed when unavailable                           |
| **`cancelled`**                        | ADR-0134 _no artifact_ → **state now exists** in `communication_messages.status` and `outbox_events.status`; no event/result surface yet                                           |
| **`provider-accepted` vs `delivered`** | → **independently mirrored** in `communication_delivery_events.normalized_event_type`                                                                                              |
| **Dispatch phases**                    | → Core **can** distinguish created / attempted / accepted / failed, in the automation-communication transport; **no event emitted**, and it is not an `ExecutionIntentV1` issuance |
| **Payment / order status**             | historical _unconstrained text_ → **CHECK-constrained vocabularies**                                                                                                               |
| **Auth account ≠ registration**        | → now **explicit** in `handle_new_user()`'s own comment                                                                                                                            |

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

PR #176 merged at `eebee71e4e156608e2e04e60802b9d24b33140f5`. ADR-0135 and the Model-2 design document
are corrected from _Proposed / not merged_ to **Accepted / MERGED**; the roadmap and integration plan
record that S3 is now **audited at a pinned commit** and that **D2 is next**. **ADR-0135's findings are
not rewritten.**

## Consequences

- **D2 can now be taken against current facts** rather than a year-old audit.
- The communication-authority half of the integration is far more tractable than ADR-0132 assumed —
  Core already owns consent, suppression, delivery trace and signature-gated webhooks.
- The **event-transport half is the true blocker**: `domain_events`/`outbox_events` are unapplied and
  the envelope is unwired, so **every Tier-C projection fact still waits on Core Phase 6/7**.
- GAP A and GAP B remain open, so S8 and S9 remain blocked exactly as ADR-0132 said.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Trust the historical audit.** Rejected by ADR-0132's own hard prerequisite — and it would have been
  badly wrong: six of fifteen delta rows changed.
- **Query live Supabase to settle ambiguity.** Refused. Out of scope, and the boundary is read-only;
  ambiguities are recorded as `AMBIGUOUS_REQUIRES_D2` instead.
- **Adopt an event because a Core fact exists.** Refused: a fact in a table is not an emission, and the
  persistence target is explicitly deferred by Core.
- **Reopen ADR-0135 on the handoff finding.** Rejected: ADR-0135 already marked that candidate
  conditional on S3, so this is the condition resolving, not a decision changing.

## Compliance

Every finding cites a file, symbol, table or migration at the pinned SHA (evidence index E1–E24), with
bounded absence searches for each `ABSENT` claim. Classifications use the required vocabulary. **No
Core modification, no Supabase, no n8n/provider, no message sent, no Jarvis production code, no
contract, no event registry, no persistence and no migration** — `0013` is not allocated and the
`0010`–`0012` ledger drift is untouched.

**Production rollout OFF. Runtime activation unchanged. The next step is D2 — the Core protocol/event
gap decision.**
