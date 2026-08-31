# ADR-0135 — QFJ-P09 S2 local communication-state projection architecture

**Status:** Accepted. **MERGED** as PR #176, merge commit `eebee71e4e156608e2e04e60802b9d24b33140f5`. Its D1 prerequisite — the fresh read-only Core audit — is delivered by [ADR-0136](./ADR-0136-qfj-p10-s3-fresh-quickfurno-core-audit.md), which **confirms Model 2 and reopens nothing**.
**Date:** 2026-08-30
**Phase ownership:** **QFJ-P09** (execution gateway and communication lifecycle). A bounded
architecture decision for **slice S2** of
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md). **No new phase is created.
There is no QFJ-P13 and no AVG-13.**
**Baseline:** `c6b21dcf921e350f33477d3b18fd4413b8a8aa00` (merge of PR #175 / S2 readiness audit)
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0134](./ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md) — **its findings
are locked input to this decision** — plus
[ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md),
[ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md),
[ADR-0044](./ADR-0044-qfj-p03-09-subject-activity-projection.md),
[ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md),
[ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md),
[communication-model.md](../architecture/communication-model.md) and
[versioning-and-compatibility.md](../contracts/versioning-and-compatibility.md).

Design: [communication-state-projection-v2-design.md](../architecture/communication-state-projection-v2-design.md).

---

## Context

ADR-0134 proved that the planned `CommunicationStateRecordV1` producer must not be built, and closed
without choosing between two architectures:

- **Model 1** — QuickFurno Core authors a state event (`qf.communication.state-recorded@3`); Jarvis
  projects it.
- **Model 2** — Jarvis derives a **local** state projection from primitive Core events, and authors
  only its own coordination facts.

Leaving that open blocks everything downstream: the shape of a future `CommunicationStateRecordV2`,
whether a new Core event is needed, and what evidence a projector may consume. This ADR closes it.

**ADR-0134's twenty findings are locked and are not re-litigated here** — including the `rejected`
deadlock, the missing artifacts for pre-execution `cancelled` and one lawful `expired` path, the
Tier A/B/C ownership split, and the rule that an `eventId` is identity and never provenance.

## Decision

### 1. Model 2 is adopted

> **Jarvis maintains a LOCAL communication-state projection derived from authenticated, ADOPTED
> primitive QuickFurno Core events, and authors only its own coordination facts.**

Core stays authoritative for consent, eligibility, authorization and every provider outcome. Jarvis
consumes only trusted accepted evidence, derives a local projection for orchestration and
observability, and **never presents that projection as Core's authoritative business history**.
`communication-lifecycle-runtime` stays a consistency validator; **no transition gains authority by
being graph-valid**. **No canonical contradiction blocks Model 2.**

### 2. Candidate contracts are not adopted Core emissions

Three things must not be conflated:

**A.** repository-defined **candidate** canonical contracts (`qf.communication.authorization-recorded`,
`result-recorded`, `human-handoff-recorded`, `qf.execution.intent-issued`, `execution.result-recorded`)
— all defined **here**, in `@qf-jarvis/contracts`; **B.** live/adopted Core **emission capability** —
**not established**; **C.** Core protocol/event **gaps**, to be discovered by S3.

> Model 2 projects from authenticated, **adopted** primitive Core events. qf-jarvis already defines
> candidate canonical contracts for several required facts. **S3 must verify which of those facts the
> current pinned Core can actually expose or adopt before D2 freezes the integration contract.**

This ADR does **not** claim Core emits any of them today — that is precisely why S3 is next.

### 3. Model 1 is rejected for the current MVP

Not on principle, but because it is strictly larger. Model 2 **avoids a mandatory new
`qf.communication.state-recorded@3` event and avoids making Core echo Jarvis Tier A/B facts**. It
**MAY still require targeted Core protocol/event adoption** for primitive facts S3 finds absent —
cancellation, expiry, dispatch/submission, or candidate emissions not yet adopted. Model 1 would incur
every one of those costs **plus** the new state event and the Tier A/B echo, and is all-or-nothing
rather than tier-by-tier.

If a future external consumer genuinely needs one authoritative Core-published state fact, that is its
own adoption decision, taken then.

### 4. The generic projection boundary is NOT widened

`ProjectionEvent` stays **metadata-only** (`position`, `eventType`, `eventVersion`, `acceptedAt`). Its
own comment calls widening _"a deliberate, ADR-gated decision — not a convenience edit"_, and widening
the shared type would hand payload access to every present and future projection to avoid writing one
narrow module.

### 5. A purpose-bounded reader is a DATA-ACCESS pattern, not an authentication boundary

The future communication-state projection gets a narrow, internal, allowlisted, position-keyed,
root-unexported, lint-restricted evidence reader that re-parses every stored value fail closed.

**ADR-0044's `projection-subject-reader` is a valid precedent for:** purpose-bounded read access ·
position-keyed lookup · a root-unexported module · restricted import · field minimisation.

**It is NOT a precedent for:** authenticating event origin · proving an event passed
`createEventIngestor` · granting authority to payload content.

> **Joining `projection_event_position → qf_jarvis.event` and re-parsing the payload proves
> REACHABILITY and SHAPE — never ORIGIN.** A designated reader cannot "upgrade" an unauthenticated row
> into provenance merely because only one handler imports it.

**Authority rule for a future evidence object.** It MAY be treated as authoritative only after
**BOTH**: (1) the source event is bound to the governed accepted-event trust path — which requires
§6's **D2a** hardening; **AND** (2) the purpose-specific reader has re-parsed and minimised it. **The
designated reader alone is not enough.**

### 6. D2a write-path hardening is a PREREQUISITE, not an option

The repository currently proves: `storeValidatedEvent` is exported from the **root barrel**;
`EventPersistenceRecord` is **caller-constructible**; the primitive performs **no signature
verification and no contract parsing**; `event-store.ts` says trust is a **caller obligation**; **no
repository-wide containment rule** confines it to `event-ingestion` (nine packages/apps already depend
on the package); direct SQL under a granted role is possible. Therefore **a row in `qf_jarvis.event`
does not, by itself, prove Core origin**, and **re-parsing proves shape, not origin**.

So write-path/capability hardening is **locked as a bounded prerequisite**:

**D2a — accepted-event write-path / provenance-capability hardening.** An architecture-step label, not
a new QFJ phase.

**D4 (evidence reader) MUST depend on D2a. D5 Tier B/C projection may not consume reader output as
authority before D2a + D4.**

Minimum invariant D2a must establish:

- **A.** Only the governed event-ingestion composition may use the supported event-write primitive.
- **B.** Repository code has **no supported bypass** around that primitive for `qf_jarvis.event` writes.
- **C.** The reader's trusted type/capability is produced **only** from that governed path.
- **D.** **A direct database administrator or infrastructure actor remains OUTSIDE the
  application-code trust guarantee** unless a DB-level capability boundary is separately adopted.

**What code containment can and cannot claim.** It can make the invariant **structural within the
reviewed application code**. It **cannot** defend against an already-privileged database operator: the
current role/grant posture may still permit a privileged direct SQL write, and ADR-0044's own boundary
already concedes the analogous point — its control holds _"even though the shared projection DB role
technically holds the column grant."_ **Whether separate DB role/grant hardening is needed must be
proved by the future hardening slice against the actual migration and grant model. This ADR allocates
NO migration**; if grant separation is required, that slice must justify it under migration governance.

The minimum hardening to **design, not implement** — import/API containment; narrowing the primitive
off the root barrel (a public-API change needing its own slice if breaking); repository-wide
direct-write containment on `qf_jarvis.event`; a purpose-owned evidence capability not constructible
by arbitrary projection code; and negative containment tests — is specified in design §6.4.

**Post-hoc re-verification, honestly.** The signature commits to
`"qf-jarvis-event-v1" ‖ keyId ‖ signedAt ‖ hex(sha256(rawBody))` and every component is persisted, so
the Ed25519 check **is** re-runnable from a stored row. But **the raw signed bytes are not stored** —
only their digest — so it proves _"a body with this digest was signed"_, not that the stored payload
**is** that body. `semantic_event_digest` detects later mutation but is Jarvis-computed and is **not a
Core attestation**. **No cryptographic fact is invented.**

### 7. The allowlist is re-audited; only two entries are locked

Necessity must be proved before payload access is granted; nothing is carried "just in case".

| Event type                                | State(s)                                                                                         | Status                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qf.communication.authorization-recorded` | `rejected`, `authorized`                                                                         | **LOCKED** — the outcome _is_ the fact, and nothing else carries it                                                                                                                                                                |
| `qf.communication.result-recorded`        | `provider-accepted`, `delivered`, `read`, `answered`, `no-answer`, `busy`, `failed`, `completed` | **LOCKED** — `lifecycleState` is the Core-recorded outcome                                                                                                                                                                         |
| `qf.execution.intent-issued`              | `execution-submitted`                                                                            | **CONDITIONAL / UNRESOLVED** — §8                                                                                                                                                                                                  |
| `qf.execution.result-recorded`            | —                                                                                                | **removed pre-S3** — `CommunicationResultV1` already carries `lifecycleState`, `outcome`, `failure` and both execution ids, so no state derivation needs the execution-side twin                                                   |
| `qf.communication.human-handoff-recorded` | —                                                                                                | **removed pre-S3** — it does not justify `human-handoff-required` (Jarvis's _request_, ADR-0134 §4.5) and does not justify `completed` (which needs a Core-recorded result). **No lifecycle state is currently derivable from it** |

**Separately, a Tier-B coordination candidate — NOT part of the Tier-C authority allowlist.** Do not
confuse the Tier-C authority events with every input the hybrid local view needs:

| Event type                                 | State                    | Status                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qf.communication.human-handoff-requested` | `human-handoff-required` | **CONDITIONAL candidate.** Payload `HumanHandoffRequestV1`; **Jarvis is the artifact producer** (`producingSystem: qf-jarvis`, enforced); the **canonical event is Core-recorded**. **Not** `human-handoff-recorded`. Live/adopted availability requires **S3/D2**; trusted use requires **D2a + D4** |

Field minimisation (design §5.4) applies to the two locked Tier-C entries; a conditional candidate
earns a minimisation row only when it is admitted.

### 8. `execution-submitted` evidence is UNRESOLVED

`communication-model.md` defines the state as **"Core dispatched an authorized execution intent to
n8n."** `qf.execution.intent-issued` is documented as _"QuickFurno Core issued a bounded, expiring
execution intent to n8n."_ **Issuance is not dispatch**, and the repository does not prove the event
is emitted only after a successful n8n submission:

- the event is named `intent-issued`, not `intent-dispatched`, and `event-catalog.ts` carries no
  dispatch vocabulary;
- `ExecutionIntentV1.executor` is a **literal naming n8n as the intended executor** — an address, not
  a delivery receipt;
- **`execution-dispatch-runtime` (ADR-0090) states the Core → n8n edge is not built:** _"The wire
  protocol is PROPOSED. Core does not sign this way yet and the execution side does not verify this
  way yet."_

This is the same correction already applied to `authorization-requested`: **construction/issuance ≠
submission.**

**Therefore:** `qf.execution.intent-issued` proves a Core-issued intent exists; `execution-submitted`
requires evidence that Core actually **dispatched** it to n8n. Whether the existing event is emitted
only after successful dispatch, or whether a distinct transport receipt or dispatch event is needed,
must be verified during **S3 / D2** and the **S5** transport design. **Until then the source evidence
for `execution-submitted` is UNRESOLVED**, and no dispatch event name, receipt schema, n8n endpoint or
delivery acknowledgement is invented here.

### 8a. Tier A/B facts need a durable, ordered replay source — D2b

The complete communication canonical-event surface is **five** events (`authorization-recorded`,
`result-recorded`, `human-handoff-requested`, `human-handoff-recorded`, `state-recorded`). **No
canonical event records a communication draft, a submission, or a schedule**, and no durable
Jarvis-local store holds communication coordination state — migrations `0008`/`0009` are
conversation-control and the approval queue.

| State                         | Jarvis artifact                                                                      | Durable today                       | Core-recorded event today                                                     | Other replayable store | Ordering                      | Rebuildable              | Status          |
| ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------- | ---------------------- | ----------------------------- | ------------------------ | --------------- |
| `draft` (A)                   | S1 constructs a `CommunicationRequestV1` — **construction is not durable recording** | **NO**                              | **NO**                                                                        | **NO**                 | undefined                     | **NO**                   | **UNRESOLVED**  |
| `authorization-requested` (B) | an S4 submission receipt                                                             | **NO** — artifact itself unresolved | **NO**                                                                        | **NO**                 | undefined                     | **NO**                   | **UNRESOLVED**  |
| `scheduled` (B)               | a Jarvis scheduling act and instant                                                  | **NO**                              | **NO**                                                                        | **NO**                 | undefined                     | **NO**                   | **UNRESOLVED**  |
| `follow-up-requested` (B)     | a Jarvis follow-up decision                                                          | **NO**                              | **NO**                                                                        | **NO**                 | undefined                     | **NO**                   | **UNRESOLVED**  |
| `human-handoff-required` (B)  | **`HumanHandoffRequestV1`**, Jarvis-produced (enforced)                              | not yet                             | **`qf.communication.human-handoff-requested` exists as a candidate contract** | n/a                    | Core position, **if adopted** | yes, if adopted + D2a/D4 | **CONDITIONAL** |

**Two inferences are forbidden.** `scheduled` must **not** be inferred from `requestedTiming` in
`CommunicationRequestV1` — that is a _request_, not a record that Jarvis scheduled anything. And
`follow-up-requested` must **not** be inferred merely because a later `CommunicationRequestV1` exists,
unless a canonical causation/correlation contract proves the mapping; a later attempt is a **new
request, not a retry**.

**Read model ≠ source of fact.** Explicitly forbidden: _"Jarvis decides the state, writes the
projection row, therefore it is durable."_ A projection is **derived** state; **a direct write without
an independent replayable source turns a cache into authority and makes rebuild impossible.** If a
Tier A/B fact is persisted, its source evidence must exist independently of the read model. A
process-memory fact never becomes durable truth, and no state is reconstructed from timestamps or
heuristics alone.

**Ordering.** Core positions give gap-free ordering for Core-recorded events. If Jarvis-local
coordination evidence ever lives outside that stream, its order relative to Core evidence must be made
deterministic by a mechanism decided later. **Not by** wall-clock sorting, `createdAt` comparison, UUID
ordering, last-writer-wins, or process arrival order. **The mechanism is not invented here.**

**The rebuild rule.**

> A durable/rebuildable `CommunicationStateRecordV2` view may contain a state **only when every fact
> used to derive that state has a durable, replayable, deterministically ordered evidence source.**

**ADR-0043-style deterministic rebuild is a REQUIREMENT, not yet a proved property of the full
communication view.** Tier-C reconstruction can use ordered accepted Core events once D2a/D4 exist;
Tier A/B additionally requires durable ordered coordination evidence. **Until those sources are
resolved, full 18-state rebuild is NOT certified**, and the currently rebuildable subset is **none**.

**Options — evaluated, not chosen (this is D2b).** **A:** Core records Jarvis-produced primitive
coordination artifacts — already the pattern behind `qf.recommendation.created` and
`qf.communication.human-handoff-requested`; one gap-free ordering, existing rebuild machinery, no
second Jarvis log; costs targeted Core adoption, and **an unsubmitted `draft` cannot naturally be
Core-recorded**. **B:** a separate durable Jarvis coordination log — new persistence, independent
replay, its own ordering proof, likely schema work; **fallback only**. **C:** some states stay
ephemeral/runtime-only and are excluded from the durable view — a possible MVP simplification that
would have to name exactly which states are durable and stop claiming full rebuild. **No A/B/C choice
is forced before S3.**

**D2b — Tier A/B durable coordination-evidence + ordering decision** is added to the sequence (§11).
**D3 may not freeze an evidence variant for an unresolved Tier A/B state, and D5 may not implement a
state until its durable source and ordering are decided.**

### 9. `CommunicationStateRecordV2` — semantics decided, implementation not

Under Model 2, V2 is a **Jarvis-local projection/read-model contract**, not automatically a Core wire
payload. Locked semantics and per-state requirements are in design §7. The load-bearing ones: V1 stays
immutable; `ApprovalDecisionV1` is never again generic "Core decided" evidence; V2 structurally
distinguishes Tier A/B/C evidence; **a caller-provided event id is never authority** — the runtime
takes evidence objects from the governed reader **over a D2a-hardened write path**; no consent
snapshot, DNC flag, suppression cache, `canSend`, `canExecute`, `authorizedUntil` or reusable
permission; no nineteenth state; no invented cancellation, expiry or dispatch contract; `rejected`
cites communication-**authorization** refusal evidence, never a human approval id;
`authorization-requested` proves **submission**, not construction; `provider-accepted` and the provider
outcomes require Core-recorded result evidence.

**Tier A/B durable-source status (§8a):** `draft` **UNRESOLVED** · `authorization-requested`
**UNRESOLVED** · `scheduled` **UNRESOLVED** · `follow-up-requested` **UNRESOLVED** ·
`human-handoff-required` **CONDITIONAL** on `qf.communication.human-handoff-requested` /
`HumanHandoffRequestV1`, subject to S3/D2 adoption and D2a/D4 trust. State meaning and ownership are
unchanged from ADR-0134.

**Deliberately unresolved until S3 / D2 / D2b:** `cancelled` evidence · `expired` evidence ·
**`execution-submitted` dispatch evidence** · the S4 submission receipt · `channel` semantics · which
candidate contracts the current Core can expose or adopt · **and the durable ordered evidence source
for `draft`, `authorization-requested`, `scheduled` and `follow-up-requested`.** **No Zod or
TypeScript is written here.**

### 10. Versioning

- **`qf.communication.state-recorded@3` is NOT required under Model 2 and is not scheduled.**
- **`@2` remains published compatibility and history**; not the Model-2 source of truth, and **not
  retired here**.
- **`CommunicationAuthorizationV2` is NOT required.**
- V2 is **not** added to the canonical Core event registry merely because it is a contract.

### 11. Sequence, with trust hardening as an explicit dependency

**D0** this decision → **D1** S3 fresh read-only Core audit → **D2** Core protocol/event gap decision →
**D2a** write-path / provenance-capability hardening · **D2b** Tier A/B durable coordination-evidence

- ordering decision → **D3** V2 contract → **D4** trusted evidence-read capability →
  **D5** tiered projection → **D6** S4/S5/S7 integration per ADR-0132 → **D7** certification →
  **D8** staged activation.

**Dependencies:** **D3 depends on D2 + D2b** for any Tier A/B evidence variant it freezes · **D4
depends on D2a** · **D5 depends on D3 + D4 + D2b** · transport-dependent states still wait for
S4/S5/S7 evidence · `execution-submitted` cannot become a valid projected fact until §8 is settled.
**If D2b chooses Core-recorded primitive coordination events, D4 may serve both Tier B and Tier C; if
it requires a separate local evidence store, that implementation and its ordering proof must be
inserted before D5 under separate owner review.** Architecture-step labels only — **no new QFJ
phases. No migration now.**

**S2a (`draft` alone) is deliberately not scheduled before D1**: one state, unable to advance to any
successor, composed by nothing.

### 12. Status reconciliation

PR #175 merged at `c6b21dcf921e350f33477d3b18fd4413b8a8aa00`. ADR-0134 is corrected to **Accepted /
MERGED**, findings unchanged. The roadmap and integration plan record: S1 merged, S2 readiness merged,
S2 implementation still **BLOCKED**, and **this decision on a feature branch / PR until merged**.

## Consequences

- The authorship ambiguity is closed, so V2's shape and the evidence path can be designed against one
  architecture.
- **No new Core state event is required for S2** — though targeted primitive adoption may still be
  needed after S3.
- The generic projection privacy boundary survives; no projection gains payload access.
- **Model 2's trust now has an explicit, sequenced prerequisite (D2a)** instead of resting on a
  data-access boundary that cannot authenticate.
- `cancelled`, `expired` and `execution-submitted` remain openly unresolved rather than closed by
  assumption, and **full 18-state deterministic rebuild is explicitly NOT certified** — four of the
  five Tier A/B states have no durable replay source today.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Model 1 (Core-authored state event).** §3 — strictly larger. Deferred, not forbidden.
- **Widen the generic `ProjectionEvent`.** Rejected: permanent payload access for every projection to
  save one narrow module.
- **Treat the designated reader as sufficient for provenance.** Rejected in §5 — it is a data-access
  boundary, and the write path is not yet contained.
- **Leave write-path hardening optional.** Rejected: it is internally inconsistent with §6's own audit.
- **A general "read any event by id" API.** Rejected: the event-store bypass the design must prevent.
- **Add `communicationAuthorizationId` / `CommunicationAuthorizationV2`.** Rejected — a redundant name.
- **Allocate a durable provenance marker (migration).** Not taken: code containment first, and any DB
  grant work must be proved by the D2a slice under migration governance.
- **Implement S2a (`draft`) immediately.** Rejected as ceremonial (§11).
- **Freeze V2's full schema now.** Rejected: six state-dependent facts are unresolved until S3.

## Compliance

Every architectural claim was checked against the merged source at the baseline: the projection
readers and `ProjectionEvent`; the `eslint.config.mjs` restricted-import boundary; the production
registry; `event-store.ts`, its INSERT columns and its root-barrel export; `persist-validated-event.ts`;
`signing-input.ts`; `event-catalog.ts`; `execution-dispatch-runtime`'s PROPOSED-protocol statement; and
the communication and execution contracts. **No production code, no contract, no event registry, no
event-backbone, no projection runtime, no ingestion, no Core access, no n8n or provider, no message
sent, no persistence and no migration.** `0013` is not allocated and the `0010`–`0012` ledger drift is
untouched.

**Production rollout OFF. Runtime activation unchanged. The next step is S3, a fresh read-only Core
audit.**
