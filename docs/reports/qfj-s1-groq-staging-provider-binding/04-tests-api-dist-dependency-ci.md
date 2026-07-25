# Report 04 — Tests, API, Dist, Dependency, and CI

**Slice:** QFJ-S1. **ADR:** [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md).

## Test matrix

One new spec, **16** S1 tests, all passing (deterministic; **no network, no real key, no live Groq call**):

- happy bind makes **no** transport call; the bound provider is **staging-ready** (a structured invoke hits the fixed `api.groq.com` endpoint with a strict `json_schema`, the exact release model id, one request, no `tools`/`tool_choice`/`logprobs`);
- credential: a missing/unresolvable credential fails closed **before transport**, resolved **at most once**, no raw leak; the fake sentinel key and the opaque reference value never appear in the result or events;
- exact release binding: the binding rejects a `latest` identity **before** credential resolution and the release ref rejects a `*` wildcard upstream;
- data-class (`LOCAL_ONLY`/`HUMAN_ONLY`), non-`HOSTED` execution, and missing attestation all refuse **before** credential resolution and transport;
- structured output: a non-strict-compatible schema fails **before** transport (no silent downgrade); malformed content fails closed as `malformed`;
- cancellation: a pre-aborted signal cancels with **no** transport call; a 429 normalizes with no raw body leak;
- content-free bind events (closed types, safe refs only); the bind result and bound provider expose **no** send/deliver/execute surface.

The pre-existing ADR-0046 Groq adapter suite (`groq-adapter.test.ts`) remains green — S1 changed no adapter behaviour.

## Whole-repo evidence

- `format:check` — clean.
- `lint` (`eslint . --max-warnings=0`) — clean.
- `typecheck` (`tsc --build` + every package `typecheck:tests`) — clean.
- `test:unit` — **3371** tests across **115** files pass (was 3355; **+16** S1). No PostgreSQL, no network.
- `build` + `check:dist-containment` — build green; `dist is production-only; no test-key material; exports are the approved root surface`.

## Public API and dependency graph

The model-gateway root barrel gained the S1 binding symbols and lost none; the deterministic fakes are exposed **only** under `./testing`. The binding lives inside `@qf-jarvis/model-gateway` — **no new package, no new dependency, no second router**; the dependency graph stays acyclic. A source scan confirms the S1 files import no provider SDK, use no `fetch`/`process.env`/`node:*` I/O (the only network-egress file remains the pre-existing `groq-transport.ts`), and contain no `Atomics.wait`/`execSync`/`spawnSync`/`deasync`.

## Containment invariants

Migrations 0001–0007 are byte-exact (sha256-locked) with **no 0008**. The `@qf-jarvis/event-backbone` public-api lock remains **39**. Production source holds no NUL/control byte. No `kimi` reference, no unauthorized provider adapter, no live call in tests/CI. The protected directory `docs/reports/qfj-managed-reconciliation-0002-0005/` is untouched.

## CI

Whole-repo `format:check`, `lint`, `typecheck` (+ `typecheck:tests`), `test:unit`, `build`, and `check:dist-containment` pass locally on the exact branch head; the DRAFT PR CI is expected green on the same head. **No external request is made** in any test or in CI.
