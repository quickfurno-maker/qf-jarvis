# Model Provider Independence — Groq, Local-PC and Hybrid Inference

**Status:** Approved architecture (extension of QFJ-P04.01 / QFJ-P04.04, with QFJ-P11.06 deployment profiles and QFJ-P12 scaling). **Not implemented.** Adopted 2026-07-21 under [ADR-0041](../decisions/ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md). Read with [model-runtime-and-governance.md](./model-runtime-and-governance.md) (the model gateway), [qf-jarvis-roadmap-v3.md](./qf-jarvis-roadmap-v3.md), and [agent-constitution.md](../governance/agent-constitution.md).

> **What this is.** The provider-neutral architecture that lets a future Riya/Anisha conversation runtime run against Groq Cloud, a local-PC OpenAI-compatible server, or a hybrid — under owner control — without rewriting agents, transport, memory, or integrations.
> **What this is not.** Anything that runs. **No model provider, adapter, SDK, model call, or API key exists in this repository.** This is design a future phase implements.

## Provider-independence contract

```
Conversation runtime (Riya / Anisha)
        │  depends only on
        ▼
repository-owned  ModelProvider  interface
        │  selected by configuration
        ▼
provider adapter  (GroqProvider | LocalOpenAICompatibleProvider | FakeModelProvider | future approved)
        │  wraps
        ▼
provider SDK / HTTP  (NEVER crosses the adapter boundary)
```

- The runtime imports **only** the repository-owned `ModelProvider` contract — a bounded request/response shape (sanitized prompt inputs, model identifier, structured-output schema, bounded result + provenance). **Provider SDK objects never cross the adapter boundary.**
- **Riya, Anisha, the WhatsApp webhook, memory, queues, RAG, human handoff, and QuickFurno integration must not import Groq-specific or local-model-specific types.**
- A provider change requires only: configuration; adapter activation; a model identifier; and compatibility + evaluation approval (QFJ-P04.04). It must **not** require rewriting Riya, Anisha, the WhatsApp webhook, queue workers, delayed delivery, memory, RAG, task contracts, human handoff, or QuickFurno Core contracts.
- `FakeModelProvider` is the deterministic test double (no network, no key), exactly as the event backbone keeps its test emitter unresolvable in production.

## Operating modes

| Mode | Primary | Allowed fallback | Failure behaviour | Privacy restriction | Health requirement | Timeout | Cost policy | Capacity policy | Human handoff | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **GROQ_CLOUD** | Groq | none | fail closed → queue/retry → human | minimized, sanitized requests only; no raw PII/credentials | Groq reachable + within budget | bounded per request | cloud token budget + rate cap | provider rate limits respected | on exhaustion/outage | switch profile to LOCAL_PC or HUMAN_ONLY |
| **LOCAL_PC** | Local | none | fail closed → queue/retry → human | on-prem; no hosted egress of message content | local node healthy (GPU, model loaded) | bounded per request | local compute budget | GPU/session concurrency cap | on node-down | switch to GROQ_CLOUD or HUMAN_ONLY |
| **HYBRID_LOCAL_PRIMARY** | Local | Groq (explicit) | primary fail → **single** explicit fallback → human | fallback to Groq only for non-restricted content; restricted content stays local or goes human | local healthy; Groq reachable for fallback | bounded, per provider | prefer local; cloud only on fallback | local first, cloud on saturation | on both unavailable | disable fallback → LOCAL_PC, or → HUMAN_ONLY |
| **HYBRID_GROQ_PRIMARY** | Groq | Local (explicit) | primary fail → **single** explicit fallback → human | cloud primary; fallback local for continuity | Groq reachable; local healthy for fallback | bounded, per provider | prefer cloud within budget; local on fallback | cloud first, local on saturation/outage | on both unavailable | disable fallback → GROQ_CLOUD, or → HUMAN_ONLY |
| **HUMAN_ONLY** | none (human operators) | none | all conversations route to humans | strictest; no model sees content | always available | n/a | n/a | staffing-bounded | is the mode | re-enable a provider profile when ready |

**Fallback rules (all modes).** Fallback is **explicit** and configured — **no unexpected provider fallback**. The runtime does **not** call both providers for every message (fallback triggers only on a defined primary failure/health/timeout condition). **No fallback may create a duplicate outbound reply**: one inbound message yields at most one accepted outbound result, guarded by idempotency keys on the conversation turn. `HUMAN_ONLY` is **always available** as the ultimate fallback.

## Deployment boundaries

**Jarvis VPS owns:** inbound webhook · queues · task routing · provider selection · memory coordination · response validation · delivery scheduling · monitoring · execution intents.

**Local PC owns only:** model serving · GPU resource control · local-model health · model lifecycle.

**The local PC must NOT receive:** WhatsApp access tokens · Supabase service-role credentials · unrestricted database credentials · n8n administrative credentials · GitHub credentials · payment credentials.

**Local inference service transport:** a private authenticated connection · TLS/mTLS or equivalent signed service authentication · firewall allowlisting · **no anonymous public inference endpoint** · bounded, sanitized requests only. The VPS calls the local node as a bounded `ModelProvider`; the node returns bounded model output and never reaches back into business systems.

```
WhatsApp ⇄ Jarvis VPS (webhook, queues, routing, provider selection, validation, delivery, monitoring)
                     │  bounded, sanitized ModelProvider request over mTLS + firewall allowlist
                     ▼
             Local PC (model serving + GPU only)  ── no business credentials, no WhatsApp/n8n/Core access
```

## Agent ownership (unchanged)

Provider selection **never** alters agent authority. **Riya** = Customer Conversation and Qualification Agent; **Anisha** = Vendor Sales, Relationship and Success Agent (complete vendor lifecycle — **not** narrowed to onboarding/support). QuickFurno Core is the final business authority; Jarvis recommends/coordinates; n8n executes approved intents; providers deliver only. See [agent-constitution.md](../governance/agent-constitution.md).

## Memory and data boundaries

- Groq and the local model are **not** authoritative memory. Memory remains **provider-independent**.
- Every fact is classifiable as `USER_CLAIMED` · `MODEL_INFERRED` · `CORE_VERIFIED` · `HUMAN_CORRECTED` · `SUPERSEDED`.
- Store (or plan to store) per fact: source · verification state · prompt version · knowledge version · **provider** · **model** · **adapter version** · timestamp · correction history · expiry/review status.
- WhatsApp content is **never** automatically promoted into RAG, training, evaluation, permanent memory, or business knowledge. Retrieved/inferred content is untrusted reference material (source priority: live structured Core data → business rules → agent RAG → general model knowledge).

## Security and failure invariants

1. Provider SDK objects never cross the adapter boundary.
2. Provider output is revalidated locally (structured-output validation refuses malformed output).
3. Hosted-provider requests are minimized and sanitized (no raw PII, credentials, or secrets).
4. The local PC receives no business-system credentials.
5. No provider directly calls WhatsApp, n8n, or QuickFurno Core.
6. Provider errors never expose request content, prompts, headers, or secrets.
7. A provider outage never loses inbound messages (durable queue; retry; human handoff).
8. Fallback is idempotent.
9. Human-only mode is always available.
10. A production provider/model change requires evaluation approval.
11. One inference request produces at most one accepted outbound result.
12. Model-generated confidence is not business authority.

## Evaluation parity (QFJ-P04.04 extension)

Every provider **and** every model must pass the **same** gates before production use: golden cases, hard negatives, adversarial and multilingual prompt injection, routing correctness, domain-boundary refusal, evidence grounding, structured-output compliance, stale/incomplete-context behaviour, fallback behaviour, cost and latency regressions, and the multilingual/Indian-market set (Hindi, English, Hinglish, Romanized Hindi, lakh/crore, locality/category terminology). A provider or model that has not passed cannot be activated in production.

## Environment-variable reference (planned; conceptual — no secrets, no keys here)

Configuration selects the provider and mode; **no real key is stored in the repository**. Illustrative names only:

| Variable | Meaning |
| --- | --- |
| `QF_INFERENCE_PROFILE` | one of `GROQ_CLOUD` / `LOCAL_PC` / `HYBRID_LOCAL_PRIMARY` / `HYBRID_GROQ_PRIMARY` / `HUMAN_ONLY` |
| `QF_MODEL_PROVIDER_PRIMARY` / `QF_MODEL_PROVIDER_FALLBACK` | selected adapter identifiers (fallback empty unless a hybrid mode) |
| `QF_MODEL_ID_PRIMARY` / `QF_MODEL_ID_FALLBACK` | model identifiers per provider |
| `GROQ_API_KEY` | **injected at deploy time only**, never committed; used solely inside `GroqProvider` |
| `QF_LOCAL_INFERENCE_URL` | private local endpoint (allowlisted, mTLS) |
| `QF_LOCAL_INFERENCE_CLIENT_CERT` / `..._CA` | mTLS material for the VPS↔local channel (deploy-time secrets) |
| `QF_INFERENCE_TIMEOUT_MS`, `QF_INFERENCE_TOKEN_BUDGET`, `QF_INFERENCE_RATE_LIMIT` | per-request timeout and cost/capacity caps |

Secrets are injected at deploy time and never enter Git; the local PC never receives business-system credentials (see Deployment boundaries).

## Future local-inference migration notes

No database migration is required or allocated for this extension. If a future slice needs to persist provider/model provenance beyond existing contracts, it follows the [ADR-0039](../decisions/ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) migration-allocation rule (design approved · schema proven necessary · scope reviewed · prior inventory confirmed · managed rollout documented · creation separately authorized). QFJ-P12 local scaling (multiple nodes, multi-GPU, optimization, local specialist models, LoRA/fine-tuning, Groq as controlled fallback) is planned/disabled until separately activated.

## Rollback and operations

- Each mode's **rollback** column (above) names the safe target profile. The **universal rollback** is `HUMAN_ONLY`, which is always available.
- Switching modes is a **configuration** change (profile selection), not a code deploy; it must not require rewriting any agent or transport.
- A provider outage degrades to fallback (if configured and healthy) or to `HUMAN_ONLY`; inbound messages stay durably queued and are never lost.
- Monitoring (QFJ-P04.01E / QFJ-P11.06): provider health, latency, error rate, fallback rate, budget consumption, capacity saturation, duplicate-suppression counters, and human-handoff volume.

## Relation to the roadmap

- **QFJ-P04.01A–E** deliver the provider-neutral contracts, the Groq adapter, the local adapter, hybrid routing/failover, and provider operations/governance.
- **QFJ-P04.04** gates every provider/model through the same evaluation.
- **QFJ-P11.06** defines the five deployment profiles.
- **QFJ-P12** carries advanced local-inference scaling.

**Nothing here is implemented.** No provider, adapter, key, WhatsApp activation, migration, or SQL exists. Current QFJ-P03 work remains the active priority.
