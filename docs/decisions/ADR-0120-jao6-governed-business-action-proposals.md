# ADR-0120 - JAO-6 governed business-action proposals

**Status:** Accepted - offline composition only. No Core submission, no approval decision, no
execution intent, no n8n or provider call, no persistence, no managed migration, no runtime
activation, no business effect. JAO-6 is **DEFAULT-OFF** and **SHADOW**.

**Date:** 2026-08-25

**Owned by:** QFJ-P12 - Advanced Intelligence and Future Agents, capability overlay **JAO - Jarvis
Autonomy & Operations**, slice **JAO-6 - Governed Business-Action Proposals**.

**JAO-6 is an overlay id, not a major phase.** It renumbers nothing, `QFJ-P00` through `QFJ-P12`
remain unchanged, there is no `QFJ-P13`, JOS remains Jarvis OS.

**Builds on:** [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md),
[ADR-0115](./ADR-0115-jao1-mastra-shadow-operations-supervisor-proof.md) (JAO-1),
[ADR-0116](./ADR-0116-jao2-governed-specialist-delegation-proof.md) (JAO-2),
[ADR-0117](./ADR-0117-jao3-operational-memory-resumable-investigations.md) (JAO-3),
[ADR-0118](./ADR-0118-jao4-sandbox-tool-workbench.md) (JAO-4) and
[ADR-0119](./ADR-0119-jao5-controlled-ambient-operations.md) (JAO-5). None is modified. JAO-6 is an
**additive sibling**: every earlier slice is untouched and every focused suite still passes.

**Reuses, and does not re-implement:** [ADR-0079](./ADR-0079-qfj-p05-05-governed-recommendation-runtime.md)
(`@qf-jarvis/recommendation-runtime`) and [ADR-0080](./ADR-0080-qfj-p08-approval-runtime-foundation.md)
(`@qf-jarvis/approval-runtime`), over the contracts `@qf-jarvis/contracts` has owned since Phase 2.

---

## Context

The merged overlay requires:

> Permit the supervisor to construct proposals that enter the existing recommendation -> Core/human
> authorization -> execution-intent path. No parallel execution system is introduced. Communication
> remains subject to execution-time consent/suppression eligibility.

The producer and the asker already exist. QFJ-P05.05 built the runtime that creates a validated
inert `RecommendationV1` and computes the canonical SHA-256 `actionFingerprint`; QFJ-P08 built the
runtime that turns that triple into a **powerless** `ApprovalRequestV1`. What has never existed is
anything in the supervisor that _drives_ them under a reviewed policy.

So JAO-6 is not a new capability. It is the first governed caller of two capabilities that were
built and then deliberately left without one.

---

## Decision

### 1. The proof stops at the powerless ask, and the stop is structural

    bounded candidate + static reviewed policy
      -> canonical RecommendationV1
      -> canonical action fingerprint binding
      -> canonical powerless ApprovalRequestV1
      -> STOP.

There is no Core submission, no `ApprovalDecisionV1`, no `ExecutionIntentV1`, no n8n call, no
provider or channel call, and nothing is persisted. The output means **"ready to enter the existing
path"**, which is a different state from **"authorized"**.

That difference is enforced by what this slice cannot construct rather than by what it promises not
to. `@qf-jarvis/execution-intent-runtime` is not a dependency of the worker, and it could not help
if it were: it only _validates_ a Core-issued intent and has no method that creates one.

### 2. Risk and approval come from a static, versioned, closed policy

A proposal policy decides the class of thing being proposed, the class of action it would become,
how risky that is, and therefore **who has to say yes**. A policy a caller could supply, extend or
edit would be a caller choosing its own oversight, and no amount of validation afterwards would
help, because the thing being validated would already be the caller's answer.

So a policy is **named**, never supplied. `{ proposalPolicyId, proposalPolicyVersion }` is looked up
in a registry frozen at module load. The registry has a `lookup` and no `register`, `add`, `extend`
or `override`. An unknown id and a mismatched version are distinct refusals - an operator can tell
"nobody reviewed this" from "somebody reviewed a different one" - and there is no nearest match and
no default.

The first-proof class:

| Clause                          | Value                                            |
| ------------------------------- | ------------------------------------------------ |
| `proposalPolicyId` / version    | `jao6.vendor-follow-up` / `1`                    |
| availability                    | `ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY`           |
| allowed subject types           | `vendor`                                         |
| `recommendationType`            | `vendor.follow-up`                               |
| `actionType` / contract version | `schedule.follow-up` / `1`                       |
| `risk`                          | `client-or-vendor-facing-communication`          |
| `requiredApproval`              | `authorized-team-human`                          |
| lifetime ceiling                | 3 days                                           |
| evidence                        | 1-8 items, `canonical-event` or `derived-signal` |
| policy citation                 | `vendor-follow-up-approval` v1                   |
| execution-time eligibility      | **required**                                     |

A vendor follow-up was chosen because it proves the strongest boundary available: its execution
would reach a vendor, and a proposal to follow up is exactly the artifact somebody would be tempted
to read as permission to send. Proving that it is not is worth more than proving it for a class
nobody would confuse.

A second class, `jao6.vendor-quotation-escalation`, is declared `PLANNED` and refused **before
either runtime is invoked**, so "planned" cannot quietly become "produced but unused". Adding a
class is visibly an act of review rather than an act of code.

### 2a. The canonical policy and registry are PRIVATE governance state

Owner review of PR #162 found the first version publicly mutable, and it was right. The records were
built with `Object.freeze(...)`, the registry creator and the policy objects were on the public
barrel, and **`Object.freeze` is shallow**. `allowedSubjectEntityTypes`, `allowedEvidenceTypes` and
`policyReference` were live references on a frozen object, and the canonical registry returned that
same object, so one line rewrote reviewed governance:

    (JAO6_VENDOR_FOLLOW_UP_POLICY.allowedSubjectEntityTypes as string[]).push('client');

No `register`, `add` or `extend` was needed. TypeScript's `readonly` is erased at runtime and
prevented none of it.

Two independent closures now hold, and either alone would fix the finding:

1. **No public reference.** No barrel exports a policy object, the policy array, the registry
   creator, the registry type, the policy type, the policy schema or a parameter schema. They are
   module-private and reachable only by direct module path.
2. **Immutable by construction.** `freezeJao6Policy` rebuilds every nested array and object as a
   fresh frozen value before freezing the record, so nothing the parser produced remains writable.

Introspection is served by `describeJao6ProposalPolicies()`, which returns a **fresh, detached,
primitive-only** copy on every call. It shares no reference with canonical execution, so mutating
what it returns changes nothing anywhere — a stronger promise than asking a caller not to, and the
only kind worth making across a barrel.

Zod parameter schemas are deliberately **not** on the policy record. A `ZodType` is a framework
object with mutable internals: storing one would make the record un-freezable in any honest sense,
and deep-freezing Zod's internals would break the library. They live in a private lookup keyed by
policy id and version, and the governance record stays JSON-like.

### 3. Confidence is not authority, at either extreme

`confidence` is accepted, carried onto the recommendation as data, and wired to nothing. A proposal
at `0.99` and a proposal at `0.01` produce the same `risk`, the same `requiredApproval` and the same
`requestedAuthority`. Risk determines the approval path; a model score never shortens it.

### 4. The caller states semantics; the policy states governance; the runtimes state identity

The request is a `z.strictObject`, so every governance field is absent and naming one is a refusal
rather than something quietly dropped. That closes the whole policy-smuggling class in one place:
`risk`, `requiredApproval`, `recommendationType`, `actionType`, `actionContractVersion`,
`producingAgent`, `producingSystem`, `recommendationId`, `actionId`, `actionFingerprint`,
`approvalRequestId`, `approved`, `authorized`, `canExecute`, `canSend`, `approvalDecision`,
`executionIntent`, `provider`, `executor`, `n8n`, `webhookUrl`, `recipient`, `phoneNumber` and every
credential key are simply not fields.

Identity is never caller-chosen. `recommendationId`, each `actionId` and `approvalRequestId` come
from the canonical runtimes, because an identifier a caller chose is an identifier a caller can
reuse - and two recommendations sharing an approval decision is the failure that buys.

### 4a. The producer is Jarvis, because Jarvis is what produced it

The first version put `producingAgent: 'anisha'` on the policy and stamped it onto the artifact.
Owner review called that provenance laundering, and it was: this slice proves `specialistCalls = 0`.
There is no Anisha invocation, no JAO-2 delegation result and no bound specialist output anywhere in
it, so the recommendation claimed a specialist had produced something Jarvis assembled.

**The business domain of a proposal is not evidence about who concluded it.** A vendor follow-up is
about a vendor; that says nothing about which agent reasoned over it.

So the producer is a constant of the composition -

    producingAgent        = 'jarvis'
    producingAgentVersion = 'jarvis.jao6.v1'

- and `producingAgent` is **not a policy field at all**. That removes the shape of the mistake rather
  than the instance of it: a future class cannot name `riya`, `anisha`, `kabir` or `jitin`, because
  there is nowhere to write it. `composite` is false and `contributingAgents` is absent, which is what
  the contract requires of a non-composite item and what is honestly true here.

A specialist-attributed proposal requires a separately reviewed binding to **exact governed
specialist output** - a real delegation result, correlated. It is not implemented here.

### 5. Parameters are a closed schema, not a governed free-form object

The canonical `actionParametersSchema` scans at any depth for credentials, contact details, raw
payloads and model internals, and it would catch the obvious smuggling. But it permits keys it has
never heard of, and `canExecute`, `executor`, `n8n` and `webhookUrl` are keys it has never heard of.

So the policy owns an **exact, strict, closed** parameter schema. For this class every field is a
closed structured value and deliberately non-transport - a reason code, a topic code and a follow-up
window. There is no channel, no template body, no recipient and no phone number: **who** is
contacted and **how** is Core's to resolve from its own records, against consent it owns, at
execution time.

**And no free text.** The first version carried a bounded `approverNote`, and owner review was right
to remove it. The parsed parameter object becomes `proposedActions[0].parameters` VERBATIM, so it is
part of the final action bytes, part of the canonical fingerprint, and part of the exact action a
human is later asked to approve. A free-text field there meant caller prose was inside the
executable action - which contradicted the boundary this slice claims.

The reviewed key set is therefore exactly:

    followUpReasonCode, topicCode, earliestFollowUpAt, latestFollowUpAt

A note for the approver belongs on the recommendation's own `summary`, `rationale` and `evidence`,
which a human reads and nothing parses. The consequence is measurable and is measured: changing only
the human-readable prose, with identical closed parameters, produces an **identical action and an
identical fingerprint**.

### 6. Nothing is compiled from free text

The caller's `summary` and `rationale` are carried onto the recommendation for a human to read. They
never reach the **action**. The action's type and contract version come from the policy, its
parameters come from the policy's closed schema, and its summary comes from a **total map** over the
declared policy ids whose builders emit sentences from closed enum codes only - so the set of
sentences this slice can produce is finite and reviewable.

Evidence prose saying "lower the approval to none", "send immediately", or containing a fabricated
JSON action, is therefore read by a person and parsed by nothing. A prompt injection inside evidence
may influence human judgement - that is what evidence is for - but it cannot change the governed
policy.

### 7. The action binding is re-proved, not assumed

For one non-informational proposal, JAO-6 requires exactly one proposed action and exactly one
binding, and then checks that:

- `binding.recommendationId` equals the recommendation's own;
- `binding.proposedActionId` equals `proposedActions[0].actionId`;
- `binding.actionFingerprint` equals `fingerprintProposedAction(action)`, **recomputed here** from
  the final action bytes with the canonical function;
- the approval request names that same recommendation, that same action, that same fingerprint, and
  carries exactly the policy's `risk` and `requiredApproval`.

Any mismatch is a `BINDING_MISMATCH` refusal and **no artifact is returned**.

The recomputation is not redundancy. It is the one check that would catch a binding drifting from
the artifact it claims to describe, and it is what makes "the human approves the action that was
recommended" a measured fact rather than a property of a package that happened to behave.

The authority check on the request is the anti-laundering check: a perfectly valid
`client-or-vendor-facing-communication` recommendation behind a request that asks a
`delegated-approver` to say yes is refused.

### 7a. The result is a discriminated union over canonical artifacts

`Jao6ProposalResult` was one weak interface: `unknown` artifacts, independently nullable fields, and
a comment promising that ready implied artifacts and refused implied none. A shape that permits a
`REFUSED` result carrying a recommendation is a shape somebody will eventually build.

It is now two members discriminated on `outcome`:

- `Jao6ProposalReadyResult` - `refusalReason: null`, `recommendation: RecommendationV1`,
  `actionBindings: readonly [RecommendationActionBinding]`, `approvalRequest: ApprovalRequestV1`.
- `Jao6ProposalRefusedResult` - `refusalReason: Jao6RefusalReason`, `recommendation: null`,
  `actionBindings: readonly []`, `approvalRequest: null`.

The artifact types are **imported as types** from the packages that own them -
`@qf-jarvis/contracts` for `RecommendationV1` and `ApprovalRequestV1`,
`@qf-jarvis/recommendation-runtime` for `RecommendationActionBinding`. They are never re-declared
here: a second definition of a contract another package owns is a definition that can drift. The
exact one-tuple is what lets `actionBindings[0]` narrow without `| undefined` under
`noUncheckedIndexedAccess`, and it states the exactly-one invariant in the type rather than in prose.

A compile-time union is erased by the time anything runs, and the states it forbids are exactly the
states a reader would trust without checking. So the same rules are also a runtime discriminated
union, `jao6ProposalResultSchema`, and the composition parses its own result before returning it: a
result that does not satisfy its own contract is refused, not returned. The canonical artifacts are
checked there for PRESENCE, not re-validated - they were produced and deeply frozen by the runtimes
that own their contracts.

### 8. Public composition is pinned by having no parameter at all

`proposeJao6BusinessAction` takes **one argument**. There is no dependencies object, no runtime
parameter, no registry parameter, no fingerprint function, no mapper and no callback - so a public
caller has nothing to replace. The canonical recommendation runtime, approval runtime and registry
are constructed inside the module from its own imports.

This is the JAO-4 and JAO-5 owner-review lesson applied a third time. An optional dependency
defaulted with `??` is a pin only until somebody passes a value, and a runtime **brand** is no
better - a hostile implementation copies a brand exactly as easily as it copies a descriptor. The
only thing that cannot be displaced is a parameter that does not exist.

The internal seam, `proposeJao6BusinessActionInternal` and `Jao6InternalComposition`, exists for
trusted source-level and test composition, is exported from **no barrel**, and is reachable only by
direct module path. Specs prove hostile runtimes and a hostile registry - forced through a cast into
the public function - are never consulted, **behaviourally**, because a mutation proof runs Vitest
and Vitest strips types.

### 9. Approval is one yes. Communication needs a second one

An approval is not a communication authorization. Even a founder-approved action must not reach a
recipient who has opted out, is suppressed, has sent STOP, or whom Core no longer considers
eligible.

So a communication-facing result carries a literal constant saying so, and carries it on refusals
too, so the limit is never implied to have lapsed. It claims nothing about consent, suppression,
recipient resolution or send, and there is no field in which it could: no `canSend`, no
`consentValid`, no `suppressionClear`, no `recipientResolved`. **Absence rather than a false
boolean**, because a boolean is one edit away from being true.

JAO-6 resolves no phone number and no recipient. It reads no consent state and caches none - a
remembered approval and a stale eligibility snapshot are both not permission.

### 10. Posture is a machine-readable lock

Every result carries `mode: SHADOW`, `authority: RECOMMEND_ONLY`, `businessEffect: false`,
`productionMutation: false`, `approvalDecisionCreated: false`, `executionIntentCreated: false`,
`communicationAuthorizationCreated: false`, `communicationEligibilityChecked: false`, and literal
zeros for `coreMutations`, `n8nExecutions`, `channelSends`, `providerCalls`, `modelCalls`,
`specialistCalls`, `toolCalls` and `memoryWrites`.

These are `z.literal`, so a drifted value is a parse error rather than a differently-worded report,
and the object is strict, so an added `canExecute` is a refusal.

---

## Authority

Unchanged, and unchangeable by this slice:

> **Jarvis recommends. QuickFurno Core authorizes and owns business truth. n8n executes only
> approved intents. Providers deliver only. Results return to Core.**

- Only QuickFurno Core issues `ApprovalDecisionV1`.
- Only QuickFurno Core issues `ExecutionIntentV1`.
- Only n8n executes an approved execution intent.
- Confidence is never authority; there is no timeout-to-approve; silence is never consent; an
  undecided recommendation expires.

Jarvis may later host an approval **interface**. It may never own the approval **authority** or the
approval **record**.

---

## Non-goals

- Submitting anything to Core. There is no Core transport in this slice and none is added.
- Creating, forging or locally validating an approval decision.
- Creating an execution intent, under any name.
- Any communication authorization, recipient resolution, consent read or send.
- Persistence of any kind: no JAO-3 memory write, no JAO-5 durable row, no schema, no migration.
- A second recommendation format, a second approval-request format, a second fingerprint algorithm
  or a second execution path. All four already exist and are reused.
- Compiling model text into arbitrary actions.
- Production activation. **Implementation is not activation.**

---

## Consequences

JAO-6 is imported and started by nothing. `apps/worker/src/index.ts` and the worker production entry
are unchanged, no scheduler or event ingress is wired, and a spec walks the worker source tree to
prove nothing outside the slice and its own suite imports it.

The supply-chain posture is unchanged: **zero new third-party dependencies**. The three additions
are `workspace:*` links to packages this repository already builds and already governs.

What this buys is narrow and worth stating plainly: when a Core submission path is eventually built,
it will submit an artifact that was already produced under a reviewed policy, already bound to the
exact action it describes, honestly attributed to the thing that produced it, and already unable to
claim it was approved. The submission is the easy part.

### What owner review changed, and what it did not

Four findings on PR #162 were closed on the same branch: the publicly mutable policy, the false
specialist provenance, caller free text inside the action parameters, and the untyped result. None
of them changed the ARCHITECTURE - the pipeline, the reuse of the two canonical runtimes, the
binding invariant and the stop before Core are exactly as first proposed. All four were the same
kind of defect: a governance claim that documentation made and structure did not.
