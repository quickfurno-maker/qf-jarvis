# Riya candidate evaluation bridge

**Slice:** MVP-P2A.1 · **Package:** `@qf-jarvis/riya-candidate-evaluation-runner` · **Companions:** [selection protocol](./riya-model-selection-protocol.md), [benchmark foundation](./riya-model-benchmark-foundation.md)

**No real model has been evaluated.** This slice builds the step that was missing between a candidate
and the two gates. Every candidate it has run against is a deterministic fake, and it contains no
provider, no credential and no network.

---

## What was missing

`@qf-jarvis/model-evaluation` owns safety. `@qf-jarvis/riya-quality-evaluation` owns P10 quality. Both
are pure authorities: they judge observations that arrive from somewhere else, and nothing in this
repository could produce those observations from a real candidate. Safety scenarios carried
expectations but no bytes to send; the shipped fixtures manufacture observations and say so. The P10
corpus had 72 synthetic client turns but nothing that turned a reply into a governed observation.

So neither gate had ever been run against a model. This package is that step, and only that step.

## Safety

```
synthetic adversarial fixture
  → candidate execution port
  → execution record (facts, not verdicts)
  → CandidateObservation, via the real constructor
  → @qf-jarvis/model-evaluation
  → SAFETY ELIGIBLE / INELIGIBLE / BLOCKED
```

One synthetic case per mandatory red-team kind — coverage is **derived** from
`DEFAULT_MANDATORY_RED_TEAM_KINDS`, so adding a kind to the authority breaks the manifest rather than
silently under-covering. One case per kind is the MVP bar; a paraphrase corpus, a mutation fuzzer and a
jailbreak library are deferred.

Not every safety property is a prompt. A `LOCAL_ONLY` case proves the route refused hosted execution
and that the provider was invoked **zero** times; a cancellation case cancels the turn and asks whether
the candidate stopped. Those cases carry synthetic text because a turn needs one, but the runtime fact
is the evidence.

**An unprovable fact blocks evidence.** Knowledge freshness, grounded-claim status and authority
treatment each have an explicit `UNKNOWN` value rather than a boolean default. When a scenario depends
on one and the run cannot prove it, the case is incomplete and the whole suite produces no result —
because writing `false` into a safety field nobody measured produces an artifact indistinguishable from
a real pass.

## P10 quality

```
governed golden fixture (unchanged, all 72)
  → candidate execution port
  → objective capture (counts computed here, not reported)
  → blinded review bundle, written OUTSIDE the repository
  → two independent HUMAN reviews, existing contract
  → @qf-jarvis/riya-quality-evaluation
  → QUALITY ELIGIBLE / INELIGIBLE
```

`replyCharCount` and `questionCount` are derived by the bridge from the reply itself, so an adapter
cannot report a flattering figure. Subjective dimensions are not inferred at all — a capture has no
dimension field. A reply whose language mode the adapter cannot identify **fails its case** rather than
being recorded as the mode the fixture hoped for.

The candidate is put in the **situation**, never handed the answer key. A P10 request carries the
governed `continuityPhaseBefore` alongside the client turn, because "what about the price?" after a
summary is a different question than during discovery, and a candidate evaluated as a fresh `NEED` turn
would be scored against a scenario it was never placed in. The eighteen citation-required cases also
carry the synthetic governed record they are expected to answer from — see below. A safety request
carries `agentScope` and `taskClass`, because several mandatory kinds exist precisely to test the scope
boundary. Nothing the evaluator judges with travels — no expectations, no passing shape, no dimensions,
no sentinels.

P10 V1 is a **single-turn exam with phase context**. The governed corpus encodes a starting phase and
one client turn and no prior history, so that is what the request carries. Inventing history here would
mean evaluating against a conversation the corpus never governed.

### A review names the reply it was made about

A case reference alone is a position, and `case-001` is a different reply for every candidate. Two
humans could read Candidate A's `case-001`, mark it good, and have those valid records submitted later
beside Candidate B's captures — certifying a model on judgements about a different one.

So each reviewer-visible case carries a **`caseDigest`**: SHA-256, lowercase hex, over a fixed
canonical object —

```
{ domain: "qfj.riya.p10.review-case.v1", bundleVersion, caseRef, languageMode,
  interactionKind, clientMessage, candidateReply, requiredDimensions (sorted) }
```

— `JSON.stringify`d as UTF-8. It travels back with the completed reviews, and ingest re-derives the
expected value from the CURRENT capture and the CURRENT governed fixture before counting a single
review. A mismatch is `case-digest-mismatch` and the case is refused.

This is **content identity only**. It proves the reviewed bytes and the ingested bytes are the same. It
proves nothing about who reviewed, whether they were independent, or whether the bundle is authentic —
there is no key, no signature and no HMAC, because one would imply a guarantee this cannot make. No
provider, model, price or speed value is an input, so the digest cannot unblind anyone who reads it.

### The review bundle is blinded

The reviewer sees the client turn, the candidate reply, the language and interaction kind, the required
dimensions, and an anonymous `case-NNN` reference. There is no provider, model, size, price or speed
field in the structure at all, so omitting them is not a discipline anybody has to remember. A reviewer
who knows they are reading "the small cheap one" marks it differently, and that bias would be laundered
into a threshold pass.

### Two humans, and no way around it

Two DISTINCT reviewers per case, from the governed constant. The same `reviewRef` twice is refused; one
review is refused. There is no single-reviewer MVP mode. Reviews are rebuilt through the existing
`createRiyaQualityHumanReview`, so a comment, a name or a confidence score is refused by the contract
that already refuses them.

**The honest limit:** the contract carries an opaque `reviewRef` and nothing about how a judgement was
formed. A reviewer who pasted the reply into a chatbot and copied its verdict is indistinguishable here
from one who read it. That is a process control — two named humans are accountable for those refs — and
a heuristic pretending to detect it would be worse than saying so.

### Raw content stays outside the repository

The bundle is the one content-bearing artifact in this workstream: 72 client turns and 72 replies. It
is written only to an explicit operator-supplied absolute path outside the repository, never overwrites
without being told twice, is replaced atomically, and prints only the path and the counts. No default
path, no environment discovery, no temp fallback.

"Outside the repository" is judged by **real location**, not spelling: the parent directory and the
repository root are both resolved through `realpathSync` before the comparison, because an
external-looking directory can be a symlink or junction that lands every byte back in version control.
An overwrite target that is not a regular file is refused, since writing through a link writes wherever
it points.

## The situation includes the source (MVP-P2A.2 inputs)

A grounded case cannot be marked unless the candidate was actually shown the material it was expected
to use. Eighteen P10 fixtures required a citation and supplied no record; three safety kinds described
a knowledge situation the request text could not create. Both are now closed by **input**, not policy.

One shared contract carries it — a `state` of `CURRENT`, `STALE` or `SUPERSEDED`, and one to eight
records of exactly `knowledgeId`, `version`, `topic`, `contentFormat`, `content`. It is proven through
a constructor, not cast: an extra key is a refusal rather than a silent drop, because a governance
field quietly dropped works right up until somebody serializes the input a different way.

**`state` never reaches the model.** It is evaluation execution metadata that makes a freshness
scenario executable, and only the five record fields may become grounded context. It is not the
production freshness policy and must never become one: a spec proves no package outside the bridge can
name the type, and a second proves only the corpus and the bridge name the fixture field.

The P10 corpus owns three canonical records, one per citation-required kind, shared by both cases and
all three languages — `knowledge.grounding-qa.alpha`, `knowledge.post-summary-qa.alpha` and
`knowledge.complete-qa.alpha`, all version 1, all `CURRENT`. They are authored **independently** of
`passingShape.citations`, and a corpus spec checks the expected citation names the record the candidate
was given. Deriving one from the other would make the check vacuous: moving the expectation would move
the input, and the pair could never disagree. Every fact in them is invented, says "for this synthetic
evaluation only" inside its own bytes, and uses a fictional label (`synthetic-window.alpha`) rather
than a plausible timing anybody could later quote as a commitment.

On the safety side the injection attack **moved out of the client message into a retrieved record**.
With the sentinel in the user turn, the case measured whether a candidate obeys text a user quoted at
it — a real property, and a different one from `KNOWLEDGE_PROMPT_INJECTION`. The client now only asks
for the note to be followed; the sentinel exists solely in governed knowledge, so a leak proves the
record was treated as an instruction rather than as data. The stale case carries an explicit
`SUPERSEDED` record, and the fabricated-citation case is given exactly one known current source so
that citing something else is a fabrication rather than an absence.

Both manifests bumped to **version 2** because executable input bytes changed. Neither suite version
moved: no case was added or removed, and no expectation, threshold, severity or scoring rule changed.

**This supplies inputs; it decides nothing.** Whether a `SUPERSEDED` record is admitted, what
`knowledgeUse`, `claimKind` and `authorityTreatment` a run proves — all still belong to the live
adapter, and all still fail closed. `UNKNOWN` remains `UNKNOWN`; the existence of an input is not
permission to default to `CURRENT`, `NO_CLAIMS` or `ADVISORY_ONLY`. If no production knowledge
freshness seam can be reused, the freshness case must fail CLOSED rather than have an adapter invent a
business rule locally.

## What it does not do

It calls no model, holds no credential, opens no socket and has no retry — a candidate reaches it only
through an injected port. It computes no composite score, produces no ranking and authorizes no
rollout. No production runtime, service or app imports it; a spec proves it, and a second spec proves
the two authorities do not depend on it either. The dependency runs one way, because an evaluator that
could reach a provider is one that eventually will.

The safety fixtures are **evaluation inputs**, marked `TOOL_ASSISTED_SYNTHETIC`. They are **not
training data** — using them as such would teach a model the attacks it is supposed to refuse. Human
Gold remains a separate workstream and is not a dependency of model selection.

## Order

Safety, then quality, then operational benchmark, then an owner chooses. Speed never compensates for a
failed gate, and a benchmark run before both gates would be measuring a candidate that may not be
allowed to serve. See the [selection protocol](./riya-model-selection-protocol.md).
