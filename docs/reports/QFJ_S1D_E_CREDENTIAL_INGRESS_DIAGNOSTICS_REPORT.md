# QFJ-S1D-E — Credential Ingress Diagnostics

**Slice:** QFJ-S1D-E
**Date:** 2026-07-29
**Base:** `main` at `4cabbd4a1c3d59eee3773c08b5fb20ad4ed20d44`
**Outcome:** Closed-enum ingress diagnostics added. **No credential touched. No smoke run.**

---

## 1. The observed S1D-C local failure

```
outcome=FAIL
reason=smoke-credential-invalid
bindReason=groq-bind-credential-unavailable
binds=1
credentialReads=1
invocations=0
timersArmed=1
timersCleared=1
timerArmedMs=7
bindStartedMs=7
invokeSettledMs=496
totalElapsedMs=496
timeoutPhase=unknown
transportErrorCode=NONE
```

**`invocations=0`: no HTTP request was made, so Groq neither validated nor rejected anything.** No
provider-side credential fact was tested. The failure was entirely local, before the transport.

The S1D-D audit established that `credentialReads=1` meant _one read attempt_, not one successful
resolution, and that a single code covered six distinct causes. That is what this slice fixes.

## 2. The closed `credentialOutcome` enum

Ten members. Each names a **code path**, never a property of the value.

| Member               | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `not-attempted`      | the resolver was never entered (a bind gate refused first)          |
| `tty-required`       | the interactive gate failed before any source read                  |
| `read-aborted`       | the source signalled an explicit operator abort (Ctrl-C / Ctrl-D)   |
| `read-unavailable`   | any other source failure — **the safe fallback**                    |
| `rejected-empty`     | a zero-character value                                              |
| `rejected-too-short` | non-empty but under the existing lower bound                        |
| `rejected-too-long`  | over the existing upper bound                                       |
| `rejected-charset`   | violates the existing allowed-character predicate                   |
| `rejected-holder`    | the credential holder refused construction after the earlier guards |
| `resolved`           | a credential object was successfully created                        |

A finer member is **never inferred** when the source cannot prove it. Classification uses **typed error
identity** (`MaskedSecretReadError` with a `kind` of `aborted` or `unavailable`) — never message
parsing. An error whose _message_ claims "aborted" is still classified `read-unavailable`, and a test
pins exactly that.

Had these existed on 2026-07-29, the S1D-C line would have named the branch outright — most likely
`rejected-empty` or `rejected-charset`, given the 489 ms window.

## 3. New sanitized fields

```
credentialOutcome=<closed enum>
credentialReadAttempts=<non-negative integer>
credentialResolutions=<0 or 1>
credentialReadSettledMs=<integer, present once a read attempt settled>
```

## 4. `credentialReads` compatibility

`credentialReads` is **retained unchanged in the output** purely for compatibility with the pre-S1D-E
report format. It is a count of read **attempts** and has never meant "a credential was resolved."

In this one-shot harness `credentialReads === credentialReadAttempts` on every path — asserted by test
across resolved, empty, too-short, aborted, unavailable, and TTY-refused runs. **Use
`credentialResolutions` to answer "did a credential actually resolve?"**

One behavioural refinement: the attempt counter is now incremented immediately _before_
`source.readOnce`, i.e. **after** the TTY gate. A TTY refusal therefore reports `0` attempts rather
than `1`. The one-entry-per-process guarantee is preserved by a separate entry flag, so a second
`resolve` still fails closed and cannot overwrite the first recorded outcome.

## 5. Acceptance semantics are UNCHANGED

The decision is still exactly:

```
length >= 20 && length <= 200 && /^[A-Za-z0-9_-]+$/
```

`classifyRejection` runs **only after** that predicate has already said no; it names which clause
failed and decides nothing. No trim was introduced. A corpus test compares the resolver's accept/reject
answer against an independently written baseline predicate across eleven values, including boundary
lengths, quotes, and whitespace.

**No key-label guard was added.** `qf-jarvis-staging-smoke-v1` satisfies the bounds and is still
accepted — the S1D-D finding is recorded here as an executable test rather than silently fixed.
Closing that gap changes acceptance semantics and is a separate, owner-reviewed decision.

## 6. Secret containment

The output can carry **only** a closed enum member and non-negative integers. Explicitly never emitted:
credential length, prefix, suffix, first or last character, hash, fingerprint, entropy, a masked
credential, the source error message, a stack, the label-versus-secret comparison result, clipboard
content, or terminal buffer content.

The formatter uses an explicit field allow-list and prints named scalars — it never walks an object.
Tests assert that a distinctive planted value, the internal refusal messages, `Bearer`, and
`authorization` appear in no surface, and that every printed `credential*` line is either the enum or a
bare integer.

## 7. Behaviour locks preserved

One credential read, one bind, one invocation, one fetch, zero retries. Timer still armed **before**
credential resolution (asserted by call ordering). `timeoutMs` 30000. Local rejection keeps
`invocations=0`, `transportErrorCode=NONE`, `timeoutPhase=unknown`, and zero transport calls.
`modelOutput=DISCARDED` and `authority=QUICKFURNO_CORE` still present. Approved `modelId` and
`configDigest` untouched. Model Gateway untouched. Package-root API unchanged at 24 — every new symbol
is internal.

## 8. Boundaries

No Groq credential was read, requested, validated, displayed, hashed, stored, or used. The masked
resolver was never invoked with real input — every test injects a scripted source. No Groq, API, or
network request. No smoke run. No database, Supabase, Docker, migration, deployment, activation, or
rollout. No QuickFurno Core, WhatsApp, n8n, or real data. The protected reconciliation directory was
never opened, read, hashed, staged, or modified.

**The consumed S1D-C authorization was not reused. Another live attempt remains forbidden without new
explicit owner authorization.**

## 9. Next

Owner review and merge. Then the owner console/key procedure from the S1D-D audit, and a **separate**
decision on whether to authorize any new one-shot attempt.
