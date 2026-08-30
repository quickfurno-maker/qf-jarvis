# ADR-0134 — QFJ-P09 S2 communication-state evidence alignment prerequisite

**Status:** Proposed (readiness audit; implemented on a feature branch / PR, **not merged**)
**Date:** 2026-08-30
**Phase ownership:** **QFJ-P09** (execution gateway and communication lifecycle). A bounded
prerequisite to **slice S2** of
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md). **No new phase is created.
There is no QFJ-P13 and no AVG-13.**
**Baseline:** `eefe32cc75d05b22bc112bf8c60093087b78758b` (merge of PR #174 / S1)
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0001](./ADR-0001-source-of-truth-boundary.md),
[ADR-0002](./ADR-0002-recommend-authorize-execute-model.md),
[ADR-0008](./ADR-0008-controlled-communication-capability.md),
[ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md),
[ADR-0014](./ADR-0014-governed-lifecycle-contracts.md),
[ADR-0018](./ADR-0018-governed-request-communication-and-control-contracts.md),
[ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md),
[ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md),
[ADR-0110](./ADR-0110-qfj-p09-05-communication-lifecycle-transition-runtime.md),
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md),
[ADR-0133](./ADR-0133-qfj-p08-powerless-communication-request-producer.md),
[communication-model.md](../architecture/communication-model.md) and
[versioning-and-compatibility.md](../contracts/versioning-and-compatibility.md).

Audit: [01-communication-state-evidence-audit.md](../reports/qfj-p09-s2-communication-state-readiness/01-communication-state-evidence-audit.md).

---

## Context

ADR-0132 sequenced **S2 — the QFJ-P09 `CommunicationStateRecordV1` producer** as the second
implementation slice, with **"no Core dependency"**, implementable entirely inside qf-jarvis, on the
grounds that early lifecycle states are constructible from Jarvis-side evidence and later ones are
structurally blocked by required Core ids.

That reasoning was checked against the merged schemas before any producer was written. **It does not
hold.** The full audit is linked above; the load-bearing findings are:

1. **`rejected` is unrepresentable.** `CommunicationStateRecordV1` requires `approvalDecisionId` for
   `rejected`. `CommunicationAuthorizationV1` **forbids** `approvalDecisionId` when
   `outcome === 'rejected'`. The two schemas are disjoint, so a lawful Core refusal — the opt-out case
   the architecture cares most about — cannot become a `rejected` state record without attaching a
   human approval id to a decision no human made. `communication-model.md` explicitly backs the
   authorization: a rejection _"must **not** name an approval decision."_
2. **The repository's own fixture already makes that forbidden move.**
   `validCommunicationRejectedOptOut` attaches `FIXTURE_IDS.decision` to a record whose explanation
   reads _"QuickFurno Core refused: the recipient is on do-not-contact."_ It is also the payload of a
   shipped canonical-event fixture. No producer could do better.
3. **`CommunicationResultV1` cannot report a pre-execution `rejected` or `cancelled`** either: it
   offers both states and mandates `executionIntentId` and `executionResultId`, which cannot exist
   before dispatch. The same gap reaches **`expired` on the `scheduled → expired` path**, where an
   intent may exist but an execution result never can. So **no canonical artifact can evidence a
   pre-execution refusal, a pre-execution cancellation, or a pre-dispatch expiry.**
4. **`CommunicationStateRecordV1` cannot cite four of the seven relevant artifacts.** It has slots for
   an approval decision, an execution intent and an execution result — and none for a communication
   request, a communication authorization, a communication result or a human handoff, nor for the
   identity of an authenticated canonical event. `approvalDecisionId` is serving as a general-purpose
   "Core decided" slot it was never typed for.
5. **Seven states are producible with no evidence whatsoever**, of which only `draft` legitimately
   should be; and **`provider-accepted` is producible from an execution intent alone**, which is
   precisely the _"submission is not acceptance"_ defect the state vocabulary exists to prevent.
6. **`authorized` and `scheduled` cite the wrong artifact** — a human `ApprovalDecisionV1` rather than
   Core's `CommunicationAuthorizationV1`, collapsing the two gates the model insists stay separate.
7. **`STATES_JARVIS_MAY_NOT_ORIGINATE` is enforced by nothing** and names three of the thirteen states
   that are not Jarvis's to originate.
8. **`source: 'quickfurno-core'` is a schema literal, not provenance.** Any caller can write it. The
   only mechanism in this repository that authenticates a Core fact is `createEventIngestor` — Ed25519
   signature verification over exact raw bytes, then contract validation _behind_ it, then durable
   storage.

A producer built on point 8's fallacy, or one that resolved point 1 by inventing an id, would
manufacture authorization and delivery truth. That is the failure this architecture exists to prevent,
so it is worth a deliberate stop.

### What owner review corrected in the first revision

The first revision of this ADR proved the defects correctly and then over-reached on the replacement
design. Four corrections, each carried into §4 and §6:

- It treated **`authorization-requested`** as buildable from the existence of a
  `CommunicationRequestV1`. The model defines that state as _"a communication request has been
  **submitted to Core**"_, and S1 only **constructs** one. **Construction is not submission.**
- It called **`follow-up-requested`** independently pre-Core. The graph permits it only from `read`,
  `no-answer` or `busy` — all Core-recorded provider outcomes.
- It filed **`human-handoff-required`** as a Core-owned fact. `HumanHandoffRequestV1` is
  `producingSystem: qf-jarvis` (enforced) and `HumanHandoffRecordV1` is `issuer: quickfurno-core`
  (enforced). The **state is the Jarvis-side escalation**, gated on a trusted prior `answered`.
- It proposed **`CommunicationAuthorizationV2`** merely to obtain an id, and pre-committed to
  **`qf.communication.state-recorded@3`**. Neither is justified — see §4 and §5.

## Decision

### 1. S2 is BLOCKED as specified. No producer is written.

The `CommunicationStateRecordV1` producer described by ADR-0132 is **not implemented**, and must not
be until the evidence model is repaired. This ADR records the reason and the design space; it ships no
production code, no contract change and no activation.

### 2. The forbidden repairs, named so they are not reached for later

None of the following may be used to unblock S2:

- inventing an `approvalDecisionId` for a Core communication refusal, or copying an unrelated human
  approval id onto one;
- weakening `CommunicationAuthorizationV1`'s rejection rules so a refusal may carry an approval;
- letting founder or human approval override a consent refusal in any direction;
- re-mapping `rejected` to a different lifecycle state, or adding an `opted-out` nineteenth state;
- treating `reasonCode`, `previousState`, an `issuer`/`source` literal, or a lifecycle-runtime
  `consistent` verdict as authority;
- **asserting `authorization-requested` from a constructed request** — construction is not submission;
- letting `provider-accepted`, `delivered`, `read` or `answered` be asserted from an execution intent
  or a provider report that Core has not recorded;
- editing a published contract or event version in place.

### 3. Fact ownership has three tiers, not two

The binary "Jarvis states vs everything else" split produced the errors listed above. The
authoritative model supports three tiers, distinguished by _what must already be true_:

| Tier                                               | States                                                                                                                                                                    | Precondition                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **A — Jarvis-local**                               | `draft`                                                                                                                                                                   | none                                                        |
| **B — Jarvis coordination over trusted authority** | `authorization-requested`, `scheduled`, `follow-up-requested`, `human-handoff-required`                                                                                   | a real submission, or a trusted prior Core/provider outcome |
| **C — Core-authoritative / provider outcome**      | `rejected`, `authorized`, `execution-submitted`, `provider-accepted`, `delivered`, `read`, `answered`, `no-answer`, `busy`, `failed`, `completed`, `cancelled`, `expired` | an authenticated, accepted Core event                       |

**A = 1, B = 4, C = 13.** Jarvis owns the _act_ in Tier B; it never owns the _precondition_, and a
lifecycle-consistent shape is not evidence that the precondition holds.

### 4. Identity, provenance, and the reference between them

Three concepts, deliberately separated. The previous revision of this ADR collapsed the first two,
and that collapse is unsafe.

**4.1 Canonical event identity.** Every canonical event carries `eventId` in its **envelope**,
independent of its payload; confirmed for the authorization, result, handoff, intent and
execution-result events. `eventId` is the event's stable canonical identity and idempotency key.
**It is a name, not a credential.** Any caller can hand-construct the same string, exactly as any
caller can hand-construct `issuer: 'quickfurno-core'`.

**4.2 Accepted-event provenance.** Provenance is established by the **trusted path**, never by an
identifier:

> An event accepted through `createEventIngestor`'s **verify → prepare → persist** composition is
> trusted Core evidence. A bare contract artifact, a bare event envelope, a bare `eventId`, or a
> direct `@qf-jarvis/event-backbone` persistence record is **not sufficient by itself**.

That last exclusion is deliberate and load-bearing. `event-store.ts` states plainly that
`storeValidatedEvent` is a **trusted low-level primitive that verifies nothing** — no signature
verification, no contract parsing — and that _"that trust is a caller obligation, not a structural
guarantee this package can enforce"_. A row in the event table is therefore evidence of the caller's
discipline, not of Core's authorship; the guarantee lives in the ingestor composition above it.

**4.3 A source-event reference is a pointer to provenance, not provenance itself.** A future state
projection may retain a source event's `eventId` as an **audit and correlation pointer** — but only
where that reference arrived from a trusted accepted-event or trusted-projection input, or can be
resolved and verified against the accepted-event store.

> **A source-event id is a reference to provenance, not provenance itself.**

**S2 must therefore never accept a caller-supplied `sourceEventId` and treat it as authority merely
because the UUID claims to name a Core event.** Doing so would replace the signature check with a
naming convention.

**Consequences for the record repair.** `CommunicationAuthorizationV2` is **NOT required and is NOT
proposed**: the absence of a `communicationAuthorizationId` is a real observation, not a reason to
version a published contract, because an accepted event already gives the authorization a citable
name. That is a reason **not to add a payload id**; it is **not** a claim that the name authenticates
anything. A payload id may be proposed later only if a _separate semantic_ need is proved; none is
proved here.

### 5. The record repair, designed but not authorized

The likely destination for the record is a versioned repair carrying explicit provenance:

- **Two distinct notions, which the first revision conflated under one `evidenceEventId`:**
  - **envelope provenance** — the identity of the event transporting _this record_. Already supplied
    by the canonical envelope; **not a payload field**, and self-referential if written as one.
  - **source evidence** — a **reference to** the _prior_ accepted Core event (authorization, result,
    intent, handoff) that **justifies** this state. `sourceEventId`, or a discriminated reference
    naming both artifact kind and event id, is more accurate. Per §4.3 such a reference is a pointer
    that must be **obtained from, or resolved against, a trusted accepted-event input** — it is never
    self-authenticating. **The name, shape and resolution rule are deliberately not fixed here.**
- **Per-artifact citation slots**, so each state names its own evidence instead of borrowing
  `approvalDecisionId`.
- **`rejected` requires communication-authorization evidence, never an approval decision.**
- **`provider-accepted` and `completed` require a result.**
- **`expired` requires authoritative evidence whose exact artifact is UNRESOLVED** — see §7.

**This ADR does not implement the repair.** Its exact shape depends on §6, which is an owner decision.

### 6. The authorship question is OPEN, and `@3` is not pre-committed

The first revision proposed a record repair **and** `qf.communication.state-recorded@3` together,
without noticing they belong to different architectures.

**Model 1 — Core-authored state event.** Core emits `@3`; the envelope authenticates the record;
Jarvis projects it. _For:_ one authoritative statement of where a communication stands; no Jarvis
derivation logic to disagree with Core. _Against:_ Core would have to author Tier A and Tier B facts
that are Jarvis's, having first been told them; and it needs new Core-side work on top of S3.

**Model 2 — Jarvis projection over authenticated primitives.** Core emits the primitives it already
has (`authorization-recorded`, `result-recorded`, `human-handoff-recorded`, `intent-issued`,
`execution.result-recorded`); Jarvis derives a **local** projection over **accepted** events and
authors only its Tier A/B facts. _For:_ no new Core event type for Tier C; matches
`communication-lifecycle-runtime`, already a validator over records rather than an authority.
_Against:_ Jarvis holds derivation logic; `cancelled` and `expired` still have no primitive to project
from; the projection is Jarvis-local truth and must never be presented as Core history — **and it is
blocked today by the read surface, below.**

**Model 2 has an unmet prerequisite in this repository.** It cannot simply be said that "the
projection already carries the source event id". `packages/event-backbone/src/projections/projection-event-reader.ts`
deliberately returns **metadata only** — its `SELECT` lists exactly `position`, `event_type`,
`event_version` and `accepted_at`, and its own comment states it _"never reads a payload, event id,
subject, correlation id, causation id, source, signature, or any digest"_. So:

- the accepted-event store **does** hold `event_id`, and `eventId` is the canonical identity (§4.1);
- but the **current projection-handler input exposes neither `eventId` nor payload**;
- therefore a future Model-2 implementation **requires an owner-approved, provenance-bearing
  event-read / projection input surface before S2c can consume source evidence at all.**

That surface must **preserve the existing trust boundary** — it may widen what an accepted event
exposes to a handler, and it must **not** become a general arbitrary event-store lookup that lets a
caller fetch and cite any row while bypassing verify → prepare → persist. **It is not designed,
authorized or implemented here, and `projection-event-reader.ts` is not modified by this PR.**

**Audit of the existing `qf.communication.state-recorded@2`.** It is an original Phase-2
architecture-lifecycle event. **`@2` was not a communication-specific redesign** — `canonical-events-v2.ts`
records that all 41 inherited events were bumped uniformly for privacy hardening under ADR-0026 §5, and
its payload is still `communicationStateRecordV1Schema`. The communication-specific events arrived
later as governance events, and `governance-events.ts` says of the authorization event: **_"This is the
event that proves a refusal happened."_** That names the authorization event, not `state-recorded`, as
the proof of a refusal — evidence that the newer primitives may have absorbed part of what
`state-recorded` was for.

**Verdict: `qf.communication.state-recorded@3` is UNRESOLVED — required under Model 1, plausibly
unnecessary under Model 2. `@2`'s intended authorship was never explicitly decided and may be partly
redundant; whether it remains, versions, retires or becomes historical-only follows from the model
choice.** **Nothing is registered or retired here, and no model is chosen here.**

### 7. `expired` evidence is left OPEN, deliberately

The first revision's "`expired` must require an execution intent" is **withdrawn**. The authoritative
document is ambiguous about whether an `ExecutionIntentV1` exists at `scheduled`: the state table and
the scheduling section imply it does, while the execution-flow sequence diagram issues the intent to
n8n only in the branch the vocabulary calls `execution-submitted`. And even where an intent does
exist, `CommunicationResultV1` cannot report the expiry, because it also demands an `executionResultId`
that a never-dispatched intent never produces.

**`expired` requires authoritative evidence whose exact artifact is unresolved.** Settling it depends
on when Core issues an intent — a Core fact this repository cannot determine, and therefore an **S3
audit question**. No expiry contract is invented here.

### 8. S2 splits by tier, and Core is a prerequisite far earlier than ADR-0132 says

- **S2a — Tier A.** `draft` only. No Core dependency; buildable once the record can cite the S1
  request.
- **S2b — Tier B.** `authorization-requested` (needs the **S4** transport and a real submission),
  `scheduled`, `follow-up-requested`, `human-handoff-required` (each needs trusted prior Core or
  provider outcomes — **S3**, then **S5/S7**).
- **S2c — Tier C.** Thirteen states projected from authenticated Core events. Needs the chosen
  authorship model, the record repair, **S3**, and for provider outcomes **S5** and **S7** — and, under
  Model 2, an owner-approved provenance-bearing event-read surface, because today's projection input
  exposes neither `eventId` nor payload (§6).

ADR-0132's "no Core dependency" claim holds for **one** of eighteen states. The plan is updated to say
so. **ADR-0132's S1 decision, and the merged S1 implementation, are unaffected.**

### 9. S1 status reconciliation

PR #174 merged at `eefe32cc75d05b22bc112bf8c60093087b78758b`. ADR-0133 and the two canonical status
documents said "implemented on a feature branch / PR, not merged"; they are corrected to Accepted /
Merged with the PR number and merge SHA. **No S1 design or production code is altered.** Note that S1
constructs a request and submits nothing — see §3, Tier B.

## Consequences

- **The safety property is preserved by stopping.** No component in the repository can manufacture a
  communication authorization, delivery or completion fact.
- Three safety-critical states (`rejected`, `cancelled`, `expired`) are now known to be unrepresentable
  on at least one lawful path, and the gaps are written down rather than coded around.
- The `provider-accepted`-from-intent hole and the six inadequately-evidenced states are recorded as
  defects in the **existing merged contract**, not as producer risks. They exist on `main` today.
- The owner has two decisions to make — the authorship model (§6), then the record repair (§5) — before
  any S2 code is written.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Implement S2 for the safe subset only.** The subset is `draft` alone. A "state producer" that can
  express only the start state is not S2. Retained as the first piece of S2a.
- **Narrowly repair `STATES_REQUIRING_DECISION`.** Fixes the one reported symptom and leaves six
  documented defects, while still changing what a published payload accepts. Rejected as worse than one
  deliberate version.
- **Consume authenticated events without changing the record.** Fixes provenance, not
  representability — `rejected` stays impossible. Necessary, insufficient.
- **Add `communicationAuthorizationId` to the authorization contract.** Rejected: an accepted event
  already gives the authorization a citable name through its envelope `eventId`, so a payload id adds
  nothing. Note this is an argument against a redundant identifier, **not** a claim that the id
  authenticates the artifact — see §4.
- **Make Core the sole author and have Jarvis never produce a record.** This is Model 1; correct for
  Tier C and wrong for Tiers A and B, which are genuinely Jarvis's.
- **Add an `opted-out` nineteenth state.** Explicitly forbidden: it forks the lifecycle and lets a
  consumer handle `rejected` while ignoring the one refusal that must never be ignored.

## Compliance

Every finding was reproduced by parsing fixtures through the **built** schemas, not read from comments.
The reproductions are pinned as characterization tests in
`packages/contracts/src/tests/communication-state-evidence-characterization.test.ts`, which passes
against the contracts exactly as they stand and asserts current behaviour — including the
contradictions — so that a future one-sided "fix" fails loudly instead of silently. Those tests pin
**current V1 behaviour only**; they encode no position on the open authorship model.

**No production code changed. No contract changed. No registry changed. No Core access, no n8n, no
provider, no message sent, no persistence, no migration. Production rollout OFF. Runtime activation
unchanged.**
