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

An optional **memory probe** may supply peak bytes for one measured phase. Absent means not measured; a
fabricated zero would sit in a comparison table beside real readings.

## A declared shape is not a firewall

The port interfaces are erased at run time. A future adapter, written against a real provider by
somebody who never read this page, can return:

```
{ outcome: 'SUCCESS', inputTokens: 512, outputTokens: 20, text: 'raw model reply' }
```

Reading the counts and ignoring `text` would make the claim "content cannot cross this boundary by
shape" false: the content crossed, it was merely unused, and something downstream eventually logs the
object. So every value coming back from a port — descriptor, prepared case, terminal result, memory
reading — is **parsed strictly and rebuilt**. An unknown key is a refusal.

Foreign exceptions are replaced rather than wrapped. An adapter message is where a prompt, an endpoint
or a credential lives, and `cause` would carry it just as far. What surfaces is one of the harness
closed codes and nothing else — no `ZodError`, no `TypeError`, no RMB-A error, at any failure this
boundary is designed to have.

## The plan is re-proved here too

A typed plan is not a proven plan: a caller can arrive through JavaScript, through `JSON.parse` or
through a cast. The runner therefore rebuilds the plan through `createRiyaBenchmarkSuitePlan` and uses
only that value, and refuses an unsupported batch immediately after — both **before the target is
touched at all**, including before its descriptor is read.

## Identity comes from the target, and is locked

Subject and environment are read from `descriptor()` and re-proved through the RMB-A constructors. The
runner options have no subject or environment key at all, so "run against A and stamp it as B" — the
forgery a harness makes easiest — is not expressible.

The first proven pair is then **locked**, and re-proved before and after every case. A pool that rolls,
a container that restarts or an engine that reloads different weights mid-suite would otherwise leave
every artifact stamped with the identity the target started as: evidence about a subject that changed
underneath it, indistinguishable from evidence that is correct. A difference fails the whole suite with
`TARGET_IDENTITY_CHANGED`.

Before warmup, what the target says it _prepared_ must match the workload exactly: case id, prompt
digest, input tokens, output cap, sampling digest, streaming mode. Discovering a token-count
disagreement afterwards, in the numbers, is discovering it too late.

## How a case runs

1. **Re-prove identity** against the suite lock.
2. **Prepare**, and check the prepared descriptor against the plan.
3. **Warmup** — the same scheduler, the same protocol enforcement, and excluded from every number:
   attempts, successes, tokens, percentiles and the measured window.
4. **Open the memory case**, after warmup and before the window, so a peak can only have come from the
   measured phase and probe setup stays out of the throughput denominator.
5. **Measure** — exactly `measuredRequestCount` requests, deterministic ordinals, at most
   `concurrency` in flight, the next admitted as a slot frees.
6. **Close the window**, finish the memory case, re-prove identity, build the evidence.

No sleeps, no backoff, and **never a second attempt**. A harness that asked twice would measure a
recovery policy. Everything after admission — including the target's own queueing — is what is
being measured.

The per-request deadline belongs to the adapter: the harness holds no timer, and an expired deadline
comes back as an ordinary failure. See the
[measurement policy](./riya-benchmark-measurement-policy-v1.md).

`batchSize` must be 1 in this version. Hosted APIs are one logical request per invocation and local
engines dynamic-batch concurrent requests on their own, so explicit batching is not needed to produce
load and would complicate per-request sampling. A larger batch is refused before any target work.

## Two kinds of bad

A **target failure** is data: it counts as a failed request, the suite continues, and the success rate
tells the story.

A **protocol, identity or clock failure** means the measurement is unsound — a success with no
first-output callback, a mismatched input-token count, output past the cap, a target that changed
identity, a clock going backwards. Those invalidate the **whole suite** and produce no result set at
all. A partial set is a set somebody eventually compares.

## Cancellation is quiescent

When anything fails, one internal controller aborts, no further ordinal is admitted, and **every
in-flight invocation is awaited to settlement** before the call returns or throws. The original failure
is what surfaces; the cancellations it caused never overwrite it. A caller who cancels gets
`SUITE_ABORTED`, and a target that throws because it was cancelled is read as cancellation rather than
as a broken adapter.

This puts one obligation on an adapter: **settle promptly once your signal aborts.** The harness has no
ambient timer to give up with, so an adapter that ignores the signal makes the harness wait rather than
making it return while requests continue against a model. That is the deliberate direction — a
returned result with live load behind it is the one outcome worse than a wait.

An open memory case is aborted and awaited on the same path, and a failure in that cleanup never
replaces the failure that triggered it.

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

The memory lifecycle exists so the second of those can be honest when it arrives: a probe that could
only be _read_ at the end would report a peak that might have come from warmup, from the previous case
or from whatever else the process did, and a per-case column in a comparison table would be quietly
wrong.
