# Report 04 — Change Manifest, Migration and API Proof

**Date:** 2026-07-24.

## Added — source (5 files)

| File                                                                       | Purpose                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/event-backbone/src/observability/projection-log-events.ts`       | Closed severity ladder, 18 closed event names with exact field shapes, closed divergence kinds and infrastructure phases, frozen per-event severity map |
| `packages/event-backbone/src/observability/projection-logger.ts`           | Dependency-free JSON Lines writer over an injected sink and clock; explicit field projection; divergence rate limiting; cycle sampling                  |
| `packages/event-backbone/src/observability/projection-metrics.ts`          | Counters/gauges/histograms with type-level label closure, bounded buckets, series cap, non-throwing rejection                                           |
| `packages/event-backbone/src/observability/projection-health.ts`           | Bounded read-only derived gauges, the health decision, the startup schema probe                                                                         |
| `packages/event-backbone/src/projections/projection-inspection-cli.ts`     | Read-only operator CLI edge (no auto-run, injected seams)                                                                                               |
| `packages/event-backbone/src/projections/projection-inspection-cli-bin.ts` | The process entry (auto-run; sets `process.exitCode`)                                                                                                   |

## Added — tests (8 files)

`projection-logger.test.ts` · `projection-metrics.test.ts` ·
`projection-observability-redaction.test.ts` · `projection-runner-telemetry.test.ts` ·
`projection-worker-telemetry.test.ts` · `projection-health.test.ts` ·
`projection-inspection-cli.test.ts` · `projection-health.integration.test.ts`

## Added — documentation (7 files)

`docs/operations/projection-failure-alerting.md` · `docs/operations/projection-failure-queries.md` ·
`docs/reports/qfj-p03-07g/01..05`

## Modified — source (7 files), telemetry-only

| File                                   | Change                                                                                                                                                                                                                         | Correctness impact                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection-runner.ts`                 | Optional `logger`/`metrics` inputs (default discarding); a `RunTelemetry` recording value; `abortAndThrow` gains an optional bounded `detail`; two post-transaction emitters; the exhaustion `failureId`/`generation` captured | **None.** No transaction reordering, no changed error code, no changed result. `abortAndThrow` still rolls back first and throws the same code; recording is a pure assignment that cannot fail |
| `projection-worker.ts`                 | Optional `logger`/`metrics`, forwarded to the runner; cycle telemetry emitted **after** the cycle completes; started/stopped lifecycle events                                                                                  | **None.** Cycle emission is outside the guarded per-definition region, so a throwing logger cannot abort a completed cycle                                                                      |
| `projection-worker-cli.ts`             | New `probeSchema`, `createLogger`, `metrics` seams; the startup schema gate; the default JSON Lines logger wired through the existing `writeOut` seam                                                                          | Adds one startup gate. Exit-code semantics unchanged (0/1)                                                                                                                                      |
| `projection-retry-exhaustion.ts`       | `ProjectionDivergenceError extends ProjectionCheckpointInvalidError` carrying a closed kind; four throws use it; `EstablishedRetryExhaustion` also returns `generation`                                                        | **None — purely additive.** Every existing `instanceof ProjectionCheckpointInvalidError` still matches; classification, fail-closed behaviour and the resulting runner code are unchanged       |
| `projection-failure-operations.ts`     | Optional `logger`/`metrics` on the context; identity captured inside the transaction; acknowledge/quarantine emitted **after** commit; idempotent replays emit nothing                                                         | **None.** The mutation outcome shape is unchanged, so no existing assertion is affected                                                                                                         |
| `projection-failure-replay.ts`         | Same pattern via a `ReplayIdentityBox`; authorize / lease-acquired / started / succeeded / failed / taken-over emitted after their transactions                                                                                | **None.** Result shapes unchanged                                                                                                                                                               |
| `packages/event-backbone/package.json` | One internal subpath export; one `inspect:failures` script                                                                                                                                                                     | Export map still narrow (see below)                                                                                                                                                             |

## Modified — tests (4 files)

`projection-worker-cli.test.ts` (fixture gains three seams) · `apps/worker/src/tests/worker-entry.test.ts`
(same) · `public-api.test.ts` (exports-map set + 2 new tests) ·
`stage-3-4-5b-containment.test.ts` (exports-map set). No assertion was weakened or removed; see report 03 § _Regression evidence_.

## Modified — documentation (3 files)

`docs/operations/projection-failure-operations-runbook.md` — full rewrite · `docs/architecture/qf-jarvis-roadmap-v3.md`
— three stale statements corrected · `docs/architecture/projection-failure-operations.md` —
implementation-status line updated.

## Files that must not change — verified unchanged

- **Migrations 0001–0006** — all six checksums identical to the locked baseline.
- **Migration 0007** — absent.
- **Managed-database tooling** — `migrate-cli.ts`, `preflight-cli.ts`, `cli-config.ts`,
  `database-config.ts`, `migration-*.ts`, `preflight.ts` untouched.
- **Ordering, checkpoint semantics, advisory-lock derivation, retry policy, taxonomy** — untouched.
- **Unrelated packages** — `packages/contracts`, `packages/event-ingestion`, `apps/api` untouched.
- **`docs/reports/qfj-managed-reconciliation-0002-0005/`** — see the disclosure below.

## Migration proof

Re-verified after the final commit:

```
dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a  0001_event_log.sql
4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c  0002_event_runtime_grants.sql
407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c  0003_ingestion_rejection_and_event_conflict.sql
148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30  0004_projection_foundation.sql
96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae  0005_projection_event_positions.sql
e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4  0006_projection_failure_operations.sql
```

Identical to the locked baseline. Exactly six `.sql` files; `ls | grep -c '^0007'` returns **0**; no
`migrations/0007` path exists in the git index.

## Public API proof

`EXPECTED_ROOT_SURFACE` in `public-api.test.ts` remains **exactly 39 symbols**, asserted by
`expect(EXPECTED_ROOT_SURFACE).toHaveLength(39)` and by deep equality against the barrel's actual keys.
**No entry was added, removed, or renamed.** Not one of the 39 is a projection symbol.

Export map — the root plus exactly two narrowly scoped internal subpaths:

```json
{
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./internal/projection-worker-cli": { "…": "./dist/projections/projection-worker-cli.*" },
  "./internal/projection-inspection-cli": { "…": "./dist/projections/projection-inspection-cli.*" }
}
```

No wildcard; no `persistence` subpath; nothing reaching the migration runner. Asserted by both
`public-api.test.ts` and `stage-3-4-5b-containment.test.ts`, plus a new test proving the CLI module
re-exports none of the E/F mutating operations.

## Dependency proof

`packages/event-backbone/package.json` dependencies are unchanged: `pg@8.22.0` runtime,
`@types/pg@8.20.0` dev. **No logging, metrics, tracing, exporter, or alert-delivery dependency was
added** — the logger and registry are written from scratch against Node built-ins only.

## Managed-database non-access

No connection to any managed database was opened. No credential, connection string, hostname, username,
password, token, or certificate path was read, printed, or requested. No migration was executed. The
only environment check performed was a **boolean** presence test for `DATABASE_URL` (result: absent),
used solely to decide whether integration tests could run locally.

## Disclosure — protected path staged in error, corrected

**What happened.** While committing the documentation change, a `git add -A` staged the protected
untracked directory `docs/reports/qfj-managed-reconciliation-0002-0005/`, and it was included in one
commit. The task forbids modifying, deleting, or staging that path.

**What was done.** The branch was rebuilt so the path was never committed: the three commits were
re-created from their exact original messages and file lists with that path excluded. The resulting tree
differs from the erroneous one by exactly that one file and nothing else, verified by
`git diff --stat`.

**Current state — verified.** The file is present on disk, untracked, byte-identical
(`sha256 2cf1bb8c1135d029886164f3a8565a3254f250568643362a4430be406e64272b`, 16576 bytes, original
mtime `Jul 23 11:24`), and absent from every commit on this branch
(`git log main..HEAD -- <path>` returns nothing). It was never read, modified, or deleted. `git status`
shows it as `?? docs/reports/qfj-managed-reconciliation-0002-0005/`, exactly as at baseline.

Nothing had been pushed at the time of the correction, so no remote ever carried it.

## Commits

| SHA       | Subject                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `5d715e2` | `feat(event-backbone): add projection observability foundation`             |
| `49add67` | `feat(event-backbone): add read-only projection failure inspection CLI`     |
| `f88bd8d` | `docs(operations): ratify projection failure alerting, queries and runbook` |
| —         | `docs(reports): add the QFJ-P03.07G implementation reports`                 |
