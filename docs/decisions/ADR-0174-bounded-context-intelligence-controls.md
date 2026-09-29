# ADR-0174 — Bounded context intelligence controls

**Status:** Accepted / implemented foundation
**Date:** 2026-09-29
**Depends on:** ADR-0158, ADR-0159, ADR-0162, ADR-0163, ADR-0173

## Decision

Production conversation scaling adds three separate optimizations: revision-bound semantic caching,
QuickFurno-owned conversation context summarization, and certification-aware adaptive model routing.
None of them acquires business authority, provider authority or execution authority.

## Semantic caching

Semantic caching is attached to the governed HYBRID knowledge retriever, not to arbitrary model replies.
A cache key is bound to the exact knowledge revision, embedding model, tenant, agent scope, purpose, data
class, topic filters and retrieval budgets. Similarity is evaluated only after those exact bindings
match.

Production may enable caching only in `PUBLIC_KNOWLEDGE_ONLY` mode with an explicit topic allowlist.
Only `HOSTED_ALLOWED`, non-expiring records may enter the cache. A cache failure is an optimization
failure only: the authoritative retrieval path continues. Core-owned or volatile operational values,
expiring policies and unapproved topics are never cached.
The first implementation is bounded process-local memory with deterministic capacity. It introduces no
new persistence authority and no cross-deployment cache consistency claim. Knowledge revision changes
therefore invalidate entries structurally rather than by best-effort purge.

## Conversation summarization

QuickFurno remains the durable conversation owner. Jarvis does not create a second WhatsApp transcript
or continuity database. QuickFurno reconstructs a bounded extractive context on demand from its existing
durable inbound ledger and sealed outbound ledger.

The context is limited to recent turns and a bounded character budget and is labeled exactly
`NON_AUTHORITATIVE_CONVERSATION_CONTEXT`. Historical inbound material is included only when it is
`HOSTED_ALLOWED`; historical outbound material is limited to JARVIS/SYSTEM messages. Human-authored,
LOCAL_ONLY and HUMAN_ONLY history is not recycled into hosted inference context.

The context protocol is separately signed and bound to the exact conversation, current inbound message
and conversation revision. Jarvis fetches it in parallel with the authoritative turn material. Context
failure is best-effort: the current authorized customer turn may continue without history rather than
being retried or dropped.
Conversation context may help continuity, pronoun resolution and avoiding repeated discovery questions.
It is never evidence for price, package, payment, consent, eligibility, assignment, vendor state, lead
state or other QuickFurno Core truth. The prompt input labels that limitation explicitly.

## Adaptive model routing

Adaptive routing operates only over pre-composed specialist runtimes whose exact release IDs are in the
active certified-release set. The router cannot instantiate a provider, supply a credential, change an
agent, execute a capability, or route to an unlisted release.

Turn complexity is derived from bounded external signals such as current-text size, conversation-context
size, retrieval count, ambiguity flags, Core-verification need, multi-step reasoning and high-risk
posture. Model self-confidence does not grant routing authority. Invalid signals fail closed.

The current production seal activates one Groq release, so SIMPLE, STANDARD and COMPLEX currently
resolve to that same certified runtime. This is intentional. Luna/Sol routing becomes effective only
after their exact OpenAI releases, prompts/configuration and evidence are separately certified and
activated. Adding a model to a route map does not certify it.

## Authority invariants

- Luna/Sol/provider output remains proposal intelligence only.
- QuickFurno Core remains authoritative for current business and operational state.
- RAG remains reviewed reference evidence, not live state.
- Offline training datasets remain offline and are never semantic-cache input.
- QuickFurno retains final communication authorization and execution authority.
- No web search, MCP, arbitrary tools or action authority is introduced by these controls.

## Deployment posture

Semantic caching defaults to `DISABLED` until the first approved public topic allowlist and exact
knowledge release exist. Conversation context is a separately signed optional read and may be rolled out
independently because Jarvis degrades to the current stateless turn when it is unavailable. Adaptive
routing is serving-active as a certification gate, but it cannot change models until more than one exact
release is ACTIVE-certified.

Any change that weakens these source, expiry, privacy, revision or certification bindings requires a
superseding ADR and new production evidence.
