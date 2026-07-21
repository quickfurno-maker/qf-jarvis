# Report 05 — Implementation Slices, Test Plan and Readiness Verdict

**Date:** 2026-07-21. **Purpose:** The bounded future implementation plan, the test matrix, and the readiness verdict. Planning only — nothing here is implemented.

## Bounded future slices

| Slice                                                  | Scope                                                                                                                        | Dependencies | Migration gate                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| **QFJ-P03.07B** — Failure Contracts and Error Taxonomy | branded IDs; lifecycle types; classification; normalized codes; validation                                                   | ADR-0040     | none (no DB unless separately approved)              |
| **QFJ-P03.07C** — Failure Persistence Foundation       | migration 0006 (**only when separately authorized**); repositories; constraints; grants; integration tests                   | B            | **migration 0006 — separate authorization required** |
| **QFJ-P03.07D** — Retry Exhaustion Integration         | runner writes exactly one exhausted failure atomically with block; restart & concurrency tests                               | C            | uses 0006                                            |
| **QFJ-P03.07E** — Operator Inspection and Quarantine   | application/command boundary; read-only inspect; acknowledge; quarantine; authz checks; no direct SQL                        | D            | uses 0006                                            |
| **QFJ-P03.07F** — Authorized Replay                    | request; approval; advisory locking; exact revalidation; atomic success resolution; controlled failure re-entry; idempotency | E            | uses 0006                                            |
| **QFJ-P03.07G** — Observability, Runbook, Exit Audit   | metrics; alerts; runbook finalization; incident exercises; load/concurrency proof; containment; P03.07 exit audit            | F            | none                                                 |

## Proposed files by slice (indicative)

- **B:** `projections/failure/failure-id.ts`, `failure-status.ts`, `failure-classification.ts`, `failure-safe-code.ts` (+ unit tests).
- **C:** migration `0006_projection_failure_operations.sql` (separately authorized), `projections/failure/failure-store.ts`, `replay-authorization-store.ts`, `failure-action-store.ts` (+ integration tests).
- **D:** runner extension in `projection-runner.ts` (exhaustion → durable failure), reconciliation extension (+ integration tests).
- **E:** `projections/failure/failure-operations-service.ts` (command boundary) (+ tests).
- **F:** `projections/failure/replay-runner.ts` (+ integration tests).
- **G:** metrics/logging surfaces, runbook, exit-audit doc.

## Migration gate

Migration 0006 is created **only** in QFJ-P03.07C and **only** after separate owner authorization under the ADR-0039 rule. No slice before C touches SQL. Managed application of the pending set (`0002`→`0006`) is a further, separately-authorized managed-readiness step.

## Test matrix (38 cases)

| #   | Case                                                            | Slice |
| --- | --------------------------------------------------------------- | ----- |
| 1   | first deterministic handler failure                             | D     |
| 2   | bounded retry scheduling                                        | D     |
| 3   | retry survives worker restart                                   | D     |
| 4   | retry exhaustion creates one active failure                     | D     |
| 5   | duplicate worker cannot create duplicate failure                | D     |
| 6   | checkpoint does not advance on failure                          | D     |
| 7   | later event cannot bypass failed position                       | D     |
| 8   | unrelated projection continues                                  | D     |
| 9   | unrelated projection version continues                          | D     |
| 10  | infrastructure failure creates no deterministic failure         | D     |
| 11  | invariant failure creates no ordinary handler failure           | D     |
| 12  | shutdown creates no false failure                               | D     |
| 13  | acknowledge is idempotent                                       | E     |
| 14  | quarantine is idempotent                                        | E     |
| 15  | quarantine does not advance checkpoint                          | E     |
| 16  | unauthorized replay rejected                                    | F     |
| 17  | stale replay authorization rejected                             | F     |
| 18  | mismatched position rejected                                    | F     |
| 19  | mismatched event identity rejected                              | F     |
| 20  | duplicate replay request suppressed                             | F     |
| 21  | concurrent replay executes once                                 | F     |
| 22  | replay success advances checkpoint exactly once                 | F     |
| 23  | replay success resolves failure with evidence                   | F     |
| 24  | replay failure keeps checkpoint unchanged                       | F     |
| 25  | replay failure remains controlled                               | F     |
| 26  | raw event payload cannot be substituted                         | F     |
| 27  | another projection cannot use the authorization                 | F     |
| 28  | another projection version cannot use the authorization         | F     |
| 29  | operator cannot manually resolve                                | E/F   |
| 30  | audit rows cannot be mutated through runtime role               | C     |
| 31  | sensitive diagnostics are bounded/redacted                      | C/D   |
| 32  | restart during replay recovers safely                           | F     |
| 33  | transaction rollback leaves no partial resolution               | F     |
| 34  | advisory lock prevents normal runner/replay collision           | F     |
| 35  | migration grants follow least privilege                         | C     |
| 36  | root package API remains contained                              | B–G   |
| 37  | no managed database access                                      | all   |
| 38  | deterministic rebuild compatibility remains possible for P03.08 | G     |

## Concurrency tests

Duplicate-worker exhaustion (5); concurrent replay single-execution (21); runner-vs-replay advisory-lock collision (34); restart mid-replay (32).

## Security tests

Unauthorized/stale/mismatched authorization (16–19, 27, 28); duplicate suppression (20); no payload/handler substitution (26); no manual resolve (29); immutable audit (30); redaction (31).

## Observability

Metrics/logs/alerts per [projection-failure-operations.md](../../architecture/projection-failure-operations.md) (§ Metrics and alerts), delivered in QFJ-P03.07G.

## Rollback

Every failure/replay path is transactional; a rollback leaves no partial resolution (33). Migration 0006 rollout is scoped and separately authorized; the immutable ledgers are append-only (no runtime delete).

## Exit criteria (QFJ-P03.07)

Retry exhaustion → exactly one durable active failure; checkpoint stays blocked, never skips; operators inspect/acknowledge/quarantine idempotently; authorized replay reprocesses the exact event under the advisory lock and resolves atomically or re-enters a controlled state; every operator action attributed and audited; diagnostics bounded; least-privilege grants hold; root API contained; rebuild determinism for P03.08 achievable.

## Risks

- Overloading existing tables (mitigated by SCHEMA_REQUIRED + new tables).
- Replay against changed code (mitigated by version immutability + new-version rebuild rule).
- Managed migration scope creep (mitigated by scoped, separately-authorized rollout).
- Root API surface growth (mitigated by explicit, reviewed export changes and containment tests).

## Next owner decision

Approve QFJ-P03.07A design and, on approval, authorize QFJ-P03.07B (contracts, no DB). Migration 0006 authorization is a **separate** decision at QFJ-P03.07C.

## Explicit confirmation

**QFJ-P03.07 runtime implementation has not begun. No migration, SQL, source, test, or operator tooling was created. QFJ-P03.08 has not begun. This task is documentation and planning only.**
