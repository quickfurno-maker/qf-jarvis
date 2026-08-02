# ADR-0077 — QFJ-P08-B Durable PostgreSQL Conversation State

**Status:** Accepted — QFJ-P08-B2 (migration 0008 + the dedicated adapter; not wired into any application)
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0058](./ADR-0058-asynchronous-runtime-integration-boundaries.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0074](./ADR-0074-qfj-p08-a-conversation-control-command-foundation.md) · [ADR-0075](./ADR-0075-qfj-p08-a-writable-conversation-control-composition.md) · [ADR-0076](./ADR-0076-qfj-p08-b-tenant-scoped-authoritative-state.md)

## Context

Baseline: `main` at `0bd5a6ee3c8bfab414306809c10bc532698ec9a1`, the merge of PR #79 (QFJ-P08-B1).

ADR-0074 built the pure reducer. ADR-0075 composed a writable capability onto the ONE authoritative
state source and specified it as an **atomic** boundary. ADR-0076 ratified the identity and ownership
model. What none of them could deliver is the thing the launch gate actually needs: **a human
takeover that survives a restart**. The only implementation was an in-process fake, so control state
lived in a closure and two processes each held their own revision.

Collision checks on this baseline: migrations `0001`–`0007` present with checksums matching the
locked values exactly; no `0008` claimed by any tracked file or open PR; `ADR-0077` unclaimed; zero
open PRs.

**Verdict: `SCHEMA_REQUIRED`.** This ADR records the schema and the adapter that satisfy it.

## Decision

### 1. A dedicated package, and the dependency boundary

`@qf-jarvis/postgres-conversation-state`. Production dependencies exactly:
`@qf-jarvis/conversation-control` (the reducer), `@qf-jarvis/jarvis-runtime` (type contracts) and
`pg`.

`@qf-jarvis/event-backbone` and `@qf-jarvis/agent-runtime` are **dev-only** — migration tooling for
the integration harness, and vocabulary conformance. The emitting build lists neither as a project
reference, so a production import of either fails the build rather than quietly creating an edge.

`jarvis-runtime` stays persistence-free per ADR-0059 and does not depend on this package. Nothing
here reaches back. The graph is acyclic.

Importing the package connects nowhere, creates no pool, reads no environment and starts nothing: the
caller injects a `pg` Pool and owns its lifecycle.

### 2. `event-backbone` owns the migration file; it does not own the runtime

The migration lives in the existing central `qf_jarvis` stream because there is one migration runner
and one schema, and a second stream would be a second source of truth about what is applied. Runtime
ownership belongs to the new adapter. `event-backbone`'s barrel and source are unchanged; its root
API stays 39.

### 3. The canonical event log is not the control write path

`0001_event_log.sql` carries `CHECK (source = 'quickfurno-core')`. Jarvis structurally **cannot**
append an operator command as a canonical event. And an asynchronously projected read model could not
satisfy ADR-0075's requirement that an `APPLIED` state be authoritative _before_ the write resolves.
So this is transactional operational persistence, not event sourcing.

### 4. `conversation_runtime_state` — one row, one revision

Primary key `(tenant_id, conversation_id)`, and deliberately **no** conversation-only unique index —
adding one would silently re-impose the global-uniqueness assumption ADR-0076 removed.

One revision versions `party_type`, `data_class`, `cancelled`, `subject_status`, `subject_ref`,
`human_takeover` and `ai_paused`. `observed_at` is correlation metadata and is stored as a bounded
safe reference, not narrowed to a timestamp: ADR-0059 calls it an "instant/reference", and narrowing
it here would impose a rule governance does not state.

A trigger enforces what the adapter alone could only promise: DELETE refused; identity immutable; a
new row must start at revision 0, not taken over and not paused; every UPDATE must advance the
revision by exactly one; and the revision may not exceed the safe-integer ceiling. A second writer —
a console session, a future sync path, a migration — therefore cannot move a field without
invalidating in-flight gates.

Importing an already-controlled conversation is **not** authorized by that insert rule. It needs its
own governed path.

**Identifier parity with the runtime contract.** Every identifier and reference column on both tables
is constrained to the runtime's exact-identifier grammar — and, separately, to reject the reserved
whole token `latest` in any casing. The grammar alone already excludes `*` (it is in neither
character class), but a regex accepts `latest`, and both strings mean "any of them" to the contract
ADR-0076 ratified. Without the explicit exclusion the **database would be the weaker of the two
layers**: direct SQL, which the runtime role is permitted to issue, could store an identity the
adapter declares invalid and would then refuse to read back. A storage layer that accepts what the
application will not read is a latent inconsistency, not a harmless divergence. PR #80's final review
caught this; the constraints and a direct-SQL rejection matrix now close it.

### 5. `conversation_control_command` — one table for idempotency and audit

`UNIQUE (tenant_id, command_id)` is the durable idempotency claim. The same row is the content-free
audit, recorded for `APPLIED`, `NO_CHANGE` **and** `REFUSED` — a record that only existed on success
would make refusals invisible to review. Two tables would need their own consistency proof and could
disagree.

A foreign key to the state row means a command cannot be recorded against a conversation that does
not exist: "no lazy row creation from an operator command" is enforced at the storage layer too.

CHECK constraints mirror the reducer's arithmetic **and** ADR-0075 §8a's action postconditions — a
record can be arithmetically perfect and still claim a takeover was applied while its own flags say
otherwise. `revision-mismatch` is deliberately not action-checked (staleness is decided before the
action semantics run), and `human-takeover-active` does not require `aiPaused`, because ADR-0074
accepts an external takeover-without-pause state. **These constraints validate evidence; they are
not a second decision engine.** A trigger refuses UPDATE and DELETE.

`subject_ref` appears on the state row only, never on the ledger, so an operator audit stays
retainable after subject erasure.

### 6. Trusted provisioning

`provision(...)` takes every Core-derived fact explicitly with no default, and the adapter stamps
revision 0 / not taken over / not paused. A default `partyType` or `dataClass` would be this adapter
inventing a business fact — which is exactly why an operator command may not provision.

`ALREADY_PROVISIONED` compares only the Core-derived facts and returns the **current** row.
Operational columns are expected to have moved on, and treating that as a conflict would make a
harmless retry look like a contradiction. Differing Core facts are a `provisioning-conflict` with no
mutation: **provisioning is not synchronisation.**

### 7. The transaction

READ COMMITTED, one explicit transaction, no hidden retry and no global or advisory lock:

1. look up `(tenant_id, command_id)` FIRST — an exact duplicate returns the ORIGINAL decision without
   re-deciding, because that is the crash-recovery case and re-evaluating would report
   `revision-mismatch` and lie about what happened;
2. `SELECT … FOR UPDATE` the state row — this, not the isolation level, is what serialises concurrent
   commands for one conversation, and two different conversations never block each other;
3. run the REAL reducer **exactly once** for a new command;
4. on `APPLIED`, update only `revision`, `human_takeover`, `ai_paused` and `observed_at`, guarded by
   `WHERE revision = <observed>`;
5. append the ledger row **in the same transaction**, so state and audit commit together.

`SERIALIZABLE` was rejected: it would add a retry obligation this adapter deliberately does not have.
A control command carries an operator's intent at an exact revision, and silently re-running it is
how one intent becomes two effects.

**The duplicate race.** If the ledger insert finds the identity already claimed, the whole
transaction rolls back — including any `APPLIED` state update — and reconciliation then reads the row
that won: an exact match returns the original decision, a different command is a `command-conflict`.
Committing the candidate first and reconciling afterwards would apply one command twice.

The rollback is requested with a private sentinel thrown from inside the transaction callback, which
forces a rule on the transaction helper: **it classifies the failures it owns — connecting, beginning
and committing — and rethrows whatever the callback threw as the original value.** The public adapter
method is the single classification boundary, and it recognises the sentinel _before_ classifying.

That ordering is not a detail. Classifying inside the helper turns an ordinary, correct duplicate
race into an invented `database-unavailable` and makes the reconciliation branch above unreachable —
which is exactly what the first implementation of this ADR did, and what PR #80's final review
caught. A `Promise.all` test cannot be relied on to find it: the scheduler is free to let one caller
finish before the other issues its first ledger lookup, in which case the loser replays through the
ordinary duplicate branch and never reaches the losing insert. The regression test therefore holds
both sessions at a rendezvous immediately after their first `SELECT_COMMAND`, so both provably
observed "no such command" before either could lock the state row.

### 8. Errors

Seven bounded codes with fixed messages. A `pg` error carries the failing SQL, the constraint, the
column, the parameter values and often the host and user — and this adapter handles operator
identities and conversation ids. So the driver error is **classified by SQLSTATE and then discarded**:
`08*`/`53*`/`57P0*`/`40001`/`40P01` → `database-unavailable`; `42P01`/`42703`/`42883` →
`schema-incompatible`; any other server rejection → `repository-invariant`. Nothing from the driver
reaches a message.

Every row is re-canonicalized before it becomes a decision. "The CHECK constraints prevent that" is a
claim about a schema this process did not verify it is connected to.

`classifyDatabaseError` is deliberately **not** a universal classifier for internal control flow. It
preserves an adapter error, reduces a SQLSTATE-bearing driver error, and normalizes an unknown
database failure — and the adapter's own sentinel is handled before it is ever consulted.

**The supplied command is validated and rebuilt before any SQL runs.** `ConversationControlCommand`
is a structural interface, so a materialized value is not evidence: an untyped caller or a
deserialized body arrives as a plain object TypeScript never inspected. The adapter therefore
requires the exact own-key set (an unknown key is a payload smuggled beside a content-free contract),
requires `controlVersion` 1, checks the action against the closed vocabulary and `issuedAt` against
the canonical UTC millisecond form, and then rebuilds the command through the **public**
`createConversationControlCommand`, whose result — not the caller's object — is what the transaction
uses. Anything it rejects becomes `invalid-input` with no connection requested; the constructor's own
error is not propagated, because this package's error vocabulary is closed.

Relying on the pure reducer for this would be too late: it runs at step 3, after the ledger lookup
and the row lock have already reached the database.

### 9. Least privilege

Both tables revoked from `PUBLIC` and from `anon`/`authenticated`/`service_role` where present. The
conditional `qf_jarvis_runtime` grant is `SELECT, INSERT` on the state plus **column-level**
`UPDATE (revision, human_takeover, ai_paused, observed_at)` — never a Core-derived column — and
`SELECT, INSERT` on the ledger. No DELETE, no TRUNCATE, on either.

So the future Core-synchronization path is representable in the schema (same aggregate, same
revision) but **not performable** by the current runtime role. The capability does not exist by
accident.

### 10. What is deliberately absent

**No `readOperationsProjection`.** No governed writer exists for `conversationState`,
`lastActivityAt`, `escalationStatus`, `followUpStatus`, `deliveryStatePlaceholder` or `auditRef`
(ADR-0076 §9), so the adapter does not implement the capability and the composition's
`operations-unavailable` remains the honest answer. Fabricating six tokens to light up an interface
is what this phase has repeatedly refused to do.

**No Core synchronization method.** **No** consent, opt-out, suppression, approval,
communication-authorization, execution or business table. **No** operator API, authentication, RBAC or
UI. **No** P09 transport.

**This package is wired into nothing.** QFJ-P08-B3 composes it, and owns any provenance change;
`DEFAULT_RUNTIME_REF` stays `qfj.jarvis-runtime.p08b1` here.

## Rejected alternatives

- **Event-sourcing operator control.** Structurally blocked by the Core-only `source` CHECK, and an
  async projection cannot make an `APPLIED` state authoritative before the write resolves.
- **`event-backbone` as runtime owner.** Conflates the canonical Core event log with operational
  runtime state.
- **`pg` inside `jarvis-runtime`.** ADR-0059 made the composition root persistence-free deliberately.
- **Separate idempotency and audit tables.** Two records of one decision that could disagree.
- **`SERIALIZABLE` or an advisory lock.** A retry obligation, or a throughput ceiling, for no safety
  the row lock does not already provide.
- **Committing the candidate and reconciling after a duplicate race.** Applies one command twice.
- **Re-running the reducer for an exact duplicate.** Would answer `revision-mismatch` and misreport
  what happened.
- **Resetting control state on re-provisioning.** Would let a retry silently undo a takeover.
- **Storing a canonical command digest instead of discrete columns.** A digest cannot be read by a
  human reviewing an audit row.
- **Surfacing `pg` errors.** A schema-and-identity disclosure wearing a stack trace.
- **Classifying the transaction callback's error inside the transaction helper.** Convenient, and it
  destroys the adapter's own control flow — see §7.
- **Leaving `latest` to the application layer alone.** The database would be the weaker of the two.
- **Trusting a materialized command because its TypeScript type says so.** A structural interface is
  not evidence, and the reducer's revalidation happens after SQL has already run.

## Consequences

A human takeover now survives a restart, and cross-process compare-and-set is enforced by the
database rather than by one process's memory. State and audit commit atomically; an exact duplicate
replays the original decision even after the revision advanced; a conflicting duplicate has zero
effect.

Migration inventory becomes `0001`–`0008`. `0008` checksum:
`e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10`. Migrations `0001`–`0007` are
byte-identical, asserted in-suite against the locked values.

The migration ledger was **stale at 0006** and is corrected here: `0007` (QFJ-P03.09) is recorded with
its real checksum, and `0008` added. **Managed PostgreSQL still carries `0001` only; `0002`–`0008`
remain unapplied and not deployed.** No managed access of any kind was performed.

Every existing package-root runtime API count is unchanged. The new package is locked at **3** root
runtime symbols and 4 type exports.

## Phase status

**QFJ-P08-B2. Not wired into any application.** Next is **QFJ-P08-B3**: compose the adapter behind
`jarvis-runtime`'s writable capability, add the startup schema gate, and prove durable takeover
end-to-end through `processInbound`. Still no operator API, no authentication, no UI, no consent, no
approval and no P09.

**Managed PostgreSQL remains a separate paused lane. Production rollout remains OFF.**

## Non-goals

No managed migration or managed access · no deployment · no Jarvis-runtime wiring · no operations
projection producer · no Core-derived synchronization · no operator HTTP/API/UI/auth · no consent or
opt-out state · no approval runtime · no P09 transport · no WhatsApp/n8n · no live Core · no provider
call · no persistent memory · no dataset or training · no send, deliver, execute or authorize path.

## Change-control rule

Migration 0008 is immutable after merge. The state key stays `(tenant_id, conversation_id)` and no
conversation-only unique index may be added. One revision keeps versioning the whole safe state, and
every UPDATE keeps advancing it by exactly one. The reducer stays the only thing that decides —
moving semantics into SQL, or re-running the reducer for an exact duplicate, requires a superseding
ADR. The ledger stays append-only and content-free, with no `subject_ref` and no free text. The
runtime role never gains UPDATE on a Core-derived column, DELETE, or TRUNCATE without its own
governed grant. Driver errors are never surfaced. And this package never becomes business, consent,
approval or Core authority.
