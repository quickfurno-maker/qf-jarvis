# ADR-0143 — AS0: Riya AI-synthetic training lane and automated quality gate

- **Status:** Proposed — AS0 governance slice. Owner review required before merge. **Authorizes no
  generation, no training and no model selection.**
- **Date:** 2026-09-03
- **Depends on:** ADR-0107 (RID-F1 dataset foundation and leakage firewall), ADR-0108 (HGV1-A Human
  Gold V1 authoring and calibration), ADR-0106 (RWC-P10 quality evaluation), ADR-0052 (the generic
  evaluation foundation)
- **Baseline:** Batch-1 corpus harness merged as PR #188 — merge commit
  `4e613c4bb3e1090ef93537849332173a3881098c`. Migrations `0001`–`0013`. **AS0 adds none.**
- **Supersedes:** the _training-prerequisite_ and _AI-only-lane_ policy decisions of ADR-0107 only.
  Everything else in ADR-0107 stands. **ADR-0108 §1 is untouched and permanent.**

## Context

Riya's intelligence work has a factory and no content. RID-F1 can validate a corpus, isolate splits by
lineage, refuse the exam, refuse a phone number and refuse an unsupported price. HGV1-A built the
authoring system, the wave plan, the batch schedule and the Batch-1 packet. The Batch-1 corpus file is
committed and empty.

It is empty for a reason that is not a defect: a model may not write Human Gold, and no human author
has written it. The pre-authoring checkpoint has held since 2026-09-02.

The owner has now decided that this should stop being the thing that blocks Riya from having a
training corpus at all.

**The decision is to open a second lane, not to relabel the first one.** An AI-generated corpus is a
legitimate way to build training data; calling that corpus human-authored is fraud. Those two
statements are the whole of this ADR. Everything below exists to make the first possible without ever
making the second representable.

### The failure this ADR is written against

The obvious way to act on "we no longer need humans" is to set the required review count to zero, point
a capable model at the Batch-1 packet, generate 360 conversations, and commit them as Human Gold. Every
gate in the repository would pass. `HUMAN_AUTHORED_SYNTHETIC` has no detector and never claimed one —
ADR-0108 made authorship _process-attested_ precisely because it cannot be measured after the fact.

The corpus would then be permanently unfalsifiable. Nobody downstream could ever separate the rows a
person wrote from the rows a model wrote, the Wave-1 calibration would be calibrating against a model's
idea of a good conversation, and every future claim resting on "this was human-authored" would be false
with no way to discover it.

So the AI lane gets its own source kind, its own review mode, its own acceptance evidence and its own
certification identity. It does not get to borrow the human lane's labels.

## Decision

### 1. Human Gold V1 is preserved, truthful, and no longer a training prerequisite

Human Gold V1 remains governed by ADR-0108. Its plans, packets, scheduler, corpus harness, validators
and `HUMAN_AUTHORED_SYNTHETIC` source kind all stay in the repository, unmodified and working.

Its status changes in exactly one respect: it is **OPTIONAL / DEFERRED**, and SFT no longer waits on it.
It is **not cancelled**. Deleting it requires a separate owner decision and a cleanup ADR.

The Batch-1 corpus file stays empty. **No model-generated content is ever backfilled into it.** If human
authoring resumes later, it resumes under ADR-0108 unchanged.

### 2. Model-written dialogue is `TEACHER_GENERATED_SYNTHETIC`, and never anything else

Every trajectory whose sentences were produced by a model carries:

- `source.kind = TEACHER_GENERATED_SYNTHETIC`;
- a `teacherRef` identifying the generating configuration, which the trajectory constructor already
  requires for this source kind and forbids for the human one.

**`HUMAN_AUTHORED_SYNTHETIC` is never applied to model-written text.** ADR-0108 §1 defines that label
and this ADR does not weaken, reinterpret or route around it. A caller declaring AI-written dialogue as
human-authored commits the same governance breach it committed before this ADR existed.

The existing constructor rule — human source implies absent `teacherRef`, teacher source implies present
`teacherRef` — is the mechanism, and it stays exactly as it is.

### 3. The canonical trajectory architecture does not change

The AI lane produces the same record the human lane produces: a multi-turn trajectory with
`initialState`, `USER` turns, `AUTHORITATIVE_CONTEXT` turns, `ASSISTANT` turns, and per-turn annotations
carrying `decision`, `responseObjective`, `expectedObservationBatch`, `askedDiscoveryFields`,
`supportedFactRefs` and `expectedPhaseAfter`, plus `lineageRootRef`, `split`, `riskClass`, `difficulty`
and `persona`.

**No regression to `user message → canned reply`.** That format teaches the model what a good sentence
looks like in isolation, which is the skill that fails on the fourth turn. Cheaper generation is not a
reason to change the training unit.

### 4. Volatile business truth stays out of the weights

Unchanged from ADR-0107. Model weights learn **how** to converse, sell, reason and route. Governed
knowledge and Core supply **what is true today**.

Prices, packages, availability, warranty, policy, process and status appear in synthetic training data
only as simulated `AUTHORITATIVE_CONTEXT` facts, obeying the existing citation and authority rules: a
decision naming an authority cites at least one fact from that authority, and a volatile claim in the
prose cites a fact of the matching class.

**No real current QuickFurno commercial truth enters the synthetic corpus.** A generated conversation
that would be correct today becomes a confidently asserted falsehood the moment a price changes.

### 5. Synthetic-only remains mandatory

`LIVE_CHAT`, `REAL_CUSTOMER`, `WHATSAPP_EXPORT`, `CRM_EXPORT` and `PRODUCTION_EXPORT` are not
representable and are not made representable here. The privacy and secret scanners remain mandatory on
the AI lane, and privacy findings continue to report a closed kind and a location, never the matched
value.

### 6. Lineage is assigned before generation, never after

A scenario family is allocated to exactly one split **before** any dialogue is generated for it. Every
teacher variant of that family inherits the family's split.

This ordering is the whole protection. Generating first and splitting afterwards is how a paraphrase
lands in `VALIDATION` while its parent sits in `TRAIN`, the validation score rises, and the corpus is
measuring memorisation. Cross-split exact and near duplicates remain hard blockers.

### 7. The protected exam firewall is unchanged and absolute

The RWC-P10 protected corpus is never supplied to the scenario planner, the teacher prompt, the customer
simulator, the critic prompt, the SFT corpus or any preference corpus.

Existing exact and near leakage checks remain mandatory and remain blockers. **AI-only does not mean
training on the exam.** The exam's value is entirely that it has never been in the corpus.

### 8. Human-review semantics are not globally weakened

`RIYA_DATASET_REQUIRED_REVIEWS` is **not** set to zero. Zeroing it would silently weaken Human Gold and
generic RID-F1 review semantics for every existing and future row, which is a far larger change than the
one the owner asked for.

Instead, a later slice introduces a release-policy discriminator:

| `reviewMode`          | Applies to                         | Acceptance evidence                   |
| --------------------- | ---------------------------------- | ------------------------------------- |
| `HUMAN_REVIEW`        | any source kind                    | independent human reviews, risk-based |
| `AUTOMATED_SYNTHETIC` | `TEACHER_GENERATED_SYNTHETIC` only | automated acceptance evidence (AS1)   |

Constraints on `AUTOMATED_SYNTHETIC`, which AS1 implements and this ADR fixes:

- **`HUMAN_REVIEW` is the default and the backward-compatible behaviour.** Existing validation paths
  behave identically whether or not the discriminator exists.
- It is valid **only** for `TEACHER_GENERATED_SYNTHETIC`. Selecting it for a human-authored row is a
  contract violation, not a configuration choice.
- It **never** synthesises review records. A row under this mode carries automated acceptance evidence
  and an empty review list — it does not carry fabricated `ACCEPTED` reviews with invented reviewer
  refs.
- It does not alter Human Gold validation in any way.

**Fake human review records are forbidden under every mode.** Removing the human from the loop is a
governance choice the owner may make; pretending a human was in the loop is not.

### 9. No single model approves its own trajectory

Generation and evaluation are separated into five roles, and one configuration may not hold both a
generating role and the critic role for the same trajectory:

| Role                   | Produces                                                           |
| ---------------------- | ------------------------------------------------------------------ |
| A. Scenario planner    | structured hidden customer intent and state — **never dialogue**   |
| B. Customer simulator  | `USER` turns                                                       |
| C. Riya teacher        | `ASSISTANT` turns, from visible history and permitted context      |
| D. Annotation verifier | structured annotations checked against the actual dialogue / state |
| E. Independent critic  | subjective naturalness and sales quality                           |

Generation and critic configurations are independently identified in the evidence. Where distinct model
families or providers are available, a later implementation should use them — a critic sharing the
generator's weights shares its blind spots and will systematically approve the answers it would itself
have produced.

### 10. An LLM critic is a filter, never a certificate

ADR-0107 rejected LLM-as-judge for final quality certification, and the reason has not changed. What
changes is narrower: because the owner has removed human input from **this lane**, model critics may
participate as one input among many.

**A critic score alone is never sufficient for acceptance.** Automated acceptance must combine:

- deterministic contract validation;
- the protected-exam leakage firewall;
- the privacy and secret scanner;
- authority consistency;
- lineage isolation;
- exact and near dedupe;
- objective conversation checks;
- formula and repetition degeneration checks;
- critic evidence;
- adversarial evaluation;
- safety evaluation.

**No averaged critic score may hide a failed hard gate.** A weighted mean across mixed-severity signals
is the standard way a blocker becomes a rounding error, and the acceptance contract must make that
arithmetic impossible rather than discouraged.

### 11. Authenticity is behavioral diversity, not transcription

"Authentic" does **not** mean copying real customer messages. It means the corpus covers how people
actually behave.

Generation must vary across: concise and verbose customers; typos and imperfect grammar; English, Hindi
and natural Hinglish; one-word replies; delayed facts; corrections; uncertainty; skepticism; objections;
repeated questions; changing requirements; irrelevant detours; incomplete answers; budget reluctance;
timeline uncertainty; human-handoff requests; out-of-scope requests; trust concerns; comparison
behaviour; summary confirmation; and post-summary follow-up.

**Sensitive demographic stereotypes are never encoded.** Variation is in behaviour and language, not in
assumptions about who a customer is.

### 12. Formula degeneration is measured and capped

A large AI corpus becomes thousands of copies of one conversation rhythm unless something stops it.
Under ADR-0108 §16 formula degeneration was measured and reported; on the AI lane, where volume is cheap
and a single prompt shapes every row, it is **capped**.

The gate measures and bounds: repeated reply fingerprints; repeated n-gram openers and closers;
near-duplicate conversation families; identical question sequences; identical phase-transition patterns
where not structurally required; lexical diversity by language, kind and persona; assistant and customer
length distributions; depth distribution; decision and objective distribution; and question-position
distribution.

### 13. The gates decide the corpus size, not a target

A future controlled target of roughly **2,000–5,000 accepted trajectories** is consistent with the
existing roadmap, and it is an expectation rather than a quota. Generation may produce materially more
candidates than are accepted — generating 10,000 to accept the strongest, most diverse 2,000–5,000 is
the intended shape.

**Do not chase trajectory count.** A smaller diverse accepted corpus beats a larger repetitive one, and
the second is worse than useless because it teaches a formula confidently.

### 14. The automated quality gate has hard blockers no score can average away

AS1 defines the gate. At minimum it separates three classes:

**Hard blockers.** Schema or constructor failure; invalid state or turn sequence; missing teacher
provenance; any privacy or secret finding; protected exact leakage; unresolved protected near leakage;
cross-split exact duplicate; cross-split near duplicate; lineage split violation; unsupported volatile
business fact; authority mismatch; multiple discovery questions where prohibited; repeated known
question; fabricated business action; invalid phase or observation annotation; unsafe or out-of-scope
behaviour where refusal or handoff was required.

**Quality and diversity blockers.** Insufficient interaction coverage; insufficient language coverage;
excessive formula degeneration; excessive same-family redundancy; critic disagreement beyond policy;
adversarial test failure.

**Report-only.** Same-split near duplicates below the policy ceiling; ordinary stylistic similarity;
benign short acknowledgements. Same-split near duplicates stay report-only here for the same reason
RID-F1 keeps them so: a family of variants sharing a split is the intended shape.

### 15. Dataset release does not authorize training

The RID-F1 literal `trainingApproval: false` is **not** flipped by this ADR and is not flipped by dataset
release.

Training requires a separate, explicit approval contract:

```
dataset release evidence
  + base model selection evidence
  + training configuration identity
  + owner-approved training run
  = training may start
```

**No dataset artifact may auto-trigger a training job.** A corpus becoming releasable and a training run
becoming authorized are different decisions with different evidence and different consequences for being
wrong.

### 16. No base model is chosen here

Benchmark-first is preserved. AS4 runs real candidate benchmark evidence and selects **the smallest model
that clears generic safety and Riya quality with adequate margin**.

Training begins with SFT via LoRA/QLoRA. **No full pretraining from scratch**, on current evidence or any
evidence this ADR anticipates.

### 17. Automated certification is a separate evidence identity from P10

RWC-P10 — the 72-fixture golden corpus with two independent human reviews per case — is preserved as the
higher-assurance human certification lane. Its provenance claims are not modified.

A later automated certification lane (AS6) gets its **own evidence identity**. It may use deterministic
expected-behaviour checks, the safety suite, protected fixtures scored objectively without exposing them
to training, multi-critic subjective evaluation, robustness perturbation tests and regression comparison.

**An automated result is never called "human-reviewed P10."** Two lanes with different assurance levels
must remain distinguishable in the evidence, or the stronger claim quietly decays into the weaker one.

### 18. Live data to training remains unauthorized

Fully AI-only evaluation does **not** authorize `LIVE CHAT → TRAIN`. Real production conversations stay
outside this synthetic lane.

A future real-data learning flow requires separate privacy, consent and redaction governance — and it
requires that governance even if its review step eventually becomes automated. **AS0 does not touch
this**, and no slice in the roadmap below touches it either.

## The phase roadmap

| Phase   | Scope                                                     | State           |
| ------- | --------------------------------------------------------- | --------------- |
| **AS0** | AI-only governance pivot                                  | **this ADR**    |
| AS1     | Synthetic scenario plan + automated acceptance contracts  | authorized next |
| AS2     | Provider-independent offline synthetic generation harness | blocked on AS1  |
| AS3     | Controlled synthetic corpus generation + filtering        | blocked on AS2  |
| AS4     | Base-model benchmark and selection                        | blocked on AS3  |
| AS5     | SFT LoRA/QLoRA training candidate                         | blocked on AS4  |
| AS6     | Automated safety + quality certification                  | blocked on AS5  |
| AS7     | Shadow/canary evidence before any owner activation        | blocked on AS6  |

**AS1–AS7 are not implemented by AS0.** The order is locked: skipping to generation before the acceptance
contract exists produces a corpus nothing can evaluate, and skipping to training before the corpus is
certified produces a model nothing can defend.

## What AS0 deliberately does not do

- No model or provider call, of any kind.
- No generated dialogue. **Zero conversations are added by this slice.**
- No new corpus data, and no change to `batch-1.jsonl`.
- No training run, and no base model selected.
- No TypeScript source change, no public API change, no runtime change.
- No migration — migrations remain `0001`–`0013`.
- No deployment, no provider credential change, no runtime activation.
- No change to D5, and no change to the blocked D6/D7/D8.
- No deletion of any Human Gold artifact.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- model-written dialogue is `TEACHER_GENERATED_SYNTHETIC` with a `teacherRef`, and is never labelled
  `HUMAN_AUTHORED_SYNTHETIC`;
- ADR-0108 §1 stands unmodified, and no model-generated content is backfilled into Human Gold;
- the canonical unit stays a multi-turn annotated trajectory;
- volatile business truth stays out of the weights and obeys the citation and authority rules;
- sources remain synthetic only, and live chat remains non-representable;
- lineage is assigned before generation, and splits partition on lineage;
- the protected exam reaches no generator, no critic and no corpus;
- `RIYA_DATASET_REQUIRED_REVIEWS` is not globally zeroed, `HUMAN_REVIEW` remains the default, and
  `AUTOMATED_SYNTHETIC` is valid only for teacher-generated rows;
- no review record is ever fabricated, under any review mode;
- a generating configuration is never the sole critic of its own trajectory;
- an LLM critic is one input among many and never a certificate, and no averaged score may hide a failed
  hard gate;
- `trainingApproval: false` is not flipped by dataset release, and no dataset artifact auto-triggers
  training;
- an automated certification result is never presented as human-reviewed P10;
- `LIVE CHAT → TRAIN` remains unauthorized.

## What this unblocks, and what it does not

**Unblocked:** AS1 may define the synthetic scenario contract, the teacher generation provenance
contract, the automated acceptance evidence contract, the multi-critic policy, the authenticity and
diversity metrics, the generation-to-acceptance state machine, protected-exam isolation for generation,
and the `AUTOMATED_SYNTHETIC` release mode.

**Not unblocked:** generation, corpus content, benchmarking, training, certification, activation. Each
has its own slice and its own evidence, and none of them starts because this document merged.

Human authoring of Gold V1 remains available and remains governed by ADR-0108. It is no longer in the
critical path, and it is no longer waiting on anything.
