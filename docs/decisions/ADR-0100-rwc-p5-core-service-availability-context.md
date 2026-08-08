# ADR-0100 — RWC-P5 Core-Owned Service Availability Context

**Status:** Accepted — RWC-P5. Implemented on `rwc-p5-core-service-availability-context`, **not merged**.
**Deciders:** Owner
**Relates to:** [ADR-0099](./ADR-0099-rwc-p4b-one-model-call-extraction-and-continuity-cas.md) · [ADR-0098](./ADR-0098-rwc-p4a-riya-conversation-evolution-semantics.md) · [ADR-0097](./ADR-0097-private-riya-web-ingress-adapter.md) · [ADR-0096](./ADR-0096-rwc-p2d-core-authorized-web-reply-materialization.md) · [ADR-0095](./ADR-0095-rwc-p2b-durable-postgres-riya-conversation-continuity.md) · [ADR-0094](./ADR-0094-rwc-p2c-private-riya-web-conversation-service.md) · [ADR-0093](./ADR-0093-rwc-p2a-riya-conversational-continuity-contract.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md)

**Baseline.** RWC-P4B merged as PR #104 — merge commit `f5eeab887fd98eebac46a632cbeb38bfbc5dfdb6`, reviewed head `1c1da5007e792e8be300c0d83a34d5c2992c6be3`. Migrations `0001`–`0011`, `0011` SHA-256 `80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93`, no `0012`. **No migration is added by this slice.**

## Context

Since RWC-P2A, `locationRef` has been an **opaque conversational candidate**. Three packages say so
in their own notes, and each defers the same question to this slice: whether the reference names a
city QuickFurno actually serves.

RWC-P4B then made that gap consequential. A model now emits `locationRef` and `serviceInterestRef`
directly, and P4A's summary-readiness check is **structural** — it asks whether the four required
values are strings, not whether they mean anything. So a fluent, well-formed, entirely invented
`loc.atlantis` could reach `SUMMARY`, be marked `SUFFICIENT_FOR_CORE_REVIEW`, and become a
conversation Riya believed and a client was asked to confirm.

The failure this produces is not a crash. It is Riya confidently offering a service in a city the
business does not operate in — and doing it in good grammar.

A read-only authority audit established the rest of the ground: **no Core business-read port exists**
in this repository; the canonical taxonomy events exist but nothing consumes them, so there is no
active-city read model; and there is **no live Core transport of any kind** — the only
`CoreDecisionTransport` implementation is a deterministic test fake.

## Decision

### 1. QuickFurno Core owns the catalogue. Jarvis interprets language.

Which cities Core operates in, which customer-facing services it sells, and which service is
available in which city are **Core's facts**. Jarvis may resolve a client's wording onto one of the
refs Core published; it may not decide what the refs are.

There is therefore **no city list, no service list, no default and no fallback** in any production
source added by this slice, and a repository-wide scan enforces it: a place name in code is Jarvis
starting to own a fact that is not its own, and the first thing such a constant becomes is a
fallback.

### 2. One bounded authority read, BEFORE the one model call

Option A of the audit. The service reads Core's current availability once, and the model sees it in
the same single request that produces the reply.

The alternative — let the model answer, then validate — was rejected. Post-model validation cannot
repair a reply that was already drafted against an unvalidated candidate, and RWC-P4B forbids a
second model call to replace it. The client would be told something wrong, fluently.

Reading first also solves the same-turn case that made this hard: _"I need a modular kitchen in
Pune"_ arrives when continuity knows neither the service nor the city, and one snapshot lets the one
inference resolve both **and** say something true if the pair is not served.

### 3. A read PORT, with no implementation here

`@qf-jarvis/core-service-availability-read` declares the snapshot and the reader. It contains no
HTTP, fetch, URL, API key, environment read, database, cache, clock, randomness, n8n, provider or
model — and **no QuickFurno adapter**.

That is the same move RWC-P2C made with `RiyaContinuityStorePort`: declare the operation the design
genuinely needs, ship a deterministic fake under `./testing`, and let the slice that owns the real
integration satisfy it. Declaring it now is what makes the requirement visible **before** anyone
builds a surface that assumes Jarvis knows which cities are served.

`readCurrent` returns `unknown` on purpose. A typed return would look reassuring and prove nothing:
the value crosses a boundary from a system this repository does not compile.

### 4. The snapshot: availability is an explicit PAIR property

```ts
{ version: 1, snapshotRef, taxonomyVersion,
  cities:       [{ ref, displayName }],
  services:     [{ ref, displayName }],
  availability: [{ serviceRef, cityRefs: 'ALL' | string[] }] }
```

**An active city plus an active service does not imply the pair.** A business can operate in eight
cities and sell twelve services without selling all twelve in all eight, so `availability` is
explicit and carries **exactly one row per service** — a missing row would leave an availability
nobody stated, and "unknown" is not a value this contract can express.

`'ALL'` means every city in _this_ snapshot. An **empty** array is legal and meaningful: catalogued,
currently offered nowhere listed.

Core's own primitives are imported rather than restated — `entityIdSchema` for refs,
`taxonomyLabelSchema` for display names (it already refuses contact details, coordinates, URLs and
credentials), `taxonomyVersionSchema` for the pin. A second definition of Core's vocabulary would
drift.

Bounds: ≤ 64 cities, ≤ 64 services, ≤ 64 rows, and a hard **6000-character** bound on the canonical
serialization — model context that can grow without limit is a request that eventually fails a
budget nobody was watching.

**Duplicates are refused, never deduplicated**, and the check runs before sorting so ordering cannot
hide one. Two rows for one entity means the producer holds two beliefs; picking one is a rule nobody
wrote down. Display names are deliberately **not** unique-checked: real places share names, and Core
requires no such rule.

Output is canonically ordered by ref and deeply frozen, so the same catalogue produces byte-identical
model context every time.

### 5. NO aliases in V1

Core publishes an id, a display name, a state and a version — and **no governed alias collection**.
Adding an `aliases` field because it would help natural-language matching would be Jarvis asserting a
Core-owned fact Core never agreed to own.

The model may still resolve a spelling variation onto an active ref. What P5 guarantees is narrower
and honest: the emitted ref **exists** in the current snapshot, and the final pair **is permitted**.
It does not claim the linguistic normalization was itself authoritative. If the model is unsure, the
right move is to omit the observation and ask — which the one reply can do.

A future version may add aliases once Core owns and supplies them.

### 6. No inactive rows, no vendor, no price

The snapshot IS the current active view. Sending deactivated entries beside active ones would put
"which of these may I use?" back into the reader. And nothing about vendors, counts, prices,
packages, leads, clients, contact, consent, coordinates, pincodes or areas is needed to answer _may
this service be discussed for this city?_

### 7. Two output checks, and the second is the one that matters

After the strict schema and the canonical P4A batch:

1. **Every asserted ref must exist.** A `serviceInterest` SET must equal an active `services[].ref`; a
   `location` SET must equal an active `cities[].ref`. A `CLEAR` names no value and needs no check —
   withdrawing a fact is not a claim about the catalogue.
2. **The PROSPECTIVE final state must be possible.** The batch is applied through the real
   `evolveRiyaConversation`, and the _resulting_ `serviceInterestRef`/`locationRef` are checked —
   both individually, and as a pair if both are present.

The second check is what the first cannot do. A batch can be individually valid and still **combine**
with what the conversation already holds to produce a pair Core does not serve: a client who already
told us a service and now names a city that does not have it.

Order: strict schema → canonical batch → per-ref check → P4A evolution → prospective-state check →
question-plan agreement.

### 8. Whole-answer refusal, never a silent edit

A violation refuses the **entire** structured answer. Not the offending observation.

The model drafted its reply text against its own claim, so deleting one observation would leave a
reply that no longer matches what gets persisted — and P4B forbids a second model call to fix it.
This is the settled precedent from the RWC-P4B owner correction, applied to a new class of fault.

The **validator does not choose** what to keep. The evaluated prompt should prefer: keep the
recognized service, omit the incompatible city, and explain it in the reply — and when a service is
already held, keep it and omit the new incompatible city, and vice versa. The validator only refuses
states that cannot exist.

### 9. Why the pair rule keeps continuity V1 unchanged

P4A has **no field** for "these two are individually fine but the pair is not", and structural
presence of both would make such a conversation look summary-ready.

Rather than widen continuity, the invariant is moved earlier: **a prospective state containing an
unavailable pair is never accepted**, so the state can never exist. No `locationValidationStatus`, no
`cityContext`, no `supportedCity`, no `projectCity`, no `projectArea`, no snapshot ref in durable
state. **No migration, no `0012`.**

### 10. A catalogue that changes under a live conversation

Continuity may already hold a pair a newer snapshot no longer allows. P5 **does not auto-clear it**.

P4A's `CLEAR` is user-origin only, deliberately. Synthesizing one because the catalogue changed would
forge a correction the client never made, and would do it silently.

So the model still runs — the client's next sentence gets its chance to repair the state — and the
answer is accepted only if the prospective state becomes valid. If it does not, the whole answer is
refused: no batch, no reply, no compare-and-set. A known fail-closed edge, recorded here rather than
resolved with a schema change.

### 11. Provenance is untouched

Core validation confirms that a ref is in the current active context. It does **not** prove the
client meant that ref, and it is certainly not the client agreeing to it.

A client who says Pune remains `user_stated`. A model that inferred a location remains
`model_inferred`. Validation never upgrades to `user_confirmed` — **RWC-P6 owns confirmation** — and
never to `server_runtime`. No `RiyaCityContextSource` vocabulary is introduced; P4A's five origins
already carry everything, and a second vocabulary would only invite the two to disagree.

### 12. `browsingCity` stays off the wire; `projectArea` stays deferred

No change to `RiyaWebConversationTurnV1`, the private ingress request or response, the browser
protocol, the Ed25519 signing input, or QuickFurno. A future entry hint is context only, never
silently promoted into `locationRef`, always beaten by an explicit client statement, and
`userOverrodeCity` is not persisted.

`projectArea` is **deferred**, not implemented. Core exposes city-level taxonomy only — no area,
pincode or geocode — so P5 must not pretend to validate a neighbourhood, and `scopeSummary` is the
work-scope field and must not be misused as an area carrier. No lat/long, ever.

### 13. The Riya user-content bound, raised locally

`MAX_RIYA_USER_CONTENT_CHARS` goes from **8192 to 12288**. The authority context is itself bounded at
6000 serialized characters, and 8192 left roughly 2700 characters of headroom once a maximum-length
message and all seven known fields were present.

`DEFAULT_GATEWAY_REQUEST_BUDGETS` is **unchanged**, `tokenBudget` included. One agent needing more
room is not a reason every agent gets it. A focused spec proves a representative maximum P5 request —
thirty cities, twenty-five services, a populated continuity and a 4096-character message — still
admits under the existing 4096-token budget, measured on the request the real composition built.

### 14. Call budget, and the CAS path

Per inbound Riya discovery turn: **≤ 1 availability read**, **≤ 1 runtime run**, **≤ 1 model gateway
invocation**, **≤ 1 Core decision**, and the unchanged P4B CAS ceiling of two attempts with one
reload.

The read happens on **every** discovery turn, unconditionally. Deciding "authority is not needed this
turn" would require reading the client's prose before the model — a second natural-language path with
no model behind it, wrong exactly when somebody corrects their city in a sentence nobody predicted.

The snapshot is captured **once** and is **never re-read during compare-and-set reconciliation**. A
fresher authority there would be a second business read whose answer could invalidate text no second
model call is permitted to replace. The reconciliation re-merges the same captured batch, exactly as
before.

### 15. An unusable authority is `NOT_READY`

A reader that throws or rejects, a malformed snapshot, and an oversized snapshot all produce the same
result: `disposition: NOT_READY`, no reason token, no authorized reply, the loaded continuity
returned — and **zero** runtime calls, model calls, Core decisions and compare-and-sets.

`NOT_READY` already means "not servable now, possibly servable later", which is exactly the truth. It
is not a business decision about the client, so it must not read as one; and it is not an
inconsistency in our own records, so it is not `repository-invariant`. **No new disposition, no new
reason token, no new wire field.** Nothing from the reader's error escapes — it may name a host, a
token or a Core payload.

There is **no default city and no cached fallback**. A successful read is never retained: one good
read must not let every later outage be served from a catalogue that may since have changed. The port
invents no TTL either — if a future adapter has real source-freshness evidence and judges its data
stale, that adapter fails its own read.

## Consequences

- P4A can no longer reach `SUMMARY` with a service or city Core does not list, or with a pair it does
  not serve.
- Riya can resolve a service and a city in the **same one model call** and say something true when
  the pair is unavailable.
- Continuity stays minimal: no new durable field, no validation status, no migration.
- The final QuickFurno handshake has a precise, small, already-tested contract to satisfy.
- A future WhatsApp Riya reuses the same authority contract rather than growing a second one.

## What this does NOT implement

No QuickFurno handshake, UI, route, adapter or repository change. No live Core reader, no
`/api/cities`, no browser city selector, no ingress wire change, no ingress deployment, no provider or
n8n activation, no production prompt activation. No migration and no `0012`. No managed database
access. No vendor matching or availability inference, no lead creation, no package, pricing, payment
or consent. No `projectArea`, alias management, geocoding, lat/long or pincode. No summary
confirmation (**RWC-P6**), no RAG (**RWC-P7**), no cross-channel identity linking (**RWC-P8**).

## Change-control rule

Owner-locked. Changing any of these requires a new ADR, not an edit to this one:

- Core owns the catalogue; **no city or service literal, default or fallback in production source**;
- availability is an explicit **pair** property — the cross product is never inferred;
- **one** authority read per turn, **before** the one model call, and **never** during CAS
  reconciliation;
- **one** model gateway invocation per turn, unchanged;
- only refs present in the current snapshot may be emitted or persisted;
- the **prospective final state** is validated, and an unavailable pair may never reach P4A;
- whole-answer refusal, never a silent per-observation edit;
- a continuity that becomes invalid under a newer snapshot is **never auto-cleared**;
- **no aliases** in V1;
- an unusable authority is `NOT_READY` with no default and no cached fallback;
- continuity V1 unchanged, no validation status persisted, no migration;
- the Riya user-content bound is **Riya-local**; the generic gateway budgets stay untouched.

**Next.** RWC-P6: summary confirmation and canonical submission.
