# Glossary — QF Jarvis

**Status:** Phase 0 — in progress (pending review)
**Date:** 2026-07-11

These terms have one meaning across this repository. Where another document uses one of them, it means exactly what is written here. Where a term implies ownership, the authoritative statement is [system-boundary.md](../architecture/system-boundary.md).

---

### QuickFurno Core

The authoritative business system. Owns business truth, operational state, authorization, and policy enforcement. Owns leads, clients, vendors, assignments, packages, wallets, payments, and all authoritative lifecycle state. Approves or rejects actions. The source of truth. Not part of this repository.

### QF Jarvis

The intelligence, recommendation, coordination, and founder decision-support layer. Consumes canonical events, coordinates specialist agents, produces structured recommendations, prioritizes founder attention. Never the source of business truth. Never mutates QuickFurno Core state directly. Never calls providers directly. This repository.

### Canonical event

A versioned, immutable fact emitted by QuickFurno Core describing something that happened in the business ("lead created," "vendor package expired"). Canonical events are the only supported way for business truth to reach Jarvis. Facts, not commands — an event says what happened, never what to do about it.

### Aggregate

A cluster of business data treated as a single unit of consistency and ownership (for example: a lead, a vendor, a wallet). Aggregates live in QuickFurno Core. Jarvis reasons about them; it does not own them.

### Source of truth

The single system whose state is authoritative for a given piece of data. For all QuickFurno business data, that system is QuickFurno Core — permanently. See [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md).

### Recommendation

The structured output of an agent. Not chat, not prose, not an action. A recommendation identifies its subject, carries evidence and rationale, states confidence, risk, and priority, has an expiry, and declares what approval it would require if acted upon. A recommendation is **non-executable by construction**: it cannot cause an effect. See [recommendation-lifecycle.md](../architecture/recommendation-lifecycle.md).

### Evidence

The specific facts a recommendation rests on — the canonical events, identifiers, and computed signals that led to it. Evidence is mandatory. A recommendation without evidence is a defect, not a hunch.

### Rationale

The stated reasoning connecting evidence to recommendation, written to be read by a human and defended to the founder. Rationale is stored and auditable. It is **not** the model's private chain-of-thought, which is never stored (see *chain-of-thought* under [privacy-principles.md](../governance/privacy-principles.md)).

### Approval request

What the QF Jarvis Control Plane submits when a human clicks approve, reject, or request changes. **A request is not a decision.** QuickFurno Core validates it — identity, authority, current state, risk policy, expiry, recommendation eligibility — and may reject it. Jarvis records what it asked for; Core records what was decided ([ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)).

### Approval decision

An explicit, attributable authorization outcome recorded in QuickFurno Core: approved, rejected, or changes requested. Made by an authorized human or by an explicit policy. Never made by an agent. Never implicit, never a timeout default. **Jarvis displays approval decisions; it never writes one, and never optimistically renders one before Core's authoritative response arrives.**

### Communication request

A structured, **governed** request to contact a client or vendor by WhatsApp or voice call, originated by Jarvis, Riya, or Anisha. **It is not an authorization and not a delivery.** QuickFurno Core validates recipient identity, consent, opt-out state, eligibility, policy, risk, quiet hours, and attempt limits — and **must refuse** where a mandatory control requires it, **including on a request the founder made**. See [communication-model.md](../architecture/communication-model.md).

### Governed execution (communication)

The sanctioned path by which Jarvis supports calling and WhatsApp: **Jarvis requests and coordinates → QuickFurno Core authorizes → n8n and the communication runtime execute → providers deliver → QuickFurno Core records the authoritative result → Jarvis reflects it.** Jarvis has controlled communication coordination and user-facing capabilities; it has **no direct provider transport, delivery, or authorization authority**.

### QF Communications Runtime

Shared execution-side infrastructure — WhatsApp adapter, QF Voice Runtime, consent and policy validation interface, template and script registry, scheduling, retry and idempotency controls, delivery and call status handling, transcript and summary processing, human handoff, structured result reporting. It lives **outside QF Jarvis**, is reached only by n8n under an authorized execution intent, and holds the provider credentials that Jarvis does not.

It may serve Jarvis, Riya, and Anisha — but each agent retains separate permissions, prompts, policies, communication purposes, recipient eligibility, templates, memory boundaries, evaluation datasets, and escalation rules. **Shared plumbing must not become a shared identity.**

### QF Voice Runtime

The voice-call component of the QF Communications Runtime. Shared, execution-side, credential-holding. **Jarvis does not connect to it directly** — voice reaches it only through an authorized execution intent dispatched by QuickFurno Core and executed by n8n.

Voice **begins at Automation Level 2 or 3**: production outbound voice initially requires explicit human approval on every call. Any future limited-policy automation for voice requires a **separate accepted ADR** ([automation-levels.md](../governance/automation-levels.md)).

### QF Jarvis Control Plane

The founder-facing surface (Phase 12): the prioritized attention view, the evidence behind each item, and the approve / reject / request-changes actions. It is an **approval client** — it surfaces, it submits, it reflects. It is not an approval authority.

### Composite recommendation

A recommendation Jarvis assembles when a situation materially spans several domains. Each specialist contributes bounded evidence and its own domain recommendation; Jarvis synthesizes them into one prioritized item. **Every contributing agent remains attributable** — Jarvis does not absorb or silently transfer specialist ownership ([agent-model.md](../architecture/agent-model.md)).

### Execution intent

A bounded, expiring instruction to perform a specific authorized action, produced **only** from an approved recommendation. It names exactly what may happen, to whom, through which provider, and until when. Outside those bounds, nothing is authorized. Jarvis does not create authority by creating an intent — the authority comes from the approval decision that preceded it.

### Execution result

The outcome reported after n8n attempts an execution intent: delivered, failed, partially completed, rejected by the provider. Results return to QuickFurno Core, which records them as truth. Jarvis reads results; it does not own them.

### Idempotency

The property that processing the same message more than once has the same effect as processing it once. Required across event ingestion, recommendation generation, approval submission, and execution — because redelivery and retry are normal, not exceptional.

### Correlation

The identifier that ties every artifact in one business thread together: source events, recommendation, approval decision, execution intent, execution result. Answers "what else belongs to this?"

### Causation

The identifier that records what directly caused a given artifact — this recommendation was caused by that event; this intent was caused by that approval. Answers "what produced this, specifically?" Correlation groups; causation chains.

### Policy

An explicit, versioned rule owned and enforced by QuickFurno Core that determines whether an action may be authorized, and by whom. Policies may permit automatic authorization for narrow, low-risk action classes (Automation Level 4). Jarvis may *propose* policy changes; it never edits or bypasses policy. Silent policy change is prohibited.

### Agent

A bounded reasoning component within QF Jarvis with a named domain, a defined input, and a structured recommendation as its only output. The agents are **Jarvis** (coordinator), **Kabir** (lead), **Riya** (client), **Anisha** (vendor), and **Jitin** (marketing). Agents recommend. They do not authorize and they do not execute. See [agent-model.md](../architecture/agent-model.md).

### Provider

An external system that delivers a real-world effect: WhatsApp, SMS, email, voice, CRM, Google Ads, Meta Ads, and other approved providers. Providers are reached **only** by n8n. Jarvis holds no provider credentials and makes no provider calls.

### n8n

The approved execution fabric. Validates and executes authorized execution intents against providers, then reports execution results back to QuickFurno Core. n8n executes; it does not decide.

### Dead letter

The terminal holding place for a message — an event, an intent, a result — that could not be processed successfully after its retry policy was exhausted. Dead letters are visible, alertable, and replayable after the underlying fault is fixed. Silence is not an acceptable failure mode.

### Replay

Deliberate reprocessing of previously received messages, used for recovery and for backfilling after a fix. Replay is safe only because processing is idempotent and because replay protection distinguishes a legitimate replay from a hostile one.

### Shadow mode

Automation Level 1. Agents generate recommendations that are **not** shown to operational users. The recommendations are recorded and evaluated against what actually happened, to measure quality before anyone's time or trust is spent on them.

### Assisted mode

Automation Level 2. Recommendations are shown to humans. Humans act manually. Jarvis still causes no effects — it informs a person who does.

### Limited automation

Automation Level 4. Explicit policy may automatically authorize a narrow, low-risk, reversible class of actions that has passed its evaluation gates. Reversible means: switching the policy off tomorrow costs nothing and breaks nothing.

### Full automation

Automation Level 5. Broad automatic authorization. Reserved for mature, evaluated, tightly controlled capabilities. Not planned within the current roadmap and not to be assumed by any design.

### Founder attention item

An entry on the founder's prioritized command view: a consolidated, deduplicated, ranked, expiring statement of something worth the founder's judgment right now, with evidence attached and a recommended course of action. The output of Jarvis's coordination role, and the primary product surface of the whole system.
