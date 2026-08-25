# ADR-0116 - JAO-2 governed specialist delegation proof

**Status:** Accepted - offline domain and composition only. No runtime activation, no persistence, no
provider route, no channel, no business effect, no rollout. JAO-2 is **DEFAULT-OFF** and **SHADOW**.

**Date:** 2026-08-25

**Owned by:** QFJ-P12 - Advanced Intelligence and Future Agents, capability overlay **JAO - Jarvis
Autonomy & Operations**, slice **JAO-2 - Governed Specialist Delegation**.

**JAO-2 is an overlay id, not a major phase.** It renumbers nothing, `QFJ-P00` through `QFJ-P12`
remain unchanged, there is no `QFJ-P13`, JOS remains Jarvis OS and JAO remains Jarvis Autonomy &
Operations.

**Builds on:** [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md) (the
autonomy boundary and Mastra-as-harness decision) and
[ADR-0115](./ADR-0115-jao1-mastra-shadow-operations-supervisor-proof.md) (the JAO-1 shadow
operational-health proof). Neither is modified. JAO-2 is an **additive sibling**, not a rewrite:
`apps/worker/src/jao/mastra-supervisor/**` is untouched and its focused suite still passes.

---

## Context

The merged overlay states the JAO-2 requirement in one sentence:

> Delegate bounded analysis only to independently governed and active specialists/capabilities. A
> PLANNED/DISABLED specialist remains unavailable. Delegation never transfers authority.

Every clause of that is a control that has to exist somewhere, and prose is not a control. The
failure mode is specific and easy to reach by accident: a supervisor that can call a specialist can,
one edit later, call one that is switched off, or hand it more authority than the supervisor itself
holds, or treat the specialist's answer as permission to act.

JAO-1 proved a supervisor can perform one bounded read and one governed model call. It proved
nothing about delegation, because it delegates to nobody.

## Decision

Add JAO-2 at `apps/worker/src/jao/governed-specialist-delegation/` as contracts, a local governed
registry, one specialist adapter, and a two-step Mastra workflow. It is imported and started by
nothing.

### 1. Delegated authority is bounded by the supervisor's, and the check is a runtime comparison

The first proof runs an **`L1_READ` parent delegating at `L0_REASON`**. `JAO2_AUTONOMY_RANK` gives
the levels a total order, and `evaluateDelegationAuthority` refuses when the requested level outranks
either the supervisor's level **or the specialist's own governed ceiling** - a supervisor holding
`L1_READ` still may not hand `L1_READ` to a specialist its own governance bounds at `L0_REASON`.

That comparison is made on **parsed data**, because the envelope arrives as `unknown` from a caller
and its TypeScript type is gone by the time it matters.

The absolutes - `businessEffect`, `mayCallModel`, `mayCreateProposal`, `mayExecute`,
`businessEffectAllowed`, `maxCalls` - are enforced by **parsing**, as `z.literal(false)` and
`z.literal(1)`. A descriptor or envelope claiming otherwise cannot survive `safeParse`, so those are
not policy that a later edit could soften. Re-comparing them in the policy would be dead code, and
the linter says so; the descriptor is nevertheless re-parsed inside the policy so a value that
reached it without ever being parsed carries the guarantee and not merely the type.

### 2. Availability is decided before invocation, and there is no fallback

The registry is a small closed lookup in the worker composition. It is **not** a shared package: one
consumer does not justify an abstraction, and a capability-broker package invented before its second
caller would harden guesses into a contract.

`ACTIVE` proceeds. `PLANNED`, `DISABLED`, unknown specialist and wrong capability all refuse **before
anything is invoked**, and a refused run reports `delegationCalls: 0`. The three unavailable outcomes
stay distinct because "there is no such specialist", "it is planned" and "it is switched off" are
different facts.

There is no nearest match, no substitute, no model-selected alternative, no retry, no dynamic
registration and no specialist spawning. Registry lookup never consults model output.

### 3. `ACTIVE` means available to THIS adapter, not channel rollout

This is the sentence most likely to be misread later, so it is stated three times - here, in the
registry, and in a spec. The JAO-2 registry says whether a specialist may be reached by this
**shadow delegation adapter**. It says nothing about whether that specialist's production channel is
rolled out; that posture is owned elsewhere and is untouched. The descriptor deliberately carries no
channel, rollout, transport or enablement field for that reason.

### 4. The first specialist is Riya, through her PURE BEHAVIOUR surface only

The only Riya import is `decideRiyaTurn` and its role constants. By its own contract that function is
deterministic and structurally powerless: no model call, no credential, no transport, no write, no
proposal object, no mutation.

Deliberately not reachable, and asserted absent by a spec that reads **code with comments stripped**:
`createRiyaProposal`, the live Riya conversation service, the Jarvis inbound orchestrator, the
model-reply adapter, communication authorization, execution intent, n8n, WhatsApp, Meta, any provider
SDK, raw SQL, a database pool, an HTTP client, a shell and the filesystem.

**Riya's own guards stay superior.** A `VENDOR` party, a paused conversation, a human takeover or
another AI actor owning the turn all make Riya refuse, and JAO-2 preserves that refusal as the
specialist's decision rather than overriding, retrying or reinterpreting it. A specialist may refuse,
and a refusal is an answer.

### 5. `modelReplyEligible` is data, and JAO-2 makes zero model calls

Riya may report that the merged model-reply boundary MAY be invoked for a turn. JAO-2 carries that
through as a fact about her decision and does nothing with it. There is **no gateway, no bridge and
no provider reachable from this directory at all**, `modelCalls` is `z.literal(0)` on both the run
result and the telemetry event, and a spec drives a `modelReplyEligible: true` case end to end to
prove the count stays zero.

Zero model calls is the intended design, not an omission: JAO-2 is about delegation governance, and
JAO-1 already owns the one-gateway-call proof.

### 6. The output is advisory, and cannot claim to have done anything

The result is a local JAO-2 advisory record whose `advisoryOnly`, `businessEffect`,
`proposalCreated` and `executionRequested` are literals. JAO-2 creates no `RecommendationV1`, no
`ApprovalRequestV1`, no execution intent, no communication authorization and no business-action
proposal. Those belong to JAO-6 or to the existing governed business pipelines.

### 7. Bounds

One delegation call. Zero model calls. Zero proposals, approvals, execution intents and effects. Zero
retries. No timer, no background work and no fake async: `decideRiyaTurn` is synchronous, so the
adapter is, and the workflow adapts to Mastra's Promise-returning step contract with `Promise.resolve`
where there is genuinely nothing to await.

Telemetry carries ids, levels, closed tokens, counters and a duration. There is no field that could
hold a secret, a credential, a chain of thought, a conversation transcript or unrestricted user text,
and the signal flags a caller supplied are not echoed back.

## Authority

Unchanged, and JAO-2 adds nothing to it. **Recommend -> Authorize -> Execute.** QuickFurno Core
remains the sole business authority. n8n executes only already-authorized intents. Providers deliver.
The QF Model Gateway remains the sole model authority - JAO-2 does not create a second router because
it does not route anything. Mastra remains a harness: it sequences two steps and holds no authority,
credential, provider or state.

Delegation moves work, never authority.

## Non-goals

No operational memory or persistence (JAO-3). No sandbox or tool workbench (JAO-4). No ambient
scheduling (JAO-5). No business-action proposals (JAO-6). No second specialist, no specialist
spawning, no dynamic agents, no plugin system, no shared capability-broker or registry package. No
new third-party dependency: the only additions are the workspace links
`@qf-jarvis/riya-agent` and `@qf-jarvis/agent-runtime`, which JAO-2 genuinely imports.
`@mastra/core` stays exactly `1.61.0`, `@mastra/core/workflows` remains the only production Mastra
import surface in the repository, and no package under `packages/` imports Mastra.

No migration, no database, no Core call, no n8n, no channel, no deployment, no rollout change.

## Consequences

JAO-3 inherits a delegation seam whose authority ceiling is already enforced and whose specialist
registry already fails closed, so operational memory can be added without also having to invent
delegation governance.

The registry ships exactly one entry. PLANNED and DISABLED refusals are proved with test fixtures
rather than by shipping fake production specialists nobody governs - so the production table stays
honest, at the cost of those two paths being exercised through injected descriptors.

Rollback is removal or disablement of the JAO-2 directory. Nothing imports it, the existing worker
projection runtime is unaffected, and JAO-1 is unchanged. Any later expansion - a second specialist,
a model call, a proposal, a higher autonomy level - requires its own review and its own ADR.
