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

**The single most important property of this matrix:** QF Jarvis never appears in the **A** column for anything the business runs on, and never appears in the **R** column for anything that changes business state or authorizes an action. It is **C** — consulted — throughout. It is **A** for exactly two of its own artifacts, both of which are derived and neither of which is authority; see "Where the matrix would break" below. That is the whole design.

---

## Matrix

| Activity | QuickFurno Core | QF Jarvis | Human approver | n8n | Provider |
| --- | --- | --- | --- | --- | --- |
| **Lead creation** | **A / R** | I | — | — | — |
| **Lead verification** | **A** | **C** — Kabir recommends verification, flags fraud and implausibility | R — operations verifies | R — where an authorized verification action is executed | R — where a provider action is involved |
| **Lead-quality recommendation** | I | **R** — Kabir produces it | I | — | — |
| **Lead assignment** — initial batch, **at most 3** vendors | **A / R** — selects the vendors, creates and authorizes the batch | **C** — may assess matching readiness and vendor suitability, explain, flag. **Names no vendor, and has no field in which to** | I | — | — |
| **Vendor reassignment request** (a dissatisfied client asks) | **A** — receives it. **A request is not a decision** | **C / R** — Riya detects dissatisfaction and captures the client's **explicit confirmation**; Jarvis routes and submits the request. Dissatisfaction inferred by a model is *evidence*, never confirmation | I | — | — |
| **Vendor reassignment decision** — one replacement batch, **at most 3 additional unique vendors**; lifetime **6 unique vendors per lead-category** | **A / R** — decides, selects, creates and authorizes the batch; enforces the cap and the no-overlap rule | I | I | — | — |
| **Cross-category linked lead creation** | **A / R** — creates a **new** lead with independent identity, consent, verification, scoring, and matching | **C** — Riya identifies the need and carries the client's explicit confirmation. **May not widen an existing lead, and has no path to** | I | — | — |
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
| **Agent memory** | **I** — but its truth **overrides memory, always**; on disagreement, memory is rebuilt | **A / R** — owns it, and owns nothing by owning it: memory is isolated per agent, minimal, derived, rebuildable, and **non-authoritative by literal** ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)) | I | — | — |
| **Agent prompts, policies, and production configuration** | I | **I** — an agent **records** the version it ran at, and **may not set one**. No agent rewrites itself | **A / R** — a human changes the prompt, or the prompt does not change | — | — |
| **Training eligibility decision** (may this data train a model?) | I | **C** — supplies complete provenance and minimisation evidence. **Holds no eligibility state of its own, and no pipeline may infer one** | **A / R** — a named human, or a named and versioned policy a human approved, with a stated purpose limitation. **Sensitive personal data is never eligible, under any approval** | — | — |
| **Audit ownership** | **A / R** — authoritative audit trail | **R** — contributes recommendation and agent-run records | I | **R** — contributes execution telemetry | I |

---

## Reading the matrix

Several observations follow directly from the table above.

**Jarvis is accountable for nothing that the business runs on.** It is accountable for the quality of its own recommendations, for its own routing, and for a memory store that is disposable by construction — which is a real accountability, measured in [success-metrics.md](../charter/success-metrics.md), but it is not authority.

**Note the three approval rows.** Jarvis is **R** for *presenting the interface* and for *submitting the request* — and **I** for *authorizing*, where it merely displays what Core decided. Hosting the button is not holding the authority ([execution-governance.md](./execution-governance.md) §2a, [ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).

**Every row that touches money has a human approver in the R column and QuickFurno Core in the A column.** Recharge execution and campaign budget authorization both require stronger approval per [execution-governance.md](./execution-governance.md). There is no row anywhere in this matrix where money moves and Jarvis is more than a **C**.

**Lead assignment is Core's, and so is the whole assignment policy.** The rule is no longer a flat cap of three. It is:

| Rule | Value |
| --- | --- |
| Initial batch | **at most 3** eligible vendors — batch **1** |
| Replacement batch | **at most 3 *additional*** unique vendors — batch **2** |
| Replacement batches permitted | **exactly one.** There is no batch three |
| Lifetime maximum | **6 unique vendors per lead-category**, for all time |
| Overlap between batches | **forbidden** |
| Trigger for a replacement | genuine dissatisfaction **and the client's explicit confirmation** |
| Who creates and authorizes a batch | **QuickFurno Core, and only Core** |

The cap is scoped per **lead-category** for a reason. A client who wanted a wardrobe and now also wants a kitchen has not spent their wardrobe vendors exploring kitchens — counting the two together starves a legitimate second requirement. Counting them as one widened lead is worse still: it lets a client walk past an unbounded number of vendors by renaming what they wanted, and it silently inherits the wardrobe's consent and verification. A new category means a **new, linked lead**, Core-created and client-confirmed, with its own fresh batch of three.

**Riya never assigns.** She may say "this client has asked to be reassigned, and here is the confirmation" — and Jarvis may submit that request. Neither may say "give it to these three vendors," and neither could act on such a statement even if it made one: no write path exists, and no field exists in which a vendor could be named ([ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md)).

**Dissatisfaction is never inferred into a decision.** A model scoring a conversation as unhappy, or an agent noticing a client has gone quiet, is *evidence*. It is not confirmation, and confidence does not promote it into one. The failure that prevents is concrete: three new vendors are contacted — and charged, in lead value — about a real person's home renovation because a model read their tone as cooling. That is not recoverable in either direction.

---

## Where the matrix would break

If a future change puts QF Jarvis into an **A** or **R** cell for any of the following, the boundary has been violated and the change requires a superseding ADR:

- Lead assignment, vendor reassignment, or the creation of a cross-category linked lead
- Wallet state, package state, or payment
- Policy ownership or enforcement
- Provider execution
- Any approval decision
- Consent, opt-out, do-not-contact, quiet hours, or attempt limits
- Delivery or call outcome
- Training eligibility — deciding that data may be used to train a model
- An agent's own prompt, policy, or production configuration

Jarvis **is** accountable (**A**) for exactly two things in this matrix, and in both cases the accountability is for its **own artifacts**, never for business truth:

- **Communication routing between agents.** Authority over its own coordination, carrying an obligation: record the reason whenever it keeps a communication that Riya or Anisha would normally own.
- **Agent memory.** Authority over a store that is derived, rebuildable, and **non-authoritative by construction** — `authoritative: false` and `rebuildable: true` are literals, so the alternative does not parse. Owning memory is not owning truth: when memory and QuickFurno Core disagree, Core wins and the memory is **rebuilt, not reconciled toward** ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)). If a future change ever makes a memory record something the business needs to be correct, that **A** has quietly become a second source of truth, and the boundary has failed.

The correct response to "it would be faster if Jarvis just did it" is to re-read [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md) and [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md).
