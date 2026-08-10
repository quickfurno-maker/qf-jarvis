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

| Batch | Slots | English | Hindi | Hinglish | Ordinal | Difficulty present   | High-risk |
| ----- | ----- | ------- | ----- | -------- | ------- | -------------------- | --------- |
| **1** | 12    | 4       | 4     | 4        | `01`    | BASIC, STANDARD      | 2         |
| 2     | 12    | 4       | 4     | 4        | `01`    | BASIC, STANDARD      | 2         |
| 3     | 12    | 4       | 4     | 4        | `01`    | BASIC, STANDARD      | 2         |
| 4     | 12    | 4       | 4     | 4        | `02`    | STANDARD, HARD, EDGE | 6         |
| 5     | 12    | 4       | 4     | 4        | `02`    | STANDARD, HARD, EDGE | 6         |
| 6     | 12    | 4       | 4     | 4        | `02`    | STANDARD, HARD, EDGE | 6         |

**Batch 1 is the calibration anchor.** It is written, reviewed and read end to end before batches 2–6
begin. Batches 2–6 may then be authored in parallel by different people.

## The rotation

`language = (kindIndex + batchIndex) mod 3`, over the canonical interaction-kind order.

For a fixed kind, six batches walk the three languages twice — so each language/kind pair lands in
exactly two batches, three apart. The earlier takes ordinal `01`, the later `02`. Across the six, all
72 official Wave-1 assignments appear exactly once.

Proved in `gold-v1-wave-1-batches.test.ts`: six batches, twelve each, twelve kinds each, 4/4/4
languages each, every official assignment exactly once, the pair spacing, determinism, and that the
assignments come back from the frozen plan field-for-field unchanged.

## Why batches at all

Writing 72 conversations and then discovering they share one rhythm is the failure the whole Gold
design is arranged against, and a wave is small enough to commit it in. Twelve is what it costs to
find out.

## Why each batch is a complete cross-section

An anchor of twelve easy English discovery cases would teach us nothing about Hindi objections, which
is where the problems live. The anchor is a miniature of the wave, not a corner of it.

---

## Known limitation of the anchor — worth an owner decision

Batches 1–3 are every slot's **first** take and batches 4–6 every slot's second. HGV1-A makes
difficulty a property of the ordinal — slot shape `01` is the gentler take of a cell, `02` the harder
one — so the two rules meeting produce the split in the table above:

- **Batches 1–3 contain no `HARD` and no `EDGE` slot at all.**
- The first `HARD` or `EDGE` conversation is written in **batch 4**, after sixty others.
- The anchor carries 2 high-risk slots; batches 4–6 carry 6 each.

The anchor still calibrates voice, one-question discipline, language authenticity, annotation honesty
and the two-reviewer loop. What it cannot surface is a systemic problem specific to hard or edge
scenarios — which is a real gap in a batch whose whole purpose is to surface systemic problems.

Two options, both keeping every property proved above:

1. **Keep it.** Accept that hard-scenario calibration happens at batch 4 and plan a second checkpoint
   there.
2. **Alternate the ordinal by kind index** rather than by batch index — `ordinal = 1 + ((kindIndex +
batchIndex) div 3 + kindIndex) mod 2` or similar — mixing `01` and `02` slots into every batch, so
   the anchor sees the full difficulty range.

This is the owner's call. The schedule as shipped implements the specified allocation unchanged.

---

## What the schedule is not

It is operational, not a planning authority. It does not modify the 72-slot plan, add a slot, drop
one, or change any assignment field. It is content-free: assignments only, no brief prose, no
dialogue, no P10 anything.
