# Model Runtime and Governance — QF Jarvis

**Status:** Approved architecture (Phase 4.0). **Not implemented.**
**Date:** 2026-07-16
**Decision:** [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)

> **What this document is.** The approved architecture for how QF Jarvis invokes models — the **model gateway** — introduced in **Phase 4.0**, before the first specialist agent.
>
> **What this document is not.** A description of anything that runs. **No model gateway exists in this repository.** There is no model SDK, no model call, no prompt, no local model, no remote provider, and no agent. This is the design a future phase implements; it is not a claim that the design is built.

Three registers, kept distinct throughout, because a design document that blurs them is how a plan gets mistaken for a system:

- **Approved architecture** — decided, and recorded here.
- **Future implementation** — Phase 4.0 and its own implementing ADR.
- **Current repository reality** — none of it exists yet.

---

## Why a gateway at all

The specialists (Phases 5–8) reason with a model. The tempting shape is for each agent to hold its own model client. That shape is wrong here for the same reason the whole architecture is shaped the way it is: **capability you distribute is capability you cannot govern.** Five agents each holding a model client is five places a provider key lives, five places a cost limit can be forgotten, five prompt-versioning schemes, and five independent ways for personal data to leave for a remote endpoint.

**So there is exactly one gateway, and every model call goes through it.** An agent asks; the gateway decides and calls. This is the same containment argument as ADR-0002 (recommend/authorize/execute) applied to model invocation: the narrow waist is where governance lives.

**Agents never import or call model providers directly.** No agent holds a provider SDK, an API key, or a base URL. That is not a lint rule to remember — it is enforced structurally, the way `packages/contracts` is kept pure and the test emitter is kept unresolvable: the provider client is a dependency of the gateway package and of nothing else.

---

## Gemma-first, model-independent

The initial model is **Gemma, run locally**. The architecture is written so the model behind the gateway can change — a different local model, a different size, or a governed remote model — **without touching an agent**. An agent expresses *what it needs* (a bounded reasoning task with a typed output contract); the gateway owns *which model serves it* and *where that model runs*.

Naming Gemma is a starting point, not a lock-in. Naming "local first" is a **privacy posture**: the cheapest way to keep a client's data out of a third party's model is to not send it there.

---

## Runtime modes

Model use has a governed lifecycle, exactly as agent versions and automation levels do:

| Mode       | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| `OFF`      | The gateway serves no model calls. Deterministic rules still run; model-backed reasoning does not |
| `SHADOW`   | The gateway runs the model but its output reaches no human — measured, not used            |
| `CANARY`   | A bounded fraction of eligible requests are served live; the rest stay on the prior behaviour |
| `ACTIVE`   | The gateway serves model-backed requests normally, within all budgets and limits            |
| `FALLBACK` | The primary path is unavailable; the gateway is serving a degraded or alternative behaviour |

Modes move forward on evidence and backward on trouble. `SHADOW` before `CANARY` before `ACTIVE` mirrors [automation-levels.md](../governance/automation-levels.md): nothing model-backed reaches a human before it has been watched.

---

## What the gateway governs

**Routing and placement.**

- **Model routing** — which model serves which request class.
- **Local-versus-remote policy** — what runs locally and what, if anything, may leave for a remote model. The decision is made **before** the request is sent.
- **Privacy classification before remote processing** — data is classified first; unclassified or too-sensitive data does not leave the local boundary. A remote model call is a data export, and an export of unclassified personal data does not happen ([privacy-principles.md](../governance/privacy-principles.md)).

**Reliability.**

- **Timeout and circuit-breaker policy** — a slow or failing backend trips rather than hangs, and the trip is visible.
- **Retry budgets** — bounded. A retry budget is a number, not "keep trying."
- **Provider fallback** — a documented, tested path to an alternative when the primary is down.
- **Emergency kill switch** — one action stops all model invocation. It costs nothing to pull and breaks nothing that a human cannot resume.

**Cost, compute and concurrency governance.**

- **Token budgets** and **cost budgets** — per run, per agent, and in aggregate. A run that would exceed its budget is refused, not silently truncated into a wrong answer.
- **Concurrency limits** and **queue limits** — a cap on parallel model work and a cap on the backlog waiting for it.
- **Resource-pressure controls** — a way to shed load when the local model or the host is saturated, rather than degrading every request at once.

**Provenance and validation.**

- **Prompt versioning** and **model versioning** — both pinned, both recorded on every run.
- **Model and prompt provenance** — every model-backed run records the model version and the prompt version. **Model provenance without prompt provenance is not provenance**: without the prompt version the run cannot be reproduced, regression-tested, or explained the day it goes wrong ([agent-model.md](./agent-model.md)).
- **Structured-output validation** — the model's output is validated against a contract. A malformed output is a **failure**, not a value to coerce into shape. This is [security-principles.md](../governance/security-principles.md) applied to model output: untrusted content is validated, never trusted.

---

## Two rules that do not bend

**No consumer AI subscription may be treated as a production model backend.** A personal or consumer chat subscription is ungoverned by any enterprise data agreement, offers no data-processing guarantees, and is not a production dependency. It must never sit behind the gateway in production.

**No raw chat, model output or business conversation becomes training data automatically.** Training eligibility is an explicit decision by a named human, or a named and versioned policy a human approved, against complete provenance and with a stated purpose limitation. **Sensitive personal data is never eligible, under any approval** ([ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md)). The gateway captures provenance; it never promotes a conversation into a dataset on its own.

---

## What the gateway does not do

- It **authorizes nothing** and **executes nothing.** It turns a bounded request into a model call and returns a validated result. Authorization is QuickFurno Core's; execution is n8n's.
- It **holds no provider communication credential** — no WhatsApp, no telephony. A model backend is not a communication provider.
- It is **not an agent** and makes **no domain judgment.** It is infrastructure the agents call.
- It **stores no chain-of-thought.** What is retained is provenance and the validated output, never the model's private deliberation ([privacy-principles.md](../governance/privacy-principles.md) §7).

The permanent boundary is unchanged: a fully hijacked model, prompted by hostile injected content, still cannot authorize, execute, dial, message, move money, or write business state. Its maximum output is a *misleading recommendation* a human reviews with the evidence attached ([security-principles.md](../governance/security-principles.md)).

---

## Current repository reality

**None of the above is implemented.** `apps/api` and `apps/worker` remain compileable boundaries. There is no gateway package, no model, no prompt, no provider, and no agent. Phase 3 (the event backbone) is the current work; Phase 4.0 is approved architecture that a future, separately authorized phase will build, with its own implementing ADR ([ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).
