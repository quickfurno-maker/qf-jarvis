# ADR-0133 — QFJ-P08 powerless `CommunicationRequestV1` producer

**Status:** Accepted. **MERGED** as PR #174, merge commit `eefe32cc75d05b22bc112bf8c60093087b78758b`.
**Date:** 2026-08-30
**Phase ownership:** **QFJ-P08** (consent, approval and human control). **Slice S1 of
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md).** No new phase is created;
there is no QFJ-P13 and no AVG-13.
**Baseline:** `a52e7e18dd1a95c69599c2dcfde1c4d4742d6628` (merge of PR #173 / real-execution
integration planning)
**Supersedes:** nothing. **Superseded by:** nothing.
**Next slice:** S2 is **BLOCKED** pending
[ADR-0134](./ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md). S1 itself is unaffected.

Read with [ADR-0001](./ADR-0001-source-of-truth-boundary.md),
[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md),
[ADR-0005](./ADR-0005-human-and-policy-approval.md),
[ADR-0008](./ADR-0008-controlled-communication-capability.md),
[ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md),
[ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md),
[ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md),
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md),
[communication-model.md](../architecture/communication-model.md),
[execution-governance.md](../architecture/execution-governance.md),
[automation-levels.md](../governance/automation-levels.md),
[security-principles.md](../governance/security-principles.md) and
[privacy-principles.md](../governance/privacy-principles.md).

Plan: [aarohi-real-execution-integration-plan.md](../architecture/aarohi-real-execution-integration-plan.md).

---

## Context

`CommunicationRequestV1` has existed in `@qf-jarvis/contracts` since Phase 2.
`@qf-jarvis/communication-authorization-runtime` has consumed one since ADR-0083. **Nothing in the
repository has ever built one.** A merged consumer therefore had nothing to consume, and the roadmap
listed "a producer for `CommunicationRequestV1`" as a canonical outstanding QFJ-P08 item with no
owner.

ADR-0132 gave that item a slice. **S1 is the first implementation slice of the real-execution
integration**, chosen ahead of the QFJ-P09 state-record producer because the dependency runs one way:
`CommunicationRequestV1` carries `communicationId`, `recipient` and `purposeCode`, three of the five
identity fields `CommunicationStateRecordV1` needs for continuity. The request precedes the
authorization, which precedes the intent, which precedes the later lifecycle states.

S1 has **no Core dependency**, because producing a request is asking, and asking is not a protocol.

## Decision

### 1. One new package, one method, and no second

`packages/communication-request-runtime` → `@qf-jarvis/communication-request-runtime`.

The name follows the established pure-boundary convention set by `recommendation-runtime`,
`approval-runtime` and `communication-authorization-runtime`. It is deliberately **not** placed
inside `aarohi-agent`, `communication-authorization-runtime` or `apps/api`: a producer that lives
inside its own consumer is a producer nobody can reason about separately, and Aarohi produces
neither request nor state record — it prepares inert candidates and pins
`communicationRequestCreated: false`.

**Exact public API — three root runtime symbols and four types:**

| Kind    | Symbol                                      |
| ------- | ------------------------------------------- |
| runtime | `COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES` |
| runtime | `CommunicationRequestRuntimeError`          |
| runtime | `createCommunicationRequestRuntime`         |
| type    | `CommunicationRequestRuntimeErrorCode`      |
| type    | `CommunicationRequestRuntimeInput`          |
| type    | `CommunicationRequestRuntime`               |
| type    | `CommunicationRequestRuntimeIdentityPort`   |

```ts
createCommunicationRequestRuntime(config?: {
  identity?: CommunicationRequestRuntimeIdentityPort;
}): CommunicationRequestRuntime;

interface CommunicationRequestRuntime {
  createRequest(input: unknown): CommunicationRequestV1;
}
```

Synchronous, no I/O, nothing to await. Every schema, validator, identity helper, canonicalizer and
freezer stays internal, and a spec asserts the exact exported set rather than trusting this table —
**a fourth root export is how a package that ASKS whether a communication may proceed quietly grows
one that says it may.**

### 2. What a successful call means, stated exactly

> Jarvis has constructed a valid request asking QuickFurno Core whether a communication may proceed.

**That is the whole claim.** It does not mean approved, authorized, eligible, consent-valid,
can-send, can-execute, ready-to-dispatch, scheduled-for-execution or delivered. The result is the
canonical `CommunicationRequestV1` and nothing wrapped around it — no envelope, no companion
observation, no side record — because every one of those would be a place to put a field the
contract deliberately refuses.

### 3. The governed source is re-proved, never believed

`createRequest` takes the exact `RecommendationRuntimeResult` that `@qf-jarvis/recommendation-runtime`
returned, and treats it as untrusted structural input:

1. the recommendation is parsed with the real `recommendationV1Schema`;
2. every action binding is **recomputed** through the PUBLIC `fingerprintProposedAction(...)` — not
   checked for well-formedness, recomputed from the content supplied right now;
3. exactly one binding per action is required: no missing, no extra, no duplicate;
4. exactly one action is selected by `proposedActionId`, or the call fails closed.

A caller cannot assert "already valid", cannot supply a detached action that has lost its source
governance, and cannot supply a fingerprint that is merely digest-shaped. The substitution this
defends against is concrete: a source whose action keeps the same `actionId` and `recommendationId`
while its content changes would produce a request worded by the substituted action while inheriting
the original's governance. Only the digest disagrees, so the digest is recomputed.

**The fingerprint stays internal.** It proves the source and then stops; it never reaches the
artifact (see §7).

### 4. Derived versus caller-stated

**DERIVED from the canonical source or the runtime — a caller cannot override any of them, because
each is an unknown key in a `strictObject` input:**

| Field                    | Source                                   |
| ------------------------ | ---------------------------------------- |
| `contractVersion`        | `COMMUNICATION_REQUEST_CONTRACT_VERSION` |
| `producingSystem`        | the `qf-jarvis` literal                  |
| `requestingAgent`        | `recommendation.producingAgent`          |
| `requestingAgentVersion` | `recommendation.producingAgentVersion`   |
| `priority`               | `recommendation.priority`                |
| `requiredApproval`       | `recommendation.requiredApproval`        |
| `summary`                | the SELECTED action's `summary`          |
| `correlationId`          | `recommendation.correlationId`           |
| `communicationRequestId` | generated                                |
| `communicationId`        | generated                                |

**CALLER-STATED, because no safer canonical source exists for any of them:** `source`,
`proposedActionId`, `recipient`, `purposeCode`, `proposedChannel`, `content`, `requestedTiming`,
`createdAt`, `expiresAt`, `policy`, and an optional `causationEventId`.

`policy` is a CITATION, not an authority: `policyReferenceSchema` is strict, so the policy's contents
cannot travel with the reference.

**`requiredApproval` is neither weakened nor auto-strengthened.** A caller able to restate it could
take a recommendation requiring founder approval and ask about it as `authorized-team-human` —
laundering a communication down to someone who should never have authorized it. And a source whose
inherited level does not satisfy the canonical contract (an outbound voice call without explicit
human approval) is **REFUSED**, never silently escalated to `founder`: escalating would mean this
package deciding what level of human sign-off a communication needs, which is the recommendation's
already-governed decision.

**`recipient` is deliberately NOT taken from `recommendation.subject`.** A recommendation's subject
is what it is ABOUT; the party a communication reaches is not always that party, and nothing in the
canonical contracts equates the two. Nothing is inferred, either: not a recipient from action
parameters, not a purpose code from an action type, not a template from a summary, not a channel from
prose.

### 5. Timing: a request may not outlive the recommendation it asks about

**No clock is read.** `Date.now()` and `new Date` are absent from production source, asserted by a
spec. Every instant is caller-stated, so a replayed artifact stays valid rather than decaying.

Four rules, the same philosophy `approval-runtime` applies, enforced through the contract's own
`isStrictlyBefore` rather than lexicographic comparison:

```
recommendation.createdAt <= request.createdAt
request.createdAt        <  recommendation.expiresAt
request.createdAt        <  request.expiresAt
request.expiresAt        <= recommendation.expiresAt
```

The last matters most: a request outliving its recommendation would let Core authorize a
communication for a conclusion that had already gone stale, and a communication is the least
retractable thing at the end of that conversation.

Everything else is left to `communicationRequestV1Schema` and not reimplemented: a scheduled time
strictly before expiry, a window that opens before it closes and before expiry, `requiredApproval`
never `none`, outbound voice requiring explicit human approval, voice requiring a script and
messaging requiring a template.

### 6. Identity, immutability and no idempotency

Two contract UUIDs from an optional injected port, defaulting to `crypto.randomUUID()`. **Nothing is
generated until `createRequest()` is called** — a module that generated at import would hand every
importing process the same identifier for its lifetime, and two asks sharing a `communicationId` is
how one Core authorization silently answers a question nobody asked. Whatever a port returns is
validated, including the default's; a malformed identifier and a throwing port are both
`identity-failure`, and the port's own error text is swallowed because it is foreign and unbounded.

Two methods, not one: the ASK (`communicationRequestId`) and the governed COMMUNICATION it would open
(`communicationId`) are different things whose lifecycles diverge.

The result is **deeply cloned and frozen**. `templateVariablesSchema` is built on `z.custom`, so
governed variables arrive by reference; without the clone a caller could edit the content of a
request after it was validated. Mutating the caller's recommendation, action parameters, content
variables, policy object or any nested input after the call changes nothing.

**There is no idempotency.** Two calls are two asks, each with its own identities. A runtime that
returned the "same" request twice would be holding state about what it had already asked — the first
half of a local pending queue, which ADR-0002 puts in Core. There is no `pending`, no `submitted`, no
`authorized` boolean and no status field anywhere.

### 7. This does NOT solve ADR-0083 §11, and must not appear to

This producer runs while holding one exact recommendation and one exact action — more context than
the correlation runtime downstream will ever see. It is tempting to write the binding down. **It does
not.**

- `CommunicationRequestV1` gains no `approvalRequestId`, no `proposedActionId` and no
  `actionFingerprint`. Neither does `CommunicationAuthorizationV1`.
- No side mapping is created and called authority.
- Nothing is inferred from `actionType`, `parameters`, `summary`, the purpose code or the template
  reference.

QuickFurno Core owns the semantic binding between a communication and the action it was approved as,
because Core is the party that issues `CommunicationAuthorizationV1`. Exact execution binding begins
later, from a Core-issued `ExecutionIntentV1`. If Jarvis ever needs to prove that identity
independently, that is a separately governed, versioned contract change — never a heuristic bolted
onto a producer. A spec asserts the absence by serializing a result and proving the recommendation
id, action id and fingerprint do not appear in it.

### 8. No consent authority, and no route to a person

QuickFurno Core and the QF Communications Runtime remain the sole consent, preference, suppression,
STOP/START, do-not-contact and eligibility authorities, and they revalidate at **execution** time,
outside this repository. This package stores no consent flag, no opt-out record, no STOP state, no
suppression list, no eligibility cache and no authorization expiry — not as a field, not as a list,
and not as a "courtesy" copy a later feature would start trusting. **Founder approval does not
override an opt-out, and a prior communication authorization is not a future permission slip.**

`recipient` stays an opaque Core entity reference whose character set excludes the two characters an
email address and an E.164 number require. No phone number, email address, provider contact id,
WhatsApp destination or raw destination is accepted or resolved anywhere. `content` is a versioned
reference to an approved template or script; there is **no message body**, and the governed variables
refuse one by key alongside credentials, contact details, raw provider content and model internals by
key _and_ by value shape. No template registry is created, no template resolved, no message rendered
and no provider payload built.

**`proposedChannel` is a proposal.** It is not renamed selected, authorized or final, and nothing
requires Core to answer with the channel Jarvis named — Core may lawfully authorize a different one
(ADR-0083 §7).

### 9. The error model

Four codes, four fixed messages, mirroring `approval-runtime`'s first four rather than inventing a
parallel vocabulary: `invalid-input`, `identity-failure`, `binding-mismatch`, `request-invalid`. The
message is a constant chosen by the code. Zod issue trees are discarded entirely, and so is any
foreign error — this surface handles rationale, evidence, governed parameters, a recipient reference
and governed template variables, none of which may be echoed back.

### 10. Containment

**Dependencies:** `@qf-jarvis/contracts`, `@qf-jarvis/recommendation-runtime`, `zod`, and
`node:crypto` for `randomUUID` only. Nothing else, asserted against the manifest and against every
production import. Notably **not** `approval-runtime`, `communication-authorization-runtime`,
`execution-intent-runtime`, any database package, any Core adapter, n8n, a provider SDK, the model
gateway or `aarohi-agent`.

**No persistence and no migration.** The set stays `0001`–`0012`, asserted. The `0010`–`0012` ledger
drift ADR-0132 recorded is **not** reconciled here, and no number is allocated.

**No composition.** No package and no application imports this one — asserted by walking every
`packages/*` and `apps/*` manifest, not by a hand-maintained list. It remains an uncomposed leaf.
Composition with `communication-authorization-runtime` is S4, after S3 adopts a Core transport.

**No transport of any kind:** no Core endpoint, URL, header, credential format or protocol; no n8n;
no provider or Meta client; no production recipient; no live-send flag; no activation.

**Production rollout remains OFF. Aarohi's runtime remains PLANNED / DISABLED.**

## Consequences

- The canonical QFJ-P08 outstanding item "a producer for `CommunicationRequestV1`" now has an owner
  and an implementation. **QFJ-P08 itself remains INCOMPLETE:** the live Core transport for
  communication authorization (S4) and the operator surface's HTTP, UI and authentication provider
  are still outstanding.
- `@qf-jarvis/communication-authorization-runtime` finally has something that produces what it
  consumes — but they are still not composed, and composing them is a later slice.
- S2 (QFJ-P09 `CommunicationStateRecordV1` producer) is unblocked: its identity fields originate here.
- Nothing about Aarohi, `apps/api`, `apps/worker`, the contracts, the event backbone, the approval
  runtime or the communication-authorization runtime changed.

## Alternatives considered

- **Put the producer inside `communication-authorization-runtime`.** Rejected: a package that both
  builds the ask and judges the answer can no longer be reasoned about as a correlation control, and
  its three-symbol API lock would have to grow.
- **Accept a detached `ProposedAction` instead of the full runtime result.** Rejected: the governance
  that makes the request faithful — `requiredApproval`, `priority`, the agent, the correlation thread
  — lives on the recommendation, not the action. A detached action would force the caller to restate
  exactly the fields §4 forbids restating.
- **Derive `recipient` from `recommendation.subject`.** Rejected: no canonical source equates them,
  and the failure mode is addressing the wrong person silently.
- **Auto-escalate `requiredApproval` to `founder` for voice.** Rejected: it repairs governance the
  recommendation already decided, and a producer that can raise an approval level is a producer that
  has an opinion about approval. Refusal is the correct behaviour.
- **Carry `proposedActionId` and `actionFingerprint` on the request "for traceability".** Rejected
  under ADR-0083 §11 — it would present a Jarvis-side heuristic as an authority binding that only
  Core can make.
- **An idempotency key over the ask.** Rejected: it would make this package hold state about what it
  had already asked, and grant a second external effect from a key rather than a decision.

## Compliance

Fifty-plus adversarial specs across two suites, each naming a concrete way an ask could become a
permission. A separate **negative proof** ran fourteen deliberate single-control regressions against
the suite — caller-supplied `requiredApproval`, `producingSystem` and `correlationId`; removed
fingerprint revalidation; a request outliving its recommendation; a phone/email recipient; an
accepted free-text body; a carried consent snapshot; an added `canSend`; voice auto-escalation; an
`authorized` claim on the artifact; a written request↔approved-action mapping; a result retaining
mutable caller references; and an application composing the package. **All fourteen were caught**,
and none is committed.

**Production rollout is OFF. Runtime activation is unchanged. The next slice is S2 — the QFJ-P09
`CommunicationStateRecordV1` producer — and it is separate.**
