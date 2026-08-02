# ADR-0080 — QFJ-P08 Approval Runtime Foundation

**Status:** Accepted — QFJ-P08 (request construction + Core decision correlation; no persistence, no queue, no wiring, no deployment)
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0005](./ADR-0005-human-and-policy-approval.md) · [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md) · [ADR-0014](./ADR-0014-governed-lifecycle-contracts.md) · [ADR-0078](./ADR-0078-qfj-p08-b-durable-runtime-composition.md) · [ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md)

## Context

Baseline: `main` at `6ae0534cea313dffeb493368e304adf246fb251f`, the merge of PR #82 (QFJ-P05.05).
Collision checks on that baseline: no `packages/approval-runtime`, no reference to
`@qf-jarvis/approval-runtime` anywhere in `packages`/`apps`, `ADR-0080` unclaimed, zero open PRs;
migrations `0001`–`0008` with no `0009`.

QFJ-P05.05 was the prerequisite, and it is now merged. `ApprovalRequestV1` requires three things
together — a `recommendationId`, a `proposedActionId` and an `actionFingerprint` — and until that
phase nothing produced any of them. `@qf-jarvis/recommendation-runtime` now returns exactly that
triple per proposed action, as `RecommendationActionBinding`, alongside a validated
`RecommendationV1`.

What is still missing is the artifact that carries the **asking**. Without it the approval path has
only a recommendation (Jarvis's) and a decision (Core's), and systems in that position grow a
shortcut — a recommendation with a `submitted` flag, a decision with a `pending` outcome. Both put a
piece of the authorization state inside Jarvis, which is the one place ADR-0002 says it may never be.

## Decision

### 1. A leaf package with two responsibilities and no third

`@qf-jarvis/approval-runtime`. Production dependencies exactly `@qf-jarvis/contracts`,
`@qf-jarvis/recommendation-runtime`, `zod`, and `node:crypto`'s `randomUUID`. No dependency on the
agent runtime, the composition root, the event backbone, conversation control, the Core decision
adapter, any database, model package or application. No cycle. Importing it opens no socket, reads no
environment, opens no file, arms no timer, logs nothing, generates no identifier and hashes nothing.

**Three root runtime symbols** — `APPROVAL_RUNTIME_ERROR_CODES`, `ApprovalRuntimeError`,
`createApprovalRuntime` — and six public types. No default export, and no exported input schema.

1. `createRequest(input)` — build a powerless `ApprovalRequestV1` for ONE exact proposed action.
2. `validateDecision(input)` — correlate an `ApprovalDecisionV1` that Core has ALREADY issued.

### 2. The request input is minimal, because governance is DERIVED

A caller supplies six things: the recommendation runtime's result, which action, the two instants,
the policy citation, and optionally a causation event id. Everything else comes from the
recommendation:

| Field                          | Source                                       |
| ------------------------------ | -------------------------------------------- |
| `recommendationId`             | `recommendation.recommendationId`            |
| `proposedActionId`             | the selected action                          |
| `actionFingerprint`            | its **re-proved** binding                    |
| `risk`                         | `recommendation.risk`                        |
| `requestedAuthority`           | `recommendation.requiredApproval`            |
| `requestingAgent` / `…Version` | `recommendation.producingAgent` / `…Version` |
| `correlationId`                | `recommendation.correlationId`               |
| `summary`                      | the selected action's own summary            |
| `producingSystem`              | the literal `qf-jarvis`                      |
| `contractVersion`              | `APPROVAL_REQUEST_CONTRACT_VERSION`          |

**`risk` and `requestedAuthority` are derived, not restated, and that is the load-bearing decision
of this ADR.** They were governed once already, when `recommendationV1Schema` validated the
recommendation. If `createRequest` accepted them again, a caller holding a legitimate
`money-related` + `founder` recommendation could ask about it as `money-related` +
`delegated-approver` — laundering the approval down to somebody who should never have seen it, with
a perfectly valid recommendation sitting behind it. The request is a faithful ask about an existing
recommendation, not a second chance to set its governance.

The summary is the selected action's own wording. Inventing new approval prose here would be a
second description of the same thing, free to disagree with the one the fingerprint covers.

`policy` is the one governance-shaped field a caller does supply, and it is a **citation, not an
authority**. Recording which policy Jarvis believed applied is what makes a later divergence from
Core's policy visible rather than silent.

### 3. The source is untrusted, and its fingerprints are recomputed

`RecommendationRuntimeResult` is a TypeScript type. It is not evidence: a value may have been
serialized to a queue and read back, assembled by hand, or simply shaped correctly by a caller.

So the recommendation is parsed with the real `recommendationV1Schema`, and **every binding is
recomputed** through `@qf-jarvis/recommendation-runtime`'s public `fingerprintProposedAction` —
never read. Exactly one binding per action, no extras, no duplicates, ids matching, digest matching
the content supplied _now_.

This is the anti-substitution control, and the attack it stops is concrete: take a recommendation
whose action A says "send the standard follow-up", get it approved, then supply a source in which A
has the same `actionId` and the same `recommendationId` but different `parameters`. Every identifier
lines up; the Core decision still says `approved`. Only the recomputed digest disagrees — which is
precisely why it must be recomputed on **both** entry points, every time.

Verification uses that package's public function rather than a local reimplementation, because a
second implementation of a canonicalization is a second implementation that can drift. That is why
QFJ-P05.05 exported it separately from its runtime.

### 4. A request may not outlive its recommendation

`recommendation.createdAt ≤ request.createdAt < recommendation.expiresAt`, and
`request.createdAt < request.expiresAt ≤ recommendation.expiresAt`.

The last bound is the one that matters: a request outliving its recommendation would let an approval
be granted for a conclusion that had already gone stale.

**No clock is read.** Every instant is caller-stated and compared against the recommendation, exactly
as the contracts compare `expiresAt` against `createdAt` rather than against `now` — an artifact that
was valid when it was made must not become invalid because it was replayed tomorrow. Expiry means an
unanswered request is stale; it never ripens. There is no timeout-to-approve and no field in which
one could be expressed.

### 5. Informational recommendations create no request

Informational means risk `informational`, `requiredApproval: 'none'` and zero proposed actions. There
is nothing to approve, so `createRequest` fails closed — no synthetic action, no "approve
informational" path. `approvalRequestV1Schema` refuses both `requestedAuthority: 'none'` and an
informational risk independently, so the refusal is structural as well as procedural.

### 6. Identity, and no idempotency claim

The default port calls `crypto.randomUUID()` at CALL time — never at import, never at construction —
and its output is validated against `approvalRequestIdSchema` like any injected port's. Two
`createRequest` calls are two asks with two identities; deduplication belongs to a durable queue that
does not exist yet.

### 7. The request is powerless

`ApprovalRequestV1` has no `outcome`, `decision`, `approved`, `decidedBy` or `validUntil` field, and
the shape is strict, so none can be added. An approval request that has been granted is not a request
with a flag set; it is an `ApprovalDecisionV1`, issued by Core. Jarvis may state what it wants and
why. It may never state what it got.

### 8. Decision correlation, and what it does not do

`validateDecision` obtains nothing — the decision arrived from a boundary outside this package. All
three inputs are untrusted, including the request, which is re-parsed and re-proved against the
source: recommendation id, action, fingerprint, risk, authority, agent, version, correlation, summary
and timing. Nothing is silently repaired.

Core's artifact is parsed with `approvalDecisionV1Schema`, which structurally proves `issuer` is
`quickfurno-core`, that `decidedBy` is a human or a named/versioned policy and **never an agent**,
that action verdicts are unique, and that a non-approved outcome approves nothing. A malformed
decision is refused, never normalized.

Then: same recommendation, same correlation thread; decided at or after the request was created and
strictly before both the request's and the recommendation's expiry; every action Core ruled on
belongs to this recommendation; and the requested action was actually ruled on.

**It does NOT require the decision to cover only the requested action.** `ApprovalDecisionV1` is
recommendation-level and partial approval across several actions is exactly what it exists to
express. Under partial approval the overall outcome may be `approved` while THIS action's verdict is
`rejected` — and the per-action verdict is returned as-is, never reconciled with the outcome.
Converting an overall `approved` into the action's verdict would tell a caller that a rejected action
was approved.

`changes-requested` is an authoritative, final observation. It is not pending, not an implicit retry,
and not an implicit new recommendation; a future workflow may create one, and this package does not
mutate the recommendation it was given.

### 9. Jarvis does not second-guess Core's authority model

There is no founder list, admin list, role lookup or authority cache. Once a structurally valid,
correctly correlated decision arrives, whether the decider had sufficient organizational authority is
Core's question: Core is authoritative for identity, authority, current state and policy. Jarvis
requested an authority **floor**; Core may require more, and may not accept less.

### 10. The correlation result confers nothing

`ApprovalDecisionCorrelation` carries the request/recommendation/action identity, the re-proved
fingerprint, the decision and the matching per-action verdict — and deliberately no `isAuthorized`,
`canExecute`, `canSend`, `communicationAuthorized`, `consented`, `consentValid`, `sendAllowed` or
`executable`.

**An approval is not a communication authorization.** Even a founder-approved action may not reach a
recipient who has opted out, is inside quiet hours, has become invalid, or has exhausted attempt
limits. `CommunicationAuthorizationV1` is a separate contract with separate inputs, and collapsing
the two is how an approval quietly becomes consent. **Founder approval does not override an opt-out.**

Nor is it execution authority in Jarvis: QuickFurno Core creates any future `ExecutionIntentV1` from
its own recorded decision. This package creates no intent, no idempotency key, no provider selection,
no recipient and no dispatch.

### 11. No state, no persistence, no Core call

No approval table, queue, ledger, pending store, adapter, migration, cache or process-global
registry — and **no `0009`**. An unanswered request is represented by a request existing and a
decision not existing, which is a fact about the world rather than a field somebody has to remember
to update. There is no `pending`, no `approved` boolean and no optimistic approval.

No `CoreDecisionPort`, HTTP, fetch, webhook, RPC or Core client: this phase constructs a request and
validates a decision handed to it. Jarvis emits no canonical approval event; Core owns event
emission after it records the decision.

The artifact and correlation semantics are locked first, deliberately, so the next slice can add
durability over primitives that already have a defined meaning.

### 12. No runtime or application wiring

`packages/jarvis-runtime/**` and `apps/api/src/runtime/durable-jarvis-runtime.ts` are untouched.
`JarvisRuntime` remains exactly three methods; no fourth is added. This is a standalone governance
primitive, and a later P08 composition or operator surface will call it.

## Rejected alternatives

- **Accepting `risk` and `requestedAuthority` from the caller.** The laundering path: a valid
  money-related recommendation asked about at a delegated-approver level.
- **Trusting a supplied binding because its digest is well-formed.** 64 lowercase hex characters are
  trivial to produce; only recomputation binds content.
- **Reimplementing the fingerprint here.** A second canonicalization is a second thing that can
  drift; the public `fingerprintProposedAction` is the single definition.
- **A `status: 'pending'` field, or an approval queue in this phase.** Puts authorization state in
  Jarvis before its semantics are locked.
- **Deriving the selected action's verdict from the overall outcome.** Reports a rejected action as
  approved under partial approval.
- **Requiring the decision to mention only the requested action.** Breaks recommendation-level
  partial approval, which the contract exists to express.
- **Checking whether `decidedBy` has sufficient authority.** A local RBAC model that can disagree
  with Core's, in the package with the least information.
- **An `isAuthorized` or `canSend` field on the result.** Converts a record into a permission and
  conflates approval with consent.
- **Reading a clock to reject expired requests.** Would make a replayed artifact's validity depend
  on when it was replayed.
- **Inventing new approval wording instead of using the action's summary.** A second description
  free to disagree with the one the fingerprint covers.

## Consequences

The approval path now has all three artifacts: a recommendation (QFJ-P05.05), a powerless request,
and a validated correlation of Core's decision. Anti-substitution is enforced on both entry points.

The new package root is locked at **3** runtime symbols and 6 types. `@qf-jarvis/contracts` remains
**369** and `@qf-jarvis/recommendation-runtime` remains **4**; every other package-root count is
unchanged and `apps/api` stays **0**. The only dependency-graph change is one new leaf importing
`contracts` and `recommendation-runtime`; no new third-party resolution, no cycle.

Migrations remain `0001`–`0008` with no `0009`. **Managed PostgreSQL was not accessed and still
carries `0001` only.** Production rollout remains **OFF**.

**Canonical QFJ-P08 remains incomplete.** Human-control durability landed in QFJ-P08-B (ADR-0078);
this slice adds the approval artifacts. Still pending: consent and opt-out state, a **durable
approval queue and audit** — the next slice, built over these exact primitives — QuickFurno Core
integration, and an authenticated operator approval surface, in that locked order.

## Non-goals

No approval persistence, queue, ledger or pending state. No optimistic or local approved state. No
operator HTTP, API, UI or authentication. No Core transport call. No canonical approval-decision
event emitted by Jarvis. No execution intent, idempotency key, provider selection or recipient
resolution. No consent, opt-out or communication-authorization evaluation. No P09 transport, n8n or
WhatsApp. No `JarvisRuntime` or application wiring. No migration and no `0009`. No managed database
access or deployment.

## Change-control rule

The derivation table in §2 is the contract between a recommendation and the ask about it. Adding a
caller-supplied override for any derived field — particularly `risk` or `requestedAuthority` —
reopens the laundering path this ADR closes, and is a governed change requiring its own decision.
