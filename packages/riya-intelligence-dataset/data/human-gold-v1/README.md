# Human Gold V1 — the corpus itself

This directory holds **actual Human Gold trajectories**. Everything else in the repository describes
the corpus; this is the corpus.

**One canonical trajectory per JSONL line.** No comments, no blank placeholder objects, no skeleton
rows. A line is either a complete, valid trajectory or it does not belong in the file.

## What is open

**Batch 1 only.**

- Active file: **`wave-1/batch-1.jsonl`**
- Assignments: the twelve slots in
  [the Batch-1 authoring packet](../../../../docs/training/riya-human-gold-wave-1-batch-1-packet.md)
- Order and gating: [the Wave-1 batch schedule](../../../../docs/training/riya-human-gold-wave-1-batch-schedule.md)

**Batches 2–6 are blocked** until Batch-1 calibration is accepted. There is no `batch-2.jsonl`, and
creating one does not make that batch open.

## A human writes the words

**No AI or model tool may write, rewrite, paraphrase, translate or "polish" dialogue in this
directory.**

`HUMAN_AUTHORED_SYNTHETIC` means a person physically composed the conversation sentences. A
model-written draft **cannot** become Human Gold by approval, by editing, or by paraphrasing. There is
no authorship detector and none is claimed — the classification is a statement you are making about how
the words came to exist, and the harness cannot check it for you.

## What may never appear here

- **Real or live conversations.** Chat logs, CRM exports and WhatsApp transcripts are not
  representable as Human Gold, whatever their source.
- **Real business facts.** No actual price, package, availability, policy, warranty, timeline or
  contact detail.
- **Real authority values.** Where an assignment requires authority fact classes, the supplied context
  must be **fictional and synthetic**, and it must appear _before_ the turn that cites it.

Where an assignment requires **no** authority class, do not invent authoritative context at all. Answer
from what is already known in the conversation, or say plainly that the information is not available.

## Review is not optional

- `STANDARD` risk — **one** independent accepted review.
- `HIGH_RISK` — **two** distinct independent accepted reviews.
- **The reviewer is never the author.**

A row without the structured review metadata its risk class requires **fails the harness**, and that is
deliberate. The sequence is: a human authors the row, an independent person reviews it, the structured
review metadata is attached, and only then does the row pass.

**An authoring PR may legitimately be red while a review is pending.** That is the gate working, not a
reason to weaken it.

## Checking your work

```
pnpm vitest run packages/riya-intelligence-dataset/src/tests/gold-v1-batch-1-corpus-artifact.test.ts
```

The harness reads this file, re-proves every line through the canonical trajectory parser, and
validates the rows against the Batch-1 assignments they claim to fulfil. An empty file is accepted and
means exactly one thing: **authoring has not started.**
