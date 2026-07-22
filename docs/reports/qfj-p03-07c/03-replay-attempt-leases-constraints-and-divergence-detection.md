# Report 03 — Replay Attempt, Leases, Constraints and Divergence Detection

**Date:** 2026-07-22.

## 4. `projection_replay_attempt` — attempt + lease evidence

**Columns:** `attempt_id UUID PK`, `failure_id UUID FK`, `authorization_id UUID`, `attempt_number INTEGER`, `state TEXT DEFAULT 'started'`, `lease_owner VARCHAR(128)`, `lease_acquired_at`, `lease_expires_at`, `started_at`, `finished_at?`, `outcome_code VARCHAR(64)?`, `resulting_position BIGINT?`, `commit_observed BOOLEAN?`, `correlation_id UUID?`, `recorded_at DEFAULT clock_timestamp()`.
**State vocabulary (4):** `started · succeeded · failed · abandoned`.
**Constraints:** FK → failure; **composite FK `(authorization_id, failure_id) → authorization(authorization_id, failure_id)`** (proves the authorization belongs to the attempt's failure); **`UNIQUE(failure_id, attempt_number)`** (attempt-number uniqueness); `attempt_number >= 1`; `state` ∈ 4; **`lease_expires_at > lease_acquired_at`** (lease coherence); `started_at >= lease_acquired_at`; resulting-position positive; outcome-code ∈ 5 diagnostic codes; started-shape (no terminal evidence while `started`); terminal-finished; succeeded-shape (resulting position set); failed-shape (outcome code set).
**Index:** `projection_replay_attempt_live_unique` — **PARTIAL UNIQUE** on `(failure_id) WHERE state='started'` (at most one live attempt/lease per failure).
**Trigger:** `projection_replay_attempt_guard_mutation` — refuses DELETE, identity/lease changes, and any transition out of a terminal state (`started → terminal` exactly once).

## Invariant verdicts

- **Active-failure invariant** — a blocked checkpoint ↔ exactly one unresolved active failure. **DB-enforced half:** partial-unique on `(name, version, position)` for non-terminal failures ⇒ at most one active failure per position; identity integrity via the guard trigger. **Transaction/repository-enforced half:** the full cross-table biconditional (blocked ⇒ has a failure; failure ⇒ blocked at the matching position) is composed by the caller's atomic transaction (QFJ-P03.07D) and surfaced by the divergence query. No single constraint is claimed to prove more than it does.
- **Active-authorization invariant** — partial-unique on `(failure_id) WHERE state='active'` ⇒ at most one active authorization per failure; `createReplayAuthorization` additionally checks the failure is non-terminal and generation-matched; single-consume via `consumeReplayAuthorization` (`WHERE state='active'`).
- **Attempt/lease invariant** — composite FK ties authorization to failure; `UNIQUE(failure_id, attempt_number)`; partial-unique live attempt per failure; lease coherence CHECK; a completed authorization/attempt cannot start/transition again.
- **Unknown-commit** — recorded via `commit_observed` on the attempt; it is evidence, never blind replay permission. Reconciliation reads checkpoint + failure + authorization + attempt (+ read-model outcome where provable) before any re-drive (a later slice).

## Divergence detection (fail-closed; no auto-repair)

`detectProjectionFailureDivergences(client)` returns a bounded list of closed codes:

1. `blocked-checkpoint-without-active-failure`
2. `blocked-checkpoint-with-multiple-active-failures`
3. `active-failure-without-blocked-checkpoint`
4. `active-failure-position-mismatch`
5. `authorization-for-resolved-or-missing-failure`
6. `multiple-active-authorizations`
7. `attempt-lease-inconsistent`

It only detects; it never repairs. An empty result means the invariants currently hold.

## Immutability / delete controls

- Identity fields cannot change (guard triggers on failure/authorization/attempt).
- The action ledger is append-only (UPDATE/DELETE refused).
- Replay-attempt evidence follows started → terminal once (no re-open, no delete).
- **No runtime role has DELETE or TRUNCATE** on any failure table (grants withhold DELETE; the guard triggers additionally refuse DELETE for every role including the owner).
- Lifecycle transitions pass through repository-owned, prior-status-guarded methods; there is no generic state-rewrite method and no ad-hoc-SQL workflow.

## Safe data bounds

Every operator/runtime-controlled text field is bounded and validated at the boundary: `safe_error_code`/`outcome_code` (closed vocab), `detail_digest` ≤128, `actor_id`/`authorized_by`/`lease_owner`/`idempotency_key` ≤128, `reason` ≤512 — each rejected if empty, oversized, or control-bearing. No raw stack, message, event, handler output, replay payload, or credential is persisted.
