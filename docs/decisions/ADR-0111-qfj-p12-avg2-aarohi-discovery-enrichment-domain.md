# ADR-0111 — QFJ-P12 / QVGE AVG-2: Aarohi discovery and enrichment domain

**Status:** Accepted — offline domain only. No runtime, no persistence, no provider, no channel, no
outreach, no scraper, no scoring, no rollout. Aarohi's runtime status remains **PLANNED / DISABLED**
and this decision does not change it.

**Date:** 2026-08-24

**Supersedes:** nothing.
[ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) remains the
governing decision for Aarohi's identity, the permanent split against Riya, Anisha and Jarvis, the
authority ceiling, the existing-vendor gate and the Core ACTIVE handoff. AVG-1 built the prospect
identity, the acquisition case and the gate; none of it is modified here.

---

## Context

AVG-1 gave Aarohi an opaque prospect identity that is explicitly **not** a vendor identity, a closed
acquisition-case lifecycle describing Aarohi's own work rather than the party's business state, and a
fail-closed existing-vendor gate whose permitted set is exactly one Core status.

What it did not give is anywhere to put what discovery actually produces. The overlay's AVG-2 stage
is "sourcing candidate businesses and enriching them into a reviewable profile", with a constraint
attached that is easy to write and hard to keep:

> Enriched content is **untrusted reference material** — it never establishes consent, never proves
> identity, and never grants eligibility to contact.

Every part of that is a thing a naive enrichment model would violate within one sprint. A key/value
bag grows a `phone` field. A social profile URL becomes a place to send a message. Three sources
agreeing becomes a resolved fact. A confidence score becomes a reason to skip a check. A profile that
looks complete becomes a profile that looks eligible.

## Decision

Add AVG-2 to the existing `@qf-jarvis/aarohi-agent` package as three contracts and pure functions
over frozen values. No new package, no workspace dependency, no runtime layer.

### An enrichment fact is a provenance-bound claim, and the shape enforces it

One claim binds one prospect, one attribute from a **closed vocabulary**, one bounded value, one
provenance record, one caller-supplied instant and one evidence-quality token. There is deliberately
no generic key/value map, so `phone`, `email`, `vendorId`, `registrationNumber`, `packageTier`,
`consentStatus`, `isActive`, `paymentStatus` and `leadEligibility` have nowhere to go — unknown keys
are refused rather than stripped, and an unlisted attribute is refused rather than carried as text.

### Presence attributes cannot hold a destination

`WEBSITE_PRESENCE`, `PUBLIC_SOCIAL_PRESENCE` and `PORTFOLIO_SIGNAL` are typed as a two-member signal
(`OBSERVED` / `NOT_OBSERVED`), not as text. Recording _that_ a public presence exists is review
material; recording _where_ it is would be a deliverable coordinate under another name. A field that
accepted text would eventually hold a profile URL, so it does not accept text.

Label attributes are bounded and screened for contact **shapes** — an address, a fetchable location,
a dialable run of digits — described by shape rather than by platform, so no channel is named in this
package and no future channel is missed by omission. The screen is conservative and will refuse some
innocent strings; refusing a legitimate description is a smaller failure than storing a phone number
Aarohi holds no consent for.

### Evidence quality is not authority, and its names say so

Every member of the quality vocabulary begins with `UNVERIFIED_`. There is no `VERIFIED` level and a
spec asserts the prefix across the whole vocabulary, so adding one fails a test rather than passing
review quietly.

### Conflicts are reported, never resolved

If one source says Kharadi and another says Viman Nagar, both survive and the attribute reads
`CONFLICTING` with every distinct value visible. Nothing overwrites, nothing wins on confidence, and
nothing wins on array order — the summary sorts what it groups, so the same evidence in any sequence
produces the same verdict.

Deduplication collapses **only** claims identical in every field. The same value from a different
source is two pieces of evidence and both are kept, because collapsing them would destroy the only
thing that made corroboration meaningful.

Identity resolution is **AVG-6's**, not this slice's. Agreement between sources is agreement between
sources; it is not truth about a business.

### The AVG-1 Core gate is reused and remains the only eligibility authority

`evaluateEnrichmentReviewReadiness` calls `evaluateAcquisitionEligibility` directly. There is no copy
of the Core status map here, no second existing-vendor gate and no consent gate — a second
implementation would drift, and the drift would be discovered by somebody being contacted.

It reads the gate and **nothing else**. Claim count, evidence quality, corroboration and consistency
are not inputs, and a spec proves an empty profile and a rich, corroborated, fully consistent one
reach the identical verdict for every Core status. A profile whose every attribute conflicts is
exactly as reviewable as one that agrees, because conflicts are what a reviewer is for.

Exactly `NOT_REGISTERED` proceeds. Registered, active, inactive, dormant, former, previously
contacted, duplicate, do-not-contact, ambiguous, unknown and Core-unavailable all stop, as does a
malformed observation and one describing a different prospect. Absent Core truth is a stop, not a gap.

### REVIEWABLE is not permission

The success token is `ENRICHMENT_REVIEWABLE`, and it means one thing: a human may look at this
untrusted profile.

    REVIEWABLE is not CONTACT AUTHORIZED.
    REVIEWABLE is not EXECUTION ELIGIBLE.
    REVIEWABLE is not CONSENT.
    REVIEWABLE is not CORE ACTIVE.
    REVIEWABLE is not VERIFIED VENDOR.

There is no `canSend`, `canContact`, `contactApproved`, `authorized`, `permissionGranted`,
`eligibleToMessage` or `readyToExecute` anywhere in the package, and a spec asserts their absence
from the public surface. Core re-decides communications eligibility at execution time in a later
phase; a stale reviewable verdict is not a standing permission, which is why the verdict carries the
Core status it rests on rather than a bare boolean.

### One canonical schema per shape, and validation before the gate

Owner review found three ways the boundaries above could be walked around, and all three are closed
by construction rather than by convention.

**The exported schema now describes a BUILT value.** The first revision exported an input schema that
accepted any bounded string, so it certified a social URL under `PUBLIC_SOCIAL_PRESENCE` and a phone
number under `BUSINESS_DESCRIPTION` that the builder refused a moment later. `enrichmentClaimSchema`
and `enrichmentProfileSchema` are now the single canonical public schemas for built values, the
attribute/value rule lives in one function that both the schema and the builder call, and the input
schema is private. A contract that answers differently depending on which half a reader consults is
not a contract.

**Review readiness parses a canonical profile before consulting Core.** The first revision asked only
whether it had an object with a string `prospectRef` and an array called `claims` — which a forged
object carrying contact-bearing labels, a destination under a presence attribute, cross-prospect
claims or no contract version at all satisfies. It reached the Core gate and returned REVIEWABLE
whenever Core said `NOT_REGISTERED`. The order is now profile parse, then gate: consulting Core about
malformed data would also misrepresent what Core answered, since it would have decided about a
prospect reference no valid profile stood behind.

**Profile construction re-parses and rebuilds every claim.** TypeScript is erased at runtime and says
nothing about what actually arrives, so a declared `EnrichmentClaim[]` was no evidence at all. Claims
are validated against the canonical schema and rebuilt, with both levels frozen, so a caller mutating
an original claim, its source or the array afterwards cannot reach into an assembled profile.

The seven-or-more-digit contact screen is unchanged; the owner reviewed its conservatism and kept it.

## Authority

QuickFurno Core remains authoritative for registration, active/inactive/dormant/former status,
previous-contact truth, duplicate truth, do-not-contact truth, vendor identity, consent, suppression,
registration, activation, payment, package and commercial truth. None of it may be inferred from an
enrichment claim, a source, a confidence level, model output, conversation text, a provider receipt,
a delivery, memory, RAG or campaign state.

Aarohi owns genuinely net-new, unregistered vendor acquisition only. When Core authoritatively
confirms ACTIVE, ownership passes to Anisha through the AVG-1 handoff boundary, unchanged here.

## Non-goals

No discovery adapter, scraper, crawler, browser automation, directory client, social API, Meta,
WhatsApp or enrichment vendor. No persistence, database, store, repository or migration. No API
route, queue, scheduler or worker. No outreach, no drafting, no sending. No scoring or ranking —
AVG-3 owns scoring and outreach eligibility, and they are deliberately different things. No package
or pricing engine. No identity merge. No registration or payment. No change to the AVG-1 Core ACTIVE
handoff. No Riya change, no P09 change, no deployment change.

## Consequences

AVG-3 inherits a provenance-rich, fail-closed review input without inheriting any send authority. It
will have to bring its own scoring, and — separately, as the overlay insists — its own eligibility
decision, because nothing in AVG-2 has produced or can produce one.

The conservative label screen will occasionally refuse a legitimate string. That is the intended
direction of error and it is documented at the refusal, so an operator rephrases rather than
discovering later that a phone number was stored in a package holding no consent for it.

The public surface of `@qf-jarvis/aarohi-agent` grows from 28 to 49 exports. Every addition is a
contract, a closed vocabulary, a bound or a pure function; the package still depends on `zod` alone,
imports no workspace package, and no package or app imports it.
