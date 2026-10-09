- **Status:** Accepted
- **Date:** 2026-10-01
- **Owners:** QuickFurno / Jarvis
- **Scope:** AOS v2 marketplace intelligence, lead-delivery assurance, client value, vendor success, behaviour configuration and future bounded autonomy

## Context

QuickFurno is a lead-generation marketplace. Its initial delivery promise is not project management and not a long-running service-delivery workflow: an eligible client requirement is matched to an initial batch of three eligible vendors, and QuickFurno must be able to distinguish an assignment from an actual first client-vendor contact.

The existing repository already contains useful governed primitives: QuickFurno Core canonical events, a Core-owned client/vendor journey projection, client intelligence, Riya/Anisha/Aarohi agent boundaries, model-gateway composition, digital-twin simulation, approval/runtime foundations, proactive SHADOW scheduling and Jarvis OS. Replacing those with a second autonomous system would create contradictory truth and duplicate authority.

The legacy AOS scaffold is transitional. AOS v2 therefore composes existing resources into one marketplace-intelligence layer rather than making AOS another business authority or another low-code runtime.

## Decision

### 1. Core authority is unchanged

QuickFurno Core remains the source of business truth and the final business-decision authority.

AOS may observe, detect, correlate, rank, explain, simulate and recommend. It may not:

- mutate Core truth;
- approve its own recommendation;
- assign a vendor;
- expose a fourth or later vendor by itself;
- debit, credit or recharge a vendor account;
- send an unrestricted communication;
- infer consent, eligibility, availability, contact, payment or balance truth from a model;
- treat provider acceptance as business success; or
- create an alternative source of truth.

AOS v2 starts in **SUGGEST/SHADOW** only. There is no ACTIVE autonomous mode in this decision.

### 2. Lead delivery means contact, not assignment

The default initial exposure is three vendors.

An assignment-batch completion is never equivalent to successful contact. Lead handoff completion requires the existing Core-owned journey evidence to confirm that all three released vendors contacted the client.

A vendor-contact gap may produce an Anisha follow-up suggestion **only when Core supplies the exact opaque vendor assignment reference**. An aggregate client journey that merely says "one vendor has not contacted" is not enough to target Anisha and remains observation-only. Vendor follow-up uses a vendor-specific case; replacement uses a separate lead-level case. A replacement or any path that would expose a fourth or later vendor requires human review initially and still returns to Core for authoritative validation.

### 3. Source availability is explicit

AOS distinguishes code coverage from live-source coverage. Several canonical client/vendor event contracts in this repository are target contracts and QuickFurno Core does not emit them today. Their adapters may be implemented and tested, but they remain SOURCE_REQUIRED until a real authoritative source is connected.

The existing Core-backed client/vendor journey projection may be used immediately where it already supplies verified contact/satisfaction state. AOS must not fabricate missing vendor credit, balance, inactivity, retention, marketplace aggregate or timing facts merely because a target event contract exists.

### 4. Three coordinated intelligence loops

AOS v2 composes three related but separate journeys:

1. **Lead Delivery**
   - qualification/matching evidence comes from Core;
   - watch first-contact gaps;
   - recommend vendor follow-up;
   - recommend replacement review when the configured recovery policy is satisfied;
   - close the delivery objective only on verified contact evidence.

2. **Client Value**
   - client trust and satisfaction outrank expansion;
   - no proactive related-service suggestion before verified vendor contact and positive satisfaction;
   - related-service knowledge comes from governed service-blueprint/configuration data rather than hard-coded agent guesses;
   - every additional service becomes its own governed lead/requirement path.

3. **Vendor Success**
   - observe Core-derived inactivity, recharge opportunity, retention risk, win-back and future bounded balance/readiness signals;
   - recommend Anisha follow-up, recharge nurture, reactivation or success checks;
   - masked-demand reactivation may never disclose a client phone number before Core authorizes actual lead access;
   - Aarohi is used for supply acquisition when the problem is marketplace supply, not as a replacement for registered-vendor relationship management.

### 5. Business-goal precedence

AOS decisions use this precedence:

1. Trust and satisfaction
2. Successful lead delivery
3. Retention
4. Relevant expansion
5. Revenue

Revenue may never override a higher-order trust, consent, satisfaction, lead-delivery or communication guardrail. NO_CONTACT is a valid and expected next-best action.

### 6. Case engine, evidence and model routing

Raw observations are not sent individually to a model. Related signals are correlated into a bounded case.

The case is converted into a minimized evidence packet:

- source-bound facts;
- bounded policy references;
- no direct phone/email free text;
- no arbitrary database access;
- no claim that a model knows live Core state.

Routine deterministic cases use **NO_MODEL** whenever an approved behaviour policy already supplies a complete bounded recommendation. Governed model routing may select a routine or deeper reasoning route only when novelty, evidence conflict or criticality warrants it. An external monthly-spend snapshot may additionally suppress model routes as a cost circuit breaker; AOS never estimates authoritative provider spend from token counts.

Model output is a candidate only. It is constrained to a closed action vocabulary and is re-checked by the AOS critic. Unsupported or out-of-vocabulary output fails closed.

Case correlation context is bounded, revisioned and may be persisted separately from Core truth so evidence observed in different AOS cycles can be correlated without giving AOS a second business database. The unified shadow supervisor reuses this memory across canonical events, lead delivery, client intelligence, vendor success and marketplace slices.

### 7. Behaviour is configurable; capabilities stay coded

AOS capabilities, safety boundaries, action vocabulary, authority checks and integration adapters remain code-backed.

Operational behaviour is represented by governed policies:

- triggers;
- safe numeric conditions;
- city/locality/category scope;
- priority;
- cooldown;
- message frequency;
- quiet hours;
- owner-approval requirement;
- Core-decision requirement;
- masked-opportunity requirement; and
- the allowed recommendation action.

Policies are not arbitrary scripts and cannot create new action types.

The hard initial exposure boundary remains three vendors and cannot be weakened by a policy value.

### 8. Behaviour changes are versioned and simulated

Behaviour changes follow:

**Draft → Deterministic simulate + zero-effect Digital Twin → Owner approve → SUGGEST_SHADOW**

A runtime binding must identify:

- the exact manifest;
- exact manifest version;
- exact registry;
- exact policy versions;
- exact configuration digest;
- deterministic simulation evidence;
- zero-effect Digital Twin evidence with zero regressions; and
- owner approval bound to the same digest.

A changed digest invalidates the old approval.

### 9. Cross-signal correlation is required for sensitive growth actions

A related-service opportunity alone is insufficient for proactive client cross-sell.

AOS may recommend related-service outreach only when correlated evidence for the same client-growth case contains both:

- a positive client-satisfaction signal; and
- a governed related-service opportunity.

Existing Riya client-intelligence next-best-action logic is aligned to the same rule: all released vendors contacted plus positive satisfaction before proactive nurture.

### 10. Autonomy is earned per capability

There is no global AUTO switch.

Every capability accumulates outcome evidence including sample size, owner acceptance, successful outcomes, false positives, unsupported reasoning and policy violations.

The current maturity evaluator may at most mark a capability **eligible for an approval pilot**. It never grants production authority.

Future bounded autonomy requires a separate reviewed decision and must remain capability-specific.

### 11. Jarvis OS is the control plane, not the runtime

Jarvis OS exposes AOS architecture, policies, cases, evidence, evaluation and simulation.

The canvas does not execute business effects. Code-backed services do.

Visual and configuration surfaces must distinguish:

- AOS recommendation;
- human review;
- Core authorization;
- Automation Worker execution; and
- agent communication.

A direct AOS → execution edge is forbidden.

## Consequences

- QuickFurno can evolve AOS behaviour without rewriting workflow code for each threshold or city.
- Core remains stable and authoritative.
- Model cost scales with cases that need reasoning, not with every marketplace event.
- Lead delivery, client growth and vendor success reuse one governed intelligence substrate.
- Client cross-sell is deliberately slower than raw opportunity discovery because satisfaction is a hard trust gate.
- AOS v2 can be evaluated on real traffic in shadow without changing production business behaviour.
- Legacy AOS pieces may be retired only after the new shadow path proves equivalent or better coverage and no required consumer depends on them.

### 12. Reuse the existing Jarvis governance stack; do not build a second autonomy framework

AOS v2 composes the strongest existing Jarvis primitives instead of introducing another agent framework.

**JAO-5 / proactive worker.** The existing proactive worker remains the governed scheduler boundary for ambient SHADOW work: bounded cadence, sequential cycles, failure budget and dormant-by-default operation. JAO-5's reviewed business scope is **not widened** by this ADR; its canonical monitors remain system-health monitors. AOS v2 runs as a separately typed SHADOW supervisor cycle in the same proactive worker after the JAO-5 cycle. This reuses the reviewed process/cadence boundary without falsely claiming that JAO-5 has acquired lead, client, vendor or payment authority.

**Model Intelligence Control.** AOS model reasoning must route through exact capability profiles and verifier-backed ACTIVE model-release certification. Deterministic cases remain NO_MODEL. When reasoning is warranted, adaptive complexity selects from reviewed releases (for example a fast routine release before a stronger complex release) rather than allowing AOS to name an arbitrary provider/model. Missing certification or a missing exact invoker fails closed. Existing WhatsApp agent release certification for `RESPONSE_GENERATION` is not automatically AOS certification: AOS requires a reviewed capability profile/evaluation for its bounded structured recommendation task before a live AOS model binding may be enabled.

**Decision Intelligence / TypeSafe Jev.** Jev is an optional second-opinion provider, not the AOS brain and not an authority layer. Adjudication is reserved for critical, novel, conflicting, low-confidence or already-owner-reviewed cases. It may agree with the current recommendation or force a human-review hold. It may never substitute a different action into execution. Provider failure, malformed output, uncertainty or disagreement fails to human review. Jev remains separately configured and may stay disabled in production while the integration contract is exercised in SHADOW.

**Digital Twin.** Every behaviour-policy revision requires zero-effect Digital Twin rehearsal in addition to the existing deterministic simulation. Rehearsal permits zero provider calls, Core mutations, channel sends, workflow starts or database writes. A regression prevents the candidate from becoming eligible for owner review. Passing rehearsal still does not activate the policy; exact owner approval remains required.

**Canonical Recommendation Runtime.** AOS advice that survives critic/adjudication may be projected into the existing canonical recommendation runtime. The projection creates an inert fingerprintable recommendation only. AOS case identity is converted to a stable contract UUID correlation identity without weakening the canonical UUID contract. Recommendations on adjudication hold are not projected. Projection failure fails closed and is counted.

**Owner attention observation.** The SHADOW supervisor may publish a content-minimized atomic observation file for Jarvis OS containing only opaque case reference, priority, attention lane/score, bounded reason codes, owner-review posture and an optional closed recommendation action. The observation contract pins `outboundNotificationAuthorized=false`, `executionAuthority=NONE` and `businessEffect=false`, refuses contact-like case references and has no destination, phone, email, message body, consent state or authorization field. Jarvis OS may merge a fresh validated snapshot into its global attention center and AOS page. Missing, malformed or stale snapshots are represented as unavailable/stale rather than as zero findings. Owner WhatsApp and scheduled digest delivery remain NOT CONNECTED until a separately reviewed Core-authorized recipient/content/channel path exists; AOS itself never sends.

**JAO-6.** The existing JAO-6 business-action proposal proof is not generalized by this ADR. Its currently reviewed public policy is a specific vendor-follow-up class in OFFLINE_SHADOW_PROOF posture and does not cover the full AOS action vocabulary. A future change may map a reviewed AOS action class into JAO-6 only after that exact class, parameters, risk and approval path are reviewed.

**JAO-2 and JAO-7.** AOS does not invoke Riya, Anisha or Aarohi through JAO-2 in this phase, and JAO-7 advanced autonomy is not activated. Agent communication remains downstream of Core authorization. These capabilities may be evaluated later as separate authority reviews; their existence is not evidence that AOS may use them.

**Knowledge.** Governed Knowledge is not a source of live marketplace truth. AOS detection and business-state validation use Core events/projections. Knowledge may later explain stable policy/service context, but it cannot establish current price, availability, balance, assignment, contact or consent state.

The resulting recommendation chain is:

**Core evidence → deterministic AOS sentry/case engine → cost-aware certified model route when needed → AOS critic → optional Jev adjudication for sensitive cases → canonical recommendation → owner/Core review → existing approval/execution boundaries.**

Digital Twin is the separate policy-governance lane: every behaviour revision must pass deterministic simulation plus zero-effect Digital Twin regression rehearsal before it can become eligible for exact owner approval and `SUGGEST_SHADOW` binding.

No edge in that chain gives AOS an execution intent, communication authorization or business mutation capability.
