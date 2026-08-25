# ADR-0112 — QFJ-P12 / QVGE AVG-3: Aarohi scoring and outreach-eligibility domain

**Status:** Accepted — offline domain only. No runtime, persistence, discovery adapter, outreach
workspace, drafting, provider, channel, credential, execution path, migration or rollout is activated
by this decision. Aarohi remains **PLANNED / DISABLED**.

**Date:** 2026-08-25

**Supersedes:** nothing. ADR-0085 remains the governing Aarohi authority boundary. ADR-0111 remains
the canonical AVG-2 discovery/enrichment decision.

---

## Context

AVG-2 gives Aarohi a canonical enrichment profile containing only provenance-bound, untrusted
reference material. It deliberately stops before scoring and before contact eligibility.

AVG-3 has two jobs that are dangerous if represented by one number:

1. rank prospects so a later human-facing workspace can order work; and
2. decide, separately, whether the prospect currently passes QuickFurno Core's cold-acquisition gate.

A high score must never become permission. Equally, Core eligibility must not silently become a
quality score. The two decisions therefore need different inputs and different outputs.

## Decision

### 1. V1 scoring measures evidence readiness, not truth or predicted conversion

Add a deterministic `evaluateProspectPriority` pure function over one canonical AVG-2 profile.

The V1 scale is deliberately **0–9: one point per governed enrichment attribute**. It measures how
much non-conflicting review material is present and does **not** embed city, category, package, price,
revenue, lead-volume or conversion preferences. AVG-3 has no governed source for business-targeting
truth, so relative weights would be an undocumented commercial policy.

A label earns one point only when the surviving canonical claims for that attribute are `CONSISTENT`.
A presence attribute earns one point only when the one consistent value is `OBSERVED`.

`INSUFFICIENT`, `CONFLICTING` and `NOT_OBSERVED` earn zero.

Evidence quality and source count are not multipliers. They remain unverified evidence metadata.
Using them to break a conflict would turn the scorer into an identity/truth resolver, which belongs
elsewhere.

A malformed or non-canonical profile returns `PROFILE_INVALID`. The function reads no Core state.

### 2. Contact eligibility accepts no score

Add `evaluateAcquisitionContactEligibility(profile, coreObservation)`.

Its signature contains no priority assessment. It first parses the canonical AVG-2 profile and then
delegates to the existing AVG-1 `evaluateAcquisitionEligibility` gate.

That means the only proceed state remains Core `NOT_REGISTERED`. Every other governed Core status
continues to fail closed:

- registered/active/inactive/dormant/former/duplicate -> existing Core relationship;
- previously contacted or do-not-contact -> Core suppression;
- ambiguous/unknown/Core unavailable -> unresolved Core truth;
- malformed or cross-prospect observations -> invalid observation.

AVG-3 does not create a second status map and does not copy suppression state.

The roadmap mentions prior rejection as a stop. Aarohi does not invent a local rejection token.
Any authoritative prior-rejection state must arrive through Core as a governed relationship or
suppression outcome; if Core cannot resolve it, the existing unresolved states already stop.

### 3. Eligibility is point-in-time, not execution authority

The successful token is `CONTACT_ELIGIBLE`, but it is only the result of the current Core gate and a
prerequisite for later AVG-4 work.

It is not a standing permission to send, not consent, not a destination, not provider approval and not
an execution command. Core remains responsible for re-evaluating eligibility at the later execution
boundary.

Nothing in AVG-3 sends or drafts a message.

### 4. The separation is testable

The contract must continue to permit both of these states:

- maximum priority + Core `DO_NOT_CONTACT` -> contact eligibility **false**;
- 0 priority points + Core `NOT_REGISTERED` -> contact eligibility **true**.

If either case becomes impossible, scoring has leaked into authority or authority has leaked into
scoring.

## Public surface

AVG-3 adds a versioned pure-domain surface to `@qf-jarvis/aarohi-agent`:

- `AAROHI_AVG3_CONTRACT_VERSION`
- `PROSPECT_PRIORITY_MAX_POINTS`
- `PROSPECT_PRIORITY_REFUSALS`
- `evaluateProspectPriority`
- `CONTACT_ELIGIBILITY_OUTCOME`
- `CONTACT_ELIGIBILITY_REFUSALS`
- `evaluateAcquisitionContactEligibility`

The runtime barrel deliberately uses `priority` and `contact eligibility` language rather than
authority-shaped send/approval names. Type exports carry the corresponding immutable result shapes.

## Containment

Unchanged:

- no Aarohi runtime;
- no persistence or migration;
- no marketplace mutation;
- no model call;
- no discovery adapter or scraper;
- no channel/provider credential;
- no Meta/Instagram/WhatsApp/n8n integration;
- no message drafting or delivery;
- no package/pricing truth;
- no identity resolution;
- no production activation.

AVG-4 owns the later human-facing outreach workspace. Later channel stages remain separate.

## Tests required by this decision

The AVG-3 suite locks:

- the maximum equals the nine governed AVG-2 attributes;
- no hidden per-attribute weighting;
- empty canonical profile -> 0;
- full consistent/observed profile -> 9;
- `NOT_OBSERVED` presence -> 0 for that attribute;
- conflicts never earn points;
- source count/evidence-quality labels do not multiply points;
- evidence order cannot change the result;
- malformed profiles fail closed;
- the exact AVG-1 Core allowlist is reused;
- suppressed, existing, unresolved and cross-prospect Core observations fail closed;
- maximum priority cannot bypass Core suppression;
- 0 points cannot be converted into a Core refusal merely because it is low;
- the scoring and eligibility function signatures remain separate;
- the package barrel remains exact and the package remains unconsumed by runtime code.

## Consequences

AVG-3 now has an auditable offline domain suitable for a future review workspace, while Aarohi itself
remains disabled.

This decision does **not** make outreach operational. AVG-4 and later stages still require their own
design, review and activation decisions.
