# Report 01 — ADR, Schema and Implementation Manifest

**Date:** 2026-07-24. **Slice:** QFJ-P03.09 — Subject Activity Projection. **ADR:** [ADR-0044](../../decisions/ADR-0044-qfj-p03-09-subject-activity-projection.md).

> Implemented on a feature branch / DRAFT PR. Not complete, not merged. Merge is separately authorized after owner review.

## Baseline

- Locked base `main`: `8a9ec8aaaf753fb9566ee9c2ed571bd1e79abf29` (QFJ-P03.08 merged via PR #37).
- Feature branch: `qfj-p03-09-subject-activity-projection`, created from that exact SHA.

## ADR-0044 (committed first)

Locks: subject = existing opaque Phase-2 EntityReference `(subject_type, subject_id)`; **no global `ProjectionEvent` widening**; a narrow internal subject reader used only by the subject-activity handler (module-boundary least privilege); permanent minimal tombstone on the **existing** `qf.privacy.erasure-recorded` contract with no reactivation; SCHEMA_REQUIRED → migration 0007; position-only ordering; unchanged runner/checkpoint/failure lifecycle and unchanged QFJ-P03.08 rebuild driver signature; internal digest spec only; root API stays 39; no managed deployment; no legal-compliance claim.

## Migration 0007

- File: `packages/event-backbone/src/persistence/migrations/0007_subject_activity_projection.sql`
- SHA-256: `8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49`
- Creates `qf_jarvis.rm_subject_activity` (PK `(subject_type, subject_id)`) with subject-grammar CHECKs mirroring migration 0001 exactly and active/tombstone shape CHECKs; grants the existing `qf_jarvis_projection_runtime` role `SELECT(subject_type, subject_id)` on `qf_jarvis.event` and `SELECT, INSERT, UPDATE` on the new table (**no DELETE/TRUNCATE**). No trigger, enum, tenant column, extra index, queue, job, or audit table. Local/CI only; managed remains at 0001.

## Changed-file manifest

**Added — source (2):** `projections/projection-subject-reader.ts`, `projections/handlers/subject-activity.ts`.
**Added — migration (1):** `persistence/migrations/0007_subject_activity_projection.sql`.
**Added — tests (3):** `projection-subject-reader.test.ts`, `projection-subject-boundary.test.ts`, `subject-activity.integration.test.ts`.
**Modified — source/config (3):** `projections/production-registry.ts` (register the third projection), `projections/projection-rebuild-digest.ts` (add `SUBJECT_ACTIVITY_DIGEST_SPEC`), `eslint.config.mjs` (subject-reader module-boundary rule + shared reducer-I/O const).
**Modified — tests (7, conformance/updates):** the migration-set/list assertions and the three-projection registry (`event-store.integration`, `migrate-gate.integration`, `migration-runner.integration`, `projection-failure-persistence.integration`, `projection-foundation.integration`, `stage-3-4-5b-containment`, `production-registry`, `projection-worker-cli`). The projection-role least-privilege test now asserts subject columns are readable (ADR-0044) while payload/correlation remain denied.
**Modified — docs (1):** `docs/architecture/qf-jarvis-roadmap-v3.md` (narrow status). Plus this `docs/reports/qfj-p03-09/` set.

## Files that must NOT change — verified unchanged

- Package-root barrel `index.ts` — unchanged (no root export; API stays **39**).
- Migrations 0001–0006 — byte-identical to the locked hashes.
- `ProjectionEvent` / `ProjectionDefinition` — unchanged (no subject field).
- QFJ-P03.08 rebuild driver signature (`projection-rebuild.ts`) — unchanged.
- QFJ-P03.07 runner/checkpoint/failure/replay lifecycle — unchanged.
- Package manifests / lockfile, `apps/`, `.github/` (CI), `scripts/` — unchanged.
- `docs/reports/qfj-managed-reconciliation-0002-0005/` — untracked and untouched.

## Managed boundary

No managed database access. Local integration proof ran against the sanctioned loopback Docker test database (`127.0.0.1:55432/qf_jarvis_test`, `--locale=C`). Managed PostgreSQL remains at 0001; 0002–0007 unapplied and not deployed; managed migration + password-rotation lanes remain paused.
