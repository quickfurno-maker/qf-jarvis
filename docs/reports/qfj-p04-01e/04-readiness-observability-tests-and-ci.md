# Report 04 — Readiness, Observability, Tests, and CI

**Slice:** QFJ-P04.01E — Provider Operations and Rollout Governance. **ADR:** [ADR-0049](../../decisions/ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md).

## Readiness / approval boundary — fail closed

- The serving release's provider must be **healthy**; an unhealthy/unattested serving provider is refused pre-invocation (`readiness-unhealthy` → `no-eligible-provider`), proven. Provider health folds in the Groq ZDR/data-controls attestation (ADR-0046) and the local endpoint/model/auth-TLS attestations (ADR-0047) — a provider without its attestation fails closed.
- **Privacy first:** a `LOCAL_ONLY` request may serve only a LOCAL release; a HOSTED serving release is refused (`privacy-forbidden` → `local-provider-required`), with the serving provider invoked 0 times. `HUMAN_ONLY` reaches no provider (refused before serving).
- **ACTIVE requires a bound approval** that permits ACTIVE (defense in depth beyond the transition check); a missing/mismatched approval fails closed. QFJ-P04.04 supplies the real evaluation evidence later; this slice makes no compliance claim.
- The controller/serving grant **no business authority** — the response is data only, with no `authorize`/`execute` method.

## Observability / redaction — proven

All rollout evidence flows through a separate injected `RolloutObservabilityHook` as content-free `RolloutEvent`s: `rollout-transitioned`, `rollout-refused`, `emergency-disabled`, `serving-release-selected`, `canary-assigned`, `shadow-started/completed/failed`, `candidate-fallback-to-stable`, `approval-mismatch`, `rollout-health-refusal`. Each carries only ids, modes, serve targets, reason codes, canary bucket/basis points, and counts. Proven: a CANARY serving run emits `serving-release-selected` and `canary-assigned` (with a numeric `canaryBucket`); the serialized events contain **no** prompt (`SECRET-PROMPT`), message, subject, key, token, raw body, or operator PII; every event carries the stable `rolloutId`. The shadow candidate's output never appears. The gateway's own `GatewayEvent` contract is unchanged.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-01e-provider-operations-governance`:

| Gate                                  | Command                           | Result                                  |
| ------------------------------------- | --------------------------------- | --------------------------------------- |
| Format                                | `pnpm run format:check`           | PASS                                    |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                                    |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                                    |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **2983 passed / 79 files**              |
| — of which model-gateway              | 7 files                           | **279 passed** (241 prior + 38 P04.01E) |
| Build                                 | `pnpm run build`                  | PASS                                    |
| Dist containment                      | `pnpm run check:dist-containment` | PASS                                    |

Integration tests (`test:integration`) require the CI PostgreSQL service and run in CI; this slice touches no database, schema, or migration, so they are unaffected.

## Regression / containment — proven

- The **241 prior model-gateway tests are unchanged and green** — the foundation, Groq, local, and hybrid-routing behaviour is untouched because rollout is opt-in (default/routing paths unchanged).
- The containment test still holds: `fetch` only in the two transport files; no `process.env`/SDK/DB import (the operations modules use only `zod` and pure logic); event-backbone public-API lock remains **39**; migrations 0001–0007 byte-exact; **no 0008**.
- No agent/n8n/memory/tool dependency; no CLI or remote ops API; no live Groq/local network call; no real key/token.

## Test inventory — `provider-operations.test.ts` (38 tests)

| Group                       | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release / approval / policy | frozen valid; rejects invalid id/class/extra-key/short-digest/out-of-range ceiling; default OFF; candidate required per mode; canary-only-in-CANARY; shadow-only-in-SHADOW; approval binds candidate; candidate ≠ stable; no secret/kimi                                                                                                                                                                                       |
| Transitions                 | promotion path; OFF→ACTIVE and SHADOW→ACTIVE rejected; rollback paths; stale/non-monotonic revision; changed-candidate safe restart; canary ceiling increase rejected / decrease allowed                                                                                                                                                                                                                                       |
| Controller                  | apply/reject transition; emergency disable from ACTIVE; stale revision cannot re-enable; safe events                                                                                                                                                                                                                                                                                                                           |
| Canary                      | deterministic; bounded `[0,10000)`; 0 bp→stable, 10000 bp→candidate                                                                                                                                                                                                                                                                                                                                                            |
| Serving decision            | OFF refuse; SHADOW stable+shadow; ACTIVE candidate; FALLBACK stable+candidate                                                                                                                                                                                                                                                                                                                                                  |
| Gateway integration         | OFF invokes none; SHADOW stable-only + one non-returning shadow + non-fatal shadow failure + stable-failure-prevents-shadow; CANARY 0/10000 routing + candidate→stable transient fallback + no fallback on non-retryable; ACTIVE candidate serves; FALLBACK stable→candidate transient fallback + non-retryable terminates; emergency disable blocks next call; unhealthy refused; LOCAL_ONLY never HOSTED; safe observability |

## Public API surface — additive and neutral

The root barrel now also exports the operations composition (`createProviderReleaseRef`, `createRolloutApprovalAttestation`, `createProviderRolloutPolicy`, `offRolloutPolicy`, `createProviderRolloutController`) and the safe vocabularies/types (`ROLLOUT_*`, `NOOP_ROLLOUT_OBSERVABILITY`, `RolloutEvent`, `RolloutObservabilityHook`, and the release/approval/policy/controller types). It does **not** export the canary hash, `decideServing`, `validateTransition`, the approval-binding helpers, or any provider reference. The `ModelGatewayConfig.rolloutController` / `rolloutObservability` fields are the single opt-in. The `exports` map is unchanged (`.` and `./testing`).
