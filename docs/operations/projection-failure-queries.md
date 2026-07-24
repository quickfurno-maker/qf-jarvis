# Projection Failure — Operational Query Surface (QFJ-P03.07G)

**Status:** Ratified 2026-07-24 — QFJ-P03.07G.
**Relates to:** [projection-failure-operations-runbook.md](./projection-failure-operations-runbook.md) · [projection-failure-alerting.md](./projection-failure-alerting.md) · [ADR-0040](../decisions/ADR-0040-projection-failure-operations-quarantine-and-authorized-replay.md)

> **Read-only. Every statement here is a `SELECT`.** There is no `UPDATE`, `INSERT`, `DELETE`, or DDL in
> this document, and there must never be. Repairing projection-failure state by hand is a prohibited
> action (see the runbook): the checkpoint, the failure aggregate, the append-only action ledger, and
> the replay evidence are maintained atomically by the runner and by the authorized E/F operations, and
> a manual edit silently breaks invariants those paths depend on.
>
> **Do not run these against managed PostgreSQL.** The managed lane is **paused**: managed is at
> migration **0001**, migrations **0002–0006 are unapplied**, and most relations below do not exist
> there. These are for local and CI databases, and for the managed environment only after that
> separate lane is unblocked and the migrations are applied.

## Preferred path: the CLI

Prefer `pnpm inspect:failures` over raw SQL. It applies the same bounds, the same sanitisation, and the
same redaction rules automatically, and it returns bounded exit codes usable as a probe:

```
pnpm inspect:failures list                                # active failures + health summary
pnpm inspect:failures inspect --failure-id <uuid>         # one failure, sanitized detail
pnpm inspect:failures history --failure-id <uuid>         # the action ledger (reason withheld)
pnpm inspect:failures divergence                          # the fail-closed divergence report
pnpm inspect:failures list --json --limit 25              # machine-readable, bounded
```

Exit codes: `0` clean · `10` blocked or active failures exist · `20` divergence detected ·
`30` configuration/schema mismatch · `40` operational failure.

Use the SQL below when you need a shape the CLI does not produce, or when triaging from a database
console during an incident.

---

## Redaction rules that bind these queries

None of the statements here select an event payload, subject, metadata value, event id, correlation id,
signature, or any sender-controlled field — and none should be edited to. Two specific cautions:

- **`projection_failure_action.reason`** is the operator's free text. It is persisted for audit and is
  deliberately **not selected** anywhere below. Read it only inside a formal audit, never in routine
  triage, and never paste it into a ticket or chat.
- **`qf_jarvis.event`** is the immutable event log and is joined below **only** to count positions.
  Never select its payload or subject.

Every statement carries an explicit `LIMIT`. Keep it.

---

## 1. Blocked projections

The first question in every incident: what has stopped, and where.

```sql
SELECT projection_name,
       projection_version,
       blocked_position,
       last_position,
       failed_attempt_count,
       last_safe_error_code,
       updated_at
  FROM qf_jarvis.projection_checkpoint
 WHERE status = 'blocked'
 ORDER BY projection_name, projection_version
 LIMIT 200;
```

`last_position` is deliberately included: on a blocked projection it must be exactly
`blocked_position - 1`. The poison event is **not** consumed, and the cursor has **not** moved past it.

## 2. Active (non-terminal) failures

```sql
SELECT projection_name,
       projection_version,
       status,
       COUNT(*) AS failures
  FROM qf_jarvis.projection_failure
 WHERE status NOT IN ('resolved', 'superseded', 'retired')
 GROUP BY projection_name, projection_version, status
 ORDER BY projection_name, projection_version, status
 LIMIT 200;
```

The predicate is character-for-character the predicate of the partial unique index
`projection_failure_active_unique`, so it stays index-supported. Keep it that way.

## 3. Oldest active failure per projection

Drives alert **A2** (threshold: 60 minutes).

```sql
SELECT projection_name,
       projection_version,
       MIN(created_at)                                        AS oldest_created_at,
       EXTRACT(EPOCH FROM (now() - MIN(created_at)))::bigint   AS age_seconds
  FROM qf_jarvis.projection_failure
 WHERE status NOT IN ('resolved', 'superseded', 'retired')
 GROUP BY projection_name, projection_version
 ORDER BY age_seconds DESC
 LIMIT 200;
```

The runtime reader uses the **injected** clock rather than `now()`; `now()` is acceptable for
interactive triage but will differ slightly from the emitted gauge.

## 4. Quarantined failures — the replay-eligible queue

```sql
SELECT failure_id,
       projection_name,
       projection_version,
       projection_position,
       generation,
       automatic_attempt_count,
       replay_attempt_count,
       quarantined_at,
       quarantined_by
  FROM qf_jarvis.projection_failure
 WHERE status = 'quarantined'
 ORDER BY quarantined_at
 LIMIT 200;
```

`generation` is the optimistic-concurrency guard: a replay authorization binds to an exact generation,
so quote it when requesting one.

## 5. Replay-authorized and replaying failures

```sql
SELECT failure_id,
       projection_name,
       projection_version,
       projection_position,
       status,
       generation,
       replay_attempt_count,
       updated_at
  FROM qf_jarvis.projection_failure
 WHERE status IN ('replay-authorized', 'replaying')
 ORDER BY updated_at
 LIMIT 200;
```

A failure sitting in `replaying` far longer than the lease duration is the signal to check for an
expired lease (query 9) — not to start a second replay.

## 6. Failed replay attempts

Drives alert **A3**.

```sql
SELECT a.attempt_id,
       f.projection_name,
       f.projection_version,
       f.projection_position,
       a.attempt_number,
       a.state,
       a.safe_error_code,
       a.completed_at
  FROM qf_jarvis.projection_replay_attempt AS a
  JOIN qf_jarvis.projection_failure        AS f ON f.failure_id = a.failure_id
 WHERE a.state = 'failed'
 ORDER BY a.completed_at DESC
 LIMIT 200;
```

**Two failed attempts on the same position means stop replaying.** The handler is wrong for this event;
the correct response is a code fix plus a projection version bump and rebuild.

## 7. Checkpoint lag

Drives alerts **A7** and **A8**.

```sql
SELECT c.projection_name,
       c.projection_version,
       c.status,
       c.last_position,
       m.max_position,
       GREATEST(m.max_position - c.last_position, 0) AS lag_positions
  FROM qf_jarvis.projection_checkpoint AS c
  CROSS JOIN (
    SELECT COALESCE(MAX(position), 0) AS max_position
      FROM qf_jarvis.projection_event_position
  ) AS m
 ORDER BY lag_positions DESC
 LIMIT 200;
```

The ceiling comes from the append-only **position map** — the gap-free, commit-ordered authority the
runner reads through — never from `event.sequence`, which is storage identity only.

## 8. Action history for one failure — the audit trail

```sql
SELECT sequence,
       action_type,
       actor_type,
       actor_id,
       expected_generation,
       resulting_generation,
       occurred_at,
       recorded_at
  FROM qf_jarvis.projection_failure_action
 WHERE failure_id = $1
 ORDER BY sequence
 LIMIT 200;
```

**`reason` is deliberately absent.** The ledger is append-only — `UPDATE` and `DELETE` are refused by
trigger — so this is the authoritative record of what was done, by whom, and in what order. Logs are
at-least-once evidence; **this** is the ledger.

## 9. Active authorizations and stale leases

```sql
-- The single active (unconsumed) authorization per failure.
SELECT authorization_id, failure_id, failure_generation, state,
       authorized_by, created_at, expires_at
  FROM qf_jarvis.projection_replay_authorization
 WHERE state = 'active'
 ORDER BY created_at
 LIMIT 200;
```

```sql
-- Live attempts whose lease has expired: candidates for takeover, never for a blind second replay.
SELECT a.attempt_id, a.failure_id, a.attempt_number, a.lease_owner,
       a.lease_expires_at, a.started_at
  FROM qf_jarvis.projection_replay_attempt AS a
 WHERE a.state = 'started'
   AND a.lease_expires_at IS NOT NULL
   AND a.lease_expires_at < now()
 ORDER BY a.lease_expires_at
 LIMIT 200;
```

Use `takeOverExpiredProjectionReplayLease`. It abandons the expired attempt and starts a fresh one; it
**never executes the handler by itself** and is idempotent. Do not clear a lease by hand.

## 10. Divergence sweep

Prefer `pnpm inspect:failures divergence`, which runs the full ADR-0040 detector. This query covers the
single most important half — the checkpoint↔failure biconditional:

```sql
-- Blocked checkpoints with no matching active failure at the blocked position.
SELECT c.projection_name, c.projection_version, c.blocked_position
  FROM qf_jarvis.projection_checkpoint AS c
 WHERE c.status = 'blocked'
   AND NOT EXISTS (
     SELECT 1
       FROM qf_jarvis.projection_failure AS f
      WHERE f.projection_name    = c.projection_name
        AND f.projection_version = c.projection_version
        AND f.projection_position = c.blocked_position
        AND f.status NOT IN ('resolved', 'superseded', 'retired')
   )
 LIMIT 200;
```

```sql
-- More than one active failure at a single position (the partial unique index should make this
-- impossible; a row here means something bypassed it).
SELECT projection_name, projection_version, projection_position, COUNT(*) AS active
  FROM qf_jarvis.projection_failure
 WHERE status NOT IN ('resolved', 'superseded', 'retired')
 GROUP BY projection_name, projection_version, projection_position
HAVING COUNT(*) > 1
 LIMIT 200;
```

**Any row from either query is a CRITICAL divergence. Stop and escalate to engineering. Do not
repair.** Capture the output as evidence — the runner's divergence transaction rolls back and persists
nothing, so this and the emitted log line are the only record.

## 11. Attempt history for a blocked position

```sql
SELECT attempt_number, outcome, safe_error_code, started_at, completed_at, recorded_at
  FROM qf_jarvis.projection_attempt
 WHERE projection_name    = $1
   AND projection_version = $2
   AND event_position     = $3
 ORDER BY attempt_number
 LIMIT 10;
```

A blocked position must show exactly **five** rows, numbered 1–5, all `failed`. The SQL bounds
(`attempt_number BETWEEN 1 AND 5`, `failed_attempt_count BETWEEN 0 AND 5`) make a sixth automatic
attempt impossible at the database level. Anything else is a divergence.
