# ADR-0082 — QFJ-P08 Core Approval Submission and the Authenticated Operator Boundary

**Status:** Accepted — QFJ-P08 (the Jarvis-side client protocol and the internal operator service; no live Core endpoint, no HTTP, no UI, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0005](./ADR-0005-human-and-policy-approval.md) · [ADR-0007](./ADR-0007-approval-request-submission-model.md) · [ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md) · [ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md) · [ADR-0081](./ADR-0081-qfj-p08-durable-approval-queue-and-audit.md)

## Context

Baseline: `main` at `fa99d40f77ca3b0ea24f0eb303e78211bd7a98d4`, the merge of PR #84 (the durable
approval queue and audit), which contains reviewed head `4189b0f`. Collision checks on that baseline:
no `packages/approval-core-adapter`, no reference to `@qf-jarvis/approval-core-adapter`, `ADR-0082`
unclaimed, zero open PRs; migrations `0001`–`0009` with no `0010`, `0009` at `e834bc3c…`.

The repository can now generate a governed `RecommendationV1`, build a powerless
`ApprovalRequestV1`, validate and correlate an `ApprovalDecisionV1`, and store all three durably with
at most one active ask per action. What it could not do was let a human **act** on one of those asks.

And a click has nowhere to go. `ApprovalRequestV1` deliberately carries no approve/reject field —
it is a question, not a form — and `ApprovalDecisionV1` is Core's answer, which Jarvis must never
author. So the missing artifact is a **third** one: a powerless statement of human intent that exists
only in transit.

## Decision

### 1. Operator intent is a separate, powerless envelope

A new package, `@qf-jarvis/approval-core-adapter`, with **three** root runtime symbols and one
method. `ApprovalOperatorAction` is `APPROVE | REJECT | REQUEST_CHANGES` — three human intents,
closed. There is no `AUTO_APPROVE`, `SEND`, `EXECUTE`, `AUTHORIZE`, `FORCE` or `BYPASS`, because each
would name a capability this package must not have, and a value that cannot be constructed cannot be
smuggled through a serializer.

**Jarvis asks. QuickFurno Core decides.** ADR-0007 is explicit that a button click inside Jarvis is a
_request_ for authorization, and Core re-validates identity, authority, current state, risk policy,
expiry and eligibility against its own truth. This adapter holds no approved state and has no field
in which one could be expressed.

### 2. The proof is a holder, not a claim

`ApprovalCoreAuthorizationProof` exposes exactly one method, `use(operation)`. The secret is a
closure variable: there is no property, no getter, no symbol-keyed field, and `JSON.stringify` of a
holder yields `{}`. The only thing a caller can do is hand it to a transport; the only thing a
transport can do is open it for the duration of one send.

That shape exists because **Jarvis must forward a proof, not an assertion.** "Trust me, this is the
founder" is precisely what Core must not accept — Core validating the proof independently is what
makes a compromised Jarvis unable to approve itself (ADR-0002). This ADR deliberately does **not**
define what the proof string means: not a JWT, not a Supabase session, not a bearer token, not a
signature. That is a negotiation with a Core protocol that does not exist yet.

### 3. The transport is injected, and there is no endpoint

`ApprovalCoreTransport` is an interface and nothing else. No URL, no header, no method, no path, no
retry policy, no timeout, no client, no default implementation — the only implementation in the
repository is a deterministic test fake, excluded from the emitting build. A transport that could be
constructed here is a network call that could happen here.

### 4. The wire command has six fields, and the credential is not one of them

`protocol` (`qfj.approval-core-submission.v1`), `idempotencyKey`, `approvalRequest`, `operator`,
`operatorAction`, `requestedAt`. Validated by a private `strictObject` on the way out, so a seventh
key is a refusal rather than something Core has to ignore.

The authorization proof travels **beside** the command, not in it. A command is a string: it may be
hashed, logged by a transport, captured in a test, or retried by an operator, and a credential inside
it would go everywhere the string goes. Also absent, each for its own reason: no recipient or
address (this is an approval, not a delivery); no execution intent (Core creates those from its own
recorded decision); no consent or opt-out flag (a separate contract, and collapsing it here is how an
approval quietly becomes permission to contact someone).

### 5. The idempotency key names an intent — and claims nothing more

SHA-256 over the domain separator `qf-jarvis.approval-core-submission.v1\n` followed by canonical
JSON (keys sorted at every depth) of `approvalRequestId`, `recommendationId`, `proposedActionId`,
`actionFingerprint`, `operator`, `operatorAction`.

`requestedAt` is deliberately **excluded**: a human who clicks, loses the connection, and clicks again
ten seconds later is expressing the same intent, and including the instant would make every retry a
new key — the exact deduplication the key exists for. The proof is **excluded** too: a key is not a
secret and must not become one, and re-authenticating the same person must not rename an unchanged
intent.

**This is not an exactly-once guarantee, and must not be read as one.** It is a stable, deterministic
name. Whether two sends bearing the same name become one effect is entirely Core's business, and Core
has not adopted this protocol. A pinned golden vector guards the digest, because every other test
compares one key against another and would keep passing if the whole scheme drifted.

### 6. Exactly one send, and no retry

One `transport.send` per `submit`, on every path. A retry of an approval submission is a second
statement of human intent, and the actor who decides to make one is the caller, in the open — not a
hidden loop inside a transport adapter.

### 7. Core's response is validated, never repaired

JSON parse, then `approvalDecisionV1Schema`, then correlation through the **public**
`createApprovalRuntime().validateDecision` against the same source and request. A response that is
nearly a decision is not a decision: filling in a missing field would be Jarvis authoring part of an
authorization. Malformed body or contract violation is `core-invalid-response`; a valid decision that
does not describe this ask is `core-decision-mismatch`.

Faithfulness of the ask itself is proved by **rebuilding** it through the same public runtime and
comparing by deep equality — the technique ADR-0081 established, used here for the same reason: the
durable store and the Core transport must agree about what a faithful ask is, and the way to
guarantee that is for both to ask the runtime rather than for both to know the rules.

### 8. A negative intent can never come back as an approval

Checked against the **selected action's** verdict, never the overall outcome. Under partial approval
`decision.outcome` may be `approved` because a _different_ action was approved while this one was
rejected — checking the outcome would turn that ordinary case into a spurious mismatch and block a
legitimate refusal.

- `REJECT` / `REQUEST_CHANGES` → the selected action must come back `rejected`, or it fails closed.
- `APPROVE` → the selected action may come back **either way**. Core refusing is a designed,
  expected, load-bearing outcome, returned as an ordinary result. _A surface that cannot display "the
  founder clicked approve and Core said no" has been built wrong._

`decidedBy` is deliberately **not** compared against the operator. Core is authoritative and may
attribute a refusal to a policy rather than to the person who asked; a check demanding that the
decider be the submitter would reject exactly the refusals this architecture exists to make possible.

### 9. The application boundary: authenticated, internal, and not a server

`apps/api/src/runtime/approval-operator-service.ts`, internal — not re-exported, and the
application's root runtime API stays at **0**. No HTTP server, no framework, no route, no listener
and no authentication provider, because none of those is approved yet.

`OperatorAuthenticationPort` is an interface; the credential is typed `unknown` because this service
must not know its shape — knowing it would be the first step toward validating it locally.

**Authentication gates access; it is not authority.** Jarvis decides whether a caller may _see_ the
queue and _submit_ an intent. Whether that person may approve this action, at this risk class, in the
recommendation's current state, is Core's question. So there is no founder list, admin list, approver
role, RBAC table or authority cache anywhere, and no local store in which one could live.

Every method **authenticates first** — before input validation, and long before the queue is touched.
An unauthenticated call performs zero queue reads and zero Core sends: the durable queue records what
the business is considering doing to real clients and vendors, and "reject after fetching" would
still have fetched it. An authentication outage fails **closed**; an outage is not an admission.

### 10. No optimistic state, anywhere

ADR-0007 rejects optimistic rendering explicitly, and this service is where that rejection has to
hold. `submit` returns only `DECIDED` or `ALREADY_DECIDED`; there is no `PENDING` outcome and no row
anything writes for one. Pending is what a screen renders while a promise is outstanding.

- Core refuses → the refusal is the authoritative artifact and it is what gets stored.
- Core unreachable, or answers malformed, or contradicts the intent → **nothing is written**, and the
  ask simply remains unanswered and, if unexpired, still active.
- Already answered → the stored decision is returned and Core is contacted **zero** times. A human
  clicking `APPROVE` must not be able to re-open a settled refusal.
- Expired at the stated instant → refused before Core is contacted, because submitting a dead ask
  spends an operator's proof on a question with no valid answer.

### 11. Concurrency is resolved by Core's record, not by a local lock

If another process records a different authoritative decision while this submission is in flight, the
queue reports `request-already-decided` and the **stored artifact wins** — not merged, not preferred
against, not overwritten. Whichever Core decision became durable is the one that happened. A local
`approved` flag or a mutex used as authority would be exactly the second source of truth ADR-0001
forbids.

## Rejected alternatives

- **Adding an approve/reject field to `ApprovalRequestV1`.** The request is a question. A form field
  on it is a place a verdict could be written by whoever holds the request.
- **Letting Jarvis record the decision and inform Core.** Destroys the property that makes the
  architecture defensible, and creates a second source of truth for the most safety-critical record
  in the system (ADR-0001, ADR-0007).
- **Optimistic rendering, or any local `pending`/`approved` state.** The most likely thing to be built
  by accident, by a competent engineer following ordinary good practice. Here Core disagreeing is not
  an edge case — it is designed.
- **A local role, founder or approver list to decide who may click.** That is authorization, and it
  belongs on the other side of a trust boundary from the system seeking it.
- **Sending an identity assertion instead of a proof.** "Trust me, this is the founder" is what a
  compromised Jarvis would also say.
- **Putting the proof in the command body.** The command is a string that gets hashed, logged and
  retried.
- **Including `requestedAt` in the idempotency key.** Makes every retry of one human intent a new
  intent.
- **Claiming exactly-once.** A safety claim backed by a Core that has not adopted the protocol.
- **An automatic retry on `core-unavailable`.** A second statement of human intent, made by a loop.
- **Requiring `decidedBy` to equal the operator.** Would reject a policy-attributed refusal — the
  exact outcome Core's independent validation exists to produce.
- **Checking `decision.outcome` for a negative intent.** Breaks partial approval, and blocks a
  legitimate rejection of one action inside an overall-approved recommendation.
- **Defining the URL, headers or credential format now.** That is a negotiation with Core, and
  choosing unilaterally would make Jarvis's guess the protocol.

## Consequences

An authenticated human can now act on a queued ask, and the answer that comes back is Core's. The new
package root is locked at **3** runtime symbols and 9 types; the wire schema, the canonical
serializer, the digest and the faithfulness proof stay internal, because a proposal something else
can import is a proposal already adopted by accident.

`apps/api` gains three production edges (`approval-core-adapter`, `postgres-approval-queue`,
`contracts`) and two test-only ones, and its root runtime API stays **0**. The queue and the adapter
are named there as **types only** — both are injected, so the compiler erases both imports. The
"exactly one production module reaches a database" lock becomes an exact set of two, with the second
additionally required to import the queue as `import type`.

Every existing package-root count is unchanged. Migrations remain `0001`–`0009` with `0009` at
`e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6`; **no migration was created or
modified, and there is no `0010`**. Managed PostgreSQL was not accessed and still carries `0001`
only; `0002`–`0009` remain unapplied. Production rollout remains **OFF**.

**The wire protocol is PROPOSED, not adopted.** Nothing on the Core side exists, and this PR creates
none of it: no endpoint, no table, no RBAC, no policy engine, no decision emitter. Making the round
trip real is Core-integration work under its own authorization.

**Canonical QFJ-P08 remains incomplete.** The next mandatory control is **consent and opt-out state
plus the communication-authorization boundary**, and it comes before any P09 execution work. A
correlated approval still confers nothing: an approval is not permission to contact anyone, and
founder approval does not override an opt-out, a do-not-contact flag, quiet hours, recipient validity
or attempt limits.

## Non-goals

No live QuickFurno Core endpoint, client, URL, header or credential format. No Core-side
authorization logic, table, policy or event emitter. No HTTP server, route, framework, listener, UI
or authentication provider. No local RBAC or user database. No consent, opt-out or
`CommunicationAuthorizationV1` evaluation. No `ExecutionIntentV1`, provider selection or recipient
resolution. No canonical event emitted by Jarvis. No `JarvisRuntime` wiring. No migration and no
`0010`. No managed database access or deployment.

## Change-control rule

The powerlessness of operator intent, the opaque proof holder, the single send, the negative-intent
safety rule, and the absence of any local approval state are the contract this slice establishes.
Adding a fourth operator action, exposing the proof as a property, putting it in the command body,
adding a retry, comparing `decision.outcome` instead of the selected action's verdict, introducing a
local role list, or persisting any `pending`/`approved` field each reopens a failure this ADR closes,
and is a governed change requiring its own decision.
