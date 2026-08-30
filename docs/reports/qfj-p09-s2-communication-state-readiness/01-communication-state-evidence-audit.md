# QFJ-P09 S2 readiness — communication-state evidence and provenance audit

**Status:** Readiness audit. **No production code, no contract change, no activation.**
**Baseline:** `eefe32cc75d05b22bc112bf8c60093087b78758b` (merge of PR #174 / S1)
**Owning decision:** [ADR-0134](../../decisions/ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md)
**Slice under audit:** **S2 — QFJ-P09 `CommunicationStateRecordV1` producer**, from
[ADR-0132](../../decisions/ADR-0132-aarohi-real-execution-integration-planning.md).

**Verdict up front: S2 cannot be implemented as planned against `CommunicationStateRecordV1`.** Three
of the eighteen states have no lawful representation on at least one lawful path, five parse on
insufficient or no evidence, and two require the wrong artifact. **Exactly one state — `draft` — is
both adequately modelled today and buildable with no Core dependency of any kind.** Every claim is
proved executably below against the built contracts, not argued from prose.

**This revision incorporates owner review of PR #175.** The first revision over-stated what is
buildable before Core integration: it treated `authorization-requested` as provable from the mere
existence of a `CommunicationRequestV1`, and `follow-up-requested` as independently pre-Core. Both
were wrong, and §4 replaces the binary "Jarvis states vs everything else" split that produced them.

---

## 1. Method

Every claim here was reproduced by parsing real fixtures through the **built** schemas in
`packages/contracts/dist`, not by reading comments. Where a comment and an executable schema
disagree, the schema is reported as the fact.

Nothing was modified to produce these results. The findings are pinned as characterization tests in
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
  approvalDecisionId: FIXTURE_IDS.decision, // <— a human approval id
  reasonCode: 'recipient-opted-out',
  explanation: 'QuickFurno Core refused: the recipient is on do-not-contact.',
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
| C2  | `cancelled` result, no execution ids | **false** — same                                             |

A refusal at `authorization-requested` has no execution intent, because nothing was ever dispatched.
A cancellation is defined by the model as _"cancelled **before execution**, while cancellation was
still permitted"_ — also no intent. So the result contract offers both states and then structurally
forbids the only circumstances in which they occur. It parses only if a producer **invents** two
execution identifiers, which is the same forbidden move as §2.3 in a second contract.

**Consequence:** there is no canonical artifact anywhere in `@qf-jarvis/contracts` that can lawfully
evidence a pre-execution `rejected` or `cancelled` communication.

### 3.2 The same gap reaches `expired` on the `scheduled → expired` path

The transition graph has two routes to `expired`: `scheduled → expired` and
`execution-submitted → expired`. A communication that expires while merely _scheduled_ was never
dispatched, so **no execution result exists** — and `CommunicationResultV1` requires one:

| Input                                                                          | Parses                                  |
| ------------------------------------------------------------------------------ | --------------------------------------- |
| `expired` result **with** `executionIntentId`, **without** `executionResultId` | **false** — missing `executionResultId` |

So the `scheduled → expired` path joins `rejected` and pre-execution `cancelled` as unrepresentable.
This is new: §3.1's defect is not confined to the two states that obviously predate execution.

### 3.3 `CommunicationAuthorizationV1` has no identity of its own

Its fields are `contractVersion`, `communicationId`, `communicationRequestId`, `issuer`, `outcome`,
`authorizedChannel`, `approvalDecisionId`, `decidedAt`, `reasonCode`, `explanation`, `policy`,
`correlationId`. There is **no `communicationAuthorizationId`**, and a repository-wide grep for one
returns nothing.

**This is a real observation, but §6.3 shows it is not by itself a reason to version the contract.**
The authenticated canonical event that carries an authorization already has an addressable identity.

### 3.4 The state record has no slot for four of the seven evidence artifacts

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
| `sourceEventId`                | REJECTED — unknown key |

The record's doc-comment promises _"a state that only exists because Core decided, dispatched, or
recorded something must carry the artifact that proves it."_ It keeps that promise for **execution**
(intent, result) and breaks it for **communication authorization**, **communication result** and
**human handoff** — for which it has nowhere to point at all. `approvalDecisionId` is doing duty as a
general-purpose "Core decided" slot it was never typed for. There is also no slot for the identity of
an authenticated canonical event, which §6 shows is the handle that actually carries provenance.

### 3.5 `authorized` and `scheduled` cite the wrong artifact

`authorized` requires `approvalDecisionId`. But `authorized` means _"Core validated and authorized it,
and recorded the decision"_ — that is `CommunicationAuthorizationV1`, not `ApprovalDecisionV1`. The
record is satisfiable here (an authorized authorization does carry an `approvalDecisionId`), so it is
not a deadlock — it is a **conflation**. A record in state `authorized` proves a human approved; it
does not prove Core's eligibility check happened. Those are the two gates `communication-model.md`
§"Both gates, or nothing" insists must stay separate, and in this field they have been collapsed into
one. The same applies to `scheduled`, which requires the same field.

### 3.6 `provider-accepted` is producible from an execution intent alone

`STATES_REQUIRING_INTENT = ['execution-submitted', 'provider-accepted']`. So `provider-accepted`
requires only that Core dispatched an intent.

`communication-state.ts` is explicit that this must not be possible:

> `execution submitted` is not `provider accepted`, and `provider accepted` is not `delivered`.

An intent proves dispatch. Provider acceptance is a fact only the provider knows, reported through
n8n and **recorded by Core**. The schema currently lets a `provider-accepted` record be minted from
the dispatch alone, which is the precise "one confident tick" defect the vocabulary exists to
prevent. This is the mirror image of §2.1: there, the schema is too strict to be satisfiable; here it
is too loose to be meaningful.

### 3.7 Seven states require no evidence whatsoever

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

**Only `draft` is legitimately unevidenced** (§4, Tier A). The other six each need something the
record cannot express:

- **`authorization-requested`** — _"A communication request has been submitted to Core."_ The record
  cannot cite the request, and nothing proves submission (§4.2).
- **`follow-up-requested`** — reachable only from `read`, `no-answer` or `busy`, all Core- or
  provider-derived. The record cannot cite the prior outcome.
- **`human-handoff-required`** — `HumanHandoffRequestV1` exists and is Jarvis-produced, but it carries
  no id and the record has no slot for it.
- **`completed`** — _"the lifecycle is closed and the authoritative outcome recorded."_ It is in
  `STATES_JARVIS_MAY_NOT_ORIGINATE` **and** requires nothing. Anyone can mint one.
- **`cancelled`** — Core records the outcome, and per §3.1 no artifact can carry it.
- **`expired`** — see §7.

### 3.8 `channel` is mandatory on a record that may have no authorized channel

`channel` is a required field. A `rejected` authorization is forbidden from naming an
`authorizedChannel`. So a `rejected` state record must state a channel Core never authorized — in
practice the _proposed_ channel from `CommunicationRequestV1`, presented in a field named as though
it were settled.

### 3.9 Two divergent refusal vocabularies for the same refusals

| Concept             | `communication-state.ts` `COMMUNICATION_REJECTION_REASONS`          | `communication-authorization.ts` `COMMUNICATION_REFUSAL_REASONS`              |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| quiet hours         | `prohibited-quiet-hours`                                            | `quiet-hours`                                                                 |
| unverified identity | `unverified-recipient-identity`                                     | `identity-unverified`                                                         |
| opt-out             | `recipient-opted-out`                                               | `recipient-opted-out` ✓                                                       |
| consent withdrawn   | `consent-withdrawn`                                                 | `consent-withdrawn` ✓                                                         |
| do not contact      | `do-not-contact`                                                    | `do-not-contact` ✓                                                            |
| attempt limit       | `attempt-limit-reached`                                             | `attempt-limit-reached` ✓                                                     |
| —                   | `intent-expired`, `security-concern`, `legal-or-policy-restriction` | `suppressed`, `stop-received`, `purpose-not-approved`, `channel-not-eligible` |

Both are published; neither is enforced (`reasonCode` is an open machine token by design, which is
correct — Core owns its taxonomy). But a producer copying `authorization.reasonCode` straight into
`record.reasonCode` yields a record whose reason is absent from the state-side list, and the
architecture's promise that an opt-out is _"countable"_ depends on consumers checking a list.

---

## 4. Fact ownership: three tiers, not two

The first revision of this audit split the eighteen states into "three Jarvis states" and "everything
else". That split is wrong, and it produced two concrete errors (§4.2, §4.3). The authoritative model
supports **three** tiers, distinguished by _what must already be true_ before Jarvis may assert the
fact.

### Tier A — Jarvis-local

Facts Jarvis owns outright, requiring no prior Core authority and no prior lifecycle state.

**`draft`** — _"Being prepared. Nothing has been asked of anyone."_ The lifecycle's only start state.
**This is the whole of Tier A: one state.**

### Tier B — Jarvis coordination over trusted prior authority

Facts Jarvis originates, but only once something outside Jarvis is already true. **Jarvis owns the
act; it does not own the precondition**, and a lifecycle-consistent shape is not evidence that the
precondition holds.

| State                     | Jarvis's act                      | What must already be true                                         |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `authorization-requested` | submitting the request to Core    | a **real submission** over an adopted Core transport — see §4.2   |
| `scheduled`               | choosing a later execution moment | a **trusted Core authorization** — see §4.4                       |
| `follow-up-requested`     | deciding a follow-up is warranted | a **trusted prior `read`, `no-answer` or `busy`** — see §4.3      |
| `human-handoff-required`  | escalating: "stop, get a person"  | a **trusted prior `answered`** (the only inbound edge) — see §4.5 |

### Tier C — Core-authoritative or provider-outcome

Facts Jarvis **reflects and never originates**. Each requires authenticated Core evidence.

`rejected`, `authorized`, `execution-submitted`, `provider-accepted`, `delivered`, `read`, `answered`,
`no-answer`, `busy`, `failed`, `completed`, `cancelled`, `expired` — **thirteen states.**

`cancelled` is Tier C despite Jarvis originating the _request_: the model says _"Cancellation is
itself a request; **Core records the outcome**."_ The request is Jarvis's; the state fact is Core's.

**A = 1, B = 4, C = 13. Total = 18.**

### 4.2 `authorization-requested` is not proved by a request existing — correction

`communication-model.md` defines it as **"A communication request has been submitted to Core."**

S1 (`@qf-jarvis/communication-request-runtime`, merged) only **constructs** a request. It is composed
by nothing, and no Core communication-authorization transport exists — that is ADR-0132's **S4**,
which is not built. Therefore:

> **`CommunicationRequestV1` exists ≠ the request was submitted to Core.**

A producer that emitted `authorization-requested` on construction would assert that Core had been
asked when nothing had left the process. `authorization-requested` is a Jarvis coordination fact
(Tier B), and its precondition is a **real submission**, evidenced by whatever receipt the adopted S4
transport defines. **No transport, endpoint, header or receipt shape is invented here.**

### 4.3 `follow-up-requested` is not independently pre-Core — correction

The transition graph permits it only from `read`, `no-answer` and `busy` — all Core-recorded provider
outcomes. So while the **decision** to follow up is Jarvis's, and while the follow-up itself correctly
starts a _new_ lifecycle at `draft`, recording `follow-up-requested` on an existing lifecycle
presupposes a trusted prior outcome that only Core can supply.

It is Tier B, not Tier A, and it is **not** buildable before Core evidence exists.

### 4.4 `scheduled` is mixed provenance — correction

`communication-model.md` names scheduling a **Jarvis responsibility**: _"Jarvis **schedules an
authorized communication** for later execution."_ So `scheduled` is not simply Core-owned. But the
adjective is load-bearing — an _authorized_ communication — and the graph's only inbound edge is
`authorized → scheduled`.

Tier B: Jarvis's act, over a trusted Core authorization. The record's current demand for
`approvalDecisionId` is the §3.5 conflation, and the schedule itself — the instant Jarvis intends to
act — is carried nowhere at all.

### 4.5 `human-handoff-required` is a Jarvis escalation, not a completed Core handoff — correction

`human-handoff.ts` splits the two, and the schemas enforce it:

| Artifact                | Who produces it                             | Meaning                              |
| ----------------------- | ------------------------------------------- | ------------------------------------ |
| `HumanHandoffRequestV1` | `producingSystem: qf-jarvis` (**enforced**) | _"stop, get a person"_ — Jarvis asks |
| `HumanHandoffRecordV1`  | `issuer: quickfurno-core` (**enforced**)    | a human actually picked it up        |

Proved: the request schema **refuses** `quickfurno-core` as `producingSystem`, and the record schema
**refuses** `qf-jarvis` as `issuer`. The contract comment says it plainly: _"Jarvis asks for a human.
It does not appoint one."_

So `human-handoff-required` is the **request** side — Jarvis's escalation (Tier B), gated on a trusted
prior `answered`. The first revision mis-filed it as a Core-owned fact. Its missing identity and
citation slot (§3.4) remain a genuine V1 gap either way.

---

## 5. `STATES_JARVIS_MAY_NOT_ORIGINATE` audit

```ts
export const STATES_JARVIS_MAY_NOT_ORIGINATE: readonly CommunicationState[] = [
  'authorized',
  'delivered',
  'completed',
];
```

**Finding 1 — nothing enforces it.** A repository-wide search finds three references: the declaration,
the barrel re-export, and a contracts test asserting the list equals itself. No schema, no runtime and
no producer consults it. It is documentation shaped like a control.

**Finding 2 — it is under-inclusive.** Tier C holds thirteen states; the list names three. The ten
omissions are `rejected`, `execution-submitted`, `provider-accepted`, `read`, `answered`, `no-answer`,
`busy`, `failed`, `cancelled` and `expired`.

The evidence-id requirements partially compensate — but not for `cancelled`, `expired` or `completed`,
which require nothing (§3.7). For exactly those three, the list is the only control, and it is inert.

---

## 6. Provenance: where trust actually begins

### 6.1 The literal is not the boundary

`canonical-event.ts` comments the `source` field _"Always QuickFurno Core. The literal is the
boundary."_ **It is not.** `quickfurnoCoreSchema` is a `z.literal`, and a literal constrains a string;
it does not authenticate an origin. Any caller can hand-construct `{ issuer: 'quickfurno-core', … }`
and it will parse. The same is true of `CommunicationAuthorizationV1.issuer`,
`CommunicationResultV1.issuer` and `HumanHandoffRecordV1.issuer`.

**A producer whose security argument is "the object says `quickfurno-core`, therefore Core produced
it" has no security argument.**

### 6.2 Where it does begin

`@qf-jarvis/event-ingestion` is _"the trust boundary in front of the event log"_, and its public
composition is `createEventIngestor` — **verify → prepare → persist**, in that order:

1. **`verifySignature`** — Ed25519 over the **exact raw bytes**, against a registered public key, under
   a domain separator and key purpose, inside a freshness window (ADR-0027). This is the only step
   that establishes origin.
2. **`prepareValidatedEvent`** — strict UTF-8, BOM rejection, `JSON.parse`, duplicate-key scan, then
   validation against the authoritative contracts registry, then a frozen snapshot bound to a semantic
   digest (ADR-0029, ADR-0030). Contract validation runs **behind** signature verification, never in
   front of it.
3. **`storeValidatedEvent`** — durable, transactional persistence with idempotency and conflict
   handling (ADR-0032).

**An accepted, stored canonical event is the repository's only existing proof that Core said
something.**

### 6.3 The existing envelope already supplies the identity — no payload ids needed

Every canonical event carries `eventId` in its **envelope**, independent of its payload. Verified: a
`qf.communication.authorization-recorded@2` envelope wrapping a lawful rejection parses through
`safeParseCanonicalEvent` and carries an `eventId`. The same holds for
`qf.communication.result-recorded@2`, `qf.communication.human-handoff-recorded@2`,
`qf.execution.intent-issued@2` and `qf.execution.result-recorded@2`.

**So §3.3's "the authorization has no id" does not require `CommunicationAuthorizationV2`.** The
addressable handle for "the authorization that refused this" is the `eventId` of the accepted event
that carried it — which is also the handle that proves provenance, whereas a payload id would prove
only that somebody wrote a UUID.

**Design consequence: prefer existing authenticated event identity over adding an id to every
payload.** A payload id should be proposed only if a _separate semantic_ need is proved — for example
if an authorization must be citable where no event exists. No such need is proved here, so
**`CommunicationAuthorizationV2` is not required and is not proposed.**

### 6.4 What S2 may trust

| Input                                                           | Trust                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| An event accepted by `createEventIngestor` and stored           | **Authenticated Core fact.** May justify a Tier C state.                                |
| A bare `CommunicationAuthorizationV1` / `CommunicationResultV1` | **Untrusted structural input.** Shape only.                                             |
| Any `issuer` / `source` literal                                 | **No evidential weight whatsoever.**                                                    |
| A `CommunicationRequestV1` from the S1 producer                 | Jarvis's own fact. Proves a request was **built**, never that it was sent.              |
| A lifecycle-runtime `consistent` verdict                        | **Not proof a state is true.** ADR-0110: _"a consistent transition is not permission."_ |
| `previousState`                                                 | Evidence, never authority. The record contract says so.                                 |

---

## 7. `expired`: the evidence question is OPEN

The first revision asserted that `expired` must require an execution intent. **That is not proved, and
the authoritative document is itself ambiguous.** Recording the ambiguity rather than resolving it:

| Source                                                    | Says                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State table                                               | _"**expired** — The intent expired before execution."_ Implies an intent always exists.                                                                  |
| §"Scheduled communication does not carry stale authority" | _"An authorized-and-scheduled communication is still bound by the **expiry** of its execution intent"_ — implies an intent exists **while `scheduled`**. |
| Execution-flow sequence diagram                           | Core issues the intent **to n8n** in the authorized→execute branch — which the state vocabulary calls `execution-submitted`, i.e. **after** `scheduled`. |
| `COMMUNICATION_REJECTION_REASONS`                         | includes `intent-expired`, as a _refusal_ reason rather than an expiry artifact.                                                                         |

The two readings disagree about whether an `ExecutionIntentV1` exists at `scheduled`:

- **If it does**, `scheduled → expired` can cite an intent — but §3.2 proves `CommunicationResultV1`
  still cannot report it, because it also demands an `executionResultId` that a never-dispatched intent
  never produces.
- **If it does not**, `scheduled → expired` is an expiry of the _request or the authorization_, and
  **no artifact in the repository records that at all**.

Either way the current schema requires nothing, so a Jarvis-side clock computation would parse as a
Core outcome.

**Resolution: `expired` requires authoritative evidence whose exact artifact is UNRESOLVED.** It
depends on when Core issues an intent, which is a Core fact this repository cannot settle — an **S3
audit question**. No expiry contract is invented here, and the earlier "must require an intent"
recommendation is **withdrawn**.

---

## 8. The eighteen-state matrix

Nine independent columns, as the owner review requires. **No column is collapsed into another**, and
counts are published only for the dimensions in §8.1, which are disjoint and sum to 18.

| #   | State                     | Meaning (model)                         | Owner (§4) | Source artifact / event                                                                   | Trusted-provenance requirement           | Transition prerequisite                                       | V1 representable                      | V1 evidence adequate                       | Real-integration prerequisite | Proposed future handling                                                                          |
| --- | ------------------------- | --------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `draft`                   | being prepared; nothing asked of anyone | **A**      | Jarvis intent; optionally the S1 `CommunicationRequestV1`                                 | none — Jarvis's own fact                 | start state                                                   | **yes**                               | **yes**                                    | **none**                      | Jarvis-authored record                                                                            |
| 2   | `authorization-requested` | request **submitted to Core**           | **B**      | S4 submission receipt (**does not exist**)                                                | proof of submission, not of construction | `draft`                                                       | yes (shape)                           | **no** — cannot cite request or submission | **S4 transport**              | Jarvis-authored, citing a submission receipt                                                      |
| 3   | `rejected`                | Core refused; reason recorded           | **C**      | `CommunicationAuthorizationV1` (`rejected`) via `qf.communication.authorization-recorded` | accepted Core event                      | `authorization-requested`, `scheduled`                        | **NO — deadlock (§2.1)**              | **no**                                     | **S3 + S4**                   | projection from the accepted event                                                                |
| 4   | `authorized`              | Core validated and authorized           | **C**      | `CommunicationAuthorizationV1` (`authorized`), same event                                 | accepted Core event                      | `authorization-requested`                                     | partial — **mis-cited (§3.5)**        | **no** — cites approval, not authorization | **S3 + S4**                   | projection from the accepted event                                                                |
| 5   | `scheduled`               | authorized, held for later              | **B**      | Jarvis schedule **over** a trusted authorization                                          | trusted `authorized` + Jarvis's instant  | `authorized`                                                  | partial — **mis-cited (§3.5)**        | **no** — schedule instant carried nowhere  | **S3 + S4**                   | Jarvis-authored, citing the authorization event                                                   |
| 6   | `execution-submitted`     | Core dispatched an intent to n8n        | **C**      | `ExecutionIntentV1` via `qf.execution.intent-issued`                                      | accepted Core event                      | `authorized`, `scheduled`                                     | **yes**                               | **yes**                                    | **S3 + S5**                   | projection                                                                                        |
| 7   | `provider-accepted`       | provider accepted for transport         | **C**      | Core-recorded `CommunicationResultV1` / `ExecutionResultV1`                               | accepted Core event                      | `execution-submitted`                                         | **over-permissive (§3.6)**            | **no** — intent ≠ acceptance               | **S3 + S5 + S7**              | projection; must require a **result**                                                             |
| 8   | `delivered`               | the provider delivered                  | **C**      | `ExecutionResultV1` / `CommunicationResultV1`                                             | accepted Core event                      | `provider-accepted`                                           | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 9   | `read`                    | recipient read it                       | **C**      | as above                                                                                  | accepted Core event                      | `delivered`                                                   | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 10  | `answered`                | voice call answered                     | **C**      | as above                                                                                  | accepted Core event                      | `provider-accepted`                                           | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 11  | `no-answer`               | voice call not answered                 | **C**      | as above                                                                                  | accepted Core event                      | `provider-accepted`                                           | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 12  | `busy`                    | busy line                               | **C**      | as above                                                                                  | accepted Core event                      | `provider-accepted`                                           | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 13  | `failed`                  | execution or delivery failed            | **C**      | as above                                                                                  | accepted Core event                      | `execution-submitted`, `provider-accepted`                    | **yes**                               | **yes**                                    | **S3 + S5 + S7**              | projection                                                                                        |
| 14  | `follow-up-requested`     | outcome calls for a follow-up           | **B**      | Jarvis decision **over** a trusted outcome                                                | trusted `read` / `no-answer` / `busy`    | `read`, `no-answer`, `busy`                                   | yes (shape)                           | **no** — cannot cite the prior outcome     | **S3 + S5 + S7**              | Jarvis-authored, citing the outcome event; the follow-up itself starts a NEW lifecycle at `draft` |
| 15  | `human-handoff-required`  | a human must take over                  | **B**      | `HumanHandoffRequestV1` (**qf-jarvis-produced**, §4.5)                                    | trusted `answered`                       | `answered`                                                    | yes (shape)                           | **no** — request has no id; no slot        | **S3 + S5 + S7**              | Jarvis-authored, citing the request and the prior outcome                                         |
| 16  | `completed`               | lifecycle closed, outcome recorded      | **C**      | Core-recorded `CommunicationResultV1` (`completed`)                                       | accepted Core event                      | nine predecessor states                                       | **under-constrained (§3.7)**          | **no** — requires nothing                  | **S3 + S7**                   | projection; must require a **result**                                                             |
| 17  | `cancelled`               | cancelled before execution              | **C**      | **NONE** — result contract forbids it (§3.1)                                              | accepted Core event                      | `draft`, `authorization-requested`, `authorized`, `scheduled` | **NO — gap (§3.1)**                   | **no**                                     | **S3**                        | projection once Core can record a cancellation                                                    |
| 18  | `expired`                 | intent expired before execution         | **C**      | **UNRESOLVED (§7)**                                                                       | accepted Core event                      | `scheduled`, `execution-submitted`                            | **NO on the `scheduled` path (§3.2)** | **no** — requires nothing                  | **S3** (audit question)       | projection; artifact to be settled by S3                                                          |

### 8.1 Counts, on disjoint dimensions only

**By fact ownership (§4)** — A **1**, B **4**, C **13**. Sum **18**.

**By V1 adequacy** — each state in exactly one bucket:

| Bucket                                                             | States                                                                                                       | Count |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----- |
| **BLOCKED** — no lawful representation on at least one lawful path | `rejected`, `cancelled`, `expired`                                                                           | **3** |
| **MIS-CITED** — requires the wrong artifact                        | `authorized`, `scheduled`                                                                                    | **2** |
| **UNDER-EVIDENCED** — parses on insufficient or no evidence        | `authorization-requested`, `provider-accepted`, `follow-up-requested`, `human-handoff-required`, `completed` | **5** |
| **ADEQUATE**                                                       | `draft`, `execution-submitted`, `delivered`, `read`, `answered`, `no-answer`, `busy`, `failed`               | **8** |

Sum **18**.

**By real-integration prerequisite** — **none: 1** (`draft`) · **S4 transport: 1**
(`authorization-requested`) · **S3 and beyond: 16**. Sum **18**.

**The headline, stated exactly: exactly one state — `draft` — is both adequately modelled by V1 and
buildable with no Core dependency.** Every other state needs either a contract repair, authenticated
Core evidence, an adopted transport, or more than one of those.

---

## 9. The authorship question: two models, not yet chosen

The first revision proposed `CommunicationStateRecordV2` **and** `qf.communication.state-recorded@3`
together, without noticing they belong to different architectures. They must be compared before either
is authorized.

### 9.1 What `qf.communication.state-recorded@2` actually is

- It is an **original Phase-2 architecture-lifecycle event**, listed in `event-catalog.ts` beside
  `qf.approval.decision-recorded`, `qf.execution.intent-issued` and `qf.execution.result-recorded`.
- **`@2` was not a communication-specific redesign.** `canonical-events-v2.ts` states that _all_ 41
  inherited events were bumped to `@2` as a uniform privacy-hardening step under ADR-0026 §5. Nobody
  revisited what this event is _for_.
- Its payload is still `communicationStateRecordV1Schema` — the event version moved; the contract
  inside did not.
- **The communication-specific events came later and are described differently.**
  `governance-events.ts` introduces `qf.communication.authorization-recorded`, `result-recorded` and
  the two handoff events as "governance, privacy, and communication authority", and says of the
  authorization event: **_"This is the event that proves a refusal happened."_**

That sentence names the **authorization** event, not the state-recorded event, as the proof of a
refusal — direct evidence that the newer primitives may have absorbed part of what `state-recorded`
was originally for.

**Audit verdict on `@2`: its intended authorship was never explicitly decided, and it may be partly
redundant.** Whether it should remain, version, retire or become historical-only is an owner decision
that follows from §9.2–§9.3. **Nothing is registered or retired here.**

### 9.2 Model 1 — Core-authored state event

Core emits `qf.communication.state-recorded@3`; the envelope authenticates the record; Jarvis consumes
and projects it.

- **For:** one authoritative statement of "where this communication stands"; Jarvis holds no derivation
  logic that could disagree with Core; Tier C needs no per-state evidence rules because Core has
  already applied them.
- **Against:** it makes Core author a record whose Tier A and Tier B facts (`draft`,
  `authorization-requested`, `scheduled`, `follow-up-requested`, `human-handoff-required`) are
  **Jarvis's**, not Core's — Core would have to be told them first. It also requires a **new Core-side
  event**, which is Core work on top of S3.

### 9.3 Model 2 — Jarvis projection over authenticated primitives

Core emits the primitives it already has — `qf.communication.authorization-recorded`,
`qf.communication.result-recorded`, `qf.communication.human-handoff-recorded`,
`qf.execution.intent-issued`, `qf.execution.result-recorded` — and Jarvis derives a **local** state
projection from accepted events, authoring only its Tier A and Tier B facts.

- **For:** no new Core event type is needed for Tier C; every fact is anchored to an accepted event's
  `eventId` (§6.3); Jarvis's own coordination facts stay Jarvis's; it matches the existing
  `communication-lifecycle-runtime`, which is already a _validator over records_ rather than an
  authority. **In this model `qf.communication.state-recorded@3` may be unnecessary, and `@2` may be
  redundant.**
- **Against:** Jarvis holds derivation logic, so a bug produces a locally wrong view (though never a
  Core-authoritative one); `cancelled` and `expired` still have no primitive to project from (§3.1,
  §7); and the projection is Jarvis-local truth, which must never be presented as Core history.

### 9.4 Not chosen here

The two models imply different contracts, different Core work and different answers to "is `@3`
required". **ADR-0134 records the comparison and does not pick.** Picking is the owner decision this
PR exists to enable.

---

## 10. Options evaluated

### Option A — keep V1, implement a safe subset

The subset is **`draft`** alone (§8.1). A "state producer" that can express only the start state is not
S2. **Rejected as the whole of S2**; it survives only as the first, smallest piece of S2a.

### Option B — a versioned state-record repair carrying explicit provenance

Add the missing citations and an anchor to authenticated evidence:

- **A source-evidence reference distinct from the enclosing envelope.** The first revision called this
  `evidenceEventId` and was ambiguous: if the record becomes the payload of a state-recorded event,
  then "the event that carried the fact" is the record's _own_ envelope, which is self-referential and
  useless. The two ideas must be separated:
  - **envelope provenance** — the identity of the event that transports _this record_, already
    supplied by the canonical envelope and **not** a payload field;
  - **source evidence** — the identity of the _prior_ accepted Core event (authorization, result,
    intent, handoff) that **justifies** this state. A name like `sourceEventId`, or a discriminated
    reference naming both the artifact kind and the event id, is more accurate. **The field name and
    shape are not fixed here.**
- **Per-artifact citation slots** so each state names its own evidence rather than borrowing
  `approvalDecisionId`.
- **`rejected` requires communication-authorization evidence, never an approval decision.**
- **`provider-accepted` and `completed` require a result.** `expired` requires evidence whose artifact
  §7 leaves open.

**Cost.** `CommunicationStateRecordV1` is the payload of `qf.communication.state-recorded@2`, so under
ADR-0013 this is not an edit in place. Whether it additionally needs `@3` **depends on §9** — under
Model 2 the record may not travel as a Core event at all. **`CommunicationAuthorizationV2` is not
required** (§6.3).

**This is the likely destination for the record itself.** It is not a change this PR may make.

### Option C — keep the shape, consume authenticated events

Fixes provenance (§6) but not representability: V1 still demands `approvalDecisionId` for `rejected`,
so an authenticated authorization event carrying a lawful refusal still cannot become a valid
`rejected` record. **Necessary but not sufficient** — it is the provenance half of Option B.

### Option D — Core owns the record; Jarvis projects, never produces

The strongest reading of _"Core owns authoritative communication history"_, and it is Model 1 (§9.2).
Correct for Tier C. **Wrong as a total answer**, because Tiers A and B are genuinely Jarvis's — Core
cannot author `draft` without being told it first.

### Option E — minimum versioned repair, then the producer

Remove `rejected` from `STATES_REQUIRING_DECISION` and require authorization evidence instead. Even
this changes what a published payload accepts, and it leaves §3.1, §3.2, §3.4, §3.6 and §3.7
untouched. **A repair that fixes one symptom and leaves six documented defects is worse than one
deliberate version.**

### Recommendation

**Option B for the record, with the authorship model (§9) chosen first, and Tier-aware staging.**

1. **Owner decision, not this PR:** choose Model 1 or Model 2. That choice determines whether
   `qf.communication.state-recorded@3` is required at all, and what becomes of `@2`.
2. **Then** authorize the Option B record repair, sized to the chosen model.
3. **Then** build S2 in tier order (§11).
4. **Never:** invent an `approvalDecisionId` for a refusal, assert `authorization-requested` from a
   constructed request, or originate a Tier C fact from a Jarvis-side artifact.

---

## 11. Consequences for ADR-0132's sequencing

**S2 splits by tier, not in half.**

- **S2a — Tier A.** `draft` only. Jarvis's own fact, no Core dependency, buildable today once the
  record can cite the S1 request.
- **S2b — Tier B.** `authorization-requested`, `scheduled`, `follow-up-requested`,
  `human-handoff-required`. Jarvis authors them, but each needs a trusted precondition:
  `authorization-requested` needs the **S4** transport; the other three need trusted prior Core or
  provider outcomes (**S3**, then **S5/S7**).
- **S2c — Tier C.** Thirteen states, projected from authenticated Core events. Requires the chosen
  authorship model, the record repair, **S3**, and — for the provider outcomes — **S5** and **S7**.

**Core becomes a prerequisite far earlier than ADR-0132 says.** The plan asserts S2 has "no Core
dependency" and is implementable entirely inside qf-jarvis. That is true for **one** of eighteen
states. It is false for the other seventeen: four need trusted preconditions that only Core or an
adopted transport can supply, and thirteen need authenticated Core events that no adopted transport
delivers.

This changes nothing about S1, which is merged and unaffected, and no activation posture: production
rollout remains **OFF**.

---

## 12. What this audit did not do

No contract was modified. No producer was written. No `V2`, no `@3`, no registry change, no
lifecycle-runtime change, no ingestion change. No migration was allocated, and the `0010`–`0012`
ledger drift is untouched. No Core endpoint, header, key or signature format was invented, and no
expiry or submission-receipt contract was designed. No runtime was activated and no communication path
was opened.

**The next step is an owner decision on §9 and §10, not code.**
