# AI Evaluation, Observability and Data Quality — QF Jarvis

**Status:** Approved architecture (Phase 4.2). **Not implemented.**
**Date:** 2026-07-16
**Decision:** [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)

> **What this document is.** The approved architecture for three Phase 4.2 foundations: the **engineering evaluation harness**, **AI operational tracing**, and **input-readiness (data-quality) gating**.
>
> **What this document is not.** A description of anything that runs. **No evaluation harness, no tracing, and no input-readiness result exist in this repository.** There is no agent to evaluate, no model call to trace, and no context to gate. This is design for a future phase.

Three registers, kept distinct: **approved architecture** (here), **future implementation** (Phase 4.2, with its own ADR), **current repository reality** (none of it exists).

---

## Evaluation begins before the first specialist

The specialists arrive in Phases 5–8. The evaluation harness arrives in **Phase 4.2, before any of them** — so each specialist is built against a harness that can fail it, rather than one bolted on after it already exists and already has defenders.

This is the same discipline as test-first for the critical deterministic rules ([engineering-principles.md](../governance/engineering-principles.md)): the check exists before the thing it checks, because a check written afterward is written to pass.

### Required evaluation categories

| Category | What it proves |
| --- | --- |
| Golden cases | Known-good inputs produce the expected reasoning and output |
| Hard negatives | Cases that look actionable but are not do not produce action |
| Adversarial prompt-injection cases | Injected instructions do not change behaviour |
| Multilingual prompt injection | Injection in Hindi, Hinglish, or Romanized Hindi is caught too |
| Routing correctness | A signal reaches the agent that owns its root cause ([agent-model.md](./agent-model.md)) |
| Domain-boundary refusal | An agent refuses to reason outside its domain |
| Evidence grounding | Every claim references real evidence, not invention |
| Structured-output compliance | Output validates against its contract |
| Stale-context behaviour | Stale facts are flagged, not silently used |
| Incomplete-context behaviour | Missing facts are flagged, not guessed |
| Model-fallback behaviour | Degradation to a fallback path is correct and visible |
| Cost regressions | A change does not quietly cost more per run |
| Latency regressions | A change does not quietly get slower |
| Hindi · English · Hinglish · Romanized Hindi | Reasoning and refusal hold across the languages actually used |
| Indian number formats · lakh and crore | ₹2.5 lakh and ₹1.2 crore are interpreted correctly, never as 2.5 or 1.2 |
| Locality and category terminology | Pune/Mumbai localities and interior/carpentry/modular terms are understood |

**Phase 14 owns a different question.** Phase 4.2 proves an agent version is *correct, grounded, and safe*. **Phase 14 proves it is *effective*** — real-world business outcome correlation, recommendation acceptance, confidence calibration, shadow comparison, regression detection, and automation-candidate evidence. Neither substitutes for the other: a correct agent that moves no business metric has passed 4.2 and failed 14, and that is a valid, informative result.

---

## AI operational tracing

Tracing covers the whole reasoning path, so that when a recommendation is wrong, *where* it went wrong is answerable:

```
canonical event
  → projection
  → coordinator route
  → specialist run
  → deterministic rules
  → knowledge retrieval
  → model gateway
  → output validation
  → recommendation
```

### What tracing may record

trace and span identifiers · agent and agent version · model and model version · prompt version · routing decision · retrieved source identifiers · token counts · latency · fallback reason · validation outcome · redaction outcome.

Every one of these is an **identifier, a version, a count, or an outcome** — the material an auditor needs to reconstruct *what happened* without ever recording *what was said about whom*.

### What tracing must never record

**chain-of-thought · raw personal-data prompts · complete raw model output · secrets · provider credentials · phone numbers · message bodies · call transcripts.**

This is not a softer version of the logging rules — it is the same rule ([security-principles.md](../governance/security-principles.md) §5, [privacy-principles.md](../governance/privacy-principles.md) §6–§7) applied to the one place most tempted to break it. A tracing system exists to help debug an AI, and "just log the full prompt and the full output so we can see what it did" is exactly the instinct that writes a phone number and a client's private situation into a trace store. The never-record list is what stands between that instinct and a breach. **A sensitive-data logging incident has a target of zero, and a trace is a log** ([success-metrics.md](../charter/success-metrics.md)).

---

## Input readiness — data quality as a first-class result

An agent is only as trustworthy as the facts it reasoned from. A recommendation built on stale or partial context is worse than no recommendation, because it looks identical to a good one. So context quality becomes an **explicit, structured result**, not a silent assumption.

### The input-readiness result

| Result | Meaning |
| --- | --- |
| `READY` | Facts are fresh and complete enough to reason on |
| `READY_WITH_WARNINGS` | Usable, with named caveats a reviewer should see |
| `STALE_CONTEXT` | The facts are older than the reasoning needs |
| `INCOMPLETE_CONTEXT` | Required facts are missing |
| `CONFLICTED_CONTEXT` | Facts disagree with each other and cannot be reconciled here |
| `SOURCE_UNAVAILABLE` | A source the run needed could not be reached |

### The input watermark

**Every agent recommendation must eventually carry an input watermark** (or equivalent evidence) showing the **freshness and completeness** of the facts it used. The watermark makes staleness *detectable* rather than invisible: a reviewer, and evaluation, can see that a recommendation rested on `STALE_CONTEXT` and weigh it accordingly, instead of treating every recommendation as though its inputs were perfect.

This is the reasoning counterpart to the freshness discipline the event backbone already applies to signatures and replay: a fact that was fresh once must be *known* to be old now, not silently trusted.

---

## Current repository reality

**None of this is implemented.** There is no agent, no model call, no coordinator, and therefore nothing to evaluate, trace, or gate. `apps/api` and `apps/worker` remain compileable boundaries. Phase 4.2 is approved architecture that a future, separately authorized phase will build, with its own implementing ADR ([ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)). The engineering evaluation harness here is distinct from, and precedes, the real-world business evaluation of Phase 14.
