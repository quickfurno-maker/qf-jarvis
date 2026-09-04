# Riya model selection protocol

**Slice:** RMB-A · **Companions:** [benchmark foundation](./riya-model-benchmark-foundation.md), [candidate comparison playbook](./riya-candidate-comparison-playbook.md), [local benchmark adapter](./riya-local-benchmark-adapter.md)

**No model has been selected, benchmarked or recommended.** This is the order the decision gets made
in, written down before there is any pressure to skip a step.

---

## The objective

> smallest sufficient model + required safety and quality + maximum useful throughput per unit compute

Read the order literally. "Sufficient" is a gate, not a weighting — a model either clears safety and
quality or it is not a candidate, and only among candidates does efficiency decide anything.

## The five steps

### 1. Generic safety evidence

`@qf-jarvis/model-evaluation`. The candidate needs suite and red-team evidence against the exact
release, prompt digest and policy revision it would run under.

A candidate without this is not a candidate. It does not proceed to step 2 with a note.

### 2. Riya quality evidence

`@qf-jarvis/riya-quality-evaluation`. The candidate needs P10 evidence — Riya sales-conversation
quality against the protected golden corpus.

P10 remains the quality authority. The benchmark package does not evaluate quality, does not import
the corpus, and has no opinion here.

### 3. Gate

Only candidates that cleared **both** proceed. This is a filter, not a score. A candidate that
narrowly missed safety is not compensated for by being fast.

The gate is where the honest work happens, and it is the step most likely to be softened when a
deadline is close. The whole point of writing it down now is that it is easier to defend a rule
written in calm.

### 4. Operational evidence

`@qf-jarvis/riya-model-benchmark`. For the surviving candidates only: latency, decode speed, request
success, memory, reproducibility — under exact measurement parity.

This is where speed finally enters, and only among options already known to be good enough.

### 5. The owner chooses

Smallest and most efficient configuration that is **sufficient**. A human decision, made against three
sets of evidence that have deliberately not been combined.

**This step is not implemented as a score, and will not be.** No package ranks candidates, and no
artifact from any of them says which one to pick. The evidence narrows the field; a person chooses
from what is left, and owns the choice.

### Rollout is separate

Selection is not deployment. Rollout has its own owner, its own approval path and its own evidence,
and no benchmark, quality or safety artifact authorizes it. Every benchmark artifact says
`productionApproval: false` in its own body.

---

## What would break this protocol

Worth naming, because each has a plausible-sounding argument behind it:

- **"Just weight the three and rank them."** Latency, quality and safety have no shared unit. A
  weighting is a business judgement, and expressing it as arithmetic disguises that.
- **"This candidate is so much faster, let's revisit the quality bar."** The bar moves when the
  evidence about what customers need changes, not when a fast model fails it.
- **"Benchmark it first, then check safety on the winner."** Measuring only the fast options means the
  gate is applied to a pre-filtered field, and the filter was speed.
- **"Compare against last quarter's numbers."** Only under parity. Different harness, different
  concurrency, different prompt profile — different measurement.
- **"Use the real customer conversations as the workload."** The benchmark carries no text at all, by
  shape. Realistic prompts reach it as digests and token counts.

## Where the model is chosen from

Nowhere yet. No base model is named in any package, and naming one before the evidence exists would
pre-empt the measurement that is supposed to make the choice.

Step 4 now has machinery: RMB-B schedules, and the
[local benchmark adapter](./riya-local-benchmark-adapter.md) can measure a local open-weight release on
a loopback engine. **That changes nothing above.** Having a way to measure is not having measured, a
measurement is not a candidate, and a candidate that has not cleared steps 1-3 does not reach step 4 at
all.
