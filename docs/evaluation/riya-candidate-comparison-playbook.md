# Riya candidate comparison playbook

**Slice:** RWC-P10 · **Decision:** [ADR-0106](../decisions/ADR-0106-rwc-p10-riya-quality-evaluation-and-sales-optimization.md) · **Companions:** [rubric](./riya-quality-review-rubric.md), [prompt optimization](./riya-prompt-optimization-playbook.md)

How to answer "is this candidate better than what we have?" without fooling ourselves.

---

## 1. What a fair comparison requires

Two quality results are comparable only when **all** of these match exactly:

| Field                         | Why                                                              |
| ----------------------------- | ---------------------------------------------------------------- |
| `qualitySuiteId` / version    | Different suites ask different questions.                        |
| `fixtureManifestId` / version | A candidate measured on easier fixtures will always look better. |
| `thresholdsId` / version      | Eligibility means nothing if the floors moved.                   |
| `evaluatorImplId` / version   | A changed evaluator changes what a rate means.                   |
| `capabilityProfileRef`        | Decides what the candidate was allowed to do.                    |
| `knowledgeRevision`           | Decides what a correct grounded answer even is.                  |
| `policyContractRevision`      | Decides what a permitted answer even is.                         |

These MAY differ, and are exactly what a comparison exists to vary:

- provider, model id, model version, release id, config digest, execution class;
- prompt family, prompt version, prompt digest.

Anything else differing returns `NOT_COMPARABLE`, and no deltas are published — numbers between
incomparable runs get read anyway, and they mean nothing.

---

## 2. The four comparisons this supports

### Old prompt vs new prompt

Same model, same fixtures. Changed system bytes produce a new `promptVersion` and a new
`promptDigest`, which is what makes the two runs distinguishable at all. See the
[prompt optimization playbook](./riya-prompt-optimization-playbook.md).

### Old model vs new model

Same prompt, same fixtures. Both candidates need their own generic safety evidence first — a new model
is a new release, and quality cannot be measured for a release that has not passed safety.

### Hosted today vs local later

`executionClass` differs, and that is fine: it is part of the release identity, not part of the parity
key. The comparison is honest as long as capability, knowledge and policy are the same. Note that
`LOCAL_ONLY` and `HUMAN_ONLY` data classes are a separate concern owned by the gateway and the policy
contract, not by this comparison.

### Provider A vs provider B

Same model family on two providers is the easiest case, and the one where a single score is most
tempting and most misleading — providers differ in verbosity and register far more than in
correctness, so `CONCISION` and `NATURALNESS` move while `CONTEXT_USE` does not.

---

## 3. The rule

Both eligible:

- **`CANDIDATE_PREFERRED`** — no dimension is lower than baseline, AND at least one improves by ≥ 250
  basis points.
- **`BASELINE_PREFERRED`** — the same, in reverse.
- **`TIE`** — anything else. Including a candidate that improved a lot and regressed a little.

One eligible, one not: the eligible one wins outright. A threshold breach is a gate somebody set
deliberately, and no amount of per-dimension movement should argue past it.

Neither eligible: **`NOT_COMPARABLE`**. Ranking two failing candidates invites shipping the less bad
one.

### Why a single basis point blocks preference

Because the alternative is a tolerance, and a tolerance is where the bad trade lives.

A prompt tuned for momentum will almost always improve `SALES_MOMENTUM` and `CTA_QUALITY` while quietly
costing `EMPATHY` or `TRUST_BUILDING`. Every scheme that adds the numbers up approves it. This one
returns `TIE` and puts the trade in front of a person.

The comparator still **reports** the improvement. It withholds preference; it does not hide what moved,
because a human deciding whether to accept a trade needs to see both sides of it.

### Why 250 basis points

Below that is inside the noise of a corpus judged by people. On 24 applicable cases one case is 417
bps, so a smaller threshold would let one reviewer changing their mind read as a model improvement.

---

## 4. Quality, latency and cost are not one number

This package measures quality only. Latency, token cost, throughput and reliability are real and
matter — they live in the model gateway's own signals and in the pilot's operational data.

Do not collapse them into a composite. A composite lets a 30% cost saving buy a `TRUST_BUILDING`
regression, and nobody making that decision would defend it if it were stated out loud. Put the
quality comparison and the cost comparison side by side and decide explicitly.

---

## 5. Procedure

1. Confirm both candidates hold current generic safety evidence at an eligible target.
2. Derive a quality candidate binding for each **from that evidence**. Do not hand-write release or
   prompt identity — there is no path to, and that is deliberate.
3. Generate candidate outputs externally against the **same 72 fixtures**.
4. Normalize to objective observations. No raw reply text enters the harness.
5. Collect two independent human reviews per case, per candidate. Reviewers should not know which
   candidate they are reading.
6. Evaluate both suites.
7. Compare under `riya-quality-comparison-v1`.
8. Read the per-dimension deltas, not just the outcome.
9. A rollout decision, if any, is a separate PR with an owner in the loop. This package activates
   nothing.

---

## 6. Reading a result honestly

- `TIE` with a large improvement and a small regression is the interesting case. Look at **which**
  dimension regressed. A `CONCISION` dip for a genuinely clearer answer may be an acceptable trade; a
  `TRUST_BUILDING` dip almost never is.
- A dimension only one side measured is skipped rather than treated as zero. If that happens, the two
  runs used different coverage and the comparison is weaker than it looks — check why.
- `qualityEligible: true` means the suite cleared its floors. It does **not** mean the candidate is
  good enough to serve clients; that is a business decision with more inputs than this.
