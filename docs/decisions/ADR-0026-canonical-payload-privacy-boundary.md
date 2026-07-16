# ADR-0026 — Canonical Payload Privacy Boundary

**Status:** **Accepted** — accepted by **Keshav Sharma** (Founder, QuickFurno — business owner) on **2026-07-13**.
**Date:** 2026-07-13
**Accepted:** 2026-07-13
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

> ### What the owner accepted
>
> The **Canonical Payload Privacy Boundary**: strict, event-specific canonical payload schemas; the removal of arbitrary free text and open dictionaries; defence-in-depth prohibited-content scanning; **all 41 inherited events moving from v1 to v2**; the **immediate retirement of the vulnerable v1 contracts**; the **zero-length migration window** — explicitly, and on the stated grounds that `producerCount`, `consumerCount` and `persistedEventCount` are **all zero**; **11 new taxonomy events at v1**; the documented **taxonomy-label residual**; and the **permanent preservation of the historical GPS-gap evidence**.
>
> **§5 asked for exactly this decision and named it as the owner's to make.** It is now made: the migration window is zero because there was nobody to migrate, and v1 is retired immediately rather than kept ingestible for the benefit of no one.
>
> **Acceptance authorizes the contract design and the retirement. It authorizes no action against any running system** — no Supabase connection, no provider change, no migration, no n8n, no WhatsApp, no QuickFurno mutation, and no Stage 3.2 implementation before PR #9 is merged.
>
> **The acknowledged residuals stand, and are not softened by acceptance.** The prohibited-content scan is the _second_ lock and can be defeated by a determined producer; `rationale`/`summary`/`explanation` survive as guarded human-authored governance text; and a benign sentence under 64 characters is still a valid taxonomy label. Each is stated in the sections below, and acceptance does not quietly delete any of them.

**Depends on:** [ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md) (envelope and versioning) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) (memory bounds) · [ADR-0025](./ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (**Accepted**, the compatibility baseline that found this)

---

## Context

Stage 3.1.2 read QuickFurno Core and found a hole on **our** side of the boundary.

The canonical payload refused the obvious carriers — `body`, `notes`, `freetext`, `raw`, every contact key, and any value containing an email or a phone number. It nonetheless accepted this:

```ts
derivedObservationSchema.safeParse({ requirement: 'GPS: 18.5204, 73.8567' }); // ✅ accepted
```

**And QuickFurno Core stores precise client coordinates inside `leads.message`.** There are no `latitude`/`longitude` columns on `leads`; the enquiry form interpolates the captured coordinates into free text, which lands in the requirement. So "map the lead's requirement" — the single most natural thing an adapter author would do — **would have carried a client's home location across the boundary in a field nobody classified as sensitive.**

Two structural weaknesses made it possible, and both are worse than the specific bug:

**One — `detail`.** Every observation payload carried `detail: boundedText(500)`. Bounded, yes. **Arbitrary, also yes.** Free text is where a source record arrives one convenient copy at a time, and a 500-character field is a 500-character door.

**Two — `signals`.** It was `z.custom<JsonObject>()`: an **open dictionary**. Key-filtered and bounded, and structurally a `Record<string, unknown>`. **A schema that accepts any key has not decided what the event means**; it has deferred the decision to whoever fills it in, which is the opposite of what a contract is for.

**This is a known contract gap, not an accepted risk** — and it cannot be deferred to Phase 11, because Phase 11 is the first moment real personal data crosses the boundary. It may not begin through a hole we had already written down. It must close before **Stage 3.2**, because **signing a payload that can smuggle coordinates only makes the smuggling authenticated**, and a signature is exactly what would later be cited as evidence the payload was trustworthy.

## Decision

**Canonical payloads carry only event-specific, bounded, explicitly-declared fields. Arbitrary free text is prohibited. The schema is the control; the detector is the backup.**

### 1. Only event-specific, bounded payloads

Every canonical event resolves to **exactly one** payload schema, in **one** authoritative registry keyed by `eventType` + `eventVersion`. Every payload is a strict object of explicitly declared fields: every string bounded, every enum explicit, every number finite and bounded, every count non-negative, every identifier a validated opaque reference, every timestamp the existing timestamp contract, every nested object and array explicitly defined.

> **A payload with nowhere to put a coordinate does not need to be searched for one.**

### 2. Arbitrary free-text payload values are prohibited

**`detail` is gone.** `reasonCode` says _why_, and a reason code is a stable token that can be **counted** — which is what lets an auditor ask _"how often did Core refuse for missing consent?"_ and get an answer. A free-text reason cannot be counted, so it cannot be governed; and a free-text reason is where the coordinates were.

**`signals` is now an explicitly-shaped list** — a `code`, and optionally one way of quantifying it (a band, a unit value, a score, a count, a boolean). It cannot carry a sentence, because it has no field that holds one.

**`Record<string, unknown>` payload freedom is prohibited.** There is no permissive fallback schema, and there must never be one: a fallback schema is a schema that accepts an event nobody designed, and therefore an event nobody reviewed.

### 3. Unknown events, versions and keys fail closed

An unregistered event type fails. A registered type at an **unregistered version** fails. An unknown key on a known payload fails. **Nothing falls back, and nothing is guessed at** ([ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md) §8).

### 4. What may never cross, and renaming does not launder it

**Prohibited:** client or vendor name · phone · email · postal or office address · precise GPS · latitude · longitude · coordinate arrays · map URLs · message · requirement text · notes · body · raw content · transcript · recording URL · prompt · WhatsApp message content · provider credentials · connection strings · JWTs · API keys · private keys.

Key matching is **normalised and segment-aware**: `client_phone`, `clientPhone`, `ClientPhone` and `CLIENT-PHONE` are one key. **An unsafe field does not become safe because it was renamed** — which is precisely how `leads.message` would have arrived, as `requirement`.

**And the safe form must stay safe.** `recipient: entityReference` is the _correct_ design — reference the person, never reproduce them — so the key `recipient` is permitted while `recipientPhone` is not. `contactAttempts` is a **count**; `cityName` is a **label**. **Punishing the safe form of a field teaches people to bypass the check, not to comply with it.**

**Core resolves contact details only at authorized execution time.** Jarvis never learns the recipient, because it never holds them.

### 5. Versioning — the inherited events move to v2, and v1 is deregistered

**This is a breaking change**, and [change-management.md §6](../governance/change-management.md) is unambiguous: _"A breaking change is a **new version**, never an edit in place."_ No repository ADR explicitly permits correcting an unshipped contract in place, so **Option B was not available**, and I did not grant myself the exception.

| Event family                                                                                                            | Decision              | Why                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All 41 inherited events**                                                                                             | **New version 2**     | Every one was exposed: 22 through `detail` + open `signals`, 19 through the free text inside their embedded governance contracts. The audit is per-event, and it came back unanimous — this is a **measured** global bump, not an invented one                   |
| **The 11 taxonomy events**                                                                                              | **New, at version 1** | New contracts. There is nothing to supersede                                                                                                                                                                                                                     |
| **The embedded governance contracts** (recommendation, approval decision, execution intent/result, assignment batch, …) | **Not re-versioned**  | Their **shapes** were never the problem. What they lacked was a guard over the human-authored text inside them, and the v2 _event payload_ supplies it. Re-versioning fifteen contracts to fix a hole at the event boundary would have been ceremony, not safety |

**Version 1 is removed from the ingestion registry**, and this is the load-bearing part. Its schemas still exist, and the regression tests parse against them directly to prove what they used to accept — **but they are not ingestible.** Leaving v1 registered would have left the door it opened standing open, and **closing a door while leaving the door open is not a fix.**

> **The migration window is empty, by measurement rather than by assertion.** §6 also requires that _"both versions are supported through a stated migration window"_ — and a migration window exists to let **producers and consumers** migrate. **There are none.** ADR-0025 (Accepted) records the finding: QuickFurno Core **emits none of the canonical events**, and no consumer exists. The window therefore opens and closes at Stage 3.1.4, because the set of parties to migrate has size zero.
>
> **This is the one point in this ADR where I am applying a rule to a set of size zero rather than following it literally, and it deserves the owner's explicit attention.** If the owner would rather keep v1 registered through a stated window, that is their decision — but it would mean **keeping the GPS hole open for the length of the window**, for the benefit of nobody, since nobody is emitting v1.

### 6. Coordinate detection is defence-in-depth, and is _not_ the primary control

The prohibited-content scan refuses coordinate pairs in strings, **labelled** coordinates (`lat=…`), **structured** latitude/longitude keys, **coordinate arrays**, map links, contacts and credentials.

**A regex is not a coordinate defence for structured data.** `[18.5204, 73.8567]` never becomes a string, so no pattern over strings would ever see it — which is why the array rule and the numeric-key rules exist **beside** the patterns rather than instead of them.

**And a detector is not a schema.** An attacker who controls a string can usually defeat a detector, and a detector that tried hard enough to stop them would reject half the business vocabulary. So the detector guards the fields that legitimately hold human-authored governance text — **a recommendation's `rationale` must exist and must be challengeable** — and it guards against the day somebody adds a field without thinking. It is the second lock.

#### False-positive control is a first-class requirement

**A rule that cries wolf is worse than no rule**, because its removal is a one-line diff with a sympathetic reviewer. So:

- A coordinate needs **two** numbers, **in range**, at **three or more fractional digits**. `18.5, 73.8` is a ten-kilometre box and is not somebody's home. `[1.5, 2.5]` is a pair of measurements. `[123.4567, 456.789]` is out of range and is not a place.
- **UUIDs are exempt from the phone-shaped digit-run rule.** `a100000a-0000-4000-8000-000000000001` contains a twelve-digit run; without the exemption the guard rejects essentially every valid event — **not a strict guard, a broken one.** The exemption is shape-anchored to a whole UUID, and only that one rule is relaxed.
- Keys match by **segment**, never by substring: `cityName` and `categoryName` are the taxonomy vocabulary and must survive.

**ISO dates, semantic versions, ordinary integers, prices, percentages, category and city codes, UUIDs, bounded taxonomy labels and reason codes must all remain valid** — and a test fails if any of them stops being.

### 7. Safe taxonomy, and no new authority

Taxonomy events carry **permanent ids** and a **taxonomy version**, plus a bounded **display label**. **Logic keys on the id and the version. Labels are for humans.** A label is renamed by an admin on a Tuesday, and every rule keyed on the string silently changes meaning — QuickFurno already carries that wound, with categories as denormalised text matched by three divergent rulesets.

**Historical events retain their original taxonomy version, and are never rewritten.** A replay of March must reproduce March; **rewriting history to agree with the present is how a replay stops being evidence.**

**Jarvis is told. Jarvis never decides.** There is no create, update or deactivate Jarvis can express — these are events Core emits, not commands Jarvis sends. **Taxonomy administration is Core/admin-only, and this hardening grants Jarvis no new authority of any kind.**

### 8. No live producer depends on these contracts

**Nothing emits them. Nothing consumes them.** That is what makes this correction cheap now and expensive later, and it is the reason to do it before Stage 3.2 rather than during Phase 11.

### 9. Retired versions are catalogued, not merely deleted

The 41 withdrawn v1 contracts are recorded in a **machine-readable retirement catalogue** (`packages/contracts/src/events/retired-versions.ts`, mirrored into the compatibility manifest): what was retired, what replaced it, why, and — the part that makes the zero-length migration window honest rather than convenient — **producer count 0, consumer count 0, persisted event count 0.**

**Git history remains the source for the exact retired schema.** A contracts package that carries its own dead schemas around forever becomes a museum, and somebody eventually wires the exhibits back up. The catalogue carries the **traceability**, not the corpse.

**A retired version and an unknown version fail differently, and must stay different:**

| Condition                      | Error code                    | Who must act                            |
| ------------------------------ | ----------------------------- | --------------------------------------- |
| A **retired** version arrives  | `unsupported_retired_version` | The **producer** is behind us           |
| An **unknown** version arrives | `unsupported_unknown_version` | The **consumer** is behind the producer |

Collapsing them into one "unknown contract" error loses the distinction at exactly the moment it decides who gets paged.

### 10. The taxonomy label: a word count was tried, and was the wrong control

An earlier draft capped a taxonomy label at **five words**. **That was wrong and is withdrawn.**

**A word count is not a privacy boundary.** It stops nothing that matters — a two-word label can be a place name followed by a ten-digit number — and it **rejects valid names**: Hindi and Hinglish service categories are routinely longer than five words (_"Modular Kitchen aur Wardrobe Designers"_, _"घर का इंटीरियर डिज़ाइन और नवीनीकरण"_). **A rule that refuses a legitimate business category buys no safety in exchange, and the business will route around it.**

The boundary is **content**: at most 64 Unicode characters; at least one meaningful character; no repeated whitespace, newlines or control characters; **no URLs, emails, phone shapes, coordinates or map links**; no message punctuation; bounded human-readable punctuation permitted; **a permanent taxonomy id and `taxonomyVersion` always required**. Taxonomy remains **Core/admin authoritative**.

**A word-count _recommendation_ may exist in a UI. It must never invalidate a canonical event.**

> **The honest residual:** a benign sentence under 64 characters, carrying no contact data and no coordinates, **will still be accepted as a label.** That is a deliberate trade, stated rather than hidden: it is untidy, and it leaks nothing. **The thing being defended is the client's phone number and front door — not the taxonomy's prose style.**

### 11. Implementation-review snapshot (historical — superseded by owner acceptance)

> **Historical status before owner acceptance — superseded.** The paragraph below was
> true at implementation-review time and is preserved as the review-time record. It is
> **no longer current**; see "Present status" immediately after it.
>
> _The hardening is **implemented and tested**. It is **not accepted**. ADR-0026 is
> **Proposed**, the Stage 3.1.4 PR is unmerged, and CI has not run. So the finding stands
> at `fixed_pending_acceptance`, and Stage 3.2 remains `blocked_by_stage_3_1_4`._
>
> **An implementation is not an acceptance.** A stage that clears its own gate the moment
> its tests go green has replaced the reviewer with the author.

**Present status (current).** ADR-0026 was **accepted by the owner on 2026-07-13**; **PR #9
(Stage 3.1.4) is merged**; **Stage 3.1.4 is complete**; the **Stage 3.2 blocker is closed**;
and **Stage 3.2 — pure signature verification — is implemented and awaiting owner
acceptance** ([ADR-0027](./ADR-0027-stage-3-2-signature-verification-protocol.md)). The
finding is now `resolved` / `accepted`. The principle above still holds — implementation is
not acceptance — and the acceptance here was the owner's separate act, recorded in the header.

## Consequences

**Positive.**

- **The exposure is closed structurally, not by vigilance.** There is no field a coordinate can sit in, and that survives the next careless commit in a way a code-review convention does not.
- **The open dictionary is gone.** Every event now _means_ something specific, and a producer cannot quietly extend it.
- **The taxonomy gets ids and versions**, so a rename stops being a silent semantic change.
- **The false-positive suite makes the guard survivable.** A guard that nobody wants to switch off is a guard that is still there in a year.

**Negative — accepted.**

- **Every inherited event is now v2**, and everything downstream must say so. That is the price of the versioning rule, and the rule is right.
- **The prohibited-key list is a maintenance surface.** It will be wrong eventually — too narrow, and something leaks; too broad, and somebody deletes it. The false-positive suite is the only thing that keeps the second failure visible.
- **The detector can be defeated by a determined producer** — obfuscated coordinates, a novel encoding. **It is the second lock, and it is documented as one.** The schema is what actually holds.
- **The `rationale`/`summary`/`explanation` fields survive**, guarded but still human-authored. An agent could still write something careless into one. Removing them would gut the governance contracts — _"the stated reasoning from evidence to conclusion, written to be challenged"_ — so they are kept and **guarded**, and that trade is stated here rather than hidden.

## Alternatives rejected

**Correct v1 in place (the "pre-live security correction").** Simpler, and it would leave no dead version behind. **Rejected**: change-management §6 says a breaking change is a new version and never an edit in place, and **no repository ADR explicitly permits correcting an unshipped contract.** I am not entitled to grant myself that exception; the owner is.

**Bump to v2 and keep v1 registered through a migration window.** The literal reading of §6. **Rejected**: it keeps the GPS hole ingestible for the length of the window, for the benefit of **nobody** — there are no producers. See §5.

**Rely on the coordinate detector and keep the free-text fields.** **Rejected.** A detector is not a schema. It cannot see an obfuscated coordinate, and it must never be asked to do the schema's job. This was the _original_ failure, restated with more regexes.

**Cap a taxonomy label at five words.** **Rejected**, after being tried. It stops nothing that matters and it refuses legitimate Hindi and Hinglish service names. See §10.

**Prohibit `description`, `explanation`, `rationale` and `summary` outright.** **Rejected.** They are Jarvis-authored governance artifacts, not copies of Core's record, and a recommendation without a challengeable rationale is not a recommendation. They are **guarded** instead — and that is a deliberate, named exception rather than an oversight.

**Enumerate a coordinate value-pattern into the governed value checks and stop there.** **Rejected** as insufficient on its own: it does nothing about `[18.5204, 73.8567]`, which is not a string.
