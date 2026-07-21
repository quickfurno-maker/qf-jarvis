# Report 01 — Baseline, Schema and Migration Inventory

**Task:** QFJ-P03.07C — Projection Failure Persistence and Migration 0006 (implementation).
**Date:** 2026-07-22.

## Verified baseline

| Fact                             | Value                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `main` at start                  | `2dc199a8788d4cf3683d5b736f56c3dd831969a0` (sync 0 0, clean) |
| PRs #26/#27/#28/#29              | MERGED                                                       |
| ADR-0040 / -0041 / -0042         | present                                                      |
| Taxonomy (5 categories)          | present (`projection-failure-taxonomy.ts`)                   |
| Migrations 0001–0005             | present, immutable                                           |
| Migration 0006 / 0007 (at start) | absent                                                       |
| Package-root runtime surface     | 39 symbols                                                   |

## Migration 0006

- **Filename:** `packages/event-backbone/src/persistence/migrations/0006_projection_failure_operations.sql`
- **SHA-256:** `e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4`
- **Owner:** QFJ-P03.07C (exclusive). **Managed status:** NOT APPLIED / separately gated (local/CI only).
- Follows the 0004/0005 conventions exactly: fully-qualified `qf_jarvis.` objects, CHECK-constrained closed vocabularies, append-only/identity-guard triggers, `REVOKE ALL FROM PUBLIC` + managed-alias denials + `qf_jarvis_projection_runtime` least-privilege grants, `COMMENT ON` documentation.

## Existing schema inspected

- `qf_jarvis.projection_checkpoint` (0004/0005): mutable state per (name, version) — `last_position`, `status` (`active`/`blocked`), `blocked_position`, `failed_attempt_count 0..5`, `last_safe_error_code`, `next_attempt_at`. **Unchanged by 0006** — correlation to a failure is by the natural (name, version, blocked_position) key; touching it would risk runner/ordering semantics.
- `qf_jarvis.projection_attempt` (append-only automatic attempts). **Unchanged.**
- `qf_jarvis.event` / `projection_event_position` (storage identity + gap-free positions). **Unchanged.**

## Migrations 0001–0005 immutability proof

The reviewed SHA-256 of 0001–0005 are asserted unchanged in `projection-failure-persistence.integration.test.ts` and `projection-foundation.integration.test.ts` (`IMMUTABLE_CHECKSUMS`) and by the vocabulary-conformance/containment unit tests. `git diff --exit-code main -- "**/migrations/0001..0005"` is clean.

## Scope boundary

Persistence foundation only. **Not** wired into the production runner (QFJ-P03.07D); **no** operator API/quarantine (E); **no** replay execution/lease worker (F); **no** observability/exit audit (G). No RAG/pgvector/agents/tasks/memory/WhatsApp/model-gateway/Core/analytics/`rm_subject_activity`. Migration 0007 not created.
