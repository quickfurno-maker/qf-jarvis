# ADR-0106 — RWC-P10: Riya quality, evaluation and sales optimization

- **Status:** Accepted — RWC-P10 implementation on branch, NOT MERGED
- **Date:** 2026-08-09
- **Depends on:** ADR-0052 (the evaluation and red-team foundation), ADR-0073 (prompt content
  digests), ADR-0098/0099 (RWC-P4A/P4B), ADR-0100 (RWC-P5), ADR-0101/0102 (RWC-P6),
  ADR-0103 (RWC-P7), ADR-0104 (RWC-P8), ADR-0105 (RWC-P9)
- **Baseline:** RWC-P9 merged as PR #110 — merge commit
  `192e4a9ec90fcb77f4866357fd7a681acb40cb93`. Migrations `0001`–`0012`. **RWC-P10 adds none.**

RWC-P10 is the INTERNAL Riya quality, evaluation and sales-optimization slice. It is **not** canonical
QFJ-P10, which is Core Integration and Reconciliation.

## Context

Nine slices built a Riya that is correct, governed, idempotent and observable. None of them can answer
the question a business actually asks: **is it any good?**

Generic safety evaluation already exists and works. `@qf-jarvis/model-evaluation` scores pre-supplied
candidate observations against synthetic fixtures for prompt injection, secret leakage, scope
separation, business authority, citation discipline and the rest, and it produces immutable approval
evidence. What it deliberately does not know is anything Riya-specific: whether a Hindi client got a
Hindi answer, whether three facts in one message were all captured, whether a price objection was met
with empathy or with a discount nobody authorized.

Those are different questions, and one of them cannot be answered by a machine at all.

## Decision

### 1. RWC-P10 is not canonical QFJ-P10

Canonical QFJ-P10 is Core Integration and Reconciliation. This slice continues the Riya customer
journey under canonical QFJ-P06 and deploys nothing.

### 2. `@qf-jarvis/model-evaluation` remains the generic safety authority

This package builds ABOVE it and reimplements none of it: no second red-team suite, no second prompt
digest system, no second release identity, no second safety evidence, no second rollout bridge.

### 3. Generic safety evidence is mandatory, and enforced structurally

A quality candidate binding is DERIVED from an `ApprovalEvidence`. The caller cannot supply a release,
a provider, a model, a prompt family, a prompt version or a prompt digest — every one is copied out of
the evidence.

That turns "safety first" from a rule into a property of the type system, and it closes a specific
drift: a candidate that passed safety on one prompt cannot be measured for quality on another.

### 4. Only behavioural safety targets qualify

`ACTIVE_MODEL_RELEASE`, `SHADOW_ELIGIBILITY` and `CANARY_ELIGIBILITY` are accepted.

`CONNECTIVITY_SMOKE` is refused: it says only that a transport reached a provider and got a well-formed
response, so layering sales-quality measurement on it would produce an artifact that looks like a
certified candidate and rests on evidence that a socket opened.
`SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` is refused because it is research evidence for a capability
this repository has deliberately not enabled.

The evidence must additionally be `synthetic: true` / `productionApproval: false`, so quality evidence
cannot launder a production authority it was never granted.

### 5. Safety can never be compensated by sales quality

There is no path by which a quality result relaxes, overrides or substitutes for a safety verdict. A
release that fails generic safety has no quality binding at all, and the most beautifully warm,
perfectly concise Riya in the world does not acquire one.

### 6. No model is invoked. Ever.

No gateway, no provider, no Groq, no OpenAI, no Anthropic, no local inference, no HTTP, no n8n. The
evaluator accepts PRE-SUPPLIED normalized observations and HUMAN annotations, and a containment spec
proves the capability is absent rather than merely unused.

### 7. No LLM-as-judge, and this is the most important decision here

Subjective sales quality is judged by people.

An LLM judge shares the failure modes of the model it grades: the same verbosity preference, the same
politeness bias, the same blind spot for a confidently invented warranty. It would systematically
approve the answers it would itself have given. Using a model to certify a model is a closed loop with
no outside reference — and the number it produces looks exactly as authoritative as a real
measurement, which is what makes it dangerous rather than merely useless.

No model voting, no scoring prompt, no evaluator prompt, no rubric fed to an inference call.

### 8. Exactly two independent human reviews, and BOTH must agree

A required dimension passes only when both reviewers marked it satisfied. One reviewer is one person's
taste. A disagreement is a FAIL rather than a tie-break: if two trained people reading the same rubric
cannot agree a reply was empathetic, it was not clearly empathetic. A missing second review makes the
case INCONCLUSIVE — not a soft pass and not a soft fail, because nothing was measured.

No averaging, no confidence, no weighting of one reviewer over another.

### 9. A review carries a judgement and nothing else

An opaque `reviewRef` and a set of satisfied dimensions. No name, no email, no account id, no comment,
no free text, no explanation, no chain of thought.

Comments are excluded for a reason rather than for tidiness: a reviewer's note about a reply quotes
the reply, and a quoted reply is conversation content entering an artifact that is retained, copied
and read by people who never saw the privacy contract. The rubric exists so the judgement can be made
without writing the reason down here.

The case result carries no `reviewRef` at all. Across a full corpus that would be a performance record
of named people, assembled as a side effect of measuring a model.

### 10. Objective correctness is kept separate from subjective quality

Objective means countable or set-membership: language mode, reply length, question count, expected and
forbidden canonical observations, asked-field discipline, required citation, allowed continuity phase.
Nothing there involves judgement, so nothing there can be argued with.

Keeping the two vocabularies apart is what stops a subjective disagreement from being recorded as a
contract violation, and stops a contract violation from being argued away as a matter of taste.

### 11. The evaluator does not re-derive Riya

It checks an OBSERVED result against a fixture author's stated expectation. It does not recompute
RWC-P4A phase transitions, RWC-P4B merge precedence or RWC-P5 availability. An evaluator holding its
own copy of the reducer would, the day the two disagreed, report a model failure for a reducer change.

### 12. A scenario may never expect `user_confirmed`

Only `user_stated` and `model_inferred` are expectable. `user_confirmed` means the client was shown a
value and agreed to it — an act only the surface can witness — and `user_selected` and `server_runtime`
are likewise not things a model produces. A fixture that expected any of them would let a passing suite
certify a Riya that manufactures consent it never received.

### 13. Per-dimension thresholds in basis points. No global score.

Ten independent floors, integer basis points, `Math.floor` division. No average, no weighted total, no
star rating, no "overall quality" number anywhere in the package.

A single score is the standard way this kind of system fails. A candidate that becomes noticeably
pushier but slightly clearer improves its average, and the average is what a rollout decision reads —
so the regression ships. Per-dimension gates make that impossible to express.

Canonical V1: `CLARITY` 9500, `CONCISION` 9000, `NATURALNESS` 9000, `CONTEXT_USE` 10000, `EMPATHY`
8500, `OBJECTION_HANDLING` 9000, `TRUST_BUILDING` 9000, `SALES_MOMENTUM` 9000, `CTA_QUALITY` 9000,
`NON_REPETITION` 10000. Objective failures and inconclusive cases are both capped at ZERO.

`CONTEXT_USE` and `NON_REPETITION` sit at 100% because both describe the same failure — a Riya that
ignores what the client already said — and that is the most damaging thing a sales conversation can
do. `EMPATHY` sits lowest because it is the most reviewer-sensitive of the ten, and a floor above the
measurement's own agreement rate would block every candidate forever.

### 14. A gated dimension with no coverage is a HOLE, not a pass

Otherwise the easiest way to clear a floor would be to delete every case that exercised it.

### 15. Candidate comparison is Pareto and no-regression

Comparable only when the suite, fixtures, thresholds, evaluator, capability profile, knowledge revision
and policy revision all match. Provider, model, release and prompt MAY differ — that is what a
comparison is for.

A candidate is preferred only if NO dimension is lower and at least one improves by 250 basis points.
A one basis point regression in any dimension withholds preference — not because one basis point
matters, but because the alternative is a tolerance, and a tolerance is where "slightly pushier, much
clearer" gets approved. Neither eligible is `NOT_COMPARABLE` rather than a ranking of two failures.

### 16. Quality evidence is synthetic, and it activates nothing

`synthetic: true` and `productionApproval: false` are literals in the type. There is no rollout bridge
and no promotion path: `@qf-jarvis/model-evaluation` has one because generic safety evidence is what a
rollout ladder consumes, and sales quality must never become an activation signal. A Riya that is
measurably warmer is not thereby authorized to serve anybody.

### 16a. Every artifact is re-proved before it is used or ranked

Owner correction on PR #111. Three narrow holes, each of which let an unverified artifact reach a
place that reads as a verdict.

**Generic safety evidence is re-proved in full.** The whole artifact must have exactly an
`ApprovalEvidence`'s own keys; the nested binding is RECONSTRUCTED through
`createEvaluationBinding` — the generic package's own constructor, so its strict schema, identifier
grammar and wildcard refusal all apply — and the reconstructed value is what quality identity is
copied from. Digests must be lowercase hex of the exact width `contentDigest` emits, `createdAt`
must be a canonical UTC instant, and `evaluationRef` must equal
`evref-${contentDigest({target, release: releaseKey(binding.release), suiteResultDigest})}`, its own
content's reference. Previously a shallow surface check passed and `binding: {}` was copied straight
through.

**The candidate binding input is exact.** A direct `promptDigest`, `release` or `modelId` key is
refused rather than ignored. The value was always correct — the evidence decided — but a caller who
believed they had overridden a release would have been wrong and never told.

**The quality result digest covers the whole result.** One shared preimage — binding, case-set
digest, outcome counts, objective failure count, all three per-dimension tables, threshold breaches
and `qualityEligible` — used by the evaluator that produces it and by every consumer that checks it.
The evidence gate previously verified only the case set, so a result with lifted rates, erased
breaches and a flipped eligibility flag produced evidence.

**The comparator refuses to rank an unproved artifact.** Both inputs are re-proved before anything
else; either failing throws `quality-digest-invalid` and no comparison result exists. A verdict about
a measurement that never took place is worse than no verdict.

**Every valid comparison is content-bound.** `baselineCandidateRef`, `candidateRef` and a
deterministic `comparisonDigest` over the policy, both refs, both parity identities and every verdict
field — including on a `NOT_COMPARABLE` result, which is still a real statement about two real runs.

**Nested re-proofs are strict.** The full human review and the full observation batch are passed to
their owning constructors, so `.strict()` sees unknown keys instead of them being stripped. A review
carrying a `comment`, `name`, `email`, `confidence` or `explanation` is refused.

**What this is not.** Canonical structure and self-consistency validation, not a cryptographic trust
root. `contentDigest` is a non-cryptographic FNV-1a identity hash; there is no signature, no key and
no evidence registry, and somebody who can run this code can compute a consistent reference for
evidence they invented. It reliably catches truncation, partial deserialization, single-field edits
and stale bindings — and claiming more would be the overstatement this package refuses everywhere
else.

### 17. Sales optimization has a boundary

It means understanding the need, answering the concern, building appropriate trust, keeping momentum
and proposing a clear next step.

It does **not** mean fake urgency, manufactured scarcity, guilt, fear, deceptive discounts, invented
savings, invented prices, invented warranty, unauthorized business claims, or continuing to push after
somebody asked for a human. Generic safety evidence remains the authority for authority violations;
reviewers mark manipulative behaviour unsatisfied under `EMPATHY`, `TRUST_BUILDING` and `CTA_QUALITY`,
and the `HUMAN_REQUEST` fixtures deliberately require neither `SALES_MOMENTUM` nor `CTA_QUALITY`.

### 18. The corpus is versioned, symmetric and synthetic

72 fixtures: 3 language modes × 12 interaction kinds × 2 cases. 24 English, 24 Hindi, 24 Hinglish.

Hinglish is a first-class mode, not degraded English. A large share of Indian clients write it, and an
evaluator that scored it as broken English would reward a Riya that answered the wrong way.

Everything is invented — `service.alpha`, `city.beta`, `property.apartment`. No real QuickFurno
package, price, lead, customer, vendor or transcript; no phone, email, address or production URL. Raw
text exists only under the `./testing` subpath and is never reachable from a production import.

### 19. Overfitting governance

Golden V1 is **immutable after merge**. Correcting a fixture bumps the manifest version; adding or
removing a case bumps the suite and manifest version. **A case is never deleted because a candidate
fails it** — that is not a corpus fix, it is a measurement being edited to match the answer.

Future real optimization should keep a held-out set, and held-out answers must never enter the prompt
authoring loop.

### 20. This makes Riya quality MEASURABLE — it certifies nothing

The framework and the golden corpus are implemented here. **Real candidate quality evidence is NOT
generated in this PR.** No real model or prompt has been run against this suite, no human reviews of
real outputs exist, and the synthetic PASS observations test the evaluator against its own fixtures and
nothing else.

Any statement that Riya "passes" the quality suite would be a fabricated performance claim.

### 21. No runtime integration

No change to `jarvis-runtime`, `riya-model-interaction`, `riya-web-conversation-service`,
`model-reply-adapter`, `model-gateway`, `prompt-registry`, `governed-knowledge`, or any RWC-P4 to
RWC-P9 production package. No runtime `qualityRef`, no prompt change, no `evaluationRef` change, no
provider selection. No migration, no managed database access, no live WhatsApp, no provider or n8n
activation, no QuickFurno repository access.

### 22. Scope boundaries

Canonical QFJ-P11 owns pilot and scale deployment. Prompt authoring, model selection and rollout remain
human decisions taken in separate PRs that read this evidence as one input among several.

## Consequences

- Riya has a rigorous multilingual quality measurement system, symmetric across English, Hindi and
  Hinglish.
- Subjective sales quality is human-reviewed and cannot be self-certified by a model.
- Generic safety evidence is a structural precondition rather than a convention.
- Provider, model and prompt candidates compare on identical fixtures, and one improved dimension
  cannot hide another's regression.
- Nothing is activated, promoted or deployed, and no claim is made about the current model.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- `@qf-jarvis/model-evaluation` remains the generic safety authority, and quality is derived from its
  evidence;
- no model call, no LLM-as-judge, no model voting, no scoring prompt;
- exactly two independent human reviews, both must agree, no free text in an annotation;
- objective correctness stays separate from subjective quality;
- per-dimension basis-point thresholds with no global average;
- Pareto/no-regression comparison over identical fixtures, thresholds, capability, knowledge and
  policy;
- quality evidence is synthetic, non-production-approving, and bridges to no rollout;
- safety evidence is re-proved in full and its nested binding reconstructed through the generic
  constructor; the result digest covers the whole result; the comparator ranks nothing it cannot
  verify; and every valid comparison carries both candidate refs and a comparison digest;
- golden V1 is immutable, and a failing case is never deleted;
- no runtime, prompt, binding, migration, deployment or QuickFurno change.
