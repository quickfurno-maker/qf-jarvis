# Riya post-training roadmap

**Slice:** RID-F1 · **Decisions:** [ADR-0107](../decisions/ADR-0107-riya-intelligence-dataset-foundation-and-leakage-firewall.md), [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md) (AI-synthetic lane) · **Companions:** [governance](./riya-intelligence-dataset-governance.md), [Gold V1 plan](./riya-gold-v1-coverage-plan.md)

Where Riya's intelligence work goes after the dataset foundation, and in what order.

---

## The architecture this serves

Permanent, and not up for revision slice by slice:

> smallest sufficient base model · excellent post-training · structured conversation memory ·
> governed live knowledge and Core truth · deterministic business authority · protected P10
> evaluation · intelligent single-call routing · reviewed continuous learning

Riya is not a template chatbot. The model learns **how to converse and decide**; the system supplies
**what is true** and **what is authorized**.

---

## The order

### 1. RID-F1 — dataset foundation ← _merged_

Trajectory contract, lineage splits, leakage and privacy firewalls, business-fact rule, review policy,
SHA-256 identity, derived SFT samples. **Trains nothing.**

### 2. HUMAN GOLD V1

360 human-authored synthetic multi-turn trajectories, as **5 balanced waves × 3 languages × 12 kinds ×
2** — 288 `TRAIN`, 72 `VALIDATION`, no populated holdout. Reviewed to risk class, and **Wave 1 gates
waves 2–5**.

The authoring system ships in HGV1-A; the conversations are written by people afterwards, and a model
may not write them. See the [wave plan](./riya-human-gold-wave-plan.md), the [authoring
rubric](./riya-human-gold-authoring-rubric.md), the [review
workflow](./riya-human-gold-review-workflow.md) and the [coverage
plan](./riya-gold-v1-coverage-plan.md).

> **Status: OPTIONAL / DEFERRED — and no longer a training prerequisite.** Per
> [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md) the
> owner has removed Human Gold V1 from the critical path. The schedule, the batch-1 packet and every
> gate are ready and stay ready; zero dialogue has been written, because a model may not write it and
> no human author has yet. The corpus file stays empty, and **no model-generated content is ever
> backfilled into it**.
>
> **Deferred, not cancelled.** ADR-0108 still governs it, its provenance rules are permanent, and it
> may resume at any time without waiting on anything. Step 3 below is now the active path.

### 3. AI-synthetic corpus lane ← _the active path_

Authorized by [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md).

Structured scenario plan → teacher-generated trajectories → deterministic validation → leakage,
privacy, authority and dedupe gates → diversity and formula-degeneration gates → independent critic
evidence → accepted. A later target of roughly 2,000–5,000 **accepted** trajectories, with materially
more candidates generated than accepted. No count chasing: the failure mode is a large corpus of
near-duplicates that teaches one phrasing very well.

Every row on this lane is `TEACHER_GENERATED_SYNTHETIC` with a `teacherRef`. **Model-written dialogue
is never labelled `HUMAN_AUTHORED_SYNTHETIC`** — ADR-0108 §1 is permanent, and this lane exists
alongside Human Gold rather than inside it.

Human review is not required here, and is replaced by automated acceptance evidence under a separate
`AUTOMATED_SYNTHETIC` review mode valid only for teacher-generated rows. **Review records are never
fabricated**, and the generic human-review semantics are not weakened for anything else.

Sub-slices: **AS0** governance (ADR-0143) → **AS1** scenario and acceptance contracts → **AS2**
provider-independent offline generation harness → **AS3** controlled generation and filtering. None of
them is implemented yet.

### 4. Base-model benchmark

Run several candidate base models against generic safety evaluation and P10 quality, untuned. This is
where the base model is chosen — **the smallest one that clears both with adequate margin**. Nothing
before this point names a model, deliberately: a dataset built around one would pre-empt the
measurement that is supposed to make the choice.

Operational evidence — latency, decode speed, request success, memory, throughput — is a THIRD input
here, kept separate from safety and quality rather than blended into a score. RMB-A builds the
contracts and RMB-B the harness that produces the numbers: see the
[benchmark foundation](../evaluation/riya-model-benchmark-foundation.md), the
[harness](../evaluation/riya-benchmark-harness.md), the
[measurement policy](../evaluation/riya-benchmark-measurement-policy-v1.md) and the
[selection protocol](../evaluation/riya-model-selection-protocol.md).

Safety and quality are gates; efficiency decides only among candidates that already cleared them. No
real model has been benchmarked and none has been chosen.

### 5. SFT candidate — LoRA/QLoRA first

Derive model-specific rows from the trajectories, apply the chat template of the chosen model, and
train an adapter. LoRA/QLoRA before any full-model training: cheaper, reversible, and it isolates what
the tuning actually changed.

### 6. Generic safety evaluation

`@qf-jarvis/model-evaluation`, at an eligible target. A candidate that fails here has no quality
binding at all — that is enforced by the type system, not by a checklist.

### 7. P10 quality evaluation

The 72-fixture golden corpus, two independent human reviews per case, per-dimension basis-point floors,
Pareto comparison against the baseline. Zero dimension regressions.

**The exam has never been in the corpus.** That is what makes this number mean something, and it is
the single reason the leakage firewall exists.

### 8. Targeted preference dataset → DPO, only if justified

Only after an SFT baseline exists, and only where P10 shows a specific dimension that supervised
tuning did not fix. Preference pairs are built for that dimension, not for everything.

DPO before SFT is a stop condition. Preference optimization on top of a model that has not learned the
task amplifies whatever it currently does.

### 9. P10 again

Preference optimization changes tone in ways supervised tuning does not, and usually not only where
intended. Re-measure everything, not the target dimension.

### 10. Routing and inference optimization

Choose the model **before** inference, from the turn's characteristics. Still one model call per
customer turn — a second call doubles latency and cost for a decision that can be made from what is
already known.

### 11. Shadow, then canary

Real traffic, no customer impact, then a small share with an owner watching the RWC-P9 signals.

### 12. Reviewed continuous learning

Live conversation → privacy and consent → redaction → candidate example → **human review** → dataset
release → training → P10 → shadow/canary → owner rollout.

The flywheel is only safe with the review step in it. **Never `LIVE CHAT → TRAIN`.**

---

## What is explicitly not planned

**No full pretraining from scratch.** Ever, on current evidence. It costs orders of magnitude more
than post-training, needs a corpus this business will never have, and buys nothing that SFT plus
governed knowledge does not already provide.

**Continued pretraining only if later evidence proves a domain-knowledge gap that retrieval cannot
solve.** That evidence would be a P10 failure pattern that survives correct grounding — not a hunch
that the model "doesn't know interiors". Retrieval and governed knowledge are the first answer to a
knowledge gap, and they have the enormous advantage of being correctable in an afternoon.

**No LLM-as-judge for final quality certification.** A judge shares the failure modes of the model it
grades and would systematically approve the answers it would itself have given. Two humans, both must
agree.

> Narrowed by [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md)
> §10 for the AI-synthetic lane only: independent model critics may act as **one filter among many**
> during corpus acceptance, never as the certificate. No averaged critic score may hide a failed hard
> gate, a generating configuration is never the sole critic of its own trajectory, and an automated
> result is **never** presented as human-reviewed P10.

---

## The honest position today

The framework exists. The corpus does not, no candidate has been benchmarked, and no run has been
attempted.

The AI-synthetic lane is **authorized but not built**: ADR-0143 is a governance decision, and AS1–AS7
are all still ahead. No model has been called, no trajectory has been generated, no base model has
been chosen, and `trainingApproval` is still the literal `false` it has always been.

Nothing in this repository currently establishes that any model or prompt passes the Riya quality
suite. Saying otherwise would be a fabricated performance claim, and the whole point of building the
governance first is to make that claim checkable when it is eventually made.
