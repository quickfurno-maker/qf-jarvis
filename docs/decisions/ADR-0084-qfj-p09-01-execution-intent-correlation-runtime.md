# ADR-0084 — QFJ-P09.01 Execution Intent Correlation Runtime

**Status:** Accepted — QFJ-P09.01 (the Jarvis-side correlation foundation; no intent issuance, no dispatch, no n8n, no provider, no persistence, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0005](./ADR-0005-human-and-policy-approval.md) · [ADR-0007](./ADR-0007-approval-request-submission-model.md) · [ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md) · [ADR-0082](./ADR-0082-qfj-p08-core-approval-submission-and-authenticated-operator-boundary.md) · [ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md)

## Context

Baseline: `main` at `85aa4836e374f2a96bdd8bd74d5c5c5129111a38`, the merge of PR #86 (the communication
authorization correlation runtime), which contains reviewed head `6d5c7385`. Collision checks on that
baseline: no `packages/execution-intent-runtime`, no reference to
`@qf-jarvis/execution-intent-runtime`, `ADR-0084` unclaimed, zero open PRs; migrations `0001`–`0009`
with no `0010`, `0009` at `e834bc3c…`.

ADR-0083 §12 left P09 an explicit instruction rather than a suggestion:

> P09 MUST NOT construct or validate an execution intent by reading only
> `CommunicationAuthorizationObservation.approvalCorrelation.proposedActionId`. Exact execution
> binding must begin from a Core-issued `ExecutionIntentV1`.

That lock exists because `CommunicationAuthorizationV1` names an approval **decision** and carries no
`approvedActionId`, so nothing in P08 could establish _which approved action_ a communication
corresponds to. `ExecutionIntentV1` carries exactly the missing fields — `recommendationId`,
`approvalDecisionId`, `approvedActionId`, `actionType`, `actionContractVersion`, `parameters`.

This slice implements the lock, and it comes first in P09 because everything after it — dispatch
envelopes, an n8n bridge, execution results — depends on knowing that an intent genuinely reproduces
the action a human approved.

## Decision

### 1. A pure correlation runtime that issues nothing

`@qf-jarvis/execution-intent-runtime`: **three** root runtime symbols, **one** synchronous method, no
configuration. Given Core's `ExecutionIntentV1` and raw approval evidence, it proves the intent names
and exactly reproduces the approved proposed action, and returns a deeply frozen observation.

**Only QuickFurno Core issues execution intents. Only n8n is the named executor.** Nothing here
creates an intent, dispatches, sends, executes, retries, persists, emits, resolves a recipient or a
phone number, chooses a provider, holds a credential, or reaches n8n, Meta or any provider. Its
production dependencies are `@qf-jarvis/contracts` and `@qf-jarvis/approval-runtime` — not even
`zod`.

### 2. The intent's own schema proves issuer, executor and semantics

`executionIntentV1Schema` establishes structurally that `issuer` is `quickfurno-core`, `executor` is
`n8n`, `deliverySemantics` is the literal `at-most-once`, an idempotency key is present and
well-formed, `issuedAt < expiresAt`, and the parameters are governed — carrying no contact detail, no
credential and no smuggled permission to retry.

None of that is restated in this package. Re-implementing it would create a second definition of a
contract `@qf-jarvis/contracts` already owns, free to drift from it. A failure is `intent-invalid`,
and the artifact is never repaired.

### 3. Approval evidence is re-proved, never asserted

Raw evidence goes through the **public** `createApprovalRuntime().validateDecision`, which re-derives
the recommendation, the approval request, the selected action and a **recomputed** action fingerprint
before correlating Core's decision against all of them. A caller-supplied
`ApprovalDecisionCorrelation` is refused: a correlation is a conclusion, and accepting one would let a
caller assert the very thing this runtime exists to prove. So is any boolean — `approved`,
`authorized`, `canExecute`, `consentValid`. Upstream failure is normalized to `approval-invalid`, with
no detail propagated.

**The per-action verdict is load-bearing.** `approvalCorrelation.actionDecision.decision` must be
`approved`, never `decision.outcome`. Under partial approval a decision may be `approved` overall
because a _different_ action was, and an intent validated on the overall outcome would execute an
action a human refused. That is `approval-not-approved`, its own code.

### 4. Exact identity binding — the four equalities

`intent.recommendationId === approvalCorrelation.recommendationId`;
`intent.approvalDecisionId === approvalCorrelation.decision.decisionId`;
`intent.approvedActionId === approvalCorrelation.proposedActionId`;
`intent.correlationId === approvalCorrelation.decision.correlationId`.

Any mismatch is `binding-mismatch`. **There is no fallback.** Nothing matches on action type,
parameters, template, purpose code, channel or summary when the ids disagree — a spec proves that an
intent naming a _different_ recommendation's action with byte-identical content is still refused.
This is where P09 gains the exact action identity P08 could not express.

### 5. Exact action content binding

From the re-proved recommendation, the action whose `actionId` equals `intent.approvedActionId` must
have the same `actionType`, the same `actionContractVersion`, and **structurally identical**
`parameters`. Otherwise `action-mismatch`.

Structural, not `JSON.stringify`. That comparison preserves insertion order, so two governed
parameter objects carrying identical facts would compare unequal for no reason a human could see — a
false negative that blocks a legitimate effect. So a small pure comparator is used: primitives by
`===`, arrays by same length **and same order**, objects by same key set with key order irrelevant,
recursively.

There is deliberately **no subset match, no superset tolerance, no default insertion, no coercion, no
trimming and no case normalization**. Every one of those would let an intent run with parameters a
human never approved. "Without reinterpretation" means exact content.

`ProposedAction.summary` is not in `ExecutionIntentV1`, and no summary comparison was invented — the
approval runtime's recomputed fingerprint already re-proves the source action's governed content.

### 6. Temporal relationships, and no clock

Three rules, all _between artifacts_, through the contract's comparators and never string order:

- `decision.decidedAt <= intent.issuedAt` — an intent cannot predate the decision it cites;
- `intent.issuedAt < recommendation.expiresAt` — a stale recommendation's action is not one Core may
  still start;
- `intent.expiresAt <= recommendation.expiresAt` — an intent must not **outlive** the recommendation
  whose approved action it runs. Equal is allowed; expiring later is a window in which the reasoning
  has lapsed and the permission has not.

Failure is `timing-mismatch`.

**This does not prove the intent is fresh NOW, and must never be read as doing so.** The observation
is a statement about provenance that is true whenever it is evaluated. Dispatch-time freshness and
authenticity belong to a later execution-side check against a trusted execution-side clock, and there
is no `isFresh`, `canExecute`, `currentlyValid` or `freshUntil` anywhere in the result.

### 7. Idempotency is observed, never managed

`ExecutionIntentV1` carries `idempotencyKey` and `at-most-once` semantics, and this package **observes
both and derives nothing**. It generates no key, hashes no replacement, reserves none, consumes none,
keeps no used-key set, creates no database and makes no duplicate-prevention claim. Validating the
same intent twice is not "using" anything — a pure function has no memory to consume. One-effect
semantics must be enforced by the execution side, which is the only place they can be.

No `isIdempotent`, `canRetry`, `retryAllowed`, `used` or `consumed`.

### 8. Communication authorization is deliberately NOT an input

`CommunicationAuthorizationObservation` is recipient and channel **eligibility** evidence; this
package proves **action authorization provenance**. They are different questions, the communication
authorization contract carries no `approvedActionId`, and joining them here would reopen exactly the
heuristic ADR-0083 §11 closed. A containment spec asserts the package neither imports nor names it,
and infers nothing from a template, purpose code, channel or recipient.

For a communication action, later Core and execution-side integration must ensure **both**: Core's
approval and action authorization (what this proves), **and** current communication eligibility with
execution-time consent revalidation (what Core and the communications runtime do). Neither
substitutes for the other. This package must never claim `communicationAllowed`, `consentValid` or
`canSend`.

### 9. The observation confers nothing

Exactly `{ intent, approvalCorrelation, approvedAction }`, deeply frozen. It says _"this Core intent
faithfully names this approved action."_ It does not say _"execute it now."_

Absent, and unable to be added without reopening this ADR: `canExecute`, `canSend`, `isAuthorized`,
`approved`, `authorized`, `valid`, `fresh`, `isFresh`, `consentValid`, `communicationAllowed`,
`retryAllowed`, `status`, `pending`, `executed`, `delivered`.

### 10. No contract change

`ExecutionIntentV1` is reused unchanged. No `ExecutionIntentV2`; no recipient, phone number, provider,
credential, `communicationRequestId`, communication-authorization id, consent snapshot or generic
subject field added. The intent is linked to the governed recommendation and action through
`recommendationId` + `approvedActionId` + exact action content, and recipient resolution and live
dispatch semantics belong to Core and the later execution runtime. If a future n8n bridge needs more
wire-level information, that is a separate, versioned protocol decision **after** this correlation
foundation.

### 11. One snapshot of the approval evidence, taken before anything reads it

Approval evidence is **caller-controlled and may be dynamic**. It is also loosely typed where it
crosses into the approval runtime — `approvalDecisionValidationInputSchema` declares
`source: z.unknown()` on purpose, so that the runtime validates it internally rather than
re-declaring a contract `@qf-jarvis/contracts` owns. Correct, and it has a consequence: a caller may
pass an object whose `recommendation` is an **accessor**, and an accessor can answer differently each
time it is asked.

Validation needs the recommendation twice — once for the re-proof, once to recover the approved
action and the expiry bounds. Reading the caller's value twice therefore opened a
time-of-check/time-of-use gap:

- the **first** read returns the original content, whose fingerprint the approval request genuinely
  covers, so the re-proof succeeds honestly;
- the **second** read returns a different, individually schema-valid recommendation carrying the same
  `recommendationId`, `approvedActionId` and `correlationId` but different action parameters, or a
  later `expiresAt`.

The intent would then be compared against content nobody approved, or measured against a window that
had never been granted — defeating the anti-substitution guarantee this package exists to provide.

**So exactly one detached snapshot is taken before the re-proof, and the same snapshot feeds both
phases.** After it is taken, no production path reads the caller's raw evidence again; an accessor
is invoked exactly once, by the clone. A containment spec pins this structurally: `input['approval']`
appears in exactly one place in the runtime, that place is the snapshot call, and both
`proveApproval` and the recommendation recovery consume `approvalEvidence`.

The mechanism is `structuredClone`. It detaches every nested object, so no reference into the
caller's graph survives and a later mutation of their object cannot change what was validated, and it
resolves accessors as it walks, so the result is plain data with no behaviour left in it.
`JSON.parse(JSON.stringify(x))` is deliberately **not** used: it honours a `toJSON` hook, so a
hostile object could still choose what the snapshot sees, and it silently drops `undefined` members
and coerces others. A shallow spread is worse — one level copied, every nested object shared. Any
clone failure normalizes to `approval-invalid`, with the thrown value discarded rather than
inspected.

**Snapshotting confers no authority and performs no I/O.** A snapshot of evidence is still evidence;
it is validated afterwards exactly as before, by the same public approval runtime and the same
governed schemas. No contract change was required, and none was made.

Two adversarial regressions hold this: one substitutes the approved action's parameters and one
substitutes a later recommendation expiry, each visible only to a second read. Both **succeeded**
against the pre-fix implementation and now fail closed — `action-mismatch` and `timing-mismatch`
respectively — with the accessor proved to have been read exactly once.

## Rejected alternatives

- **Letting Jarvis construct an `ExecutionIntentV1`.** Core issues intents from its own recorded
  authorization; a builder here is that authority arriving on the wrong side of the boundary.
- **Deriving the approved action from a communication authorization.** The exact heuristic ADR-0083
  §11 forbids, and §12 named this package as the alternative.
- **Matching on action content when the ids disagree.** A "helpful" fallback that would execute
  something nobody approved, confidently.
- **Reading `decision.outcome` instead of the per-action verdict.** Breaks partial approval.
- **`JSON.stringify(a) === JSON.stringify(b)` for parameters.** Insertion-order sensitive; a false
  negative blocks a legitimate effect, and a `toJSON` hook makes it worse.
- **Tolerating a parameter subset, superset, default or coercion.** Each lets an intent run with
  something a human did not approve.
- **Reading a clock to decide freshness.** This package has no trusted clock and no business having
  one; a `fresh` flag computed here would be a claim about a _now_ it cannot see.
- **Generating, reserving or deduplicating idempotency keys.** One-effect semantics belong where the
  effect happens.
- **Accepting a caller-supplied correlation or a boolean.** The caller would be the authority.
- **Adding a recipient, provider or communication id to `ExecutionIntentV1`.** Possibly a future
  need; a versioned contract decision either way, and not this slice's to take.
- **Reading the caller's approval evidence twice.** A time-of-check/time-of-use gap an accessor can
  walk straight through — see §11.
- **`JSON.parse(JSON.stringify(evidence))` as the snapshot.** Honours `toJSON`, so the hostile object
  still chooses what the snapshot sees; also drops `undefined` and coerces.
- **A shallow spread as the snapshot.** Copies one level and leaves every nested object shared, which
  is the reference the caller would mutate.

## Consequences

Jarvis can now independently verify that a Core-issued execution intent faithfully names and
reproduces a re-proved, approved proposed action — the exact binding P08 deliberately could not
express, and the precondition for any bounded P09 work that follows.

The new package root is locked at **3** runtime symbols and 5 types. Every existing package-root count
is unchanged, `apps/api` stays **0**, and **no package or application imports this one** — a leaf with
no consumer, because there is nothing to consume it yet.

**No migration was created or modified.** Migrations remain `0001`–`0009` with `0009` at
`e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6`, and there is no `0010`. Managed
PostgreSQL was not accessed. Production rollout remains **OFF**.

**QuickFurno Core Sync Gate: passed.** Core still owns authoritative business truth, approval
decisions, execution-intent issuance, consent and eligibility, and authoritative execution history,
and still revalidates current truth before execution. n8n remains the executor and authorizes
nothing. Meta and providers deliver and decide nothing. No live Core, n8n or provider protocol was
invented, and the existing QuickFurno Meta WhatsApp and n8n infrastructure is untouched by this PR.

**It still cannot execute anything.** Dispatch-time freshness, authenticity and signature validation
remain pending; a communication action still requires execution-time consent revalidation by Core and
the communications runtime; and the n8n bridge does not exist. P09 remains incomplete.

Compatibility with the locked QuickFurno Mini Brain architecture is preserved: a Mini Brain may
recommend an action, choose a governed template and produce a powerless communication request, and
may never create an `ExecutionIntentV1`, choose `approvedActionId` for Core, sign a dispatch, call
n8n or Meta, hold a provider credential, or turn high confidence into permission. No Mini Brain code
is in this PR.

## Non-goals

No execution-intent issuance. No dispatch, send, execute or retry. No n8n bridge, workflow, client or
protocol. No Meta, WhatsApp or provider client. No provider credential. No recipient or phone-number
resolution. No transport, persistence, cache or event emission. No idempotency-key generation,
reservation, consumption or deduplication. No dispatch-time freshness or signature validation. No
communication eligibility or consent evaluation. No contract change and no `ExecutionIntentV2`. No
migration and no `0010`. No managed database access or deployment. No Mini Brain implementation.

## Change-control rule

The absence of intent issuance, the four exact identity equalities with no content fallback, the
exact-content parameter comparison, the per-action verdict, the artifact-relative temporal rules with
no clock, the observe-only treatment of idempotency, the exclusion of communication
authorization as an input, and the single-snapshot rule of §11 are the contract this slice
establishes. Adding a builder, a permission or freshness field, a content-based fallback, a parameter
tolerance of any kind, key bookkeeping, a communication-eligibility inference, or a second read of
the caller's raw approval evidence each reopens a failure this ADR closes, and is a governed change
requiring its own decision.
