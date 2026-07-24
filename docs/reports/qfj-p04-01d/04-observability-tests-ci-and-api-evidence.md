# Report 04 — Observability, Tests, CI, and API Evidence

**Slice:** QFJ-P04.01D — Hybrid Routing and Failover. **ADR:** [ADR-0048](../../decisions/ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md).

## Safe routing observability

A new `routing-decided` event carries only bounded, content-free fields — the routing `profile`, the request `dataClass`, the selected `providerId`, and (on the failover decision) a `fallbackReason` from the closed vocabulary. The `RoutingPlanSummary` and `AttemptLedgerSnapshot` are frozen and hold only ids, execution classes, exclusion/decision reason codes, and counts. Proven: after a hosted→local failover, the emitted events include a `routing-decided` event with `profile: HOSTED_FIRST`, `dataClass: HOSTED_ALLOWED`, and `fallbackReason: fallback-eligible-transient`; the serialized events contain **no** prompt (`SECRET-PROMPT`), message, subject, key, token, or raw error body, and every event carries the stable `runId`. Errors remain the closed `ModelGatewayError` codes.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-01d-hybrid-routing-failover`:

| Gate                                  | Command                           | Result                                  |
| ------------------------------------- | --------------------------------- | --------------------------------------- |
| Format                                | `pnpm run format:check`           | PASS                                    |
| Lint (whole repo, `--max-warnings=0`) | `pnpm run lint`                   | PASS                                    |
| Typecheck (build + per-package tests) | `pnpm run typecheck`              | PASS                                    |
| Unit tests (whole repo)               | `pnpm run test:unit`              | **2945 passed / 78 files**              |
| — of which model-gateway              | 6 files                           | **241 passed** (191 prior + 50 P04.01D) |
| Build                                 | `pnpm run build`                  | PASS                                    |
| Dist containment                      | `pnpm run check:dist-containment` | PASS                                    |

Integration tests (`test:integration`) require the CI PostgreSQL service and run in CI; this slice touches no database, schema, or migration, so they are unaffected.

## Regression / containment — proven

- The **191 prior model-gateway tests are unchanged and green** — the foundation, Groq, and local adapter behaviour is untouched because routing is opt-in (default path unchanged).
- Default gateway `OFF` remains fail-closed; the provider-neutral contract is preserved; the gateway authorizes/executes nothing.
- The containment test still holds: `fetch` only in the two transport files; no `process.env`/SDK/DB import; event-backbone public-API lock remains **39**; migrations 0001–0007 byte-exact; **no 0008**.
- No agent/n8n/memory/tool dependency; no live Groq/local network call; no real key/token; no database/schema.

## Test inventory — `hybrid-routing.test.ts` (50 tests)

| Group               | Coverage                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy validation   | HOSTED_FIRST/LOCAL_FIRST valid + frozen; rejects unknown profile, duplicate/cross-class/malformed id, empty primary-class list, out-of-range/non-integer attempts, unknown transient code; no secret/model/kimi field                                                                                                        |
| Routing matrix      | LOCAL_ONLY→local; LOCAL_ONLY no-local fails closed; LOCAL_ONLY never includes hosted; HOSTED_FIRST/LOCAL_FIRST primary+fallback; excludes unhealthy/circuit-open/capability-mismatch/not-in-policy; deterministic within class; fallback disabled                                                                            |
| Failover matrix     | allow on retryable unavailable/timeout and circuit-open; deny on cancellation/non-retryable/malformed/structured-invalid/disabled/no-fallback/budget-exhausted/local-only-hosted                                                                                                                                             |
| Attempt ledger      | bounds totals; at most one fallback; no attempt after acceptance; no budget reset; frozen content-free snapshot                                                                                                                                                                                                              |
| Gateway integration | HOSTED_FIRST/LOCAL_FIRST/LOCAL_ONLY/HUMAN_ONLY routing; hosted→local failover (one fallback, one accepted); no failover on non-retryable; LOCAL_ONLY never falls back to Groq; kill/OFF; total-attempt bound; strict maxTotalAttempts forbids fallback; safe observability; structured validated; no failover when cancelled |

## Public API surface — additive and neutral

The root barrel now also exports: `createHybridRoutingPolicy`, `HybridRoutingPolicy`, `HybridRoutingPolicyInput`; the closed reason vocabularies (`ROUTING_PROFILES`, `ROUTING_EXCLUSION_REASONS`, `FALLBACK_DECISION_REASONS`, `FALLBACK_TRANSIENT_CODES`) and their types; and the safe observability types `RoutingPlanSummary`, `RoutingExclusion`, `AttemptLedgerSnapshot`. It does **not** export `buildRoutingPlan`, `decideFallover`, or the `AttemptLedger` class (internal to the gateway), nor any provider reference. The `ModelGatewayConfig.routingProfile` field is the single opt-in. The `exports` map is unchanged (`.` and `./testing`).
