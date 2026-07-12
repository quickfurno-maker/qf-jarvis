# Assignment, Reassignment, and Linked Leads

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-12

The contracts that encode the vendor assignment policy. See [ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md) for the decision and the rejected alternatives.

---

## The policy, as numbers

| Rule                               | Value                                                        |
| ---------------------------------- | ------------------------------------------------------------ |
| Initial assignment batch           | **at most 3** vendors — batch number **1**                   |
| Replacement batch                  | **at most 3** _additional_ vendors — batch number **2**      |
| Replacement batches permitted      | **exactly one.** There is no batch three                     |
| Lifetime maximum                   | **6 unique vendors per lead-category**, for all time         |
| Vendor overlap between batches     | **forbidden**                                                |
| Trigger for a replacement          | genuine dissatisfaction **and explicit client confirmation** |
| Who creates and authorizes a batch | **QuickFurno Core, and only Core**                           |

This **supersedes** the flat "maximum three vendors per qualified lead" rule recorded in earlier documents.

---

## The contracts

| Contract                       | Produced by         | Authoritative?                                 | What it can do                            |
| ------------------------------ | ------------------- | ---------------------------------------------- | ----------------------------------------- |
| `ClientConfirmationV1`         | Core (embedded)     | **Yes** — points at the event that recorded it | Prove the client asked                    |
| `ClientReassignmentRequestV1`  | **QF Jarvis**       | **No — advisory, and inert**                   | Ask. **It cannot name a vendor**          |
| `ClientReassignmentDecisionV1` | **QuickFurno Core** | **Yes**                                        | Authorize or refuse                       |
| `AssignmentBatchV1`            | **QuickFurno Core** | **Yes**                                        | Be the record of who was offered the lead |
| `AdditionalServiceRequestV1`   | **QF Jarvis**       | **No — advisory**                              | Identify a cross-category need            |
| `LinkedLeadCreatedV1`          | **QuickFurno Core** | **Yes**                                        | Create a separate lead                    |

**Jarvis produces exactly two things here, and both are requests.**

---

## Riya asks. Core decides. Riya cannot choose.

`ClientReassignmentRequestV1` has **no field in which a vendor could be named.**

That is the whole design. Not a rule that review must remember, not a check somewhere in a service — a shape that does not exist. An agent that could nominate the replacement vendors would be an agent choosing who receives somebody's business, and a human rubber-stamping that selection _is_ an agent selecting vendors with a signature attached.

`AssignmentBatchV1.issuer` is the literal `quickfurno-core`. **Riya cannot construct a valid assignment batch.** Neither can Jarvis. Neither can anything else.

---

## Dissatisfaction is evidence. Confirmation is permission.

They live in different fields, and the separation is load-bearing.

```ts
dissatisfaction: {
  reasonCode,          // why we think they are unhappy
  severity,
  evidence,            // pointers to canonical events — mandatory, non-empty
},
clientConfirmation: {  // MANDATORY. The client actually asked.
  confirmationId,
  confirmedBy,         // must be the client named on the request
  confirmedAt,
  confirmationChannelCode,
  evidenceEventId,     // the canonical event in which Core recorded it
  statementCode,
}
```

An agent noticing that a client has gone quiet, or a model scoring a conversation as unhappy, is **evidence**. It may never be promoted to **confirmation** by an agent being confident about it.

### The failure this prevents

Three new vendors are contacted about a real person's home renovation because a model decided their tone had cooled.

That is not a recoverable error. The vendors have been **charged in lead value**, and the client has been shopped around without being asked. It is the single most expensive wrong answer available in this domain, and it is the reason `clientConfirmationId` is required on every replacement batch.

### Confirmation is an artifact, not a boolean

`confirmed: true` is a claim, and a claim is worth nothing six months later when a client says they never agreed. A `ClientConfirmationV1` points at the **canonical event in which Core recorded the confirmation** — so _"prove it"_ becomes a lookup rather than an argument.

It deliberately does **not** carry what the client said. A verbatim quote is personal data, it invites a transcript to be pasted in, and it is not what the system needs.

---

## What the schema proves, and what only Core can prove

This is the most important section in this document, and it is the one most likely to be skimmed.

**A standalone contract cannot prove historical Core state.** It validates _one record, in isolation, against itself_. It has no memory, no database, and no view of what happened before. Any rule that requires knowing _what else exists_ is **outside what a schema can enforce** — and pretending otherwise is worse than not enforcing it at all, because it produces a false sense that the invariant is already covered.

### Schema-enforced — refused by the parser, every time

| Rule                                                                              | Mechanism                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| At most **3** vendors in a batch                                                  | `vendors` is `.min(1).max(3)`                                                   |
| Batch number is **1 or 2**                                                        | a union of two literals — a third has no shape                                  |
| **No duplicate vendor** within a batch                                            | uniqueness check on `vendors`                                                   |
| **No overlap** between the two batches                                            | set intersection — **when both lists are supplied on the record**               |
| At most **6 unique vendors**                                                      | union of `vendors` and `previousBatchVendors` — **within the supplied history** |
| A replacement carries a **client confirmation** and a **Core decision** reference | required on `batchNumber: 2`, forbidden on `batchNumber: 1`                     |
| A replacement names **what it replaces**                                          | `previousBatchId` + `previousBatchVendors` required                             |
| A batch may not **replace itself**                                                | `previousBatchId ≠ assignmentBatchId`                                           |
| **`issuer` is QuickFurno Core**                                                   | a literal — Jarvis and Riya cannot construct a batch                            |
| The confirming party **is the named client**                                      | checked on the reassignment request                                             |

### Core-state-enforced — the schema cannot see these, and does not pretend to

| Rule                                                                      | Why a schema cannot decide it                                                                                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Only one batch 2 may ever exist for a lead-category**                   | Two separate `batchNumber: 2` records **both parse**. Uniqueness across records is a question about history, and a single record does not carry history  |
| `previousBatchVendors` **actually matches** the authoritative batch 1     | The record asserts its own history. A caller could assert a false one; only Core knows the truth                                                         |
| The **confirmation reference exists** and belongs to the right client     | The schema checks the _embedded_ confirmation's client. It cannot check that `clientConfirmationId` on a batch resolves to a real, recorded confirmation |
| The **reassignment decision exists** and is currently valid               | Same: an id is a pointer, and a pointer's target is Core's                                                                                               |
| Vendor **eligibility, capacity, location, category, credits**, anti-abuse | Business state Jarvis does not hold and must not hold                                                                                                    |
| **No concurrent or duplicate** authoritative assignment                   | A concurrency question, not a shape question                                                                                                             |

### What this means, stated plainly

**The schema does not enforce the lifetime business invariant across separate records.** It enforces the invariant _within the history a record declares_. Those are different guarantees, and the difference is exactly where a real system gets it wrong.

What the schema buys is still substantial: **a malformed, over-sized, self-contradicting, or agent-issued batch cannot reach Core at all.** Core's job is then narrowed to the questions only Core can answer — _is this history true, and is this the only replacement?_ That is a much smaller surface to get right than validating everything from scratch, and it is a surface Phase 11 must actually implement.

This is the same honesty the lifecycle contracts apply to transition validity: **a stateless validator cannot enforce a stateful rule**, and saying so is what makes somebody build the thing that does.

---

## Why the replacement batch carries the previous batch's vendors

`previousBatchVendors` looks redundant. It is not.

**A single record must be checkable on its own.** The alternative — trusting a caller to have counted correctly across two records it did not show us — is how a lifetime cap becomes a rule that holds only when everyone remembers to run the right query.

With the previous vendors on the record, the **overlap rule** and the **six-vendor lifetime cap** are decidable by the validator, at the moment the batch is created:

```ts
// No vendor may appear in both batches.
const overlap = vendors.filter((v) => previousKeys.has(entityKey(v)));

// Six unique, across the union — not "three plus three, roughly".
const lifetime = new Set([...previousKeys, ...vendorKeys]);
if (lifetime.size > MAX_VENDORS_PER_LEAD_CATEGORY) {
  /* refused */
}
```

The cap is checked on the **union**, not the sum, because a vendor appearing in both batches is **one** vendor — and a rule that counted them twice could be gamed by a caller who wanted a seventh.

---

## Why the cap is per _lead-category_

A client who wanted a wardrobe and now also wants a kitchen **has not spent their wardrobe vendors exploring kitchens.**

- Counting the two together **starves** the second, legitimate requirement.
- Counting them as one lead lets a client walk past an **unbounded** number of vendors by renaming what they wanted.

The **lead-category pair** is the unit that makes both of those wrong.

---

## Cross-category needs create separate, linked leads

A new category means a **new lead**. Not a widened one.

`LinkedLeadCreatedV1` carries four literals that can only be `true`:

```ts
independence: {
  independentConsent: z.literal(true),
  independentVerification: z.literal(true),
  independentScoring: z.literal(true),
  independentMatching: z.literal(true),
}
```

A boolean with one legal value looks pointless until you ask what `false` would have meant. **It would have meant a kitchen lead inheriting a wardrobe lead's consent** — reaching vendors on the strength of a check it never passed. There is no legitimate linked lead for which any of these is `false`, so `false` does not parse.

Two further checks:

- **`newLead` must not equal `originatingLead`.** This is what stops "linked" from quietly meaning "the same lead, widened" — which would re-import every failure the separation prevents while appearing in the audit trail as though it had not.
- **`newCategory` must differ from `originatingCategory`.** A linked lead in the same category is a duplicate of the lead we already have, and it would mint a second batch of three vendors for one need.

The new lead-category gets its **own initial batch of at most three**, and its **own one-replacement allowance**. It does not inherit the parent's consumed batches and does not contribute to them.

---

## What the tests prove

| Test                                         | If it ever passed                                                    |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Four vendors in a batch                      | The cap is decoration                                                |
| Batch number three                           | The one-replacement rule is decoration                               |
| Same vendor twice in one batch               | A batch offers less choice than it appears to                        |
| A vendor in **both** batches                 | A "replacement" re-offers a vendor the client just rejected          |
| Seven unique vendors                         | The lifetime cap is decoration                                       |
| Replacement with no client confirmation      | **Three vendors contacted because a model inferred dissatisfaction** |
| Batch issued by Jarvis or Riya               | **An agent chose who receives somebody's business**                  |
| Linked lead reusing the parent's identity    | A kitchen lead inherited a wardrobe's consent and verification       |
| Linked lead with `independentConsent: false` | Same, stated explicitly                                              |
| Additional service in the same category      | A second lead — and a second batch of three — for one need           |

Each of those is a sentence in an approved document until something refuses it. These tests are the thing that refuses it.
