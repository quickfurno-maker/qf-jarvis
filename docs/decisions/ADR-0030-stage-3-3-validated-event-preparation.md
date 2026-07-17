# ADR-0030 — Stage 3.3 Validated Event Preparation (database-free local/CI slice)

**Status:** Accepted
**Date:** 2026-07-17
**Accepted:** 2026-07-17
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion, idempotency, the conflict rule) · [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) (Stage 3.2 signature protocol and the 3.2/3.3 boundary) · [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) (the semantic-digest foundation this composes) · [ADR-0012](./ADR-0012-runtime-contract-validation.md) (contract validation) · [ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md) (the canonical envelope and versioning) · [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) (the payload privacy boundary)

> **This ADR authorizes a narrow, database-free, local/CI-only slice of Stage 3.3.** It adds a pure composition that turns a raw body **already accepted by Stage 3.2 signature and freshness verification** into a validated canonical event bound to its semantic digest. The composition is **internal to `@qf-jarvis/event-ingestion` and is not publicly exported** — only a later validated-ingestion composition may call it. It adds **no** `ingest` function, **no** persistence, **no** repositories, **no** migrations, **no** database access of any kind, and **no** new ingestion reason code beyond the three already pinned in [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §11. It does not weaken [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md), [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md), or [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md).

---

## Context

[ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) shipped the pure semantic-digest primitive and noted, explicitly, that _"a future authorized slice composes verification (Stage 3.2) + JSON parse + canonical-event validation + this semantic digest"_ — and that the primitive **must only ever be handed already-validated canonical-event output**. That composition did not exist. This slice is exactly that composition, and **only** that composition: it stops short of the `ingest` write path and touches no database.

[ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) established the 3.2/3.3 boundary: Stage 3.2 answers _"were these bytes authentic, unaltered, and fresh?"_ over the **exact raw bytes**, and deliberately does no JSON parsing or contract validation, because canonicalisation in the signature path is where a signer and verifier silently disagree. So the moment an authentic body must become a _typed, validated_ canonical event is a distinct step, downstream of verification, and it is the step this slice adds.

**The Stage 3.3 gate.** [phased-roadmap.md](../architecture/phased-roadmap.md) records that the persistence-touching parts of Stage 3.3 are **gated on managed-database readiness**, because Stage 3.3 is the first stage that writes to the event store. The pure Stage 3.2 verifier ([ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md)) and the pure semantic digest ([ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md)) are **not** so gated. **The owner has separately authorized this database-free preparation slice on 2026-07-17.** That authorization is narrow and does not move the persistence gate.

## Decision

**Build the pure, database-free validated-event preparation now — the bridge from an authenticated body to a validated canonical event and its semantic digest — while every persistence-touching part of Stage 3.3 stays blocked behind the managed-database readiness gate.**

### Authorization boundary

- **Stage 3.3 remains generally gated on managed-database readiness.**
- **The owner has separately authorized this database-free validated-event preparation slice** (2026-07-17, Keshav Sharma).
- **This authorization does not permit** persistence, migrations, repositories, an `ingest` composition, duplicate/conflict handling, local database integration, or managed database access.
- **All persistence-touching Stage 3.3 work remains blocked** until the managed-database readiness gate is separately satisfied and separately authorized.
- **This is a narrow authorization, not a general weakening of the phase gates.**

### The one new dependency

`@qf-jarvis/event-ingestion` gains **one** workspace runtime dependency: `@qf-jarvis/contracts`, the **authoritative owner** of the canonical event contracts and the registry. Contract validation runs _behind_ signature verification, never in front of it, so the package is no longer a pure leaf — but the dependency is a **data-only** package that opens no socket, reads no environment, and touches no filesystem. Its transitive `zod` is accepted as a validation dependency; this package takes **no direct `zod` dependency and imports `zod` nowhere**. No other dependency is added, and the lockfile changes only by the `link:../contracts` workspace link.

### The function, precisely

A single internal function — `prepareValidatedEventFromVerifiedRawBody` — takes a raw body and returns either a prepared validated event or a safe rejection.

**Authenticity is an internal caller precondition, not something this function proves.** It does **not** perform or prove Ed25519 verification. A future ingest composition must call `verifySignature` **first**, and pass this function the **actual** `SignatureVerificationSuccess` it returned together with the **exact same bytes**, immediately, with nothing mutated in between. The function recomputes `sha256(verifiedRawBody)` and requires it to equal the verification's own `bodyDigestHex`: this detects an **accidental body/result mispairing** and is a wiring guard only — it proves nothing about authenticity on its own. TypeScript `readonly` and structural types (including the `SignatureVerificationSuccess` shape, which a caller can construct freely) are **compile-time conveniences, not security capabilities**. A mismatch throws (a caller wiring error), never a silent, wrong result. Because the authenticity guarantee rests on the caller doing the right thing, this function stays **internal**.

The steps run in this exact order, first failure wins:

1. **Guard** the verification against the bytes (the mispairing check above).
2. **Strict, fatal UTF-8 decoding.** Invalid UTF-8 is refused, never replaced with U+FFFD.
3. **Explicit BOM rejection.** A canonical event is UTF-8 with **no** byte-order mark; a leading U+FEFF is refused rather than silently stripped.
4. **`JSON.parse` only.** No permissive, streaming, or bespoke parser.
5. **Contract validation** against the authoritative `@qf-jarvis/contracts` registry (`safeParseCanonicalEvent`, `CANONICAL_EVENT_REGISTRY`).
6. On success, **canonicalise the validated event once** (ADR-0029), compute the digest over that exact canonical JSON, then **re-parse the same canonical JSON** with `JSON.parse` and deeply freeze it — so the returned snapshot and the digest are **one identical canonical representation**. A non-JSON value in the validated output (a `Date`, `Map`, accessor, symbol, non-enumerable property, …) fails through the bounded semantic-canonicalisation invariant error and is **never** silently converted to `{}`; negative zero becomes `0`; object-key ordering follows the canonical JSON. The canonical JSON is computed once and is **never returned, exported, or logged**.

### The rejection surface

Failure is closed and countable. Exactly **three** stable identifiers are used, all already pinned by [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §11 and [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md):

- `contract-validation-failed` — the authentic bytes are not a decodable, valid canonical event. This **also** covers the pre-JSON failures (not UTF-8, a BOM, not JSON), reported as a single safe issue with code `malformed-body` under this reason — **not** as new reason codes. No `payload-not-json` reason code is introduced.
- `unknown-event-type` — a well-formed `eventType` the registry has never registered.
- `unknown-event-version` — a **known** type at a version the registry does not have (a future version, or a **retired** one — [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md) retired every inherited `@1`). Neither ever falls back to another version.

The discriminants are classified **independently and in a fixed order** against the registry — non-object root or missing/wrong-type `eventType` → `contract-validation-failed`; a string `eventType` that is not registered → `unknown-event-type` (decided **before** the version is interpreted); a known type with a missing/wrong-type version → `contract-validation-failed`; a known type at an unsupported numeric version → `unknown-event-version`; a registered `type@version` with an invalid envelope/payload → `contract-validation-failed`. Nothing is coerced, trimmed, case-folded, or given a version fallback, and **no submitted discriminant value enters a rejection**. `duplicate-conflict` — the fourth ingestion identifier — is deliberately **absent**: it requires the event store, which this slice does not touch.

### The safe error surface — issues are OWNED, not forwarded

A `@qf-jarvis/contracts` (Zod) issue is **not** safe to forward: its message may embed the submitted `eventType@version`, and its path (or message) may contain a sender-controlled key name (for example inside a governed-parameters object). So this slice never returns a validator-native message or an arbitrary path. Each returned issue instead carries:

- a **code** from a **closed, repository-owned vocabulary** — `required`, `invalid-type`, `invalid-format`, `invalid-value`, `unknown-field`, `constraint-violation`, `malformed-body`;
- a **fixed, repository-owned message** chosen **only** from that code (never the validator's message);
- a **safe structural path** rebuilt from validated segments: only fixed canonical-envelope names from a closed allowlist survive (and only at the top level), bounded numeric indexes remain, and every other segment becomes the opaque token `[field]`. A raw unknown key never appears; depth and total length are bounded.

For `unknown-event-type` / `unknown-event-version`, the registry-generated message is **not** forwarded — a single fixed, generic safe issue naming only the envelope field (`eventType` / `eventVersion`) is returned. All issues are then deterministically **sorted**, **deduplicated**, **capped at 16**, and **frozen**; the rejection carries `issuesTruncated: boolean`, true iff unique issues were dropped. The rejection never contains the rejected value, the raw bytes, the parsed payload, a signature, key material, a submitted discriminant, or a sender-controlled key. The caller-wiring error thrown on a digest mismatch carries no bytes and no digest. _The validator that refuses a value must not then record it_ (security-principles §5). This utility performs **no I/O and logs nothing.**

### A known limitation: duplicate JSON keys are not detected

`JSON.parse` is the only parser, and `JSON.parse` resolves duplicate object keys with **last-key-wins** semantics. This slice **does not detect duplicate keys**, and no custom or third-party parser is introduced to do so. Duplicate-key rejection remains a **pre-activation hardening decision**. This is one of several reasons **Stage 3.3 is not production-ready or complete**: this is a database-free preparation slice, not the ingest path.

### What it is not

- **Not the signing canonicalisation.** The Stage 3.2 verifier still verifies the **exact raw bytes** ([ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md)). The semantic digest here is a separate fact from `body_digest`, exactly as [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) established.
- **Not a hostile-object parser.** It only ever runs on the output of `JSON.parse` after contract validation; the returned snapshot is a re-parse of the canonical JSON, deeply frozen — plain JSON, which is exactly what the semantic canonicaliser accepts.
- **Not public.** It is not exported from the package barrel. The package-root runtime surface stays exactly the thirteen Stage 3.2 symbols.

## Alternatives considered

- **Fold preparation into `ingest()` now.** Rejected and out of scope: `ingest` requires persistence composition, idempotency, and conflict handling, none of which this authorization permits and the last of which stays behind the managed-database gate. A pure preparation step can be proven on local/CI first, exactly as Stage 3.2 and [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) were.
- **Publish the preparation function from the package barrel.** Rejected: a public surface is a promise, and there is no consumer yet. It is reached only by the later ingest composition inside this package.
- **Strip a leading BOM silently.** Rejected: a canonical event has one canonical byte form, and silently accepting a BOM-prefixed variant hides a producer that is emitting a subtly different body than it thinks. It is refused explicitly.
- **Introduce a `payload-not-json` reason code.** Rejected: the three pinned identifiers suffice, and a non-JSON authentic body is a contract-validation failure with a value-free issue code — not a new countable reason.
- **Deep-clone the validator's object, then canonicalise the clone.** Rejected: that risks the returned snapshot and the digest diverging. Instead the validated event is canonicalised **once**, the digest is taken over that canonical JSON, and the returned snapshot is a re-parse of the **same** canonical JSON — one representation, so they cannot drift.
- **Forward the validator's `ContractIssue` path/code/message.** Rejected: the message can embed the submitted `eventType@version`, and the path can contain a sender-controlled key name. Issues are re-owned with a closed code vocabulary, fixed messages, and an allowlisted structural path.

## Consequences

**Positive.**

- The bridge from _authentic_ to _valid_ is a **pure, database-free unit** whose properties are tested directly — UTF-8 strictness, BOM rejection, JSON-only parsing, deterministic type/version classification, digest binding, immutability, and value-free rejections — before any persistence depends on it.
- `@qf-jarvis/contracts` is the **single authority** for what a canonical event is; this package composes it rather than restating it.
- It keeps the raw-body digest and the semantic digest as separate, well-defined facts, and keeps contract validation strictly **behind** signature verification.

**Negative — accepted.**

- The package is no longer a pure leaf: it now depends on `@qf-jarvis/contracts` (and, transitively, `zod`). Accepted: validation must own the contract shapes, and the dependency is data-only. There is still **no direct `zod` dependency and no `zod` import** in this package.
- Stage 3.3 is split across yet another review surface. Accepted: a smaller, pure slice is easier to get right than the whole ingest path at once — the same trade [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) and [ADR-0029](./ADR-0029-stage-3-3-semantic-digest-foundation.md) made.

## Risks

- **Preparation mistaken for authentication.** This function does **not** authenticate, and this ADR does not claim it does: authenticity is an internal caller precondition (call `verifySignature` first, pass the actual success and the exact same bytes). The digest recomputation is only a mispairing guard, not a signature check, and TypeScript types are not security capabilities. Mitigated by keeping the function internal, by the wording throughout, and by a future ingest composition being the only intended caller.
- **A sensitive value leaking into a rejection.** Mitigated by re-owning every issue: a closed code vocabulary, fixed repository-owned messages (never the validator's), and a structural path rebuilt from a canonical-envelope allowlist with opaque `[field]` tokens. Covered by tests that pass a hostile synthetic issue and an email/token in an `eventType` and in an unknown key, and assert none appears in the serialized rejection.
- **Type/version misclassification.** Mitigated by deriving the known-type set from the authoritative registry and deciding deterministically; covered by tests for unknown type, future version, and retired version.
- **Scope creep toward persistence.** Mitigated by this ADR's explicit exclusions and by the package containing no `ingest`, no database client, and no repository.

## Explicit exclusions

This slice does **not** add, and this ADR does **not** authorize: `ingest()`; database pools or clients; PostgreSQL, Supabase, `db:preflight`, `db:migrate`, SQL, or migrations; event-log, `ingestion_rejection`, or `event_conflict` repositories or tables; idempotency persistence, duplicate processing, or conflict recording; a `duplicate-conflict` outcome; projections, retries, dead letters, replay, worker loops, or HTTP endpoints; any `apps/api` or `apps/worker` change; a direct `zod` dependency or import; any additional dependency beyond the single `@qf-jarvis/contracts` workspace link; network or environment-secret access; or any Core, n8n, WhatsApp, or provider integration.

## Follow-up work

- **Stage 3.3 persistence slices remain blocked** until the managed-database readiness gate is separately satisfied and separately authorized ([managed-database-runbook.md](../engineering/managed-database-runbook.md)).
- A future authorized slice composes this preparation into the `ingest` write path — with the event-log, `ingestion_rejection`, and `event_conflict` repositories, migration `0002`, and the `duplicate-conflict` outcome — each with its own review and against local/CI PostgreSQL first.
