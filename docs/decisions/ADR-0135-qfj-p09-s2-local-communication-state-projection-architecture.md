# ADR-0135 — QFJ-P09 S2 local communication-state projection architecture

**Status:** Proposed (architecture decision; implemented on a feature branch / PR, **not merged**)
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
- **Model 2** — Jarvis derives a **local** state projection from the authenticated primitive events
  Core already publishes, and authors only its own coordination facts.

Leaving that open blocks everything downstream: the shape of a future `CommunicationStateRecordV2`,
whether a new Core event is needed, and what evidence a projector may consume. This ADR closes it.

**ADR-0134's twenty findings are locked and are not re-litigated here** — including the `rejected`
deadlock, the missing artifacts for pre-execution `cancelled` and one lawful `expired` path, the
Tier A/B/C ownership split, and the rule that an `eventId` is identity and never provenance.

## Decision

### 1. Model 2 is adopted

> **Jarvis maintains a LOCAL communication-state projection derived from authenticated primitive
> QuickFurno Core events, and authors only its own coordination facts.**

Core stays authoritative for consent, eligibility, authorization and every provider outcome. Jarvis
consumes only trusted accepted evidence, derives a local projection for orchestration and
observability, and **never presents that projection as Core's authoritative business history**.
`communication-lifecycle-runtime` stays a consistency validator; **no transition gains authority by
being graph-valid**.

**No canonical contradiction blocks Model 2.** Its one structural prerequisite — seeing an accepted
event's content — already has an established repository pattern (§3).

### 2. Model 1 is rejected for the current MVP

Not on principle, but because it is larger for no present gain: it requires
**`qf.communication.state-recorded@3`**, duplicates state facts beside primitives Core already emits,
forces Core to author or echo Jarvis-owned Tier A/B facts it must first be told, adds Core protocol
work on top of S3, and is all-or-nothing rather than tier-by-tier.

If a future external consumer genuinely needs one authoritative Core-published state fact, that is its
own adoption decision, taken then.

### 3. The generic projection boundary is NOT widened; a purpose-bounded reader is designed

`ProjectionEvent` stays **metadata-only** (`position`, `eventType`, `eventVersion`, `acceptedAt`). Its
own comment calls widening _"a deliberate, ADR-gated decision — not a convenience edit"_, and widening
the shared type would hand payload access to every present and future projection to avoid writing one
narrow module.

Instead, the future communication-state projection gets a **narrow, internal, allowlisted
accepted-event evidence reader** — the **second instance of the pattern ADR-0044 already
established** with `projection-subject-reader.ts`: position-keyed, root-unexported, restricted by a
`no-restricted-imports` rule to the single designated handler, re-validating every stored value fail
closed.

Its required properties — no arbitrary caller input, no event-store bypass, accepted-event only,
identity as reference only, allowlisted event types, minimised fields, re-parse against the exact
`event_type@event_version` payload schema, unchanged position ordering — are specified in the design
document §5, together with the field-minimisation table.

**It is designed here and implemented nowhere.** `projection-event-reader.ts`,
`create-event-ingestor.ts` and every contract are untouched.

### 4. Write-capability finding, and the trust assumption stated plainly

`storeValidatedEvent` **is exported from `@qf-jarvis/event-backbone`'s root barrel**, and **nine**
packages/apps already depend on that package. Today only `event-ingestion` calls it, and **no
repository-wide test enforces that**. A direct SQL write under the same role is likewise possible —
the analogous concession already appears in ADR-0044's boundary, which holds _"even though the shared
projection DB role technically holds the column grant."_

**So a row in `qf_jarvis.event` is evidence of the caller's discipline, not of Core's authorship.**
`event-store.ts` states it itself: _"This is a TRUSTED low-level primitive. It verifies nothing."_

**On post-hoc re-verification, the honest limit.** The signature commits to
`"qf-jarvis-event-v1" ‖ keyId ‖ signedAt ‖ hex(sha256(rawBody))`, and every component is persisted, so
the Ed25519 check **is** re-runnable from a stored row given the key registry. But **the exact raw
signed bytes are not stored** — only their digest — so re-verification proves _"a body with this
digest was signed"_, not that the stored payload and envelope columns are that body. That link rests
on `prepare-validated-event` at ingest time and on the row being unaltered; `semantic_event_digest`
detects later mutation but is computed by Jarvis and is **not a Core attestation**. **No cryptographic
fact is invented to close the gap.**

**Future hardening is recorded, not scheduled** (design §6.2), cheapest first: an import-graph
containment test; narrowing the export off the root barrel; an ingestion-only evidence type. **A
durable provenance marker is a schema change and is not preferred** — code-capability containment
preserves the invariant without one. Whether any is a prerequisite for trusting the projection is an
owner decision.

### 5. `CommunicationStateRecordV2` — semantics decided, implementation not

Under Model 2, V2 is a **Jarvis-local projection/read-model contract**, not automatically a Core wire
payload. Locked semantics and the per-state requirements are in design §7. The load-bearing ones:

- V1 stays immutable and published; `ApprovalDecisionV1` is never again generic "Core decided"
  evidence;
- V2 structurally distinguishes Tier A, Tier B and Tier C evidence;
- **a caller-provided event id is never authority** — the runtime takes evidence objects from the
  governed reader, and may _retain_ the source event identity for audit once it came from them;
- no consent snapshot, DNC flag, suppression cache, `canSend`, `canExecute`, `authorizedUntil` or
  reusable permission; no nineteenth state; no invented cancellation or expiry contract;
- `rejected` cites communication-**authorization** refusal evidence, never a human approval id;
  `authorized` cites Core communication authorization; `scheduled` proves both a trusted `authorized`
  prerequisite and Jarvis's scheduling act; `authorization-requested` proves **submission**, not
  construction; `provider-accepted` and the provider outcomes require Core-recorded result evidence.

**Deliberately unresolved until S3:** `cancelled` evidence, `expired` evidence, the S4 submission
receipt, `channel` semantics for a rejected record, and whether any further Core primitive must be
adopted. **No Zod or TypeScript is written here, and no field is frozen that depends on an
unre-audited Core fact.**

### 6. Versioning

- **`qf.communication.state-recorded@3` is NOT required under Model 2 and is not scheduled.**
- **`@2` remains published compatibility and history.** It is **not** the source of truth for Model-2
  work and is **not retired here**; retirement or versioning is a separate compatibility decision.
- **`CommunicationAuthorizationV2` is NOT required** — an accepted event already gives the
  authorization a citable name, which argues against a redundant identifier and asserts nothing about
  authentication.
- V2 is **not** added to the canonical Core event registry merely because it is a contract.

### 7. S3 is the next execution step, and S2a is not built before it

The next phase is **S3 — a fresh read-only QuickFurno Core audit at a current pinned commit**, because
`cancelled` and `expired` evidence, the submission/authorization protocol and Core's current event
surface are all unresolved, and freezing V2 first would encode assumptions.

Sequence (architecture-step labels inside this decision, **not** new QFJ phases):

**D0** this decision → **D1** S3 fresh Core audit → **D2** Core protocol/event gap decision →
**D3** V2 contract _and_ **D4** trusted evidence-read capability (independent of each other; either
order) → **D5** tiered Tier A/B/C projection → **D6** S4/S5/S7 integration per ADR-0132 →
**D7** real-integration certification → **D8** staged activation, separately governed.

**S2a (`draft` alone) is deliberately not scheduled before D1**: one state, unable to advance to any
successor, composed by nothing — ceremonial code that would claim S2 had started while its evidence
model was still open.

### 8. Status reconciliation

PR #175 merged at `c6b21dcf921e350f33477d3b18fd4413b8a8aa00`. ADR-0134 is corrected from Proposed to
**Accepted / MERGED** with the PR number and merge SHA. **Its findings are not rewritten.** The
roadmap and integration plan record: S1 merged, S2 readiness merged, S2 implementation still
**BLOCKED**, and this decision **on a feature branch / PR until merged**.

## Consequences

- The authorship ambiguity is closed, so V2's shape and the evidence path can be designed against one
  architecture instead of two.
- **No new Core event type is required for S2**, and no Core work is created beyond S3's existing
  scope.
- The generic projection privacy boundary survives: no projection gains payload access.
- The trust anchor is stated honestly, including the limits of post-hoc re-verification and the fact
  that `storeValidatedEvent` is currently reachable by convention rather than by containment.
- `cancelled` and `expired` remain openly unresolved rather than closed by assumption.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Model 1 (Core-authored state event).** §2 — larger, duplicative, forces `@3`, makes Core author
  Jarvis's facts. Deferred, not forbidden.
- **Widen the generic `ProjectionEvent` to carry payload and `eventId`.** Rejected: it would give
  every projection payload access permanently, to save one narrow module, and would silently weaken a
  deliberate privacy invariant.
- **A general "read any event by id" API.** Rejected: it is exactly the event-store bypass the design
  must prevent, and it would make an `eventId` behave like a capability.
- **Add `communicationAuthorizationId` / `CommunicationAuthorizationV2`.** Rejected — a redundant
  name, no new guarantee.
- **Allocate a durable provenance marker (migration).** Rejected for now: code-capability containment
  achieves the invariant with no schema change. Recorded as a future option requiring separate
  approval.
- **Implement S2a (`draft`) immediately.** Rejected as ceremonial (§7).
- **Freeze V2's full schema now.** Rejected: five state-dependent facts are unresolved until S3.

## Compliance

Every architectural claim was checked against the merged source at the baseline: the projection
readers and `ProjectionEvent`, the `eslint.config.mjs` restricted-import boundary, the production
registry, `event-store.ts` and its INSERT columns, `persist-validated-event.ts`, `signing-input.ts`,
and the communication and execution contracts. **No production code, no contract, no event registry,
no projection runtime, no ingestion, no Core access, no n8n or provider, no message sent, no
persistence and no migration.** `0013` is not allocated and the `0010`–`0012` ledger drift is
untouched.

**Production rollout OFF. Runtime activation unchanged. The next step is S3, a fresh read-only Core
audit.**
