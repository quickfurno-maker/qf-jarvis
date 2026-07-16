# Governed Knowledge and Capabilities — QF Jarvis

**Status:** Approved architecture (Phase 4.1). **Not implemented.**
**Date:** 2026-07-16
**Decision:** [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)

> **What this document is.** The approved architecture for two Phase 4.1 foundations: **governed knowledge retrieval** and the **secure capability registry**.
>
> **What this document is not.** A description of anything that runs. **No knowledge system and no capability registry exist in this repository.** There is no retrieval, no vector store, no document pipeline, and no capability a runtime could invoke. This is design for a future phase.

Three registers, kept distinct: **approved architecture** (here), **future implementation** (Phase 4.1, with its own ADR), **current repository reality** (none of it exists).

---

## Governed knowledge is not agent memory

These are different things, and conflating them is how an unreviewed document becomes something an agent treats as fact.

| | **Agent memory** | **Governed knowledge** |
| --- | --- | --- |
| What it is | Derived, per-agent belief carried forward | Reviewed, approved reference material |
| Authority | Non-authoritative, rebuildable ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)) | Evidence, never business authority |
| Lifecycle | Built from canonical events; discarded and rebuilt | Uploaded, reviewed, approved, retired |
| Owner | The owning agent, one domain each | A named human owner per document |

**Governed knowledge is separate from agent memory**, stored separately, and governed by its own lifecycle. An agent may *retrieve* knowledge and *cite* it as evidence; it may never treat retrieved knowledge as the current truth about a lead, a vendor, a wallet, or a policy.

---

## The knowledge lifecycle

```
uploaded → scanned → reviewed → approved → active → retired
```

A document does not become retrievable by being uploaded. It is **scanned** (for malware and for prohibited content), **reviewed** by its owner, **approved**, and only then **active**. When it is superseded or expires it is **retired** — retired knowledge is not silently deleted; it is marked, so a citation to it remains explainable.

**Every knowledge record carries:**

| Field | Why |
| --- | --- |
| document identifier | Stable identity for citation and audit |
| version | Knowledge changes; a citation must name which version it rested on |
| source | Where it came from — a document with no provenance is not evidence |
| owner | A named human accountable for it |
| `approvedBy` | Who approved it into `active` — approval is attributable |
| `effectiveFrom` | When it began to apply |
| `expiresAt` (where applicable) | When it stops applying without a human re-approving |
| classification | Its sensitivity — drives retrieval permissions |
| retrieval permissions | Which agents or callers may retrieve it |
| `supersededBy` (where applicable) | The version that replaced it |

---

## Retrieved knowledge is evidence, never authority

**QuickFurno Core remains authoritative for current operational and business state.** A retrieved document may inform *how* an agent reasons; it is never *what is currently true* about the business. A knowledge base that says "the carpentry SLA is 48 hours" is a policy reference; the lead's actual state, its actual timestamps, and the actual policy in force are Core's.

This is the same rule as [data-ownership.md](./data-ownership.md): derived and referenced material is not truth, and a piece of it that becomes load-bearing is a second source of truth wearing a disguise.

---

## Do not commit to a vector database because retrieval exists

Retrieval is a capability, not a mandate for a particular storage technology.

**Vector retrieval must be justified by evaluation evidence** (Phase 4.2). Until an evaluation shows that semantic retrieval measurably beats the simpler options, the valid first implementations are **deterministic lookup and metadata filtering** — retrieve by document identifier, by category, by classification, by effective date. These are explainable, testable, and free of the failure modes (silent irrelevant matches, opaque ranking) that make an unevaluated vector store dangerous in a system that must ground its claims.

A vector database is a decision to be made later, on evidence, with its own record — not a default that arrives with the word "retrieval."

---

## The secure capability registry

Everything an agent or component may invoke is a **declared capability**. There is no ambient ability to do anything; a capability exists because it was written down, reviewed, and registered — or it does not exist.

**Every capability declares:**

- capability identifier
- owning component
- allowed caller or agent
- read or write classification
- input contract
- output contract
- data classification
- timeout
- rate limit
- audit requirements
- environment availability
- feature flag
- failure behaviour

A capability is therefore a **named, bounded, contract-typed door with an owner, a rate limit, a timeout, and a defined failure**. It can be reviewed in a diff, enabled or disabled by a flag, and denied to a caller that should not hold it.

### Open-ended capabilities are prohibited

Explicitly forbidden, because each is a way for a bounded agent to become an unbounded one:

- **arbitrary SQL** — a query is a bounded, named capability or it does not exist;
- **arbitrary shell** — there is no general command execution;
- **unrestricted filesystem access** — no "read any file";
- **arbitrary URL fetching** — no "fetch this address," which is also how data exfiltrates and how injection reaches out;
- **generic provider invocation** — no "call any provider"; Jarvis holds no provider credential regardless;
- **unrestricted document retrieval** — retrieval is scoped by classification and retrieval permissions, never "return any document."

An open-ended capability is indistinguishable from a lack of a boundary. The registry's entire purpose is to make "what can this agent do?" a question with a finite, reviewed answer.

---

## The boundary is unchanged

Adding knowledge and capabilities introduces **no new edge across the permanent boundary**. Jarvis continues to have:

- **no write access to QuickFurno business state**;
- **no direct path to n8n**;
- **no provider credentials**;
- **no direct communication transport**.

A capability that granted any of those would not be a capability; it would be a boundary violation requiring a superseding ADR ([system-boundary.md](./system-boundary.md), [change-management.md](../governance/change-management.md)).

---

## Current repository reality

**None of this is implemented.** There is no knowledge store, no document pipeline, no retrieval of any kind, and no capability registry — bounded or otherwise. `apps/api` and `apps/worker` remain compileable boundaries. Phase 4.1 is approved architecture that a future, separately authorized phase will build, with its own implementing ADR ([ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).
