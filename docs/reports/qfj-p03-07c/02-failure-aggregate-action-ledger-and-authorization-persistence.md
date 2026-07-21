# Report 02 — Failure Aggregate, Action Ledger and Authorization Persistence

**Date:** 2026-07-22. Migration `0006_projection_failure_operations.sql` + repository (`projection-failure-persistence.ts`, `projection-failure-repository.ts`).

## Tables created (exactly four)

`qf_jarvis.projection_failure`, `qf_jarvis.projection_failure_action`, `qf_jarvis.projection_replay_authorization`, `qf_jarvis.projection_replay_attempt`. **No existing table was altered.**

## 1. `projection_failure` — the aggregate (mutable state; identity immutable)

**Columns:** `failure_id UUID PK`; `projection_name TEXT`, `projection_version INTEGER`, `projection_position BIGINT`, `event_storage_sequence BIGINT`, `event_id UUID?`; `category TEXT`, `safe_error_code VARCHAR(64)`, `detail_digest VARCHAR(128)?`; `status TEXT DEFAULT 'open'`, `generation INTEGER DEFAULT 0`; `automatic_attempt_count SMALLINT`, `replay_attempt_count INTEGER`; `acknowledged_at/by`, `quarantined_at/by`, `resolved_at`, `resolved_attempt_id UUID?`; `first_failed_at`, `last_failed_at`, `created_at`, `updated_at`.
**Check constraints:** name format; version/position/event-seq positive; `category` ∈ 5 taxonomy categories; `safe_error_code` ∈ 5 diagnostic codes; `status` ∈ `open/acknowledged/quarantined/replay-authorized/replaying/resolved/superseded/retired`; `generation >= 0`; `automatic_attempt_count 0..5`; `replay_attempt_count >= 0`; timestamps ordered; resolved-shape (`status='resolved'` ⇔ `resolved_at` and `resolved_attempt_id` set); acknowledged/quarantined attribution paired.
**Indexes:** `projection_failure_active_unique` — **PARTIAL UNIQUE** on `(projection_name, projection_version, projection_position) WHERE status NOT IN ('resolved','superseded','retired')` (the active-failure invariant); `by_projection (name, version, status)`; `by_status_created (status, created_at)`.
**Trigger:** `projection_failure_guard_mutation` — refuses DELETE and any change to identity columns (`failure_id`, projection identity, event identity, `category`, `safe_error_code`, `first_failed_at`, `created_at`).

**Lifecycle vocabulary:** `open · acknowledged · quarantined · replay-authorized · replaying · resolved · superseded · retired` (terminal: `resolved · superseded · retired`).

## 2. `projection_failure_action` — append-only audit ledger

**Columns:** `sequence BIGINT IDENTITY PK`, `action_id UUID`, `failure_id UUID FK`, `action_type TEXT`, `actor_type TEXT`, `actor_id VARCHAR(128)`, `reason VARCHAR(512)?`, `idempotency_key VARCHAR(128)?`, `correlation_id UUID?`, `expected_generation INT?`, `resulting_generation INT?`, `occurred_at`, `recorded_at DEFAULT clock_timestamp()`.
**Action-type vocabulary (12):** `created · acknowledged · quarantined · replay-authorized · replay-started · lease-taken-over · replay-succeeded · replay-failed · authorization-consumed · reconciled · resolved · superseded`.
**Actor-type vocabulary (5):** `system · read-only-operator · failure-operator · replay-approver · administrator`.
**Constraints/indexes:** FK → failure; `action_id` unique; generations non-negative; `by_failure (failure_id, sequence)`; **partial-unique** `idempotency_key` where present.
**Trigger:** `projection_failure_action_reject_mutation` — refuses **UPDATE and DELETE** (append-only).

## 3. `projection_replay_authorization` — mutable state; identity immutable

**Columns:** `authorization_id UUID PK`, `failure_id UUID FK`, `failure_generation INTEGER`, `state TEXT DEFAULT 'active'`, `authorized_by VARCHAR(128)`, `reason VARCHAR(512)?`, `idempotency_key VARCHAR(128) UNIQUE`, `created_at`, `expires_at?`, `consumed_at?`, `consumed_attempt_id UUID?`, `revoked_at?`.
**State vocabulary (4):** `active · consumed · expired · revoked`.
**Constraints/indexes:** FK → failure; `UNIQUE(authorization_id, failure_id)` (the composite key the attempt FK references); `idempotency_key` unique; generation non-negative; expiry after created; consumed/revoked shapes; **PARTIAL UNIQUE** `active_unique` on `(failure_id) WHERE state='active'` (at most one active authorization per failure).
**Trigger:** `projection_replay_authorization_guard_mutation` — refuses DELETE and identity changes (`authorization_id`, `failure_id`, `failure_generation`, `idempotency_key`, `created_at`).

## Repository methods (this group)

`createProjectionFailure`, `readProjectionFailureById`, `readActiveProjectionFailure`, `listProjectionFailures` (bounded ≤500), `acknowledgeProjectionFailure`, `quarantineProjectionFailure`, `resolveProjectionFailure` (all repository-mediated, prior-status-guarded transitions — no generic `setStatus`); `appendProjectionFailureAction`, `readProjectionFailureActions`; `createReplayAuthorization` (generation-checked, idempotent), `readActiveReplayAuthorization`, `consumeReplayAuthorization` (single-consume). Every input is validated at the boundary (`ProjectionInputError`) before any SQL; every stored value is parsed through the closed vocabularies (`ProjectionStoredDataError`); no raw Error/message/stack/SQL/payload/unbounded text is ever written.
