# ADR-0006 — Agent Responsibility Boundaries

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

QF Jarvis has five agents: **Jarvis** the coordinator, and four specialists — **Kabir** (lead), **Riya** (client), **Anisha** (vendor), and **Jitin** (marketing). Naming them is easy. Keeping them apart is not.

Two failure modes pull in opposite directions, and both destroy the design.

**The coordinator absorbs everything.** Jarvis already routes events, synthesizes across domains, and consolidates recommendations. It sees all the data. It is one small step from "Jarvis notices the lead looks fraudulent" to Jarvis making lead-quality judgments itself — at which point Kabir is decorative, and the system is a single unbounded agent with four unused labels. This is the more likely failure, because it happens by convenience, one helpful shortcut at a time.

**The specialists sprawl.** Anisha, reasoning about a vendor who is not converting leads, starts reasoning about whether the *leads* were any good — which is Kabir's domain. Jitin, reasoning about a campaign's poor conversion, starts reasoning about client follow-up — which is Riya's. Each is a locally sensible inference. Collectively they produce four agents that all do everything, badly, and duplicate each other's recommendations to a founder who now sees the same problem four times.

Bounded agents are not an aesthetic preference. They are what makes the system evaluable (you cannot measure an agent whose scope is "whatever it noticed"), auditable (you cannot explain a recommendation whose reasoning spans four domains with no owner), and safe (a bounded agent needs bounded data, which is how [privacy-principles.md](../governance/privacy-principles.md) is actually enforced).

## Decision

**Each specialist agent remains strictly within its named domain. Jarvis coordinates rather than absorbing every responsibility.**

### 1. Each specialist owns exactly one domain

| Agent | Domain | May reason about | May not reason about |
| --- | --- | --- | --- |
| **Kabir** | Lead | Lead quality, completeness, spam and fraud signals, budget plausibility, urgency plausibility, category and location consistency, matching readiness, operational intelligence | Client relationships, vendor lifecycle, campaign performance |
| **Riya** | Client | Communication strategy, follow-up, nurture, abandoned-requirement recovery, reactivation, relationship intelligence, timing and channel | Lead fraud scoring, vendor lifecycle, campaign budgets |
| **Anisha** | Vendor | Acquisition, qualification, onboarding, profile completion, activation, package readiness, recharge, retention, upgrade, inactivity recovery, win-back | Lead quality scoring, client communication, campaign performance |
| **Jitin** | Marketing | Campaign performance, channel analysis, cost per verified lead, city and category demand, SEO opportunity, content, creative fatigue, budget shifts, growth | Individual lead verification, individual client outreach, individual vendor lifecycle |

### 2. Jarvis coordinates, and coordination is not domain reasoning

Jarvis owns exactly five things: **routing**, **conflict detection**, **multi-domain synthesis**, **composite recommendations**, and **founder prioritization** (with briefings and attention management as the surface of the last). Ownership of a *symptom* is resolved by the **root-cause rule**, which is authoritative in [agent-model.md](../architecture/agent-model.md).

Multi-domain synthesis is the subtle one, so it is defined precisely: **Jarvis connects conclusions the specialists reached; it does not reach domain conclusions itself.** When Kabir reports fabricated leads, Jitin reports climbing cost per verified lead, and Anisha reports vendors letting packages lapse — all in the same city — Jarvis recognizes one situation and produces one **composite recommendation** carrying all three agents' evidence, **with each contributor named**. It did not judge the leads, the campaign, or the vendors. It connected three judgments made by the agents that own them.

If Jarvis ever *makes* the domain judgment rather than *connecting* it — including under the cover of "synthesis" — this ADR has been violated.

### 3. Out-of-domain observations are raised, not acted upon

A specialist that notices something outside its domain does not reason about it and does not recommend on it. It **raises a signal**, and Jarvis routes it to the agent that owns it. Anisha noticing that a vendor's assigned leads look poor produces a signal to Kabir — not an Anisha recommendation about lead quality.

### 4. No agent authorizes and no agent executes

This holds for the coordinator exactly as it holds for the specialists. Coordination is not authority ([ADR-0002](./ADR-0002-recommend-authorize-execute-model.md)).

### 5. Agents receive only the data their domain requires

Least privilege at the agent boundary. Jitin does not receive client phone numbers. Kabir does not receive payment history. Riya does not receive wallet balances. A bounded domain is what makes a bounded dataset possible, and the bounded dataset is what makes the privacy principles enforceable rather than aspirational ([data-ownership.md](../architecture/data-ownership.md)).

### 6. Agents are built one at a time

Phases 5, 6, 7, and 8 — Kabir, Riya, Anisha, Jitin — each with its own shadow-mode evaluation. Building four agents in parallel on an unproven coordination layer produces four unevaluated agents and no way to tell which one is wrong.

### 7. Domain boundaries are versioned like anything else

An agent's domain is part of its definition in the agent registry. Widening a domain is a versioned change with an ADR — not a prompt edit.

## Alternatives considered

**1. One general agent.**
Drop the specialists; let a single agent reason about everything. Rejected: unevaluable (what is its acceptance rate *for what*?), unauditable (which reasoning produced this?), and it requires access to every category of data at once, which makes least privilege impossible. It is also the design most likely to produce confidently wrong cross-domain conclusions, because nothing constrains what it may conclude.

**2. Overlapping agents with a de-duplication step.**
Let agents range freely; deduplicate at the end. Rejected: it wastes model spend on four agents reasoning about the same thing, produces conflicting recommendations with no principled resolution ("Kabir says the lead is fine, Anisha says it is not" — who is right?), and makes evaluation meaningless because no agent owns any outcome.

**3. A hierarchy where Jarvis reviews and can override specialist conclusions.**
Rejected. An overriding coordinator is an absorbing coordinator with extra steps. Once Jarvis can overrule Kabir on lead quality, Jarvis is the lead-quality agent and Kabir is advisory decoration. Jarvis may **suppress** a recommendation during consolidation (it is redundant, superseded, or already acted upon) — it may not **replace its conclusion** with one of its own.

**4. More, narrower agents** — split lead verification from lead fraud, for instance.
Rejected for now as premature. The four domains map to the four business functions and to the four teams that consume their output. Splitting further can be revisited with evidence, and would require an ADR.

## Consequences

**Positive.**

- **Agents are evaluable.** Each has a measurable acceptance rate, calibration, and outcome correlation within a domain that means something ([success-metrics.md](../charter/success-metrics.md)).
- **Recommendations are explainable.** Every one has an owner, a domain, and a bounded body of evidence.
- **Least privilege is achievable**, because a bounded domain implies a bounded dataset.
- **Failures are contained.** A bad Kabir version degrades lead intelligence and nothing else, and rolls back independently.
- **The founder sees one item, not four**, because consolidation has principled inputs rather than overlapping noise.
- **Ownership is clear** when a recommendation is wrong. Someone is accountable for fixing a specific agent.

**Negative — accepted.**

- **Genuinely cross-domain insight is harder**, and depends on Jarvis's synthesis being good. This is a real cost, and it is why synthesis is a first-class Jarvis responsibility rather than an afterthought.
- **Routing overhead**: a signal raised out-of-domain takes a hop through Jarvis to reach the agent that owns it.
- **Sequential agent delivery is slower** than parallel construction — deliberately.
- **Symptoms do not map cleanly to domains**, so ownership has to be derived rather than read off. This is resolved by the **root-cause rule** in [agent-model.md](../architecture/agent-model.md), which is authoritative: ownership follows the root cause, not the symptom. "Lead conversion is poor" is owned by Kabir if the leads were fraudulent, Anisha if the vendor responded slowly, Riya if follow-up was weak, and Jitin if the campaign source was low quality. Where several are materially involved, each contributes bounded evidence and Jarvis assembles a **composite recommendation** in which every contributor stays attributable.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Coordinator absorption** — Jarvis starts making domain judgments | Phase 4 builds coordination with **zero agents registered**, making domain logic structurally difficult to sneak in. Reviewed at every phase gate. Jarvis may suppress, never overrule |
| **Specialist sprawl** — an agent reasons outside its domain | Out-of-domain observations are raised as signals, not recommendations. Agent inputs are restricted to domain-relevant data, so sprawl is limited by what the agent can even see |
| **Boundary disputes go unresolved** and produce duplicate or conflicting recommendations | The **root-cause rule** makes ownership deterministic ([agent-model.md](../architecture/agent-model.md)). Jarvis owns **conflict detection**: when two agents reach incompatible conclusions, that is surfaced, not silently resolved by whichever ran last. Consolidation catches duplicates |
| **Composite recommendations become a back door for coordinator absorption** — Jarvis "synthesizes" its way into making the domain call | A composite must name its contributing agents and carry their evidence. **A composite with no attributable contributors is a Jarvis conclusion in disguise, and is a defect.** Jarvis connects conclusions; it does not reach them |
| **Domain widened by prompt edit** rather than by decision | An agent's domain lives in the versioned agent registry. Widening it requires a version and an ADR |
| **Jarvis's synthesis is weak**, and cross-domain insight is lost | Synthesis quality is evaluated like any other agent output. If it is poor, that is a fixable Jarvis problem — not a reason to let specialists sprawl |

## Follow-up

- Phase 4 builds the coordination layer with no agents registered, and implements **routing, conflict detection, and composite assembly** per the root-cause rule.
- Phases 5–8 add Kabir, Riya, Anisha, and Jitin one at a time, each evaluated in shadow mode before the next begins.
- The **root-cause ownership rule** in [agent-model.md](../architecture/agent-model.md) is authoritative for routing; it is refined as each agent lands, but ownership never becomes discretionary.
- [agent-model.md](../architecture/agent-model.md) holds the working definition of each agent's inputs, outputs, and evaluation.
- Every phase gate reviews whether the coordinator has absorbed domain logic and whether any specialist has sprawled.
