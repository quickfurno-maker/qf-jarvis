# Report 03 — Privacy, Authority, Budget and Failure Proof

**Date:** 2026-07-24. **Slice:** QFJ-P04.01A. **ADR:** [ADR-0045](../../decisions/ADR-0045-qfj-p04-01a-model-gateway-foundation.md).

## Authority boundary (locked)

- The gateway **authorizes nothing and executes nothing**: `invoke` returns a validated data result with provenance — proven, the response exposes no `authorize`/`execute` method and no tool/n8n/DB access.
- Model output is **advisory/proposed only**; model confidence is not business authority. QuickFurno Core remains the final authority; n8n executes only authorized intents; a model proposes a typed intent that Core authorizes/rejects.
- Agent scope is a **closed** vocabulary (`CLIENT`=Riya, `VENDOR`=Anisha, `COORDINATION`=Jarvis, `SYSTEM`); an unknown scope is rejected — proven. Riya (CLIENT) and Anisha (VENDOR) scopes are distinct and validated.
- **Kimi is excluded** — proven: no `kimi` reference anywhere in production source.

## Privacy and redaction

- Requests are minimized/sanitized: bounded messages, a closed scalar metadata shape, **no secret, no raw DB/provider object, no subject reference, and no chain-of-thought field** — proven by the request-validation tests (strict schema rejects extra fields; nested metadata rejected; no `reasoning`/`chainOfThought` field on the contract).
- The response carries no raw provider object, no headers, and **no hidden reasoning** — proven, `JSON.stringify(response)` contains no message content.
- Errors carry only a closed code and a fixed message — **never** a prompt, message content, subject, header, key, raw provider body, or `cause` — proven (a `SECRET-CONTENT` message never appears in the thrown error; `cause` is undefined).
- Observability events carry only a closed type, safe codes, identifiers, and numeric/enum metadata — **never content** — proven.

## Budgets (refuse, not truncate)

- The token budget is enforced against a deterministic estimate — proven (a long message over a tiny `tokenBudget` → `token-budget-exceeded`, provider never invoked).
- The cost budget is enforced via the injectable policy — proven (an injected refusing policy → `cost-budget-exceeded`, provider never invoked).
- Budgets are an **injectable** policy (aggregate/per-agent accounting can replace the default later). No billing system, no database, **no financial authority**.

## Failure and reliability (deterministic)

Proven against the deterministic FakeModelProvider (injected clock, no wall-clock sleep):

- **timeout** — a provider timeout, and a completed result whose latency exceeds `timeoutMs`, both normalize to `timeout`.
- **cancelled** — an already-aborted signal → `cancelled` (no retry).
- **retry budget** — a `retryBudget` of 1 retries once then fails `retry-budget-exhausted` (exactly 2 invocations).
- **circuit breaker** — after the failure threshold the circuit **opens deterministically** and the next request is refused `circuit-open` without invoking the provider.
- **kill switch** — refuses immediately (`kill-switch-active`) before any provider invocation.
- **concurrency/queue** — a bounded semaphore refuses `concurrency-limit` (queue 0) and `queue-full` (queue at cap), never blocking forever and never busy-spinning.
- **single fallback, single response** — at most one fallback provider, at most one accepted response; no voting, no parallel fan-out.
- **structured output** — valid structured output is accepted; output failing the schema → `structured-output-invalid`; a structured request receiving text → `malformed-provider-output`; the gateway never "repairs" malformed output with a hidden model call.

## Provenance

Every successful result carries `runId`, `purpose`, `providerId`, `modelId`, `modelVersion`, `promptId`, `promptVersion`, `mode`, `usedFallback`, and `attempts` — proven. Provenance is returned in-memory; QFJ-P04.01A persists nothing.
