# Contract Principles

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

The rules every contract in this repository obeys. Each states what it forbids, and why the forbidding matters.

---

## 1. Every contract is explicitly versioned

`contractVersion` on every payload; `eventType` + `eventVersion` on every envelope. A positive integer, never a semver string, never a date.

**Forbids:** an unversioned contract. A shape with no version cannot be changed without breaking every consumer at once, so in practice it is never changed — it is quietly reinterpreted, which is worse. See [versioning-and-compatibility.md](./versioning-and-compatibility.md).

## 2. Every contract is strict at runtime

`z.strictObject` everywhere. An unrecognized field is an **error**, not a bonus.

**Forbids:** `.passthrough()`, and the reasoning behind it. A permissive schema means a producer can add a field, believe it is being consumed, and be wrong — silently, for months. It also means an attacker can attach `{ approved: true }` to a payload and find out whether anything downstream reads it.

## 3. Every contract is JSON-serializable, and provably so

No `Date`. No `bigint`. No class instances. No functions. No `undefined`. No `NaN` or `Infinity`.

Timestamps are RFC 3339 UTC **strings**. Numbers are finite. Objects are plain.

**Forbids:** the whole category of bug where a value changes as it crosses a boundary. `JSON.stringify` drops `undefined`, throws on `bigint`, turns `NaN` into `null`, and renders a `Date` as a string that parses back as a string. Each of those is a field that means one thing on one side of a wire and another thing on the other. The [bounded-JSON](../../packages/contracts/src/common/bounded-json.ts) inspector enforces this, and a round-trip test proves it for every fixture.

## 4. Everything is bounded

Every string has a maximum length. Every array has a maximum size. Every JSON container has a maximum depth, a maximum key count, and a maximum total node count.

**Forbids:** an unbounded field. It is a denial-of-service vector and, more importantly, a **smuggling route** — the place a raw provider payload, a full call transcript, or a dump of a Core record ends up, because it was the field that happened to be open.

## 5. No credentials, ever

No API keys, tokens, passwords, secrets, or webhook signatures — in any contract, in any field, at any depth.

**Forbids:** more than it sounds. Governed JSON containers reject credential-shaped **keys** at any depth, so `parameters: { apiKey: "..." }` does not parse. This is defense in depth on top of the real control, which is that **QF Jarvis holds no provider credential at all** ([system-boundary.md](../architecture/system-boundary.md)). A contract carrying one would be either a bug or a breach.

## 6. Opaque references, not copies

A Core entity is referenced as `{ entityType, entityId }` and never described.

**Forbids:** two things. Copying Core's record into a contract, which creates a second source of truth that is stale the moment it is written. And **assuming Core's identifier scheme** — `entityId` is not validated as a UUID, because Core chooses its identifiers and Phase 2 has not looked at them. Assuming would be inventing a fact about a system we have not integrated with, which is the exact failure this phase exists to avoid.

## 7. No hidden reasoning

There is no chain-of-thought field, no hidden-reasoning field, no raw model-response field, and no prompt field. There is no place to put one: governed containers reject those keys by name.

What _is_ stored is the **rationale** — the reasoning the agent states as its justification, written to be read and challenged by a human — and the **evidence** it rests on.

**Forbids:** retaining unreviewed model deliberation about real people. It is a privacy liability that grows with every run, and it invites a false sense of auditability: an audit trail built on text nobody reviewed is not an audit trail ([agent-model.md](../architecture/agent-model.md), [privacy-principles.md](../governance/privacy-principles.md)).

## 8. Machine-readable codes, and human text kept separate

Reason codes, failure codes, purpose codes, signal codes: lowercase machine tokens, stable across releases. Summaries and explanations: bounded human text.

**Forbids:** deriving one from the other. A reason a human reads and a reason a machine counts are different artifacts. If the code is generated from the sentence, then editing the sentence silently changes the metric — and "how often did Core refuse for consent withdrawal?" stops having an answer.

## 9. Authority is a literal, not a convention

`producingSystem: 'qf-jarvis'`. `issuer: 'quickfurno-core'`. `executor: 'n8n'`. `deliverySemantics: 'at-most-once'`.

**Forbids:** an authority claim that a reviewer has to notice. A rule in a document is enforced by whoever remembers it. A literal in a schema is enforced by the parser, at 3am, on a payload nobody is watching. The deciding actor of an approval is a human **or** a versioned policy — and there is no agent variant, so an agent approving itself is not merely forbidden, it is **unrepresentable**.

## 10. Fail closed, always

An unknown event type, an unknown version, a malformed payload, an unexpected field: rejected.

**Forbids:** coercion, silent defaults, and — specifically — **falling back from an unknown future version to version 1**. That fallback looks like resilience and is data loss: the fields a v2 payload changed are exactly the ones a v1 parser would drop. "An unknown version is rejected, never guessed at" ([change-management.md](../governance/change-management.md) §6).

## 11. Optional means optional, not undecided

A field is optional only where its absence is **meaningful**. `causationEventId` is absent when an event has no cause. `failure` is absent when nothing failed.

**Forbids:** an optional field that exists because nobody made a decision. Optionality is a statement about the domain, not a way to defer an argument — and every optional field is a branch every consumer must handle forever.

## 12. Validation is pure

No logging. No network. No filesystem. No environment. No clock. No randomness. No mutation of the input.

**Forbids:** two specific disasters.

**Reading the clock.** Timestamp rules are checked _against each other_ — `emittedAt` may not precede `occurredAt`; `expiresAt` must follow `issuedAt` — never against _now_. An event that was valid when it was emitted must not become invalid because it was replayed tomorrow. **Replay is a first-class feature**, and a validator that consults the wall clock quietly breaks it ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)).

**Logging the input.** The most likely payload to fail validation is one that should never have existed — carrying a credential, or a phone number. A validator that helpfully logs what it rejected has just written that secret to disk. So errors carry a **path, a code, and a message** — and never the value ([security-principles.md](../governance/security-principles.md) §5).

## 13. Test-first for the rules that matter

Idempotency identity, expiry, authorization literals, bounds, at-most-once semantics, and ambiguity handling are developed test-first ([engineering-principles.md](../governance/engineering-principles.md) §2).

**Forbids:** a placeholder test. And it forbids trusting a rule that nothing exercises: every valid fixture must parse, every invalid fixture must fail, and every registered event type must have a fixture — so a contract cannot be registered and left unexercised.
