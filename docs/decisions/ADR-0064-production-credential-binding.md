# ADR-0064 — Production Credential Binding at the Process Boundary

**Status:** Accepted (2026-07-30, QFJ-S2-D-B)
**Supersedes:** nothing
**Depends on:** ADR-0046 (Groq adapter), ADR-0060 (staging provider binding), ADR-0061 (masked-TTY
staging ingress), ADR-0062 (production composition), ADR-0063 (verified evaluation-evidence binding)

---

## Context

The QFJ-S2-D-A audit found that this repository has already written down the rule that decides this
slice. `packages/event-backbone/src/persistence/database-config.ts` states it as doctrine:

> "A library that reaches into `process.env` is a library whose behaviour depends on something the caller
> cannot see and a test cannot control… So configuration arrives as an argument. **The only places that
> may read the environment are the CLIs**, because those are **executable process boundaries rather than
> reusable library code**."

The only concrete `GroqCredentialResolver` shipped today is the masked-TTY resolver, whose own header
declares it "is not, and must not become, the production deployment secret-manager integration."

## Decision

### 1. `apps/api` owns the concrete backend

The production credential backend lives at an **executable process boundary**, not in a library.
`apps/api` was created as a deliberately empty compileable boundary; this is its first content.

`@qf-jarvis/model-gateway` and `@qf-jarvis/model-gateway-composition` remain pure libraries: no
filesystem access, no environment access, dependencies unchanged. **No package under `packages/**` is
modified by this slice.**

### 2. No new package

One interface plus one bounded file read does not justify a package, and a `@qf-jarvis/secret-runtime`
would inherit the same "am I a library?" problem the doctrine exists to prevent.

### 3. `GroqCredentialResolver` is reused, and stays Groq-specific

The existing interface already _is_ the production seam. Generalising it now would produce a
`resolve(ref): Promise<string>`-shaped abstraction that erases the branding which is currently the whole
defence. Each provider keeps its own branded holder — `GroqApiKey`, `LocalAuthToken` — a pattern the
repository already applies twice.

### 4. The file path is injected explicitly; nothing reads the environment

The absolute path is a constructor argument. **This slice reads no `process.env` at all** — not for the
path, not for anything. Acquiring the path from an environment variable or CLI flag is a later
executable/deployment concern.

`process.platform` is read to decide whether POSIX mode bits are meaningful. That is a platform
predicate, not configuration, and it is the only `process` access in the slice.

### 5. A file-mounted backend, chosen because it defers nothing

A protected file is the shape a plain VPS mount, systemd `LoadCredential`, and Docker secrets all
converge on, and a later external secret manager can materialise one. Choosing it locks in no deployment
decision. Cloud secret managers, sidecars and OS keychains are **deferred**.

**Kubernetes-style symlinked projected volumes are explicitly NOT supported by this first backend** —
symlinks are rejected (§7), and supporting them is deferred.

### 6. Resolution is lazy and single-flight; refresh keeps last-known-good

No read happens at module import, at factory construction, at OFF-only composition construction, or at
snapshot inspection. The **first matching `resolve`** performs the first read; concurrent first callers
share one in-flight read.

`refresh()` forces exactly one new read and shares one in-flight forced refresh. On success it
atomically replaces the stored holder. **On failure with a current value it preserves last-known-good,
marks `stale`, and returns `credential-refresh-failed`** — it never retries, never invokes a provider,
and never triggers fallback. On failure with no current value it returns the underlying initial failure
rather than inventing a last-known-good.

No timer, no `fs.watch`, no `watchFile`, no polling, no scheduler.

### 7. File safety, and what it does not claim

Absolute path required. `lstat` rejects a symlink and any non-file. The file is then opened once, and
**`fstat` on the open descriptor** re-checks type, size and mode — narrowing, but **not eliminating**,
the TOCTOU window. No complete TOCTOU elimination is claimed.

On POSIX, a file readable or writable by group or other is rejected (`mode & 0o077`); `0400` and `0600`
are accepted. **Windows mode bits are synthetic and are not treated as a security control** — the check
is skipped there, and tests are platform-aware without weakening Linux behaviour.

Size is bounded from the existing Groq maximum (512) plus one CRLF, so an oversized file is refused from
`fstat` **before any allocation**.

### 8. Newline normalisation is exactly one terminal sequence

At most one trailing `LF` or `CRLF` — what a file mount adds — is removed. Anything else is refused:
a second terminal newline, any leading or trailing whitespace, any embedded `CR`/`LF`, any `NUL` or C0
control byte. **`trim()` is never called**: silently absorbing whitespace is how a wrong credential
becomes a confusing 401. The survivor is passed to the existing `createGroqApiKey`.

### 9. Refreshing a credential is not retrying a model invocation

This is the load-bearing distinction. `retryBudget` stays 0 and fallback stays disabled. **No 401/403
response may automatically refresh and re-invoke** — that would be a second model request under another
name. No response-driven refresh path exists in this slice; a future safe "refresh advisable" signal is
deferred with provider-response integration.

`refresh()` replaces the value **future** bindings resolve. **Hot-swapping an already-active provider is
deferred** — no provider is active, and none is constructed here.

### 10. No zeroisation is claimed

JavaScript strings are immutable and GC-managed. `authorizationHeaderValue()` and the transport's header
spread each create copies the holder cannot reach. Converting to `Buffer`/`Uint8Array` would buy nothing
— `fetch` requires a string, so a conversion copy is unavoidable — and would imply a guarantee the
runtime cannot honour. **This slice does not claim secure erasure.**

### 11. Six closed failure codes; diagnostics carry no identity

`credential-reference-invalid` · `credential-unavailable` · `credential-not-found` ·
`credential-value-invalid` · `credential-refresh-failed` · `internal-invariant`.

`credential-access-denied`, `credential-backend-misconfigured`, `credential-expired` and
`credential-revoked` are **deliberately folded or deferred** — a file adapter cannot distinguish "not
mounted" from "no permission" without leaking the path, and the distinction tells an operator nothing
the audit event does not.

Diagnostics carry a backend type, counters, two booleans, an outcome code and the authority. They carry
**no** `credentialReference`, path, filename, raw value, length, prefix, suffix, hash, inode, mode, uid,
gid, mtime, message, error or stack. **`credentialReference` is deliberately excluded**: it names a
secret's store location, and `providerId`/`releaseId` already identify a run.

No `ModelGatewayError` code is added.

### 12. This slice activates nothing

The production composition remains OFF-only and structurally non-activatable. **No provider is
constructed, health-checked, bound or invoked; no real credential is read; nothing is deployed.** The
resolver is implemented and left unwired.

Provider construction and controlled SHADOW binding are **S2-E**, under a fresh explicit authorization.

## Rejected alternatives

**A `@qf-jarvis/secret-runtime` package.** Rejected — see §2.

**`process.env` for the path.** Rejected for this slice: it is the exact ambient-configuration failure
the doctrine names. Deferred to an executable/deployment slice where it is a process boundary concern.

**A separate development-only backend.** Rejected: code production never exercises.

**`Buffer`/`Uint8Array` credential storage.** Rejected — see §10.

**Response-driven refresh on 401/403.** Rejected: it is a model retry wearing a different name.

**`trim()` on the file contents.** Rejected — see §8.

## Consequences

A production-shaped credential path exists and is fully tested against synthetic files, while remaining
unwired, unactivated, and incapable of reaching a provider. S2-E can bind it under fresh authorization.

**No provider is production-active.**

## Change-control rule

Wiring this resolver into a live provider, or enabling any rollout mode, requires a separate ADR and
explicit owner authorization. This ADR supplies a capability; it grants no activation.
