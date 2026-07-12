# Recommendation Contract

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

`RecommendationV1` and `RecommendationLifecycleRecordV1`. Decision: [ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md).

---

## `RecommendationV1`

**Produced by:** QF Jarvis, and nothing else.
**Authoritative:** **No.** A recommendation is _advisory and inert_.
**Consumed by (later):** Core's authorization path (Phase 9), the control plane (Phase 12), evaluation (Phase 14).

### It cannot cause an effect

This is the whole point, and the schema enforces it rather than asserting it:

- `producingSystem` is the literal `qf-jarvis`. Nothing else parses.
- There is **no `approved` field, no `authorized` field, no `sent` field** — and an action's `parameters` are scanned so that none can be smuggled in as data. `{ "approved": true }` inside `parameters` is refused.
- There is **no recipient phone number or email address**, so there is nobody to send anything to.
- `confidence` exists and is deliberately wired to nothing. **A 0.99-confidence recommendation to spend money requires exactly the same authorization as a 0.6-confidence one.** Confidence informs prioritization and evaluation; it never informs permission.

### Fields

| Field                    | Required    | Notes                                                                 |
| ------------------------ | ----------- | --------------------------------------------------------------------- |
| `recommendationId`       | Yes         | UUID                                                                  |
| `contractVersion`        | Yes         | Literal `1`                                                           |
| `recommendationType`     | Yes         | Machine token. The bounded class of thing being recommended           |
| `createdAt`, `expiresAt` | Yes         | **Expiry is mandatory**, and must be after creation                   |
| `producingSystem`        | Yes         | Literal `qf-jarvis`                                                   |
| `producingAgent`         | Yes         | One of `jarvis`, `kabir`, `riya`, `anisha`, `jitin`                   |
| `producingAgentVersion`  | Yes         | So a wrong conclusion is attributable to a version, not just an agent |
| `subject`                | Yes         | Opaque Core entity reference                                          |
| `priority`               | Yes         | `low` · `medium` · `high` · `critical`                                |
| `confidence`             | Yes         | 0..1                                                                  |
| `risk`                   | Yes         | The approved risk classes (below)                                     |
| `requiredApproval`       | Yes         | The approval level this would need                                    |
| `summary`                | Yes         | Bounded. Scannable in a prioritized list                              |
| `rationale`              | Yes         | Bounded. **The stated reasoning, written to be challenged**           |
| `evidence`               | Yes         | **At least one.** Always                                              |
| `proposedActions`        | Yes         | Possibly empty — see below                                            |
| `composite`              | Yes         | Boolean                                                               |
| `contributingAgents`     | Conditional | Required iff `composite`                                              |
| `correlationId`          | Yes         | UUID                                                                  |

### Risk and approval — taken verbatim from the approved matrix

`risk` uses the classes in [execution-governance.md](../architecture/execution-governance.md) §9:

`informational` · `low-risk-reversible` · `client-or-vendor-facing-communication` · `outbound-voice-call` · `money-related` · `high-risk-or-novel`

`requiredApproval`: `none` · `delegated-approver` · `authorized-team-human` · `stronger-approval` · `founder`

Two invariants are **enforced by the schema**, and both come straight from approved documents:

1. **Money escalates.** `risk: money-related` requires `stronger-approval` or `founder`. _"Never delegated by default."_
2. **Nothing that reaches a person is free.** A non-informational recommendation may not have `requiredApproval: none`. _"Never 'none' for anything that reaches a client, vendor, or ad account."_

### Evidence is mandatory, and has no room for chain-of-thought

At least one evidence item, always. _"A recommendation without evidence is a defect. If an agent cannot point at the facts that produced its conclusion, the conclusion does not ship. 'The model thought so' is not evidence."_

Evidence comes in exactly two shapes:

- **`canonical-event`** — a reference to an event a reviewer can go and check against Core's own records. This is what makes a fabricated justification fail on contact with the evidence panel, which is a real prompt-injection defence ([security-principles.md](../governance/security-principles.md)).
- **`derived-signal`** — a stable signal code, a bounded description, and an optional governed value.

Note what is missing: there is **no free-text reasoning blob**. That is where chain-of-thought would live, and chain-of-thought is never stored. The `value` field is a governed JSON object, so a key called `chainOfThought` does not parse.

### Actions, and the informational case

`proposedActions` is bounded, and every `actionId` must be **unique within the recommendation** — otherwise an approval decision that approves one action and rejects another could not say which was which.

There is one **reconciliation worth flagging explicitly**, because a naive reading of "a recommendation must propose at least one action" would break the approved architecture:

> **Not every recommendation proposes an action.** The approved lifecycle is emphatic: _"Most [recommendations] do not [end at a provider]... It may be **informational** — 'verified lead rate in Pune dropped this week, here is the evidence' — and close as soon as a human has read it."_ And the approval matrix lists `Informational | an attention item with no proposed action | None — nothing executes`.

So the rule is conditional, and the schema enforces both halves:

| `risk`          | `proposedActions` | `requiredApproval`     |
| --------------- | ----------------- | ---------------------- |
| `informational` | **must be empty** | must be `none`         |
| anything else   | **at least one**  | must **not** be `none` |

Forcing an action onto an informational item would have made the most common kind of recommendation unrepresentable, and would have pushed producers to invent a fake action to satisfy the schema. The conditional rule is stricter _and_ truer.

### Composite recommendations

`composite: true` means Jarvis assembled several specialists' bounded conclusions into one prioritized founder item. When it does:

- `producingAgent` must be `jarvis` — only the coordinator composes.
- `contributingAgents` must be present, non-empty, and unique, and may name only **specialists**.

> _"A composite recommendation with no attributable contributors is a Jarvis conclusion wearing a disguise, and it is a defect."_ — [agent-model.md](../architecture/agent-model.md)

Jarvis **owns the connecting, never the concluding**. Attribution is what keeps evaluation landing on the agent that actually made the judgment, so a wrong conclusion stays someone's to fix.

And the converse is enforced too: `contributingAgents` may **not** appear on a non-composite recommendation. _"Do not force specialist attribution on a bounded recommendation produced directly by one specialist"_ — nor permit it, or the field becomes ambiguous.

---

## `RecommendationLifecycleRecordV1`

A **point-in-time fact**: this recommendation was in this state, at this instant, for this reason.

### The fourteen states — verbatim

From [recommendation-lifecycle.md](../architecture/recommendation-lifecycle.md), not renamed:

`received` · `validated` · `routed` · `analyzed` · `recommended` · `awaiting-approval` · `approved` · `rejected` · `changes-requested` · `expired` · `converted-to-execution-intent` · `executed` · `result-received` · `closed`

There is **no `auto-approved` and no `timed-out`**, and a test asserts their absence. _"Silence is never consent. There is no timeout-to-yes anywhere in this system."_

### Reference integrity is enforced

A state that only exists because Core did something must carry the thing Core produced:

| State                                       | Requires                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| `approved`, `rejected`, `changes-requested` | `approvalDecisionId` — _"Jarvis never sets `approved` itself"_ |
| `converted-to-execution-intent`, `executed` | `executionIntentId`                                            |
| `result-received`                           | `executionResultId`                                            |

### Transitions are policy, not schema — stated plainly

The approved lifecycle includes a state diagram, and it would be easy to encode it here as a transition matrix. **This contract deliberately does not.**

A lifecycle record is a single point-in-time fact. Validating a _transition_ requires the previous state and the recommendation's history — a **stateful** question that a **stateless** schema cannot answer. Encoding a matrix here would mean either inventing a `previousState` field Phase 0 never asked for, or pretending a stateless validator enforces a stateful rule.

**Transition validity is therefore enforced by the coordination layer, in Phase 4, against stored history.** That is written down rather than quietly assumed, because a reader who believes the schema already enforces transitions will not build the thing that actually does.
