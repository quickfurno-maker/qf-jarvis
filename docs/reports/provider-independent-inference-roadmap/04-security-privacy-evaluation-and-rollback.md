# Report 04 — Security, Privacy, Evaluation and Rollback

**Date:** 2026-07-21. **Documentation only — no provider implemented, no API called, no key used, no WhatsApp activated, no migration created. QFJ-P03 remains the active priority.** Source: [model-provider-independence.md](../../architecture/model-provider-independence.md), [ADR-0041](../../decisions/ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md).

## Security and failure invariants

1. Provider SDK objects never cross the adapter boundary.
2. Provider output is revalidated locally (structured-output validation refuses malformed output).
3. Hosted-provider requests are minimized and sanitized (no raw PII, credentials, secrets).
4. The local PC receives no business-system credentials.
5. No provider directly calls WhatsApp, n8n, or QuickFurno Core.
6. Provider errors never expose request content, prompts, headers, or secrets.
7. A provider outage never loses inbound messages (durable queue + retry + human handoff).
8. Fallback is idempotent.
9. Human-only mode is always available.
10. A production provider/model change requires evaluation approval.
11. One inference request produces at most one accepted outbound result.
12. Model-generated confidence is not business authority.

## Privacy and data boundaries

- Groq and the local model are **not** authoritative memory; memory remains provider-independent.
- Fact classification: `USER_CLAIMED` · `MODEL_INFERRED` · `CORE_VERIFIED` · `HUMAN_CORRECTED` · `SUPERSEDED`.
- Planned per-fact metadata: source · verification state · prompt version · knowledge version · **provider** · **model** · **adapter version** · timestamp · correction history · expiry/review status.
- WhatsApp content is **never** auto-promoted into RAG, training, evaluation, permanent memory, or business knowledge.
- Retrieved/inferred content is untrusted; source priority: live structured Core data → business rules → agent RAG → general model knowledge.

## Evaluation parity (QFJ-P04.04)

Every provider **and** every model passes the **same** gates before production: golden cases, hard negatives, adversarial + multilingual prompt injection, routing correctness, domain-boundary refusal, evidence grounding, structured-output compliance, stale/incomplete-context behaviour, fallback behaviour, cost/latency regressions, and the multilingual/Indian-market set (Hindi, English, Hinglish, Romanized Hindi, lakh/crore, locality/category). Not-passed → not activated.

## Environment-variable posture (no secrets in Git)

Provider and mode are chosen by configuration; **no real key is stored in the repository**. Secrets (`GROQ_API_KEY`, mTLS material) are injected at deploy time only and never committed; the local PC never receives business-system credentials. Illustrative variable names are documented in [model-provider-independence.md](../../architecture/model-provider-independence.md) (Environment-variable reference).

## Rollback and operations

- Each mode names a safe rollback target; the **universal rollback is `HUMAN_ONLY`**, always available.
- Mode switching is a **configuration** change (profile selection), never a code rewrite.
- A provider outage degrades to a configured, healthy fallback or to `HUMAN_ONLY`; inbound messages stay durably queued and are never lost.
- Monitoring: provider health, latency, error rate, fallback rate, budget consumption, capacity saturation, duplicate-suppression counters, human-handoff volume.

## Verdicts

- **Security & privacy verdict:** SATISFIED by design — SDK isolation, local revalidation, minimized/sanitized hosted requests, no business credentials on the local PC, no provider→WhatsApp/n8n/Core path, no secret leakage in errors, no message loss on outage, idempotent single-reply fallback, human-only always available, model confidence not authority.
- **Migration/SQL:** none created; no migration number allocated.
