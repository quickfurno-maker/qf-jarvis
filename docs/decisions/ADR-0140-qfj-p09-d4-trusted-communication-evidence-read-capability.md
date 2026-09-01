# ADR-0140 — QFJ-P09 D4: trusted communication evidence-read capability

**Status:** **Accepted / MERGED** as PR #180 — reviewed head `f5d97e7be115e9507707ecf30c4ec4c287f6b904`, merge commit `182a9cb1c00cf1e3ad0225654992099208b992a0`.
**Baseline:** `2027d3215a36e8fdbed6809d0f12a917bb71cdee` (main after PR #179 / D2a / ADR-0138)
**Accepted Core evidence pin:** `af7c2bb4f5a83731666fe059e963d1824cddd7b6` — **not re-pinned, not
re-audited; no Core code was read or modified in this slice**

**Core-independent and OFFLINE.** No live event transport, no Core modification, no managed Supabase,
no n8n/provider/Meta, no message sent, **no migration**, rollout **OFF**.

Implements the D4 slice locked by
[ADR-0135](./ADR-0135-qfj-p09-s2-local-communication-state-projection-architecture.md), against the
subset decided by [ADR-0137](./ADR-0137-qfj-p10-d2-core-protocol-and-event-gap-decision.md), on the
prerequisite delivered by [ADR-0138](./ADR-0138-qfj-p09-d2a-accepted-event-write-path-and-provenance-hardening.md).

---

## Context

ADR-0135 chose Model 2 and stated the problem D4 exists to solve:

> The evidence reader is a least-privilege **DATA-ACCESS** boundary, not an authentication boundary.
> Joining to `qf_jarvis.event` and re-parsing proves reachability and shape — **never origin**.

It therefore locked **D2a as D4's blocker**: no reader output may be called trusted until the write
path is contained. **D2a is now merged** (PR #179, reviewed head `56cb28d`, merge commit
`2027d321`), which is what makes this slice possible.

D4 builds exactly one thing: a **purpose-specific, least-privilege** capability that resolves the
minimal evidence for the first six durable Model-2 states from an already-positioned accepted event.

---

## Decision

### The module

`packages/event-backbone/src/projections/communication-evidence-reader.ts`, following the ADR-0044
subject-reader precedent: same position map, borrowed `DatabaseClient`, root-unexported, and
lint-restricted. One exported function:

```ts
readTrustedCommunicationEvidenceAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<TrustedCommunicationEvidence | null>
```

It accepts **a client and a position, and nothing else** — no payload, no `eventId`, no caller-supplied
event type, no `trusted: true`, no source discriminator. It performs no write, opens no transaction,
takes no lock, reads no clock, reads no environment, and makes no network call.

### What it deliberately is not

There is **no** `readPayloadAtPosition`, `readEventPayloadById`, `readCanonicalEventById`, or any
generic `payload: unknown` capability. A generic payload reader shared across projections would hand
every future handler the whole event log — the precise opposite of the point. D4 earns access for ONE
purpose and returns ONE minimised semantic union, and a test asserts no such generic reader exists.

### The two target families, and their honest status

Exactly two **families**, unchanged from ADR-0137: `qf.communication.authorization-recorded` and
`qf.communication.result-recorded`.

#### Two version axes, and D2 decided only one of them

**D2 selected the FAMILIES. It said nothing about their envelope version**, and the first cut of this
slice silently assumed `@1`. That was wrong in a way worth stating plainly:

| Axis                                           | Value    | Why                                                                            |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| canonical **event / payload registry** version | **`@2`** | what the authoritative registry carries, privacy-hardened                      |
| nested communication **artifact** contract     | **`V1`** | `CommunicationAuthorizationV1` / `CommunicationResultV1`, `contractVersion: 1` |

At this baseline the `@1` schemas survive for **regression and history only**: they are absent from the
payload registry, so the ingestion path's `safeParseCanonicalEvent` refuses them and **a `@1` target row
cannot be created by the verify → prepare → persist path at all**. Admitting `@1` would therefore have
meant trusting a row that the very trust path D4 leans on would never produce — a contradiction, and the
reason this is a correction rather than a preference.

**D4 supports `@2` as an explicit reviewed constant**, not "whatever the registry's highest version
happens to be". A future `@3` carries fields nobody here has reviewed, so it must fail closed until a
deliberate D4 change reviews them.

**No adopted or live emission for either family was established at the accepted S3 pin, and D4 makes no
current-live emission claim.** `authorization-recorded` readiness awaits **C3A**; `result-recorded`
awaits **C3B**'s contract-fit / execution-chain proof. D4 is built and proved **offline** against
published contracts and synthetic accepted rows. `qf.execution.intent-issued` and
`qf.execution.result-recorded` remain **unadopted**.

### The six admitted states, and the ten that are not

| Event                    | Condition                                              | Admitted state          |
| ------------------------ | ------------------------------------------------------ | ----------------------- |
| `authorization-recorded` | `outcome = rejected`                                   | **`rejected`**          |
| `authorization-recorded` | `outcome = authorized`, `authorizedChannel = whatsapp` | **`authorized`**        |
| `result-recorded`        | `lifecycleState = provider-accepted`                   | **`provider-accepted`** |
| `result-recorded`        | `lifecycleState = delivered`                           | **`delivered`**         |
| `result-recorded`        | `lifecycleState = read`                                | **`read`**              |
| `result-recorded`        | `lifecycleState = failed`                              | **`failed`**            |

Everything else returns **`null`** — parsed lawfully, then declined. `null` means "not applicable to
this capability"; it is **never a substitute state**, and no evidence is invented for it:

- **`completed`** — S3 found **no distinct Core completion truth**. Admitting it would mean inventing
  a completion fact.
- **`answered`, `no-answer`, `busy`** — voice outcomes Core does not model.
- **`execution-submitted`** — no proved durable Core submission artifact (ADR-0137 Q7).
- **`cancelled`, `expired`** — rejected for the MVP (Q8, Q9).
- **`follow-up-requested`, `human-handoff-required`** — Tier B.
- **a result-borne `rejected`** — a rejection must come from an authorization **refusal**, not from a
  result artifact.

**Tier B stays out entirely.** `authorization-requested` and `scheduled` remain CONDITIONAL pending
**D2b** plus exact Core primitive adoption; `draft` is Option C. **No placeholder event name was
invented** for any of them.

**An `authorized` outcome for a non-WhatsApp channel returns `null`.** It is a valid Core fact — Core
may lawfully authorize a channel Jarvis cannot execute — but it is not evidence a WhatsApp-only
runtime may act on (Q11). A **rejection** is admitted whatever channel was involved: a refusal is a
refusal.

### Full canonical parse, then minimisation

The stored payload is parsed against the **AUTHORITATIVE REGISTERED contract for its exact
`type@version`**, through a new narrow contracts API (below), before any field is read out. Fields are
stripped only afterwards.

**Parsing the nested artifact alone would have been a weaker contract.** The registered `@2` payload is
`contractPayloadV2({ authorization: ... })`, which applies a privacy-hardened prohibited-content guard
across the WHOLE payload. A coordinate pair inside an otherwise-bounded `explanation` passes
`communicationAuthorizationV1Schema` and is rejected by the registered payload — so hand-parsing the
nested artifact would have admitted a payload the registry refuses. That exact case is asserted by
test, using the repository's own positive fixture for the detector.

**This distinction is load-bearing: returning less is not parsing less.** A `CommunicationResultV1`
missing its mandatory `executionIntentId` or `executionResultId` **fails**, even though accepted
evidence never exposes those ids — asserted by test.

Excluded from authorization evidence: `explanation`, `policy`, `approvalDecisionId`.
Excluded from result evidence: `executionIntentId`, `executionResultId`, `explanation`,
`providerEvidence.providerReference`, `providerOccurredAt`, `failure.failureCategory`,
`failure.description`. Nothing carries a subject, signature, digest or raw payload.

### Fail closed, and stay classified

Every stored value is runtime-untrusted. Fails closed on: a non-positive-bigint input (before any
SQL); a **missing** positioned row (at projection time the runner already resolved that position, so
absence is corruption, not a benign miss); a malformed stored position, or one that is not the
requested position; a non-canonical `eventId`; a target event whose `source` is not the canonical Core
literal; a malformed payload wrapper; and any artifact failing its canonical schema.

**A known target family at an unsupported version fails closed rather than returning `null`** —
silently skipping an unknown version of a fact the projection relies on would produce a quietly
incomplete projection. An _unrelated_ event type returns `null`.

**Database and connection failures are deliberately not caught or reclassified.** They stay
infrastructure failures for the projection runner's existing classification; wrapping them would make
a connection blip look like data corruption.

### The SQL boundary

One parameterized, fully-qualified, position-keyed query joining
`qf_jarvis.projection_event_position → qf_jarvis.event` through `event_storage_sequence`, exactly as
the existing readers do. The raw storage identity is used **only for the join** and never returned.

Selected: `position`, `event_id`, `event_type`, `event_version`, `source`, and a payload guarded by a
`CASE` so **the database returns a payload only for the two target families** — an unrelated
positioned event never sends its payload across the boundary at all. Not selected: `subject_type`,
`subject_id`, `occurred_at`, `emitted_at`, `causation_event_id`, `signature`, `signature_key_id`,
`signature_signed_at`, `semantic_event_digest`, `body_digest`.

### The nominal evidence type, stated precisely

The evidence interfaces carry a module-private `declare const … unique symbol` brand that is never
exported. The claim that buys is exact:

> **Arbitrary code cannot STRUCTURALLY construct the evidence type without an assertion or cast.**

It is **not** a claim that TypeScript proves the row came from Core. There is deliberately no public
`fromTrusted(...)` factory over a plain object, no `{ trusted: true }`, no `{ verified: true }`, and
neither `source` nor `eventId` is used as the brand. Output is frozen, including nested failure
evidence.

### `sourceEventId` is a pointer

It is exposed as an audit pointer because D4 obtains it from the positioned, D2a-governed accepted
row. **It is a reference TO provenance, never provenance itself** — an `eventId` is a name any caller
can type. **D3 must never later accept a naked caller-provided `sourceEventId` as authority.**

### Containment: zero consumers, on purpose

The reader is absent from the root barrel and from the package export map, and the root runtime
surface stays at **38**. For this slice **no production file may import it at all** — enforced two
ways, because they fail differently:

1. a repository-wide `no-restricted-imports` pattern covering the package specifier, the sibling
   `./communication-evidence-reader.js` form and the `**/` forms; and
2. an independent source scan asserting the **production importer count is exactly ZERO**, which an
   `eslint-disable` comment cannot silence.

**D5 must move that invariant from 0 to exactly 1 in its own reviewed PR**, when it creates the actual
communication-state projection handler. Nothing here pre-authorizes that consumer, and no handler,
registry entry or subpath was added to make it easy.

The lint composition is **additive**, following D2a's lesson that a later `no-restricted-imports`
value REPLACES an earlier one: contracts purity, event-ingestion purity, reducer purity, the ADR-0044
subject-reader boundary, and D2a's two **disjoint** write exceptions are all re-asserted from the
**resolved** rules, not from config text. Neither write path gains any read privilege, and the reader
gains no write privilege.

### Dependency

`@qf-jarvis/contracts` is added to `event-backbone`. **Audited: no cycle** — contracts depends only on
`zod` and imports nothing from `event-backbone`. **No direct `zod` dependency was added**: the nested
artifacts are parsed by canonical schemas, and the one-key payload wrapper is enforced with a plain
object/key check, so there is no second place that can define what is valid.

---

## Consequences

- Jarvis can resolve minimal, trusted evidence for the first six durable states **offline**.
- Nothing became durable, projectable or live: **no `CommunicationStateRecordV2`, no projection table,
  no reducer, no registry entry, no checkpoint, no rebuild command, no runtime composition.**
- **No new ordering.** Evidence is read by the existing gap-free projection position. No timestamp,
  arrival-order, UUID or last-writer-wins ordering, and no second local cursor. **D2b remains
  responsible for Tier A/B ordering.**
- **No migration** was allocated (`0013` is not reserved) and **no DB grant or role changed.**

### The claim, and its limits

> Within the qf-jarvis repository/application trust model, evidence returned by this reader was read
> from an already-positioned canonical event row on the D2a-contained write path, validated against
> its canonical contract, and minimised.

**Not claimed:** that the database cryptographically proves any row was signed · that `eventId`
authenticates origin · that re-parsing authenticates origin · that the `source` literal authenticates
origin (it is a **consistency** check) · that any of this constrains a **privileged
out-of-repository database actor** — it does not · that Core emits these events today.

### Sequence

D4 satisfies **its own half** of D5's prerequisites. **D5 still waits on D3 + D2b**, and under the
current single-session sequence **D2b is next after this PR is merged**, then D3, then D5.

---

## Alternatives considered

- **A generic `readPayloadAtPosition`.** Rejected categorically: it would give every future projection
  the whole event log, and is the exact opposite of a purpose-bounded capability.
- **Widening `ProjectionEvent` to carry payload or `eventId`.** Rejected: that hands every projection
  the same privilege, which ADR-0135 already refused for the subject.
- **A read-by-`eventId` API.** Rejected: an id is a name any caller can type. Position-keyed reading
  is what ties evidence to the accepted, ordered stream.
- **Admitting `completed` from a terminal-looking result.** Rejected: S3 found no distinct Core
  completion truth, so it would be an invented fact.
- **Admitting a result-borne `rejected`.** Rejected: a rejection is an authorization refusal.
- **Opening a file-exact exception for a future D5 handler now.** Rejected: pre-authorizing a consumer
  that does not exist would make the zero-consumer invariant meaningless.
- **Adding `zod` directly to event-backbone.** Rejected as unnecessary: canonical schemas already own
  validation, and a second validator would be a second definition of valid.

---

## Posture

No contract, event registry, event-backbone schema, ingestion semantic or projection changed. No Core
modification, branch or PR. No managed Supabase. No n8n or provider access. No message sent. **No
migration allocated.**

**Production rollout remains OFF. Runtime activation is unchanged.**
