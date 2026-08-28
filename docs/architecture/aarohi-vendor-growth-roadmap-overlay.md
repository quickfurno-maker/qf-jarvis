# Aarohi — Vendor Growth and Acquisition: QVGE capability overlay (AVG-0 … AVG-12)

**Document status:** Canonical for the QuickFurno Vendor Growth Engine capability overlay. Adopted under [ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md). Read with [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), [agent-constitution.md](../governance/agent-constitution.md) and [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md).

**Runtime status: PLANNED / DISABLED.** There is no Aarohi runtime, no prospect store, no enrichment
pipeline, no outreach, no provider or channel credential, no Meta API call, no Instagram transport, no
WhatsApp integration, no n8n execution and no managed persistence in this repository. Production
rollout remains **OFF**, and no package or application imports the Aarohi package at all.

**Offline DOMAIN status.** This overlay once said "nothing here is implemented", which stopped being
true at AVG-1. What exists is contracts and pure functions over frozen values:

- **AVG-0 through AVG-10 — implemented as certified offline domains**
  ([ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md),
  [ADR-0111](../decisions/ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md),
  [ADR-0112](../decisions/ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md),
  [ADR-0113](../decisions/ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md),
  [ADR-0122](../decisions/ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md),
  [ADR-0123](../decisions/ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md),
  [ADR-0124](../decisions/ADR-0124-qfj-p12-avg7-aarohi-sales-brain-offline-domain.md),
  [ADR-0125](../decisions/ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md),
  [ADR-0126](../decisions/ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md),
  [ADR-0127](../decisions/ADR-0127-qfj-p12-avg10-aarohi-payment-activation-handoff-offline-domain.md)).
- **AVG-11 — offline implementation proof defined by
  [ADR-0128](../decisions/ADR-0128-qfj-p12-avg11-aarohi-analytics-admin-dashboard-offline-domain.md).**
  It adds a READ surface and no reading: no live Core read, runtime, model call, prompt resolution,
  retrieval, provider, channel, transport, persistence or execution activation, no admin write, and
  no evidence source of any kind is connected. The wire additions are versioned as control-plane
  **V2** ([ADR-0129](../decisions/ADR-0129-avg11-control-plane-read-contract-v2.md)) with V1 left
  unchanged. The Jarvis OS Aarohi section stays `PLANNED`.
- **AVG-12 — offline implementation proof defined by
  [ADR-0130](../decisions/ADR-0130-qfj-p12-avg12-aarohi-scale-evaluation-controlled-autonomy-offline-domain.md).**
  It adds an offline evaluation and red-team corpus, a bounded-volume proof at maxima the sibling
  contracts already declare, and controlled autonomy that increases OFFLINE decision freedom and no
  business authority. No live Core read, runtime, model call, prompt resolution, retrieval, provider,
  channel, transport, persistence, migration, rollout or execution activation, and no control-plane
  wire change: V1 and V2 are both untouched.

**The AVG-0 through AVG-12 OFFLINE IMPLEMENTATION sequence is complete, and the separate full
Aarohi OFFLINE certification closeout has been performed under
[ADR-0131](../decisions/ADR-0131-qfj-p12-aarohi-full-offline-certification-closeout.md).** Every
stage above is an offline domain — contracts and pure functions over frozen values — and the closeout
is what weighed them TOGETHER: a cross-stage adversarial suite proving that no artifact gains
authority by crossing a stage boundary, that unknown never becomes zero, and that shape validity is
never mistaken for provenance.

**That certification establishes exactly one sentence, and nothing beyond it:** Aarohi AVG-0…AVG-12
is internally coherent and contained as an OFFLINE domain implementation. It is not
production-readiness, runtime enablement, rollout, contact permission, consent, a live QuickFurno
connection, a provider connection, payment, activation, or any throughput or capacity claim. **The
real execution integration and the staged activation each remain a later, separately governed owner
decision, and neither may cite the offline certification as authority.** The two deliberate AVG-10
gaps remain unresolved and remain blockers for that live-integration decision.

Recording a capability is still not implementing one, and implementing an offline domain is still not
activating anything.

**Merge and certification state is tracked by repository history and owner review, not written down
here.** A canonical architecture document that encodes the state of a branch is a document that
becomes false the moment that branch lands, and then needs repairing by somebody who remembers it
exists. What belongs here is architecture, runtime posture and capability boundaries — all of which
read the same before and after any particular merge.

---

## What this overlay is, and what it is not

**AVG identifiers are overlay ids owned by QFJ-P12 — Advanced Intelligence and Future Agents.**

They are **not** phases. They add no major phase, renumber nothing, and **there is no QFJ-P13**.
`QFJ-P00`–`QFJ-P12` are unchanged. An AVG id names a bounded capability slice so that future work can
be scoped, reviewed and argued about one piece at a time; it confers no authority, allocates no
migration number, and authorizes no provider, channel or activation.

Recording a capability is not implementing one. Every stage below is **PLANNED / DISABLED** until a
later ADR explicitly activates it, and each will need its own design, contract audit and approval.

## Agent identity

| Field | Value |
| --- | --- |
| Canonical agent | **Aarohi — Vendor Growth and Acquisition Agent** |
| Subsystem | **QuickFurno Vendor Growth Engine (QVGE)** |
| Jarvis OS section | **Aarohi — Vendor Growth** |
| Historical alias | `ANI-COLD-AQUI` — **non-canonical / retired**; never an identifier, capability id, namespace or routing key |
| Roadmap owner | **QFJ-P12** |
| Runtime status | **PLANNED / DISABLED** |
| RAG namespace | `AAROHI` (reserved; never cross-read) |

## The boundary that defines this agent

Aarohi owns **genuinely net-new, unregistered vendor acquisition, through to authoritative
paid/active conversion.** The boundary is drawn at **registration status as QuickFurno Core reports
it** — not at conversation topic, not at channel, and not at which agent spoke first.

**Handoff at ACTIVE.** When QuickFurno Core authoritatively confirms ACTIVE, Aarohi stops acquisition
selling and primary vendor relationship ownership moves to **Anisha**. The trigger is Core's
authoritative confirmation — never a provider receipt, a model's reading of a conversation, or a
message claiming payment.

**Existing-vendor gate.** If Core says the discovered party is **registered, active, inactive,
dormant, former, previously contacted, duplicate or do-not-contact**, Aarohi must **not** create a
second cold-acquisition relationship. Route according to Core truth. Absent or ambiguous Core truth is
a **stop**, not a proceed.

## Permanent authority ceiling (binds every stage below)

- **QuickFurno Core is the final business, commercial, identity, consent, payment and activation
  authority.** Aarohi never replaces, duplicates or bypasses it.
- **Aarohi holds no consent, opt-out, suppression, STOP or do-not-contact authority**, and stores no
  copy of one. Core decides eligibility, and re-decides it at execution time.
- **Aarohi never mutates QuickFurno marketplace tables**, and never calls a provider or n8n directly.
  Approved execution goes Core/human → n8n → provider.
- **Commercial truth — packages, entitlements, pricing, discounts, offers — comes from Core**, never
  from a model, never from RAG, and never from an enriched or scraped source.
- **A request carries no authority** ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md)).
- The sales-ethics prohibitions that bind Anisha bind Aarohi identically: no guaranteed lead volume,
  revenue or conversion; no invented discount, price change, urgency or scarcity; no hidden package
  limitation; no unsupported social proof; no contact after rejection or opt-out; no binding
  contractual commitment.

---

## The overlay

### AVG-0 — Architecture and Governance
The governing decision, agent identity, the permanent split against Riya/Anisha/Jarvis, the ACTIVE
handoff, the existing-vendor gate, and the authority ceiling above. **This stage is what
[ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md)
records.** Later AVG stages may have certified offline-domain implementations, as tracked in the
Offline DOMAIN status above; runtime activation remains PLANNED / DISABLED for every stage unless
separately authorized.

### AVG-1 — Prospect Identity and Acquisition Case Domain
A prospect identity distinct from a Core vendor identity, and a durable acquisition case. A prospect
is explicitly **not** a vendor: no prospect record may shadow, pre-empt or become a second source of
vendor truth, and Core remains authoritative the moment a party is registered.

### AVG-2 — Discovery and Enrichment
Sourcing candidate businesses and enriching them into a reviewable profile. Enriched content is
**untrusted reference material** — it never establishes consent, never proves identity, and never
grants eligibility to contact. The existing-vendor gate is checked against Core before a candidate is
eligible for anything downstream.
**The offline DOMAIN for this stage is recorded by
[ADR-0111](../decisions/ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md)** — contracts and
pure functions only. Recording a capability is not implementing one: there is still no discovery
adapter, no scraper, no persistence, no scoring and no outreach, and the runtime status above is
unchanged.

### AVG-3 — Scoring and Outreach Eligibility
Ranking prospects, and — separately — deciding whether outreach is permitted at all. **Scoring and
eligibility are deliberately different things:** a high score never implies permission. Eligibility is
fail-closed and Core-gated; do-not-contact, prior rejection, duplication and existing registration all
resolve to "no".

**The offline DOMAIN for this stage is recorded by
[ADR-0112](../decisions/ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md)**.
V1 priority is deterministic evidence-readiness scoring over canonical AVG-2 material; contact
eligibility is a separate point-in-time reuse of the AVG-1 Core gate and accepts no score input.
There is still no runtime, persistence, workspace, drafting, channel, provider, credential, execution
or rollout, and Aarohi remains **PLANNED / DISABLED**.

### AVG-4 — Outreach Workspace
The human-facing surface for reviewing prospects, drafting approved outreach, and requesting
authorization. Drafting is not sending. Nothing leaves the workspace without Core/human authorization
and an approved execution path.

**The offline DOMAIN for this stage is recorded by
[ADR-0113](../decisions/ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md)**.
It defines review items that keep evidence, priority and Core eligibility separate; immutable
OPEN/HELD/REJECTED draft revisions; and a fail-closed boundary that can say only
`READY_FOR_CORE_APPROVAL_REQUEST`. It creates no approval request or decision itself. Owner review also closes the older generic case
transition into `CONTACT_APPROVED`; a future entry must be bound to Core's authoritative approval.
There is still no Control Plane UI, persistence, model generation, channel, provider, credential,
execution path or rollout, and Aarohi remains **PLANNED / DISABLED**.

### AVG-5 — Instagram Conversation Integration
Governed inbound/outbound conversation on Instagram. Delivery remains provider-side and execution
remains n8n-side; Aarohi holds no provider credential and calls no Meta API. Consent and eligibility
are Core's, revalidated at execution time.

**The offline DOMAIN for this stage is defined by
[ADR-0122](../decisions/ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md) and
carried by PR #164.** Runtime remains PLANNED / DISABLED; this capability description claims no
deployment and no production activation. Exact first-proof boundaries:

- **The shared executable channel vocabulary is deliberately NOT widened.**
  `COMMUNICATION_CHANNELS` remains `whatsapp`, `sms`, `email`, `voice`, and AVG-5 adds no member.
  Membership there is the set of channels a `CommunicationRequestV1` may name, which pulls a channel
  into the delivery lifecycle's `provider-accepted` and `delivered` states — states nothing here
  could honestly assert for Instagram. AVG-5 uses an Aarohi-LOCAL token instead. **Adopting a real,
  executable Instagram channel is QFJ-P09's separately reviewed work**, in line with the sequencing
  decision to finish AVG-5..AVG-12 before the live QuickFurno execution integration.
- **Inbound is an untrusted OBSERVATION.** Bounded, normalized, never interpreted, and stamped
  `INJECTED_OFFLINE_INSTAGRAM_OBSERVATION` — a caller's offline report, not authenticated provider
  output. It has no field for consent, opt-out, STOP, identity, registration or delivery, and nothing
  reads the message text to conclude one.
- **The conversation snapshot is immutable, finite, deduplicated by message reference and canonically
  ordered** by `observedAt` then message reference. Array position carries no chronological claim.
  There is no OUTBOUND turn direction, so an outbound candidate can never be recorded as though it
  had been said.
- **Channel-local identity is not identity.** A participant reference is a handle on one channel,
  never a Core vendor id and never a cross-channel identity; the binding is labelled
  `CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING`. Resolution and the WhatsApp transition remain AVG-6's.
- **Continuation reuses the AVG-1 Core gate** and restates none of it. Exactly `NOT_REGISTERED`
  continues review; every other status stops, including `ACTIVE`, and continuation is not contact or
  send eligibility.
- **Outbound is a CANDIDATE built from a canonical AVG-4 OPEN draft**, carrying that draft's own
  words and exact revision — there is no body field on the builder's input. The CURRENT Core gate is
  re-run every time, so a stale eligible review and a high priority both decide nothing.
- **The single positive outcome is `READY_FOR_FUTURE_CORE_INSTAGRAM_COMMUNICATION_PATH`**, and every
  candidate states as a machine-checked literal `false` that no communication request, approval
  request, approval decision, communication authorization or execution intent was created, that no
  provider, Meta API or n8n was asked for anything, and that nothing was sent or delivered.
- Zero Meta API calls, n8n executions, provider sends, channel sends, model calls, persistence,
  managed migrations, production entries and new third-party dependencies.

### AVG-6 — Omnichannel Identity and WhatsApp Handoff
Resolving one prospect across channels, and the transition from Instagram to WhatsApp. Identity
resolution is evidence-based and reviewable; a merge is a recommendation, never a silent rewrite of
who someone is. WhatsApp remains QuickFurno's existing approved infrastructure and is not activated
here.

**The offline DOMAIN for this stage is defined by
[ADR-0123](../decisions/ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md).**
Runtime remains PLANNED / DISABLED; this capability description claims no deployment and no
production activation. Exact first-proof boundaries:

- **A merge is a RECOMMENDATION, and there is no function that merges anything.** No
  `mergeIdentities`, no `resolveIdentity`, no field that could record that a merge happened:
  `identityMerged`, `coreIdentityMutated`, `identityVerified` and `consentEstablished` are pinned
  `false` by a strict schema. A recommendation carries the exact evidence references it rests on, so
  a human can read the same evidence and disagree.
- **No destination is stored, under any name.** A WhatsApp participant reference is an opaque
  channel-local handle screened three ways: an opaque character class, the same contact shapes AVG-2
  uses, and a count of digits anywhere in the reference — so a phone number, an E.164 string, a
  `wa.me` link, an address, a bare run of digits or a run split by `_` or `:` cannot enter the
  package. The same three screens apply to `sourceRef`, so provenance is not a side channel.
  Resolving a recipient stays Core's, at execution time.
- **Identity evidence is untrusted, bounded and reviewable.** Claims say only SUPPORTS or
  CONTRADICTS, carry the posture `INJECTED_OFFLINE_IDENTITY_EVIDENCE`, and hold no message text, no
  consent, no Core identity and no confidence number. The bundle is immutable, capped, deduplicated
  and canonically ordered by the semantic UTC instant; its public parser certifies the whole
  aggregate rather than a bag of valid claims.
- **The recommendation policy is deterministic and closed.** A positive link needs two independent
  corroborating legs from distinct sources, at least one stronger than public corroboration, and no
  contradiction at all. Unrecorded provenance contributes nothing. There is no threshold, no score
  and no model. Everything else is `REVIEW_REQUIRED` — a person looking. A recommendation whose own
  instant precedes the latest evidence it names is refused outright rather than filed as a judgement.
- **The WhatsApp CHANNEL handoff is not the Anisha OWNERSHIP handoff**, and the names say so. AVG-6
  transitions no acquisition case, never calls `completeCoreActiveHandoff`, and states
  `acquisitionCaseMutated: false` and `anishaHandoffExecuted: false`.
- **The candidate binds a canonical AVG-5 conversation, the canonical evidence bundle and a positive
  recommendation it re-derives from that bundle.** A parsed artifact is not a policy proof, so the
  deterministic policy is re-run and must reproduce the supplied recommendation exactly, evidence
  references included; a forged positive naming invented evidence builds nothing. The candidate
  carries no message, template or number, and re-runs the CURRENT Core gate — so identity evidence
  never becomes acquisition permission and a stale eligible observation decides nothing.
- **What is still owed is stated:** Core must resolve the recipient, revalidate consent and
  revalidate eligibility at execution time, all three as literals on the candidate.
- **The shared governed channel vocabulary is unchanged.** `whatsapp` was already a member and stays
  one; naming the destination channel of a transition is not activating it, and adopting the real
  execution path remains QFJ-P09's separately reviewed work.
- Zero Meta API calls, WhatsApp sends, n8n executions, provider sends, channel sends, model calls,
  persistence, managed migrations, production entries and new third-party dependencies.

### AVG-7 — Aarohi Sales Brain
The conversation and objection-handling behaviour for acquisition. Bounded by the same sales-ethics
prohibitions as Anisha, and by the rule that **the brain proposes and Core disposes** — no commercial
commitment originates in the model.

**The offline DOMAIN for this stage is defined by
[ADR-0124](../decisions/ADR-0124-qfj-p12-avg7-aarohi-sales-brain-offline-domain.md).** Runtime
remains PLANNED / DISABLED; this capability description claims no deployment and no production
activation. Exact first-proof boundaries:

- **A "sales brain" that makes no model call.** The precedent is Anisha's and Riya's: a deterministic
  behaviour package decides whether a model boundary may later be used, and calls no model itself.
  QF Model Gateway remains the sole future model waist and Prompt Registry the sole future governed
  prompt mechanism; AVG-7 imports neither, depends on neither and names no provider. The boundary is
  proved before the model is attached, because a boundary proved afterwards is proved too late.
- **The interpretation is INJECTED, model-shaped and untrusted.** A strict, closed structure a future
  gateway response could be parsed into, stamped
  `INJECTED_OFFLINE_SALES_BRAIN_INTERPRETATION` — never provider-authenticated, Core-verified,
  commercial, consent, identity, registration, payment or activation truth.
- **It is bound to the CURRENT canonical inbound turn.** All four conversation references plus the
  exact message reference of the latest turn of an AVG-5-certified snapshot, which the caller cannot
  name: no message field, no index, no "latest" flag. Appending a newer turn makes an existing
  reading stale by construction, and a stale reading is refused rather than replayed.
- **Time causality is semantic UTC**, in both links of the chain: message `observedAt` ≤ reading
  `interpretedAt` ≤ plan `plannedAt`. No wall clock is read.
- **The CURRENT Core gate is re-run**, exactly `NOT_REGISTERED` proceeds, and no interpretation,
  objection or priority bypasses it.
- **A rejection or contact-privacy signal outranks selling**, from either vocabulary, including on a
  mixed commercial signal. The brain stops locally and asks Core to re-decide contact policy — it
  claims nothing about consent or suppression, which stay Core's.
- **Commercial questions stop at "Core facts required."** Price, package, discount, offer and
  entitlement are AVG-8's and Core's; the plan carries none and is not draftable without them.
- **Registration, payment and activation stop at "Core process truth required"** — AVG-9's and
  AVG-10's. No registration, payment or activation is claimed or mutated, and no Anisha handoff.
- **Ordinary objections become a reply BRIEF, never a reply.** Closed strategy and obligation tokens
  only. There is no field anywhere that can hold a sentence, so no price, guarantee, invented
  deadline or unsupported claim has anywhere to appear.
- **`futureModelDraftEligible` is explicit and powerless**: a later governed composition MAY ask for
  a draft. It is false for every strategy still waiting on a fact Core has not supplied.
- **Every sales-ethics prohibition is a `z.literal(false)` on the plan** — commitment, commercial
  truth, price, discount, lead-volume/revenue/conversion guarantees, invented urgency, invented
  scarcity, unsupported social proof, **hidden material package limitation**, contractual
  commitment. The one ceiling member without a literal is "no contact after rejection/opt-out",
  which the strategy precedence enforces instead.
- **References carry two roles, and only one of them is AVG-7's to screen.** Bindings inherited from
  certified AVG-1 and AVG-5 artifacts keep the upstream opaque grammar untouched — a numeric
  provider identifier is an identifier, and a downstream stage may not narrow a grammar it does not
  own. AVG-7's own `interpretationRef` and `planRef` additionally carry the contact shapes and a
  count of digits anywhere, so a destination cannot be smuggled into the two references AVG-7
  invents.
- Zero model calls, prompt resolutions, retrievals, Meta API calls, n8n executions, provider sends,
  channel sends, communication requests, approvals, authorizations, execution intents, acquisition
  case transitions, persistence, managed migrations, production entries and new third-party
  dependencies.

### AVG-8 — Commercial Truth and Package Engine
Packages, entitlements and pricing presented during acquisition, **sourced from Core**. The engine
selects and explains what Core already holds; it does not invent, adjust, discount or interpret price.
Model and RAG output is never a commercial source.

**The offline DOMAIN for this stage is defined by
[ADR-0125](../decisions/ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md).**
Runtime remains PLANNED / DISABLED; this capability description claims no deployment, no live Core
read and no production activation. Exact first-proof boundaries:

- **The READ surface is mirrored, not the table behind it.** QuickFurno's `packages` table has nine
  columns; its available-package read service exposes seven, omitting `created_at` and
  `price_per_lead`. This contract models those seven exactly, in Core's own field names, because
  renaming `display_price` into something like a list price would be the first act of interpretation.
  `price_per_lead` is absent twice over: not read, and never calculated from the two prices that are
  present.
- **Both prices are preserved and neither is explained.** `total_price` and `display_price` are
  copied exactly and independently, in all three directions. Nothing subtracts them, divides them, or
  names the difference — calling it a discount would invent a promotion Core never authorised.
- **Selection is identifier lookup, never a choice.** Two scopes: the whole available catalog, or one
  exact package id. There is no cheapest, best-value, most-suitable or recommended, and no input for a
  budget, a desired lead count or an optimisation target. An unknown id is refused with no fallback.
- **Canonical order is by package id, and that is serialization rather than ranking.** A spec asserts
  it disagrees with lead-count order and with both price orders, because the first row of a
  price-sorted list is a recommendation whether or not anybody calls it one.
- **The AVG-7 plan is RE-DERIVED, never believed.** A commercial brief re-runs AVG-7's own public
  evaluator over the same conversation, interpretation and CURRENT Core observation, and requires an
  exact field-for-field reproduction — which carries AVG-7's latest-turn binding, causal chain and
  fresh Core gate across for free. Only an honestly re-derived `REQUEST_CORE_COMMERCIAL_CONTEXT`
  proceeds.
- **The facts must answer the request, not predate it.** `plan.plannedAt ≤ catalog.observedAt ≤
  brief.preparedAt`, by semantic UTC instant. A catalog observed before the request is not standing
  commercial permission.
- **A closed fact BRIEF, and no sentence anywhere.** No explanation, summary, pitch or reply field.
  The explaining belongs to a later governed composition grounded in these facts.
- **A snapshot is an observation, not an offer.** `snapshotSourceAuthenticated: false` and
  `requiresCoreCommercialRevalidationBeforeFutureOutboundUse: true` on every brief, and the AVG-7
  plan it rested on is not rewritten.
- **`lead_count` is a Core entitlement fact, never a delivery promise.** AVG-7's lead-volume, revenue
  and conversion guarantees stay pinned false.
- Zero live Core reads, Supabase clients, QuickFurno imports, model calls, prompt resolutions,
  retrievals, package orders, payments, credit grants, activations, communication requests,
  approvals, authorizations, execution intents, provider or channel sends, persistence, managed
  migrations, production entries and new third-party dependencies.

### AVG-9 — Registration Integration
Guiding a converted prospect into QuickFurno registration. Registration is performed by Core; Aarohi
assists and observes. No marketplace mutation occurs from this side.

**The offline DOMAIN for this stage is defined by
[ADR-0126](../decisions/ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md).**
Runtime remains PLANNED / DISABLED; this capability description claims no deployment, no live Core
read, no registration and no production activation. Exact first-proof boundaries:

- **Core owns registration, and this side has no route to it.** QuickFurno's registration surface is
  a WRITE — one service function taking a business name, a phone number, an email address and a GST
  number. It is named in the containment scan so it cannot be called, its input type is banned by
  name, and no field anywhere in the domain could hold what it takes.
- **There is no Core registration-process READ contract, so none is mirrored — and none is
  invented.** AVG-8 could mirror seven fields because Core exposed seven fields. At the inspected
  commit Core exposes no service, route or API answering "what does registering involve", so this
  stage carries a closed AVAILABILITY token and an OPAQUE reference to Core-authored material, and
  holds no step, requirement, document list, verification flag, endpoint or duration. The honest
  answer to an absent contract is a reference, not a plausible five-step wizard.
- **Only a registration question is admitted, and the strategy alone does not settle that.** AVG-7
  routes both `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` to `REQUEST_CORE_PROCESS_CONTEXT`,
  so the re-derived INTENT is checked as well and a payment or activation plan is refused by name.
  Payment and activation remain AVG-10's.
- **The AVG-7 plan is RE-DERIVED, never believed, and compared structurally.** The comparison walks
  the recomputed artifact's own keys rather than an enumerated field list, so a governed field added
  to AVG-7 later is compared rather than silently ignored. Re-derivation carries AVG-7's latest-turn
  binding, its causal chain and the CURRENT AVG-1 existing-vendor gate across, and AVG-7's own
  refusal is surfaced rather than flattened, so a stale reading and a suppressed prospect stay
  distinguishable.
- **Exactly `NOT_REGISTERED` proceeds.** A prospect Core now reports as registered, active,
  suppressed or unresolved yields no brief, however interested the conversation sounds — and
  interest, priority and identity evidence are not inputs to the gate in the first place.
- **The context must answer the request, and belong to it.** The observation is bound to the
  prospect and to the Core lookup the gate ran under, and `plan.plannedAt ≤ context.observedAt ≤
  brief.preparedAt` by semantic UTC instant. When Core holds no process context there is no
  fallback, no default and no guess.
- **A closed BRIEF, and no sentence anywhere.** No explanation, instruction, guidance, script,
  summary or reply field. The guiding belongs to a later governed composition grounded in Core's own
  material; in a registration conversation the un-grounded half is a signup process nobody wrote.
- **The acquisition case is not advanced as a substitute for Core evidence.**
  `acquisitionCaseMutated: false` and `registrationMutated: false` on every brief, alongside
  `registrationConfirmed: false`, `vendorRecordCreated: false`, `marketplaceMutated: false` and
  `requiresCoreRegistrationExecution: true`. A local state is not proof of a Core business state.
- Zero registrations, live Core reads, Supabase clients, QuickFurno imports, model calls, prompt
  resolutions, retrievals, payments, activations, Anisha handoffs, acquisition-case transitions,
  communication requests, approvals, authorizations, execution intents, provider or channel sends,
  persistence, managed migrations, production entries and new third-party dependencies.

### AVG-10 — Payment, Activation and Anisha Handoff
Payment follow-up during acquisition, and the moment the relationship changes hands. Payment and
activation authority are **Core's alone**. On Core's authoritative ACTIVE confirmation, Aarohi's
acquisition mandate ends and Anisha becomes the vendor relationship owner.

**The offline DOMAIN for this stage is defined by
[ADR-0127](../decisions/ADR-0127-qfj-p12-avg10-aarohi-payment-activation-handoff-offline-domain.md).**
Runtime remains PLANNED / DISABLED; this capability description claims no deployment, no live Core
read, no payment, no activation and no production activation. Exact first-proof boundaries:

- **Payment is not activation, and that is a shape rather than a rule.** The payment-follow-up brief
  has no `authority`, no `active`, no attestation reference and no acquisition case. It does not
  parse as an `ActivationAttestation`, no function turns one into the other, and a spec hands the
  brief to the canonical handoff and watches it be refused.
- **Nothing is mirrored, because Core exposes no prospect-facing payment or activation READ.** Every
  per-party payment or activation read QuickFurno offers is keyed by a Core VENDOR ID, which Aarohi
  structurally does not hold — a prospect is explicitly not a vendor. The order lifecycle columns are
  unconstrained free text whose only writer sets them to `not_started` and `not_activated`, over a
  provider the same row records as `not_connected`, and Core's vendor status vocabulary contains no
  ACTIVE at all. So there is no `PAYMENT_PENDING`, `PAYMENT_COMPLETED`, `PAYMENT_FAILED`,
  `ACTIVATION_READY` or `ACTIVATION_PENDING` here: a closed AVAILABILITY token and an OPAQUE
  reference to Core's own material, and no invented lifecycle.
- **Core's payment and activation WRITE paths are banned by their real names**, discovered by audit
  rather than guessed at: the manual-payment path, the order path, the credit path and the vendor
  activation path.
- **`completeCoreActiveHandoff` remains the ONLY route into `HANDED_OFF_TO_ANISHA`.** This stage does
  not import, wrap, compose or name it, and adds no second terminal route. Only `QUICKFURNO_CORE`
  with `active: true`, for the same prospect, on a case already at `AWAITING_CORE_ACTIVATION`,
  succeeds; `PROVIDER_RECEIPT`, `MODEL_INFERENCE`, `CONVERSATION_CLAIM` and `AGENT_CASE_STATE` are
  each driven and refused.
- **Only `PAYMENT_OR_ACTIVATION` is admitted.** AVG-7 routes registration and payment/activation to
  one `REQUEST_CORE_PROCESS_CONTEXT`; AVG-9 and AVG-10 hold that door from opposite sides and each
  checks the re-derived INTENT. `REGISTRATION_PROCESS` remains AVG-9's.
- **The AVG-7 plan is RE-DERIVED and compared structurally**, carrying the latest-turn binding, the
  causal chain and the CURRENT AVG-1 gate across. `plan.plannedAt ≤ context.observedAt ≤
  brief.preparedAt`, by semantic UTC instant.
- **The cold-acquisition gate is unchanged and unwidened.** `ELIGIBLE_CORE_STATUSES` is still exactly
  `NOT_REGISTERED`; this stage does not make `REGISTERED` cold-acquirable to reach a
  post-registration conversation, and a spec asserts the allowlist.
- **The pre-handoff bridge into `AWAITING_CORE_ACTIVATION` was deliberately NOT added.** Core exposes
  no prospect-facing fact that could justify entering the boundary, and inventing a readiness signal
  to fill the gap is the failure this overlay keeps refusing. The state stays unreachable by ordinary
  transition, and the bridge remains future work.
- **A closed BRIEF, and no money anywhere.** No amount, currency, order, transaction, provider,
  method, status, paid-at or activated-at, and no explanation, reminder or reply field. The only
  number in the artifact is its contract version.
- Zero payments, activations, live Core reads, Supabase clients, QuickFurno imports, payment-gateway
  SDKs, model calls, prompt resolutions, retrievals, package orders, credit grants, Anisha runtime
  calls, acquisition-case transitions, communication requests, approvals, authorizations, execution
  intents, provider or channel sends, persistence, managed migrations, production entries and new
  third-party dependencies.

### AVG-11 — Analytics, Admin APIs and Full Dashboard
Funnel analytics, administrative read APIs and the complete Jarvis OS Aarohi surface. Read-oriented;
the Jarvis OS section stays `PLANNED` until an activating ADR says otherwise.

**The offline DOMAIN for this stage is defined by
[ADR-0128](../decisions/ADR-0128-qfj-p12-avg11-aarohi-analytics-admin-dashboard-offline-domain.md).**
Runtime remains PLANNED / DISABLED; this capability description claims no deployment, no live Core
read, no evidence source and no production activation. Exact first-proof boundaries:

- **A workflow step is not a business outcome, and that is a shape rather than a rule.** The funnel
  vocabulary is CLOSED and contains no `REGISTERED`, `PAID`, `ACTIVE`, `CONVERTED` or `CONTACTED`
  stage for a figure to reach. The stage an artifact counts for is DERIVED from which certified
  sibling parser accepts it, so an AVG-9 brief can only ever reach `REGISTRATION_ASSISTANCE_PREPARED`
  and an AVG-10 brief `PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED`. There is no input field in which a
  caller could say otherwise.
- **A count is never separable from its authority.** A closed distinction —
  `JARVIS_WORKFLOW_DERIVED`, `CORE_AUTHORITATIVE`, `AUTHORITY_UNAVAILABLE` — is carried on every
  metric, and stage-to-authority is a TOTAL map, so a caller supplies neither. Exactly one stage is
  Core-authoritative, and it is the terminal handoff.
- **The terminal metric re-runs `completeCoreActiveHandoff`.** AVG-1's own function is called
  unchanged and unwrapped, and only what it confirms is counted; a caller-supplied case already at
  `HANDED_OFF_TO_ANISHA` is refused because that function refuses it, as are a provider receipt, a
  model inference, a conversation claim and Aarohi's own case state. No case is transitioned, no
  second route into the terminal state is added, and the cold gate is neither restated nor widened.
- **UNKNOWN is not ZERO, and the unavailable metric has no field to hold a zero in.** The metric is a
  discriminated union whose unavailable variant carries no count key at all — in the domain, on the
  wire and in the read model. Whether a source was read is declared per authority CLASS by the
  boundary that read it, and supplying evidence of a class declared unobserved is a refusal.
- **No rate, and that is a decision.** No rate, ratio, percentage, conversion or trend field exists
  and no function computes one: across an authority boundary a numerator and a denominator are never
  known, compatible and same-cohort at once. Counts and availability are the whole safe answer.
- **No time, no cohorts, no series.** No durable event source exists for any of this evidence, so
  there is nothing to bucket and no honest way to say a stage grew. A report carries one instant of
  its own, checked against the evidence it rests on.
- **Deterministic counting.** A stage counts DISTINCT PROSPECTS, so duplicate evidence cannot inflate
  it; every check scans the whole input in a fixed order, so shuffling the evidence cannot change a
  refusal or a figure; and one evidence identity presented for two prospects is refused rather than
  merged.
- **Aggregate only.** A report carries stage tokens, an authority class and integers — no prospect
  reference, case, draft, conversation, message, brief reference, Core lookup, package, amount, name,
  handle or destination.
- **The canonical Jarvis OS seam is REUSED at a new contract VERSION, not duplicated.** The wire
  additions are breaking snapshot-shape changes, so under ADR-0086's change-control rule they live
  behind contract **V2**
  ([ADR-0129](../decisions/ADR-0129-avg11-control-plane-read-contract-v2.md)) rather than being
  edited into V1. V1 is untouched and `GET /api/control-plane/v1/snapshot` serves exactly what it
  served before; `GET /api/control-plane/v2/snapshot` serves the AVG-11 shape. V2 is a version
  successor in the same package and the same API family — it imports V1's row schemas and is shaped
  from one shared build over one shared source composition. No second dashboard, no second API
  namespace, no standalone Aarohi server, no parallel control-plane stack, and no `POST`, `PUT`,
  `PATCH` or `DELETE` anywhere.
- **The AVG-10 gaps remain gaps, and are DISPLAYED as gaps.** The post-registration continuation
  boundary and the bridge into `AWAITING_CORE_ACTIVATION` are still absent, and the surface names
  both as blockers rather than omitting them.
- Zero live Core reads, Supabase clients, QuickFurno imports, SQL statements, migrations, analytics
  tables, model calls, prompt resolutions, retrievals, admin writes, registrations, payments,
  activations, Anisha handoffs, acquisition-case transitions, communication requests, approvals,
  authorizations, execution intents, provider or channel sends, workers, queues, persistence,
  production entries and new third-party dependencies.

### AVG-12 — Scale, Evaluation and Controlled Autonomy
Volume, evaluation suites, red-team coverage and any increase in autonomy — each governed by the
existing rollout controls, each fail-closed, and none of it a route around approval.

**The offline DOMAIN for this stage is defined by
[ADR-0130](../decisions/ADR-0130-qfj-p12-avg12-aarohi-scale-evaluation-controlled-autonomy-offline-domain.md).**
This is the LAST offline implementation stage and it is not the Aarohi certification. Runtime remains
PLANNED / DISABLED; this capability description claims no deployment, no live Core read, no evidence
source and no production activation. Exact first-proof boundaries:

- **Evaluation is not authority, and that is a shape rather than a rule.** A probe that held, a bound
  that was exercised and an autonomy level that was granted establish that this offline
  implementation behaved as its contracts require, and nothing else. No field is spelled `approved`,
  `authorized`, `canSend`, `canExecute`, `consentValid`, `paymentConfirmed` or `productionReady`, and
  the one positive token is `OFFLINE_EVALUATION_PASSED`.
- **The evaluator derives the outcome; a serialized report is only a shape.** A suite names probes
  and supplies no expectation, no severity and no result: each probe's dimension and severity are
  TOTAL maps in the contract, and each verdict comes from driving a certified sibling function and
  reading what it returned. Every probe is mandatory, so a subset, a duplicate and an unknown token
  are each a named refusal. What no schema can prove is that the corpus RAN, so the rule is
  structural instead: **no function in this stage accepts an evaluation result or a decision as
  input**, and a hand-built passing report is therefore inert rather than merely refused.
- **A critical failure cannot be averaged away, because there is no arithmetic to average with.** No
  score, weight, percentage or grade exists. The report schema requires the whole corpus to be
  accounted for and refuses a passing outcome beside any failure at all, so even a hand-built report
  cannot claim one.
- **Red-team coverage is named, not counted.** Substitute activation authority (provider receipt,
  model inference, conversation claim, agent case state), identity binding, stale and pre-causal
  evidence, sales ethics under instruction-shaped inbound text, suppression outranking commercial
  interest, the registration boundary, the payment and activation boundaries, the handoff boundary
  and its two absent bridges, unknown-is-not-zero, determinism, data minimization, execution
  containment and rollout containment each carry at least one CRITICAL probe.
- **Scale means bounded algorithmic behaviour, never capacity.** The maxima exercised are the ones
  SIBLING contracts declare, so the claim cannot drift by AVG-12 choosing a friendlier number:
  accepted at the bound, refused WHOLE above it with nothing truncated or sampled, and the whole
  input validated rather than a prefix. No database, queue, worker, scheduler, load harness or
  benchmark was added, and no throughput, concurrency, capacity or latency figure is produced or
  claimed. What is reported is offline evaluation VOLUME, named so it cannot read as a vendor funnel.
- **Controlled autonomy reuses the repository's own ladder.** `L0_REASON` and `L1_READ` are spelled
  as JAO-1 (ADR-0115), JAO-2 (ADR-0116) and JAO-4 (ADR-0118) spell them; the one rung AVG-12 adds
  permits NAMING which already-certified offline preparation applies. Naming is not running, and
  every preparation named re-runs its own gate when it is called. There is no rung above it, and no
  `AUTO_SEND`, `FULL_AUTO` or `UNSUPERVISED_EXECUTION` token anywhere.
- **No authority delta between the floor and the ceiling.** Every level carries the SAME frozen
  posture, so the ceiling cannot vary by level, by evaluation result or by anything a caller
  supplies. Business, contact, consent, suppression, approval, execution, send, Core-mutation,
  registration, payment, activation and rollout authority are each a schema-pinned literal `false`.
- **Fail-closed in one direction only.** Suppression, an existing relationship and unresolved Core
  truth each RESTRICT by a declared reason precedence; a malformed envelope, an observation about
  another party and a decision that predates its own evidence each REFUSE outright. Nothing anywhere
  raises a level, and the only positive evidence is a CURRENT Core observation re-derived through
  AVG-1's own gate — never a result a caller could write down.
- **Another channel and a later attempt are unrepresentable, not merely forbidden.** A decision has
  no channel, destination, recipient, body, template, approval, execution-intent, case-transition or
  schedule field, and the reason is derived from the current supplied evidence alone.
- **Deterministic and replayable.** No clock, no randomness, no seed, no persistence and no
  migration: the same injected input replays to byte-identical bytes, and reordering the probes or
  the evidence changes nothing.
- **Evaluation is governance evidence, not a credential.** A derived report records that the
  certified stages still refuse what they must. Nothing consumes it, no autonomy level rests on it,
  and the later, separately governed certification and activation boundary is where genuine
  evaluation evidence must be required before any runtime use.
- **No control-plane wire change.** V1 stays frozen under ADR-0086 and V2 stays intact under
  ADR-0129; the Jarvis OS Aarohi readiness surface gains one row using the existing vocabulary, and
  the section stays `PLANNED` with no action control.
- **The AVG-10 gaps remain gaps.** The post-registration continuation boundary and the bridge into
  `AWAITING_CORE_ACTIVATION` are still absent, and autonomy does not manufacture either: a CRITICAL
  probe drives every ordinary transition and proves neither is reachable. The cold gate remains
  exactly `NOT_REGISTERED`.
- Zero live Core reads or writes, Supabase clients, QuickFurno imports, SQL statements, migrations,
  model calls, prompt resolutions, retrievals, registrations, payments, activations, Anisha handoffs,
  acquisition-case transitions, communication requests, approvals, authorizations, execution intents,
  provider or channel sends, workers, queues, schedulers, persistence, production entries, rollout
  activations and new third-party dependencies.

---

## Non-goals for this overlay

No migration is allocated or authorized by this document. No managed database is touched. No
deployment, DNS, Traefik or infrastructure change is implied. No provider, channel or credential is
configured. No n8n workflow or Meta API is invoked. **Roadmap and overlay text alone cannot authorize
a migration, a capability activation, or a production rollout.**
