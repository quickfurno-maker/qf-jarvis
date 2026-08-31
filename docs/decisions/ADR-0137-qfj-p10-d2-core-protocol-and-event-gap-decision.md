# ADR-0137 — QFJ-P10 D2 Core protocol and event gap decision

**Status:** **Proposed** — architecture decision on a feature branch, **PR open, NOT merged.**
**Date:** 2026-08-31
**Phase ownership:** **QFJ-P10** (Core integration and reconciliation), with QFJ-P09 consequences.
Step **D2** under [ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md),
following **S3 / D1** ([ADR-0136](./ADR-0136-qfj-p10-s3-fresh-quickfurno-core-audit.md)). **No new
phase is created. There is no QFJ-P13 and no AVG-13.**
**Jarvis baseline:** `1c8b4f6a2b4090db816da7dc49654713e8bbcc3b` (merge of PR #177)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited**
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0132](./ADR-0132-aarohi-real-execution-integration-planning.md),
[ADR-0134](./ADR-0134-qfj-p09-s2-communication-state-evidence-alignment.md),
[ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md) and
[ADR-0136](./ADR-0136-qfj-p10-s3-fresh-quickfurno-core-audit.md) — **all four are locked input** —
plus [ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md),
[ADR-0090](./ADR-0090-qfj-p09-02-test-only-execution-dispatch-boundary.md),
[ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) and
[communication-model.md](../architecture/communication-model.md).

Plan and matrices:
[qfj-p10-core-protocol-event-adoption-plan.md](../architecture/qfj-p10-core-protocol-event-adoption-plan.md).

---

## Context

ADR-0136 closed S3 with a **fifteen-question evidence queue** and no decisions. D2 turns that queue
into explicit semantic decisions, explicit non-decisions, ownership boundaries and a dependency-safe
sequence.

**S3's evidence is frozen.** This ADR decides against the accepted pin `af7c2bb…` and **does not
re-pin Core main, run a second audit, or consume any newer Core commit.** No newer Core change was
consumed as decision evidence.

**D2 is not implementation.** It invents no endpoint, URL, header, credential, SQL, schema or event
name. Where a semantic boundary can be decided now while the wire shape belongs to a named
implementation slice, **the semantics are decided now and the shape is deferred** — that is the
intended output.

## Decision

### 1. All twenty-five locks hold. No reopen.

Every load-bearing lock from ADR-0132/0134/0135/0136 survives D2 unchanged — Model 2 chosen; Core is
system of record; Jarvis is never a consent database; approval ≠ communication authorization; founder
approval never overrides Core consent; a request is an ASK; construction ≠ submission;
`CommunicationAuthorizationV1` retained with **no V2**; prior authorization ≠ future permission;
execution-time eligibility re-evaluated by Core; issuance ≠ dispatch; Core's consent-deny `cancelled`
maps to Jarvis **`rejected`**; a bare `eventId` is never provenance; `ProjectionEvent` stays
metadata-only; **D2a remains mandatory**; **no `state-recorded@3`**; `@2` is history/compat only;
generic outbox capacity ≠ ExecutionIntent persistence; the QF-MVP n8n automation transport ≠ Jarvis
B4/S5; Core's current signing domain is not automatically reusable; no provider → Jarvis truth path;
no Jarvis mutation of Core business tables; no projection row is source-of-fact; no
timestamp/UUID/last-writer ordering; **rollout OFF**.

**No contradiction was found. No OWNER ARCHITECTURE REOPEN is raised, and no fresh Core audit is
required.**

### 2. The fifteen decisions

The full matrix — status, decision, authority owner, source of truth, future slice, Core/Jarvis change,
migration need and what each blocks — is in the plan §1. The load-bearing per-question detail:

**Q1 — prospect ↔ vendor continuity. DECIDED_NOW (semantics) / DEFERRED (shape).** Core must own **one
durable, unique, idempotent, queryable** correlation between Jarvis's **existing** acquisition identity
and the Core vendor identity. Jarvis already has that identity: `AcquisitionCase` carries `caseRef` and
`prospectRef` as opaque `[A-Za-z0-9._:-]{1,128}` references — the same grammar as Core's entity ids.
**Reuse them; do not invent a second prospect id.** Jarvis may retain its own refs plus the returned
Core vendor reference. **Jarvis may never guess by phone, name, email, lead id or first match.**
_Fail closed:_ no correlation fact ⇒ no continuation. _Unresolved:_ Core persistence and read shape
(C-S8).

**Q2 — registration completion. DECIDED_NOW / DEFERRED.** Registration completion is a **distinct Core
business fact**: not auth-account creation (Core's own `handle_new_user()` says it creates no vendor
state) and not activation. **Jarvis creates no local registration truth.** _Fail closed:_ absent fact ⇒
not registered.

**Q3 — payment / prospect addressability. REJECTED_FOR_MVP.** No prospect-addressable payment layer is
built for Jarvis's benefit. After Q1 yields the Core vendor identity, Core's existing vendor-keyed
commercial truth suffices. **`paid ≠ activated ≠ live`**, and an order being `created` implies no
payment state. _If a future flow genuinely requires payment before a vendor identity exists, that is a
contradiction to report — not to route around._

**Q4 — authoritative party-live fact. DECIDED_NOW / DEFERRED.** Core exposes **one explicit
machine-readable "this party is live as a vendor" decision/read**, which Core **may derive** and which
**need not** become a new column or enum. **`package_status='active'`, `is_active`, `Approved` and
auth-enabled are each individually insufficient** and must never be substituted by name similarity.
Jarvis stores only the Core assertion reference and **never a competing live flag**. _Fail closed:_ no
Core assertion ⇒ the activation boundary stays unreachable.

**Q5 — communication authorization. DECIDED_NOW / DEFERRED (wire).** Three concepts stay separate:
**(A) submission/receipt** — Jarvis submits one `CommunicationRequestV1`; construction is not receipt.
**(B) Core business authorization** — Core owns the authoritative decision, adapted into the
**existing `CommunicationAuthorizationV1`**; consent/suppression is a **mandatory gate but not the
whole authorization**. **(C) execution-time eligibility** — re-checked later; the prior authorization
is never reusable permission. **Core's closed CONSENT outcome must never be returned as though it were
a complete `CommunicationAuthorizationV1`.** An `authorized` outcome uses the existing required fields
and exact Core evidence; a `rejected` outcome fabricates no approval evidence. **No consent snapshot,
suppression copy, `canSend` boolean or `validUntil` is added anywhere.** _Fail closed:_ no
authorization ⇒ no send.

**Q6 — first primitive events. DECIDED_NOW.** Adopt exactly two:
**`qf.communication.authorization-recorded`** and **`qf.communication.result-recorded`**. Both name
real Core-owned facts S3 confirmed, both already exist as Jarvis candidate contracts, and together
they unlock the Tier-C evidence Model 2 needs — including the `rejected` case ADR-0134 proved
unrepresentable. Everything else is deferred or blocked (plan §2). **A contract existing is never a
reason to adopt.**

**Q7 — `execution-submitted`. DECIDED_NOW (semantics) / BLOCKED_BY_MISSING_CORE_TRUTH (artifact).**

> `execution-submitted` means **Core has actually handed the authorized execution to the governed n8n
> execution boundary and holds DURABLE Core evidence that the handoff reached the defined submission
> boundary.**

It is **not** request creation, authorization creation, intent creation, a generic outbox insert,
"attempt started", provider acceptance or delivery. **No event name or schema is invented.** S5 must
define one Core-owned durable submission artifact, exactly what transport acknowledgement counts,
and its idempotency/replay semantics; **only that artifact may justify the state.** If the transport is
asynchronous, an outbox row merely _queued_ is too early — and if a future slice proposes "sent from
Core outbox" as the boundary, it must **prove** that means successful handoff rather than assume it.

**Q8 — cancellation. REJECTED_FOR_MVP.** Core's consent-deny `cancelled` **is not** Jarvis
cancellation — it maps to **`rejected`**. No authoritative Core cancellation operation exists, and
**none is invented merely to make all eighteen states producible.** **The projection must not emit
Jarvis `cancelled`.** Future support requires an explicit Core cancellation command/decision, legal
source states, idempotency, actor/reason semantics, refusal once execution is too far advanced, and a
durable Core fact/event.

**Q9 — expiry. REJECTED_FOR_MVP.** **Expiry is never derived from `now > expires_at`.** No owning Core
clock or recorded outcome exists. **The projection must not emit Jarvis `expired`.** Future support
requires a named Core-owned expirable artifact, an owning Core clock/process, a durable recorded
expiry outcome and deterministic replay evidence. **Inventing a timer event now would be worse than
excluding the state.**

**Q10 — Tier A/B evidence + ordering. DECIDED_NOW per state.** `draft` → **Option C** (ephemeral; an
unsubmitted draft has not crossed Core, and no second durable Jarvis log is created to hold it).
`authorization-requested` → **Option A** (Core records **receipt** of a submitted request; **Core
recording receipt does not make Core the author of Jarvis's request**). `scheduled` → **Option A** if
Core's existing scheduling model adopts cleanly, and the fact must mean scheduling **actually occurred
after authorization** — **`requestedTiming` alone is not evidence.** `follow-up-requested` → **Option
C**; a later attempt is a **new** `CommunicationRequestV1` starting a new lifecycle at `draft`.
`human-handoff-required` → **Option C / blocked** while Core has no handoff truth; **a Core handoff
event must not be manufactured from a Jarvis candidate contract.** **Option B — a separate durable
Jarvis coordination log — is REJECTED_FOR_MVP.** D2b becomes bounded confirmation, not a fresh debate.

**Q11 — channel. DECIDED_NOW.** The request keeps `proposedChannel`; the authorization keeps
`authorizedChannel`; Core may refuse before authorizing any channel. **The first live runtime is
WhatsApp-only.** Jarvis **must not auto-switch** to SMS, RCS or voice merely because Core models them,
and a non-WhatsApp authorized channel **fails closed as unsupported for execution** rather than being
silently re-routed. Contract generality stays; deployment capability is narrower. **No
`CommunicationAuthorizationV2`.**

**Q12 — provider result / reconciliation. DECIDED_NOW.** The first Core → Jarvis authoritative result
primitive is **`qf.communication.result-recorded`**. Core receives the provider/webhook outcome,
verifies, normalises, records, then emits. **Jarvis never accepts provider or n8n truth directly,
stores no raw provider payload, and projects only the minimal normalised lifecycle fact.** _Fail
closed:_ no accepted Core event ⇒ no state.

**Q13 — execution-time eligibility. DECIDED_NOW (semantics) / DEFERRED.** Core remains **sole
authority** and must be consulted immediately before governed dispatch, re-evaluating at least
consent/suppression, purpose/scope, channel eligibility and current policy/frequency/attempt controls
where authoritative. **Jarvis caches no "allowed" result, ever.** A denial there is a **Core decision**,
recorded and reconciled through the adopted result/authorization semantics — **never converted into a
provider failure.** Exposure to n8n / the QF Communications Runtime is a narrow internal Core surface
in S6. **No URL, header or auth scheme here.**

**Q14 — Core event/outbox capability. DECIDED_NOW (gate) / DEFERRED.** Before anything relies on
event/outbox, a **governed Core readiness gate must verify actual applied-state under Core
ownership** — S3 explicitly did **not** certify live state, and **its documentation is not a
substitute for verification.** D2 itself accesses no database. The sequence is then: verify → if
required apply/align under **Core** migration governance → wire authoritative business facts
transactionally → publish idempotently → **only then** call the capability adopted. **Jarvis receives
no database role.** Four things stay distinct and must never be conflated: Core's generic workflow
outbox · the canonical Jarvis event envelope · the provider webhook receipt · Jarvis event ingestion.
Whether Core's existing outbox is **adapted** or a **narrow canonical publication layer** is added is a
C2 decision at module-boundary level. **No SQL is written here.**

**Q15 — signature / trust. DECIDED_NOW.** Core → Jarvis canonical delivery **adopts Jarvis's existing
ingestion trust model** rather than inventing a second verification architecture. Verified at the
baseline: `SUPPORTED_ALGORITHM = 'ed25519'`, `DOMAIN_SEPARATION_PREFIX = 'qf-jarvis-event-v1'`, and
**`EVENT_KEY_PURPOSE = 'core-to-jarvis-event'` — a dedicated Core → Jarvis trust domain that already
exists in Jarvis.** Core must sign the exact canonical raw bytes Jarvis ingestion expects, under that
dedicated purpose, preserving key-id/rotation, freshness and replay semantics. **No existing Core
provider-webhook or n8n signing key or domain is reused.** **D2a is still required: Core signing does
not replace write-path containment, and containment does not replace Core signing. Both.**

### 3. Cross-question consistency

**A. The authorization chain, with no arrow collapsed.**
`CommunicationRequestV1` constructed **≠** submitted **≠** authorized **≠** execution-time eligible
**≠** submitted to n8n **≠** provider accepted **≠** delivered/read/completed. Q5 keeps A/B/C apart, Q7
keeps submission distinct from issuance, Q13 keeps eligibility distinct from authorization, and Q12
keeps provider acceptance distinct from delivery.

**B. Rejection vs cancellation.** Core consent deny → authoritative communication refusal → Jarvis
**`rejected`**. **Never Jarvis `cancelled`** (Q8).

**C. Event authority chain.** Core business fact → Core durable record → Core canonical event/outbox
(Q14) → dedicated Core → Jarvis signature (Q15) → Jarvis verify → prepare → persist → **D2a-contained**
accepted event → **D4** evidence reader → **D5** projection. **A contract declaration never jumps into
this chain** (Q6).

**D. Tier A/B authorship.** Jarvis may **author** a request or scheduling coordination act; Core may
**record** receipt or occurrence of the primitive. **Recording is not authorship** (Q10).

**E. Business truth.** Payment ≠ activation · auth account ≠ registration · Approved ≠ live · package
active ≠ party live · `is_active` ≠ party live (Q2, Q3, Q4).

**F. Channel.** Proposed ≠ authorized ≠ runtime-supported; initial live runtime is WhatsApp-only
(Q11).

**G. Replay.** No durable projection fact without independent durable replay evidence; **no read-model
row is its own evidence** (Q10, plan §3).

**H. Privacy.** No boundary decided here exposes a plaintext phone where an opaque reference or hash
suffices, a raw provider payload, a message body, credentials, free-form internal reasoning, consent
rows, or unrestricted metadata. **References and closed machine codes only** (Q5, Q12).

### 4. The first durable projection is a SUBSET, and says so

**Durable (7):** `rejected`, `authorized`, `provider-accepted`, `delivered`, `read`, `failed`,
`completed` — all Tier C, all from the two adopted events.
**Conditional (2):** `authorization-requested`, `scheduled` — pending D2b + C1.
**Deliberately excluded (9):** `draft`, `execution-submitted`, `answered`, `no-answer`, `busy`,
`follow-up-requested`, `human-handoff-required`, `cancelled`, `expired`.

The eighteen-state **vocabulary** is unchanged; the **durable projection** is not eighteen states.
**D3 must model the supported subset honestly, no producer may emit an unsupported state, full
18-state rebuild is NOT a launch gate, and an ephemeral state is never called durable.**
`CommunicationStateRecordV1` stays immutable and is **not** mutated to fake completeness.

### 5. Sequence, and the next slice

**D2 → D2a (Jarvis trust track)** · **D2 → C0 → C1 → C2 → C3 → {C4 → C5, C6} (Core adoption track)** ·
**D2 → D2b (Tier A/B)** · **D3** (needs D2b + C3) · **D4** (needs D2a + C3) · **D5** (needs D3 + D4 +
D2b, supported subset only) · **S8/S9** (need C1) · **D7** certification · **D8** activation,
separately governed. Mapping to ADR-0132: C1→S4, C4→S5, C5→S6, C6→S7, S8→GAP A, S9→GAP B.

> **The next engineering slice after D2 merges is D2a** — accepted-event write-path /
> provenance-capability hardening. It is **Core-independent**, already mandatory under ADR-0135, and
> blocks D4.

**Three cautions:** D2a landing does not mean events are live · **D4 and D5 may not proceed merely
because D2a lands** · Core adoption stays separately gated on C0 → C3.

### 6. Migration

**D2 allocates no migration and reserves no number. `0013` is not reserved.** Per-slice need is marked
`NONE EXPECTED` / `POSSIBLE — MUST PROVE` / `CORE-SIDE POSSIBLE — MUST PROVE` / `UNKNOWN` in plan §5.2.
**C0's applied-state verification is not permission to run a migration.** D2a prefers code-capability
containment first, with DB role/grant hardening only if that slice proves it necessary. The Jarvis
`0010`–`0012` ledger drift remains separate governance debt, **not repaired here**.

### 7. Status reconciliation

PR #177 merged at `1c8b4f6a2b4090db816da7dc49654713e8bbcc3b`, so **ADR-0136 becomes Accepted /
MERGED**, and the stale "PR #177 open / awaiting acceptance" lines in ADR-0135, the Model-2 design
document, the integration plan and roadmap v3 are corrected. **S3's findings and reports are not
rewritten.** This ADR stays **Proposed** until owner acceptance.

## Consequences

- The fifteen-question queue is closed: **9 DECIDED_NOW (7 with a deferred wire shape), 3
  REJECTED_FOR_MVP, 1 BLOCKED_BY_MISSING_CORE_TRUTH on its artifact, 2 decided-and-deferred** — with
  no item left "TBD" without an owner and prerequisite.
- **Only two Core events are adopted**, so the Core ask is the smallest that unlocks Tier C.
- **The first durable projection is 7 states, not 18** — stated openly rather than implied.
- `cancelled`, `expired`, `execution-submitted` and the voice outcomes are **excluded by decision**,
  not forgotten.
- **No second Jarvis event log** is created, and **no new Core state event**.
- D2b is reduced to bounded confirmation; D3's entry gate is now well defined.
- Nothing is activated. Production rollout remains **OFF**; Aarohi's runtime remains
  **PLANNED / DISABLED**.

## Alternatives considered

- **Adopt every candidate event.** Rejected: four have no Core fact or no consumer, and adoption
  without a fact fabricates truth.
- **Bind `execution-submitted` to an outbox `sent`.** Rejected as unproved — the boundary must be
  demonstrated by S5, not assumed.
- **Make all eighteen states durable now.** Rejected: it would require inventing cancellation, expiry,
  handoff and voice truth Core does not have.
- **Build a separate durable Jarvis coordination log (Option B).** Rejected for MVP — Options A and C
  cover every state a current consumer needs, and a second log duplicates ordering and authority.
- **Reuse Core's existing webhook/n8n signing domain.** Rejected: a distinct Core → Jarvis purpose
  already exists in Jarvis (`core-to-jarvis-event`), and cross-purpose key reuse destroys domain
  separation.
- **Add `CommunicationAuthorizationV2` or `state-recorded@3`.** Rejected — no new field or event is
  needed for any decision here.
- **Trust S3's report that the Core migration is unapplied.** Rejected as a basis for adoption: C0
  verifies applied-state under Core governance.

## Compliance

Every decision cites accepted S3 evidence at pin `af7c2bb…`; the three facts D2 additionally verified
at the Jarvis baseline — `AcquisitionCase.caseRef`/`prospectRef`, `SUPPORTED_ALGORITHM = 'ed25519'`
with `DOMAIN_SEPARATION_PREFIX = 'qf-jarvis-event-v1'`, and
`EVENT_KEY_PURPOSE = 'core-to-jarvis-event'` — are repository facts, not new audit findings. **No
production code, no contract, no event registry, no event-backbone, no ingestion, no projection
change. No Core modification, branch or PR. No managed Supabase, n8n or provider access. No message
sent. No migration.**

**Production rollout OFF. Runtime activation unchanged. The next slice is D2a.**
