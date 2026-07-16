# Privacy Principles — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

QF Jarvis reasons about real people: clients who submitted a requirement for their home, and vendors running small businesses. Neither of them chose to be reasoned about by an AI system. That fact sets the standard.

---

## 1. Data minimization

Jarvis holds the **minimum data required to reason**, and nothing held "because we might need it later."

- **Reference, don't copy.** Jarvis holds QuickFurno Core's identifiers plus the smallest set of attributes it needs. It is not a mirror of Core's records ([data-ownership.md](../architecture/data-ownership.md)).
- **Core does not push what Jarvis has no reason to hold.** Minimization starts at the event contract in Phase 2, not at the database.
- Every personal field in every contract must be **justified** at contract review. "It might be useful" is not a justification.

The cheapest way to protect a phone number is not to have it.

## 2. Purpose limitation

Data collected to reason about one thing is not used to reason about another.

- A client's contact details exist so that an authorized communication can reach them. They do not exist to be fed into marketing analysis.
- A vendor's performance history exists to assess vendor lifecycle. It does not exist to profile them for unrelated purposes.
- **Bounded agents make this enforceable.** Because each specialist owns exactly one domain, each receives exactly one domain's data. Jitin does not receive client phone numbers because Jitin has no business reasoning about individuals ([ADR-0006](../decisions/ADR-0006-agent-responsibility-boundaries.md)).

Purpose limitation is not a policy document here — it is an access boundary.

## 3. Retention control

- Every data category has a stated retention **consideration** — the reason it must be kept ([data-ownership.md](../architecture/data-ownership.md)). **Phase 0 states no durations and invents none**, and asserts no statutory period. Durations require data classification, privacy and legal review, operational and audit requirements, deletion and anonymization design, artifact-specific answers, and configurable policy — and are **required before production data ingestion**.
- **Transient model inputs get the shortest retention.** The context assembled for a single agent run is the most disposable and most privacy-sensitive data in the system, and it must never contain chain-of-thought to begin with.
- Jarvis's derived views hold data **only as long as they need it to reason**, and they are rebuildable, so discarding them costs replay time and nothing else.
- **Deletion propagates.** When Core deletes or anonymizes a client or vendor, the deletion reaches Jarvis derived views, identity references, and any recommendation evidence that embedded personal data rather than referencing it. This is a Phase 2 design requirement and a Phase 11 exit criterion.
- Audit records and approval decisions are **immutable** and handled under legal-retention rules, not deletion rules. This is a real tension and it is resolved deliberately: the audit trail records *that a decision was made about a subject*, using identifiers, not a copy of the subject's personal data.

Referencing rather than copying is what makes deletion honorable. It is the same design choice as ADR-0001's boundary, arriving from a different direction.

## 4. Role-based access

- Access follows the role, and roles have limits ([stakeholders-and-personas.md](../charter/stakeholders-and-personas.md)).
- Marketing does not need a client's phone number. Technical operators do not need to read lead content to keep the pipeline healthy.
- **Clients and vendors are subjects, not users.** They never access Jarvis. They experience only authorized, executed effects.

## 5. Avoid unnecessary copies

Every copy of personal data is a place it can leak, a place it can go stale, and a place it must be deleted from.

- No copies "for convenience."
- No copies "for performance" — the derived read model is already the performance answer, and it is minimized and rebuildable.
- No exports, no spreadsheets, no ad-hoc dumps to debug a problem. Debug with identifiers and correlation, not with people's data.

## 6. Redact sensitive information

- **No raw personal data in logs.** Redact contact details, addresses, and message content. **No phone numbers, no message bodies, no call transcripts.** Log identifiers, not people.
- Redaction applies to error messages, stack traces, and debug output — which is where personal data actually escapes, not in the log lines someone wrote on purpose.
- **AI operational tracing is held to exactly these rules.** The tracing introduced in **Phase 4.2** records only identifiers, versions, counts, and outcomes, and **never** chain-of-thought, raw personal-data prompts, complete raw model output, secrets, provider credentials, phone numbers, message bodies, or call transcripts. A trace is a log ([ai-evaluation-observability-and-data-quality.md](../architecture/ai-evaluation-observability-and-data-quality.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).
- A sensitive-data logging incident has a target of **zero** and is treated as an incident, not a metric movement ([success-metrics.md](../charter/success-metrics.md)).
- **You can reconstruct the entire audit chain — event to recommendation to approval to intent to result — without ever having logged a phone number.** Correlation identifiers do the work.

## 7. No chain-of-thought storage

**Model chain-of-thought is not stored, not logged, and not surfaced.**

What *is* stored is the **rationale** — the reasoning the agent states as its justification, written to be read and challenged by a human — and the **evidence** it rests on. That is reasoning we can stand behind and be accountable for.

Three reasons, and the first is a privacy reason:

1. **Hidden deliberation frequently contains speculative content about real people** — guesses about a client's motives, unflattering inferences about a vendor — that we have no business retaining, no way to correct, and no defensible purpose for holding.
2. **It creates false auditability.** An audit trail built on unreviewed internal model text is not an audit trail. The rationale is what we defend to the founder; the scratch work is not.
3. **It is a liability that grows with every run**, for no operational benefit.

This is stated in [agent-model.md](../architecture/agent-model.md), [goals-and-non-goals.md](../charter/goals-and-non-goals.md), and here, because it is a rule that gets quietly broken by whoever adds verbose logging to debug an agent.

## 9. Privacy classification before any remote model call

A **remote model call is a data export.** So the model gateway (Phase 4.0) **classifies data before it may be considered for a remote model**, and unclassified or too-sensitive data does not leave the local boundary — which is why the runtime is **Gemma-first and local-first** ([model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)). **No consumer AI subscription is a production model backend**, because it is ungoverned by any data agreement. And **no raw chat, model output, or business conversation becomes training data automatically** — eligibility is an explicit named-human or named-versioned-policy decision against complete provenance, and **sensitive personal data is never eligible** ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)). Retrieved **governed knowledge** carries a classification and retrieval permissions and is **evidence, never business authority** ([governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md)). All of this is **approved architecture, not implemented.**

## 8. Consent is permission, not a data field

Calling and WhatsApp make every principle above load-bearing, because the failure is no longer abstract — it is a phone ringing.

- **Consent, opt-out, do-not-contact, quiet hours, and attempt limits are enforced by QuickFurno Core**, which validates every communication request and **may refuse one the founder made** ([communication-model.md](../architecture/communication-model.md)).
- **Jarvis's view of consent is a courtesy check, never a permission** — and never authoritative in either direction. Derived views go stale, and someone may opt out in the seconds between a recommendation and its execution.
- **The QF Communications Runtime re-validates at execution time.** Two checks, because a scheduled communication is exactly the case where the world moves in between.
- **"No" must outlive the relationship.** An opt-out record typically has to persist longer than the contact record it refers to — you cannot honor a refusal you deleted. This is the one place where retention *protects* a person rather than exposing them, and the retention design must account for it ([data-ownership.md](../architecture/data-ownership.md)).

**Call transcripts are the most sensitive artifact this system will ever hold** — a recording of a real conversation with a real person, retained by a company they had a commercial relationship with. They get the shortest defensible retention, an explicit stated purpose, and no residence in a log. The raw transcript should not outlive the summary that justified keeping it.

---

## What a client or vendor should be able to expect

If a QuickFurno client asked what this system knows about them and what it does with it, the honest answer must be:

- It holds a **reference** to your record in QuickFurno, plus the minimum needed to reason about your requirement and how we should follow up with you.
- It **recommends** things to a human — when to follow up, on which channel — and it can **request** that we message or call you. **It cannot authorize that contact itself.** Every message and every call is authorized by QuickFurno first, and delivered by a communication provider, never by Jarvis.
- **A person authorized it** before any message or call reached you, and that person is named in our records.
- **If you said no, we do not call.** Your opt-out is enforced by QuickFurno, checked again at the moment of sending, and it outranks anyone's instruction — **including the founder's**.
- We can show you **why** we recommended what we did, from the facts it was based on.
- We **did not keep** the model's private deliberation about you.
- When your record is deleted in QuickFurno, **it goes from here too.**

If any part of that answer would be false, the design is wrong — not the answer.
