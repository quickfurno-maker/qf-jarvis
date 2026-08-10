# Riya post-training roadmap

**Slice:** RID-F1 · **Decision:** [ADR-0107](../decisions/ADR-0107-riya-intelligence-dataset-foundation-and-leakage-firewall.md) · **Companions:** [governance](./riya-intelligence-dataset-governance.md), [Gold V1 plan](./riya-gold-v1-coverage-plan.md)

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

### 1. RID-F1 — dataset foundation ← _this slice_

Trajectory contract, lineage splits, leakage and privacy firewalls, business-fact rule, review policy,
SHA-256 identity, derived SFT samples. **Trains nothing.**

### 2. HUMAN GOLD V1

360 human-authored synthetic multi-turn trajectories, 3 × 12 × 10. Reviewed to risk class. See the
[coverage plan](./riya-gold-v1-coverage-plan.md).

### 3. Controlled synthetic expansion

Gold → teacher-generated variants → deterministic validation → leakage and dedupe → **human review** →
accepted. A later target of roughly 2,000–5,000 trajectories, and only if quality and coverage justify
it. No count chasing: the failure mode is a large corpus of near-duplicates that teaches one phrasing
very well.

### 4. Base-model benchmark

Run several candidate base models against generic safety evaluation and P10 quality, untuned. This is
where the base model is chosen — **the smallest one that clears both with adequate margin**. Nothing
before this point names a model, deliberately: a dataset built around one would pre-empt the
measurement that is supposed to make the choice.

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

---

## The honest position today

The framework exists. The corpus does not, no candidate has been benchmarked, and no run has been
attempted.

Nothing in this repository currently establishes that any model or prompt passes the Riya quality
suite. Saying otherwise would be a fabricated performance claim, and the whole point of building the
governance first is to make that claim checkable when it is eventually made.
