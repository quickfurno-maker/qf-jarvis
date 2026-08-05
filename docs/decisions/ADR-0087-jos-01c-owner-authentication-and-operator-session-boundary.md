# ADR-0087 — Jarvis OS Owner Authentication and Operator Session Boundary

**Status:** Accepted — JOS-01C (owner authentication, MFA and operator sessions; no deployment, no database, no live Core/n8n/provider, no business authority, no migration)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) · [ADR-0086](./ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md)

## Context

Baseline: `main` at `792d0bea8cf17d495f1fc9a59714de166f4ff18e`, the merge of PR #90 (JOS-01B).
Collision checks: `ADR-0087` unclaimed and unreferenced anywhere, zero open PRs, migrations
`0001`–`0009` with no `0010`, `0009` at `e834bc3c…`.

JOS-01B shipped a read-only control-plane API and eighteen operator pages with **no authentication
at all**. That was correct for a phase that deployed nothing, and it is the reason JOS-01D cannot
proceed: the moment this surface is reachable over a network, an unauthenticated `GET` returns the
system's entire posture — every capability, every agent, every integration boundary and every
roadmap marker. None of it is a business secret, and all of it is reconnaissance.

So authentication comes before deployment, deliberately, as its own reviewed phase.

## Decision

### 1. An owner-only bootstrap identity, and nothing resembling a user platform

Three factors in production: an operator identifier, a strong passphrase, and a TOTP code. There is
**no production password-only mode** — the configuration schema rejects `totp.required: false` when
`mode` is `PRODUCTION`, so it is unloadable rather than discouraged.

There is no signup, no invitation, no password reset, no social login, no OAuth, no magic link, no
multi-tenancy and no identity database. Jarvis OS has exactly one operator who already exists, and
building a user platform to serve one user would be a second premature system with its own
permanent attack surface. The boundary is small enough to read in an afternoon, which is the
property that matters most in authentication code.

**This is a bootstrap model with a stated replacement condition.** Before multi-operator use, or
before any write-capable control-plane feature, a durable identity/session provider — or a formally
reviewed replacement for this model — must be adopted. The specific gap is named in §7.

### 2. Authentication is not authority

An authenticated OWNER session permits **viewing Jarvis OS**. It does not imply approval granted,
communication authorized, dispatch allowed, consent valid, payment authority, vendor activation,
package or pricing authority, or any Core mutation right. QuickFurno Core authorizes; n8n executes;
providers deliver.

The only state JOS-01C mutates is a browser cookie. Sign-in sets one; sign-out clears one. That is
the complete list of writes this phase adds anywhere in the system.

### 3. Argon2id, with no fallback

Node 24.18's built-in `crypto.argon2` at the OWASP minimum or stronger: Argon2id v19, 19 MiB, two
passes, ≥16-byte random salt, 32-byte digest, verified with `timingSafeEqual`.

There is no fallback path. If Argon2id is unavailable the answer is a closed door, never PBKDF2,
SHA-256, bcrypt or a plaintext comparison. A silent downgrade is worse than an outage because
nobody notices it, and one working weaker branch destroys the entire value of a memory-hard KDF.

Node's implementation is currently flagged experimental. Using it is still right: the alternative is
a native compiled dependency, which `onlyBuiltDependencies: []` forbids outright, and the further
alternative is a weaker algorithm. The async form is used so a 19 MiB derivation does not block the
event loop — a synchronous one would let a single login stall every other request.

The derivation runs **even when the operator id does not match**, so an unknown operator costs the
same ~50ms as a known one. Without that, response time is a free enumeration oracle.

### 4. TOTP with SHA-1, and that is correct

RFC 6238, SHA-1, six digits, thirty seconds, ±1 step of drift, constant-time comparison, verified
against the RFC's own test vectors. SHA-1 is chosen because every mainstream authenticator
implements it and the collision results do not apply to a keyed 30-second MAC. A stronger digest
that no authenticator can enrol is worse security, not better.

The drift loop does not break early on a match: returning as soon as step −1 succeeds would make
that case measurably faster and leak which step the client's clock is on.

### 5. An encrypted, short-lived, stateless session

AES-256-GCM, random 12-byte IV per token, 16-byte tag, key selected by id, format
`v1.<kid>.<iv>.<ciphertext>.<tag>`. The AAD binds version, key id and cookie purpose, so a token
cannot be replayed against a different cookie and a future v2 cannot be accepted by a v1 reader.

**Encrypted rather than signed.** A JWT would put the operator id, session id and CSRF token in
plain view of anything that can read the cookie jar. And no JWT library: this format has no
algorithm-negotiation field, so there is no `alg: none` to confuse.

Absolute expiry is server-enforced (default one hour, schema-bounded 15 minutes to 4 hours). The
cookie carries no `Max-Age` or `Expires`, so it is a browser session cookie; a browser that keeps it
longer gains nothing. There is no "remember me" and no sliding refresh — both are real features
with real risks, and inventing them here would be guesswork.

### 6. Cookie, origin and CSRF

Production: `__Host-qfj-jos-session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no
`Domain`. The `__Host-` prefix is browser-enforced, so a compromised subdomain cannot plant a
session. Local development uses a **different name** (`qfj-jos-session-dev`) and may drop `Secure`
only on a loopback host — two names keep the production rule unconditional.

Every authentication mutation is `POST` only and validates `Host`, an exact-matching `Origin`, and
`Sec-Fetch-Site`. That is a second layer behind `SameSite=Strict`, because the first depends
entirely on the browser behaving. Logout additionally requires the session-bound CSRF token,
compared in constant time; it lives inside the encrypted token and reaches exactly one hidden form
input, so no injected script can read it.

`returnTo` is never trusted: `//evil.com`, `/\evil.com`, absolute URLs, schemes and control
characters all resolve to `/`. An open redirect on a login form is a phishing primitive.

### 6b. `Referrer-Policy: same-origin` — a JOS-01D correction

The application originally sent `Referrer-Policy: no-referrer`. Firefox derives a form submission's
`Origin` header from the document's referrer policy, so under `no-referrer` it sent `Origin: null`
for a genuinely same-origin login POST. The check in §6 correctly refused it, and the operator saw
the same generic invalid-credentials outcome as a wrong password.

Chromium does not do this. Scripted `curl` requests, the external smoke test and every unit test
passed throughout — the defect was only reachable through a real Firefox form submission, which is
exactly why it survived Gate 2 automation and surfaced during the owner's manual sign-in.

**The correction is the header, not the validator.** Accepting `Origin: null` would accept the value
a sandboxed iframe and a privacy-stripped cross-origin form both send; `null` is unattributable by
definition, so no check that honours it can be called same-origin enforcement. Every rule in §6 is
unchanged: `Origin` still required, still parsed, still exactly host-matched, still HTTPS-only in
production, `Sec-Fetch-Site` still mandatory, `null` still refused.

`same-origin` sends the full referrer to this application and **nothing to any other origin**, so no
operator URL leaves the deployment. Relative to `no-referrer` the only party that gains information
is Jarvis OS, about its own navigation.

The policy is now declared once, in `server/auth/response-headers.ts`, and spread by the login and
logout routes. It previously appeared as four hand-written literals; a value that drifted between
two redirect paths would produce an intermittent, browser-specific authentication failure, so
consistency is made structural rather than left to review.

### 7. What this model does NOT provide

**There is no per-session revocation.** A stolen token is valid until it expires or the
configuration file is rotated. Revocation is global: increment `session.revision`, or remove a key,
and every outstanding session dies at the next request — no rebuild, no restart, because the
configuration is read on every verification rather than cached.

That is an honest, bounded limitation, and it is the reason this ADR names a replacement condition
rather than presenting the model as finished. It is acceptable for one owner viewing a read-only
surface. It is **not** acceptable for multiple operators or for any write-capable feature.

The in-process attempt limiter is likewise defense in depth and not a distributed rate limiter:
with more than one instance each keeps its own counters, and a restart clears them. **JOS-01D must
add reverse-proxy request, body and rate limits.** `X-Forwarded-For` is deliberately not trusted —
honouring a caller-controlled header would let an attacker mint a fresh bucket per request, which is
worse than no limit because it looks like protection.

### 8. Proxy is optimistic; the DAL is the authority

`src/proxy.ts` (Next 16's name, not the deprecated `middleware.ts`) mints the CSP nonce and performs
a cheap cookie-**presence** check. It does not decrypt, does not read the configuration, and adds no
identity header for downstream code to trust — a header set by a trusted component is
indistinguishable at the point of use from one set by a client, and that confusion is a recurring
source of complete authentication bypasses.

The protected layout and the snapshot route each verify independently, close to the data. Delete the
proxy and every protected surface stays closed; the tests prove it by invoking the route handlers
directly with no proxy in the picture.

### 9. Strict CSP, and no HSTS yet

Nonce-based, `strict-dynamic`, entirely local: no CDN, no analytics, no external font or image host.
`frame-ancestors 'none'` and `base-uri 'none'` — the second stops an injected `<base>` silently
repointing the login form's action. Development relaxations (`unsafe-eval`, inline styles) are
narrowly scoped and asserted absent from production.

**HSTS is deliberately absent.** It is meaningful only over HTTPS, this build serves plain HTTP
locally, and sending it now would read as protection that is not there. JOS-01D adds it when Traefik
terminates real TLS.

## Rejected alternatives

**Auth.js / NextAuth.** Rejected. It brings an adapter model, a provider abstraction and a large
dependency surface to solve a problem with one user and no identity provider — and the parts we
would actually use are the forty lines of AES-GCM below.

**A JWT library.** Rejected. Signed-not-encrypted by default, and the `alg` field is the single most
exploited weakness in the ecosystem.

**Password-only, with TOTP later.** Rejected outright. "MFA in the next phase" is how a surface
ships with one factor permanently.

**Secrets in environment variables.** Rejected. Env vars are visible in `/proc`, in process
listings, in container inspection and in crash dumps. One env var holds a PATH; the secrets live in a
mounted file with owner-only permissions, and the loader rejects symlinks, non-regular files,
oversized files and group- or world-readable modes.

**Trusting `X-Forwarded-For` for rate limiting now.** Rejected until JOS-01D removes the public port
and sanitises forwarding headers at the edge.

## Consequences

- Every operator page and the snapshot API now require a verified session. `/login` is the only
  public page.
- The 18 operator URLs are unchanged: route groups `(public)` and `(protected)` never appear in a
  path.
- Jarvis OS gains exactly two enabled controls — sign-in and sign-out. Every other action-looking
  control remains disabled with a stated reason.
- Deployment is still blocked on JOS-01D, which must add TLS, HSTS, proxy rate limits and the
  secret mount.

## Non-goals

No deployment, DNS, Traefik or VPS change. No database of any kind. No live QuickFurno Core, n8n,
Meta or model-provider access. No business mutation. No migration — `0010` is not created. No
Android files. Production rollout remains **OFF**.

## Change-control rule

The three production factors, the Argon2id floor, the absence of a password-only mode, and the
requirement that authorization be verified close to the data may be changed only by a superseding
ADR. Adding a second operator, or any write-capable control-plane feature, requires adopting a
durable identity/session provider first — the stateless model in §7 does not support per-session
revocation and must not be stretched to pretend otherwise.
