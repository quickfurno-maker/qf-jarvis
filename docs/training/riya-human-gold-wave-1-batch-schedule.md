# Riya Human Gold V1 — Wave-1 micro-batch schedule

**ZERO GOLD DIALOGUE.** This document contains no conversation, no customer line and no Riya line. It
is operational ordering metadata: which assignments are written when, and in what order they are
reviewed.

Owning decision: [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md),
including its post-acceptance notes of 2026-09-02.

**Companion documents**

- [Wave plan](./riya-human-gold-wave-plan.md)
- [Authoring rubric](./riya-human-gold-authoring-rubric.md)
- [Review workflow](./riya-human-gold-review-workflow.md)
- [Batch-1 authoring packet](./riya-human-gold-wave-1-batch-1-packet.md)

---

## The shape

**Six micro-batches of twelve = 72 Wave-1 assignments.**

Seventy-two assignments handed over as one list is a pile, not a plan. The batches exist so authoring
can start, be reviewed, and be **calibrated** before the rest is written.

**This schedule is not a planning authority.** It changes order and nothing else. The assignments come
from the plan exactly as approved — same ids, splits, personas, difficulty, risk, phases, depth,
authority classes and secondary kinds. The scheduler holds assignments only; it never touches a brief,
a scenario, a goal or a turn.

## The rotation

For batch index `b` (0-based) and interaction-kind index `k`:

```
language = LANGUAGES[(k + b) mod 3]
ordinal  = 1 + ((k + b) mod 2)
```

A hand-maintained list of 72 ids would drift the first time the plan changed, and nobody would notice
until an author opened a batch that no longer matched. The formula is re-derived from the current plan
on every call, so it cannot drift.

It partitions Wave 1 **exactly**, and not by luck: as `b` runs 0—5, `(k + b)` covers all six
residues mod 6, and mod 6 splits uniquely into (mod 3, mod 2) — so each kind visits all 3 x 2 = 6
language/ordinal combinations once. Twelve kinds x six batches = 72, nothing repeated, nothing missed.

**Why the ordinal alternates with `k + b` rather than being blocked by ordinal.** Blocking would make
Batch 1 twelve easy first-ordinals and push every hard case to the back half. Alternating gives each
batch six ordinal-1 and six ordinal-2 slots, so reviewers meet the difficult work immediately —
which is the entire point of calibrating on Batch 1.

It also places the two ordinals of any language/kind pair **exactly three batches apart**: `b` and
`b + 3` are the only batches where the language selector picks that language, and because 3 is odd
their ordinals differ. A pair is never written back-to-back by the same person on the same afternoon.

## The six batches

| Batch | Languages                        | Difficulty                             | Risk                     |
| ----- | -------------------------------- | -------------------------------------- | ------------------------ |
| 1     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 3 · STANDARD 3 · HARD 4 · EDGE 2 | STANDARD 9 · HIGH_RISK 3 |
| 2     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 1 · STANDARD 8 · HARD 3          | STANDARD 6 · HIGH_RISK 6 |
| 3     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 3 · STANDARD 3 · HARD 4 · EDGE 2 | STANDARD 9 · HIGH_RISK 3 |
| 4     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 1 · STANDARD 8 · HARD 3          | STANDARD 6 · HIGH_RISK 6 |
| 5     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 3 · STANDARD 3 · HARD 4 · EDGE 2 | STANDARD 9 · HIGH_RISK 3 |
| 6     | ENGLISH 4 · HINDI 4 · HINGLISH 4 | BASIC 1 · STANDARD 8 · HARD 3          | STANDARD 6 · HIGH_RISK 6 |

Every batch carries all twelve interaction kinds exactly once, four assignments per language, six of
each ordinal, and at least one HARD or EDGE case. These distributions are **measured from the current
plan**, not designed by hand — no slot was moved to make a table look symmetrical.

## Batch 1 — the calibration anchor

1.  `gold.v1.w1.en.discovery.01`
2.  `gold.v1.w1.hi.correction.02`
3.  `gold.v1.w1.hinglish.objection-price.01`
4.  `gold.v1.w1.en.objection-trust.02`
5.  `gold.v1.w1.hi.objection-timeline.01`
6.  `gold.v1.w1.hinglish.comparison.02`
7.  `gold.v1.w1.en.grounding-qa.01`
8.  `gold.v1.w1.hi.out-of-scope.02`
9.  `gold.v1.w1.hinglish.human-request.01`
10. `gold.v1.w1.en.post-summary-qa.02`
11. `gold.v1.w1.hi.complete-qa.01`
12. `gold.v1.w1.hinglish.next-step.02`

**Batch 1 must be authored, independently reviewed and read end to end before batches 2—6 begin.**

It is not merely "the first batch". It is the one whose review teaches everyone what _accepted_
actually means. Writing all six in parallel would produce seventy-two conversations calibrated against
nothing, and the cost of discovering that is the corpus.

**Batches 2—6 remain blocked until Batch-1 calibration is accepted.** They may be parallelised
afterwards, at the owner's discretion — that is a governance decision, and no code enforces it.
