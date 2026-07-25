# Report 04 — Observability, Tests, CI, API, and Containment

**Slice:** QFJ-P04.05 — No-Op RAG Provisioning. **ADR:** [ADR-0053](../../decisions/ADR-0053-qfj-p04-05-no-op-rag-provisioning.md).

## Observability (content-free)

The factory emits `rag-provisioner-created` and the runtime emits `rag-no-op`, each carrying only a profile id/version, the mode, the backend kind, a closed reason, and the (always zero) counters. Proven: the serialized events contain no prompt, content, subject reference, document, or secret.

## Local quality gate — all green

Run against the working tree on branch `qfj-p04-05-no-op-rag-provisioning`:

| Gate                        | Command                           | Result                     |
| --------------------------- | --------------------------------- | -------------------------- |
| Format                      | `pnpm run format:check`           | PASS                       |
| Lint (`--max-warnings=0`)   | `pnpm run lint`                   | PASS                       |
| Typecheck (build + tests)   | `pnpm run typecheck`              | PASS                       |
| Unit tests (whole repo)     | `pnpm run test:unit`              | **3140 passed / 91 files** |
| — of which rag-provisioning | 3 files                           | **27 passed** (new)        |
| Build                       | `pnpm run build`                  | PASS (9 packages)          |
| Dist containment            | `pnpm run check:dist-containment` | PASS                       |

## Containment — proven

- Depends **only** on `zod`; exposes only `.` and `./testing`.
- Production source has **no** `fetch`, `process.env`, `node:` I/O import, provider/vector/embedding library import (pinecone/weaviate/qdrant/chroma/faiss/hnswlib/langchain/openai/groq/pg/onnxruntime/@xenova/…), `@qf-jarvis/governed-knowledge` or `@qf-jarvis/model-evaluation` import, or `n8n`/`kimi`/`semantic search`/`cosine` term (proven by source scan). "RAG"/"vector"/"embedding" appear only as the closed mode/backend/counter identifiers — there is no implementation behind them.
- The build excludes `src/tests`, so **dist is production-only** (no `*.test.*`); the synthetic `./testing` fixtures are the only test-support export.
- Migrations 0001–0007 **byte-exact** (sha-256 locked); **no 0008**; `@qf-jarvis/event-backbone` root API remains **39**.
- No control byte in any tracked TypeScript file (whole-repo scan).

## Public API — additive and neutral

The root barrel exports the closed vocabularies (`RAG_PROVISIONING_MODES`, `RAG_BACKEND_KINDS`, `RUNTIME_ELIGIBLE_BACKEND`, `RAG_DATA_CLASSES`, `RAG_TASK_CLASSES`, `RAG_REASONS`), the `RagProvisioningError`/`RAG_ERROR_CODES`, the profile/request factories, `createRagProvisioner`/`invokeNoOpRag`, `NOOP_RAG_OBSERVABILITY`, and the result/profile/request/event types (13 value exports, locked). It does **not** export the synthetic fixtures (those live under `./testing`) or the internal `tryCreateRagProvisioningProfile`. QFJ-P04.03 and QFJ-P04.04 are unchanged; the event-backbone public API is unchanged (remains **39**).
