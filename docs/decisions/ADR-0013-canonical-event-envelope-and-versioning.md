# ADR-0013 — Canonical Event Envelope and Versioning

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0003](./ADR-0003-event-driven-integration.md) decided that QuickFurno Core and QF Jarvis integrate through canonical events. Phase 2 must give that decision a shape: what an event _is_, how it is identified, how it is versioned, and what happens when one arrives that nobody recognizes.

Every one of those questions has an obvious answer that is wrong in a specific, expensive way. This ADR records which wrong answers were rejected, because each is the kind of thing a future contributor will propose in good faith.

## Decision

**A single strict envelope, sourced from QuickFurno Core, identified by `eventType` + `eventVersion`, dispatched through a static registry that fails closed.**

### 1. One envelope, one payload

```
eventId · eventType · eventVersion · occurredAt · emittedAt
source · subject · correlationId · causationEventId? · payload
```

The envelope is identical for every event; only the payload differs. Every event is built through one factory (`defineCanonicalEvent`), so the envelope rules — the Core source literal, the timestamp ordering, the self-causation ban, strict key rejection — are written **once** and cannot be forgotten by whoever adds the next event.

Unknown fields are rejected. The envelope is strict.

### 2. `source` is the literal `quickfurno-core`

Every canonical event is emitted by Core, because **a fact is only a fact once Core has recorded it** ([ADR-0001](./ADR-0001-source-of-truth-boundary.md)).

This holds even when the underlying thing happened elsewhere: a provider delivered a message, n8n observed it, n8n reported it, **Core recorded it, Core emitted the event**. The provider's view appears _inside_ an execution-result payload as **reported evidence** — `reportingSystem` may name n8n or the QF Communications Runtime — but the envelope still says Core.

One event therefore carries two distinct claims, and the contract keeps them apart:

- **Payload:** "n8n reports the provider accepted this."
- **Envelope:** "QuickFurno Core is telling you."

Collapsing them would make a provider's optimistic acknowledgement into business truth — the exact failure that lets a founder believe a message arrived when it did not.

### 3. Naming: `qf.<aggregate>.<past-tense-fact>`

Lowercase, dot-separated, always **past tense**.

Past tense is not a style preference. An event is a statement that something _happened_. `qf.communication.state-recorded` is a fact; `qf.communication.send` would be an **instruction**. The moment a consumer can be _instructed_ by an event, the event bus has become a command channel — and any producer on it has become an authority. The naming convention is the first line of defence against that, and it is cheap to hold.

`qf.` names the canonical namespace, so an event from anywhere else is distinguishable on sight.

### 4. `eventId` is the idempotency identity

At-least-once delivery is the only kind that exists ([engineering-principles.md](../governance/engineering-principles.md) §8). `eventId` is what makes a duplicate **detectable**, and Phase 3 cannot exit without proving idempotency by deliberately redelivering events.

### 5. Ordering and causation are checked between fields, never against the clock

- `emittedAt` may not precede `occurredAt`. An event announced before it happened is a clock fault or a forgery.
- `causationEventId` may not equal `eventId`. **An event may not cause itself.**

**Both checks compare the payload with itself. Neither reads `now`.** This is deliberate and load-bearing: a replayed event from last month must still validate today. A validator that compared a timestamp to the current time would reject the entire event history the first time anyone tried to rebuild a read model from it — and rebuilding read models from history is a **first-class feature**, not a recovery hack.

The self-causation ban protects the audit walk. The chain is walked _backwards_ — effect → result → intent → approval → recommendation → evidence → events — and that walk is what makes an incident recoverable rather than merely alarming. A self-causing event turns it into an infinite loop, which means the one tool you need during an incident is the tool that hangs.

### 6. `type + version` identifies exactly one contract

`qf.approval.decision-recorded@1` is one shape, permanently. Not a shape that grows.

### 7. The registry is static, and genuinely immutable

Built from source at module load, closed over, exposing only `get`, `has`, `keys`, and `size`. There is **no `register()`**, and no `set`.

A `ReadonlyMap` would not have been enough, and the distinction is worth recording: `ReadonlyMap` is a _compile-time view_ over a real `Map`, and a `Map` still has `.set()` at runtime. `Object.freeze` does not help either — a Map's entries live in internal slots that freezing does not touch. So the backing map is never handed out.

**Adding an event type is a code change, which means a diff, which means a reviewer.** A registry that accepts schemas at runtime is a registry that can be taught — by an attacker, or by a careless caller — to accept a payload nobody reviewed.

### 8. Unknown type or version fails closed — and **never falls back to v1**

This is the rule most worth defending, because the fallback _looks_ like resilience.

If Core one day emits `qf.approval.decision-recorded@2`, this code does **not** parse it as a v1 and drop the fields it does not recognize. **The fields it does not recognize are precisely the ones that changed** — that is what a new version means. A "tolerant" parser would silently discard the new semantics and carry on, producing a system that is confidently wrong.

> _"An unknown version is rejected, never guessed at."_ — [change-management.md](../governance/change-management.md) §6

A rejected event becomes a visible, alertable, replayable dead letter, and is reprocessed once the consumer is updated. That is a bad afternoon. A silently downgraded event is a bug with a three-week fuse and no alarm.

### 9. No automatic schema upgrade

Parsers validate. They do not transform, coerce, default, or upgrade. **Migration is an explicit function with a name**, called by a caller who decided to call it.

**Phase 2 needs no migrations, because only version 1 exists.** Building a migration framework now would be building infrastructure for a problem that does not exist, against a shape nobody can predict.

### 10. Core's domain event catalog is deferred

**There is no `qf.lead.created`, no `qf.vendor.onboarded`, no `qf.wallet.debited`** — and their absence is the most important thing in the catalog.

We have not integrated with Core. We do not know what it emits, what its lead record contains, or what it calls the fields. Writing `leadCreatedEventV1` today would mean inventing a payload shape for a system nobody has looked at, and that has exactly two outcomes:

1. **Core disagrees, and we bend the contract** to whatever Core happens to emit. The contract becomes a _description of Core's implementation_ rather than an agreement between systems — the failure [engineering-principles.md](../governance/engineering-principles.md) §1 forbids by name.
2. **Core disagrees, and we find out in Phase 11** — after four agents, an event backbone, and a control plane were built against a fiction. That is not a contract change; it is a rewrite.

So Phase 2 registers the **six architecture lifecycle events we genuinely own** — the recommend → authorize → execute → report chain — and establishes the _mechanism_. Core's domain events arrive with Core integration, where the real capabilities are verified **first**, and where _"the adapter absorbs the difference; the contract does not bend"_ ([phased-roadmap.md](../architecture/phased-roadmap.md), Phase 11).

This is not a gap. The roadmap says Phase 2 _"completes independently"_ and that Core's current capabilities are _"unverified and deliberately out of scope here."_

## Alternatives considered

**1. CloudEvents.**
Rejected, and it was the closest call. It is a real standard with real tooling, and `id`/`source`/`type`/`specversion`/`subject` map closely onto what we need.

It loses on two points that matter here. Its `source` is a URI describing _where_ an event came from — a producer address — whereas ours is an **authority claim**, constrained to a single literal that encodes the boundary. And its extension mechanism is permissive by design, which is exactly the property we do not want: our envelope is strict, and an unrecognized field is a contract mismatch, not a bonus. Adopting CloudEvents and then bolting strictness onto it would leave us with a standard we no longer conform to.

Revisit if a third system needs to interoperate on a standard envelope.

**2. Version inside the event type — `qf.recommendation.created.v1`.**
Rejected. It makes the version a substring, so every consumer parses it out of a string with a regex, and a typo becomes an unknown event type rather than an unknown version — which are different failures deserving different alerts. A separate integer field is trivially comparable and cannot be fat-fingered into silence.

**3. Semantic versioning for events.**
Rejected. What would a patch version of a wire contract even mean? Either the shape is the same, in which case the version does not change, or it is different, in which case every consumer must decide. A single integer forces that decision to be explicit.

**4. A runtime-extensible registry** — `registerEvent(type, version, schema)`.
Rejected. It is convenient for tests and catastrophic in production: anything holding the reference can teach the parser a new shape with no diff and no reviewer. The static registry is the security control, and its inconvenience is the feature. Tests use the real registry.

**5. A tolerant parser that accepts unknown versions and passes through unknown fields.**
Rejected — see §8. This is _the_ attractive mistake in event-driven systems, and it fails silently, which is the worst way to fail.

**6. Signature and delivery metadata in the envelope.**
Rejected for Phase 2. Signature verification is a transport concern at a trust boundary and arrives with the transport in Phase 3. Retry counts and queue names belong to the infrastructure, and putting them here would bind the contract to an infrastructure choice nobody has made yet.

## Consequences

**Positive.**

- **One envelope, enforced once.** A new event type cannot forget the boundary rules, because the factory applies them.
- **Idempotency is decidable** from the event alone, which is what Phase 3 needs to prove replay-safety.
- **Replay works**, because validation reads no clock.
- **Unknown contracts fail loudly** and become replayable dead letters, rather than being silently downgraded.
- **The registry is reviewable in source control**, so accepting a new shape requires a human.
- **The boundary is in the type**: `source` cannot be anything but Core.
- **Phase 2 completes without Core**, exactly as the roadmap intends.

**Negative — accepted.**

- **Strictness means a Core field addition breaks us** until the library ships. That is the correct failure: a payload that does not match the agreed contract is a payload we should not silently accept.
- **Rejected events need somewhere to go.** Phase 3's dead-letter handling is the answer, and it is already in that phase's exit criteria.
- **The event catalog looks thin.** Six lifecycle events and no business domain events reads like an unfinished job to anyone who has not read this ADR. It is the opposite, and this ADR is where that is written down.
- **Not CloudEvents**, so interoperating with a third party on a standard envelope would need an adapter.

## Risks

| Risk                                                                | Mitigation                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Somebody adds a v1-fallback "for resilience"**                    | Rejected here, with the reason. It is a **review blocker**. A test asserts that an unknown version fails and that the error message says it never falls back |
| **Domain event contracts get invented before Core integration**     | Rejected here, with the reason. Registering an event is a diff; a `leadCreatedEventV1` in a pull request is a conversation, not a merge                      |
| **The registry gains a `register()` function for test convenience** | The registry exposes no mutator, and a test asserts that. Tests use the real registry                                                                        |
| **An event type is registered without a fixture**                   | A test asserts every registered `type@version` has a valid fixture. A contract cannot be registered and left unexercised                                     |
| **A validator starts reading the clock**                            | Tested: the same intent parses with the system time set to 2000 and to 2030                                                                                  |
| **Core cannot emit this envelope shape**                            | Then an **adapter** in Phase 11 produces it. The contract does not bend. This is the trade the roadmap already made, deliberately                            |

## Follow-up

- **Phase 3** builds ingestion on `parseCanonicalEvent`: signature verification, idempotent processing on `eventId`, dead letters for rejected events, and replay.
- **Phase 11** adds Core's domain event contracts, **after** verifying what Core can actually emit, with adapters absorbing the difference.
- Revisit CloudEvents if a third system must interoperate on a standard envelope.
- If a v2 of any contract is ever needed, follow [versioning-and-compatibility.md](../contracts/versioning-and-compatibility.md): define alongside, register both, migrate explicitly, state the window.
