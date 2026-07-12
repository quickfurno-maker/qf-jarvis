# Privacy and Data Minimization

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-11

What may never appear in a contract — and what actually stops it. See [privacy-principles.md](../governance/privacy-principles.md) and [security-principles.md](../governance/security-principles.md).

---

## The prohibited list

Never, in any contract, in any field, at any depth:

| Category                       | Examples                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Credentials**                | API keys, access tokens, refresh tokens, passwords, client secrets, signing keys, webhook secrets |
| **Contact details**            | Phone numbers, email addresses, complete postal addresses                                         |
| **Raw provider content**       | Full webhook payloads, unredacted provider responses                                              |
| **Recordings and transcripts** | Raw voice recordings, call transcripts                                                            |
| **Financial instruments**      | Payment card data, bank details                                                                   |
| **Model internals**            | Prompts, chain-of-thought, hidden reasoning, raw model responses                                  |
| **Arbitrary blobs**            | Unrestricted metadata dumps, whole copies of Core records                                         |

---

## What actually enforces it

A prohibition nothing checks is a comment. These are the mechanisms.

### 1. There is nowhere to put them

The strongest control is **absence of the field**. `RecommendationV1` has no recipient address. `ExecutionIntentV1` has no credential field. `CommunicationStateRecordV1` has no `phoneNumber`.

And because every public object is `strictObject`, you cannot add one: an unrecognized key is a **parse error**, not a passthrough.

### 2. Recipients are opaque references

`{ entityType, entityId }` — and the entity-id character set excludes `@` and `+`, so an email address and an E.164 phone number are **structurally unable** to appear.

**Honestly stated:** a purely numeric string _is_ accepted, because Core owns its identifier scheme and may legitimately use numeric ids. The regex is a guardrail, not the control. **The control is that this is a reference**: Core resolves the actual contact from its own records, against consent it owns, at execution time.

### 3. Governed JSON containers refuse forbidden keys — at any depth

`parameters`, `metadata`, and evidence `value` are bounded JSON **and** scanned. Key matching is normalized, so `api_key`, `apiKey`, and `API-KEY` are one key.

Refused everywhere: credential keys, contact keys, raw-content keys (`transcript`, `recording`, `rawPayload`), and model-internal keys (`prompt`, `chainOfThought`, `hiddenReasoning`).

Refused additionally in an **action**: authority claims (`approved`, `authorized`, `sent`, `executed`, `completed`).
Refused additionally in an **execution intent**: retry permission (`retry`, `autoRetry`, `maxAttempts`, `redial`, `resend`).

### 4. Values that look like contact details are refused

A string containing an email address, an E.164 number, or a run of ten or more digits is rejected inside a governed container.

**This scan fails closed, and that is deliberate.** It will occasionally refuse a legitimate value that merely _looks_ like a phone number — a long numeric reference, say. That is the intended trade:

- A contract that **wrongly refuses** a value produces a validation error a developer fixes in minutes.
- A contract that **wrongly accepts** a phone number produces a privacy incident nobody notices.

When those are the options, fail closed. Anything identifying a person belongs in an opaque Core reference.

_(The patterns are chosen not to fire on an RFC 3339 timestamp or a UUID — a timestamp has no `+` and no digit run longer than four. A test asserts that.)_

### 5. Evidence references facts; it does not duplicate records

Evidence is either a **canonical-event reference** — an event id a reviewer can check against Core's own records — or a **derived signal** with a stable code and a bounded description.

It is never a copy of the source record. Duplicating Core's data into evidence would create a second, stale copy of business truth in a system that is explicitly forbidden from holding any ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md)).

This also does real security work. _"Evidence must reference real event identifiers that a reviewer can check against QuickFurno Core's own records. A fabricated justification does not survive contact with the evidence panel"_ — which is a genuine prompt-injection defence, not a hypothetical one.

### 6. No chain-of-thought, no prompts containing personal data, no raw model output

**Refused by key, in every governed container, on every call:** `prompt`, `systemPrompt`, `chainOfThought`, `reasoningTrace`, `hiddenReasoning`, `thoughts`, `modelResponse`, `rawModelOutput`, `completion` — normalized, so `chain_of_thought` and `CHAIN-OF-THOUGHT` are the same key.

**And refused by value shape**, which is what closes the obvious workaround. Renaming the field does not help: a prompt or a model response smuggled in under an innocent key is still scanned, and if it contains an email address, an E.164 number, or a run of ten or more digits, it is rejected on the value. The two checks are additive, and the always-forbidden set **cannot be opted out of** by a caller passing the wrong argument — a credential check a caller can accidentally disable is not a check.

What _is_ stored is the **rationale** — the reasoning the agent states as its justification, written to be read and challenged — and the evidence it rests on.

Hidden deliberation frequently contains speculative content about real people that we have no business retaining; it invites a false sense of auditability, since an audit trail built on unreviewed internal text is not an audit trail; and it is a privacy liability that grows with every run ([agent-model.md](../architecture/agent-model.md)).

### 7. Errors name the field. They never echo the value.

A `ContractIssue` carries a **path**, a **code**, and a **message** — never the input.

This is the one that closes the loop, and it is easy to get wrong. **The most likely payload to fail validation is one that should never have existed** — carrying a credential in `parameters`, or a phone number where a reference belongs. A validator that helpfully quotes the rejected value has just written that secret into an exception message, which becomes a log line, which becomes a breach.

**The validator that refuses a secret must not then record it.** Tests assert exactly this: a rejected payload containing a fake credential produces an error that names `apiKey` and does not contain its value.

### 8. No validation function logs anything

Not on success, not on failure, not in a debug path. Enforced by a `no-console` lint rule scoped to the package, and asserted by a test that spies on every `console` method across a successful parse, a failed parse, and a credential rejection.

**A contract library that logs is a contract library that leaks.**

---

## Data minimization is enforced at the boundary, not at the log

An agent receives the **minimum data necessary for its domain**. Kabir does not need payment history; Jitin does not need a client's phone number.

These contracts are one place that becomes real: an agent cannot include a phone number in a recommendation, because there is no field for it and the governed scan would refuse it anyway. Minimization stops being a policy people remember and becomes a shape that will not parse.

---

## Nothing becomes training data by accident

Sensitive personal data is **never training-eligible, under any approval**. `TrainingEligibilityDecisionV1` refuses a `sensitive-personal` classification outright — there is no careful way to do this, so there is no field in which to be careful.

Eligibility is never a default and never a side effect of storage. It exists only as an **explicit decision** by a named human or a named, versioned policy, and the schema refuses it in two further cases:

- **Incomplete provenance.** If we cannot say where data came from, we cannot honour a deletion request against it. Training on data we cannot trace is training we cannot later undo.
- **Purpose drift.** `DatasetExampleProvenanceV1` carries a mandatory `purposeLimitation`. Data gathered to evaluate lead-quality scoring is not thereby available to train an outbound-messaging model. _"We already had the data"_ is the oldest bad argument in this field, and a mandatory purpose code is what makes it answerable rather than persuasive.

`sourceReferences` is non-empty, always. An example that cannot name its sources is not a low-quality example — it is an **ungovernable** one, because you cannot withdraw it when the person it came from leaves, since you cannot find it.

---

## Deletion propagation

A deletion in Core must propagate into Jarvis's derived views, recommendation evidence, and **agent memory** ([data-ownership.md](../architecture/data-ownership.md)).

As of Phase 2, that is no longer only a design intention. **It is represented.**

### The contracts and the events

| Artifact                       | Says                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `ErasureRequestV1`             | This was **asked for**, by whom, over which scopes           |
| `ErasureRecordV1`              | This was **done** — and, crucially, what was **not** reached |
| `qf.privacy.erasure-requested` | The obligation starts. Every derived store named must act    |
| `qf.privacy.erasure-recorded`  | Core recorded how far it actually got                        |

They are two contracts, not one record with a `done: true` flag, because erasure is a **distributed operation across systems that can each fail independently**. The interval between _asked_ and _completed everywhere_ is real, sometimes long, and legally material. A shape that cannot represent _in progress_ forces a caller to choose between claiming a completion it has not achieved and recording nothing at all. Both are worse than the truth.

The events matter for the same reason the contracts do: **a deletion that happens silently is a deletion nobody can prove happened** — and, worse, one that Jarvis never hears about. Derived read models, recommendation evidence, and agent memory can only react to something they can see. An erasure delivered as a private call into Core is precisely the failure mode where a deleted client's data lives on inside an agent's memory forever.

### The erasable scopes — and the one that is deliberately missing

| Scope                     | What it reaches                              |
| ------------------------- | -------------------------------------------- |
| `derived-read-models`     | Jarvis's non-authoritative views             |
| `identity-references`     | The opaque references that point at a person |
| `recommendation-evidence` | The evidence a recommendation rested on      |
| `agent-memory`            | What an agent remembered                     |
| `dataset-examples`        | Candidate training examples                  |

**`audit-trail` is not an erasable scope, and its absence is deliberate.**

Approval decisions and audit trails are **immutable**, and they are handled under **legal-retention** rules rather than deletion rules. Erasing the record that a decision was made would destroy the accountability the decision exists to provide.

> **The personal data goes. The fact that a governed action occurred stays.**

### `completed` with work outstanding does not parse

This is the single most dangerous record the contract could carry, so the schema refuses to represent it:

| The record says                                   | The schema                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `completed`, with a non-empty `scopesOutstanding` | **Refused.** If data remains anywhere, the outcome is `partial`             |
| `completed`, with an empty `scopesCompleted`      | **Refused.** An erasure that erased nothing, nowhere, is not one            |
| `partial` or `failed`, naming nothing outstanding | **Refused.** It is claiming, by omission, to have finished                  |
| `failed`, having reached some scopes              | **Refused.** That is `partial` — an operator needs to know something worked |
| A scope both completed **and** outstanding        | **Refused.** It cannot be both done and not done                            |

A `completed` record with outstanding scopes **closes a legal obligation while the data is still sitting in an agent's memory**. That is why `partial` exists: so an honest system can say _"we reached three of five stores and the fourth is failing"_ rather than being forced into a lie in the one situation where the truth is legally material.

`scopesCompleted` is the field a regulator reads. _"We deleted the client"_ is a claim. _"We deleted the client from read models, evidence, and Riya's memory, and here is the list"_ is an answer.

### An un-propagated deletion is detectable, not invisible

`AgentMemoryRecordV1` carries a **mandatory `erasureState`** — `none`, `deletion-requested`, `deleted`, `anonymisation-requested`, `anonymised`. When Core deletes or anonymises a person, every memory record about them must reflect it, and because the field is required, a record that has **not** been updated is **detectably stale rather than invisibly wrong**.

That is the whole trick. A system cannot fix a deletion it cannot see it missed.

**The propagation mechanism itself remains Phase 11's work.** Phase 2's contribution is narrower and load-bearing: to make the state **representable and checkable**, so that Phase 11 has something to be correct against — and so that a failure to propagate shows up as a fact in a record rather than as data quietly surviving a deletion.
