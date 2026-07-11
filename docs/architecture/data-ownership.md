# Data Ownership — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

Ownership follows [system-boundary.md](./system-boundary.md), which is authoritative. The decision behind it is [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md).

---

## How to read the table

- **Authoritative owner** — the one system whose version of this data is true. Exactly one, always.
- **Read consumers** — who may read it.
- **Permitted writers** — who may change it. If QF Jarvis does not appear here, it cannot write it, and no future design may let it.
- **Retention** — the *considerations* that will drive how long it is kept. **No durations are stated anywhere in Phase 0, and none should be inferred.** See "Retention durations are a future decision" below.
- **Sensitivity** — how carefully it must be handled. Drives redaction, access control, and what may enter an agent's context.

Sensitivity levels: **Low** (operational, non-personal) · **Medium** (business-sensitive, non-personal) · **High** (personal data) · **Critical** (money, credentials, or authorization).

---

## Ownership table

| Data | Authoritative owner | Read consumers | Permitted writers | Retention considerations | Sensitivity |
| --- | --- | --- | --- | --- | --- |
| **Leads** | QuickFurno Core | Core, Jarvis (derived view), Operations, assigned Vendors | **QuickFurno Core only** | Retain while commercially and legally required; personal fields minimized in any Jarvis copy | **High** — personal data |
| **Clients** | QuickFurno Core | Core, Jarvis (identity references + minimum attributes), Support | **QuickFurno Core only** | Retain per client relationship and legal obligation; deletion requests propagate to Jarvis derived views | **High** — personal data |
| **Vendors** | QuickFurno Core | Core, Jarvis (derived view), Sales, Operations | **QuickFurno Core only** | Retain per vendor relationship and legal obligation | **High** — personal and business data |
| **Assignments** | QuickFurno Core | Core, Jarvis (derived view), Vendors, Operations | **QuickFurno Core only** — including enforcement of the max-three-vendors-per-qualified-lead rule | Retain for audit and dispute resolution | **Medium** |
| **Wallets** | QuickFurno Core | Core, Vendors, Finance; Jarvis reads a derived, **non-authoritative** balance view only | **QuickFurno Core only** | Retain per financial record-keeping obligation | **Critical** — money |
| **Packages** | QuickFurno Core | Core, Vendors, Sales; Jarvis derived view | **QuickFurno Core only** | Retain per commercial and financial obligation | **Critical** — money-adjacent |
| **Payments** | QuickFurno Core | Core, Finance | **QuickFurno Core only** | Retain per financial and tax obligation — typically the longest retention in the system | **Critical** — money |
| **Campaigns** | QuickFurno Core | Core, Marketing, Jarvis (derived view) | **QuickFurno Core** (authoritative record); n8n applies authorized changes at the provider and reports the result | Retain for performance history and attribution | **Medium** |
| **Recommendations** | **QF Jarvis** | Jarvis, Core (on submission), approvers, auditors | **QF Jarvis** | Retain for evaluation and audit; evidence retained with them; expire operationally but retain the record | **Medium** — may reference High-sensitivity subjects by ID |
| **Approval requests** | **QF Jarvis** — as a record of what it *asked* for | Jarvis, Core (on submission), auditors | **QF Jarvis** submits; **Core decides**. A request is not a decision and carries no authority | Retain with the recommendation, for audit | **Medium** |
| **Approvals** (decisions) | **QuickFurno Core** | Core, Jarvis (read, to display the authoritative result and close its lifecycle), auditors | **QuickFurno Core only** — recorded from a human decision or an explicit policy. **Jarvis holds no approved state of its own and never writes one** ([ADR-0007](../decisions/ADR-0007-founder-approval-interface-and-authority.md)) | Retain for the life of the audit trail. Immutable | **Critical** — authorization |
| **Execution intents** | **QuickFurno Core** | Core, n8n, Jarvis (read), auditors | **QuickFurno Core** creates; n8n never creates | Retain for the life of the audit trail. Immutable | **Critical** — authorization |
| **Execution results** | **QuickFurno Core** | Core, Jarvis (read), auditors | n8n reports; **QuickFurno Core records as truth** | Retain for the life of the audit trail. Immutable | **Medium to Critical** — depends on the action |
| **Contact identity, phone number, WhatsApp eligibility, voice-call consent, opt-in/opt-out, do-not-contact, quiet hours, attempt limits** | **QuickFurno Core** | Core (enforces), n8n / QF Communications Runtime (re-validates at execution), Jarvis (derived courtesy view only) | **QuickFurno Core only.** Jarvis's view is **never permission, in either direction** | Retain per consent-record obligation. Opt-out records typically outlive the contact record they refer to — you must remember that someone said no | **Critical** — personal data *and* permission |
| **Communication requests** | **QF Jarvis** (or Riya / Anisha) — a record of what was *asked* | Jarvis, Core (on submission), auditors | Originating agent submits; **Core decides** | Retain with the recommendation, for audit | **High** |
| **Communication history, delivery and call outcomes, human-handoff state** | **QuickFurno Core** | Core, Jarvis (read — **displays**, never writes), auditors | n8n reports; **Core records as truth**. Jarvis may never write `delivered` or `completed` | Retain for audit and for attempt-limit enforcement | **High** |
| **Call transcripts and summaries** | **QuickFurno Core** — produced by the QF Communications Runtime, recorded by Core | Core, the owning specialist agent, auditors | QF Communications Runtime produces; **Core records** | **Shortest defensible retention.** A transcript is the most sensitive artifact this system will ever hold — a recording of a real conversation with a real person. Retention requires explicit purpose, and the raw transcript should not outlive the summary that justified keeping it | **Critical** — personal data |
| **Agent runs** | **QF Jarvis** | Jarvis, technical operators, auditors | **QF Jarvis** | Retain for evaluation and debugging. **Never contains model chain-of-thought.** Input context retained only in minimized, redacted form | **Medium** |
| **Policies** | **QuickFurno Core** | Core, administrators, Jarvis (read, to know what approval a recommendation needs), auditors | **QuickFurno Core only** — administrators author; Jarvis may only *propose* a change as a recommendation | Retain all versions. Policy history is part of the audit trail | **Critical** — authorization |
| **Audit records** | **QuickFurno Core** | Core, auditors, founder | Append-only. **No actor may modify or delete** | Retain per legal and governance obligation. Immutable | **Critical** |

---

## What QF Jarvis owns — the complete list

Exactly three things:

1. **Recommendations** it produced, together with their evidence, rationale, and evaluation.
2. **Agent runs** — what ran, at what version, on what input, producing what output.
3. **Approval requests and communication requests** it submitted — a record of what it *asked* Core to authorize. **A request is not a decision, and it is certainly not a delivery.** Both belong to Core, and Jarvis stores only what Core told it.

Plus the derived read models and attention state built from canonical events, which are **rebuildable and non-authoritative**.

That is all. Jarvis owns its own thinking and its own asking — and nothing the business runs on.

---

## Derived views are not truth

QF Jarvis maintains derived read models so its agents can reason without hammering QuickFurno Core. These are:

- **Non-authoritative.** If a derived view disagrees with Core, Core is right.
- **Rebuildable.** Destroying every Jarvis read model costs replay time and nothing else.
- **Minimized.** They hold Core's identifiers plus the smallest set of attributes needed to reason — not a mirror of Core's records.
- **Never the basis of an unconfirmed business decision.** A recommendation derived from a stale view is still just a recommendation; Core validates against its own truth before authorizing.

**A derived view that becomes load-bearing is a second source of truth wearing a disguise.** If anyone ever needs Jarvis's copy to be correct in order for the business to be correct, the boundary has failed.

---

## Personal data and agent context

Personal data (High sensitivity) enters an agent's context only where the agent's domain genuinely requires it, and in minimized form:

- Kabir needs enough of a lead to judge completeness, plausibility, and consistency. It does not need payment history.
- Riya needs relationship and requirement context to recommend timing and channel. It does not need a wallet balance.
- Anisha needs vendor lifecycle state. It does not need a client's contact details.
- Jitin needs aggregate campaign, city, and category performance. It should not need any individual's personal data at all.

Redaction, purpose limitation, and minimization are enforced at the agent boundary. See [privacy-principles.md](../governance/privacy-principles.md).

---

## Retention durations are a future decision

**Phase 0 states no retention periods, and invents none.** The table above gives retention *considerations* — the reasons a thing must be kept — not durations. Phrases such as "retain per legal obligation" name a **dependency**, not a period, and no number should be read into them.

**No legal conclusions are drawn here, and no statutory period is asserted.** Determining what the law requires is not an engineering decision and is not made in this repository.

Setting retention durations requires, at minimum:

1. **Data classification** — which artifacts hold personal data, money records, authorization records, or transient model inputs.
2. **Privacy and legal review** — the actual obligations, established by someone qualified to establish them.
3. **Operational requirements** — how far back agents genuinely need to reason, and how far back replay must work.
4. **Audit requirements** — how long the authorization chain must remain reconstructible ([auditability-principles.md](../governance/auditability-principles.md)).
5. **Deletion and anonymization design** — how a deletion propagates from Core into Jarvis derived views, identity references, and recommendation evidence, and what "anonymized" concretely means for each artifact.
6. **Artifact-specific retention** — a per-artifact answer, not one global period. An immutable approval decision, a rebuildable read model, and a model's transient input context have nothing in common.
7. **Configurable policy** — retention is configuration, versioned and changeable, not a constant compiled into code.
8. **Shorter retention for transient model inputs**, where appropriate. The context assembled for a single agent run is the most disposable and most privacy-sensitive data in the system; it should be the shortest-lived, and it must never contain chain-of-thought in the first place.

**This decision is required before production data ingestion**, and is a prerequisite for Phase 11. Building against a configurable retention policy from Phase 2 is what makes deciding it later cheap rather than a migration.

## Deletion and the right to be forgotten

When QuickFurno Core deletes or anonymizes a client or vendor record, the deletion must propagate to:

- Jarvis derived read models,
- Jarvis identity references,
- Recommendation evidence, where it embeds personal data rather than referencing it.

This is a design requirement, established now and implemented in Phase 2 (contracts) and Phase 11 (Core integration). It is easy to honor if Jarvis references rather than copies — which is exactly why it references rather than copies.

Audit records and approval decisions are immutable and are handled separately, under legal-retention rules rather than deletion rules.
