# Report 03 — One-Shot, Timeout/Abort, and Prompt-Binding Proof

**Slice:** QFJ-S1A. **ADR:** [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md) §C, §E, §F, §G.

## The one-shot data flow

```
--config <path>                    (the ONLY accepted argument)
   └─ loadSmokeConfig              read-only; strict closed schema; forbidden-field scan
   └─ isInteractive()              non-TTY → smoke-tty-required, nothing read
   └─ new AbortController()        exactly one, owned here
   └─ timer.arm(timeoutMs, abort)  exactly one, owned here
   └─ bindGroqStagingProvider      ONCE   → fail-closed gates → ONE credential read
   └─ provider.invoke              ONCE   → ONE HTTP request, zero retry
   └─ classify → frozen result
   └─ finally: cancelTimer()       always, on success, refusal, and throw
   └─ print sanitized report; exit 0 / 1 / 2
```

There is **no loop** anywhere in the package: `run-once.ts` contains no `while`/`for` over invocations,
and `bin.ts` calls `runSmokeCli` exactly once (asserted by counting the call sites in source).

## Exactly-once counters

Every outcome carries `SmokeCounters`, and the counters are snapshotted **after** the `finally` runs, so
timer cleanup is genuinely reflected rather than reported optimistically.

| Counter           | Success | Every refusal path                            |
| ----------------- | ------- | --------------------------------------------- |
| `binds`           | 1       | 1 (0 when the TTY gate refuses)               |
| `credentialReads` | 1       | 1, or 0 when a gate refused before resolution |
| `invocations`     | 1       | 1, or 0 when the bind refused                 |
| `timersArmed`     | 1       | 1 (0 when the TTY gate refuses)               |
| `timersCleared`   | 1       | 1 (0 when the TTY gate refuses)               |
| transport calls   | 1       | 1, or 0 on any pre-transport refusal          |

Asserted for success and for a 429, a 503, a malformed body, and a network failure.

## Zero retry

The harness contains no retry. Each of these produces exactly **one** transport call and one sanitized
code:

| Wire outcome                     | Sanitized code               | `retryable` |
| -------------------------------- | ---------------------------- | ----------- |
| 429                              | `smoke-provider-unavailable` | `true`      |
| 500 / 503                        | `smoke-provider-unavailable` | `true`      |
| 401                              | `smoke-provider-failed`      | `false`     |
| network/DNS/TLS failure          | `smoke-provider-unavailable` | —           |
| unparseable or wrong-shaped body | `smoke-provider-malformed`   | —           |

`retryable` is **reported, never acted upon**. For gateway-routed traffic the gateway remains the owner
of retry/timeout/circuit/failover; the harness deliberately does not route through the gateway and so
owns its abort and timer for this one invocation — and owns nothing else.

## Timeout and abort

- One `AbortController`, constructed in `run-once.ts` (asserted to appear exactly once in source).
- One timer, armed at the configured `timeoutMs` (asserted: `timer.armedMs() === 30_000`).
- On expiry the timer aborts the controller; the in-flight request rejects; the adapter re-reads
  `signal.aborted` after the awaited call and returns `cancelled`; the harness maps
  `cancelled` + `timedOut` → **`smoke-timeout`**.
- Cleanup is in a `finally`, so the timer is cancelled on success, on refusal, and on a thrown path
  (asserted: `timer.cancelled() === 1` in each case).
- A pre-invocation abort (a timer that fires the moment it is armed) produces **zero** transport calls.
- The production timer `unref()`s, so a still-armed timer cannot hold the one-shot process open.

## The fixed synthetic prompt

`packages/groq-staging-smoke/src/synthetic-prompt.ts` owns the only prompt in the package.

- Frozen, and frozen element-wise.
- A pure connectivity probe: a system line asking for JSON only, and a user line asking for
  `{"probe":"ok"}`. No client, vendor, or subject data; no address, contact, order, or history.
- Cannot be replaced by CLI, configuration, or stdin — nothing in the harness reads prompt text from any
  of them, and a prompt-text-shaped configuration field is rejected as a forbidden field class.
- The wire body is asserted to equal the compiled-in messages exactly, with `stream:false`, `n:1`,
  `response_format.type === 'json_schema'`, and no `tools` / `tool_choice` / `logprobs` / `logit_bias` /
  `top_logprobs`.

## Exact prompt identity and approval references

`GroqStagingRelease` now requires, and the content-free bind event now carries:

| Field                        | Kind       | Validation                                          |
| ---------------------------- | ---------- | --------------------------------------------------- |
| `promptFamily`               | identifier | 1–128 chars, `^[A-Za-z0-9._:-]+$`, not `*`/`latest` |
| `promptVersion`              | integer    | safe integer, 1 … 1 000 000                         |
| `capabilityProfileRef`       | identifier | as above                                            |
| `evaluationRef`              | identifier | as above                                            |
| `dataControlsAttestationRef` | identifier | as above                                            |

All are validated **before** credential resolution. The bind event's field set stays closed and is
asserted key-for-key: it carries the identifiers and never prompt text, a message, an output, a key, or
the credential reference value.

The configuration must additionally match the compiled-in `promptFamily`, `promptVersion`, and
`schemaRevision` **exactly**, so a configuration cannot claim to be exercising a prompt other than the
one in source.
