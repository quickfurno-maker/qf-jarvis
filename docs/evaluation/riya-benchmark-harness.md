# Riya operational benchmark harness

**Slice:** RMB-B · **Package:** `@qf-jarvis/riya-model-benchmark-harness` · **Companions:** [benchmark foundation](./riya-model-benchmark-foundation.md), [measurement policy v1](./riya-benchmark-measurement-policy-v1.md), [selection protocol](./riya-model-selection-protocol.md)

**No real model has been benchmarked.** This slice builds the scheduler. Every target it has ever run
against is a deterministic fake, and no provider or local-engine adapter exists yet.

---

## What RMB-A left, and what this fills

RMB-A ended deliberately with _no harness, no adapter, no suite of cases, no measurement of any model_.
It owns evidence: the contracts, the digests, the manifest, the comparison, and the rule that a
benchmark authorizes nothing.

RMB-B owns the part that produces the numbers, and hands them straight to those constructors. It builds
no artifact by hand and recomputes no digest — one evidence authority, and a harness that cannot
quietly relax it.

## It benchmarks nothing real, and cannot

Execution happens only through an injected `RiyaBenchmarkTargetPort`. There is no provider SDK, no
model-gateway invocation, no local inference engine, no model download, no HTTP, no `child_process`, no
environment lookup, no filesystem discovery, no database and no training framework.

**The production model gateway is untouched.** A real adapter belongs behind the target port in a later
slice — not as a TTFT callback threaded through the code that serves customers. A spec proves the
gateway names no benchmark concept, so that shortcut cannot be taken quietly later.

## The two ports

**Monotonic clock.** `nowMicros()`, non-decreasing, meaning elapsed time and nothing else. A backwards
reading aborts the suite: a negative latency reads as an impossibly fast request rather than a broken
clock. `createdAt` is injected separately and never derived from it.

**Target.** Content-opaque in both directions. It reports its own subject and environment, confirms
what it prepared for a case, and executes one logical request at a time. A prompt reaches it as a
digest and a token count — there is no field a sentence fits in.

An optional **memory probe** may supply peak bytes. Absent means not measured; a fabricated zero would
sit in a comparison table beside real readings.

## Identity comes from the target

Subject and environment are read from `descriptor()` and re-proved through the RMB-A constructors. The
runner options have no subject or environment key at all, so "run against A and stamp it as B" — the
forgery a harness makes easiest — is not expressible.

Before warmup, what the target says it _prepared_ must match the workload exactly: case id, prompt
digest, input tokens, output cap, sampling digest, streaming mode. Discovering a token-count
disagreement afterwards, in the numbers, is discovering it too late.

## How a case runs

1. **Prepare**, and check the prepared descriptor against the plan.
2. **Warmup** — the same scheduler, the same protocol enforcement, and excluded from every number:
   attempts, successes, tokens, percentiles and the measured window.
3. **Measure** — exactly `measuredRequestCount` requests, deterministic ordinals, at most `concurrency`
   in flight, the next admitted as a slot frees.
4. **Close the window**, read memory, build the evidence.

No sleeps, no backoff, and **no retry**. A retrying benchmark measures a retry policy. Everything after
admission — including the target's own queueing — is what is being measured.

`batchSize` must be 1 in this version. Hosted APIs are one logical request per invocation and local
engines dynamic-batch concurrent requests on their own, so explicit batching is not needed to produce
load and would complicate per-request sampling. A larger batch is refused before any target work.

## Two kinds of bad

A **target failure** is data: it counts as a failed request, the suite continues, and the success rate
tells the story.

A **protocol, identity or clock failure** means the measurement is unsound — a success with no
first-output callback, a mismatched input-token count, output past the cap, a clock going backwards.
Those invalidate the **whole suite** and produce no result set at all. A partial set is a set somebody
eventually compares.

An aborted suite likewise produces nothing, and nothing keeps running after the call returns.

## Suite plans

Content-free: ids, digests, counts and timing. A plan is meant to hold differently-shaped cases —
`short/c1`, `long/c1`, `short/c8`, `short/c32` are four cases of one suite, which is what makes a
concurrency sweep expressible at all.

There is **no default case list** and no "typical Riya prompt size" or "production concurrency"
constant. We do not have those distributions, and a constant asserting one would be quoted as though we
did. The real candidate matrix is a later owner-reviewed artifact.

The harness stamps `benchmarkImplementationId`, `benchmarkImplementationVersion` and
`measurementPolicyRef` itself. A caller who could set them could claim a run followed rules it did not.

## Two additive RMB-A fields

`workload.requestTimeoutMicros` and `observation.measuredWindowMicros` are **optional** in RMB-A V1, so
evidence written before they existed stays valid and its digest does not move. RMB-B-generated evidence
always carries both.

The window is what makes aggregate throughput a measurement. `successfulRequestsPerSecondMilli` and
`aggregateOutputTokensPerSecond` divide by it. They are deliberately **not** approximated from
`concurrency / p50 latency` — that estimate is wrong the moment a target batches, queues or has a tail,
and in a report it would be indistinguishable from a real measurement.

The timeout is measurement parity: a run that abandons a slow request at two seconds and one that waits
thirty produce different failure counts and different tails from the same target.
`REQUEST_TIMEOUT_MISMATCH` names that. The window's _absence_ is not a parity mismatch — refusing to
compare against legacy evidence would strand every artifact written before the harness existed.

## Still no model, and still no selection

RMB-B benchmarks nothing and selects nothing. The order is unchanged: generic safety, then P10 Riya
quality, then — among candidates that cleared both — operational evidence, then an owner chooses. See
the [selection protocol](./riya-model-selection-protocol.md).

## What is not built yet

A real provider or local-engine adapter. A real memory probe. A candidate workload matrix. All three
need decisions that come after the machinery exists to receive them.
