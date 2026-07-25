# Report 04 — Authority, Redaction, Tests, CI, and API Evidence

**Slice:** QFJ-P04.02 — Model Capability Registry. **ADR:** [ADR-0050](../../decisions/ADR-0050-qfj-p04-02-model-capability-registry.md).

## Authority boundary

The capability registry selects **no** business outcome and grants **no** business authority: a resolution is a **data summary** with no `authorize`/`execute` method (proven). It decides technical capability match only — never health/readiness, circuit, rollout mode, canary cohort, failover, business permission, agent assignment, or n8n execution; those remain in their existing layers. Agent scope (Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION) and task class are separate — capability matching never blurs an authority boundary. QuickFurno Core remains final authority; n8n execution-only; models/providers/gateway authorize and execute nothing. The Jarvis Conversation Operations Center remains a **mandatory later phase** but is **absent here** (no conversation store, no WhatsApp, no dashboard). Kimi excluded.

## Declared vs approved

A profile records a **declared** technical capability and, optionally, an **opaque** `evaluationApprovalRef` — a forward reference, **not** approval itself (there is no boolean `approved` field; proven). QFJ-P04.04 owns evaluation evidence; **registry presence alone never permits ACTIVE**, and ACTIVE still requires the QFJ-P04.01E approval binding (proven: an ACTIVE rollout whose candidate release is absent from the registry is refused pre-invocation despite a valid approval).

## Observability / redaction

Capability evidence flows through a separate injected `CapabilityObservabilityHook` as content-free `CapabilityEvent`s (`capability-matched` / `capability-rejected`) carrying only release/provider/model ids and versions and a bounded reason code. Proven: a rejection emits `capability-rejected` with the precise reason; the serialized events contain **no** prompt (`SECRET-PROMPT`), message, subject, key, token, raw body, or operator PII. The gateway's own `GatewayEvent` contract is unchanged; no new gateway error code was added.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-02-model-capability-registry`:

| Gate                                  | Command                           | Result                                 |
| ------------------------------------- | --------------------------------- | -------------------------------------- |
| Format                                | `pnpm run format:check`           | PASS                                   |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                                   |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                                   |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **3008 passed / 80 files**             |
| — of which model-gateway              | 8 files                           | **304 passed** (279 prior + 25 P04.02) |
| Build                                 | `pnpm run build`                  | PASS                                   |
| Dist containment                      | `pnpm run check:dist-containment` | PASS                                   |

Integration tests (`test:integration`) require the CI PostgreSQL service and run in CI; this slice touches no database, schema, or migration, so they are unaffected.

## Regression / containment — proven

- The **279 prior model-gateway tests are unchanged and green** — the foundation, Groq, local, routing, and rollout behaviour is untouched because the registry is opt-in.
- The containment test still holds: `fetch` only in the two transport files; no `process.env`/SDK/DB import (the capability modules use only `zod` and pure logic); event-backbone public-API lock remains **39**; migrations 0001–0007 byte-exact; **no 0008**. A repo scan confirms **no control-byte anomalies** in the new capability source.
- No agent/n8n/memory/RAG/tool dependency; no CLI or remote ops API; no live Groq/local network call; no real key/token.

## Test inventory — `capability-registry.test.ts` (25 tests)

| Group                | Coverage                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile / registry   | frozen profile; invalid identity; `latest` is only an exact id; impossible limits; incoherent structured config; unknown task/result/structured modes; deterministic order; duplicate release id / exact tuple rejected; frozen content-free snapshot (no secret/provider/function)                         |
| Matching             | exact descriptor match; identity mismatch; ceiling (claims-more) rejection; task supported/unsupported; result mode; strict vs json-object; context/completion budgets; timeout/cancellation; prompt/cost ref; exact `resolveRelease` (missing/digest mismatch); determinism (no request content in result) |
| Gateway integration  | no-registry unchanged; matching registry admits; missing release excluded pre-invocation; descriptor-ceiling mismatch excluded; safe capability event on rejection; LOCAL_ONLY never hosted / HUMAN_ONLY none                                                                                               |
| Rollout integration  | ACTIVE serves candidate when it resolves; ACTIVE approval cannot bypass a registry mismatch; SHADOW skips a non-resolving candidate shadow while still serving stable                                                                                                                                       |
| Declared-vs-approved | opaque approval ref is not approval (no `approved` field); registry grants no business authority (summary has no authorize/execute)                                                                                                                                                                         |

## Public API surface — additive and neutral

The root barrel now also exports: `MODEL_TASK_CLASSES`, `STRUCTURED_OUTPUT_MODES`, `createModelCapabilityProfile`, `createModelCapabilityRequirement`, `deriveCapabilityRequirement`, `createModelCapabilityRegistry`, `CAPABILITY_MATCH_REASONS`, `NOOP_CAPABILITY_OBSERVABILITY`, and their profile/requirement/registry/summary/resolution/event/reason types. It does **not** export `matchDescriptor`/`matchRequirement`, `profileTupleKey`, or any mutable internal. The `ModelGatewayConfig.capabilityRegistry` / `capabilityObservability` fields are the single opt-in. The `exports` map is unchanged (`.` and `./testing`).
