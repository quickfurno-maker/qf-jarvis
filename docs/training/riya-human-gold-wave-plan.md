# Riya HUMAN GOLD V1 — wave plan and calibration gate

**Slice:** HGV1-A · **Decision:** [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) · **Companions:** [coverage plan](./riya-gold-v1-coverage-plan.md), [authoring rubric](./riya-human-gold-authoring-rubric.md), [review workflow](./riya-human-gold-review-workflow.md)

**No Gold conversation exists yet.** HGV1-A ships the plan, the briefs and the gates. Humans author
Wave 1 next.

---

## The arrangement

```
5 waves × 3 languages × 12 interaction kinds × 2 per cell = 360
```

| Wave | Assignments | Split        | Per language | Per kind |
| ---- | ----------- | ------------ | ------------ | -------- |
| 1    | 72          | `TRAIN`      | 24           | 6        |
| 2    | 72          | `TRAIN`      | 24           | 6        |
| 3    | 72          | `TRAIN`      | 24           | 6        |
| 4    | 72          | `TRAIN`      | 24           | 6        |
| 5    | 72          | `VALIDATION` | 24           | 6        |

**288 `TRAIN` · 72 `VALIDATION` · 0 `HOLDOUT`.**

### Why waves are balanced, not sequential

Every wave is a complete cross-section. No wave is "the English wave" or "the objections wave".

If Wave 1 were the easy English discovery cases, what it taught us would say nothing about Hindi
objections, and the first honest signal about the corpus would arrive at Wave 4 — long past the point
where acting on it is cheap. A balanced wave means the lessons of the first 72 apply to the remaining 288.

### Why there is no holdout

A corpus committed to Git is visible to everyone who authors against the repository. Calling part of
it a holdout would be a comforting label on something untrue.

A validation set everyone has read is at least honestly described, and it is still useful for tuning
and candidate comparison. A genuinely sealed holdout needs a separately governed restricted store, and
it is deferred rather than faked. The dataset foundation still supports `HOLDOUT` generically — Gold
V1 simply does not populate it.

Because wave 5 is the validation split and splits are isolated by lineage, no wave-5 scenario may be a
variant of a wave-1–4 lineage.

---

## Assignment identity

```
gold.v1.w{wave}.{en|hi|hinglish}.{kind}.{01|02}
```

For example `gold.v1.w1.hi.objection-price.02`.

Regenerating the plan produces byte-identical assignments, so an id in a brief, a progress record or a
commit message means the same thing in six months. The namespace is the Gold slice's own — never the
P10 exam's, which would collide in every tool that keys on ids.

**One slot, one conversation:** a trajectory's id equals the assignment it fulfils. A corpus therefore
cannot gain an extra example, skip a slot, or fulfil one twice, and each of those three mistakes is
reported separately.

---

## What varies inside a cell

The two assignments in a cell (`01` and `02`) always differ in persona, and differ in difficulty or
starting phase. Two takes on the same situation with the same customer is one conversation written
twice — which is exactly the degeneration this matrix exists to prevent, and the easiest mistake to
make where the plan says "write two".

The plan rotates persona by wave, language and ordinal, so a cell's pairing changes across waves
rather than repeating the same two customers five times.

---

## Diversity floors

Floors, not quotas, and they deliberately do not sum to 360. Forcing exact counts would mean writing a
`PREMIUM` customer asking a completed-intake process question purely to balance a table, and an
unnatural scenario teaches a customer who does not exist.

**Final, across all 360:**

| Axis       | Floor                                                     |
| ---------- | --------------------------------------------------------- |
| Persona    | ≥ 30 each, all eight                                      |
| Difficulty | `BASIC` ≥ 50, `STANDARD` ≥ 150, `HARD` ≥ 100, `EDGE` ≥ 30 |
| Risk       | `STANDARD` ≥ 180, `HIGH_RISK` ≥ 90                        |
| Language   | 120 each                                                  |
| Kind       | 30 each                                                   |

**Wave 1**, proportionate, so calibration runs against a genuinely representative wave:

| Axis       | Floor                                                       |
| ---------- | ----------------------------------------------------------- |
| Difficulty | `BASIC` ≥ 8, `STANDARD` ≥ 30, `HARD` ≥ 20, `EDGE` ≥ 6       |
| Risk       | `HIGH_RISK` ≥ 18                                            |
| Persona    | all eight present, none above 16, ≥ 6 distinct per language |
| Depth      | shallow (≤5) ≥ 12, mid (6–8) ≥ 36, deep (≥9) ≥ 12           |
| Phases     | every one of the nine conversation phases starts somewhere  |

Depth is 4–12 assistant turns throughout. Below four an example teaches a reply; above twelve it
teaches a transcript.

---

## The 72 Wave-1 briefs

One per Wave-1 assignment, all 72 independently authored — not one scenario per kind translated into
three languages. Every situation and every goal is unique.

A brief carries a customer situation, a conversation goal, required journey events, forbidden
shortcuts, an authority plan, a style plan and a review focus. **It carries no dialogue**, its prose
fields refuse quotation marks and speaker prefixes, and it cannot be parsed as a trajectory. Briefs
and trajectories live in one repository, and the shortest path from "we need 360 conversations" to
"we have 360 conversations" is to promote the instructions into the corpus.

---

## The calibration gate

**Waves 2–5 do not begin until Wave 1 passes.**

Authoring 288 more conversations before knowing whether the first 72 are any good is how a corpus
becomes unfixable. The gate exists to make the expensive mistake cheap.

### To pass, all of these

- [ ] 72 accepted trajectories, fulfilling exactly the 72 Wave-1 assignments — none missing, none
      extra, none duplicated.
- [ ] Every one `HUMAN_AUTHORED_SYNTHETIC`, and every one actually written by a person.
- [ ] Zero Gold matrix findings — split, language, kind, persona, risk and depth all as assigned.
- [ ] The full RID-F1 gate clean: zero protected-exam leakage (exact or near), zero unresolved
      cross-split quarantine, zero privacy findings, zero unsupported business facts, zero lineage
      violations.
- [ ] Every `HIGH_RISK` slot carries two distinct accepted reviews; every standard slot one; no slot
      reviewed by its author.
- [ ] Wave-1 diversity floors met on the finished corpus, not just the plan.
- [ ] The repetition report **read by a human**, and the V1 degeneration threshold written down.
- [ ] A wave read-through completed: 72 openers in a row, 72 closers in a row, each kind across all
      three languages.

### What the gate may change

Wave 1 is allowed to teach us that the plan is wrong:

- a difficulty mix that produced unnatural scenarios;
- a persona that does not fit a situation;
- a depth target too shallow or too deep to be real;
- a brief two authors read two different ways;
- the repetition threshold, set for the first time against real content.

Waves 2–5 are regenerated or re-briefed accordingly, and what changed is recorded.

### What it may not change

The human-authored rule. The absence of a populated holdout. The protected-exam firewall or the corpus
it is pinned to. Privacy, secret and business-fact authority gates. The requirement that a reviewer is
not the author. The RID-F1 gate running first and unchanged.

---

## Tracking a wave

The progress board carries assignment id, status, trajectory reference, author reference, review count
and last revision — and no content, no reviewer name, no notes. Its summary is deterministic: counts
by status, wave, language and interaction, plus `highRiskAwaitingSecondReview`, which is the number
that actually tells you whether a wave is stuck.

---

## Definition of done for Gold V1

- 360 trajectories fulfilling the 360 assignments, every one human-authored;
- the full RID-F1 gate clean and the Gold matrix clean;
- the Gold coverage policy satisfied — 360 total, 120 per language, 30 per kind, all floors met;
- every high-risk slot twice-reviewed, by somebody other than its author;
- the repetition report within the calibrated threshold;
- a sealed manifest and release evidence, `syntheticOnly: true`, `trainingApproval: false`.

Release evidence never starts a training run. That stays a separate, separately governed decision —
see the [roadmap](./riya-post-training-roadmap.md).
