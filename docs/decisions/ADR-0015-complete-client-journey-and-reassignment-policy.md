# ADR-0015 — Complete Client Journey and Reassignment Policy

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Riya's scope, as approved in Phase 0, was "client communication, follow-up, nurture, abandoned-requirement recovery, reactivation, relationship intelligence." The revised requirements extend it to the **complete client journey**, and with that extension comes the first genuinely consequential thing an agent in this system can precipitate: **a client's lead being offered to a second set of vendors.**

That is not a message. It is not a suggestion a human can shrug off. A vendor who receives a lead has been _charged_ for it in lead value, and a client whose project has been shopped to six different companies has had an experience nobody asked them if they wanted.

Meanwhile, the assignment rule the repository actually encoded was a flat cap: _"a qualified lead may be shared with a maximum of three suitable vendors."_ It said nothing about what happens when those three are unresponsive, nothing about whether a second set may be tried, and nothing about the client who later also wants a kitchen. In practice that means the rule would have been resolved by whoever implemented it first — which is how a business rule becomes an accident.

Three questions had no answer, and each has an expensive wrong answer:

1. **May a dissatisfied client be reassigned?** If no, the product is worse than a spreadsheet. If yes, without bounds, a client can be walked past every vendor in the city.
2. **Who decides they are dissatisfied?** If an agent may infer it, then a model's read of someone's tone can cost three vendors real money.
3. **What happens when a client wants a second, different thing?** If it widens the existing lead, the vendor cap silently stops meaning anything, and a kitchen lead reaches vendors having passed a wardrobe's checks.

## Decision

**Riya owns the complete client journey and cannot assign a vendor. Reassignment is bounded at two batches and six unique vendors per lead-category, requires explicit client confirmation, and is performed and authorized only by QuickFurno Core. A cross-category need creates a separate linked lead.**

### 1. Riya's scope, and its hard edge

Riya owns: requirement completion, follow-up, satisfaction and dissatisfaction detection, complaints, explicit confirmation capture, reassignment _requests_, linked-category lead _requests_, review, human escalation, lifecycle closure.

**Riya never assigns.** She may notice, may carry the client's confirmation, and may ask. She may not choose a vendor — and `ClientReassignmentRequestV1` has **no field in which she could name one**. This is not a rule review must remember; it is a shape that does not exist.

### 2. The batch policy

| Rule                   | Value                                                        | Enforced by                                                 |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Initial batch          | at most **3** vendors, batch number **1**                    | `vendors: z.array(...).max(3)`, `batchNumber` literal union |
| Replacement batch      | at most **3** _additional_ vendors, batch number **2**       | same, plus an overlap check                                 |
| Replacement batches    | **exactly one**. There is no batch three                     | `batchNumber` is `1 \| 2` — a third has no shape            |
| Lifetime cap           | **6 unique vendors per lead-category**, forever              | union of both batches is capped                             |
| Overlap                | **forbidden** — no vendor in both batches                    | set intersection on the record                              |
| Trigger                | genuine dissatisfaction **and explicit client confirmation** | `clientConfirmationId` required on batch two                |
| Creator and authorizer | **QuickFurno Core, only**                                    | `issuer` is the literal `quickfurno-core`                   |

### 3. Confirmation is an artifact, not a boolean

`ClientConfirmationV1` carries an identity, a confirming party, a capture channel, a **canonical event id proving where it was recorded**, and a stable statement code.

`confirmed: true` is a claim. A claim is worth nothing six months later when a client says they never agreed. A confirmation that points at the event Core recorded turns _"prove it"_ from an argument into a lookup.

Notably, it does **not** carry what the client said. A verbatim quote is personal data, it invites a transcript to be pasted in, and it is not what the system needs.

### 4. The replacement batch carries the previous batch's vendors

This looks redundant and is not. A single record must be **checkable on its own**. The alternative — trusting a caller to have counted correctly across two records it did not show us — is how a lifetime cap becomes a rule that holds only when everyone remembers it.

With `previousBatchVendors` on the record, the overlap rule and the six-vendor cap are decidable **by the validator, at creation time**, rather than by a query somebody might forget to run.

### 5. Cross-category needs create separate, linked leads

A new category means a **new lead** — Core-created, client-confirmed, with **independent consent, verification, scoring, and matching**, and its own fresh batch of three. The replacement policy then applies independently to it.

The independence guarantees are four booleans that can only be `true`. A boolean with one legal value looks pointless until you ask what `false` would have meant: it would have meant a kitchen lead inheriting a wardrobe lead's consent, reaching vendors on a check it never passed. There is no legitimate linked lead for which any of these is `false`, so `false` does not parse.

## Consequences

**Positive.**

- **An agent cannot cause a reassignment.** Not by being confident, not by being wrong, not by being compromised. It can only ask, carrying a confirmation it did not manufacture.
- **The vendor cap is arithmetic, not etiquette.** Seven vendors does not parse.
- **Re-offering a rejected vendor is a schema error**, not a customer-service incident.
- **A client's second requirement gets a fair, fresh shot** — three vendors of its own — without cannibalising the first.
- **The audit chain survives**: request → confirmation → Core decision → batch, each with an identity.

**Negative, and accepted.**

- **The lifetime cap is genuinely hard.** A client who dislikes all six vendors has no seventh, and the answer is a human conversation, not a seventh batch. That is deliberate: the alternative is an unbounded lead being resold indefinitely, which is worse for the client and much worse for the vendors paying for it.
- **A replacement batch record is fatter** than it strictly needs to be, because it carries the previous vendors. The cost is a few hundred bytes; the benefit is that the cap cannot be defeated by a caller who did not run the right query.
- **Riya will sometimes be right and unable to act.** She will identify a dissatisfied client who never explicitly asks for a replacement, and nothing will happen. This is the correct outcome. The failure in the other direction — vendors contacted because a model read a mood — is not recoverable.

## Alternatives rejected

**A flat cap of three, with no replacement.** The status quo. Rejected because it has no answer for the unresponsive-vendor case, which is common, and the absence of an answer means the first implementer invents one.

**An unbounded replacement policy — keep trying until the client is happy.** Rejected because vendor lead value is real money. A client with high standards could consume twenty vendors' paid leads, and each of those vendors would be right to be angry.

**Letting Riya select the replacement vendors, subject to Core's approval.** Superficially attractive: she has the context. Rejected because approval fatigue is real, and a human rubber-stamping an agent's vendor selection _is_ an agent selecting vendors, with a signature attached. The boundary has to sit where the agent genuinely cannot act, not where a human is nominally in the loop.

**Inferring dissatisfaction from behavioural signals** (no reply in N days, sentiment scoring). Rejected outright. This is the single most expensive wrong answer available: it converts a model's read of someone's tone into three vendors being charged and one client being shopped around. Signals are _evidence_, they live in the `dissatisfaction.evidence` field, and they may never be promoted to _confirmation_.

**Widening the existing lead for a new category.** Rejected. It defeats the vendor cap, silently inherits consent and verification, and forks the audit trail. See §5.

**Counting the vendor cap per lead rather than per lead-category.** Rejected because it starves a client's second, legitimate requirement — they would arrive at the kitchen having already spent their vendors on the wardrobe.
