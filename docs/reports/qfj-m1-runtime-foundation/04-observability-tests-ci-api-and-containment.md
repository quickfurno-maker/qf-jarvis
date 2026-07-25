# Report 04 — Observability, Tests, CI, API, and Containment

**Slice:** QFJ-M1 — Agent and Conversation Runtime Foundation. **ADR:** [ADR-0054](../../decisions/ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md).

## Observability (content-free)

The runtime emits closed-type events (`runtime-envelope-accepted`/`-refused`, `runtime-agent-assigned`, `runtime-ai-paused`, `runtime-escalation-required`, `runtime-proposal-created`/`-refused`, …) carrying only safe ids, the actor/party/state, and a reason. Proven: even when the envelope carries a `normalizedText` sentinel and the conversation a subject reference, the serialized events contain **no** message text, subject reference, provider message ref, or token.

## Local quality gate — all green

Run against the working tree on branch `qfj-m1-agent-conversation-runtime-foundation`:

| Gate                      | Command                           | Result                     |
| ------------------------- | --------------------------------- | -------------------------- |
| Format                    | `pnpm run format:check`           | PASS                       |
| Lint (`--max-warnings=0`) | `pnpm run lint`                   | PASS                       |
| Typecheck (build + tests) | `pnpm run typecheck`              | PASS                       |
| Unit tests (whole repo)   | `pnpm run test:unit`              | **3165 passed / 94 files** |
| — of which agent-runtime  | 3 files                           | **25 passed** (new)        |
| Build                     | `pnpm run build`                  | PASS (10 packages)         |
| Dist containment          | `pnpm run check:dist-containment` | PASS                       |

## Containment — proven

- Depends **only** on `zod`; exposes only `.` and `./testing`.
- Production source has **no** `fetch`, `process.env`, `node:` I/O import, provider/WhatsApp SDK import, or **any** `@qf-jarvis/{model-gateway,governed-knowledge,model-evaluation,rag-provisioning,event-backbone}` import (proven by source scan) — the runtime is fully decoupled from transport, providers, database, and the P04 packages.
- The build excludes `src/tests`, so **dist is production-only** (no `*.test.*`); the deterministic privacy gate + synthetic fixtures are the only `./testing` exports.
- Migrations 0001–0007 **byte-exact** (sha-256 locked); **no 0008**; `@qf-jarvis/event-backbone` root API remains **39**.
- No control byte in any tracked TypeScript file (whole-repo scan).

## Public API — additive and neutral

The root barrel exports the closed vocabularies, the envelope/context/proposal/policy factories, the conversation-state machine + `assignAgent`, the runtime factory + `processInbound`, `NOOP_RUNTIME_OBSERVABILITY`, the operations-center projection fields, and the associated types (27 value exports, locked). It does **not** export the test privacy gate or the synthetic fixtures (those live under `./testing`). The event-backbone public API is unchanged (remains **39**).
