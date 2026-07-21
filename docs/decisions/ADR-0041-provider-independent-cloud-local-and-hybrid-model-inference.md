# ADR-0041 — Provider-Independent Cloud, Local and Hybrid Model Inference

**Status:** Accepted (2026-07-21, roadmap extension — documentation and governance only; no runtime implementation)
**Deciders:** Owner
**Phase:** QFJ-P04 — Model Gateway, Knowledge and Evaluation Foundation (extension of QFJ-P04.01 and QFJ-P04.04); QFJ-P11 and QFJ-P12 extensions

**Relates to:** [qf-jarvis-roadmap-v3.md](../architecture/qf-jarvis-roadmap-v3.md) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) (canonical roadmap, change-control rule) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) (model-gateway-first sequencing) · [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md) (the model-gateway architecture) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) (agent boundaries) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) (recommend/authorize/execute)

**New document introduced:** [docs/architecture/model-provider-independence.md](../architecture/model-provider-independence.md) — provider-neutral inference architecture (contracts, operating modes, deployment boundaries, security/privacy, memory, env-var reference, rollback).

> **This ADR extends the roadmap only. It implements nothing.** No model provider, adapter, SDK, source, migration, or SQL is created. No Groq, Supabase, managed PostgreSQL, WhatsApp, n8n, or production system is accessed; no API key is used. The next migration number is **not** allocated. Current QFJ-P03 work remains the active priority and is unchanged.

---

## Context

The canonical roadmap already places **all** model invocation behind a single governed **model gateway** (QFJ-P04.01, historical Stage 4.0; [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)): "agents never import or call model providers directly." What the roadmap did **not** yet make explicit is that the future Riya and Anisha conversation runtime must be able to run — under owner control — against **Groq Cloud**, a **local-PC OpenAI-compatible server**, or a **hybrid** of the two, and to fall back to a **human-only** mode, **without rewriting any agent, transport, memory, or integration code**. This ADR fixes that as an architectural requirement and extends the roadmap to carry it, so provider choice becomes a **configuration and evaluation** decision rather than a code rewrite.

## Problem statement

Without an explicit provider-independence contract, an eventual "use Groq" or "use a local model" decision risks leaking provider-specific types into Riya, Anisha, the WhatsApp webhook, queue workers, memory, RAG, task contracts, human handoff, or the QuickFurno Core contracts — coupling the whole runtime to one vendor and making a switch a rewrite. It also risks unsafe operational behaviour: silent/unexpected fallback, duplicate outbound replies, business-system credentials reaching a local PC, or a provider outage losing inbound messages.

## Decision

### 1. Provider-independence contract

The conversation runtime depends only on a **repository-owned `ModelProvider`** interface; a **selected adapter** implements it. Conceptual adapters: `GroqProvider`, `LocalOpenAICompatibleProvider`, `FakeModelProvider`, and future approved adapters. **Provider SDK objects never cross the adapter boundary.** Changing provider requires only configuration, adapter activation, a model identifier, and compatibility + evaluation approval — **never** a rewrite of Riya, Anisha, the WhatsApp webhook, queue workers, delayed delivery, memory, RAG, task contracts, human handoff, or QuickFurno Core contracts.

### 2. Roadmap extension (no new major phase, no renumbering)

- **QFJ-P04.01** gains subphases: **A** Provider-Neutral Contracts · **B** Groq Cloud Adapter · **C** Local OpenAI-Compatible Adapter · **D** Hybrid Routing and Failover · **E** Provider Operations and Governance.
- **QFJ-P04.04** is extended so **every provider and model passes the same** evaluation, language (multilingual/Indian-market), authority, security, and failure tests before production use.
- **QFJ-P11** gains **QFJ-P11.06 — Inference Deployment Profiles**: `PROFILE_GROQ_CLOUD`, `PROFILE_LOCAL_PC`, `PROFILE_HYBRID_LOCAL_PRIMARY`, `PROFILE_HYBRID_GROQ_PRIMARY`, `PROFILE_HUMAN_ONLY`.
- **QFJ-P12** gains advanced local-inference scaling: multiple local nodes, multi-GPU, model optimization, local specialist models, future LoRA/fine-tuning, and Groq as a controlled fallback.

### 3. Operating modes (explicit, no surprise fallback)

`GROQ_CLOUD`, `LOCAL_PC`, `HYBRID_LOCAL_PRIMARY`, `HYBRID_GROQ_PRIMARY`, `HUMAN_ONLY`. Each mode declares its primary provider, allowed fallback, failure behaviour, privacy restrictions, health requirements, timeout, cost policy, capacity policy, human handoff, and rollback (full table in [model-provider-independence.md](../architecture/model-provider-independence.md)). **Fallback is explicit and configured**; there is **no unexpected provider fallback**; the runtime does **not** call both providers for every message; and **no fallback may create a duplicate outbound reply**.

### 4. Deployment boundaries

The **Jarvis VPS** owns inbound webhook, queues, task routing, provider selection, memory coordination, response validation, delivery scheduling, monitoring, and execution intents. The **local PC** owns only model serving, GPU resource control, local-model health, and model lifecycle. The local PC **must not** receive WhatsApp access tokens, Supabase service-role credentials, unrestricted database credentials, n8n administrative credentials, GitHub credentials, or payment credentials. The local inference service uses a private authenticated connection (TLS/mTLS or equivalent signed service auth), firewall allowlisting, **no anonymous public inference endpoint**, and bounded sanitized requests.

### 5. Agent ownership unchanged

The Agent Constitution is preserved. **Riya** remains the Customer Conversation and Qualification Agent; **Anisha** remains the Vendor Sales, Relationship and Success Agent (**not** narrowed to onboarding/support). **Provider selection never alters agent authority.** QuickFurno Core remains the final business authority; Jarvis recommends and coordinates; n8n executes approved intents; providers deliver only.

### 6. Memory and data boundaries

Groq and the local model are **not** authoritative memory systems; memory remains provider-independent. Every fact is classifiable as `USER_CLAIMED`, `MODEL_INFERRED`, `CORE_VERIFIED`, `HUMAN_CORRECTED`, or `SUPERSEDED`, and (planned) carries source, verification state, prompt version, knowledge version, provider, model, adapter version, timestamp, correction history, and expiry/review status. WhatsApp content is **never** auto-promoted into RAG, training, evaluation, permanent memory, or business knowledge.

### 7. Security and failure invariants

Provider SDK objects never cross the adapter boundary; provider output is revalidated locally; hosted-provider requests are minimized and sanitized; the local PC receives no business-system credentials; no provider directly calls WhatsApp/n8n/Core; provider errors never expose request content, prompts, headers, or secrets; a provider outage never loses inbound messages; fallback is idempotent; human-only mode is always available; a production provider/model change requires evaluation approval; **one inference request produces at most one accepted outbound result**; and model-generated confidence is **not** business authority.

## Rejected alternatives

- **Bake a single provider (Groq or local) into Riya/Anisha directly.** Rejected: couples the whole runtime to one vendor; a switch becomes a rewrite; violates the model-gateway-first principle.
- **Automatic best-effort fallback that calls both providers.** Rejected: doubles cost/latency, risks duplicate outbound replies, and makes behaviour non-deterministic — fallback must be explicit and idempotent.
- **Run business logic or hold business credentials on the local PC.** Rejected: the local PC is a model server only; credentials and authority stay on the VPS/Core.
- **Treat model confidence as authority, or promote WhatsApp text into memory/RAG automatically.** Rejected: models advise; Core authorizes; retrieved/inferred content is untrusted.
- **A new major roadmap phase for inference providers.** Rejected: this is an extension of QFJ-P04.01/P04.04/P11/P12; no renumbering.

## Consequences

**Positive.** Provider choice becomes a governed configuration + evaluation decision; Groq, local-PC, and hybrid modes are all reachable without rewriting agents/transport/memory; human-only mode guarantees continuity; security and privacy boundaries are explicit before any implementation.

**Migration/delivery.** No migration, SQL, source, adapter, or deployment in this task. No migration number is allocated. Managed PostgreSQL status is unchanged. QFJ-P03 remains the active priority.

## Change-control rule

This extension adds subphases and profiles; it changes **no** existing major phase ID, agent authority, migration ownership, or the Core/Jarvis/n8n/provider boundary. Activating a provider adapter in production requires evaluation approval (QFJ-P04.04) and, for deployment, an owner-selected profile (QFJ-P11.06). Changing the provider-independence contract, the operating-mode semantics, or the deployment credential boundary requires a superseding ADR. Operational status may advance without a new ADR.
