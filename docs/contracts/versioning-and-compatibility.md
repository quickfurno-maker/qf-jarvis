# Versioning and Compatibility

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

Decision: [ADR-0013](../decisions/ADR-0013-canonical-event-envelope-and-versioning.md).

---

## Two versions, and they are never the same thing

|                              | What it describes                  | Changes when                                          |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------- |
| **Package version**          | The `@qf-jarvis/contracts` library | Anything ships — a doc fix, a new fixture, a refactor |
| **Contract / event version** | A **wire contract**                | The _shape_ changes. Almost never                     |

**Conflating them is how a consumer ends up rejecting a valid payload because a dependency was bumped.** A patch release of the library must not invalidate a single event that was in flight when it landed.

`eventType` + `eventVersion` identifies exactly one contract, forever. Payload contracts carry their own `contractVersion`.

---

## The rules

### A version is a positive integer

Never zero. Never a semver string. Never a date. `1`, then `2`.

### Type + version uniquely identifies a contract

`qf.approval.decision-recorded@1` is one shape, permanently. It is not a shape that grows.

### Unknown versions fail closed

An unregistered `type@version` is **rejected**. Not logged and skipped. Not parsed leniently. Rejected.

### **No automatic fallback from an unknown future version to version 1**

This is the rule most worth defending, because the fallback _looks_ like resilience.

If Core one day emits `qf.approval.decision-recorded@2`, this code does **not** quietly parse it as a v1 and drop the fields it does not recognize. The fields it does not recognize are **precisely the ones that changed** — that is what a new version means. A "tolerant" parser would silently discard the new semantics and carry on, producing a system that is confidently wrong.

> _"An unknown version is rejected, never guessed at."_ — [change-management.md](../governance/change-management.md) §6

A rejected event goes to a dead letter, which is visible, alertable, and replayable once the consumer is updated. That is a bad afternoon. A silently downgraded event is a bug with a three-week fuse.

### A field is never repurposed

Not renamed in meaning, not widened, not "reused since it was free". A field that meant one thing in v1 means that thing forever. If it must mean something else, it is a **new field** or a **new version**.

Silent semantic change is the worst possible contract bug: it passes every test, deploys cleanly, and corrupts data for weeks before anybody notices the recommendations got worse.

### These require a new version

- **Removing** a field.
- **Reinterpreting** a field's meaning.
- **Adding a required field.** An old producer would emit payloads a new consumer refuses.
- **Narrowing** a type or a bound.

### These may be possible without one — but are still reviewed

- **Adding an optional field.** Old consumers ignore it. But **note the interaction with strictness**: our schemas are strict, so an _old consumer_ on an _old library version_ will reject a payload carrying the new field. In practice, adding an optional field to a shared contract still means shipping the library before the producer.
- **Adding an enum member.** Reviewed for consumer compatibility, always — an exhaustive `switch` on the old enum becomes non-exhaustive, and a consumer that fails closed on an unknown member will start rejecting valid payloads. Every enum widening is a compatibility question, never a formality.

### Versions coexist

`@1` and `@2` may both be registered and both parse, through a stated migration window. That is what makes a migration possible without a flag day.

### Parsers do not upgrade payloads

A parser validates. It does not transform, coerce, default, or upgrade. **Migration is an explicit function with a name**, called deliberately by a caller who decided to call it.

**Phase 2 needs no migrations, because only version 1 exists.** Writing a migration framework now would be building infrastructure for a problem that does not exist yet, against a shape we cannot predict.

---

## Adding a version, when the time comes

1. Define `…V2` alongside `…V1`. **Do not edit V1.**
2. Register `type@2`. Leave `type@1` registered.
3. Add fixtures — valid and invalid — for V2.
4. If the two are convertible, write an **explicit, named migration function** and test it both ways.
5. State the migration window in the pull request. Both versions are supported through it.
6. Remove V1 only when nothing produces it, and only after the window closes.

> _"A breaking change is a new version, never an edit in place."_ — [change-management.md](../governance/change-management.md) §6

---

## Compatibility with QuickFurno Core

When Core's actual shapes turn out to differ from these contracts — and they will, somewhere — the roadmap is explicit about which one moves:

> **"The adapter absorbs the difference; the contract does not bend."** — [phased-roadmap.md](../architecture/phased-roadmap.md), Phase 11

That is only a credible position because these contracts were designed from the approved domain rather than reverse-engineered from Core's current implementation. Bending the contract to fit whatever Core happens to emit today would turn it into a description of that implementation — and then it would have to bend again the next time Core changed.
