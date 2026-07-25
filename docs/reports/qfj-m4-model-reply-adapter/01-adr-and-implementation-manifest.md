# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-M4 — Model-Gateway Reply Adapter Foundation. **ADR:** [ADR-0057](../../decisions/ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) (committed **first**, before any implementation).

## What this slice adds

A new package `@qf-jarvis/model-reply-adapter`: a **concrete implementation of the M2 `ModelReplyPort`**. It translates an authority-safe M2 **reply plan** into an **exact model-gateway request**, obtains a result through a **narrow injected synchronous gateway invoker** (a thin facade over the existing gateway), and **strictly validates** the returned structured result — its **provenance**, its **citations**, and the surrounding **conversation state** — into a bounded structured reply **draft**. It is the concrete Jarvis→model reply-drafting boundary that M2 left as an injected port.

## The existing gateway remains the routing authority

The adapter **composes** `@qf-jarvis/model-gateway` and delegates **all** routing, capability matching, data/execution-class eligibility, rollout mode, provider selection, local/hosted selection, failover, timeout/retry/circuit behaviour, and provider-error normalization to it. The adapter introduces **no second router**, **no hard-coded provider/model id**, and **no fallback**; it activates no release and promotes no rollout. Because the M2 port is synchronous and this phase authorizes no credential/network, the gateway is reached through a **synchronous injected invoker facade** driven by **deterministic fakes only** — the live async gateway binding is deferred.

## Boundary (what it does NOT do)

No live Groq/local call, no key/token/env, no network; no provider activation or rollout promotion; no live QuickFurno Core; no WhatsApp/n8n/send/transport/delivery; no persistence/DB/schema/**migration 0008**; no knowledge retrieval; no semantic/vector/embedding/RAG; no dashboard; no deployment. Model output is a **draft/proposal input only** — never a Core `ACCEPTED`, never sent, delivered, or executed.

## Package layout

```
packages/model-reply-adapter/
  package.json                     @qf-jarvis/model-reply-adapter; deps: agent-runtime + model-gateway + zod
  tsconfig.build.json              emitting build (rootDir src, excludes src/tests); refs -> agent-runtime, model-gateway
  tsconfig.json                    noEmit tests typecheck
  src/contracts/
    reply-schema.ts                strict provider-neutral structured reply (closed draft kinds)
    reasons.ts                     closed content-free adapter reason vocabulary
    errors.ts                      ModelReplyAdapterError (invalid-plan / invalid-request)
    digest.ts                      pure FNV-1a citation digest + canonical instant (no node:crypto)
    state.ts                       injected content-free ReplyState + reader (pre/post-gateway gate)
    observability.ts               closed content-free ModelReplyAdapterEvent + hook + NOOP
    adapter-result.ts              ModelReplyAdapterResult + SafeReplyProvenance
  src/gateway/
    model-gateway-invoker.ts       narrow synchronous injected invoker over the existing gateway
  src/adapter/
    build-gateway-request.ts       exact ModelRequest builder (versioned prompt contract; closed metadata)
    validate-provenance.ts         exact provider/model/version/prompt/run provenance match
    validate-gateway-result.ts     strict structured-result validation
    validate-citations.ts          exact citation-subset authorization (no silent drop)
    state-gates.ts                 the pre/post-gateway state gate
    create-model-reply-adapter.ts  the ModelReplyPort factory: draftReply + draftReplyDetailed
  src/index.ts                     locked root barrel (production only)
  src/testing/
    deterministic-model-gateway.ts scripted / raw / text / mismatched / refusing / throwing invoker + state fakes
    fixtures.ts                    synthetic ReplyPlan + release + structured reply
    index.ts                       ./testing barrel (never in root)
  src/tests/                       the QFJ-M4 test matrix (excluded from dist)
```

## Commit sequence

1. `docs(adr): define M4 model reply adapter` — ADR-0057 first.
2. `feat(model-reply-adapter): add exact gateway composition` — contracts, invoker seam, request builder.
3. `feat(model-reply-adapter): enforce provenance and state gates` — adapter, validators, gates, testing fakes, barrel.
4. `test(model-reply-adapter): prove structured reply and no-send boundary` — the full test matrix.
5. `docs(reports): record M4 adapter evidence` — these reports + the narrow roadmap update.

## Verification snapshot

`pnpm run format:check`, `lint --max-warnings=0`, `typecheck` (+ `typecheck:tests`), `test:unit` (**3307** tests, 107 files), `build`, and `check:dist-containment` all pass. `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are byte-exact and there is **no 0008**.
