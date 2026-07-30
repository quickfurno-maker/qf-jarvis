# QFJ-S2-D-B — Production Credential Binding at the Process Boundary

**Slice:** QFJ-S2-D-B
**Date:** 2026-07-30
**Base:** `main` at `2e2eece792d86a307187fa23adf3ad52b402001d`
**ADR:** ADR-0064
**Outcome:** A production-shaped credential path exists, fully tested against synthetic files, and
remains unwired. **No provider is production-active.**

---

## 1. The doctrine this slice follows

`packages/event-backbone/src/persistence/database-config.ts` already states the rule:

> "A library that reaches into `process.env` is a library whose behaviour depends on something the caller
> cannot see and a test cannot control… **The only places that may read the environment are the CLIs**,
> because those are **executable process boundaries rather than reusable library code**."

So this slice did not invent a policy. It applied one the repository had already written down.

## 2. Why `apps/api`, and why no new package

`apps/api` existed as a deliberately empty compileable boundary; this is its first content. A
`@qf-jarvis/secret-runtime` package would hold one interface and one bounded file read while inheriting
the very "am I a library?" problem the doctrine exists to prevent. **No package under `packages/**` was
modified.**

## 3. Why the resolver stays Groq-specific

`GroqCredentialResolver` already _is_ the production seam. A provider-neutral
`resolve(ref): Promise<string>` would erase the branding that is currently the whole defence. Each
provider keeps its own holder — `GroqApiKey`, `LocalAuthToken` — a pattern the repository already
applies twice.

## 4. Explicit path injection, and no environment read

The absolute path is a constructor argument. **This slice reads no `process.env` at all** — a
containment spec scans every file in `apps/api` and asserts the only `process` access anywhere is
`process.platform`, a platform predicate rather than configuration.

## 5. File-security rules

Absolute path required. `lstat` rejects a symlink or non-file; the file is then opened once and
**`fstat` on the open descriptor** re-checks type, size and mode. That **narrows, and does not
eliminate,** the TOCTOU window — no more is claimed, and Kubernetes-style symlinked projected mounts
are consequently unsupported and deferred.

On POSIX a file readable or writable by group or other is rejected (`mode & 0o077`); `0400` and `0600`
pass. **Windows mode bits are synthetic and are not treated as a control** — the check is skipped there
and the specs are platform-aware without weakening Linux behaviour.

`MAX_CREDENTIAL_FILE_BYTES = 514` is derived, not guessed: the existing 512-character Groq maximum plus
one `CRLF`. An oversized file is refused from `fstat` **before a byte is allocated**, and never
truncated — a truncated credential is a silently wrong one.

## 6. Newline normalisation

At most one terminal `LF` or `CRLF` — what a file mount adds — is removed. Everything else is refused:
a second terminal newline, any leading or trailing whitespace, any embedded `CR`/`LF`, any `NUL` or
other C0 control byte. **`trim()` is never called**, because silently absorbing whitespace turns a wrong
credential into a confusing 401 instead of a clear local failure. The survivor goes through the existing
`createGroqApiKey`, which owns the final bounds and the branding.

## 7. Six closed failure codes

`credential-reference-invalid` · `credential-unavailable` · `credential-not-found` ·
`credential-value-invalid` · `credential-refresh-failed` · `internal-invariant`.

Fixed messages, no `cause`, no path, no reference, no value, no file metadata, no backend text. An
unknown code normalises to `internal-invariant`. `credential-access-denied` and
`credential-backend-misconfigured` fold into `credential-unavailable` — a file adapter cannot separate
"not mounted" from "no permission" without leaking the path. **No `ModelGatewayError` code was added.**

## 8. Lazy, single-flight resolution

No read at module import, at factory construction, at OFF-only composition construction, or at snapshot
inspection. The first matching `resolve` reads once; concurrent first callers **share** that read;
later resolves read nothing. A failed first read does not poison later attempts. Two bindings share no
state — there is no global cache.

## 9. Refresh and last-known-good

`refresh()` forces exactly one read, and overlapping refreshes **share one in-flight read** — the locked
policy. On success the holder is replaced atomically for future resolutions. On failure **with** a
current value: last-known-good is preserved, `stale` becomes true, `credential-refresh-failed` is
returned, and serving continues without a further read. On failure **without** one, the underlying
initial failure is returned and no last-known-good is invented.

A `resolve` during an in-flight refresh returns the current last-known-good immediately rather than
blocking. No timer, watcher, polling or scheduler exists — asserted by source scan and by a macrotask
turn that produces no additional read.

## 10. Refresh is not model retry

The binding imports no provider, no transport, and no status-code vocabulary; it cannot see a provider
response. **No 401/403 path exists.** `retryBudget` stays 0 and fallback stays disabled. Resolving and
refreshing produce **zero** model invocations. A future "refresh advisable" signal is deferred with
provider-response integration.

Hot-swapping an already-active provider is deferred — no provider is active, and none is constructed.

## 11. Redacted diagnostics

`snapshot()` is deeply frozen and carries only `backendType`, four counters, `hasCurrentCredential`,
`stale`, a closed `lastOutcome`, and `authority`. Every string field is a fixed token or a closed code —
asserted field-by-field. **`credentialReference` is deliberately absent**: it names a secret's location
in a store, and `providerId`/`releaseId` already identify a run. No path, filename, raw value, length,
prefix, suffix, hash, inode, mode, uid, gid, mtime, message, error or stack.

**One defect this work found and fixed.** The first draft let a _throwing_ reader seam propagate a raw
exception — the kind that carries the filesystem path in `message` and `path`. The binding now discards
any throw and reports `internal-invariant`, so no backend text can escape even from a misbehaving seam.

## 12. No zeroisation is claimed

JavaScript strings are immutable and GC-managed; `authorizationHeaderValue()` and the transport's header
spread each create copies the holder cannot reach. Converting to `Buffer`/`Uint8Array` would buy nothing
— `fetch` requires a string — and would imply a guarantee the runtime cannot honour.

## 13. Backend compatibility

A protected file is the shape a plain VPS mount, systemd `LoadCredential` and Docker secrets all
converge on, and a later external secret manager can materialise one. Choosing it locks in no deployment
decision.

## 14. OFF-only proof

Supplying the new resolver to `createProductionModelGateway` changes nothing: `mode` stays `OFF`,
`activatable` stays false, `retryBudget` 0, `fallbackEnabled` false, no rollout controller or activation
method is reachable. Crucially, **no read occurs merely because a valid configuration exists** — the
read counter stays at 0 through construction and through a refused `invoke`, alongside provider health
checks 0 and invocations 0.

## 15. Locks

model-evaluation **33** · model-gateway **71** · model-gateway-composition **2** ·
groq-staging-smoke **24** · event-backbone **39**. `apps/api` adds **no** package-root runtime export.
`model-gateway` and `model-evaluation` dependencies remain exactly `["zod"]`. `apps/api` depends on
`@qf-jarvis/model-gateway` in production and on the composition **test-only**, with a spec asserting no
production file imports it.

## 16. The authoritative boundary was clarified before merge

The first revision of this slice flagged a conflict rather than resolving it: `system-boundary.md` said
"Hold provider credentials. It has none and must never be given any" without qualification. That
document predates the model gateway and named no model-inference provider — every neighbouring clause
concerns execution and advertising providers reached through n8n after Core authorizes.

Under an explicit owner decision, `system-boundary.md` now distinguishes the two categories:
**execution/integration credentials remain forbidden to Jarvis entirely** and stay with n8n or the
relevant execution service, while **one narrow model-inference credential** may be held only at an
executable process boundary under ADR-0064, may never enter Core state, agent memory, a prompt, an
event, a log, provenance, a report or a database row, and confers no execution authority. The
document's own change-control rule — "a superseding ADR and an explicit decision by the business owner"
— is exactly the process this went through (ADR-0046, ADR-0060, ADR-0062, ADR-0064).

Two supporting documents whose wording had become literally false were corrected in the same bounded
way: `system-context.md` and `repository-structure.md` now say "execution credential" where they said
"any credential". Historical ADRs and slice reports were **not** rewritten — they are records of what
each slice authorized at the time, and ADR-0064 supersedes rather than edits them.

## 17. Boundaries

No credential accessed, requested, validated, displayed, hashed, stored or used — every fixture is an
unmistakable `FAKE_QFJ_CREDENTIAL_DO_NOT_USE_*` written to a temporary directory this suite creates and
removes. No environment value read. No clipboard, keychain, OS store, Docker secret or cloud secret
access. No network or provider request. No smoke run. No database, Supabase, Docker or migration. No
deployment, activation, SHADOW, CANARY, ACTIVE or FALLBACK.

**Provider construction and controlled SHADOW binding remain S2-E, under a fresh explicit
authorization. No provider is production-active.**
