# Report 01 — ADR and Implementation Manifest

**Slice:** QFJ-M3 — QuickFurno Core Decision Adapter Foundation. **ADR:** [ADR-0056](../../decisions/ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) (committed **first**, before any implementation).

## What this slice adds

A new package `@qf-jarvis/core-decision-adapter`: a **concrete implementation of the M2 `CoreDecisionPort`**. It converts a revision-bound M2 proposal into a **versioned Core command**, hands that command to a **narrow injected transport** (a serialized string in, a serialized string out), **strictly validates** the Core response identity, and returns a **closed outcome**. It produces `ACCEPTED` **only** when Core returns it against the exact command identity with unchanged conversation state. It is the concrete Jarvis→Core decision boundary that M2 left as an injected port.

## This is a PROPOSED integration contract

**No authoritative live QuickFurno Core decision protocol exists today** (the Core adapter baseline, [ADR-0025](../../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md), is **Proposed**). M3 therefore defines a **provider-neutral, PROPOSED** command/response protocol and an injected transport seam, implemented against **deterministic fakes only**. **Later QuickFurno Core-side adoption of this protocol is required** before any live use; real transport, authentication, and persistence are separately authorized future slices.

## Boundary (what it does NOT do)

No live QuickFurno Core, network, HTTP, socket, auth, or secret; no WhatsApp/n8n/send/transport/delivery-state mutation; no persistence, DB, schema, or **migration 0008**; no live model/provider/key/token; no semantic retrieval / vector / embeddings / RAG; no dashboard; no deployment. The adapter contains **no business decision rule** and **cannot fabricate or upgrade** an outcome. `ACCEPTED` is an **approved proposal only** — never sent, delivered, executed, or persisted.

## Package layout

```
packages/core-decision-adapter/
  package.json                     @qf-jarvis/core-decision-adapter; deps: agent-runtime + zod; exports "." and "./testing"
  tsconfig.build.json              emitting build (rootDir src, excludes src/tests); ref -> agent-runtime
  tsconfig.json                    noEmit tests typecheck
  src/contracts/
    protocol.ts                    CoreDecisionProtocol identity + strict schema + DEFAULT (proposed) protocol
    digest.ts                      pure FNV-1a contentDigest / canonicalJson / isCanonicalInstant (no node:crypto)
    reasons.ts                     closed content-free adapter reason vocabulary
    errors.ts                      CoreAdapterError('invalid-command') — fixed, content-free message
    state.ts                       injected content-free CoreDecisionState + reader (double gate)
    command.ts                     immutable versioned command + deterministic idempotency key
    response.ts                    strict Core response schema (closed outcomes, canonical instant)
    observability.ts               closed content-free CoreAdapterEvent + hook + NOOP
  src/transport/
    core-decision-transport.ts     narrow injected transport interface + content-free serialization
  src/adapter/
    validate-response.ts           strict parse + identity check (response-invalid / identity-mismatch)
    state-gates.ts                 the double state gate (pre-transport + post-response)
    retry-classification.ts        information-only retry classifier (no auto-retry)
    create-core-decision-adapter.ts the CoreDecisionPort factory: decide + decideDetailed
  src/index.ts                     locked root barrel (production only)
  src/testing/
    deterministic-core-transport.ts scripted / throwing / malformed / mismatched transport + state fakes
    fixtures.ts                    synthetic CoreDecisionRequest + citation
    index.ts                       ./testing barrel (never in root)
  src/tests/                       the QFJ-M3 test matrix (excluded from dist)
```

## Commit sequence

1. `docs(adr): define M3 Core decision adapter` — ADR-0056 first.
2. `feat(core-decision-adapter): add revision-bound protocol` — protocol/digest/contracts/transport.
3. `feat(core-decision-adapter): enforce transport and state gates` — adapter, gates, testing fakes, barrel.
4. `test(core-decision-adapter): prove Core authority and idempotency` — the full test matrix.
5. `docs(reports): record M3 adapter evidence` — these reports + the narrow roadmap update.

## Verification snapshot

`pnpm run format:check`, `lint --max-warnings=0`, `typecheck` (+ `typecheck:tests`), `test:unit` (**3241** tests, 100 files), `build`, and `check:dist-containment` all pass. `@qf-jarvis/event-backbone` root API remains **39**; migrations 0001–0007 are byte-exact and there is **no 0008**.
