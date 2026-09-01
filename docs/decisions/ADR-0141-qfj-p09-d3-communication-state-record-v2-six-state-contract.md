# ADR-0141 — QFJ-P09 D3: `CommunicationStateRecordV2` six-state contract

**Status:** **Proposed** — implementation on a feature branch, **PR open, NOT merged.**
**Baseline:** `88ddab543f693c849f710db8de287bac005aba74` (main after PR #181 / D2b / ADR-0139)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited; no Core code was read, accessed or modified**

**Offline contract slice.** No projection, no persistence, no canonical event, no Core integration, no
migration, no Core/Supabase/n8n/provider access, no message, rollout **OFF**.

## Prerequisites, all merged

| Slice                                      | ADR                                                                                      | PR   | Merge commit                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------ |
| D2 — Core protocol/event gap decision      | [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md)                | #178 | `fb23e46efbad66b6a82ecc9920c86548aeb058e1` |
| D2a — accepted-event provenance hardening  | [ADR-0138](./ADR-0138-qfj-p09-d2a-accepted-event-write-path-and-provenance-hardening.md) | #179 | `2027d3215a36e8fdbed6809d0f12a917bb71cdee` |
| D4 — trusted communication evidence reader | [ADR-0140](./ADR-0140-qfj-p09-d4-trusted-communication-evidence-read-capability.md)      | #180 | `182a9cb1c00cf1e3ad0225654992099208b992a0` |
| D2b — Tier A/B evidence and ordering       | [ADR-0139](./ADR-0139-qfj-p09-d2b-tier-ab-durable-evidence-and-ordering-confirmation.md) | #181 | `88ddab543f693c849f710db8de287bac005aba74` |

---

## Context

ADR-0134 found `CommunicationStateRecordV1` unfit for Model 2, and pinned the reason with a
characterization test: **V1 requires an `approvalDecisionId` for `rejected`, while
`CommunicationAuthorizationV1` FORBIDS one on a refusal.** A lawful opt-out therefore could not become
a lawful V1 record without attaching a human approval id to a decision no human made.

D2b then fixed the entry gate in one sentence: _D3's first implementation supports exactly six durable
evidence-bearing states; the two conditional Tier-B states remain vocabulary and are not emitted until
exact Core primitive contracts are adopted._

D3 writes that contract.

---

## Decision

### V1 is immutable, and V2 lives beside it

`communication-state-record.ts` is **byte-for-byte untouched**:
`COMMUNICATION_STATE_RECORD_CONTRACT_VERSION = 1`, `communicationStateRecordV1Schema` and
`CommunicationStateRecordV1` are unchanged, and the ADR-0134 characterization tests still pin V1's
defects as history. V2 is a **new file**,
`packages/contracts/src/communications/communication-state-record-v2.ts`.

### What V2 is

A **Jarvis-LOCAL projection / read-model contract**. It is **not** a Core wire payload, **not** a
canonical event, **not** Core business history, **not** permission or authorization, **not** evidence
or provenance by itself, **not** a D4 trusted-evidence object, **not** a database row, and **not** a
projection handler.

**A shape-valid V2 record proves schema validity and nothing else.** There is no `trusted`, `verified`
or `authoritative` field, because a boolean a caller can type is not a fact. **D5** will be the first
producer and will build V2 only from D4's nominal trusted evidence — which is why this contract ships
**no constructor at all**, and specifically none of
`createStateRecordFromEventId` / `authorizeStateFromEventId` / `evidenceFromEventId`.

### Six states, eighteen vocabulary

`COMMUNICATION_STATE_RECORD_V2_STATES` is exactly `rejected`, `authorized`, `provider-accepted`,
`delivered`, `read`, `failed`. `COMMUNICATION_STATES`, `COMMUNICATION_STATE_COUNT` and
`communicationStateSchema` are untouched at **18**.

The subset is its **own list**, not a filter over the vocabulary — the two move for different reasons,
and deriving one from the other would silently widen this contract the day a nineteenth state lands.
The twelve non-durable states are rejected by the schema, each for the reason its own slice recorded:
the two conditional Tier-B states have no adopted receipt or scheduling primitive; `completed` has no
distinct Core completion truth; and so on.

### State-specific Tier-C evidence

Every record carries the evidence its state was derived from, discriminated by
`tier: 'tier-c'` and `kind`. **No Tier-A or Tier-B variants, no placeholder variant, and no
`evidence: unknown`** — a variant that could hold nothing would let a state exist without a source.

| State                                                 | Evidence kind                 | Binding rule                                                            |
| ----------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `rejected`                                            | `communication-authorization` | `outcome = rejected`; **no** `authorizedChannel`                        |
| `authorized`                                          | `communication-authorization` | `outcome = authorized`; `authorizedChannel` **required**, WhatsApp only |
| `provider-accepted` · `delivered` · `read` · `failed` | `communication-result`        | `state === evidence.lifecycleState`                                     |

**The V1 deadlock is resolved by absence.** V2 has **no `approvalDecisionId` field at all**, so a
rejection needs no invented id and cannot carry one. Nothing about V1's behaviour changed.

**`authorized` is WhatsApp-only** (ADR-0137 Q11). Core may lawfully authorize `sms`, `email` or
`voice` and the source contract can represent them — but a record claiming `authorized` for a channel
this runtime cannot execute lies about capability. Widening is a deliberate future compatibility
decision.

**Result evidence carries no execution ids.** `executionIntentId`, `executionResultId`,
`providerEvidence.providerReference`, `providerOccurredAt`, `explanation`, `failure.failureCategory`
and `failure.description` are all absent — exactly D4's minimisation. The source contract still
mandates the execution ids; D4 parses them and strips them, and V2 never sees them.

Failure is minimised to `failureCode` + `retryClassification`. Using `executionFailureSchema` would
demand fields the only lawful producer cannot supply, and would re-open a free-text channel.

The outcome/failure rules **mirror `CommunicationResultV1` rather than tightening it**:
`provider-accepted` is never `succeeded`; `succeeded` only in a state that actually reached the
recipient and never with a failure; `failed` and `indeterminate` require a structured failure;
`indeterminate` must be `requires-reconciliation` and may not claim a delivered state.

### `sourceEventId` is a pointer

Nested inside evidence, validated with the canonical `eventIdSchema`. **It is a pointer TO provenance,
never provenance itself** — an event id is a name any caller can type. Validity is not authority: a
naked UUID cannot make otherwise-invalid evidence valid, and a test proves evidence consisting only of
a `sourceEventId` fails.

### Common fields

`communicationId`, `contractVersion: 2`, `state`, `recordedAt`, `reasonCode`, `correlationId`, and an
optional `previousState`.

`recordedAt` is the underlying fact's instant — the authorization's `decidedAt` or the result's
`recordedAt` — **never a wall clock and never inferred**. `reasonCode` stays an **open machine token**:
Core's refusal taxonomy is Core's, and closing it to a local enum would drop a reason Jarvis had never
heard of. **`previousState` is optional context, never source evidence, and restricted to the same six
states** — allowing all eighteen would smuggle an undurable state into a durable record.

V1 fields D4 cannot lawfully supply are simply not present: `recipient`, `purposeCode`, `channel`,
`explanation`, `approvalDecisionId`, `executionIntentId`, `executionResultId`.

### No V1 → V2 migration

V1 is not generally convertible: it admits all 18 states, its `rejected` variant is
self-contradictory, and it can rest on ids D4 removes. **V2 is REBUILT from governed primitive
evidence, never migrated from V1 records.** No conversion helper exists, and a test asserts none is
exported.

### Public API

Six intended symbols reach the contracts root:
`COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION`, `COMMUNICATION_STATE_RECORD_V2_STATES`,
`communicationStateRecordV2Schema`, `communicationStateRecordV2StateSchema`, and the two types.
**The nested evidence schemas are deliberately NOT exported** — publishing them would invite a caller
to assemble evidence directly, and D5 is the only sanctioned producer. No compatibility alias, no
package side effect.

### What D3 did NOT do

**No canonical state event.** V2 is not registered in `CANONICAL_EVENT_REGISTRY`; no
`qf.communication.state-recorded@2` or `@3`; the state-recorded payloads, `safeParseCanonicalPayload`
and D4's target-family registry entries are all untouched. **Model 1 remains rejected for MVP.**

**D4 stays at zero production consumers.** D3 imports no reader, opens no ESLint exception, and the
importer count remains exactly **0**. D5 will change it to exactly 1 in its own reviewed PR.

**No projection, reducer, registry entry, state table, migration, rebuild command, runtime composition
or activation.**

### One bounded test-robustness fix, carried deliberately

The pre-existing Windows parallel-load race reported during PR #181 review is fixed here in its own
commit: the D4 containment scan listed `.ts` paths and then read them, so a sibling boundary suite's
short-lived lint probe could vanish in between (`ENOENT ... zz-d2a-lint-probe.ts`).

Probes are now skipped **before `stat()`**, matched by a **narrow** classifier for the exact generated
convention `<case>-<index>-zz-d<n>-lint-probe.ts`. A file that vanishes and is **not** a probe now
throws explicitly rather than being swallowed, and production files merely named `probe.ts` are still
scanned — ignoring those would quietly shrink the corpus the zero-consumer guarantee rests on. **No
assertion was weakened**, and the D2a/D4 boundary assertions are unchanged.

---

## Consequences

- **D5 is unblocked** once this merges: it has a contract to produce, and exactly one lawful way to
  produce it.
- **The ADR-0134 deadlock is closed for V2 only.** V1's historical behaviour is unchanged and still
  pinned.
- **Nothing became live.** **No adopted or live emission for either target family was established at
  the accepted S3 pin, and D3 makes no current-live emission claim.** C3A and C3B remain future Core
  adoption gates; neither has landed. The non-equivalence stands: candidate/published contract ≠ D2
  target family ≠ D4-supported offline evidence shape ≠ adopted Core emission ≠ live Core emission.
- **No migration.** `0013` is not allocated or reserved; the `0010`–`0012` ledger drift is untouched.
- **Rollout remains OFF** and the runtime is unchanged.

---

## Alternatives considered

- **Extending V1 in place.** Rejected: V1 is published and immutable, and its `rejected` contradiction
  is exactly what a new version exists to escape.
- **A V1 → V2 migration helper.** Rejected: V1 records can encode states V2 does not admit and can
  rest on ids D4 removes, so a converter would have to invent or drop evidence.
- **Admitting the two conditional Tier-B states behind a placeholder.** Rejected by ADR-0139 and
  re-declined here: it needs a fake receipt or scheduling id, or an evidence variant implying replay
  that does not exist.
- **Allowing `previousState` to be any of the eighteen.** Rejected: it would be the easiest route for
  an undurable state to enter a durable record.
- **Reusing `executionFailureSchema`.** Rejected: it mandates `failureCategory` and permits free-text
  `description`, neither of which the only lawful producer can supply.
- **Closing `reasonCode` to a local rejection enum.** Rejected: Core's taxonomy is open, and a closed
  copy silently drops reasons.

---

## Posture

No projection, persistence, canonical event, event-registry, ingestion or runtime change. No Core
modification, branch, PR, audit or re-pin. No managed Supabase. No n8n or provider access. No message
sent. **No migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
