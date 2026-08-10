# ADR-0105 — RWC-P9: Riya production hardening and operational readiness

- **Status:** Accepted — MERGED as PR #110. Reviewed head
  `a0fd7fefa2ff77851f196c7baae481825334f3c0`; merge commit
  `192e4a9ec90fcb77f4866357fd7a681acb40cb93`. **RWC-P10 (ADR-0106) is the current slice.**
- **Date:** 2026-08-09
- **Depends on:** ADR-0104 (RWC-P8 cross-channel continuity and logical-turn idempotency),
  ADR-0103 (RWC-P7), ADR-0101/0102 (RWC-P6), ADR-0100 (RWC-P5), ADR-0099 (RWC-P4B),
  ADR-0058/0060 (the model gateway and its reliability controls), ADR-0097 (the private ingress)
- **Baseline:** RWC-P8 merged as PR #109 — merge commit
  `aac81a20500306e205b3c43c354e4b7e86c8fc4c`. Migrations `0001`–`0012`. **RWC-P9 adds none.**

RWC-P9 is the INTERNAL Riya customer-journey production-hardening slice. It is **not** canonical
QFJ-P09, which is the Execution Gateway and Communication Lifecycle.

## Context

Eight slices built a Riya that is correct. This one asks a different question: what happens to it
under load, and can an operator tell?

Two concrete gaps.

**RWC-P8 gives every admitted text turn a dedicated PostgreSQL session**, held for the whole turn so
the conversation's advisory lock cannot drift onto another connection. That is the right design, and
it has a consequence nobody had bounded: a burst across many _different_ conversations acquires many
`PoolClient`s, and it does so long before the model gateway's own concurrency gate is reached. The
gateway would then be carefully protecting a model the database had run out of connections to reach.

**And nothing in the Riya path is observable.** Not overload, not contention, not replay — and above
all not `INDETERMINATE`, which is the single state that means a business effect may have happened and
can never be re-run. An operator running a pilot would learn about it from a customer.

## Decision

### 1. RWC-P9 is not canonical QFJ-P09

Canonical QFJ-P09 is the Execution Gateway and Communication Lifecycle. This slice belongs to the
continuing Riya customer journey under canonical QFJ-P06, and it deploys nothing.

### 2. Process-local admission, BEFORE the coordinator

One required setting, `maxConcurrentTextTurns`, integer 1..1024, no default. A turn takes a slot
before `turnCoordinator.begin` — and therefore before a PostgreSQL session, before continuity, before
the RWC-P5 availability read, before the envelope, before `startProcessing`, before the runtime,
before knowledge, before the model, before Core and before any compare-and-set.

No default, deliberately. This number and the coordinator's pool capacity are the same decision made
twice, and a default lets a deployment make it by accident.

### 3. Fail fast. There is no service queue.

A slot is free or it is not. No waiter list, no timer, no retry-after, no backoff, no priority, no
per-tenant or per-channel quota.

A local queue would wait behind whatever is already slow — a hung preflight, a model call the gateway
is itself queueing — consuming memory while promising nothing. The caller learns "not now" either
way; the only question is whether it learns in a microsecond or after an unbounded wait, and whether
the process is holding a growing list of turns nobody has undertaken to serve.

Capacity comes from replicas and pool sizing, not from a local buffer. That is canonical QFJ-P11's
work, not this slice's.

### 4. The slot bounds the WHOLE turn, including the P8 lease

Acquired before `begin`, released in the outermost `finally` on every path — success, refusal,
replay, conflict, a thrown store, a spent claim. A leaked token would permanently shrink a replica's
capacity, silently, until the process restarted.

### 5. Overload costs nothing

`turn-overloaded` is thrown with **zero** coordinator calls, zero store reads, zero availability
reads, zero runtime, model, Core and compare-and-set — and **no durable claim**, so the same logical
message may simply be presented again.

### 6. Admission is additional to P8, never a substitute

Admission is a **process-level** ceiling on total text turns. RWC-P8 is **cross-process**
serialization of one canonical conversation plus durable logical-message idempotency. Both remain,
and the gate is deliberately not conversation-aware: making it so would put a second, weaker,
process-local copy of P8's authority in front of the real one.

### 7. The model gateway remains the sole model-reliability authority

Request timeout, `AbortSignal` at the provider boundary, bounded model concurrency, bounded model
queue, budget refusal, retry policy, circuit breaker, kill switch, sequential fallback, provider
health and provider error normalization all stay in `@qf-jarvis/model-gateway`. RWC-P9 adds no second
timeout, retry, circuit, queue, fallback or kill switch, and changes no gateway production source.

The two layers protect different resources: the gateway protects the model, admission protects the
database session and the process. They are complementary, and neither substitutes for the other.

### 8. No `Promise.race` timeout around the turn

No `Promise.race`, `setTimeout`, `setInterval`, sleep, delay, `AbortController`, retry loop or
backoff anywhere in the RWC-P9 additions.

The reason is specific to P8. After `startProcessing` the logical turn is potentially spent. A
JavaScript timeout that merely stops _waiting_ while the underlying runtime, model or Core call
continues would create a side effect this process no longer tracks — and every release and
finalization decision downstream would then be reasoning about a turn that is still running. A
timeout has to live at the I/O authority that can actually cancel and normalize it.

### 9–11. Observability is injected, synchronous, best-effort and never an authority

Both hooks — service and coordinator — are optional, synchronous, and have their results ignored.
Nothing awaits them and nothing branches on them. A hook that throws on every event leaves the turn
structurally identical, and a spec runs the whole matrix twice to prove it.

An asynchronous hook would be worse than useless: awaited, it puts a metrics sink on the critical
path of a client's answer; fired and forgotten, its rejection surfaces somewhere unrelated.

**Terminal events describe the FINAL surfaced outcome** (owner correction on PR #110). `text-turn-completed`
and `text-turn-failed` are emitted by the admission wrapper, after the whole claimed-turn pipeline —
including RWC-P8's lease cleanup — has settled. They are never emitted from inside it.

The reason is a real ordering defect the correction removes. RWC-P8 deliberately lets lease cleanup
_replace_ an outcome: a safe pre-start `NOT_READY` whose `releaseUnstarted` cannot be proved becomes
`turn-coordinator-unavailable`, because a conversation that may still be locked is the higher-order
fact. Observing before that point recorded a completion the caller never received, and recorded
`continuity-unavailable` for a turn the caller was told was `turn-coordinator-unavailable`. Both are
false operational evidence, and the second is the worse kind: operations and the caller disagreeing
about the same turn.

Intermediate proved facts — `text-turn-coordinator-outcome` and `text-turn-processing-started` — stay
where they are. They are not outcomes, and nothing downstream can revise them.

Exactly one terminal event per admitted turn that settles. `text-turn-overloaded` is separate: a
refused turn never entered the pipeline, so it produces no terminal event of its own.

### 12. Content-free, and that is the strongest lock in this slice

No event may carry `tenantId`, `conversationId`, `messageId`, `subjectRef`, `channelTurnRef`,
`normalizedText`, a reply, knowledge content or identifiers, a citation, `actionRef`,
`completionEvidenceRef`, an idempotency key, any digest, `requestId`, `runtimeId`, a prompt, model or
provider identity, SQL, a table, a host, a raw error or a stack.

Every field is a closed enum or a count.

This is not caution for its own sake. A telemetry stream is the least governed thing in a deployment:
it fans out to sinks nobody reviewed, is retained longer than anything else, and is read by people
who never saw the privacy contract. RWC-P8 went to considerable trouble not to store a message or a
digest of one; emitting the identifiers it declined to store would hand them to that pipeline
instead. Counting is enough to operate the system.

**The coordinator's digests are specifically excluded.** They are derived from a caller's channel
reference, so a stream of them is a stream of correlatable turn fingerprints.

### 13. No automatic retry is introduced

Not in admission, not in the service, not in the coordinator. RWC-P8's rule stands unchanged: an
`INDETERMINATE` claim is never re-run automatically, and no layer added here retries anything.

### 14–15. Nothing is deployed and nothing is activated

**No migration** — `0001`–`0012` unchanged, no `0013`. No managed database access. No live WhatsApp,
no provider, no n8n, no QuickFurno repository access and no handshake. The private ingress production
code is unchanged and stays **NOT DEPLOYED**. No autoscaling, no Kubernetes, no load balancer, no
health or metrics endpoint.

Observability adds **interfaces and events only**: no `console.log`, no logger library, no
OpenTelemetry SDK, no Prometheus client, no exporter, no metrics server, no tracing backend, no file
log and no database log table. A deployment chooses a sink later.

### 16. Load tests are deterministic

Concurrency is proved with explicit barriers that a test resolves, never with sleeps. A timing-based
concurrency test is a test that passes on a fast machine and fails in CI, and the thing it was
guarding stops being guarded the moment somebody marks it flaky.

### 17. Structured RWC-P6 actions are NOT behind the gate

They make zero model calls, hold no P8 coordinator lease and acquire no dedicated session — a
different resource path and a different authority. No structured-action result, reason or contract
changes, and no `SERVICE_OVERLOADED` is added to them.

RWC-P9 hardens the text-turn pipeline, which is the one that holds a conversation's session and
invokes the model runtime.

### 18. Scope boundaries

RWC-P10 owns model quality and evaluation work. Canonical QFJ-P11 owns actual pilot and scale
deployment. Neither is started here.

## Consequences

- One replica can no longer admit an unbounded number of text turns, so a burst is shed before it can
  exhaust the coordinator's pool.
- Overload is cheap and leaves nothing behind.
- Operators get countable signals for overload, contention, replay, indeterminate claims, completion
  and destroyed sessions — with no way for those signals to identify a conversation or change one.
- The invariants of P4A, P4B, P5, P6, P7 and P8 are untouched; P9 only surrounds them.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- admission happens BEFORE `turnCoordinator.begin`, and is fail-fast with **no** queue;
- `maxConcurrentTextTurns` is required, with no default;
- the slot is released on every path;
- admission never replaces P8's per-conversation serialization or its durable idempotency;
- the model gateway remains the sole model timeout, retry, circuit, concurrency and fallback
  authority, and no `Promise.race` deadline wraps the turn;
- observability is synchronous, injected, best-effort and content-free, and can never change an
  outcome;
- terminal service events are emitted OUTSIDE the claimed-turn pipeline and describe the final
  surfaced outcome after correctness-critical lease cleanup, exactly once per settled turn;
- no identifier, message, reply or digest enters an event;
- no automatic retry, no reply cache, no new migration, and no deployment.
