# Riya intelligence dataset governance

**Slice:** RID-F1 · **Decisions:** [ADR-0107](../decisions/ADR-0107-riya-intelligence-dataset-foundation-and-leakage-firewall.md), [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md) (AI-synthetic lane) · **Companions:** [Gold V1 coverage plan](./riya-gold-v1-coverage-plan.md), [post-training roadmap](./riya-post-training-roadmap.md)

This is for whoever authors, reviews or releases Riya training data. It assumes no knowledge of the
codebase.

**Nothing here trains anything.** RID-F1 is the dataset factory. No model is called, no run starts,
and release evidence says `trainingApproval: false` in so many words.

---

## 1. The training unit is a conversation, not a reply

The tempting record is:

> customer message → good reply

It is the wrong one. It teaches the model what a good sentence looks like in isolation, which is
exactly the skill that fails on the fourth turn — when the right answer depends on what the customer
already said, what the business already supplied, and where the conversation is trying to get to.

The canonical record is a **trajectory**:

```
initial state (phase, what is known, how strongly)
  → customer message
  → simulated authoritative context (what the business supplied)
  → assistant reply + annotation
       · decision            what it chose to do
       · responseObjective   what it was trying to achieve
       · expectedObservation what it learned from the customer
       · supportedFactRefs   which authoritative facts it may assert
       · askedDiscoveryFields  what it asked (at most one)
       · expectedPhaseAfter  where the conversation should now be
  → …
```

Every field is a lesson. The model is learning **when to ask, when to answer, when to reach for
authority, when to hand off and when to refuse** — not which sentence to reproduce.

Templates are allowed later as authoring seeds, deterministic edge cases and variation sources. They
are never Riya's primary intelligence.

---

## 2. Splits, and the rule that actually matters

| Split        | For                             |
| ------------ | ------------------------------- |
| `TRAIN`      | learning                        |
| `VALIDATION` | tuning and candidate comparison |
| `HOLDOUT`    | a final, unlooked-at check      |

**The RWC-P10 golden corpus is none of these.** It is the exam. See §4.

`HOLDOUT` is supported here and **not populated by Human Gold V1**: a corpus committed to Git has no
honest unlooked-at split, so V1 declines to claim one. See
[ADR-0108](../decisions/ADR-0108-riya-human-gold-v1-authoring-and-calibration.md) §5.

### Lineage

Every trajectory has a `lineageRootRef` naming the family it belongs to. A human original and all of
its teacher variants share one:

```
riya.gold.en.price.001            lineageRootRef = riya.family.price.001
riya.synthetic.en.price.001.v01   lineageRootRef = riya.family.price.001
riya.synthetic.en.price.001.v02   lineageRootRef = riya.family.price.001
```

**A lineage lives in exactly one split.** Splitting by row instead looks correct and is not: a
paraphrase of a TRAIN conversation sitting in VALIDATION measures memorisation, the score improves,
and nobody can see why. Derived SFT samples inherit the split and the lineage, so a downstream tool
cannot undo it either.

Near duplicates **within** one split are fine — that is what a family is — and they are reported in
the dedupe stats so nobody discovers the redundancy after training.

---

## 3. Volatile business truth stays out of the weights

> Model weights learn **how to sell, reason and route**.
> Governed knowledge and Core supply **what is true today**.

A price, an availability, a package, a policy, a warranty, a process or a current status is true this
quarter and wrong next. If the model memorises it, it will assert it confidently forever and there is
no way to correct it short of retraining.

So an assistant turn that asserts one must cite a `factRef` supplied by an **earlier**
`AUTHORITATIVE_CONTEXT` turn. Citing a fact that arrives later, or one that never exists, is refused.

**A customer's own statement is not Core truth.** "I got a 7 lakh quote from another company" is
something the customer said; Riya may engage with it and must not repeat it as a fact about the
business.

---

## 4. The exam cannot be in the textbook

The 72 RWC-P10 golden fixtures decide whether a Riya candidate is good enough. A model trained on them
scores well because it has seen them — and that failure is invisible from the score alone.

| Situation                                              | Result         |
| ------------------------------------------------------ | -------------- |
| Exact copy of a protected message, after normalization | **REJECT**     |
| Training id inside the protected id namespace          | **REJECT**     |
| Contiguous common run of 8+ tokens with a fixture      | **QUARANTINE** |
| 5-gram Jaccard ≥ 0.80 with a fixture                   | **QUARANTINE** |
| Same topic, different sentence                         | pass           |
| Shared 2–4 word phrase                                 | pass           |

Normalization folds case, whitespace and punctuation. It does **not** translate or transliterate:
Hindi and its English rendering are different examples.

A quarantine is a human decision, and **release requires zero unresolved quarantine**. Do not resolve
one by deleting the check.

---

## 5. Privacy and secrets

Deterministic scanning — no NER model, no classifier, no external service. A probabilistic gate would
be non-deterministic and would sometimes be wrong in the permissive direction, and a real phone number
in a training corpus is in the weights with no delete.

Rejected: email, Indian mobile number in any written form, API key, bearer token, JWT, service-role
token, private key, UPI-like handle, URL, and the governed production names.

Allowed, deliberately: `3BHK`, `10 lakh`, `1200 sq ft`, `10 x 12`, a synthetic city reference. An
interiors corpus is full of those.

**A finding reports the location and the kind, never the value.** Nothing echoes a matched secret into
a log, a report or a terminal.

---

## 6. Review

| Risk        | Independent accepted reviews |
| ----------- | ---------------------------- |
| `STANDARD`  | 1                            |
| `HIGH_RISK` | 2 distinct                   |

`HIGH_RISK` means price, discount, payment, warranty, policy, consent, human handoff, complaint,
business action, current availability, identity or privacy — the situations where a plausible-sounting
wrong reply becomes a commitment somebody has to honour.

**The author is not a reviewer.** A review whose ref matches the trajectory's `sourceRef` does not
count.

Every trajectory is reviewed on `CLARITY`, `NATURALNESS`, `CONTEXT_USE`, `NON_REPETITION`. Objection
trajectories add `EMPATHY`, `OBJECTION_HANDLING`, `TRUST_BUILDING`, `SALES_MOMENTUM`, `CTA_QUALITY`.

A review carries an opaque ref, a decision and the satisfied dimensions. **No name, email, comment,
rationale or confidence** — a note about an example quotes the example, and the reviewer's identity
must not accumulate into a performance record nobody decided to build.

> **The AI-synthetic lane.**
> [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md) §8
> adds a second review mode for teacher-generated rows. Everything above is the `HUMAN_REVIEW` mode,
> it remains the default, and its behaviour is unchanged.
>
> `AUTOMATED_SYNTHETIC` is valid **only** for `TEACHER_GENERATED_SYNTHETIC`. It replaces human reviews
> with automated acceptance evidence — it does **not** fabricate review records, and it cannot be
> selected for a human-authored row. `RIYA_DATASET_REQUIRED_REVIEWS` is **not** globally zeroed, and
> Human Gold validation is untouched.

---

## 7. Identity and integrity

Every trajectory has two digests:

- **artifact SHA-256** — the whole record, reviews included. Adding a reviewer changes it, because the
  record changed.
- **conversation fingerprint** — the language mode and the spoken text only. Adding a reviewer, a
  persona or a new id does _not_ change it, because the conversation did not. That is what lets
  duplicate detection see through relabelling.

A manifest lists one row per trajectory with both digests, sorted, plus a `manifestSha256` over
everything else. It carries **no text and no reviewer**.

SHA-256 here is **content identity and integrity, not a signature**. It proves the corpus is the one
the manifest committed to. It proves nothing about who made it, and anyone who can edit a dataset can
recompute its digest.

---

## 7a. What a release is bound to

A validation run is a **dry run** unless it is given a release policy. Dry runs are useful and are
never eligible.

A `RiyaDatasetReleasePolicyV1` carries:

| Field                        | Why                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `policyId` / `policyVersion` | Which bar this release cleared.                                                                                                           |
| `coveragePolicy`             | The exact coverage minima validation applied — bound, not passed alongside.                                                               |
| `protectedCorpusRef`         | An opaque name for the exam corpus. Never its content.                                                                                    |
| `protectedIndexSha256`       | Its digest. Validation refuses to bind if the index it was handed differs.                                                                |
| `protectedEntryCount`        | How many entries it must hold. Zero is refused: a policy expecting no exam corpus is a policy disabling the firewall, and that is an ADR. |

This is why: an absent protected index used to be substituted with an empty one, which matches
nothing, produces no finding and yields an eligible report. A release that looks clean precisely
because the check never ran.

The report then carries what actually gated it — both policy identities, the coverage policy's
digest, the protected corpus ref, its digest and its entry count — plus two of its own:

- **`validatedDatasetSha256`** — over the sorted identity of every validated trajectory. The manifest
  recomputes the same value from its records, so a report and a manifest are provably the same
  corpus. Pairing them on record COUNT let two different datasets of the same size pair cleanly.
- **`reportSha256`** — over every other report field, so an edited verdict or a deleted finding is
  detectable.

Release evidence verifies both digests, requires eligibility, recomputes the dataset digest from the
manifest, and **copies** the policy identity from the report. There is no way to name a policy the
validation did not apply.

## 8. Release

A dataset is `eligible` only when every one of these is empty: duplicate ids, lineage-split
violations, exact cross-split duplicates, cross-split near-duplicate quarantine, protected exact
leakage, protected near-leakage quarantine, privacy violations, unsupported business facts,
insufficient review, coverage shortfalls.

Eligible plus a valid manifest produces release evidence with `syntheticOnly: true` and
`trainingApproval: false`.

**Clearing the gates does not start a run.** It means the corpus is well-formed, leak-free and
reviewed. Whether to spend a training run on it is a human decision with inputs this system cannot
see.

---

## 8a. Authority consistency for business facts

Beyond "the cited fact existed earlier":

- `USE_CORE_TRUTH` needs at least one citation, and every cited fact must come from a
  `CORE_RUNTIME_SYNTHETIC` context.
- `USE_GOVERNED_KNOWLEDGE` needs at least one, all from `GOVERNED_KNOWLEDGE_SYNTHETIC`.
- Any other decision may cite **nothing**. An annotation that cites a fact while claiming it did
  something else does not describe what it did.
- A reply that makes a high-confidence volatile claim — an explicit company price, a warranty term, a
  service-availability statement, a refund or cancellation commitment, a current-status assertion —
  must cite a fact of the matching class, whatever its decision.

The claim scanner reads assistant text only and is deliberately narrow. `PACKAGE`, `PROCESS` and
`OTHER_BUSINESS_FACT` are not detected: their language is not separable from ordinary conversation,
and a gate that fired on "budgets in that range vary" would be switched off within a month.

## 9. What is not authorized yet

- **Real conversations.** Not discouraged — not representable. There is no source kind for them.
- **Any training framework.** No PyTorch, PEFT, LoRA, QLoRA, TRL, tokenizer or checkpoint.
- **Preference pairs / DPO.** After an SFT baseline exists and evaluation justifies it, never before.
- **A chosen base model.** A later benchmark picks it; the dataset is model-independent.

A future live-conversation flow would be separately authorized and would look like:

```
live conversation → privacy + consent → redaction → candidate example
  → human review → dataset release → training → P10 → shadow/canary → owner rollout
```

Never `LIVE CHAT → TRAIN`.

> [ADR-0143](../decisions/ADR-0143-riya-ai-synthetic-training-lane-and-automated-quality-gate.md)
> authorizes the AI-synthetic lane at the **governance** level only. Still not authorized by it:
> generation, corpus content, benchmarking, training, certification and activation — and it does not
> change the live-conversation rule above. Fully AI-only evaluation does **not** authorize
> `LIVE CHAT → TRAIN`; that path still needs its own privacy, consent and redaction governance even if
> its review step later becomes automated.
