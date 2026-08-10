# Riya HUMAN GOLD V1 — Wave 1 micro-batch schedule

**Slice:** HGV1-B · **Decision:** [ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) · **Companions:** [wave plan](./riya-human-gold-wave-plan.md), [batch-1 packet](./riya-human-gold-wave-1-batch-1-packet.md), [authoring rubric](./riya-human-gold-authoring-rubric.md)

**No Gold conversation exists yet.** This is the order Wave 1 gets written in. It plans nothing — the
72 slots were frozen by HGV1-A and this schedule hands them out unchanged.

---

## Six batches of twelve

```
6 micro-batches × 12 = 72
```

Every batch carries all twelve primary interaction kinds exactly once, and four of each language.

| Batch | Slots | English | Hindi | Hinglish | Ordinals         | Difficulty present                  | High-risk |
| ----- | ----- | ------- | ----- | -------- | ---------------- | ----------------------------------- | --------- |
| **1** | 12    | 4       | 4     | 4        | 6× `01`, 6× `02` | BASIC 3, STANDARD 3, HARD 4, EDGE 2 | 3         |
| 2     | 12    | 4       | 4     | 4        | mixed            | includes HARD / EDGE                | —         |
| 3     | 12    | 4       | 4     | 4        | mixed            | includes HARD / EDGE                | —         |
| 4     | 12    | 4       | 4     | 4        | mixed            | includes HARD / EDGE                | —         |
| 5     | 12    | 4       | 4     | 4        | mixed            | includes HARD / EDGE                | —         |
| 6     | 12    | 4       | 4     | 4        | mixed            | includes HARD / EDGE                | —         |

**Batch 1 is the calibration anchor.** It is written, reviewed and read end to end before batches 2–6
begin. Batches 2–6 may then be authored in parallel by different people.

## The anchor batch, exactly

```
 1. gold.v1.w1.en.discovery.01              7. gold.v1.w1.en.grounding-qa.01
 2. gold.v1.w1.hi.correction.02             8. gold.v1.w1.hi.out-of-scope.02
 3. gold.v1.w1.hinglish.objection-price.01  9. gold.v1.w1.hinglish.human-request.01
 4. gold.v1.w1.en.objection-trust.02       10. gold.v1.w1.en.post-summary-qa.02
 5. gold.v1.w1.hi.objection-timeline.01    11. gold.v1.w1.hi.complete-qa.01
 6. gold.v1.w1.hinglish.comparison.02      12. gold.v1.w1.hinglish.next-step.02
```

Pinned as a literal list in the batch spec, so a change to the rotation that silently reshapes the
anchor fails rather than quietly handing authors a different twelve.

## The rotation

```
language = (kindIndex + batchIndex) mod 3       // 0 ENGLISH, 1 HINDI, 2 HINGLISH
ordinal  = 1 + ((kindIndex + batchIndex) mod 2)
```

For a fixed kind, six batches walk the three languages twice — so each language/kind pair lands in
exactly two batches, three apart. Adding three flips the parity, so those two occurrences take
opposite ordinals automatically: every pair gets exactly one `01` and one `02`, and across the six all
72 official Wave-1 assignments appear exactly once.

Proved in `gold-v1-wave-1-batches.test.ts`: six batches, twelve each, twelve kinds each, 4/4/4
languages each, every official assignment exactly once, `{1, 2}` ordinals per pair, the three-batch
spacing, determinism, the exact anchor id list, its 3/3/4/2 difficulty mix and its 9/3 risk split, and
that the assignments come back from the frozen plan field-for-field unchanged.

## Why batches at all

Writing 72 conversations and then discovering they share one rhythm is the failure the whole Gold
design is arranged against, and a wave is small enough to commit it in. Twelve is what it costs to
find out.

## Why each batch is a complete cross-section

An anchor of twelve easy English discovery cases would teach us nothing about Hindi objections, which
is where the problems live. The anchor is a miniature of the wave, not a corner of it.

---

## Why the ordinal alternates by kind, not by batch

The first version of this schedule gave batches 1–3 every `01` and batches 4–6 every `02`. HGV1-A
makes difficulty a property of the ordinal — shape `01` is the gentler take of a cell, `02` the harder
one — so the two rules meeting produced a calibration anchor containing `BASIC` and `STANDARD` only.
The first `HARD` or `EDGE` conversation would not have been written until batch 4.

An anchor exists to surface systemic problems, and it cannot surface a problem in work nobody has done
yet. Alternating on `(kind + batch)` parity instead mixes both takes into every batch. Batch 1 now
carries 3 BASIC, 3 STANDARD, 4 HARD and 2 EDGE, every batch carries at least one HARD or EDGE slot,
and every property above still holds.

The 72 official assignments were not touched to achieve this. Only the order changed.

---

## What the schedule is not

It is operational, not a planning authority. It does not modify the 72-slot plan, add a slot, drop
one, or change any assignment field. It is content-free: assignments only, no brief prose, no
dialogue, no P10 anything.
