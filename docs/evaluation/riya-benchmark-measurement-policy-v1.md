# Riya benchmark measurement policy v1

**Ref:** `riya-benchmark-measurement.v1` · **Implementation:** `riya-benchmark-harness` v1 · **Slice:** RMB-B · **Companion:** [harness](./riya-benchmark-harness.md)

Every artifact the harness produces carries this ref. Two numbers computed under different rules are
different numbers, so evidence that shared a ref across a rules change would be silently incomparable —
**changing anything on this page requires a new `measurementPolicyRef` and a new implementation
version.**

---

## What counts as a request

Exactly `measuredRequestCount` logical requests, ordinals `0 … N−1`, each executed **once**. No retry,
no backoff, no second attempt.

Warmup requests run through the same scheduler and the same protocol checks, and are excluded from
every number below — attempts, successes, failures, tokens, percentiles and the measured window.

## Success and failure

A **success** requires all of:

- exactly one first-output callback;
- `inputTokens` exactly equal to the workload's `inputTokenCount`;
- `outputTokens` between 1 and the workload's `maximumOutputTokens`.

Anything else from a target — an error result, a timeout, a refusal — is a **failure**. It counts in
`failedRequests`, contributes no latency sample, and credits no output tokens, _even if the target
emitted some before failing_. A partial reply is not a reply.

A failure may report its exact input usage; if it does, it must be exact.

An input-token count that disagrees with the plan **aborts the suite**. It is never averaged and never
replaced with the planned figure, because a drift there means the tokenizer or the prompt
materialization changed — precisely what a benchmark must not smooth over.

## Instants

Three samples per request, from the injected monotonic clock:

- `start` — immediately before `invoke`;
- `firstOutput` — inside the callback;
- `completion` — immediately after the terminal result.

```
TTFT = firstOutput − start
E2E  = completion − start
```

`E2E ≥ TTFT ≥ 0` always. A backwards clock aborts rather than producing a negative interval.

## Decode

```
decodeWindow = completion − firstOutput
micros/token = floor(decodeWindow / max(outputTokens − 1, 1))
```

Divided by `outputTokens − 1` because time-to-first-token already accounts for the first token. Dividing
by the full count would understate decode cost on short replies, and Riya's replies are short.

A one-token success has no decode interval; the clamp keeps the arithmetic total and attributes the
whole post-first-token window, which for one token is approximately zero.

## Percentiles

Nearest-rank, over **successful requests only**, ascending integer samples:

```
rank  = ceil(p × n)
index = rank − 1
p50   = 0.50      p95 = 0.95
```

No interpolation. An interpolated value is one no request actually experienced, and this evidence gets
compared across machines and quoted months later.

Failures are **not** inserted at the timeout. Substituting the deadline would make a target that fails
fast look slower than one that fails at the wall, and would make p95 a function of the timeout setting
rather than of the model. Failure is reported by the success rate, separately, for exactly this reason.

With zero successes: no TTFT pair, no end-to-end pair, no decode pair, and `outputTokensTotal` is 0.

## The measured window

```
windowStart = immediately before the first measured request is admitted
windowEnd   = immediately after the final measured terminal result
measuredWindowMicros = windowEnd − windowStart
```

Includes target execution and the target's own queueing after admission. Excludes preparation, warmup,
and evidence construction.

Present even when everything failed — the window is how long the failures took.

Aggregate throughput divides by it:

```
successfulRequestsPerSecondMilli = floor(successfulRequests × 1e6 × 1e3 / window)
aggregateOutputTokensPerSecond   = floor(outputTokensTotal   × 1e6       / window)
```

Both integer, both safe at the contract bounds (1e15 < 2^53). Never approximated from
`concurrency / p50 latency`: that estimate is wrong under batching, queueing and tails, and it would
read as a measurement.

## Tokens

```
inputTokensTotal  = sum of exact reported input tokens across all terminated measured requests
outputTokensTotal = sum of output tokens across SUCCESSFUL requests only
```

## Arithmetic

Integers throughout, in microseconds and bytes. Floating point would make two identical runs produce
two different digests on two machines, and evidence that cannot be re-derived is not evidence.

## What this policy does not do

No score, no weighting, no winner, no recommendation, no approval. Speed is not quality, quality is not
safety, and none of the three is permission to ship.
