# Agent Memory and Learning

**Status:** Phase 2 — Contracts and Canonical Events (complete and approved, 2026-07-12)
**Date:** 2026-07-12

The contracts for what an agent remembers, how it was run, and what may ever be learned from any of it. See [ADR-0016](../decisions/ADR-0016-agent-memory-and-learning-boundaries.md).

---

## Why memory is the most dangerous thing here

Every other artifact in this system is a **statement about a moment**: a recommendation made, a decision recorded, a result observed. None of them persists as a _belief_.

Memory **persists and is reused**. And a persistent, agent-owned, reused store of business facts is — whatever the design document calls it — **a second copy of QuickFurno Core's data**: one that drifts, that nobody reconciles, and that an agent will eventually reason from in preference to the truth.

[ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md) forbids that. So either memory is bounded **structurally**, or ADR-0001 quietly stops being true the day the first agent remembers something.

---

## The two literals

```ts
rebuildable: z.literal(true),
authoritative: z.literal(false),
```

`authoritative: true` **does not parse.** `rebuildable: false` **does not parse.**

These are one guarantee stated from both ends: memory is derived, and derived things can be thrown away. A memory record that could not be rebuilt would have to be _preserved_ — and a store that must be preserved has become a database of record, whatever it is named.

**QuickFurno truth overrides memory, always.** When they disagree, memory is **rebuilt**, not reconciled toward.

A note on why these are literals rather than booleans with a default: **a default is a thing somebody overrides.** A literal is a thing that does not parse.

---

## Memory must prove it is derived

`sourceEventIds` is **non-empty, always**.

A memory record that cannot name the canonical events it came from was not derived from them. It was **invented** — and an invented memory is a fact the system made up about a real client, which it will then carry forward into every future run.

---

## Memory is isolated, per agent

`MEMORY_SUBJECT_OWNERSHIP` is a closed map. A subject outside its owner's domain **does not parse**.

| Agent      | May hold memory about                                            | Note                       |
| ---------- | ---------------------------------------------------------------- | -------------------------- |
| **Riya**   | `client`, `lead`, `requirement`                                  | The client journey         |
| **Anisha** | `vendor`                                                         | And nothing else           |
| **Kabir**  | `lead`                                                           | And nothing else           |
| **Jitin**  | `city`, `category`, `campaign`                                   | **No individuals at all**  |
| **Jarvis** | `recommendation`, `agent-run`, `evaluation`, `founder-attention` | **No domain facts at all** |

Two of these look excessive and are not:

**Jitin cannot remember a client or a vendor.** Marketing intelligence works in aggregate — cost per verified lead by city and category. It does not _require_ remembering individual people. A capability that is not needed and is dangerous is simply not granted.

**Jarvis cannot remember any domain fact.** Jarvis owns the connecting, never the concluding ([agent-model.md](../architecture/agent-model.md)). An agent that accumulates client and vendor context has started to conclude, and the bounded-specialist model is over the moment it does.

### The failure this prevents

The moment an agent can accumulate context outside its domain, Anisha starts reasoning about client satisfaction, Kabir starts reasoning about vendor quality, and the responsibility matrix becomes a description of what the system **used to** do.

---

## Memory is deletion-aware by construction

`erasureState` is **mandatory**. Not optional-with-a-default.

The point is not that the field is always set correctly. The point is that a memory record about an erased client which still reads `none` is a **detectable defect** rather than an invisible one. Deletion propagation ([data-ownership.md](../architecture/data-ownership.md)) becomes something you can _verify_ rather than assume.

`MemoryInvalidationRequestV1` is how memory is thrown away. Its `subject` scope is the shape a deletion request takes — _forget everything you know about this client_ — and its optional `erasureRequestId` distinguishes **housekeeping** from a **legal obligation**.

Invalidating memory is always **safe**, because memory is rebuildable. That property is what makes the "forget it" button possible at all: you can only offer one on a store that is not the source of truth. An organisation that is afraid to clear a derived store has one that is no longer derived.

---

## Provenance: which model, which prompt, which policy

| Contract                         | Carries                                                                                                           | Never carries                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ModelReferenceV1`               | provider, model id, model version, invocation-config version                                                      | **credentials, raw model output**                   |
| `PromptConfigurationReferenceV1` | prompt id + version, config id + version, optional digest                                                         | **the prompt text**, chain-of-thought, model output |
| `AgentRunRecordV1`               | agent, version, timings, input event ids, produced recommendations, rules evaluated, model, prompt config, policy | chain-of-thought, raw output, personal data         |

### A model invocation must record its prompt

Enforced: `model` present ⇒ `promptConfiguration` required.

**Model provenance without prompt provenance is not provenance.** The run cannot be reproduced, cannot be regression-tested, and cannot be explained when it goes wrong. "The agent got worse last Tuesday" is unactionable unless something recorded what changed on Tuesday.

### `deterministicRulesEvaluated` is mandatory, and it is a smell detector

A run that consulted a model while evaluating **zero** rules is an agent using a model where a rule would do — the most common and most expensive failure mode in this class of system. This field makes it **visible in the data** rather than something you have to go and read the code to discover.

A run with **no model at all** is entirely valid, and is the **best** kind of run: cheaper, faster, fully explainable. Requiring a model reference on every run would force every run to invent one, and would quietly imply that using a model is the normal path. **It is not.**

### `PromptConfigurationReferenceV1` cannot hold a prompt

Every field on it is a machine token, an integer, or a hex digest. **There is no string field long enough to hold a prompt**, and none whose name or type would invite one.

An assembled prompt contains the context the agent was given — drawn from real clients and real vendors. Storing it would turn a provenance record into **the single largest concentration of personal data in the system**, sitting in a table nobody thinks of as sensitive.

### Agents do not rewrite themselves

**Agents may not rewrite their prompts, their policies, or their production configuration.** A prompt version is a thing a human changed and a reviewer saw. An agent that could raise its own approval threshold would be an agent that could authorize itself, one indirection removed.

These contracts **record** a version. They grant no ability to set one.

---

## Evaluation: acceptance is a proxy, outcome is the measure

Two contracts, deliberately separate.

|                              | Asks                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `RecommendationEvaluationV1` | _Did a human like it?_ Acceptance, calibration                         |
| `OutcomeFeedbackV1`          | **Did the business metric actually move, in the direction predicted?** |

An agent can score perfectly on the first while being worthless on the second — and an agent **optimized against** the first will _reliably_ become worthless on the second, because agreeable and correct are different targets and only one of them was being measured.

Keeping them apart is what makes "no automation promotion on acceptance data alone" enforceable. If they shared a shape, _"we have evaluation data"_ would be true of a system that had never once checked whether anything got better.

### `unknown` is a permitted, and frequently correct, answer

Business outcomes are confounded. A client converted, but a campaign also changed, and the season turned.

A system that forces every outcome into positive or negative **manufactures a correlation** — and a manufactured correlation is worse than an admitted ignorance, because somebody will promote an agent to automation on the strength of it.

---

## No data becomes training data automatically

There is **no eligible-by-default state**, no eligibility inferred from a classification, and no eligibility a pipeline can conclude for itself.

Eligibility exists **only** as a `TrainingEligibilityDecisionV1` in which a named human — or a named, versioned policy that a human approved — said yes.

`eligible: true` is **refused** unless:

- `minimisationStatus` is not `not-minimised` — minimisation is a **precondition**, not a follow-up task;
- `provenanceComplete` is `true` — if we cannot say where it came from, we **cannot honour a deletion request against it**;
- a `purposeLimitation` is stated.

`eligible: false` **requires** a `rejectionReasonCode`, so a refusal is a fact somebody can count and query rather than an absence they have to infer.

**Sensitive personal data is never eligible.** Not "with care". Not "with founder approval". There is no legitimate path, and a field that permitted one would eventually be used.

### The failure this prevents

Nobody decides to train on client conversations. It happens like this: a pipeline is written that trains on "the good examples"; the definition of good widens by one field; eighteen months later a model has been trained on data nobody agreed to hand over.

**That is not malice. It is the absence of a required decision.** This contract is the required decision.

### `DatasetExampleProvenanceV1` has no `model-output` source kind

Its absence is deliberate. Training a model on its own prior output is how a system drifts away from reality while its internal metrics keep improving.

---

## Reasoning providers

**Claude and ChatGPT** are the initial reasoning providers, behind a **future model-agnostic gateway**.

**No gateway and no model integration exists in Phase 2.** What exists here is the _shape of the provenance record_ such a gateway will one day have to produce — written now, before anything depends on it, which is the entire premise of this phase.

`MODEL_PROVIDERS` is a **closed enum**, for the same reason the event registry is closed: adding a party we send reasoning to must be a **diff a human reviews**, not a string a caller invents.
