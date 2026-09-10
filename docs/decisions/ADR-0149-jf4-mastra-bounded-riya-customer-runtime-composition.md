# ADR-0149 — JF-4: Mastra-bounded Riya customer runtime composition

- **Status:** Accepted — composes the Production V1 customer runtime. **This is not a deployment, not
  a live certification and not a running service.** No socket is bound, no provider is contacted, no
  credential exists in the repository, and no migration is added.
- **Date:** 2026-09-10
- **Baseline:** `origin/main` at `673977a5156f88776882ce8fe8975a37a1a9b077` (PR #199, JF-3).
  Migrations `0001`–`0013`. **JF-4 adds none.**
- **Governed by:** ADR-0145 (JF-1 scope freeze), ADR-0146/0147 (JF-2A/JF-2B gateway), ADR-0148 (JF-3
  governed exact RAG)
- **Depends on:** ADR-0094/0096 (private Riya web conversation service), ADR-0097 (private ingress),
  ADR-0102 (structured actions), ADR-0103 (RWC-P7 grounded knowledge), ADR-0104 (RWC-P8 channel-neutral
  turn and logical-turn idempotency), ADR-0114/0115 (JAO Mastra, operations lane — unchanged here)
- **Amends:** ADR-0103 in exactly one respect — §12 below.

## Context

Every piece of the customer path was already built and merged. A private ingress authenticates a
server-to-server request; a channel-neutral conversation service coordinates the logical turn, loads
continuity and delegates once to the Jarvis runtime; the runtime grounds, calls the gateway once and
takes Core's decision; JF-3 provisions governed retrieval under an exact knowledge-revision binding.

What did not exist was a production module that **joined** them. The ingress factory and the service
factory were composed only in tests, so a deployment had no artifact that said "this is the customer
runtime", and the question _does a customer turn go through an orchestration boundary?_ had no answer
anyone could check.

JF-4 is that composition, and the decision about where an orchestration framework belongs.

## Decision

### 1. There is ONE Riya

No second agent, no second prompt family, no second state machine, no second continuity store, no
second conversation-id scheme, no second knowledge registry, no second Core adapter, no second gateway
and no second memory. Riya's existing domain runtime remains the trusted customer-conversation
implementation, reached through the entry points it already exposes.

### 2. Mastra is an orchestration shell, not the Riya brain

The customer workflow is one step. It calls the existing conversation service exactly once and returns
that service's result. It renders no prompt, selects no model, contacts no provider, retrieves no
knowledge, touches no continuity, acquires no turn lease, reaches no Core and holds no memory.

One step is the honest shape. Extra steps were not invented to make the workflow look substantial —
a shell whose value is that it is inert should look inert.

### 3. Mastra lives at the application composition boundary

`apps/api/src/riya-customer-orchestration/`. Not in `packages/**`.

Domain packages stay framework-neutral so Riya, the gateway and the governed boundaries remain
reusable and testable without an orchestration framework, and so a future framework decision is one
application's problem rather than the repository's.

This is deliberately a different judgement from JAO-1, which moved a **founder-operations** workflow
out of `apps/api` because that slice did not belong there. Customer application composition does
belong in the application that already owns the private customer trust boundary. The JAO worker
workflow is not moved, and no operations module is imported into the customer path.

### 4. `packages/**` contain zero Mastra imports

Asserted by a scan, not by convention.

### 5. Customer Mastra adds ZERO model calls

A model-eligible turn has the same maximum gateway invocation count before and after. Mastra invokes
no model at all; the one call a turn may make is the runtime's, under its existing contract. Zero-model
paths — structured actions, human takeover, AI pause, replay, busy — stay zero.

There is **no retry**. If the service throws, the shell reports and stops. Riya's turn semantics are
built on a turn happening at most once, and a retry here would silently re-enter the logical-turn
coordinator, the continuity CAS and the model budget.

### 6. The QF Model Gateway remains the sole provider and model authority

### 7. The customer orchestration imports no provider adapter

No Groq, no Nara, no local provider, no gateway package, no model id, no `ProviderMode`, no credential,
no environment read, no network client. JF-2A and JF-2B are untouched, and Nara still has no production
evidence — `AUTO` remains unreachable for real serving until JF-5 supplies it.

### 8. No Mastra storage and no Mastra memory

Riya's continuity is authoritative. No workflow persistence, no thread memory, no vector memory, no
suspend/resume, no table and no migration.

The customer turn never enters Mastra's data plane at all: the workflow's schemas carry an opaque run
marker and a status, and the turn, the reply and the continuity travel in a closure for the duration of
one call. Mastra retains no customer content because it is never given any.

### 9. Riya continuity and the RWC-P8 logical-turn coordinator remain authoritative

The shell cannot manufacture a `messageId`, a `channelTurnRef` or a `requestId`, cannot turn a
`REPLAYED` outcome into a fresh run, and cannot retry a `BUSY` or `INDETERMINATE` turn. It calls the
service's own entry point; every one of those decisions stays inside it.

### 10. Private ingress authentication remains outside and superior to Mastra

Signature verification, freshness and replay protection, the strict wire schema, data-class derivation
and the browser-direct refusal all stay in the ingress, ahead of the shell. Mastra runs only on the
internal trusted side and never sees a key, a signature or a raw header.

**The wire contract does not change.** The ingress is typed against a service exposing `handleTurn`,
and the composition's runner exposes exactly that — so the ingress composes unchanged and no request or
response byte moves. Expected wire version change: **none**, and none was made.

### 11. The authorized reply remains the only client-facing text

The service's result is returned **by reference**. Nothing in the shell reads it, copies it, reshapes
it or adds to it, and a framework that serialized it could not preserve it byte-for-byte — which is
the entire contract for text Core authorized.

On a shell failure there is no result at all. A manufactured "Riya said nothing" is indistinguishable
to a caller from Riya actually having said nothing, so the shell refuses to invent one and the
ingress's existing bounded error path handles the exception, as it already did.

### 12. JF-3 RAG reaches Riya through the EXISTING RWC-P7 knowledge path — and the one seam that took

The RWC-P7 bridge owns what a grounded retrieval asks for and what reaches the model: the request built
from the run's own envelope, one retrieval per run, the envelope cross-check, the five-field
minimization, the citation shape, and the fail-closed refusal. Before JF-4 it also performed the lookup
itself, by calling `retrieveGovernedKnowledge` directly.

That left no way to route the production path through JF-3 without one of them duplicating the other.
Reimplementing the bridge's policy in the application would have created a second context assembler —
precisely what §13 forbids — so **one seam was added to `@qf-jarvis/jarvis-runtime`**, and it is the
smallest one that works:

`RiyaGroundedKnowledgeConfig` becomes a union. A deployment supplies **either** a `registry` (the
ADR-0103 form, unchanged) **or** a `retrieval` port that performs the lookup. Never both — a config
carrying both would leave an unused registry beside the port, a second body of knowledge that nothing
consults until somebody changes a line and it silently becomes the one that answers.

Nothing else differs, and a spec runs both forms over the same records and asserts the outputs are
identical across served, absent, expired, `HUMAN_ONLY` and subject-linked-without-a-gate cases. The
ADR-0103 path is preserved byte-for-byte; all 293 existing runtime specs pass unchanged.

The application-side adapter is eleven lines: it calls `invokeRagRetrieval` and maps the outcome. It
builds no request, minimizes nothing, shapes no citation and holds no retrieval policy.

### 13. Mastra does not own RAG

The shell imports no knowledge package, sees no record, and does not know whether the turn was grounded.
Retrieval stays inside the Riya/Jarvis runtime composition, which is what stops the orchestration layer
becoming a second context assembler.

### 14. `@qf-jarvis/governed-knowledge` remains the knowledge authority

JF-3 provisions access; the authority decides what may be seen. Both unchanged.

### 15. Exact-topic retrieval only; no semantic planner

No embedding, no vector index, no free-text query, no query expansion, no keyword parsing, no second
model call to choose knowledge, and no provider tool that could invent a topic id. Topics remain
deployment-configured and are passed through verbatim.

Zero topics means **no retrieval**, never "retrieve everything".

### 16. The empty production pack is not permission to invent

The production knowledge pack still holds **zero** records, and JF-4 seeded nothing — not from
assistant memory, synthetic corpora, training data, QuickFurno or the web.

A configured grounded path therefore receives a refusal, not an empty success, and Riya's existing
fail-closed behaviour applies. Ungrounded conversation continues where existing policy already allows
it, so an empty pack does not break ordinary turns; it simply grounds nothing.

### 17. Core remains authoritative for volatile, commercial and consent truth

Unchanged. Stable governed reference material is RAG's; live status, price, stock, lead stage and
consent are Core's, and a model may not invent any of them.

### 18. No live provider call in JF-4

Deterministic doubles throughout. No Groq key, no Nara key, no network.

### 19–24. What JF-4 does not do

No QuickFurno and no OneDecore. No WhatsApp transport — `WHATSAPP` appears only as a channel name in
the canonical RWC-P8 vocabulary, and a spec asserts every occurrence is a quoted channel literal. No
deployment, no listener, no readiness. No migration. **JF-5** owns real model and provider
certification; **JF-6** owns deployment, observability and authenticated operator controls; **JF-7**
freezes the external handshake contract.

## Consequences

Positive: the customer runtime has one obvious composition artifact; the orchestration boundary is
explicit and provably inert; JF-3's governed retrieval reaches the production path without duplicating
RWC-P7; and JF-5 inherits a runtime it can exercise with real providers without architectural work.

Negative, and accepted:

- **A third-party framework now sits on the customer path.** `@mastra/core` was already in the
  repository lock at `1.61.0` for the operations lane; JF-4 adds the same exact version to `apps/api`.
  That is an application dependency delta, not a new repository supply-chain introduction — but it is
  a real dependency on the path a customer request takes, and the containment scans exist because of it.
- **One package widened.** `jarvis-runtime` gained a retrieval port on an existing config. The
  alternative was duplicating RWC-P7's policy in the application, which would have been worse.
- **The empty pack means grounded paths refuse.** Honest, and unchanged from JF-3.
- **The composition binds nothing.** It returns objects; a deployment still cannot serve traffic until
  JF-6.

## Next

**JF-5** — real Groq/Nara model certification.
