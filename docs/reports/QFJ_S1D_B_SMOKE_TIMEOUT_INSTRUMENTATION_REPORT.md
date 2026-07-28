# QFJ-S1D-B — Smoke Timeout Diagnostic Instrumentation

**Slice:** QFJ-S1D-B
**Date:** 2026-07-28
**Base:** `main` at `0b60a6749f35d09afb577e50969cbd1e672b55fb`
**Outcome:** Diagnostic telemetry added. **No root cause is claimed. The smoke was not run.**

---

## 1. The observed S1D result

The first authorized Groq staging smoke completed with:

```
outcome=FAIL
reason=smoke-timeout
binds=1
credentialReads=1
invocations=1
timersArmed=1
timersCleared=1
modelOutput=DISCARDED
authority=QUICKFURNO_CORE
```

**The one-time smoke authorization is CONSUMED.** Another live attempt is forbidden without new,
explicit owner authorization.

## 2. What is and is not claimed

That result proved the harness behaved exactly as specified — one bind, one credential read, one
invocation, one timer armed and cleared, output discarded — and proved **nothing** about where the
30 seconds went.

**No root cause is claimed here.** The S1D-A forensic audit found no implementation-correctness bug,
and this slice does not contradict that. Credential-entry delay, a DNS/TLS/connect stall, a wait for
response headers, a body stall, model latency, and an abort race remain indistinguishable _from the
S1D evidence_. This slice adds the instrumentation that would distinguish them next time; it does not
retroactively explain last time.

## 3. Telemetry schema

All values are integer milliseconds from a run-local origin, read from an **injected monotonic clock**
(`performance.now()` in production — never the wall clock, so a clock step cannot produce a negative
duration). A milestone that was never reached is **omitted**, and that omission is the signal: the last
line present is the last phase the run proved it completed.

### Milestones

| Field                     | Meaning                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `timerArmedMs`            | the single 30 s timer was armed                                                                |
| `bindStartedMs`           | the staging bind began                                                                         |
| `credentialResolvedMs`    | the resolver returned a credential **successfully**                                            |
| `requestConstructedMs`    | the smoke finished building its invocation input (the gateway serialises the wire body itself) |
| `invokeStartedMs`         | immediately before the single `provider.invoke`                                                |
| `fetchStartedMs`          | immediately before delegating to the platform fetch                                            |
| `headersReceivedMs`       | a `Response` object exists                                                                     |
| `responseBodyStartedMs`   | immediately before body consumption                                                            |
| `responseBodyCompletedMs` | body fully consumed                                                                            |
| `invokeSettledMs`         | the run settled (recorded in a `finally`)                                                      |
| `abortSignalledMs`        | inside the timeout callback, **before** `controller.abort()`                                   |

### Derived

| Field                | Definition                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `credentialEntryMs`  | `credentialResolvedMs − bindStartedMs` — bind gates plus the operator's typing                          |
| `networkElapsedMs`   | `responseBodyCompletedMs − fetchStartedMs`, emitted **only** when both ends are proven; never estimated |
| `totalElapsedMs`     | origin to settlement, or to snapshot if the run never settled                                           |
| `timeoutPhase`       | the phase the abort landed in, **frozen at abort**                                                      |
| `transportErrorCode` | the normalized transport failure class                                                                  |

### Enums

`timeoutPhase` ∈ `pre-bind` · `credential-resolution` · `pre-fetch` · `awaiting-headers` ·
`awaiting-body` · `post-body` · `invoke-settlement` · `unknown`

`transportErrorCode` ∈ `NONE` · `ABORT` · `ENOTFOUND` · `ECONNREFUSED` · `ECONNRESET` · `ETIMEDOUT` ·
`UND_ERR_CONNECT_TIMEOUT` · `UND_ERR_HEADERS_TIMEOUT` · `UND_ERR_BODY_TIMEOUT` · `CERT` · `OTHER`

`timeoutPhase` is `unknown` when no abort fired — it reports where a timeout struck, not how a
successful run finished.

## 4. Why the phase is frozen at abort

`invokeSettled` is recorded in a `finally`, so by snapshot time it is always present. Deriving the
phase then would label **every** timeout `invoke-settlement` and tell you nothing. The recorder
therefore computes and freezes the phase inside the timeout callback, from the milestones proven at
that instant, before the abort propagates.

## 5. Sanitisation

Two properties are structural, not promised:

1. **It cannot carry a secret.** A milestone is a name from a closed list plus a number. The recorder
   accepts no caller-supplied strings, so a key, header, prompt, body, error message, URL, or stack
   trace has no representable place to go.
2. **It cannot change behaviour.** Recording is pure bookkeeping — no branch depends on a milestone,
   no timer is added, the timeout is untouched.

Transport errors are classified from `name`/`code` and one level of `cause.code` only. The message,
the stack, and any URL or address the error quotes are never read. The original error object is
rethrown **unchanged**, so the Model Gateway's normalisation is untouched.

Never emitted: API key or any key-derived value; `Authorization`/`Bearer`; request headers; prompt,
system, or user content; raw response headers or body; parsed provider body; model output; token text;
customer or vendor data; exception message; stack trace; URL query parameters; proxy settings;
machine username or filesystem path.

## 6. Architecture — and the one deliberate trade-off

`@qf-jarvis/model-gateway` is **untouched**.

The intended shape was a decorator around `createFetchGroqTransport`. That cannot work, for a
structural reason: the gateway transport's `send()` resolves only _after_ it has already awaited both
the platform fetch and `response.text()`. From outside, a wrapper sees one opaque await — it can time
the whole exchange but can never separate connect from headers from body. Those are exactly the phases
S1D-A said we could not distinguish.

So the observation point moved inward to the narrowest seam the smoke package owns:
`instrumented-transport.ts` implements `GroqTransport` itself and interleaves milestones around its own
fetch, injected through a `FetchLike` seam so every test stays offline.

**The cost, stated plainly:** this duplicates the gateway transport's wire semantics — fixed endpoint,
`POST`, `redirect: 'error'`, bounded body read, bounded `retry-after` parse. Duplication drifts. The
test suite therefore pins each of those against the gateway's own source, so a change there fails here.
`GROQ_MAX_RESPONSE_BYTES` is not exported from the gateway barrel, so its value is mirrored and
verified against the gateway source by test.

## 7. Behaviour locks preserved

| Lock                                                   | Status                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| one credential read / bind / invocation / HTTP attempt | unchanged, asserted                                  |
| zero retries at any layer                              | unchanged, asserted on 429, 5xx, and network classes |
| fixed endpoint + SSRF guard                            | unchanged, taken from the gateway constant           |
| request prompt, response schema, output-discard policy | unchanged                                            |
| `authority=QUICKFURNO_CORE`, `modelOutput=DISCARDED`   | unchanged                                            |
| `timeoutMs = 30000`                                    | unchanged; not moved, not extended                   |
| timer armed **before** credential resolution           | unchanged, asserted by call ordering                 |
| outcome/reason vocabulary and mapping                  | unchanged                                            |
| Model Gateway provider normalisation                   | unchanged                                            |
| approved config payload and `configDigest`             | unchanged (`4f97ef1e…2be1`)                          |
| package-root API                                       | unchanged at 24 symbols; diagnostics stay internal   |

## 8. Tests and gates

`packages/groq-staging-smoke/src/tests/timeout-diagnostics.test.ts` covers all 35 mandated proofs.
The full package suite is **294 tests**; the repository suite is **126 files / 3806 tests**.

Gates: targeted → `format:check` → `lint --max-warnings=0` → `typecheck` → `test:unit` → `build` →
`check:dist-containment`.

One local-only note on `format:check`: it reports `.mcp.json`, an **untracked** file that has never
been committed and is not part of this change. It is absent from any CI checkout, so CI's `pnpm check`
is unaffected. Every tracked file, including all S1D-B files, passes Prettier.

Four pre-existing test locks were updated as an explicit, reviewed consequence: the two `bin.ts`
composition assertions, the containment `fetch(` scan (now permitting exactly one production module,
with a tighter compensating assertion), and the two sanitized-output key locks.

## 9. Boundaries

No credential was read, requested, validated, displayed, hashed, or stored. The masked resolver was
not invoked. No Groq, API, or network request was made — no `curl`, `Invoke-WebRequest`,
`Test-NetConnection`, `nslookup`, `ping`, Postman, Playground, or SDK test. No database, Supabase,
Docker, migration, deployment, activation, or rollout. No QuickFurno Core, WhatsApp, n8n, or real data.
The protected reconciliation directory was never opened, read, hashed, staged, or modified.

## 10. Next

Owner review and merge. Then a **separate** decision on whether to authorize one additional
instrumented smoke.

**Another live attempt remains forbidden without new explicit owner authorization.** The previous
one-time authorization is spent and was not reused here.
