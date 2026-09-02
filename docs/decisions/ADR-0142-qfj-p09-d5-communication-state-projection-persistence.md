# ADR-0142 — QFJ-P09 D5: communication-state projection persistence

**Status:** **Accepted — IMPLEMENTED OFFLINE (PR #183).** The owner accepted the design below and
**separately authorized migration `0013` alone**, repository/local/CI only. The handler, the migration
and the full test matrix landed on this same PR. **The projection is NOT registered and NOT activated;
nothing was applied to managed PostgreSQL.**
**Baseline:** `f4bfe67d04f41197fcdea7c86dbd5fabc2f1e81c` (main after PR #182 / D3 / ADR-0141)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited; no Core code read, accessed or modified**

**Offline implementation only.** No Core change, no managed database, no n8n/provider/Meta, no message,
**exactly one authorized migration (`0013`)**, no registry entry, no activation, rollout **OFF**.

## Prerequisites, all merged

| Slice | ADR                                                                                      | PR   | Merge commit                               |
| ----- | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------ |
| D2    | [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md)                | #178 | `fb23e46efbad66b6a82ecc9920c86548aeb058e1` |
| D2a   | [ADR-0138](./ADR-0138-qfj-p09-d2a-accepted-event-write-path-and-provenance-hardening.md) | #179 | `2027d3215a36e8fdbed6809d0f12a917bb71cdee` |
| D4    | [ADR-0140](./ADR-0140-qfj-p09-d4-trusted-communication-evidence-read-capability.md)      | #180 | `182a9cb1c00cf1e3ad0225654992099208b992a0` |
| D2b   | [ADR-0139](./ADR-0139-qfj-p09-d2b-tier-ab-durable-evidence-and-ordering-confirmation.md) | #181 | `88ddab543f693c849f710db8de287bac005aba74` |
| D3    | [ADR-0141](./ADR-0141-qfj-p09-d3-communication-state-record-v2-six-state-contract.md)    | #182 | `f4bfe67d04f41197fcdea7c86dbd5fabc2f1e81c` |

---

## What the owner decided

The design below was put up for review as a checkpoint. The owner **accepted it** and returned four
decisions, all recorded here as the reasons the implementation looks the way it does.

1. **Migration `0013` is authorized — that one, and only that one.** Repository/local/CI ONLY. **Not**
   authorized for managed PostgreSQL, not deployed, not a production activation. No other migration is
   authorized, and migrations `0001`–`0012` are byte-identical and untouched.

2. **NO erasure tombstone — locked out, with the rationale recorded.** The `0007` subject tombstone is
   lawful because that table is keyed by a real subject reference and is driven by the EXISTING durable
   `qf.privacy.erasure-recorded` evidence. This table has no `subject_type`, no `subject_id`, no accepted
   communication-erasure event, and no durable evidence mapping an erasure request to a
   `communication_id`. An `erased` flag here would invent **both** an identity relation that is not
   established **and** a durable erasure fact this evidence stream does not contain — and it would break
   the rebuild rule, because a rebuild could not reproduce it. **This omission makes NO legal or privacy
   deletion claim.** The row is disposable, non-authoritative, minimised and rebuildable; a future privacy
   slice may design communication-level erasure once a durable authoritative relation exists.

3. **The `0010`–`0012` ledger entries are to be recorded in the same pass**, from owner-supplied
   history rather than inferred from filenames — see the ledger section below.

4. **D5 is implemented OFFLINE and is not activated.** No production-registry entry, no rollout.

### One deviation from the proposal, and why

The proposal said the projection role would get what the handler needs to run. Implementation found that
the D4 reader also selects `event_id`, `source` and the version-gated `payload`, and the projection role
holds **none** of those (`0004` granted `sequence, event_type, event_version`; `0007` added
`subject_type, subject_id`). Granting them would hand that role SELECT on the payload column of the
**whole event log** — and **three existing least-privilege tests assert it must never have it**
(`projection-foundation`, `projection-ordering`, `subject-activity`).

Weakening those tests to make D5 pass was not an option, and it was not the right trade in any case:
nothing runs as that role today, because D5 is not registered. **So `0013` adds no grant on
`qf_jarvis.event` at all.** That grant belongs to the **activation slice**, alongside the registry
entry, where the exposure can be reviewed against a runtime that actually needs it. The consequence is
stated plainly: **as merged, the projection role cannot execute this projection** — which is correct,
because it is not meant to yet.

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

### The migration was NOT authorized by this slice — and was authorized separately, afterwards

`docs/governance/migration-ledger.md` requires **six** conditions before a migration number may be
used. Measured against them:

| #   | Condition                                    | Status                                                     |
| --- | -------------------------------------------- | ---------------------------------------------------------- |
| 1   | owning phase design approved                 | **YES**, at owner review — this ADR is now Accepted        |
| 2   | schema change proven necessary               | **YES** — established above                                |
| 3   | exact scope reviewed                         | **YES**, at owner review — the design below is what landed |
| 4   | prior migration inventory confirmed          | **YES** — `0001`–`0012` verified, and now ledger-recorded  |
| 5   | managed rollout impact documented            | **YES** — below                                            |
| 6   | **migration creation separately authorized** | **YES** — `0013` alone, local/CI only                      |

And the two most recent decisions say so explicitly:

> **ADR-0139:** "`0013` is not allocated or reserved."
> **ADR-0141:** "`0013` is not allocated or reserved; the `0010`–`0012` ledger drift is untouched."

**Verdict: `MIGRATION_REQUIRED_AWAITING_AUTHORIZATION`.** The ledger also states that _"roadmap text
alone cannot authorize or allocate a migration number"_ — and neither can a slice brief that
anticipates this checkpoint.

---

## The design, as accepted and implemented

Nothing here is implemented. This is the exact scope condition 3 needs.

### Read-model semantics

**One current row per `communication_id`** — a latest-state projection, not an append log.

A second local append log would create a **second ordering domain**, which ADR-0139 rejected for
Tier A/B and which would be no better here: the accepted Core event-position stream already orders
these facts, and a per-communication latest row is derivable from it deterministically. History, if a
consumer ever needs it, is already replayable from the event log itself — duplicating it locally would
add a store that could disagree with its own source.

### The table

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
minimised evidence. Whether a communication-level tombstone was needed was put to review, and the owner
**locked it out**: there is no durable communication-erasure evidence to rebuild one from, so an `erased`
flag would be invented rather than derived. See owner decision 2 above. **This makes no legal or privacy
deletion claim.**

**Grants:** `SELECT/INSERT/UPDATE` on the new table for `qf_jarvis_projection_runtime`, and **no
`DELETE`/`TRUNCATE`** — a version-bump rebuild destroy stays a trusted admin operation, exactly as
`0004` and `0007` established. **No other role changes, and no grant is broadened** — including no grant
on `qf_jarvis.event`, per the deviation note above.

**Managed rollout:** local/CI only. **The managed database still carries only `0001`**, and this
migration would not change that. **Nothing is applied to managed PostgreSQL.**

### The handler, as implemented

A `defineProjection` handler with a fixed name and version, consuming the runner's position and calling
**only** `readTrustedCommunicationEvidenceAtPosition`. `null` evidence writes nothing — no state is
invented for an unrelated or non-admitted event. Records are validated with the canonical
`communicationStateRecordV2Schema` before persistence; no competing validator is written. Stored-data
and infrastructure errors propagate **fail-closed**. `ProjectionEvent` is not widened, the D4 reader
stays root-unexported, and the handler is **not** added to the production registry — D5 is
implemented-and-testable **OFFLINE, not activated**.

That handler moved D4's production importer count from **0 to exactly 1**. The containment tests now
compare the full importer list with `toStrictEqual([D5_HANDLER])`, so it bites in both directions — zero
fails (the handler vanished or stopped using the governed route) and two-or-more fails (a second consumer
appeared) — and the ESLint exception is **file-exact**: a sibling handler in the same directory is still
refused, and the D5 handler keeps every other boundary it had (reducer purity, subject-blindness, and both
event-writer bans). The corpus is the **git-tracked** production source, so the file had to be tracked to
be scanned — no filename-shaped bypass.

---

## Migration ledger drift — reported, not silently repaired

At the checkpoint the ledger recorded **`0001`–`0009`** while the repository contained
**`0001`–`0012`**:

| Migration                                | SHA-256                                                            | Ledger     |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------- |
| `0010_execution_replay_claim.sql`        | `1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05` | **absent** |
| `0011_riya_conversation_continuity.sql`  | `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93` | **absent** |
| `0012_riya_logical_turn_idempotency.sql` | `5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e` | **absent** |

**All nine recorded checksums verify exactly**, so nothing supposedly immutable has been altered; the
drift is three unrecorded additions, not tampering.

**The ledger was repaired in this slice, under owner-supplied history.** At the checkpoint it was left
untouched, because recording an entry requires the owning phase, slice and applied-status for each —
facts belonging to those slices, not to D5, and writing them from filename inference would have put
unverified governance history into the very document that exists to prevent that. The owner then supplied
those facts, so the entries are now written from them:

- **`0010`** — **QFJ-P09.03**, [ADR-0091](./ADR-0091-qfj-p09-03-durable-execution-replay-idempotency-store.md),
  commit `f4d8f54a08c599ff70d776edb8dfbef2557987da` (`feat(execution): add durable replay store`).
  Recorded as P09.03 because that is what ADR-0091 says (`Status: Accepted — QFJ-P09.03`); **QFJ-P09.02**
  ([ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md)) is the PRECEDING slice,
  which deliberately shipped no replay store — which is why `0010` exists at all.
- **`0011`** — internal Riya **RWC-P2B**, [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md).
  **Not** a canonical QFJ-P08 migration, and not recorded as one.
- **`0012`** — internal Riya **RWC-P8**, [ADR-0104](./ADR-0104-rwc-p8-cross-channel-continuity-and-logical-turn-idempotency.md).
  Explicitly **not** canonical QFJ-P08 either.

Condition 4 — "prior migration inventory confirmed" — is therefore satisfied both against the repository
and in the ledger itself, and `0013` is recorded alongside them.

**No existing migration byte was modified.**

---

## Consequences

- **D5 is implemented offline.** The handler, migration `0013` and the test matrix landed together;
  **no registry entry and no activation**.
- **D4's production importer count is now exactly 1**, and that one importer is the D5 handler.
- **The projection role gained upsert on the new read model only.** No grant on `qf_jarvis.event` was
  added or broadened, so the three existing least-privilege tests stand unweakened — and the projection
  cannot yet be executed by that role, by design.
- **No erasure tombstone**, per the owner decision above; this asserts no deletion capability.
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
- **Update the ledger for `0010`–`0012` by inferring from filenames.** Rejected at the checkpoint, and
  still rejected: the entries are written now only because the **owner supplied** the owning slice, ADR
  and history for each. `0011` and `0012` are recorded as internal Riya work-stream migrations (RWC-P2B,
  RWC-P8) with **no** canonical QFJ phase, because claiming one they never had is exactly the invented
  history the ledger exists to prevent.
- **Grant the projection role payload access so the handler can run as that role.** Rejected — see
  the deviation note above.

---

## Posture

One new projection handler, one new migration (`0013`), and tests. No contract, event registry or
ingestion change. No Core modification, branch, PR, audit or re-pin. No managed Supabase or managed
PostgreSQL — **the managed database still carries only `0001`**. No n8n or provider access. No message
sent. **No production-registry entry; the projection is not activated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
