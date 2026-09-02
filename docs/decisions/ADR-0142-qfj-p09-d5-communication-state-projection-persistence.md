# ADR-0142 — QFJ-P09 D5: communication-state projection persistence

**Status:** **Proposed — DESIGN CHECKPOINT. Implementation is BLOCKED on a separately authorized
migration.** No production code, no SQL, and no migration number were created by this slice.
**Baseline:** `f4bfe67d04f41197fcdea7c86dbd5fabc2f1e81c` (main after PR #182 / D3 / ADR-0141)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited; no Core code read, accessed or modified**

**Offline design only.** No Core change, no managed database, no n8n/provider/Meta, no message,
**no migration allocated**, rollout **OFF**.

## Prerequisites, all merged

| Slice | ADR                                                                                      | PR   | Merge commit                               |
| ----- | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------ |
| D2    | [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md)                | #178 | `fb23e46efbad66b6a82ecc9920c86548aeb058e1` |
| D2a   | [ADR-0138](./ADR-0138-qfj-p09-d2a-accepted-event-write-path-and-provenance-hardening.md) | #179 | `2027d3215a36e8fdbed6809d0f12a917bb71cdee` |
| D4    | [ADR-0140](./ADR-0140-qfj-p09-d4-trusted-communication-evidence-read-capability.md)      | #180 | `182a9cb1c00cf1e3ad0225654992099208b992a0` |
| D2b   | [ADR-0139](./ADR-0139-qfj-p09-d2b-tier-ab-durable-evidence-and-ordering-confirmation.md) | #181 | `88ddab543f693c849f710db8de287bac005aba74` |
| D3    | [ADR-0141](./ADR-0141-qfj-p09-d3-communication-state-record-v2-six-state-contract.md)    | #182 | `f4bfe67d04f41197fcdea7c86dbd5fabc2f1e81c` |

---

## The finding

**D5 needs durable persistence that does not exist, and creating it needs an authorization this slice
does not have.** Both halves were verified, not assumed.

### D5 is a _durable_ projection, not a mapper

The Model-2 design calls D5 the **"tiered local projection"**, and the rules it inherits are
persistence rules: rebuild determinism, replay idempotency, and ordering by the gap-free projection
position. An in-memory mapper would satisfy none of them, so **shipping one and calling D5 complete
would be a false claim** — which is why this ADR stops rather than substituting something easier.

### No suitable read model exists

Every `CREATE TABLE` across migrations `0001`–`0012` was enumerated. The read models present are
`rm_subject_activity`, `rm_event_type_activity` and `rm_daily_event_acceptance` — none carries
communication-state semantics, and **no table anywhere mentions communication state**. Reusing one
would mean storing V2 records in a table designed for something else, which the brief forbids and
which would break the erasure and rebuild semantics those tables already own.

**So D5 requires a new table, and therefore a migration.**

### The migration is NOT authorized by this slice

`docs/governance/migration-ledger.md` requires **six** conditions before a migration number may be
used. Measured against them:

| #   | Condition                                    | Status                                                    |
| --- | -------------------------------------------- | --------------------------------------------------------- |
| 1   | owning phase design approved                 | **NO** — this ADR is Proposed                             |
| 2   | schema change proven necessary               | **YES** — established above                               |
| 3   | exact scope reviewed                         | **NO** — the proposal below is what review would consider |
| 4   | prior migration inventory confirmed          | **YES** — `0001`–`0012`, checksums verified               |
| 5   | managed rollout impact documented            | **YES** — below                                           |
| 6   | **migration creation separately authorized** | **NO**                                                    |

And the two most recent decisions say so explicitly:

> **ADR-0139:** "`0013` is not allocated or reserved."
> **ADR-0141:** "`0013` is not allocated or reserved; the `0010`–`0012` ledger drift is untouched."

**Verdict: `MIGRATION_REQUIRED_AWAITING_AUTHORIZATION`.** The ledger also states that _"roadmap text
alone cannot authorize or allocate a migration number"_ — and neither can a slice brief that
anticipates this checkpoint.

---

## Proposed design, for review

Nothing here is implemented. This is the exact scope condition 3 needs.

### Read-model semantics

**One current row per `communication_id`** — a latest-state projection, not an append log.

A second local append log would create a **second ordering domain**, which ADR-0139 rejected for
Tier A/B and which would be no better here: the accepted Core event-position stream already orders
these facts, and a per-communication latest row is derivable from it deterministically. History, if a
consumer ever needs it, is already replayable from the event log itself — duplicating it locally would
add a store that could disagree with its own source.

### Proposed table

`qf_jarvis.rm_communication_state`, following the `0007` precedent exactly:

| Column             | Type                   | Notes                                                                                           |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `communication_id` | `UUID` **PRIMARY KEY** | one row per communication                                                                       |
| `state`            | `TEXT NOT NULL`        | CHECK-constrained to the **six** V2 states                                                      |
| `contract_version` | `SMALLINT NOT NULL`    | CHECK `= 2`                                                                                     |
| `recorded_at`      | `TIMESTAMPTZ NOT NULL` | the evidence instant — authorization `decidedAt` or result `recordedAt`. **Never a wall clock** |
| `reason_code`      | `TEXT NOT NULL`        | open Core machine token, copied verbatim                                                        |
| `correlation_id`   | `UUID NOT NULL`        | copied verbatim                                                                                 |
| `previous_state`   | `TEXT`                 | nullable; CHECK-constrained to the same six                                                     |
| `evidence`         | `JSONB NOT NULL`       | the exact minimised V2 evidence, schema-validated before write                                  |
| `last_position`    | `BIGINT NOT NULL`      | the projection position that produced this row                                                  |

**Deliberately absent:** recipient, phone, email, purpose code, explanation, policy, approval decision
id, execution ids, provider reference, provider timestamps, failure category, description, raw payload,
signature, digest. V2 cannot carry them and neither can the table.

### Idempotency, ordering and staleness

One position-guarded upsert, mirroring `0007`:

```
INSERT ... ON CONFLICT (communication_id) DO UPDATE SET ...
  WHERE EXCLUDED.last_position > rm.last_position
```

- **Replay is a no-op.** A re-presented position is not strictly greater, so it changes nothing.
- **A stale or out-of-order position cannot overwrite newer state**, by the same guard.
- **Ordering is the existing gap-free `projection_event_position`.** No second cursor, no second log,
  no timestamp ordering — the projection runner supplies the position and D5 uses only that.

### `previousState`

Populated **only** from the row this write replaces, and only when that stored state is one of the six.
It is **context, never evidence**: it is never used to decide whether the incoming trusted fact is true,
and it is never inferred from timestamps, event type, the lifecycle graph, request timing, execution
ids, or absence of evidence. When no lawful prior row exists it is **omitted**.

This stays deterministic because the prior row is itself a deterministic function of the same ordered
position stream — the same rebuild produces the same sequence of replacements.

### Rebuild, erasure, grants, rollout

**Rebuild:** replaying positions in order reproduces the table exactly; the guard makes each step
idempotent. Note the standing limit — **D5 cannot claim full 18-state deterministic rebuild**, only the
six implemented states, because the others have no durable source (ADR-0139).

**Erasure:** the row holds no personal data — an opaque `communication_id`, closed machine tokens, and
minimised evidence. Whether a communication-level tombstone is needed is a **question for review**, not
something to invent here; `0007`'s subject tombstone exists because that table stores a subject
reference, and this one does not.

**Grants:** `SELECT/INSERT/UPDATE` on the new table for `qf_jarvis_projection_runtime`, and **no
`DELETE`/`TRUNCATE`** — a version-bump rebuild destroy stays a trusted admin operation, exactly as
`0004` and `0007` established. **No other role changes, and no grant is broadened.**

**Managed rollout:** local/CI only. **The managed database still carries only `0001`**, and this
migration would not change that. **Nothing is applied to managed PostgreSQL.**

### The handler, when authorized

A `defineProjection` handler with a fixed name and version, consuming the runner's position and calling
**only** `readTrustedCommunicationEvidenceAtPosition`. `null` evidence writes nothing — no state is
invented for an unrelated or non-admitted event. Records are validated with the canonical
`communicationStateRecordV2Schema` before persistence; no competing validator is written. Stored-data
and infrastructure errors propagate **fail-closed**. `ProjectionEvent` is not widened, the D4 reader
stays root-unexported, and the handler is **not** added to the production registry — D5 is
implemented-and-testable **OFFLINE, not activated**.

That handler would move D4's production importer count from **0 to exactly 1**, with containment tests
updated so the D5 handler path is the sole permitted importer and both zero and two-or-more fail.

---

## Migration ledger drift — reported, not silently repaired

The ledger records **`0001`–`0009`**. The repository contains **`0001`–`0012`**:

| Migration                                | SHA-256                                                            | Ledger     |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------- |
| `0010_execution_replay_claim.sql`        | `1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05` | **absent** |
| `0011_riya_conversation_continuity.sql`  | `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93` | **absent** |
| `0012_riya_logical_turn_idempotency.sql` | `5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e` | **absent** |

**All nine recorded checksums verify exactly**, so nothing supposedly immutable has been altered; the
drift is three unrecorded additions, not tampering.

**The ledger is left untouched.** Recording an entry requires the owning phase, slice and applied-status
for each — facts that belong to those slices, not to D5. Writing them from filename inference would put
unverified governance history into the very document that exists to prevent that. **This remains open
governance debt**, and it matters here because **condition 4 of the migration policy is "prior
migration inventory confirmed"** — confirmed against the repository it is, but the ledger does not yet
say so.

**No existing migration byte was modified.**

---

## Consequences

- **D5 implementation does not proceed in this slice.** No handler, no SQL, no migration, no registry
  entry, no activation.
- **D4's production importer count remains exactly 0**, and its containment tests are unchanged. They
  change when the handler lands, not before.
- **No fake persistence.** Not process memory, not a JSON file, not an unrelated table, not direct
  imperative writes, not a second event log, not an unnumbered SQL file.
- **The six implemented states are unchanged** and no excluded or Tier-A/B state was added.
- **No canonical state event**, no `state-recorded@3`, no V1 mutation, no V1→V2 conversion.
- **Rollout remains OFF.** Nothing was activated and no managed database was touched.

---

## Alternatives considered

- **Ship an in-memory mapper and call D5 done.** Rejected: D5's defining properties are durability,
  rebuild and replay. A mapper has none, and naming it D5 would misreport the state of the work.
- **Reuse an existing read-model table.** Rejected: none carries communication-state semantics, and
  overloading one would break the erasure and rebuild rules it already owns.
- **A local append-only communication log.** Rejected: a second ordering domain, which ADR-0139 already
  refused, and unnecessary because the ordered event stream is the history.
- **Allocate `0013` because it is numerically next.** Rejected: the ledger forbids exactly that, and two
  merged ADRs state `0013` is not reserved.
- **Update the ledger for `0010`–`0012` now.** Rejected: ownership and applied-status must come from
  those slices' own history. Reported as debt instead.

---

## Posture

No production code. No contract, event registry, ingestion, projection or runtime change. No Core
modification, branch, PR, audit or re-pin. No managed Supabase or managed PostgreSQL. No n8n or
provider access. No message sent. **No migration allocated; `0013` is not reserved.**

**Production rollout remains OFF. Runtime activation is unchanged.**
