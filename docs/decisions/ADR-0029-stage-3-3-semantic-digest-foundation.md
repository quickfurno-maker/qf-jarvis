# ADR-0029 — Stage 3.3 Semantic Digest Foundation (database-free local/CI slice)

**Status:** Accepted
**Date:** 2026-07-16
**Accepted:** 2026-07-16
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (ingestion, idempotency, the conflict rule) · [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) (Stage 3.2 signature protocol and the 3.2/3.3 boundary) · [event-backbone.md](../architecture/event-backbone.md) · [phased-roadmap.md](../architecture/phased-roadmap.md)

> **This ADR authorizes a narrow, database-free, local/CI-only slice of Stage 3.3.** It adds a pure deterministic canonical-JSON serialiser and a SHA-256 semantic digest, with tests. The primitive is **internal to `@qf-jarvis/event-ingestion` and is not publicly exported** — only a later validated-ingestion composition may call it, and only on already-validated canonical-event output. It adds **no** `ingest` function, **no** persistence, **no** repositories, **no** migrations, **no** database access of any kind, and **no** new ingestion reason codes. It does not weaken [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) or [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md).

---

## Context

[ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8 requires that a duplicate be classified by **semantic comparison, not byte comparison** — "the digest is taken over the canonical JSON of the parsed, validated event — deterministic key order — so a byte-level difference that means the same thing is not a false conflict." [event-backbone.md](../architecture/event-backbone.md) names the column `semantic_event_digest` and states that it digests **the entire parsed, validated canonical event — envelope and payload together**, and is kept **separate** from `body_digest` (the raw-bytes digest the signature commits to).

That deterministic canonical-JSON-and-digest primitive **does not exist yet**. It is a pure, database-free unit, and it is on the path of every persistence-touching part of Stage 3.3 — so it is the natural first slice to build, exactly as Stage 3.2 shipped a pure verifier before any ingestion.

**The Stage 3.3 gate.** [phased-roadmap.md](../architecture/phased-roadmap.md) records that Stage 3.3 (validated signed ingestion) is **generally gated on managed-database readiness**, because it is the first stage that writes to the event store. The owner has **separately authorized this database-free preparatory slice** on 2026-07-16. That authorization is narrow and does not move the persistence gate.

## Decision

**Build the pure semantic-digest foundation now, database-free, and pin its canonicalisation algorithm — while every persistence-touching part of Stage 3.3 stays blocked behind the managed-database readiness gate.**

### Authorization boundary

- **Stage 3.3 remains generally gated on managed-database readiness.**
- **The owner has separately authorized this database-free semantic-digest preparatory slice** (2026-07-16, Keshav Sharma).
- **This authorization does not permit** persistence, migrations, repositories, ingest composition, local database integration, or managed database access.
- **All persistence-touching Stage 3.3 work remains blocked** until the managed-database readiness gate is separately satisfied and separately authorized.
- **This is a narrow authorization, not a general weakening of the phase gates.**

### Where canonicalisation sits, and what it is not

**Canonicalisation runs only _after_ JSON parsing and canonical-event contract validation.** It operates on an already-parsed, already-validated in-memory canonical event. It is **never** used to authenticate a signature.

**It is an internal primitive, not a standalone hostile-input parser.** It is not exported from the package barrel, and **canonical-event contract validation remains the required boundary**. What the defences pinned below do, precisely: **accessor getters and setters — own or inherited — are never invoked**, and raw values are read from **own data descriptors only**. What they do **not** do: if a `Proxy` is supplied, its **reflection traps may still execute** — `Object.getPrototypeOf`, `Reflect.ownKeys`, and `Object.getOwnPropertyDescriptor` all trigger traps, and the wrappers do not stop a trap from running. They only stop attacker-controlled exception **messages, causes, property names, and trap text from escaping**. This is exactly why the function must only ever be handed **already-validated canonical-event output** and is never used as a standalone hostile-object parser.

**The Stage 3.2 signature verifier continues to verify the exact raw bytes** ([ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) §2, §5). The signing input is built from the digest of the raw body as received; JSON canonicalisation is deliberately absent from the signature path because number- and Unicode-formatting edge cases are exactly where a signer and verifier can silently disagree ([ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §2). **This semantic-digest algorithm is internal to QF Jarvis semantic duplicate comparison. It is not the signing canonicalisation algorithm, and nothing here claims it is.**

`body_digest` (raw bytes, the value the signature commits to) and `semantic_event_digest` (this algorithm, over the validated event) **remain two separate facts.**

### The exact algorithm

Given an already-validated canonical event value, the semantic digest is `sha256(utf8(canonicalise(value)))`, rendered as 64 lowercase hex characters. `canonicalise` is defined by these rules, pinned here:

1. **JSON value domain only.** The input is drawn from: `null`; a boolean; a **finite** number; a string; an array of JSON values; or a **plain object** (prototype `Object.prototype` or `null`) with string keys and JSON values. Anything else is programmer misuse and is rejected (rule 7).
2. **Object keys are sorted recursively** using deterministic ECMAScript string ordering **by UTF-16 code units** (the default lexicographic string comparison).
3. **Array element order is preserved exactly.** Order is semantic for arrays.
4. **Primitive serialisation and string escaping follow ECMAScript JSON serialization semantics** — i.e. each primitive serialises exactly as `JSON.stringify` would serialise that primitive.
5. **Unicode is not normalized.** Canonically equivalent but byte-distinct Unicode strings (e.g. NFC vs NFD) remain **distinct** semantic values, unless a contract explicitly normalised them **before** this function ran.
6. **Negative zero serialises as zero** (`-0` → `"0"`, matching `JSON.stringify(-0)`).
7. **Rejected as programmer misuse:** `NaN`, `+Infinity`, `-Infinity`, `undefined`, `bigint`, `function`, `symbol`, **sparse-array holes**, **cyclic structures**, **accessor properties**, **symbol keys**, **non-plain objects** (e.g. `Date`, `Map`, `Set`, `RegExp`, class instances), and **non-enumerable own data properties**. Accessor properties are rejected **without invoking the getter or setter**. A **non-enumerable own data property is outside the accepted JSON-parsed value domain** — `JSON.parse` never produces one — and is rejected using the existing `unsupported-value` code (no new code is introduced).
8. **The canonical string is encoded as UTF-8.**
9. **The semantic digest is SHA-256 over those UTF-8 bytes** (`node:crypto` only).
10. **The external digest representation is exactly 64 lowercase hexadecimal characters.**
11. **Raw-body digest and semantic digest remain separate facts** (§ above).
12. **The semantic digest covers** the validated canonical event **envelope** and the validated canonical **payload**.
13. **It does not cover** the signature envelope, the signature bytes, signing keys, raw-body whitespace, or any transport metadata outside the canonical event.
14. **No canonical string and no event payload may be logged by this utility.** It performs no I/O of any kind.
15. **This algorithm is internal to QF Jarvis semantic duplicate comparison.** It is **not** the signing canonicalisation algorithm, and this ADR **does not weaken** [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) or [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md).
16. **Objects and arrays are read through own property descriptors only.** A getter is never invoked, `record[key]` is never read, and `descriptor.value` is read directly. A missing or inconsistent descriptor fails closed.
17. **Arrays are inspected via own descriptors.** Own keys are enumerated with `Reflect.ownKeys`; every symbol key is rejected; only `length` and the **canonical own index keys `0..length-1`** are permitted; any extra own string property is rejected. Each expected index must have an own, enumerable, non-accessor data descriptor; a **missing own index is a `sparse-array` hole**, and — because only own descriptors are consulted — **an inherited property can never fill a hole** and an inherited getter is never invoked.
18. **Error paths name structure only.** Object keys appear as a **sorted-key ordinal token** (`$[key#0]`, `$[key#1][3]`); array elements appear as their **numeric index**. A **raw object key is never placed in an error path or message**, and a symbol key's description is never read — a key may itself be an email, phone number, address, credential, or free text. Path length is bounded.
19. **A reflection failure becomes a bounded `unsupported-value` error.** `Array.isArray`, `Object.getPrototypeOf`, `Reflect.ownKeys`, and `Object.getOwnPropertyDescriptor` are wrapped. These operations **execute a supplied `Proxy`'s traps** — the wrappers do **not** prevent a trap from running; they only bound its failure. A throw from a revoked or hostile `Proxy` yields a `SemanticCanonicalisationError` with code `unsupported-value` — **no** original cause attached, **no** original message copied, **no** trap text, **no** property name, and nothing logged.

### The safe error surface

Misuse is refused through a single bounded error type carrying a **stable code** from a closed set — `unsupported-value`, `non-finite-number`, `sparse-array`, `cyclic-value`, `non-plain-object`, `accessor-property`, `symbol-key` — and a **bounded structural path** that names structure only: a **sorted-key ordinal token** for object keys (`$[key#0]`) and a **numeric index** for arrays. The error **never** contains a **raw object key** (which may itself be an email, phone number, address, credential, or free text), a symbol-key description, the rejected value, the canonical string, the event payload, a signature, or key material. _The validator that refuses a value must not then record it_ ([validation.ts](../../packages/contracts/src/validation.ts), [ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md), security-principles §5).

## Alternatives considered

- **JSON Canonicalization Scheme (JCS, RFC 8785).** Rejected as a dependency and as over-scope: it prescribes specific number canonicalisation that we do not need for an internal comparison, and adding a third-party runtime dependency violates this package's zero-dependency posture and the supply-chain policy. A small, pinned, tested serialiser is reviewable in a diff; a library's number handling is not. (Note: JCS is also **not** what signatures use — signatures verify raw bytes, [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §2.)
- **Reuse the raw-body digest for duplicate classification.** Rejected: a byte-level difference that means the same thing (whitespace, key order) would become a false conflict, which [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §8 explicitly forbids.
- **Normalise Unicode inside this function.** Rejected: normalisation is a contract-level decision about what a field _means_, and silently folding NFC/NFD here would hide a real difference between two events. If a contract wants normalised text, it normalises before this function sees it (rule 5).
- **Build `ingest()` now.** Rejected and out of scope: it would require JSON parsing, contract-validation composition, and persistence — none of which this authorization permits, and the last of which stays behind the managed-database gate.
- **Fold the digest into the Stage 3.2 signature path.** Rejected firmly: the signature commits to raw bytes, and mixing a canonicalised digest into authentication is the exact class of silent signer/verifier disagreement [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) §2 removed.

## Consequences

**Positive.**

- The load-bearing, edge-case-prone primitive (canonical JSON + digest) ships as a **pure unit** whose properties are tested directly — Unicode, number formatting, key order, array order, and adversarial misuse — before any persistence depends on it.
- It is **database-free and gate-independent**: it can be proven on local and CI without a managed database and without moving the persistence gate.
- It keeps `semantic_event_digest` and `body_digest` as separate, well-defined facts.

**Negative — accepted.**

- Stage 3.3 is now split across more review surfaces (this slice, then persistence slices). Accepted: a smaller, pure first slice is easier to get right than the whole ingest path at once — the same trade [ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md) made for Stage 3.2.
- A canonicaliser that is _almost_ but not exactly JSON is a foot-gun if mistaken for the signing algorithm. Mitigated by rule 15, by this ADR, and by keeping the two digests named and separate.

## Risks

- **Mistaken for the signing algorithm.** Mitigated by rules 11 and 15 and by naming: `semantic_event_digest` ≠ `body_digest`; the signature path is untouched.
- **Unicode ambiguity.** Mitigated by rule 5 (no normalisation) and by explicit composed-vs-decomposed tests proving they digest differently.
- **Number edge cases.** Mitigated by delegating primitive serialisation to ECMAScript JSON semantics (rule 4/6) and by rejecting non-finite numbers (rule 7), with tests across integer, decimal, exponent, and min/max-safe integers.
- **Getter invocation / input mutation leaking or altering data.** Mitigated by reading own-property descriptors and rejecting accessors **without** invoking them, and by never mutating the caller's input — both covered by tests.
- **Sensitive data in an error.** Mitigated by the closed error-code set and the bounded structural path that carries no value.

## Explicit exclusions

This slice does **not** add, and this ADR does **not** authorize: `ingest()`; JSON parsing of a raw body as part of ingestion; contract-validation composition; database pools or clients; PostgreSQL, Supabase, `db:preflight`, `db:migrate`, SQL, or migrations; event-log, `ingestion_rejection`, or `event_conflict` repositories or tables; idempotency persistence, duplicate processing, or conflict recording; projections, retries, dead letters, replay, worker loops, or HTTP endpoints; any `apps/api` or `apps/worker` change; any new ingestion reason code (including `payload-not-json`); or an `IngestResult`. No third-party dependency is added and the lockfile is unchanged.

## Follow-up work

> **Erratum (2026-07-18, [ADR-0031](./ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md)) — migration numbering.** The follow-up below (written 2026-07-16) names _"migration `0002`"_ as the home of the `ingestion_rejection`/`event_conflict` tables. Numbering has since advanced: `0002_event_runtime_grants.sql` became the runtime least-privilege grants (Stage 3.3 slice 3, PR #15), and the two audit tables land in **`0003_ingestion_rejection_and_event_conflict.sql`** (Stage 3.3.3, ADR-0031). The original sentence is preserved below for history; read `0002` there as `0003`.

- **Stage 3.3 persistence slices remain blocked** until the managed-database readiness gate is separately satisfied and separately authorized ([managed-database-runbook.md](../engineering/managed-database-runbook.md)).
- A future authorized slice composes verification (Stage 3.2) + JSON parse + canonical-event validation + this semantic digest into the `ingest` write path, with the event-log, `ingestion_rejection`, and `event_conflict` repositories and migration `0002` — each with its own review and against local/CI PostgreSQL first.
