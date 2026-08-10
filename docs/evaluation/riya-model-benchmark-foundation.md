# Riya model benchmark foundation

**Slice:** RMB-A · **Package:** `@qf-jarvis/riya-model-benchmark` · **Companions:** [model selection protocol](./riya-model-selection-protocol.md), [candidate comparison playbook](./riya-candidate-comparison-playbook.md)

**No model has been benchmarked.** This slice builds the contracts and the evidence tooling. Nothing
here contains a measurement of any real model, engine or configuration, and nothing here recommends
one.

---

## What this package is

The third and narrowest of three evidence authorities.

| Authority       | Package                              | Owns                                                            |
| --------------- | ------------------------------------ | --------------------------------------------------------------- |
| Safety          | `@qf-jarvis/model-evaluation`        | generic safety and red-team evidence                            |
| Quality         | `@qf-jarvis/riya-quality-evaluation` | Riya sales-conversation quality (P10)                           |
| **Operational** | `@qf-jarvis/riya-model-benchmark`    | latency, decode speed, request success, memory, reproducibility |

They are separate on purpose, and the separation is the point rather than an artifact of how the code
grew.

## Why there is no single number

The obvious next step from three sets of numbers is one weighted score. It is also the mistake this
design exists to prevent.

Latency, quality and safety have no shared unit. A weighting that combines them is a business
judgement, and once it is expressed as arithmetic it stops looking like one — a fast model with a bad
refusal rate outranks a slower correct one, and the ranking is defensible because the spreadsheet says
so. Worse, the weights get chosen once, by whoever built the dashboard, and are never revisited.

So this package exports no `overallScore`, no `weightedScore`, no winner, no recommendation and no
approval. A spec asserts that none of those words appears anywhere in the public surface.

## Performance is not quality, quality is not safety, and none of the three is permission to ship

Stated plainly because each is a separate claim and all three get conflated under time pressure:

- **A fast model is not a good model.** Decode speed says nothing about whether the reply was correct,
  grounded, or appropriate to the customer.
- **A good model is not a safe model.** P10 measures sales-conversation quality, not refusal
  behaviour under adversarial input.
- **A safe, good, fast model is still not approved.** Rollout is a separate decision with a separate
  owner, and no artifact from any of the three packages authorizes it.

Every benchmark artifact carries `syntheticWorkload: true` and `productionApproval: false` as
literals. There is no way to construct one that says otherwise.

---

## What an artifact contains

**Subject** — what was measured. The release identity is `ProviderReleaseRef`, reused from
`@qf-jarvis/model-evaluation` and validated by that package's own constructor. Plus prompt family,
version and **digest**, capability profile, knowledge revision, policy contract revision.

One release grammar in the repository, not two. Benchmark evidence and safety evidence exist to be
read together — "this release cleared safety AND runs at this latency" — and two packages with their
own idea of what names a release would eventually disagree by a character, at which point neither
statement can be joined to the other.

**Environment** — enough to compare, without a dedicated field for anything identifying. Architecture
family, accelerator family and count, memory, runtime engine and config digest. There is no field for
a hostname, username, path, serial, MAC, IP or credential, and `.strict()` refuses an extra one.

The honest limit: `acceleratorRef`, `runtimeEngineId` and `runtimeEngineVersion` are opaque
identifier-shaped fields, and a determined caller could put something meaningful in one. The grammar
keeps out URLs, paths and email addresses; it cannot keep out a machine name that looks like an
identifier. Keeping those non-identifying is authoring and harness governance. Closing the gap in code
would need a closed hardware registry, which this slice does not build — and claiming the stronger
guarantee without one would be the overstatement this package exists to avoid.

`HOSTED_OPAQUE` claims no hardware at all, and is forbidden from doing so. An invented accelerator
count is worse than an absent one: absent is a known unknown, invented is a number somebody will later
compare against.

**Workload** — counts and digests. Suite, harness, case id, prompt profile **digest**, input tokens,
output cap, concurrency, batch size, warmup and measured counts, streaming, sampling config digest,
measurement policy. Zero raw text, structurally.

**Observation** — pre-supplied normalized metrics. Request counts, token totals, latency and decode
percentiles in micros, optional peak memory in bytes. Integers only.

**Evidence** — all four, bound, with a SHA-256 digest over the whole artifact and an injected
canonical `createdAt`.

## The observation checks that matter

A broken harness does not produce obviously wrong numbers. It produces plausible ones.

- **Requests must balance.** `successful + failed === attempted`.
- **Percentiles must be ordered.** A p95 below its p50 is swapped fields, not a fast tail.
- **A run with zero successes cannot claim latency.** This is the important one. Total failure
  produces the most flattering numbers a harness can emit — instant time-to-first-token, because
  there were no tokens — and read six months later, out of context, it looks like the fastest
  configuration anyone tried. A total-failure run is still _representable_; it just has no latency.
- **Tokens and decode speed must agree** about whether output happened.

## Comparison: parity or nothing

Two result sets compare only when they measured the same thing — same suite, harness, cases, prompt
profile, token settings, concurrency, batch, warmup and measured counts, streaming mode, sampling
config and measurement policy.

They may differ in exactly what a benchmark exists to vary: model, release, provider, execution class,
environment, runtime engine, quantization.

When parity breaks the comparison returns the **named axes**, not a delta with a caveat. A latency
comparison across different concurrencies is two unrelated numbers subtracted, and reporting it with a
footnote means somebody eventually quotes it without one.

### There is no summary, and a Pareto relation was removed to keep it that way

An earlier draft returned `A_DOMINATES` / `TRADEOFF` / `EQUIVALENT`. It is gone.

Dominance needs every axis present on both sides, and memory is optional. An unmeasured axis silently
drops out of the relation, so `EQUIVALENT` could mean "equal on the axes we happened to share" — a
stronger claim than the data supports, phrased as a finding about two configurations when it is
really a finding about what the harness recorded.

What comes back is per-case, per-axis, side-by-side deltas over the axes **both** sides measured. An
axis absent from the deltas was not compared. Reading the table is the owner's job, and it should not
be automated away.

### Both inputs are verified before anything is read

Not integrity-checked — **verified**: every member deeply reconstructed, homogeneity and manifest
re-established, both digests recomputed. Only the reconstructions are used.

A comparison that reads an untrusted object is the most dangerous function in a package like this: its
output looks exactly like a real answer, and it is the thing somebody pastes into a decision. An
invalid input therefore produces no comparison object at all.

## Verification, not hash comparison

`sha256OfCanonical` is unkeyed. Anyone who can edit an artifact can recompute the digest over the
edit, so a self-consistent hash proves only that the body and the digest were written by the same
hand — **hash self-consistency is not schema validity**.

So `verifyRiyaBenchmarkEvidence` and `verifyRiyaBenchmarkResultSet` reconstruct: full canonical
surface required, unknown keys refused, every nested object rebuilt through its own constructor,
cross-field invariants re-proved, digests recomputed from the reconstruction. An attacker who
recomputes the digest over a structurally impossible artifact still fails, because the artifact never
survives reconstruction.

Neither verifier restamps. A stored artifact without a digest is refused rather than signed, because
stamping it would turn a verifier into a laundering step.

## A result set is one configuration

Every case in a set must agree on the entire canonical subject and the entire canonical environment —
`RESULT_SET_SUBJECT_MISMATCH` and `RESULT_SET_ENVIRONMENT_MISMATCH`. Without that, a set could hold one
case measured on one model and another on a different one, with identical workload parity, and the
aggregate would describe a machine that does not exist.

Equality is by SHA-256 over the canonical form rather than a field-by-field comparison, which stops
covering a field the moment somebody adds one.

## Cost is deliberately absent

No provider prices are hard-coded. Pricing is mutable and commercial; a price written into a package
is wrong within a quarter and quoted for a year. This package owns performance.

## Containment

No HTTP, provider SDK, model gateway, inference engine, model download, `child_process`, environment
lookup, filesystem discovery, database, migration, embedding or training framework. No clock and no
randomness — `createdAt` is injected, so the same inputs always produce the same digest.

One Node capability: `node:crypto`, for SHA-256 artifact identity. That is an **integrity** identity,
not a signature — it proves an artifact has not drifted since it was stamped, and nothing about who
produced it.

No dependency on Human Gold. The HGV1 corpus is a separate, deferred workstream, and this slice does
not wait on it or import from it.

## What is not built yet

No harness. No adapter that turns a real run into an observation. No suite of workload cases. No
measurement of any model.

Those need a decision about what to measure and on what, which is the owner's and comes after these
contracts exist to receive it.
