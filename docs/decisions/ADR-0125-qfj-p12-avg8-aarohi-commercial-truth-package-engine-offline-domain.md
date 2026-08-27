# ADR-0125 — QFJ-P12 / QVGE / AVG-8: the Aarohi COMMERCIAL TRUTH and PACKAGE ENGINE OFFLINE DOMAIN

- **Status:** Accepted (offline domain only; runtime PLANNED / DISABLED)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition
- **Overlay stage:** AVG-8 — Commercial Truth and Package Engine
- **Certified qf-jarvis baseline:** `ea61ef18555c32f442b5923c4316b437e96921d0` (PR #166 / AVG-7 merge)
- **QuickFurno marketplace commit inspected:** `997f08ee5ec337583ace17c5882dcab51731d26e` (read-only)
- **Supersedes:** nothing
- **Related:**
  [ADR-0085](ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (governing
  architecture and the authority ceiling),
  [ADR-0122](ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md),
  [ADR-0123](ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md),
  [ADR-0124](ADR-0124-qfj-p12-avg7-aarohi-sales-brain-offline-domain.md)

---

## Context

The canonical overlay sentence for this stage, in full:

> **AVG-8 — Commercial Truth and Package Engine.** Packages, entitlements and pricing presented
> during acquisition, sourced from Core. The engine selects and explains what Core already holds; it
> does not invent, adjust, discount or interpret price. Commercial facts are reference data, not
> values a model is allowed to improvise.

AVG-7 established that a commercial question stops at `REQUEST_CORE_COMMERCIAL_CONTEXT`, because a
system asked for a price it does not have will supply one. AVG-8 is the other half: the facts Core
already holds, carried exactly.

### The failure this stage is designed against

Not a wrong price. A **plausible** one. Every number in a commercial conversation has a shape a
capable system can produce on demand — a per-lead cost that sounds reasonable, a saving that follows
from two numbers sitting next to each other, a currency that "obviously" applies. Each is a
commercial commitment nobody at QuickFurno authorised, quoted to a real business, in QuickFurno's
name.

The word "engine" in the roadmap sentence is the one worth being careful about. An engine that takes
a preference and returns a package is a recommendation engine, and Core did not authorise Aarohi to
run one.

---

## Decision

### 1. The READ contract is mirrored, not the table behind it

At the inspected commit, `services/vendorPackageOrderService.ts` declares:

```ts
export type VendorPackageOption = {
  id: string;
  name: string;
  lead_count: number;
  total_price: number;
  display_price: number;
  validity_days: number;
  is_active: boolean;
};
```

and `listAvailableVendorPackages()` selects exactly
`id, name, lead_count, total_price, display_price, validity_days, is_active` from `packages`, filters
`is_active = true`, and orders by `lead_count`.

The raw table (`db/001_create_tables.sql`) has **nine** columns: those seven plus `created_at` and
`price_per_lead`. AVG-8 models the **seven**, because the read service is the contract Core actually
offers and the table is an implementation detail Core is free to change.

`price_per_lead` is the instructive omission. It exists in the database, it is trivially derivable as
`total_price / lead_count`, and it is exactly the number a sales conversation reaches for. It is
absent here **twice over**: not accepted as a field, and never calculated from the two prices that
are present. The moment Aarohi divides two Core numbers, the result is an Aarohi number being
presented as a Core one — and nobody downstream can tell the difference by looking at it.

Field names stay in Core's snake_case. Renaming `display_price` to `listPrice` would be a claim about
what the two prices MEAN, and this file has no such claim to make.

### 2. Offline and injected, and the posture says so

This PR calls QuickFurno nowhere. No Supabase client, no service-role key, no `.from('packages')`, no
RPC, no HTTP client, no credential, no import of the marketplace repository, and no runtime
dependency on it in either direction. A containment spec bans the clients, the service names, the
query-builder shapes and the write verbs.

The catalog is an injected observation stamped
`INJECTED_OFFLINE_CORE_COMMERCIAL_CATALOG_OBSERVATION`, and every brief additionally declares
`snapshotSourceAuthenticated: false`. Saying it twice is deliberate: the posture is only honest while
there is genuinely no way to authenticate one, and the day somebody adds a client both statements
become false at once and both specs fail.

### 3. Both prices are preserved, and neither is explained

Core exposes `total_price` and `display_price`. Both are copied, separately and exactly. Nothing
subtracts them, divides them, rounds them, decides which is the real one, or names the difference.

The schema deliberately imposes **no relationship** between them, and specs assert all three
directions — below, equal, above — are accepted unchanged. Requiring `total_price <= display_price`
would be this file deciding one is a list price and the other a sale price. Calling the gap a
discount would invent a promotion Core never authorised; calling it an error would be second-guessing
Core's data.

There is no currency field. QuickFurno's ORDER-write path hard-codes INR; that is a fact about the
write path and not about the available-package read, and inheriting it here would be Aarohi asserting
a currency Core's read contract never stated.

**A spec asserts the strongest available form of all this:** the only numbers anywhere in a brief are
the contract version and the Core values themselves. A discount, a saving, a per-lead price and an
effective price are all numbers, so counting them is tighter than naming the fields they might arrive
in.

### 4. `is_active` is `z.literal(true)`, not a boolean to filter on

This contract models the AVAILABLE-package read, which filters on it. An inactive package is
therefore **outside the contract** and is refused, rather than quietly dropped. Silently discarding a
row is how a caller ends up believing a catalog was complete when it was not — and a catalog that
lost a row without saying so is worse than one that refused to be built.

For the same reason `lead_count` and `validity_days` are non-negative rather than positive, and
prices are non-negative rather than positive: whether a zero-lead package makes sense is Core's
judgement, and refusing one here would be a commercial opinion wearing a validation rule. `finite()`
is required on every number, because `NaN` and `Infinity` are the two values that would survive
arithmetic somebody adds later and make nonsense of it silently.

### 5. Canonical order is by package id, and that is serialization rather than ranking

The catalog is immutable, bounded at 64, deduplicated by Core package id, and ordered by id
ascending. One private helper checks the whole aggregate and is called by the schema, the parser and
the builder, so the invariant cannot acquire a second definition — the AVG-5 defect, closed by
construction. An unsorted hand-assembled snapshot is **refused, not reordered**.

Core's own service orders by `lead_count`. AVG-8 deliberately does not, and the reason is the whole
of decision 6: **an order Aarohi chose over a commercial attribute is a recommendation whether or not
anybody calls it one.** The first row of a price-sorted list is the cheapest package, and something
downstream will eventually read it that way. Ordering by identifier is meaningless as a commercial
signal, which is exactly why it is safe — and a spec arranges three fixtures so the canonical order
demonstrably disagrees with lead-count order and with both price orders.

### 6. Selection is identifier lookup, and that is all it is

Two closed scopes, as a discriminated union so neither can borrow the other's fields:

- `AVAILABLE_PACKAGE_CATALOG` — everything Core listed.
- `EXACT_PACKAGE` — this identifier.

There is no `CHEAPEST`, `BEST_VALUE`, `MOST_SUITABLE`, `RECOMMENDED` or `WITHIN_BUDGET`, and no input
field for a budget, a desired lead count, an optimisation target or a sort key. An unknown package id
is refused with `PACKAGE_NOT_IN_CORE_CATALOG` and **no fallback whatsoever** — not the first, not the
cheapest, not the nearest. A package Core does not list is a package that does not exist, and
answering with a different one is answering a question nobody asked.

### 7. The AVG-7 plan is RE-DERIVED, never believed

This is AVG-6's owner-review lesson applied at the next boundary that would otherwise have repeated
it. A caller could hand-write a plan that parses, says `REQUEST_CORE_COMMERCIAL_CONTEXT`, and rests
on nothing.

So the plan is not trusted. AVG-7's own public evaluator is re-run over the supplied conversation,
interpretation and **CURRENT** Core observation, seeded with the plan's own `planRef` and `plannedAt`
so the only thing that can differ is what the canonical policy concludes. The result must reproduce
the supplied plan **exactly** — every field, and both nested objects, compared by value and never by
identity. The nested brief and posture are compared by walking the recomputed object's own keys, so a
field added to AVG-7 later is compared without anyone remembering to add it here.

Re-derivation is worth more than a strategy check because it carries three AVG-7 guarantees across
for free: the interpretation must still be a reading of the CURRENT turn, the causal chain must still
hold, and the CURRENT Core gate must still admit exactly `NOT_REGISTERED`. **A prospect who has since
become `DO_NOT_CONTACT` cannot be quoted a price**, and that falls out of the re-derivation rather
than being asserted separately.

Three refusal codes, kept apart because a reviewer wants to tell them apart: `SALES_PLAN_INVALID`
(malformed), `SALES_PLAN_POLICY_MISMATCH` (parses, not reproducible), `SALES_PLAN_NOT_COMMERCIAL`
(honestly re-derived, asked for something else).

**One asymmetry is worth recording**, because it looks like a gap and is not. The re-derivation is
seeded with the supplied plan's own `plannedAt`, so moving that instant LATER produces a plan the
policy genuinely would have made at that instant — an honest plan, not a forgery, and a spec asserts
it is accepted. Moving it EARLIER breaks AVG-7's causal chain and re-derivation produces nothing.
Nor does a later instant buy anything: catalog staleness is measured against that same instant, so
pushing the plan forward only makes the catalog more likely to be refused, which a spec also asserts.

### 8. The facts must answer the request, not predate it

```
latest message observedAt ≤ interpretation interpretedAt ≤ plan plannedAt
                          ≤ catalog observedAt ≤ brief preparedAt
```

AVG-7 proves the first two links; AVG-8 enforces the last two. All by semantic UTC instant, never by
string: optional milliseconds mean `09:00:00.500Z` sorts before `09:00:00Z` lexicographically while
being half a second later, and both directions are asserted because only one of them is wrong per
comparison. No clock is read.

AVG-7 said Core commercial context was REQUIRED. A catalog observed **before** that was said is not
an answer to it — it is a catalog that happened to be lying around, and treating it as standing
commercial permission is how a stale price reaches a live conversation.

### 9. A closed fact BRIEF, and no sentence anywhere

The brief carries structured facts and closed tokens only. There is no `explanation`, `summary`,
`pitch`, `salesCopy`, `recommendationReason`, `reply` or `body`.

The roadmap says the engine "selects and **explains**", and the explaining belongs to a later governed
composition working from these facts. What AVG-8 supplies is the thing that composition must be
grounded in; a prose field here would be the un-grounded half arriving first, in the file whose
entire purpose is that commercial claims are grounded.

`commercialFactsReadyForFutureGovernedDraft: true` means exactly one thing: the facts a future
governed composition would need are present. Not that a model was called, a prompt resolved, a reply
exists, a price was interpreted, a reply approved or a send authorized.

**The AVG-7 plan is not rewritten.** It recorded that facts were MISSING when it was made, and that
stays true; `futureModelDraftEligible: false` on that plan is left exactly as it was. AVG-8 says its
own separate thing rather than editing somebody else's record.

`requiresCoreCommercialRevalidationBeforeFutureOutboundUse: true` is the other half: a snapshot is an
observation, not a standing offer. Prices move.

### 10. `lead_count` is an entitlement fact, never a delivery promise

A package that entitles somebody to 100 leads is not a promise that 100 leads will arrive, be
qualified, or convert. AVG-7 pins `guaranteeLeadVolume`, `guaranteeRevenue` and `guaranteeConversion`
false; carrying a lead count here does not quietly undo them, and specs assert both the count is
copied exactly and no guarantee-shaped key exists anywhere in a brief.

### 11. Nothing here is an action

No package order, manual payment, payment state change, package assignment, credit grant, wallet
mutation, vendor activation, registration, acquisition-case transition or Anisha handoff. Those are
AVG-9's, AVG-10's, and Core's, and the marketplace's write functions are banned by name in
containment.

A prospect saying "I want that package" produces, here, exactly nothing.

No model call, prompt resolution or retrieval; no communication request, approval, decision,
authorization or execution intent; no n8n, provider or channel send; no persistence, cache, table or
migration. This package does not duplicate QuickFurno's `packages` table.

### 12. AVG-8 terminates at the brief

No downstream builder consumes a parsed brief in this slice, which is why the brief parser being
unable to independently re-prove plan-and-catalog provenance is acceptable: nothing treats a parsed
brief as a policy proof. **A future stage that consumes one must re-derive it**, exactly as AVG-8
re-derives the AVG-7 plan, and this paragraph exists so that requirement is written down before the
stage that needs it is written.

### 13. Two reference roles, carried forward from ADR-0124

Core package ids and every reference inherited from an AVG-7 plan use the certified upstream opaque
grammar with **no** contact screen — a numeric or UUID id is an identifier, and a downstream stage may
not narrow a grammar it does not own. AVG-8's own `snapshotRef` and `briefRef` additionally refuse
contact shapes and seven-or-more digits anywhere. Both grammars are private.

### 14. One containment scan was narrowed, and the trade is stated

Through AVG-7 this package banned the bare substring `currency`. AVG-8 writes it as
`currencyInvented: false` — the fourth declaration of absence this list has had to make room for,
after `metaApiCalled`, `whatsappSendRequested` and `priceOriginatedByBrain`. The ban moved to
currency CODES (`'INR'`, `'USD'`, `currencycode`) and to a field literally named `currency`.

The `price:` / `discount:` / `amount:` shape bans additionally gained a word boundary, because
`total_price` and `display_price` are **Core's field names, copied rather than chosen**. A scan that
forced them to be renamed would have made the contract less faithful in order to keep a test quiet,
which is the wrong way round. `unitPrice` and `listPrice` remain covered by the substring list, and
the posture is asserted field by field in exchange — a stronger check than either substring was.

### 15. Nine mutation findings worth recording

Eighty-three negative mutations were applied. Nine initially SURVIVED, and they fell into three
different categories — which is the useful part, because only one category was a weak boundary.

**Three were real gaps in the assertions.** Mutations adding `totalPriceOverride`,
`leadCountOverride` and `validityOverride` to the brief input schema passed everything, because the
specs proved that `total_price` and its siblings are refused as input keys and said nothing about a
key nobody had thought of. `.strict()` refuses keys a schema does not KNOW about; a key added to the
schema is a key it knows. The accepted input surface is now asserted **from the source itself** — the
eight fields, extracted by reading the schema block — so a ninth fails before it could ever carry a
value.

**A fourth was a real gap of a subtler kind.** The mutation making plan equality ignore the nested
BRIEF survived, because every forged brief the specs tried was one AVG-7's own plan parser refuses,
so the comparison was never the thing under test. The case that isolates it is a brief that is
internally consistent — strategy, intent, objection and obligations all agreeing — and simply belongs
to a different turn's answer. AVG-7's plan schema cannot object to that: nothing in it ties a brief
to the interpretation the plan names. Only re-deriving and comparing catches it, and both directions
of the swap are now specs.

**Three were duplicated guards, not weak boundaries**, and were re-aimed rather than accepted. The
builder's aggregate check is backed by the schema parse it performs before returning; the explicit
duplicate check is backed by the strict-increase check (a comparator keyed solely on id makes strict
increase imply uniqueness, since two rows with one id compare equal); and the helper's bound is
backed by zod's own `.max()`. Each mutation now removes the PROPERTY rather than one of its two
enforcements — one conceptual defect, two guards, exactly as ADR-0123 records for AVG-6's `S` and `T`.

**One was a harness misclassification.** Adding an uninstallable dependency makes `pnpm` refuse to
run the suite at all, so there is no test line to read — and reading that absence as "nothing failed"
is exactly backwards. A mutation that stops the suite running is a stronger failure than a red test,
not a weaker one, and the runner now says so.

**One is structurally unreachable, and is reported rather than removed.** The mutation making plan
equality ignore the nested POSTURE cannot be isolated, because AVG-7's posture schema pins every
field as a `z.literal` and admits exactly one value — verified directly: no flipped field, no extra
key and no missing key parses. Every plan that parses therefore carries the identical posture, so the
comparison cannot change an outcome today. It is kept anyway, because it is correct and because the
day AVG-7 relaxes a posture literal is the day it starts mattering — and a comparison deleted for
being currently redundant is not there on that day. Padding the count by deleting the mutation
instead would have made the proof look stronger than it is.

---

## What AVG-8 deliberately does not do

| Left out                                                                | Owner                                      |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Registration integration                                                | AVG-9                                      |
| Payment, package order, assignment, credits, activation, Anisha handoff | AVG-10                                     |
| Persistence, dashboards, admin APIs, analytics                          | AVG-11                                     |
| Any increase in autonomy                                                | AVG-12                                     |
| Model calls, prompt resolution, retrieval, drafting                     | later composition through QF Model Gateway |
| Live Core reads, provider adapters, n8n routes, sends                   | **QFJ-P09**                                |

Dependencies are unchanged: `zod` alone. No devDependencies, no workspace dependency, no lockfile
change, and no dependency on the QuickFurno marketplace in either direction.

---

## Consequences

Aarohi can now carry the commercial facts Core already holds, exactly, and still cannot say anything
about them.

The value is narrow and worth stating plainly. When a governed model composition is eventually built,
it will attach to a domain where a price cannot be invented because there is no field to invent one
in, a package cannot be recommended because there is no function that chooses, a stale catalog cannot
answer a live question, and a commercial brief cannot exist for a prospect Core has since suppressed.
The model is the part that does not exist. The controls around it are what this slice is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**Core owns commercial truth. Aarohi presents exact reference facts. A model never becomes commercial
authority.**
