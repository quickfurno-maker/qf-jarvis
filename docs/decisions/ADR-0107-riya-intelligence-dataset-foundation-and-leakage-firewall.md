# ADR-0107 — RID-F1: Riya intelligence dataset foundation and leakage firewall

- **Status:** Accepted — RID-F1 merged as PR #112. Reviewed head `41abcf2`, merge commit
  `66d83756ffbcc247a4a56c5a177da11ac6c45872`. Extended by
  [ADR-0108](./ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) (HGV1-A, current).
- **Date:** 2026-08-10
- **Depends on:** ADR-0098/0099 (RWC-P4A/P4B), ADR-0103 (RWC-P7), ADR-0104 (RWC-P8),
  ADR-0105 (RWC-P9), ADR-0106 (RWC-P10 quality evaluation), ADR-0052 (the generic evaluation
  foundation), ADR-0073 (prompt content digests)
- **Baseline:** RWC-P10 merged as PR #111 — merge commit
  `6e6af0e177bcc18ea72c5a4ea7ef5f2f3b582ed7`. Migrations `0001`–`0012`. **RID-F1 adds none.**

## The permanent Riya architecture this serves

Riya is not a template chatbot. The governing design, now a permanent constraint:

> smallest sufficient base model · excellent post-training · structured conversation memory ·
> governed live knowledge and Core truth · deterministic business authority · protected P10
> evaluation · intelligent single-call routing · reviewed continuous learning

The goals that follow from it: maximise safely autonomous conversations per unit of compute; teach
conversation strategy rather than memorised sentences; keep volatile business truth out of the
weights; treat full multi-turn trajectories as the canonical source; never train on protected
evaluation cases; never auto-train from live WhatsApp; never make a second model call in a customer
turn; choose the model before inference rather than during it; reach for LoRA/QLoRA before any full
training; use preference optimization only after SFT and only when evaluation proves it helps; and
never certify Riya quality with an LLM judge.

## Context

RWC-P10 made Riya's quality measurable. Nothing yet makes it improvable.

The gap is a dataset — and the way that usually goes wrong is well known. Somebody writes a few
thousand `intent → good reply` pairs, the model memorises phrasings, the validation score rises
because paraphrases of training rows leaked into it, an exam question ends up in the corpus, a real
phone number ends up in the weights, and a price from last quarter becomes something the model
asserts with confidence forever.

RID-F1 builds the factory that makes each of those specific failures impossible before any content
exists to fail with.

## Decision

### 1. RID-F1 is internal intelligence work, not a canonical QFJ phase

Not QFJ-P11, not QFJ-P12, not RWC-P11. The canonical QFJ P00–P12 roadmap is unchanged and this slice
does not renumber it.

### 2. Trajectories are the canonical source

The record is a multi-turn conversation with its state, its simulated authoritative context, and an
annotation on every assistant turn. `user_text → canned_reply` is deliberately not representable as a
top-level record.

A reply in isolation teaches what a good sentence looks like, which is exactly the skill that fails on
the fourth turn — when the right answer depends on what the customer already said, what the business
already supplied, and where the conversation is trying to get to.

### 3. Model-specific rows are DERIVED

`deriveRiyaSftSamples` produces one sample per assistant turn. Nobody authors them and nothing edits
them. Fixing an example means fixing one trajectory; every row regenerates. Changing base model means
changing the formatter, not the corpus.

### 4. P10 fixtures are protected exam data, and P10 is NOT a split

The splits are `TRAIN`, `VALIDATION`, `HOLDOUT`. The golden corpus is absent from that list on
purpose: a split is something a dataset owns and may draw from, and the moment the exam appeared
there somebody would legitimately partition against it.

It is guarded by a firewall instead, which is a different mechanism because it answers a different
question. A model trained on the exam scores well because it has seen it, the score means nothing, and
it means nothing in a way that looks exactly like success.

### 5. Splits are isolated by LINEAGE, not by row

Every trajectory carries a `lineageRootRef`. A human original and all its teacher variants share one,
and the validator refuses a lineage that appears in more than one split. Derived SFT samples inherit
the trajectory's split and lineage.

Row-level splitting looks correct and is not: a paraphrase in VALIDATION measures memorisation, the
score improves, and nobody can see why.

### 6. HOLDOUT is not for authoring visibility

Prompt and dataset authoring work against TRAIN and VALIDATION. A holdout somebody has read is not a
holdout.

### 7. Sources are SYNTHETIC ONLY, and the vocabulary is the enforcement

`HUMAN_AUTHORED_SYNTHETIC` and `TEACHER_GENERATED_SYNTHETIC`. There is no `LIVE_CHAT`,
`PRODUCTION_EXPORT`, `CRM_EXPORT`, `WHATSAPP_EXPORT` or `REAL_CUSTOMER` value, so a real conversation
is not representable — not merely discouraged. `synthetic` is a literal `true` in the type.

### 8. Raw QuickFurno commercial truth is prohibited

No real package, price, vendor, customer or availability. Fixtures use obvious placeholders, so a
passing suite can never be read as a claim about a real offering.

### 9. Volatile business facts are CONTEXT, never memorised truth

An assistant turn asserting a price, availability, package, policy, warranty, process or current
status must cite a `factRef` supplied by an **earlier** `AUTHORITATIVE_CONTEXT` turn. A forward or
dangling citation is refused.

> Model weights learn HOW to sell, reason and route. Governed knowledge and Core supply WHAT IS TRUE
> TODAY.

A customer's own statement — "I got a 7 lakh quote" — is allowed and is explicitly not Core truth.

### 10. No teacher chain-of-thought, and no hidden reasoning field

Training on a reasoning trace teaches the shape of reasoning rather than the conclusion, and the
traces are unverifiable: nobody reviews them, so a confidently wrong one is indistinguishable from a
good one. The decision and the objective are the claim; the reply is the evidence.

### 11. Teacher output is never automatically accepted

A teacher-generated trajectory must name the configuration that produced it, and it passes the same
deterministic gates and the same human review as anything else.

### 12. No dataset item can start training

There is no bridge to a job, a queue or a scheduler, and release evidence carries
`trainingApproval: false` as a type literal.

### 13. No model or provider invocation, and no LLM-as-judge

No gateway, provider, local inference, HTTP, embedding, vector store or tokenizer. The near-match
firewall is deterministic token overlap: an embedding would make this package invoke a model, and a
probabilistic gate would let the same corpus pass on Tuesday and fail on Thursday.

### 14. Review is risk-based

`STANDARD` needs one independent accepted review; `HIGH_RISK` needs two distinct ones. The author
never counts as a reviewer. Every trajectory is reviewed on `CLARITY`, `NATURALNESS`, `CONTEXT_USE`
and `NON_REPETITION`; objection trajectories add `EMPATHY`, `OBJECTION_HANDLING`, `TRUST_BUILDING`,
`SALES_MOMENTUM` and `CTA_QUALITY`.

Two reviewers on everything sounds safer and is not: it halves throughput, so either the corpus stops
growing or reviews become rubber stamps — and a rubber stamp on a price example is worse than an
honest single review on a greeting.

### 15. Privacy and secret gates are deterministic and never echo the match

Email, phone, API key, bearer and service-role token, private key, UPI-like handle, URL and governed
production names. Findings report a location and a closed kind, never the value: reporting the match
would take the one string nobody should retain and write it into a CI log.

Ordinary domain numbers pass — `3BHK`, `10 lakh`, `1200 sq ft`, a city name — because a scanner that
flagged those would be turned off within a week.

### 16. Exact leakage REJECTS; near leakage QUARANTINES

Normalization is NFKC, folded punctuation, collapsed whitespace, lowercase, no trailing terminator —
and explicitly no translation or transliteration, so Hindi and its English rendering stay distinct.

An exact normalized collision, or an identifier in the protected namespace, is a rejection. A near
collision quarantines: a contiguous common run of **8+ tokens**, or a **5-gram Jaccard ≥ 0.80**.
Release requires zero unresolved quarantine. Cross-split near duplicates use the same shape at a
**12-token** run, because conversations are longer than single fixtures.

### 17. The firewall ships no protected text

The index is built from strings the CALLER supplies. Production source in
`@qf-jarvis/riya-intelligence-dataset` contains no P10 fixture text and no P10 identifier — copying
the exam into the guard's own constants would put the exam in the shipped bundle, which is the thing
being prevented, wearing a badge. A spec asserts it, and it caught one illustrative identifier in a
doc comment during implementation.

### 18. SHA-256 is content identity, not authorship

Dataset artifacts use cryptographic SHA-256 via `node:crypto`, deliberately unlike P10's
non-cryptographic `contentDigest`. A dataset is written once, copied between machines, and cited
months later as the exact thing a model was trained on; two corpora colliding under one identity would
be unrecoverable.

It is **not a signature**. It proves nothing about who produced an artifact, and anyone who can edit a
dataset can recompute its digest.

### 18a. Every nested value is re-proved, and every attestation is content-bound

Owner correction on PR #112. Three holes, each of which let an unchecked thing reach a place that
reads as a verdict.

**The trajectory constructor now deep-re-proves.** It accepted `initialState` and `turns` as unknown,
checked only that each turn was an object with a `type`, and returned the caller's objects — so the
JSONL promise that parsing re-proves a record was false at the turn level. The full raw state now
goes through `createRiyaTrainingState` and every full raw turn is dispatched to the constructor that
owns it, with only canonical results kept. `validateRiyaIntelligenceDataset` and the manifest builder
re-prove at their own boundaries, because a digest over an unvalidated record is a precise identity
for something invalid — which is worse than no identity, since it makes the invalid record citable.

**The exam firewall and the coverage policy are no longer skippable.** Omitting the protected index
substituted an empty one, which matches nothing, produces no finding and yields `eligible: true`. A
versioned `RiyaDatasetReleasePolicyV1` now carries the coverage policy and PINS the protected corpus
by `protectedEntryCount` and `protectedIndexSha256`; validation records a bounded binding failure and
refuses eligibility when the index it was handed does not match. The index digest is over sorted
`[protectedRef, normalizedText]` pairs, so supply order cannot change a corpus's identity and a
conflicting duplicate ref is refused. The generic package still pins no `72` and no fixture
identifier — the Gold V1 release policy will, as data.

**Release evidence binds by CONTENT, not by count.** Pairing on `records.length ===
totalTrajectories` meant two different corpora of the same size paired cleanly. The report now
carries `validatedDatasetSha256` — over the sorted identity of every validated trajectory — and
`reportSha256` over everything else; evidence recomputes the dataset digest from the manifest's own
records and requires it to match, and takes the policy identity from the report rather than from a
caller. Counting remains a cheap extra check, never the binding.

### 18b. A decision that names an authority must rest on it

The first rule proved that every cited fact existed earlier. It did not prove that a turn ASSERTING a
business fact cited anything, so `USE_CORE_TRUTH` with an empty citation list was representable — a
turn claiming Core said something while citing nothing.

Now `USE_CORE_TRUTH` and `USE_GOVERNED_KNOWLEDGE` each require at least one citation, and every cited
fact must come from the authority the decision names. Governed knowledge and Core have different
update paths and different consequences for being wrong; a corpus that blurred them would teach the
model they are interchangeable. A decision that names no authority may cite nothing.

A narrow deterministic scanner also flags high-confidence volatile claims in ASSISTANT text — an
explicit company price, a warranty term, a service-availability statement, a refund or cancellation
commitment, a current-status assertion — and requires a cited fact of the matching class. It reads no
USER text, so a customer's competitor quote or stated budget needs no authority. `PACKAGE`, `PROCESS`
and `OTHER_BUSINESS_FACT` are deliberately not detected: their language is not separable from
ordinary conversation without semantics this package refuses to guess at, and a plausible-looking
gate is worse than an honest gap. Findings are closed classes; no text is echoed.

### 19. No database, no migration, no deployment

Migrations stay `0001`–`0012`. No managed database, no live WhatsApp, no provider, no n8n, no
QuickFurno repository access, nothing deployed.

### 20. No runtime may import this package

Offline authoring infrastructure. A runtime that could reach it is a runtime that could reach training
data — and a path by which a live conversation could be appended to a corpus. A spec proves nothing
imports it.

### 21. No base model is hard-coded

The dataset is provider- and model-independent. A later benchmark chooses the smallest model that
clears safety and P10 with adequate margin; naming one here would pre-empt the measurement that is
supposed to make the choice.

### 22. HUMAN GOLD V1 is the next content slice

Provisional target 360 multi-turn trajectories — 3 languages × 12 interaction kinds × 10 each, four to
twelve assistant turns. **Not generated in this PR**, and no `360` appears in production source: that
belongs to the Gold V1 release policy, authored as data.

> **Superseded in detail by [ADR-0108](./ADR-0108-riya-human-gold-v1-authoring-and-calibration.md).**
> HGV1-A is that slice. It keeps the 360 total, the twelve kinds, the three languages and the 4–12
> depth band, and it restates the arrangement as **5 balanced waves × 3 languages × 12 kinds × 2**
> rather than 3 × 12 × 10 — the same 360, generated as a checkable table. Splits are 288 `TRAIN`
> (waves 1–4) / 72 `VALIDATION` (wave 5) / **0 `HOLDOUT`**, replacing the ~70/15/15 sketch in the
> coverage plan: a corpus committed to Git has no honest holdout, so V1 populates none rather than
> pretending. `360` is now authored as data in the Gold coverage policy exactly as this section
> required, and the "no Gold target in production source" lock is restated in the containment spec as
> "no Gold target OUTSIDE the Gold slice".

## Consequences

- A strict multi-turn canonical training source exists, and it teaches strategy rather than sentences.
- Variants cannot leak across splits; the exam cannot leak into training.
- Secrets and personal data cannot silently enter a released corpus.
- Volatile business truth cannot become unsupported learned truth.
- Review effort goes where a wrong answer becomes a commitment.
- Every release has a deterministic SHA-256 identity, and none of it starts a training run.
- The next slice authors content without rebuilding governance.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- trajectories are canonical and SFT rows are derived;
- P10 is protected exam data and never a split;
- splits are lineage-isolated;
- sources are synthetic only, and live chat is not representable;
- volatile business facts require earlier authoritative support;
- no model call, no LLM-as-judge, no hidden reasoning field;
- review is risk-based, content-free, and never by the author;
- privacy findings never echo the matched text;
- SHA-256 is content identity, not authorship;
- release evidence is `syntheticOnly` with `trainingApproval: false`, and nothing auto-trains;
- no runtime import, no migration, no deployment, no QuickFurno access;
- every nested state and turn is re-proved through its owning constructor, at the trajectory
  constructor and at every service boundary;
- a releasable validation must be bound to a versioned release policy that pins the protected corpus
  by count and digest, and release evidence binds a report and a manifest by content rather than by
  count, copying the policy identity from the report;
- a decision naming an authority must cite at least one fact from that authority, and a
  high-confidence volatile claim must cite a fact of the matching class.
