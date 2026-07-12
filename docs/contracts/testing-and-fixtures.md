# Testing and Fixtures

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-12

---

## What the tests actually prove

**912 tests across 11 files, all passing, none skipped.**

|                      | Count                                      |
| -------------------- | ------------------------------------------ |
| Tests                | **912**                                    |
| Valid fixtures       | **92** — 51 contract, 41 event             |
| Invalid fixtures     | **141**                                    |
| Registered events    | **41** — and every one has a valid fixture |
| Communication states | **18** — exactly, and in order             |

A valid fixture shows a contract can express a legitimate fact. An **invalid** fixture shows it **cannot express an illegitimate one** — and the second is the property the architecture actually depends on.

The invalid table is therefore the important one. What each of its most load-bearing entries would mean **if it ever passed**:

| Fixture                                          | If it parsed                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Jarvis claims approval authority                 | An agent could approve its own recommendation                                  |
| An agent named as the deciding actor             | Agent self-approval would have a shape                                         |
| An approval request carrying an `outcome`        | **Jarvis could approve itself by adding a field**                              |
| `approveOnTimeout` on an approval request        | **Silence would become consent**                                               |
| Execution intent issued by Jarvis                | Jarvis could manufacture authority by manufacturing an artifact                |
| Execution intent targeting a provider            | The _Jarvis → provider_ edge would exist                                       |
| Missing idempotency key                          | A retry could double-send, or double-dial                                      |
| Retry permission hidden in `parameters`          | A second external effect could be authorized by a flag rather than a decision  |
| Indeterminate result claimed as success          | A founder could be told a call connected when nobody knows                     |
| `provider-accepted` recorded as `succeeded`      | **A founder would be told a message arrived when a provider merely took it**   |
| A consent flag on a communication request        | **A stale copy of a permission could authorize a message**                     |
| Contact details where a reference belongs        | A recipient could be addressed directly, bypassing Core's consent              |
| A nineteenth communication state                 | The lifecycle could quietly fork                                               |
| A composite with no contributors                 | A Jarvis conclusion could wear a specialist's disguise                         |
| Approved lifecycle state with no Core decision   | Jarvis could mark its own recommendation approved                              |
| An assignment batch issued by Riya               | **An agent could choose who receives somebody's business**                     |
| A fourth vendor in a batch                       | The three-vendor cap would be decoration                                       |
| A seventh unique vendor across two batches       | The six-per-lead-category lifetime cap would be decoration                     |
| A replacement batch with no client confirmation  | **Three vendors contacted because a model inferred dissatisfaction**           |
| A linked lead reusing the parent's identity      | A kitchen lead would inherit a wardrobe's consent and verification             |
| Agent memory marked `authoritative: true`        | **A derived store would have become a second source of truth**                 |
| Agent memory marked `rebuildable: false`         | A derived store would have to be preserved — a database of record              |
| Anisha holding client memory                     | The bounded-specialist model would be over                                     |
| Chain-of-thought in a memory record              | Model internals would be stored, and would leak                                |
| A prompt configuration carrying the prompt       | The largest concentration of personal data in the system, in an innocent table |
| Training eligibility with incomplete provenance  | Data we could never honour a deletion request against would train a model      |
| Sensitive personal data marked training-eligible | There is no careful way to do this                                             |
| An erasure "completed" with scopes outstanding   | **A legal obligation closed while the data still sits in an agent's memory**   |

Each of those is a sentence in an approved document until something refuses it. These tests are the thing that refuses it.

---

## Test categories

| Suite                    | Covers                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures.test.ts`       | Table-driven: **every** valid fixture parses; **every** invalid fixture fails; JSON round-trip; input is not mutated; the parser returns a new object                                   |
| `bounded-json.test.ts`   | Functions, symbols, bigint, `undefined`, `NaN`/`Infinity`, class instances, cycles, depth, sizes, total work — and the governed key/value scan                                          |
| `event-registry.test.ts` | Registry composition, dispatch by `type@version`, unknown type, **unknown version with no v1 fallback**, discriminated-union narrowing, registry immutability                           |
| `authority.test.ts`      | The authority literals, at-most-once semantics, retry-key rejection, ambiguity handling                                                                                                 |
| `communication.test.ts`  | The eighteen states exactly and in order; opt-out as a rejection; Core-record requirements; opaque recipients                                                                           |
| `common.test.ts`         | Identifiers, UTC timestamps, calendar validity, entity references, actors, agents, bounded text                                                                                         |
| `validation-api.test.ts` | `parse` throws / `safeParse` returns; **errors never echo the value**; no logging; determinism; **no clock dependency**                                                                 |
| `requests.test.ts`       | An approval request has no authority; **a timeout is never an approval**; a communication request is not an authorization; `provider-accepted` is not `delivered`; the consent boundary |
| `assignment.test.ts`     | The vendor cap **at its boundary** — three passes and four fails, six passes and seven fails; batch numbers; overlap; client confirmation; linked-lead separation                       |
| `memory.test.ts`         | `authoritative: false` and `rebuildable: true` as literals; per-agent memory isolation; no chain-of-thought, credentials, or contacts; deletion awareness                               |
| `learning.test.ts`       | Model and prompt provenance; corrections are human-only; acceptance ≠ outcome; **no data becomes training data automatically**                                                          |

Table-driven throughout, so adding a fixture adds its tests automatically.

### Why the dedicated suites are not redundant with the fixture table

The invalid-fixture table already refuses every bad payload. The dedicated suites exist anyway, because they prove something different: a fixture proves _this particular payload_ is refused, while a boundary test proves the **rule holds at its edge** — three vendors passes and four fails; six unique passes and seven fails.

**A cap is only a cap if it is tested at the boundary.**

---

## Fixtures

Exported from the package, so later phases build against the same payloads the contracts are tested with rather than inventing their own and drifting.

- **Valid:** **92** fixtures — 51 contract fixtures (one minimal and one complete per contract where useful) and **41 event fixtures, one per registered event type**.
- **Invalid:** **141** fixtures covering meaningful boundary failures.

The originals live in `fixtures/valid.ts` and `fixtures/invalid.ts`; the revised contracts and target events live in `fixtures/target-valid.ts` and `fixtures/target-invalid.ts`, purely for size. The tables are composed, so **every fixture runs under the same table-driven tests** regardless of which file it sits in.

**Every fixture is typed against its own contract at compile time.** A fixture that drifts from its schema is a build error, not a test failure — which matters because a 41-member event union will happily match a fixture against the _wrong_ member's payload if you let it infer.

**No real data appears in any of them, and none ever may.** No client, vendor, employee, phone number, email address, address, token, or provider data. Every identifier is a fixed, obviously-synthetic UUID; every subject is an opaque reference to an entity that does not exist. Where a fixture must _look like_ a secret in order to be refused, it uses an obviously fake one — and the point of the fixture is that it is **rejected**.

Fixtures are `const` and never mutated. Tests that modify one call `cloneFixture` first, so a test that corrupts a fixture cannot poison the test that runs after it.

### Registry coverage is enforced

A test asserts that **every registered `type@version` has a valid fixture**, and that there are no fixtures for unregistered contracts. A contract cannot be registered and left unexercised.

---

## What these tests deliberately do not do

**No placeholder tests.** No `expect(true).toBe(true)`. No test that asserts a constant it invented. No test that exists to make a suite look non-empty. A suite that verifies nothing while claiming to verify something is worse than no suite, because it turns a green build into a signal that means nothing ([ADR-0011](../decisions/ADR-0011-quality-toolchain-and-continuous-integration.md)).

**No snapshots as the sole evidence for business-critical behavior.** A snapshot records what the code _did_, not what it _should_ do — and it is updated with a keystroke when it goes red. The authority rules are asserted explicitly, against the approved documents.

**No external dependencies.** No network, no database, no filesystem, no environment variable, no randomness, and **no clock**.

That last one is tested rather than assumed: a suite runs validation with the system time set to 2030 and again to 2000, and the same intent parses both times. **Contract validity must not depend on when you happen to ask** — an event that was valid when it was emitted must not become invalid because it was replayed tomorrow. Replay is a first-class feature ([ADR-0003](../decisions/ADR-0003-event-driven-integration.md)).

---

## Two real bugs these tests caught

Worth recording, because both would have shipped and both would have been hard to find later.

**1. `Date.parse` does not reject impossible calendar dates.** The obvious way to validate a timestamp is `!Number.isNaN(Date.parse(value))`. It is wrong. V8 does not reject `2026-02-30T00:00:00Z` — it **silently rolls it forward to 2 March**. A validator built that way would have accepted an impossible date and handed back a _different day_ than the one it was given, which on an `occurredAt` is a fact quietly changed in transit. The fix reads the calendar fields back and compares them with what was written.

**2. The governed-content scanner stack-overflowed on a cyclic object.** The bounded-JSON inspector had cycle detection; the governed scanner, which runs alongside it, did not. A cyclic input did not fail validation — it **crashed the validator with a `RangeError`**. A validator may reject anything, but it may never crash: the thing designed to refuse hostile input had become the thing hostile input could kill. The fix gives the scan its own ancestor set.

Both were found by fixtures written **before** the code that had to satisfy them. That is what test-first is for.
