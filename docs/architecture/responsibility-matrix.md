# Responsibility Matrix — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

Ownership statements here follow [system-boundary.md](./system-boundary.md), which is authoritative.

---

## Legend

| Code | Meaning |
| --- | --- |
| **A** | **Accountable** — owns the outcome and the final say. Exactly one per row. |
| **R** | **Responsible** — performs the work. |
| **C** | **Consulted** — provides input, analysis, or a recommendation. Has no authority. |
| **I** | **Informed** — receives the result. |
| — | No role. |

**The single most important property of this matrix:** QF Jarvis never appears in the **A** column, and never appears in the **R** column for anything that changes business state or authorizes an action. It is **C** — consulted — throughout. That is the whole design.

---

## Matrix

| Activity | QuickFurno Core | QF Jarvis | Human approver | n8n | Provider |
| --- | --- | --- | --- | --- | --- |
| **Lead creation** | **A / R** | I | — | — | — |
| **Lead verification** | **A** | **C** — Kabir recommends verification, flags fraud and implausibility | R — operations verifies | R — where an authorized verification action is executed | R — where a provider action is involved |
| **Lead-quality recommendation** | I | **R** — Kabir produces it | I | — | — |
| **Lead assignment** (max three vendors per qualified lead) | **A / R** | **C** — may assess matching readiness and vendor suitability, explain, flag | I | — | — |
| **Client follow-up recommendation** | I | **R** — Riya produces it | I | — | — |
| **Presenting the approval interface** | I | **R** — the Control Plane surfaces the item, its evidence, and the approve/reject/request-changes actions | I | — | — |
| **Submitting an approval request** | **A** — receives, validates, decides | **R** — submits the request on a human's action; **holds no approved state of its own** | **R** — the human whose action it is | — | — |
| **Authorizing an action** | **A / R** — validates identity, authority, current state, risk policy, expiry, and eligibility; decides; records; emits the decision event | **I** — displays the authoritative result | **R** — decides, within delegated limits | — | — |
| **Client message approval** | **A** — records the decision | **C** — proposes content, timing, channel | **R** — decides | — | — |
| **Client message delivery** | **A** — authorizes and records result | — | I | **R** — executes the authorized intent | **R** — delivers |
| **Communication request** (call or WhatsApp) | **A** — validates and decides | **R** — Jarvis, Riya, or Anisha prepares the structured request per domain routing | **R** — the human whose instruction it is, where founder- or admin-directed | — | — |
| **Consent, opt-out, do-not-contact, quiet hours, attempt limits** | **A / R** — owns and **enforces**; refuses a request that violates them, **including the founder's own** | I — may hold a derived view as a courtesy check; **never as permission** | I | **R** — re-validates at execution time | — |
| **Outbound call or WhatsApp execution** | **A** — authorizes and records the authoritative outcome | — | I | **R** — executes via the QF Communications Runtime, routing through the WhatsApp adapter or the QF Voice Runtime | **R** — the **external WhatsApp provider or telephony/SIP provider** delivers |
| **Delivery and call outcome** | **A / R** — records it as truth | I — **displays** it; may never write `delivered` or `completed` | I | **R** — reports the structured result | C — reports provider-side status |
| **Communication routing between agents** | I | **A / R** — routes per the root-cause rule, and **records the reason** when it keeps a communication a specialist would normally own | I | — | — |
| **Human handoff of a conversation** | **A / R** — owns handoff state | **R** — coordinates and requests it | **R** — the human who takes it over | R — surfaces the handoff | — |
| **Vendor onboarding recommendation** | I | **R** — Anisha produces it | I | — | — |
| **Vendor package state** | **A / R** | **C** — may recommend that a package is worth discussing | I | — | — |
| **Wallet state** | **A / R** | I — reads a derived, non-authoritative view | I | — | — |
| **Recharge recommendation** | I | **R** — Anisha produces it | I | — | — |
| **Recharge execution** (money) | **A** — authorizes | — | **R** — approves; stronger approval required | R — executes the authorized intent | R — delivers |
| **Campaign analysis** | I | **R** — Jitin produces it | I | — | — |
| **Campaign budget recommendation** | I | **R** — Jitin produces it | I | — | — |
| **Campaign budget authorization** | **A** — records the decision | **C** — recommends, with evidence | **R** — decides; stronger approval required | — | — |
| **Campaign budget change at the provider** | **A** — authorizes and records result | — | I | **R** — executes the authorized intent | **R** — applies the change |
| **Provider execution** (any) | **A** — authorizes | — | I | **R** — validates and executes | **R** — delivers |
| **Execution-result recording** | **A / R** — records it as truth | I — reads it to close its lifecycle and learn | I | **R** — reports it | C — reports provider-side status |
| **Policy ownership** | **A / R** — defines, versions, enforces | **C** — may propose a policy change as a recommendation | **R** — administrators author and approve policy | I — enforces bounds at execution | — |
| **Audit ownership** | **A / R** — authoritative audit trail | **R** — contributes recommendation and agent-run records | I | **R** — contributes execution telemetry | I |

---

## Reading the matrix

Three observations follow directly from the table above.

**Jarvis is accountable for nothing that the business runs on.** It is accountable only for the quality of its own recommendations — which is a real accountability, measured in [success-metrics.md](../charter/success-metrics.md), but it is not authority.

**Note the three approval rows.** Jarvis is **R** for *presenting the interface* and for *submitting the request* — and **I** for *authorizing*, where it merely displays what Core decided. Hosting the button is not holding the authority ([execution-governance.md](./execution-governance.md) §2a, [ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).

**Every row that touches money has a human approver in the R column and QuickFurno Core in the A column.** Recharge execution and campaign budget authorization both require stronger approval per [execution-governance.md](./execution-governance.md). There is no row anywhere in this matrix where money moves and Jarvis is more than a **C**.

**Lead assignment is Core's, and so is the three-vendor rule.** Jarvis may say "this lead is ready for matching" or "this lead looks fabricated, do not spend vendor value on it." It may not say "give it to these three vendors," and it could not act on such a statement even if it made one — no write path exists.

---

## Where the matrix would break

If a future change puts QF Jarvis into an **A** or **R** cell for any of the following, the boundary has been violated and the change requires a superseding ADR:

- Lead assignment
- Wallet state, package state, or payment
- Policy ownership or enforcement
- Provider execution
- Any approval decision
- Consent, opt-out, do-not-contact, quiet hours, or attempt limits
- Delivery or call outcome

Note that Jarvis **is** accountable (**A**) for one thing in this matrix: **communication routing between agents**. That is not authority over the business — it is authority over its own coordination, and it comes with an obligation, which is to record the reason whenever it keeps a communication that Riya or Anisha would normally own.

The correct response to "it would be faster if Jarvis just did it" is to re-read [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md) and [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).
