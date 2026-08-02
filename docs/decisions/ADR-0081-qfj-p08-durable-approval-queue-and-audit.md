# ADR-0081 — QFJ-P08 Durable Approval Queue and Audit

**Status:** Accepted — QFJ-P08 (migration 0009 + the durable queue package; no Core call, no operator surface, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0005](./ADR-0005-human-and-policy-approval.md) · [ADR-0014](./ADR-0014-governed-lifecycle-contracts.md) · [ADR-0077](./ADR-0077-qfj-p08-b-durable-postgres-conversation-state.md) · [ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md) · [ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md)

## Context

Baseline: `main` at `490fc60359dc756abf56132b96c3f67a041eb318`, the merge of PR #83 (the approval
runtime foundation). Collision checks on that baseline: no `packages/postgres-approval-queue`, no
reference to `@qf-jarvis/postgres-approval-queue`, `ADR-0081` unclaimed, zero open PRs; migrations
`0001`–`0008` with no `0009`, `0008` at `e79f1f09…`.

ADR-0080 made asking and correlating powerless and correct, and kept both in memory. Two things were
therefore still missing.

**Durability.** An `ApprovalRequestV1` died with the process. A human approving something tomorrow
needs the ask, and the recommendation it was made about, to still exist.

**A request-identity gap with a real consequence.** `ApprovalDecisionV1` deliberately carries **no
`approvalRequestId`** — Core answers about a recommendation's actions, not about Jarvis's
bookkeeping — and ADR-0080 deliberately makes **no idempotency claim**, so two `createRequest` calls
are two asks. Put those together and two unanswered asks for the same
`(recommendationId, proposedActionId)` could be open at once, at which point an arriving decision is
ambiguous between them and **nothing in the artifacts can resolve it**. Neither contract is wrong;
the ambiguity has to be made unrepresentable by whatever stores them.

## Decision

### 1. Five tables, migration 0009

`qf_jarvis.approval_request_record` (the exact request plus a canonical source snapshot),
`approval_active_slot` (coordination), `approval_decision_record` (Core's artifact verbatim),
`approval_request_decision_link` (which ask a decision answered), and the content-free
`approval_queue_audit`.

Four are fully append-only, enforced by triggers rather than by convention: a stored decision that
can be edited after the fact is not an authorization record. The slot's
`(recommendation_id, proposed_action_id)` key is immutable and it cannot be deleted; its pointer is
the **only mutable column anywhere in the migration**.

### 2. There is no local approval status, and there cannot be

No `status`, `pending`, `approved`, `authorized`, `can_execute` or `can_send` column exists, and no
trigger derives one. The model is:

> a REQUEST exists; a DECISION may exist; a LINK between them may exist.

That is the whole state. Approval authority lives only in the immutable Core `ApprovalDecisionV1`,
stored verbatim and never reinterpreted or summarized into a boolean.

**"Active" is a question, not a column.** A request is active at an observation instant `T` when the
slot points at it, no decision link exists, and `expiresAt > T`. Storing it would create a value that
goes stale silently — and a stale `pending` inside Jarvis is precisely the piece of authorization
state ADR-0002 puts in Core. The caller supplies `T`; this package reads no clock.

### 3. The slot is coordination, and the invariant is a per-key row lock

`INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE` on one slot row. Two enqueues for the
same action contend on that row; two enqueues for **different** actions never meet. No table lock, no
advisory lock, no `SERIALIZABLE`, no retry — a control plane that serialised every approval would be
a throughput ceiling bought for no safety.

**The lock is taken BEFORE the request lookup**, and that ordering is load-bearing. Reading the
request first makes the duplicate check racy: two sessions replaying the same ask both see nothing,
and the loser then meets its _own_ request in the slot and reports `active-request-conflict` — an
exact replay misreported as an overlap. Inside the lock every read is authoritative. This was found
by the concurrent-duplicate spec, not by inspection.

Expiry is compared against the **incoming request's `createdAt`**, a causal instant the caller
stated, never `now()`. Comparing against a clock would make the same pair of asks succeed or fail
depending on when the process happened to run them.

### 4. Nothing here reimplements an approval semantic

The tempting thing for a store to do is re-check what matters — that `risk` matches, that the
authority was not weakened, that the fingerprint is right. That would be a **second definition of the
approval rules**, free to drift from ADR-0080's and silently left behind when the runtime changes.

So faithfulness is proved by **rebuilding**: the stored source goes back through the real
`createApprovalRuntime().createRequest`, with the identity port pinned to the supplied request id,
and the result is compared by deep equality. Every rule the runtime enforces — derived risk and
authority, derived agent, version, correlation and summary, the recomputed fingerprint, the timing
bounds, the informational refusal, the contract's own escalations — is enforced here by
construction, and stays enforced when the runtime changes. Decisions are correlated by calling that
runtime's `validateDecision`, never by re-deriving it.

### 5. The stored source is canonical, and its fingerprints are recomputed

A caller's `RecommendationRuntimeResult` is a structural value; storing it verbatim would persist
whatever extra keys it carried. The recommendation is parsed with `recommendationV1Schema` and the
bindings are **rebuilt from recomputed** `fingerprintProposedAction` digests. The caller's own
bindings are never read — a 64-character lowercase hex string is trivial to produce.

This is what makes anti-substitution survive storage: a stored source whose action content is altered
later fails on read, because the digest is recomputed every time rather than trusted.

### 6. Replay, conflict, and what each means

| Situation                                                  | Outcome                                        |
| ---------------------------------------------------------- | ---------------------------------------------- |
| exact request reissued                                     | `REPLAYED`, read-only, **no second audit row** |
| same request id, different ask                             | `request-conflict`                             |
| a second unanswered ask for the same action                | `active-request-conflict`                      |
| the incumbent had already expired at the new ask's instant | replaced, one `REQUEST_EXPIRY_OBSERVED`        |
| exact decision reissued                                    | `REPLAYED`, read-only, no second audit row     |
| same decision id, different content                        | `decision-conflict`                            |
| a different decision for an answered ask                   | `request-already-decided`                      |

Concurrent exact duplicates produce one durable effect and the same result for both callers;
concurrent conflicting writes produce one winner with the loser's candidate rows rolled back. A
private sentinel requests that rollback, and the transaction helper rethrows the callback's error
**unclassified** so the sentinel survives — the lesson from QFJ-P08-B2, where classifying it turned a
correct duplicate race into an invented `database-unavailable`.

### 7. One decision may answer several asks

`decision_id` is unique in the decision RECORD (one row per Core decision — copies could diverge) and
deliberately **not** unique in the LINK. A Core decision covering actions A and B legitimately
answers two asks: one decision row, two links, two `DECISION_LINKED` audit rows, both slots cleared.
`approval_request_id` IS unique in the link: one ask is answered at most once.

Under partial approval the overall outcome may be `approved` while a particular action is `rejected`,
and the per-action verdict is what is returned for that action.

### 8. An old decision cannot clear a newer slot

A1 expires, A2 replaces it, and a historically valid Core decision for A1 arrives afterwards — decided
inside A1's own validity window, so it is legitimate and must be recorded. Recording it must **not**
clear A2's slot. The pointer is cleared by a statement whose `WHERE` includes
`active_approval_request_id = $3`, so the rule is enforced by the write rather than by a comparison
someone could later reorder.

### 9. Least privilege

`REVOKE ALL` from `PUBLIC` and from `anon`/`authenticated`/`service_role`. The conditional
`qf_jarvis_runtime` grant is `SELECT, INSERT` on all five plus **column-level**
`UPDATE (active_approval_request_id)` on the slot — so the runtime cannot re-point a slot at a
different action even if the trigger were ever dropped. No `DELETE`, no `TRUNCATE`, and no
`schema_migration` grant.

`assertReady()` is non-mutating (every probe is a zero-row `SELECT` or a catalog read) and does not
consult `schema_migration`: that is tooling state, and startup should trust the _actual_ schema, not
a recorded checksum a hand-repaired database would still satisfy.

## Rejected alternatives

- **A `status` column, or an `approved` boolean.** The easiest thing to add to a queue, and exactly
  the authorization state ADR-0002 puts in Core.
- **Storing "active" as a column.** Goes stale silently; the question has a caller-supplied instant.
- **Adding `approvalRequestId` to `ApprovalDecisionV1`.** Would make Core's artifact describe Jarvis's
  bookkeeping. The coordination belongs in the store.
- **An advisory lock or `SERIALIZABLE`.** A global serialisation point, or a retry obligation, for no
  safety the per-key row lock does not already give.
- **Reading `now()` to decide expiry.** Makes the same pair of asks succeed or fail depending on when
  they ran, and makes a replayed sequence non-deterministic.
- **Re-checking risk, authority and fingerprint field-by-field here.** A second definition of the
  approval rules inside a storage adapter.
- **Trusting a supplied binding's digest.** Trivially forgeable; only recomputation binds content.
- **Copying a decision row per linked request.** Copies of one authorization, free to diverge.
- **Clearing the slot whenever a decision arrives.** Would let a late, valid decision for an expired
  ask silently cancel its replacement.
- **Looking up the request before locking the slot.** Misreports an exact concurrent replay as an
  overlap — found by test, not by reading.

## Consequences

An approval ask now survives a restart with the recommendation it was made about; a decision recorded
later still correlates to it, with the fingerprint recomputed; and two overlapping asks for one
action are impossible. The audit is content-free — three closed event types and opaque references
only, with no summary, policy, rationale, evidence, parameters, fingerprint, decider or explanation.

The new package root is locked at **3** runtime symbols and 9 types. Every existing package-root count
is unchanged, `apps/api` stays **0**, and no lower package imports this one. The dependency graph
gains one leaf: `contracts` + `approval-runtime` + `recommendation-runtime` + `pg`, with
`event-backbone` **dev-only** for the migration harness. No new third-party resolution, no cycle.

Migrations become `0001`–`0009`; `0009` is
`1927f32aff3b3b42a987fe6ff0c53f1caa2403040377c3effbba88817a1d2257`, `0001`–`0008` are byte-identical,
and there is no `0010`. **Managed PostgreSQL was not accessed and still carries `0001` only**;
`0002`–`0009` remain unapplied. Production rollout remains **OFF**.

**Canonical QFJ-P08 remains incomplete.** Still pending: consent and opt-out state, QuickFurno Core
integration (the transport that would deliver a request and return a decision), and an authenticated
operator approval surface — in that order. Communication authorization remains a separate contract:
an approval is not permission to contact anyone, and founder approval does not override an opt-out.

## Non-goals

No Core transport call or client. No operator HTTP, API, UI or authentication. No consent, opt-out or
`CommunicationAuthorizationV1` evaluation. No `ExecutionIntentV1`, idempotency key, provider selection
or recipient resolution. No canonical event emitted by Jarvis. No `JarvisRuntime` or application
wiring. No migration beyond `0009` and no `0010`. No managed database access or deployment.

## Change-control rule

The five-table model and the non-overlap invariant are the contract this slice establishes. Adding a
status column, relaxing the slot's uniqueness, making `decision_id` unique in the link, or clearing
the slot without the exact-request predicate each reopens a failure this ADR closes, and is a
governed change requiring its own decision.
