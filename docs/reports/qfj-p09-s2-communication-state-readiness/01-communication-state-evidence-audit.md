# QFJ-P09 S2 readiness — communication-state evidence and provenance audit

**Status:** Readiness audit. **No production code, no contract change, no activation.**
**Baseline:** `eefe32cc75d05b22bc112bf8c60093087b78758b` (merge of PR #174 / S1)
**Owning decision:** [ADR-0134](../../decisions/ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md)
**Slice under audit:** **S2 — QFJ-P09 `CommunicationStateRecordV1` producer**, from
[ADR-0132](../../decisions/ADR-0132-aarohi-real-execution-integration-planning.md).

**Verdict up front: S2 cannot be implemented as planned against `CommunicationStateRecordV1`.**
Of the eighteen states, **two cannot be produced from any lawful canonical artifact**, **four are
producible on insufficient or no evidence**, and **two cite the wrong artifact**. Only **`draft`** and
**`follow-up-requested`** are both correct today and producible before Core protocol adoption. Both
failure directions — too strict to satisfy, and too loose to mean anything — are proved executably
below against the built contracts, not argued from prose.

---

## 1. Method

Every claim here was reproduced by parsing real fixtures through the **built** schemas in
`packages/contracts/dist`, not by reading comments. Where a comment and an executable schema
disagree, the schema is reported as the fact.

Nothing was modified to produce these results. The probe was a scratch script; it is not part of the
deliverable. Its findings are pinned as characterization tests in
`packages/contracts/src/tests/communication-state-evidence-characterization.test.ts`, which passes on
the contracts exactly as they stand.

---

## 2. The owner-reported blocker, reproduced

### 2.1 The two schemas are mutually exclusive on `rejected`

`packages/contracts/src/communications/communication-state-record.ts`:

```ts
const STATES_REQUIRING_DECISION: readonly CommunicationState[] = [
  'rejected',
  'authorized',
  'scheduled',
];
```

`packages/contracts/src/communications/communication-authorization.ts`:

```ts
if (value.outcome === 'rejected') {
  if (value.approvalDecisionId !== undefined) {
    ctx.addIssue({/* 'A rejected communication must not name an approval decision …' */});
  }
}
```

Executed:

| #   | Input                                                                     | Parses                                                                                                                                                           |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | lawful `rejected` `CommunicationAuthorizationV1`, no `approvalDecisionId` | **true**                                                                                                                                                         |
| A2  | same, **with** `approvalDecisionId`                                       | **false** — _"A rejected communication must not name an approval decision as though it rested on one. Core refused it — whether or not a human had approved it"_ |
| B1  | `rejected` `CommunicationStateRecordV1`, no `approvalDecisionId`          | **false** — _"State `rejected` exists only because QuickFurno Core recorded a decision, so approvalDecisionId is required"_                                      |
| B2  | same, **with** `approvalDecisionId`                                       | **true**                                                                                                                                                         |

The sets are disjoint. **The only artifact that records a Core communication refusal structurally
cannot supply the only field the `rejected` state record demands.** A generic producer has no lawful
path from A1 to B2.

### 2.2 The authoritative document sides with the authorization

`docs/architecture/communication-model.md` §"Founder authority, and when QuickFurno Core must refuse"
states it directly:

> a **rejected** one must **not** name an approval decision, because Core refused it _whether or not
> a human had approved it_.

So this is not two defensible readings. `communication-authorization.ts` implements the authoritative
model; `communication-state-record.ts`'s inclusion of `rejected` in `STATES_REQUIRING_DECISION`
contradicts it. The state record's own doc-comment rationalises the inclusion — _"a refusal is a
decision Core made and recorded"_ — but the decision Core made was a **communication authorization
decision**, not an **`ApprovalDecisionV1`**, and `decisionIdSchema` in that slot names the latter.

### 2.3 The repository's own fixture already made the forbidden move

`packages/contracts/src/fixtures/valid.ts`:

```ts
export const validCommunicationRejectedOptOut: CommunicationStateRecordV1 = {
  state: 'rejected',
  previousState: 'authorization-requested',
  approvalDecisionId: FIXTURE_IDS.decision,          // <— a human approval id
  reasonCode: 'recipient-opted-out',
  explanation: 'QuickFurno Core refused: the recipient is on do-not-contact.',
  …
};
```

This fixture is the canonical reference example of an opt-out refusal, and it is also the payload of
a shipped `qf.communication.state-recorded` **event** fixture. To be a valid `rejected` record it had
to attach a human approval decision id to a refusal the model says must not name one. **The
contradiction is not hypothetical; it is already encoded in the repository's reference data.** No
producer can do better than the fixture without a contract change.

---

## 3. Additional contradictions found (none previously reported)

### 3.1 `CommunicationResultV1` cannot represent a pre-execution `rejected` or `cancelled`

`COMMUNICATION_RESULT_STATES` includes `rejected` and `cancelled`. The same schema makes
`executionIntentId` and `executionResultId` **mandatory**, unconditionally.

| #   | Input                                | Parses                                                       |
| --- | ------------------------------------ | ------------------------------------------------------------ |
| C1  | `rejected` result, no execution ids  | **false** — missing `executionIntentId`, `executionResultId` |
| C3  | `cancelled` result, no execution ids | **false** — same                                             |

A refusal at `authorization-requested` has no execution intent, because nothing was ever dispatched.
A cancellation is defined by the model as _"cancelled **before execution**, while cancellation was
still permitted"_ — also no intent. So the result contract offers both states and then structurally
forbids the only circumstances in which they occur. It parses only if a producer **invents** two
execution identifiers, which is the same forbidden move as §2.3 in a second contract.

**Consequence:** there is no canonical artifact anywhere in `@qf-jarvis/contracts` that can lawfully
evidence a pre-execution `rejected` or `cancelled` communication.

### 3.2 `CommunicationAuthorizationV1` has no identity of its own

Its fields are `contractVersion`, `communicationId`, `communicationRequestId`, `issuer`, `outcome`,
`authorizedChannel`, `approvalDecisionId`, `decidedAt`, `reasonCode`, `explanation`, `policy`,
`correlationId`. There is **no `communicationAuthorizationId`**, and a repository-wide grep for one
returns nothing.

This is why §2.1 has no easy fix. Even a corrected state record could not cite "the authorization
that refused this" **by id**, because the authorization is not independently addressable. It is
identified only by the request it answers.

### 3.3 The state record has no slot for four of the seven evidence artifacts

Probed by offering each key to a `strictObject`:

| Candidate evidence key         | Accepted               |
| ------------------------------ | ---------------------- |
| `approvalDecisionId`           | ACCEPTED               |
| `executionIntentId`            | ACCEPTED               |
| `executionResultId`            | ACCEPTED               |
| `communicationRequestId`       | REJECTED — unknown key |
| `communicationResultId`        | REJECTED — unknown key |
| `communicationAuthorizationId` | REJECTED — unknown key |
| `handoffRecordId`              | REJECTED — unknown key |
| `evidenceEventId`              | REJECTED — unknown key |

The record's doc-comment promises _"a state that only exists because Core decided, dispatched, or
recorded something must carry the artifact that proves it."_ It keeps that promise for **execution**
(intent, result) and breaks it for **communication authorization**, **communication result** and
**human handoff** — for which it has nowhere to point at all. `approvalDecisionId` is doing duty as a
general-purpose "Core decided" slot it was never typed for.

### 3.4 `authorized` cites the wrong artifact

`authorized` requires `approvalDecisionId`. But `authorized` means _"Core validated and authorized
it, and recorded the decision"_ — that is `CommunicationAuthorizationV1`, not `ApprovalDecisionV1`.
The record is satisfiable here (an authorized authorization does carry an `approvalDecisionId`), so
it is not a deadlock — it is a **conflation**. A record in state `authorized` proves a human
approved; it does not prove Core's eligibility check happened. Those are the two gates
`communication-model.md` §"Both gates, or nothing" insists must stay separate, and in this field they
have been collapsed into one.

### 3.5 `provider-accepted` is producible from an execution intent alone

`STATES_REQUIRING_INTENT = ['execution-submitted', 'provider-accepted']`. So `provider-accepted`
requires only that Core dispatched an intent.

`communication-state.ts` is explicit that this must not be possible:

> `execution submitted` is not `provider accepted`, and `provider accepted` is not `delivered`.

An intent proves dispatch. Provider acceptance is a fact only the provider knows, reported through
n8n and **recorded by Core** — that is `CommunicationResultV1` / `ExecutionResultV1`. The schema
currently lets a `provider-accepted` record be minted from the dispatch alone, which is the precise
"one confident tick" defect the vocabulary exists to prevent. This is the mirror image of §2.1:
there, the schema is too strict to be satisfiable; here it is too loose to be meaningful.

### 3.6 Five states require no evidence whatsoever

Probed across all eighteen with a minimal record and no evidence ids:

| Requires nothing          | Requires `approvalDecisionId` | Requires `executionIntentId` | Requires `executionResultId` |
| ------------------------- | ----------------------------- | ---------------------------- | ---------------------------- |
| `draft`                   | `rejected`                    | `execution-submitted`        | `delivered`                  |
| `authorization-requested` | `authorized`                  | `provider-accepted`          | `read`                       |
| `follow-up-requested`     | `scheduled`                   |                              | `answered`                   |
| `human-handoff-required`  |                               |                              | `no-answer`                  |
| `completed`               |                               |                              | `busy`                       |
| `cancelled`               |                               |                              | `failed`                     |
| `expired`                 |                               |                              |                              |

`draft`, `authorization-requested` and `follow-up-requested` are legitimately Jarvis-side
coordination facts, so requiring nothing is correct for them. The other four are not:

- **`completed`** — _"the lifecycle is closed and the authoritative outcome recorded."_ It is in
  `STATES_JARVIS_MAY_NOT_ORIGINATE`, and it requires **no evidence at all**. Anyone can mint one.
- **`expired`** — _"the intent expired before execution. **Not sent, and not approved**."_ An expiry
  is a fact about an `ExecutionIntentV1`, yet no intent id is required. A producer could compute
  expiry from a clock and assert it, which makes a Jarvis-side arithmetic result look like a Core
  outcome.
- **`cancelled`** — a cancellation is itself a request whose outcome **Core records**
  (`communication-model.md` §"Jarvis communication use cases"). No artifact is required, and — per
  §3.1 — no artifact could be cited even if one were.
- **`human-handoff-required`** — `HumanHandoffRecordV1` exists and is Core-issued, but it carries no
  id and the record has no slot for it (§3.2, §3.3).

### 3.7 `channel` is mandatory on a record that may have no authorized channel

`channel` is a required field. A `rejected` authorization is forbidden from naming an
`authorizedChannel`. So a `rejected` state record must state a channel Core never authorized — in
practice the _proposed_ channel from `CommunicationRequestV1`, presented in a field named as though
it were settled. Minor beside §2.1, but it is the same category of error: a field that reads as
authority carrying a value that is only a proposal.

### 3.8 Two divergent refusal vocabularies for the same refusals

| Concept             | `communication-state.ts` `COMMUNICATION_REJECTION_REASONS`          | `communication-authorization.ts` `COMMUNICATION_REFUSAL_REASONS`              |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| quiet hours         | `prohibited-quiet-hours`                                            | `quiet-hours`                                                                 |
| unverified identity | `unverified-recipient-identity`                                     | `identity-unverified`                                                         |
| opt-out             | `recipient-opted-out`                                               | `recipient-opted-out` ✓                                                       |
| consent withdrawn   | `consent-withdrawn`                                                 | `consent-withdrawn` ✓                                                         |
| do not contact      | `do-not-contact`                                                    | `do-not-contact` ✓                                                            |
| attempt limit       | `attempt-limit-reached`                                             | `attempt-limit-reached` ✓                                                     |
| —                   | `intent-expired`, `security-concern`, `legal-or-policy-restriction` | `suppressed`, `stop-received`, `purpose-not-approved`, `channel-not-eligible` |

Both are published. Neither is enforced (`reasonCode` is an open machine token by design, which is
correct — Core owns its taxonomy). But a producer copying `authorization.reasonCode` straight into
`record.reasonCode` yields a record whose reason is absent from the state-side list, and the
architecture's promise that an opt-out is _"countable"_ depends on consumers checking a list. Two
lists, two spellings, one concept.

---

## 4. `STATES_JARVIS_MAY_NOT_ORIGINATE` audit

```ts
export const STATES_JARVIS_MAY_NOT_ORIGINATE: readonly CommunicationState[] = [
  'authorized',
  'delivered',
  'completed',
];
```

**Finding 1 — nothing enforces it.** A repository-wide search finds three references: the
declaration, the barrel re-export, and a contracts test asserting the list equals itself. No schema,
no runtime and no producer consults it. It is documentation shaped like a control.

**Finding 2 — it is under-inclusive against the ownership model.** By §5's matrix, the states Jarvis
may not originate are every Core-authority and provider-outcome state:

| In the list                            | Missing from the list, but equally not Jarvis's                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorized`, `delivered`, `completed` | `rejected`, `scheduled`†, `execution-submitted`, `provider-accepted`, `read`, `answered`, `no-answer`, `busy`, `failed`, `cancelled`, `expired` |

† `scheduled` is arguable — scheduling is named a Jarvis responsibility, but the state requires a
Core decision id, so the schema already treats it as Core-derived. The audit flags the ambiguity
rather than resolving it.

The evidence-id requirements partially compensate for the omissions — but only partially, and not at
all for `cancelled`, `expired` and `completed`, which require nothing (§3.6). So for the three states
where the list is the _only_ control, the list is inert.

---

## 5. The eighteen-state evidence matrix

Columns: **Origin** — who may create the fact. **Evidence** — the canonical artifact that could
justify it. **V1 required** — what the schema demands today. **Representable** — can V1 carry the
state without inventing authority. **Pre-S3?** — producible before Core protocol adoption.
**Provenance gap** — does a shape-valid record still fail to prove the fact.

| #   | State                     | Origin                                        | Evidence artifact                                 | V1 requires              | Representable                                      | Pre-S3 | Provenance gap                                   | Fail-closed                       |
| --- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | ------------------------ | -------------------------------------------------- | ------ | ------------------------------------------------ | --------------------------------- |
| 1   | `draft`                   | Jarvis coordination                           | `CommunicationRequestV1` (S1)                     | —                        | **yes**                                            | yes    | none — Jarvis's own fact                         | n/a                               |
| 2   | `authorization-requested` | Jarvis coordination                           | `CommunicationRequestV1` (S1)                     | —                        | **yes**                                            | yes    | record cannot cite the request (§3.3)            | refuse without a request          |
| 3   | `rejected`                | **Core**                                      | `CommunicationAuthorizationV1` (`rejected`)       | `approvalDecisionId`     | **NO — deadlock** (§2.1)                           | no     | forbidden field is the only slot                 | **BLOCKED**                       |
| 4   | `authorized`              | **Core**                                      | `CommunicationAuthorizationV1` (`authorized`)     | `approvalDecisionId`     | partial — cites approval, not authorization (§3.4) | no     | authorization not citable (§3.2)                 | refuse without authorization      |
| 5   | `scheduled`               | Jarvis coordination over a Core authorization | `CommunicationAuthorizationV1` + Jarvis schedule  | `approvalDecisionId`     | partial — same conflation                          | no     | schedule itself is unevidenced                   | refuse without authorization      |
| 6   | `execution-submitted`     | **Core** dispatch                             | `ExecutionIntentV1`                               | `executionIntentId`      | **yes**                                            | no     | intent must be Core-issued and verified          | refuse without intent             |
| 7   | `provider-accepted`       | provider → n8n → **Core**                     | `CommunicationResultV1` / `ExecutionResultV1`     | `executionIntentId` only | **over-permissive** (§3.5)                         | no     | intent proves dispatch, not acceptance           | **must require a result**         |
| 8   | `delivered`               | provider → **Core**                           | `ExecutionResultV1` / `CommunicationResultV1`     | `executionResultId`      | **yes**                                            | no     | result must be Core-recorded                     | refuse without result             |
| 9   | `read`                    | provider → **Core**                           | as above                                          | `executionResultId`      | **yes**                                            | no     | as above                                         | as above                          |
| 10  | `answered`                | provider → **Core**                           | as above                                          | `executionResultId`      | **yes**                                            | no     | as above                                         | as above                          |
| 11  | `no-answer`               | provider → **Core**                           | as above                                          | `executionResultId`      | **yes**                                            | no     | as above                                         | as above                          |
| 12  | `busy`                    | provider → **Core**                           | as above                                          | `executionResultId`      | **yes**                                            | no     | as above                                         | as above                          |
| 13  | `failed`                  | provider or execution → **Core**              | as above                                          | `executionResultId`      | **yes**                                            | no     | as above                                         | as above                          |
| 14  | `follow-up-requested`     | Jarvis coordination                           | Jarvis decision; a follow-up is a **new** request | —                        | **yes**                                            | yes    | none                                             | n/a                               |
| 15  | `human-handoff-required`  | Jarvis requests; **Core** records             | `HumanHandoffRequestV1` / `HumanHandoffRecordV1`  | —                        | **under-constrained**                              | partly | neither artifact has an id; no slot (§3.2, §3.3) | refuse without a handoff artifact |
| 16  | `completed`               | **Core**                                      | `CommunicationResultV1` (`completed`)             | —                        | **under-constrained** (§3.6)                       | no     | in the may-not-originate list, requires nothing  | **must require a result**         |
| 17  | `cancelled`               | Jarvis requests; **Core** records outcome     | **NONE** — result contract forbids it (§3.1)      | —                        | **NO — gap**                                       | no     | no artifact exists to cite                       | **BLOCKED**                       |
| 18  | `expired`                 | **Core** records the outcome                  | `ExecutionIntentV1` expiry, Core-recorded         | —                        | **under-constrained** (§3.6)                       | no     | computable from a clock; looks like a Core fact  | **must require an intent**        |

### Summary counts

- **Hard-blocked (cannot be produced lawfully at all):** `rejected`, `cancelled` — **2**
- **Over-permissive (producible without adequate evidence):** `provider-accepted`, `completed`,
  `expired`, `human-handoff-required` — **4**
- **Conflated evidence (cites the wrong artifact):** `authorized`, `scheduled` — **2**
- **Cannot cite their own source artifact:** `authorization-requested` (request), plus all of the
  above that need an authorization, result or handoff — **structural, §3.3**
- **Safe and correct today:** `draft`, `follow-up-requested`, `execution-submitted`, `delivered`,
  `read`, `answered`, `no-answer`, `busy`, `failed` — **9**, of which only **`draft`** and
  **`follow-up-requested`** are producible before S3/S4/S5.

**So a V1-based S2 producer could, today, lawfully emit exactly two states: `draft` and
`follow-up-requested`.** `authorization-requested` is Jarvis's own fact and would be a third, except
that the record cannot cite the request that justifies it.

---

## 6. Provenance: where trust actually begins

### 6.1 The literal is not the boundary

`canonical-event.ts` comments the `source` field _"Always QuickFurno Core. The literal is the
boundary."_ **It is not.** `quickfurnoCoreSchema` is a `z.literal`, and a literal constrains a
string; it does not authenticate an origin. Any caller can hand-construct
`{ issuer: 'quickfurno-core', … }` and it will parse. The same is true of
`CommunicationAuthorizationV1.issuer`, `CommunicationResultV1.issuer` and
`HumanHandoffRecordV1.issuer`.

**A producer whose security argument is "the object says `quickfurno-core`, therefore Core produced
it" has no security argument.**

### 6.2 Where it does begin

`@qf-jarvis/event-ingestion` is _"the trust boundary in front of the event log"_, and its public
composition is `createEventIngestor` — **verify → prepare → persist**, in that order:

1. **`verifySignature`** — Ed25519 over the **exact raw bytes**, against a registered public key,
   under a domain separator and key purpose, inside a freshness window (ADR-0027). This is the only
   step that establishes origin.
2. **`prepareValidatedEvent`** — strict UTF-8, BOM rejection, `JSON.parse`, duplicate-key scan, then
   validation against the authoritative contracts registry, then a frozen snapshot bound to a
   semantic digest (ADR-0029, ADR-0030). Contract validation runs **behind** signature verification,
   never in front of it.
3. **`storeValidatedEvent`** — durable, transactional persistence with idempotency and conflict
   handling (ADR-0032).

**An accepted, stored canonical event is the repository's only existing proof that Core said
something.** Its envelope `eventId` is therefore the natural evidence handle — and it is exactly the
handle `CommunicationStateRecordV1` has no field for (§3.3).

### 6.3 What S2 may trust

| Input                                                                  | Trust                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| An event accepted by `createEventIngestor` and stored                  | **Authenticated Core fact.** May originate a Core-owned state.                                  |
| A bare `CommunicationAuthorizationV1` / `CommunicationResultV1` object | **Untrusted structural input.** Shape only.                                                     |
| Any `issuer` / `source` literal                                        | **No evidential weight whatsoever.**                                                            |
| A `CommunicationRequestV1` from the S1 producer                        | Jarvis's own fact. Sufficient for Jarvis-side coordination states only.                         |
| A lifecycle-runtime `consistent` verdict                               | **Not proof a state is true.** ADR-0110 says so: _"a consistent transition is not permission."_ |
| `previousState`                                                        | Evidence, never authority. The record contract says so.                                         |

---

## 7. The mandatory questions, answered

1. **Is `rejected` representable from a lawful rejected `CommunicationAuthorizationV1`?** **No.**
   Proved in §2.1. The two schemas are disjoint on `approvalDecisionId`.
2. **What contract change would be required?** A state-record version whose evidence slot for a
   communication decision is the **communication authorization** (or the authenticated event that
   carried it), not an `ApprovalDecisionV1` id. See §8.
3. **Can `provider-accepted` be produced from `ExecutionIntentV1` alone?** **It must not be — and
   today it can.** §3.5. This is a defect in the required-evidence table, not merely a producer risk.
4. **Which artifact proves `provider-accepted`?** A Core-recorded `CommunicationResultV1` (or the
   `ExecutionResultV1` behind it) whose `lifecycleState` is `provider-accepted`. Note the result
   contract already forbids that state carrying `outcome: 'succeeded'` — the distinction is kept
   there and lost in the state record.
5. **Can `cancelled` be safely produced pre-execution with existing contracts?** **No.** §3.1: the
   only artifact that reports `cancelled` mandates two execution ids that cannot exist pre-execution.
6. **What records a Core cancellation before an intent exists?** **Nothing.** There is no
   cancellation event and no cancellation-capable result. A genuine gap.
7. **Can `expired` come from an intent-expiry calculation?** **No.** Expiry must be a Core-recorded
   outcome. Today the schema requires no intent id at all, so a clock computation would parse (§3.6).
8. **What proves `scheduled` rather than `authorized`?** Nothing in the contract. Both require the
   same field. The schedule itself — the instant Jarvis intends to act — is not carried anywhere.
9. **What proves `authorization-requested` rather than "an object exists"?** Nothing citable. The
   record has no `communicationRequestId` slot (§3.3). S1 now produces a real request; the state
   record cannot name it.
10. **What proves `human-handoff-required`?** `HumanHandoffRequestV1` (Jarvis asks) or
    `HumanHandoffRecordV1` (Core records). Neither has an id, and the record has no slot (§3.2/3.3).
11. **What proves `completed`?** A Core-recorded `CommunicationResultV1` with
    `lifecycleState: 'completed'`. The record requires nothing (§3.6).
12. **Which states are under-constrained?** `provider-accepted`, `completed`, `cancelled`, `expired`,
    `human-handoff-required`, and `authorization-requested` (cannot cite its source).
13. **Which are over-constrained or contradictory?** `rejected` (contradictory — §2.1); `authorized`
    and `scheduled` (constrained to the _wrong_ artifact — §3.4); and, in the sibling result
    contract, `rejected` and `cancelled` (contradictory — §3.1).
14. **Does `STATES_JARVIS_MAY_NOT_ORIGINATE` match the ownership model?** **No** — under-inclusive by
    eleven states, and enforced by nothing. §4.
15. **Does the schema encode the evidence needed for auditability?** **No.** It can cite three of the
    seven relevant artifacts and none of the communication-specific ones. §3.3.
16. **Is the canonical event envelope the intended authority wrapper?** Yes — and it is the _only_
    mechanism in the repository that can authenticate a Core fact (§6.2). But the envelope's identity
    is not reachable from inside the record it carries.
17. **Candidate record, or transform of authenticated events?** For Jarvis-owned states, a candidate
    record is correct. For every Core-owned state, Jarvis must **transform an authenticated Core
    event**, never originate. That is a different component from the one ADR-0132 named.
18. **Could a caller fabricate a shape-valid object with the right literals?** **Yes.** §6.1.
19. **Where does provenance become trustworthy?** `verifySignature` → `prepareValidatedEvent` →
    `storeValidatedEvent`, composed as `createEventIngestor`. §6.2.
20. **Should S2 consume raw artifacts, authenticated events, or both?** **Both, with a hard split by
    ownership** — raw Jarvis-side artifacts may justify Jarvis-side states only; every Core-owned
    state requires an authenticated, stored canonical event.

---

## 8. Options evaluated

### Option A — keep V1, implement a safe subset

The producible subset is **`draft` and `follow-up-requested`** (§5), with
`authorization-requested` blocked only by a missing citation slot. A "state producer" that cannot
express a refusal, a delivery, a cancellation or a completion is not the S2 the plan describes, and
shipping it under that name would suggest the lifecycle is covered when the two most safety-critical
states — `rejected` and `completed` — are the ones missing. **Rejected as the whole of S2.** It
survives only as the Jarvis-coordination half of a split slice (§9).

### Option B — `CommunicationStateRecordV2` with explicit provenance

Add an evidence discriminator plus the missing citation slots:

- `evidenceEventId` — the envelope `eventId` of the authenticated, stored Core event that carried the
  fact. This is the single field that turns "the object says Core" into "Core said it, and here is
  the accepted event".
- `communicationRequestId`, `communicationAuthorizationRef`, `communicationResultId`,
  `handoffRef` — so each state cites its own artifact rather than borrowing `approvalDecisionId`.
- `rejected` requires the **authorization** evidence, never an approval decision.
- `provider-accepted`, `completed` require a **result**; `expired` requires an **intent**.

**Cost, stated honestly:** `CommunicationStateRecordV1` is the payload of
`qf.communication.state-recorded@2` (`payload-registry.ts`). Changing the record shape is a breaking
payload change, so under ADR-0013 it needs `qf.communication.state-recorded@3`, a registry entry, new
fixtures, and lifecycle-runtime handling for both versions **without a tolerant fallback**. It also
requires §3.2 to be solved first: `CommunicationAuthorizationV1` has no id to cite, so either it gains
one (its own V2) or the reference is `communicationRequestId` + `decidedAt`. And Core must eventually
emit the new version — which makes it **partly an S3 conversation**, not a purely Jarvis-side one.

**This is the correct destination.** It is not a change this readiness PR may make.

### Option C — keep the shape, consume authenticated events

Fixes provenance (§6) but not representability: V1 still demands `approvalDecisionId` for `rejected`,
so an authenticated `qf.communication.authorization-recorded@2` carrying a lawful refusal still
cannot be turned into a valid `rejected` record. **Necessary but not sufficient.** It is the
provenance half of Option B.

### Option D — Core owns the record; Jarvis projects, never produces

The strongest reading of _"Core owns authoritative communication history"_. Jarvis would hold a
**reducer/projection** over authenticated `qf.communication.*` events and originate nothing.

It is very likely right for the twelve Core-owned states, and it would mean **ADR-0132's S2 is
mis-named**: the deliverable is a projection, not a producer. But it cannot be adopted wholesale
today, because Core emits none of these events yet (no adopted transport — S3/S4/S5), and because
`draft`, `authorization-requested` and `follow-up-requested` genuinely _are_ Jarvis's own facts with
no Core event behind them. **Adopt its principle; reject it as a total answer.**

### Option E — minimum versioned repair, then the producer

The narrowest repair that unblocks the deadlock alone: remove `rejected` from
`STATES_REQUIRING_DECISION` and require communication-authorization evidence instead.

Even this is not free — it changes what a published payload accepts. And it leaves §3.1 (`cancelled`
has no artifact), §3.5 (`provider-accepted` from an intent), §3.6 (four unevidenced states) and §3.3
(nothing citable) untouched. **A repair that fixes the one reported symptom and leaves five known
defects is worse than one deliberate version.**

### Recommendation

**Option B, scoped by Option D's principle, staged as Option A's safe subset.**

1. **Now (owner decision, not this PR):** approve `CommunicationStateRecordV2` +
   `qf.communication.state-recorded@3`, designed to §8-B, with the authorization-identity question
   (§3.2) resolved as part of it.
2. **Then:** split S2 (§9).
3. **Never:** invent an `approvalDecisionId` for a refusal, or produce a Core-owned state from a
   Jarvis-side artifact.

---

## 9. Consequences for ADR-0132's sequencing

**S2 should be split.**

- **S2a — Jarvis coordination states (`draft`, `authorization-requested`, `follow-up-requested`).**
  Jarvis's own facts. Needs no Core event. Blocked today only by the missing
  `communicationRequestId` citation — which is itself part of the V2 design.
- **S2b — Core-owned states.** A **projection over authenticated Core events**, not a producer. It
  requires `CommunicationStateRecordV2` **and** an adopted Core transport.

**Core becomes a prerequisite earlier than ADR-0132 says.** The plan asserts S2 has "no Core
dependency" and is implementable entirely inside qf-jarvis. That is true only for the three
Jarvis-side states. For the other fifteen it is not: twelve need an authenticated Core event that no
adopted transport delivers, and two (`rejected`, `cancelled`) need a contract Core must also adopt.
**S2b depends on S3, and the V2 contract design should be folded into S3's protocol adoption rather
than invented unilaterally in Jarvis.**

This does not change S1, which is merged and unaffected, and it changes no activation posture:
production rollout remains **OFF**.

---

## 10. What this audit did not do

No contract was modified. No producer was written. No `V2` or `@3` was created. No migration was
allocated, and the `0010`–`0012` ledger drift is untouched. No Core endpoint, header, key or
signature format was invented. No runtime was activated and no communication path was opened.

**The next step is an owner decision on Option B, not code.**
