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
   `outcome === 'rejected'`. The two schemas are disjoint, so a lawful Core refusal — the opt-out
   case the architecture cares most about — cannot become a `rejected` state record without
   attaching a human approval id to a decision no human made. `communication-model.md` explicitly
   backs the authorization: a rejection _"must **not** name an approval decision."_
2. **The repository's own fixture already makes that forbidden move.**
   `validCommunicationRejectedOptOut` attaches `FIXTURE_IDS.decision` to a record whose explanation
   reads _"QuickFurno Core refused: the recipient is on do-not-contact."_ It is also the payload of a
   shipped canonical-event fixture. No producer could do better.
3. **`CommunicationResultV1` cannot report a pre-execution `rejected` or `cancelled`** either: it
   offers both states and mandates `executionIntentId` and `executionResultId`, which cannot exist
   before dispatch. So **no canonical artifact anywhere can evidence a pre-execution refusal or
   cancellation.**
4. **`CommunicationStateRecordV1` cannot cite four of the seven relevant artifacts.** It has slots
   for an approval decision, an execution intent and an execution result — and none for a
   communication request, a communication authorization, a communication result or a human handoff.
   `approvalDecisionId` is serving as a general-purpose "Core decided" slot it was never typed for.
5. **`CommunicationAuthorizationV1` has no identity field at all**, so it cannot be cited by id even
   if a slot existed.
6. **Four states are producible with no evidence whatsoever** — `completed`, `cancelled`, `expired`,
   `human-handoff-required` — and `provider-accepted` is producible from an execution intent alone,
   which is precisely the _"submission is not acceptance"_ defect the state vocabulary exists to
   prevent.
7. **`STATES_JARVIS_MAY_NOT_ORIGINATE` is enforced by nothing** and omits eleven states that are
   equally not Jarvis's to originate.
8. **`source: 'quickfurno-core'` is a schema literal, not provenance.** Any caller can write it. The
   only mechanism in this repository that authenticates a Core fact is
   `createEventIngestor` — Ed25519 signature verification over exact raw bytes, then contract
   validation _behind_ it, then durable storage.

A producer built on point 8's fallacy, or one that resolved point 1 by inventing an id, would
manufacture authorization and delivery truth. That is the failure this architecture exists to
prevent, so it is worth a deliberate stop.

## Decision

### 1. S2 is BLOCKED as specified. No producer is written.

The `CommunicationStateRecordV1` producer described by ADR-0132 is **not implemented**, and must not
be until the evidence model is repaired. This ADR records the reason and the design; it ships no
production code, no contract change and no activation.

### 2. The forbidden repairs, named so they are not reached for later

None of the following may be used to unblock S2:

- inventing an `approvalDecisionId` for a Core communication refusal, or copying an unrelated
  human approval id onto one;
- weakening `CommunicationAuthorizationV1`'s rejection rules so a refusal may carry an approval;
- letting founder or human approval override a consent refusal in any direction;
- re-mapping `rejected` to a different lifecycle state, or adding an `opted-out` nineteenth state;
- treating `reasonCode`, `previousState`, an `issuer`/`source` literal, or a lifecycle-runtime
  `consistent` verdict as authority;
- letting `provider-accepted`, `delivered`, `read` or `answered` be asserted from an execution intent
  or a provider report that Core has not recorded;
- editing a published contract or event version in place.

### 3. The trust boundary is stated, once

**A literal is not provenance.** S2 may treat as an authenticated Core fact **only** an event that
passed `verifySignature` → `prepareValidatedEvent` → `storeValidatedEvent`. Everything else —
including a bare `CommunicationAuthorizationV1` or `CommunicationResultV1` object carrying
`issuer: 'quickfurno-core'` — is **untrusted structural input**, valid in shape and unproven in
origin.

Consequently: Jarvis-side artifacts may justify **Jarvis-side states only**. Every Core-owned state
requires an authenticated, stored canonical event.

### 4. The recommended path: Option B, scoped by Option D, staged as Option A

The audit evaluated five options. The recommendation is a `CommunicationStateRecordV2` that carries
explicit provenance and the missing citations:

- **`evidenceEventId`** — the envelope `eventId` of the authenticated, stored Core event that carried
  the fact. This single field is what turns _"the object says Core"_ into _"Core said it, and here is
  the accepted event."_
- **Per-artifact citation slots** so each state names its own evidence instead of borrowing
  `approvalDecisionId`.
- **`rejected` requires communication-authorization evidence, never an approval decision.**
- **`provider-accepted` and `completed` require a result; `expired` requires an intent.**

Scoped by Option D's principle: for Core-owned states Jarvis **projects authenticated events and
originates nothing**. Staged by Option A: the Jarvis-coordination states may land first.

**This ADR does not implement V2.** Doing so is a wire-contract change requiring owner authorization
(see §5), and smuggling one into a readiness task is exactly what this gate exists to prevent.

### 5. Versioning consequences, recorded not taken

`CommunicationStateRecordV1` is the payload of `qf.communication.state-recorded@2`. Under ADR-0013 a
type+version is permanent, so repairing the record is **not** an edit in place:

| Change                                                    | Consequence                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `CommunicationStateRecordV2`                              | new contract version; V1 retained, never widened                      |
| `qf.communication.state-recorded@3`                       | new event version; registry entry, fixtures, catalog                  |
| `CommunicationAuthorizationV2` (or a composite reference) | needed because V1 has **no id** to cite                               |
| `communication-lifecycle-runtime`                         | must handle both record versions with **no tolerant fallback**        |
| Core adoption                                             | Core must eventually emit `@3`; this is **partly an S3 conversation** |

### 6. S2 is split, and Core becomes a prerequisite earlier than ADR-0132 says

- **S2a — Jarvis coordination states** (`draft`, `authorization-requested`, `follow-up-requested`).
  Jarvis's own facts; no Core event needed. Today blocked only by the missing request citation.
- **S2b — Core-owned states.** A **projection over authenticated Core events**, not a producer.
  Requires V2 **and** an adopted Core transport, so **S2b depends on S3.**

ADR-0132's claim that S2 has "no Core dependency" holds for three of eighteen states and fails for
the other fifteen. The plan is updated to say so. **ADR-0132's S1 decision, and the merged S1
implementation, are unaffected.**

### 7. S1 status reconciliation

PR #174 merged at `eefe32cc75d05b22bc112bf8c60093087b78758b`. ADR-0133 and the two canonical status
documents said "implemented on a feature branch / PR, not merged"; they are corrected to Accepted /
Merged with the PR number and merge SHA. **No S1 design or production code is altered.**

## Consequences

- **The safety property is preserved by stopping.** No component in the repository can manufacture a
  communication authorization, delivery or completion fact.
- Two safety-critical states (`rejected`, `cancelled`) are now known to be unrepresentable, and the
  gap is written down rather than coded around.
- The `provider-accepted`-from-intent hole and the four unevidenced states are recorded as defects in
  the **existing merged contract**, not as producer risks. They exist on `main` today.
- The owner has a decision to make — approve the V2 design, or direct a different path — before any
  S2 code is written.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Implement S2 for the safe subset only.** The producible set is `draft` and
  `follow-up-requested`. A "state producer" missing refusal, delivery, cancellation and completion
  would imply coverage that does not exist. Retained only as S2a.
- **Narrowly repair `STATES_REQUIRING_DECISION`.** Fixes the one reported symptom and leaves five
  documented defects, while still changing what a published payload accepts. Rejected as worse than
  one deliberate version.
- **Consume authenticated events without changing the record.** Fixes provenance, not
  representability — `rejected` stays impossible. Necessary, insufficient.
- **Make Core the sole author and have Jarvis never produce a record.** Correct for the twelve
  Core-owned states and wrong for the three that are genuinely Jarvis's, and unadoptable today
  because Core emits none of these events yet.
- **Add an `opted-out` nineteenth state.** Explicitly forbidden: it forks the lifecycle and lets a
  consumer handle `rejected` while ignoring the one refusal that must never be ignored.

## Compliance

Every finding was reproduced by parsing fixtures through the **built** schemas, not read from
comments. The reproductions are pinned as characterization tests in
`packages/contracts/src/tests/communication-state-evidence-characterization.test.ts`, which passes
against the contracts exactly as they stand and asserts current behaviour — including the
contradictions — so that a future one-sided "fix" fails loudly instead of silently.

**No production code changed. No contract changed. No Core access, no n8n, no provider, no message
sent, no persistence, no migration. Production rollout OFF. Runtime activation unchanged.**
