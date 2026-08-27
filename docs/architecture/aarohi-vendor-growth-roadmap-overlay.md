# Aarohi — Vendor Growth and Acquisition: QVGE capability overlay (AVG-0 … AVG-12)

**Document status:** Canonical for the QuickFurno Vendor Growth Engine capability overlay. Adopted under [ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md). Read with [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), [agent-constitution.md](../governance/agent-constitution.md) and [authority-routing-data-access-matrix.md](../governance/authority-routing-data-access-matrix.md).

**Runtime status: PLANNED / DISABLED.** There is no Aarohi runtime, no prospect store, no enrichment
pipeline, no outreach, no provider or channel credential, no Meta API call, no Instagram transport, no
WhatsApp integration, no n8n execution and no managed persistence in this repository. Production
rollout remains **OFF**, and no package or application imports the Aarohi package at all.

**Offline DOMAIN status.** This overlay once said "nothing here is implemented", which stopped being
true at AVG-1. What exists is contracts and pure functions over frozen values:

- **AVG-0 through AVG-5 — implemented as certified offline domains**
  ([ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md),
  [ADR-0111](../decisions/ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md),
  [ADR-0112](../decisions/ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md),
  [ADR-0113](../decisions/ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md),
  [ADR-0122](../decisions/ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md)).
- **AVG-6 — offline implementation proof defined by
  [ADR-0123](../decisions/ADR-0123-qfj-p12-avg6-aarohi-omnichannel-identity-whatsapp-handoff-offline-domain.md).**
  It adds no runtime, provider, channel, transport or execution activation, and merges no identity.
- **AVG-7 through AVG-12 — planned and unimplemented.**

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

### AVG-8 — Commercial Truth and Package Engine
Packages, entitlements and pricing presented during acquisition, **sourced from Core**. The engine
selects and explains what Core already holds; it does not invent, adjust, discount or interpret price.
Model and RAG output is never a commercial source.

### AVG-9 — Registration Integration
Guiding a converted prospect into QuickFurno registration. Registration is performed by Core; Aarohi
assists and observes. No marketplace mutation occurs from this side.

### AVG-10 — Payment, Activation and Anisha Handoff
Payment follow-up during acquisition, and the moment the relationship changes hands. Payment and
activation authority are **Core's alone**. On Core's authoritative ACTIVE confirmation, Aarohi's
acquisition mandate ends and Anisha becomes the vendor relationship owner.

### AVG-11 — Analytics, Admin APIs and Full Dashboard
Funnel analytics, administrative read APIs and the complete Jarvis OS Aarohi surface. Read-oriented;
the Jarvis OS section stays `PLANNED` until an activating ADR says otherwise.

### AVG-12 — Scale, Evaluation and Controlled Autonomy
Volume, evaluation suites, red-team coverage and any increase in autonomy — each governed by the
existing rollout controls, each fail-closed, and none of it a route around approval.

---

## Non-goals for this overlay

No migration is allocated or authorized by this document. No managed database is touched. No
deployment, DNS, Traefik or infrastructure change is implied. No provider, channel or credential is
configured. No n8n workflow or Meta API is invoked. **Roadmap and overlay text alone cannot authorize
a migration, a capability activation, or a production rollout.**
