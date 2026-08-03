# ADR-0083 — QFJ-P08 Communication Authorization Correlation Runtime

**Status:** Accepted — QFJ-P08 (the Jarvis-side correlation control; no Core call, no transport, no persistence, no execution, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0005](./ADR-0005-human-and-policy-approval.md) · [ADR-0007](./ADR-0007-approval-request-submission-model.md) · [ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md) · [ADR-0081](./ADR-0081-qfj-p08-durable-approval-queue-and-audit.md) · [ADR-0082](./ADR-0082-qfj-p08-core-approval-submission-and-authenticated-operator-boundary.md)

## Context

Baseline: `main` at `fcc9d8be40a191969153dafbdaac70b2c58e92a5`, the merge of PR #85 (the Core
approval submission and authenticated operator boundary), which contains reviewed head `0b9d54f`.
Collision checks on that baseline: no `packages/communication-authorization-runtime`, no reference to
`@qf-jarvis/communication-authorization-runtime`, `ADR-0083` unclaimed, zero open PRs; migrations
`0001`–`0009` with no `0010`, `0009` at `e834bc3c…`.

QFJ-P08 can now produce a governed recommendation, ask for approval, correlate Core's decision, store
it durably, and let an authenticated human submit an intent about it. Every one of those answers the
same question: **did somebody with authority agree to this action?**

There is a second question, and it is the one that keeps a business out of court: **may this specific
recipient be contacted at all?** Consent evidence, preferences, suppressions, STOP/START, do-not-
contact, approved purpose, attempt limits, quiet hours, channel eligibility. That question belongs
entirely to the QuickFurno Communication Core, and it has a different answer from the first one often
enough that the architecture keeps them in two separate contracts on purpose.

Both contracts already exist and are unchanged by this slice. What was missing was the Jarvis-side
control that proves an authorization actually answers a request — and that refuses to let the two
"yes"es be confused for one another.

## Decision

### 1. A pure correlation runtime, and nothing else

`@qf-jarvis/communication-authorization-runtime`: **three** root runtime symbols, **one**
synchronous method, no configuration. Given a `CommunicationRequestV1`, the
`CommunicationAuthorizationV1` Core returned, and optional approval evidence, it proves the artifacts
describe each other and returns a frozen observation.

It asks Core nothing, sends nothing, persists nothing, emits nothing, reads no clock, opens no
socket, and depends only on `@qf-jarvis/contracts` and `@qf-jarvis/approval-runtime` — not even on
`zod`, because every schema it needs is one the contracts package already owns.

### 2. QuickFurno Core is the sole consent, STOP and suppression authority

Unchanged by this slice, and enforced by absence rather than asserted in prose. There is no consent
flag, opt-in/opt-out record, STOP or START state, do-not-contact marker, suppression list,
eligibility cache, attempt counter or contact history anywhere in this package, and a containment
scan targets each of those identifiers directly.

_"Jarvis must not create parallel consent, preference, suppression, STOP/START, or delivery state.
Not as a flag, not as a list, not as a cache, and not as a 'courtesy' copy that a later feature will
inevitably start trusting"_ (communication-model.md). The courtesy copy is the failure mode: the
feature that eventually trusts it contacts somebody who asked never to be contacted.

Unknown or stale consent is not permission. A missing answer is a no.

### 3. Both contracts are REUSED, unchanged

`CommunicationRequestV1` and `CommunicationAuthorizationV1` are parsed with their own governed
schemas and never repaired. No field was added to either — in particular no `validUntil` and no
consent snapshot, whose absence is deliberate: _"a consent snapshot with a future expiry is precisely
the stale permission that lets a withdrawn consent be ignored"_ (communication-authorization.ts). A
containment test asserts both contracts still lack them.

A non-Core `issuer` fails schema parsing as `authorization-invalid`. A Jarvis-issued artifact is not a
Core artifact with a wrong label, and normalizing one into the other is how a system authorizes
itself.

### 4. Correlation, and time

The authorization must name the same `communicationId`, `communicationRequestId` and `correlationId`
as the request. Anything else is `binding-mismatch`.

An answer cannot predate its question: `request.createdAt <= authorization.decidedAt`, through the
contract's comparators and never by comparing RFC 3339 strings — the grammar admits fractional
seconds, and `…:00.5Z` sorts _before_ `…:00Z` lexicographically while being after it in time.

**The expiry rule is deliberately asymmetric.** An `authorized` outcome must be decided strictly
before `request.expiresAt`: nothing may turn a dead request into a live one. A `rejected` outcome at
or after expiry is **accepted**, because a late refusal creates no permission and hides nothing —
refusing to observe one would make the safest possible answer the one Jarvis could not write down.

### 5. Approval evidence is optional, because a refusal may precede any human

Core refuses on eligibility grounds — opted out, consent withdrawn, suppressed, STOP received, do-not-
contact, channel ineligible — often **before anyone has been asked to approve anything**. Requiring
an approval artifact before such a refusal could be recorded would mean manufacturing one, which is
the opposite of safe.

When evidence _is_ supplied, on either outcome, it is re-proved by calling the **public**
`createApprovalRuntime().validateDecision`. A caller-supplied `ApprovalDecisionCorrelation` is not
accepted: a correlation is a conclusion, and taking one would let a caller assert the very thing this
runtime exists to prove. It must also sit on the same correlation thread as the request.

### 6. "Authorized" requires an approved action WITHIN the Core decision it names

On an `authorized` outcome: evidence is mandatory (`approval-required` if absent), must hold up
(`approval-invalid`), must be the exact decision Core named in `approvalDecisionId`
(`binding-mismatch`), and its **per-action** verdict must be `approved`.

Per-action, **not** `decision.outcome`. Under partial approval an overall `approved` decision may
reject the supplied evidence's action while approving another, and a runtime reading the overall
outcome would accept an authorization backed by a refusal. `approval-not-approved` is its own code
precisely so "you did not show me the approval" and "the approval you showed me says no" cannot be
confused.

Stated exactly: **the authorization names a Core approval decision, and the supplied evidence proves
an approved action within that named decision on the same correlation thread.** That is the whole
guarantee, and §11 says why it stops there.

### 7. Core may authorize a different channel

`authorization.authorizedChannel === request.proposedChannel` is **not** required, and asserting it
would be Jarvis second-guessing the authority. The contract carries a separate authorized channel
exactly so Core can allow SMS where WhatsApp is ineligible.

### 8. Founder approval does not override an opt-out

The central invariant. A valid, human-approved action plus a Core rejection of `recipient-opted-out`
is an **ordinary successful observation** with outcome `rejected` — never an error, never retried,
never reinterpreted, never downgraded, and never overridden by the approval sitting beside it. The
approval is still reported, because it happened, and it authorizes nothing.

### 9. Core's refusal taxonomy stays open

`reasonCode` is preserved verbatim, always. An optional `knownRefusalReason` is populated only when
the outcome is `rejected` and the code is exactly a member of `COMMUNICATION_REFUSAL_REASONS`, which
is imported and never re-declared.

Its absence means only "this repository has no constant for that reason". It does **not** mean the
refusal is weaker, provisional, retryable or ignorable — an unknown refusal is exactly as binding as a
named one. There is no `other` bucket, no fuzzy match and no rewrite: a near-miss silently
reclassified would be wrong with confidence. The classification is for observability, display and
evaluation, and nothing in the package branches on it.

### 10. The observation confers nothing, and cannot be made to

Exactly `{ request, authorization, approvalCorrelation?, knownRefusalReason? }`, deeply frozen. There
is no `canSend`, `canExecute`, `isAuthorized`, `communicationAllowed`, `consentValid`, `eligible`,
`permitted`, `permission`, `validUntil`, `authorizedUntil`, `pending` or `status`.

A caller reads `observation.authorization.outcome` — a fact about Core's record. **A prior
authorization is not a future permission slip.** Core's artifact says what Core decided _when it
decided_; the world may change before the scheduled moment, and Core and the QF Communications
Runtime **re-validate eligibility at execution time**, where the answer that counts is produced. That
execution-time revalidation remains mandatory and is not in this repository.

### 11. Decision-level approval binding, not communication-action identity

This is the boundary of the guarantee, and it is written down because the code reads as though it
proves more than it does.

`CommunicationAuthorizationV1` carries `communicationId`, `communicationRequestId`,
`approvalDecisionId` and `correlationId`. It carries **no** `approvalRequestId`, **no**
`proposedActionId` and **no** `actionFingerprint`. `ApprovalDecisionV1` is recommendation-level and
may hold several `actionDecisions`. So the authorization names a **decision**, never a specific
approval request and never a specific action.

What the runtime therefore proves:

1. this Core authorization answers this `CommunicationRequestV1`;
2. the authorization names this exact `ApprovalDecisionV1`;
3. the supplied approval evidence is a valid source/request/decision correlation in its own right,
   with a recomputed action fingerprint;
4. the action selected by that supplied evidence was `approved`;
5. all of it sits on one correlation thread.

What it **cannot** prove, and does not claim:

> the approved action selected by the supplied `ApprovalRequestV1` is structurally the same action
> the `CommunicationRequestV1` represents.

There is no field by which that comparison could be made. `approvalCorrelation.proposedActionId`
identifies the action **in the supplied approval evidence** — it is not, and must not be read as, the
communication request's action id.

**Jarvis must not invent the missing mapping.** Inferring it from `actionType`, `parameters`,
`summary`, the template reference or the purpose code would be a heuristic standing in for an
authority decision, and it would be wrong silently. QuickFurno Core owns that semantic binding: Core
is the party that issues `CommunicationAuthorizationV1`, and Core knows which approved action a
communication corresponds to because Core decided it.

**This observation must never be used to derive an execution action id**, and P09 must not read
`approvalCorrelation.proposedActionId` as one.

If a future architecture genuinely requires Jarvis to prove communication-request ↔ approval-action
identity independently, that is a **separately governed, versioned contract change** — a field that
carries the binding — and never a heuristic bolted onto this runtime.

### 12. P09 forward lock

**P09 MUST NOT construct or validate an execution intent by reading only
`CommunicationAuthorizationObservation.approvalCorrelation.proposedActionId`.**

Exact execution binding must begin from a Core-issued `ExecutionIntentV1`, which already carries the
fields this observation lacks, and must prove them against the corresponding Core approval evidence:

- `recommendationId`
- `approvalDecisionId`
- `approvedActionId`
- `actionType`
- `actionContractVersion`
- `parameters`

Communication authorization remains a separate eligibility and consent artifact. **Both are needed;
neither substitutes for the other** — an execution intent does not establish that a recipient may be
contacted, and a communication authorization does not establish which action is being executed.

## Rejected alternatives

- **A `canSend` / `eligible` boolean on the result.** The single easiest thing to add, and it ages:
  it would be the stale permission the contract refuses to issue.
- **Caching Core's answer, or any eligibility window.** The "courtesy copy" communication-model.md
  names explicitly.
- **Any local consent, opt-out, STOP or suppression state.** Core's authority, and a second source of
  truth for the most safety-critical record the business has (ADR-0001).
- **Interpreting STOP here.** Observing that Core reported one is not recording one.
- **Treating a Core rejection as an error.** It is the authoritative answer, and the safe one.
- **Letting an approved action override a refusal.** Exactly the failure the two-contract split
  exists to make impossible.
- **Reading `decision.outcome` instead of the per-action verdict.** Breaks partial approval and
  authorizes an action that was refused.
- **Requiring the authorized channel to equal the proposed one.** Second-guesses Core's eligibility
  check.
- **Closing `reasonCode` into an enum, or mapping unknown to `other`.** Makes Jarvis the arbiter of
  which of Core's refusals are real.
- **Rejecting a refusal that arrives after expiry.** Makes the safest possible answer unrecordable.
- **Accepting a caller-supplied approval correlation.** Lets the caller assert the conclusion.
- **Adding `validUntil` to the authorization contract.** The exact stale-permission field the
  contract omits on purpose.
- **Inferring which approved action a communication "really is"** from `actionType`, `parameters`,
  `summary`, the template reference or the purpose code. A heuristic standing in for an authority
  decision, wrong silently, in the one place being wrong reaches a real person.
- **Adding `approvalRequestId`, `proposedActionId` or `actionFingerprint` to
  `CommunicationAuthorizationV1`.** Possibly the right future answer, and not one this slice may take:
  it is a versioned contract change with its own governance, and Core issues the artifact.

## Consequences

Jarvis can now hold Core's communication answer as **evidence** rather than as a permission, with the
paperwork proved: the artifacts describe each other, the authorization names a Core approval decision
and the supplied evidence proves an approved action within that named decision on the same
correlation thread, and a refusal is authoritative regardless of who approved what. It does **not**
prove that the communication request represents that exact action — see §11 — and nothing downstream
may read it as though it did.

The new package root is locked at **3** runtime symbols and 5 types. Every existing package-root count
is unchanged, `apps/api` stays **0**, and **no package or application imports this one** — it is a
leaf with no consumer, by design, because the producer of `CommunicationRequestV1` does not exist yet.

**No migration was created or modified.** Migrations remain `0001`–`0009` with `0009` at
`e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6`, and there is no `0010`. Managed
PostgreSQL was not accessed and still carries `0001` only. Production rollout remains **OFF**.

**QuickFurno Core Sync Gate: passed.** Core's authoritative ownership of consent, preferences,
suppressions, STOP/START, do-not-contact, communication authorization, current eligibility and
business data is unchanged. No duplicate Core state, no Jarvis consent cache, no direct Meta access,
no direct n8n execution, no direct business mutation, and no invented live Core endpoint, URL,
credential format or auth protocol. Live Core protocol adoption remains separate Core-integration
work, gated on its own authorization.

**This completes the Jarvis-side P08 approval and communication-authorization safety controls.**
Still outstanding, and none of it in this PR: the live Core transport for communication
authorization; a producer for `CommunicationRequestV1`; the operator surface's HTTP, UI and
authentication provider; and all P09 execution work. Compatibility with the locked QuickFurno Mini
Brain architecture is preserved — a Mini Brain may later choose an intent and an approved template
and produce a powerless request, and may never decide consent, cache it, interpret STOP as authority,
override a suppression, treat a template match as send permission, bypass Core, or call Meta or n8n.

## Non-goals

No live QuickFurno Core endpoint, client, URL, header, credential format or auth protocol. No
Core-side implementation of any kind. No Meta or WhatsApp client. No n8n workflow. No provider SDK.
No transport, persistence, cache or event emission. No `ExecutionIntentV1`, idempotency key, provider
selection or recipient resolution. No consent, opt-out, STOP, suppression or eligibility state. No
`CommunicationRequestV1` producer and no Mini Brain implementation. No HTTP, UI or authentication
provider. No migration and no `0010`. No managed database access or deployment. No P09 execution.

## Change-control rule

The absence of local consent state, the powerlessness of the observation, the per-action approval
verdict, the openness of Core's refusal taxonomy, and the rule that a Core refusal is authoritative
are the contract this slice establishes, together with the **limit** on the guarantee recorded in §11
and the P09 forward lock in §12. Adding any permission or eligibility field, caching Core's answer,
adding a `validUntil`, closing `reasonCode`, reading the overall approval outcome instead of the
per-action verdict, requiring the authorized channel to match the proposed one, letting an approval
soften a refusal, inferring communication-action identity by heuristic, or deriving an execution
action id from this observation each reopens a failure this ADR closes, and is a governed change
requiring its own decision.
