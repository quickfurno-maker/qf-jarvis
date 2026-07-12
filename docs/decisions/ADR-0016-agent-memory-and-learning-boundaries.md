# ADR-0016 — Agent Memory and Learning Boundaries

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

Every artifact this system has defined so far is a **statement about a moment**: a recommendation made, a decision recorded, a result observed. None of them persists as a _belief_.

Agent memory is different, and the difference is the whole problem. Memory **persists and is reused**. An agent with memory does not re-derive the world each time; it carries conclusions forward. And a persistent, agent-owned, reused store of business facts is — whatever the design document calls it — **a second copy of QuickFurno Core's data**, one that drifts, that nobody reconciles, and that an agent will eventually reason from in preference to the truth.

[ADR-0001](./ADR-0001-source-of-truth-boundary.md) forbids exactly that. So either memory is bounded structurally, or ADR-0001 quietly stops being true the day the first agent remembers something.

There is a second, slower failure that arrives with learning. Once an agent's runs, corrections, and outcomes are recorded, somebody will write a pipeline that trains on "the good examples." The definition of good will widen by one field. Eighteen months later a model will have been trained on client conversations that nobody agreed to hand over — and **nobody will have decided that.** It will have happened because no decision was ever _required_.

Both failures are drift, not malice. Neither is prevented by good intentions, and both are prevented by shape.

## Decision

**Agent memory is isolated, minimal, derived, rebuildable, non-authoritative, and deletion-aware — enforced by literals in the schema. Learning requires full provenance, and no data becomes training data automatically.**

### 1. The two literals

```ts
rebuildable: z.literal(true),
authoritative: z.literal(false),
```

`authoritative: true` **does not parse.** `rebuildable: false` **does not parse.**

These are the same guarantee stated from both ends. Memory is derived, and derived things can be thrown away. A memory record that could not be rebuilt would have to be _preserved_ — and a store that must be preserved has become a database of record, whatever it is named.

**QuickFurno truth overrides memory, always.** When they disagree, memory is rebuilt, not reconciled toward.

### 2. Memory is derived, and must prove it

`sourceEventIds` is **non-empty, always**. A memory record that cannot name the canonical events it came from was not derived from them — it was **invented**, and an invented memory is a fact the system made up about a real client.

### 3. Memory is isolated, per agent

`MEMORY_SUBJECT_OWNERSHIP` is a closed map, and a subject outside its owner's domain does not parse:

| Agent      | May remember                                             | Note                       |
| ---------- | -------------------------------------------------------- | -------------------------- |
| **Riya**   | client, lead, requirement                                | The client journey         |
| **Anisha** | vendor                                                   | And nothing else           |
| **Kabir**  | lead                                                     | And nothing else           |
| **Jitin**  | city, category, campaign                                 | **No individuals at all**  |
| **Jarvis** | recommendation, agent-run, evaluation, founder-attention | **No domain facts at all** |

Two of these deserve their reasoning stated, because they will look excessive:

**Jitin cannot remember a client or a vendor.** Marketing intelligence works in aggregate — cost per verified lead by city and category. It does not _require_ remembering individual people, so it is not permitted to. A capability that is not needed and is dangerous is simply not granted.

**Jarvis cannot remember any domain fact.** Jarvis owns the connecting, never the concluding ([agent-model.md](../architecture/agent-model.md)). An agent that accumulates client and vendor context is an agent that has started to conclude, and the bounded-specialist model is over the moment it does.

### 4. Memory is deletion-aware by construction

`erasureState` is **mandatory**. Not optional-with-a-default — mandatory.

The point is not that the field is set correctly. The point is that a memory record about an erased client which still reads `none` is a **detectable defect** rather than an invisible one. Deletion propagation ([data-ownership.md](../architecture/data-ownership.md)) can then be _verified_ rather than assumed.

The propagation mechanism is Phase 11's work. Phase 2's contribution is to make the state representable, so the mechanism has somewhere to write.

### 5. Learning: provenance is mandatory

- `ModelReferenceV1` — provider, model, version, invocation-configuration version. **No credential. No raw model response.**
- `PromptConfigurationReferenceV1` — **references and versions only.** Every field is a machine token, an integer, or a hex digest. There is no string field long enough to hold a prompt.
- `AgentRunRecordV1` — a run that invoked a model **must** record its prompt configuration. Model provenance without prompt provenance is not provenance: the run cannot be reproduced, regression-tested, or explained when it goes wrong.

`deterministicRulesEvaluated` is mandatory. A run that consulted a model while evaluating zero rules is an agent using a model where a rule would do — the most common and most expensive failure mode in this class of system — and this field makes it **visible** rather than something you have to go and read the code to discover.

### 6. What is never stored, anywhere

Private chain-of-thought. Hidden reasoning. Complete prompts containing personal data. Raw model output. Provider API keys.

These are refused **by key and by value shape** in every governed container in the package, and the refusal cannot be opted out of.

### 7. Agents do not rewrite themselves

**Agents may not rewrite their prompts, their policies, or their production configuration.**

A prompt version is a thing a human changed and a reviewer saw. An agent that could edit its own prompt would have behavior no human approved; an agent that could raise its own approval threshold would be an agent that could authorize itself, one indirection removed. These contracts _record_ a version; they grant no ability to set one.

### 8. No data becomes training data automatically

There is no eligible-by-default state, no eligibility inferred from a classification, and no eligibility a pipeline can conclude for itself. It exists **only** as a `TrainingEligibilityDecisionV1` in which a named human — or a named, versioned policy a human approved — said yes.

`eligible: true` is refused unless the data is minimised, the provenance is complete, and a purpose limitation is stated. `eligible: false` **requires** a reason code, so a refusal is countable rather than inferred from an absence.

**Sensitive personal data is never eligible.** Not "with care", not "with founder approval". There is no legitimate path, and a field that permitted one would eventually be used.

### 9. Future custom-model progression

Claude and ChatGPT are the initial reasoning providers, behind a **future model-agnostic gateway**. **No gateway and no model integration exists in Phase 2.**

A progression to a custom or fine-tuned model is permitted **only** on data that passed §8 — every example carrying complete provenance and an explicit eligibility decision. There is no path from "we have a lot of production data" to "we trained on it", and that absence is the point of this ADR.

## Consequences

**Positive.**

- **A second source of truth is unrepresentable**, not merely discouraged.
- **Clearing an agent's memory is always safe**, so we will actually do it — and being _willing_ to clear a derived store is what keeps it derived. An organisation that is afraid to rebuild a cache has one that is no longer a cache.
- **Cross-domain contamination is a parse error.** Anisha reasoning about client satisfaction cannot begin, because she cannot remember a client.
- **A deletion request can be answered honestly**, because every derived record knows what it is holding and whether it has been erased.
- **Training on client data requires somebody to sign their name to it.**

**Negative, and accepted.**

- **Memory is less useful than it could be.** An agent that could remember anything would be more capable. It would also be a shadow database with an LLM in front of it, and the trade is not close.
- **Rebuilding memory has a cost.** Replay is not free. It is cheaper than a store nobody can trust.
- **Provenance records are verbose**, and most runs will invoke no model at all — which is the desired outcome, and means most of the provenance machinery sits unused. That is fine. It is there for the runs that matter.
- **The memory-ownership map is a closed set that will need edits.** Each edit is a diff a human reviews. That is a feature: widening an agent's memory domain is exactly the change that should never happen quietly.

## Alternatives rejected

**No agent memory at all — re-derive everything, every run.** Genuinely tempting, and the safest possible answer. Rejected because relationship intelligence is a stated product goal and it is not reconstructible from a single run's context window. The compromise is memory that is _provably_ disposable.

**A shared memory store all agents can read.** Rejected. It is the bounded-specialist model's negation: within a week, every agent reasons about everything, and the responsibility matrix becomes a description of what the system used to do.

**`authoritative` as a mutable boolean, defaulting to `false`.** Rejected. A default is a thing somebody overrides. A literal is a thing that does not parse.

**Storing chain-of-thought "for debugging".** Rejected. It is unfalsifiable text that reads as authoritative, it is drawn from real client data, and it would sit in a table nobody thinks of as sensitive. Evidence — which points at facts a human can check — is what a recommendation stands on.

**Opt-out training eligibility** (everything is eligible unless flagged). Rejected. Defaults decide outcomes at scale, and this default decides whether client conversations become model training data. It must be a decision somebody makes, not one they fail to prevent.

**Letting agents propose prompt improvements to themselves.** Rejected. The feedback loop has no ground truth in it: the model learns to satisfy the model. A human changes the prompt, or the prompt does not change.
