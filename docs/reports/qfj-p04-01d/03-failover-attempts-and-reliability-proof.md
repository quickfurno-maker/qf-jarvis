# Report 03 — Failover, Attempts, and Reliability Proof

**Slice:** QFJ-P04.01D — Hybrid Routing and Failover. **ADR:** [ADR-0048](../../decisions/ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md).

## The failover matrix

`decideFallover` is a pure function over the primary's **normalized** failure (code + retryable, never a raw body), the policy, the plan's fallback eligibility, the data class, cancellation, and the remaining attempt budget. It returns a single ALLOW/DENY decision with a safe reason. It never inspects a raw provider body and never infers retryability from message text.

| Condition                                                                        | Decision  | Reason                        |
| -------------------------------------------------------------------------------- | --------- | ----------------------------- |
| retryable primary in the transient allowlist (`provider-unavailable`, `timeout`) | **ALLOW** | `fallback-eligible-transient` |
| circuit-open primary (never invoked)                                             | **ALLOW** | `primary-circuit-open`        |
| request cancelled                                                                | DENY      | `cancelled`                   |
| policy fallback disabled                                                         | DENY      | `fallback-disabled`           |
| no eligible fallback in the plan                                                 | DENY      | `no-eligible-fallback`        |
| attempt budget exhausted                                                         | DENY      | `budget-exhausted`            |
| `LOCAL_ONLY` with a hosted fallback (defense in depth)                           | DENY      | `data-class-forbids-fallback` |
| `malformed-provider-output`                                                      | DENY      | `primary-malformed`           |
| `structured-output-invalid`                                                      | DENY      | `primary-structured-invalid`  |
| non-retryable / non-transient failure (auth, config, `provider-failed`)          | DENY      | `primary-non-retryable`       |

Each row is covered by a dedicated unit test. The allowlist is bounded to genuinely transient categories; every terminal category denies, so a second provider is never wasted on an auth/config/malformed/structured-invalid/non-retryable failure. **No hidden repair by another model.**

## End-to-end failover — proven

| Scenario                                                           | Result                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| retryable hosted failure (`provider-unavailable`) + local fallback | falls over to local; `usedFallback: true`; groq 1 call, local 1 call |
| non-retryable hosted failure (`malformed`)                         | terminates `malformed-provider-output`; **local 0 calls**            |
| `LOCAL_ONLY` local retryable failure, Groq present + fallback on   | terminates `provider-unavailable`; **groq 0 calls** (never hosted)   |
| already-cancelled request                                          | terminates `cancelled`; **fallback 0 calls**                         |
| `OFF` / kill switch                                                | both providers prevented (`gateway-off` / `kill-switch-active`)      |

## The attempt ledger

`AttemptLedger` governs one gateway run: one shared budget bounds total provider invocations. Proven guarantees (unit + integration):

- **At most one fallback provider** — a second distinct fallback throws.
- **At most one accepted response** — `markAccepted` is one-shot; any attempt after acceptance throws.
- **No attempt after acceptance** — `canAttempt()` is false once accepted.
- **Fallback does not reset the budget** — the primary and the fallback share the same ledger; `remaining()` after a primary attempt + a fallback attempt reflects both.
- **Bounded totals** — total invocations never exceed `maxTotalAttempts` and never exceed `1 + retryBudget + (fallback ? 1 : 0)`; the stricter bound wins.
- **Content-free snapshot** — `snapshot()` is frozen and carries only ids and counts.

End-to-end: with a primary retryable twice (`retryBudget: 1`) plus one fallback and `maxTotalAttempts: 3`, the run makes exactly 2 primary + 1 fallback invocations (`attempts: 3`). With `maxTotalAttempts: 1`, the primary consumes the only attempt and **no fallback is possible** (terminates `provider-unavailable`, fallback 0 calls). There are **no parallel or speculative calls and no voting** — the gateway makes at most one accepted response, sequentially.

## Reliability integration

The hybrid path reuses the foundation's circuit breaker and per-provider retry (`runProviderLedger`), so a circuit-open provider is excluded at plan time and a circuit that opens mid-retry stops further attempts. Timeouts and cancellation are honoured through the same injected clock and `AbortSignal`; the adapter/gateway never sleeps on a wall clock.
