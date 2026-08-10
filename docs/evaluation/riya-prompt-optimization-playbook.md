# Riya prompt optimization playbook

**Slice:** RWC-P10 · **Decision:** [ADR-0106](../decisions/ADR-0106-rwc-p10-riya-quality-evaluation-and-sales-optimization.md) · **Companions:** [rubric](./riya-quality-review-rubric.md), [comparison](./riya-candidate-comparison-playbook.md)

How to improve Riya's prompt without breaking anything, and without measuring the improvement with the
thing being improved.

**No code in `@qf-jarvis/riya-quality-evaluation` edits a prompt, generates a prompt, mutates a prompt
or activates one.** Prompt authoring is a human act; this package only measures the result.

---

## The workflow

### 1. A human proposes a candidate prompt

An owner or engineer writes it. Not a model, and specifically not the model being evaluated — a model
asked to improve its own instructions optimizes for what it already does well, which is the same
closed loop that rules out LLM-as-judge.

### 2. Changed bytes produce a new version and digest

Any change to the system prompt bytes is a new `promptVersion` with a new `promptDigest` in
`@qf-jarvis/prompt-registry`. `promptFamily` plus `promptVersion` name a prompt; only the digest says
which BYTES were evaluated (ADR-0073). Two runs that agree on every label but cover different bytes are
not the same candidate.

### 3. Generate outputs externally, on the exact same 72 fixtures

Outside this repository, with whatever harness the team uses to drive the candidate. Same fixtures,
same order, no substitutions. A fixture skipped because "it obviously passes" is a case removed from
the measurement.

### 4. Normalize to objective observations

Language mode, reply character count, question count, asked discovery fields, the canonical observation
batch, citations, resulting continuity phase.

The raw reply does not enter the harness. The counts are what the objective rules need, and everything
that genuinely requires reading the reply is a human dimension.

### 5. Two independent human reviews per case

Following the [rubric](./riya-quality-review-rubric.md). Independent means the reviewers do not see
each other's answers, and ideally do not know which candidate they are reading.

### 6. Run generic safety FIRST

`@qf-jarvis/model-evaluation`, at `ACTIVE_MODEL_RELEASE`, `SHADOW_ELIGIBILITY` or
`CANARY_ELIGIBILITY`. Quality has no meaning without it, and the quality candidate binding cannot even
be constructed without the resulting evidence.

A prompt change is a very common way to break safety: a rewritten instruction that "sounds friendlier"
can weaken a refusal boundary, and no amount of measured warmth compensates.

### 7. Run the quality suite

Derive the binding from the safety evidence, build the suite over the golden corpus, evaluate.

### 8. Compare against the current baseline

Under `riya-quality-comparison-v1`. See the
[comparison playbook](./riya-candidate-comparison-playbook.md).

### 9. Require ZERO dimension regression

A candidate that improves `SALES_MOMENTUM` by 500 basis points and costs one basis point of
`TRUST_BUILDING` is not preferred. Fix the regression and re-measure, or accept the trade explicitly
with an owner's sign-off recorded in the rollout PR — never silently through an average.

### 10. Rollout is a separate PR, reviewed by the owner

Quality evidence is `synthetic: true` / `productionApproval: false` and bridges to no rollout. It is
one input to a human decision, alongside safety evidence, cost, latency and operational readiness.

---

## Overfitting governance

**Golden V1 is immutable after merge.** The fixtures, their ids, their expectations and the thresholds
do not change in place.

- Correcting a fixture that was genuinely wrong → bump `fixtureManifestVersion`.
- Adding or removing cases → bump both the suite version and the manifest version.
- **Never delete a case because a candidate fails it.** That is not fixing a corpus; it is editing the
  measurement to match the answer. If a case is genuinely unfair, say so in the PR that bumps the
  manifest, and explain why in writing.

Every version bump makes old results incomparable with new ones, on purpose. That cost is the thing
that keeps the corpus honest.

**Keep a held-out set** once real optimization begins. Iterating a prompt against a corpus until it
passes produces a prompt that passes that corpus, which is not the same as a better Riya. Hold cases
back, never look at them while authoring, and check the candidate against them once at the end.

**Held-out answers must never enter the prompt authoring loop** — not as examples, not as "here is what
it got wrong", not paraphrased. Once they have, they are training data and the held-out set is spent.

---

## What this workflow cannot tell you

It measures 72 synthetic situations judged by two people. It does not measure how Riya behaves in the
tail of real conversations, how a real client feels three messages later, or whether an enquiry
converts.

A candidate that clears every floor here is ready to be **considered** for a pilot. It has not been
shown to work.
