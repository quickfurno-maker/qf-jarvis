# Jarvis OS — the operator control plane

**Status:** **JOS-01C is the current implemented Jarvis OS slice** in this build ([ADR-0087](../decisions/ADR-0087-jos-01c-owner-authentication-and-operator-session-boundary.md), PR #91) — owner authentication, MFA and the operator session boundary. JOS-01A and JOS-01B are **merged**. **JOS-01D — isolated Docker, VPS and Traefik deployment — is next.** **Nothing is deployed.**

> **Why this reads as "current" and not as a branch status.** An architecture document that says a
> slice is "on a feature branch, not merged" is false the instant that branch merges, and nobody
> goes back to fix it. GitHub owns merge state and tracks it accurately; this document describes the
> architecture and the software slice compiled into this build, which is true before and after a
> pull request lands. The same reasoning applies to the roadmap markers the surface renders: the
> running slice is `current`, never `next`.

**Relates to:** [ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md) · [ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md) · [ADR-0007](../decisions/ADR-0007-approval-request-submission-model.md) · [ADR-0083](../decisions/ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md) · [ADR-0084](../decisions/ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md) · [communication-model.md](./communication-model.md) · [system-boundary.md](./system-boundary.md)

## Purpose

QF Jarvis has spent nine phases becoming careful. It produces governed recommendations, asks
for approval, correlates QuickFurno Core's decisions, stores them durably, and refuses to
turn any of it into permission. What it has never had is a way for a human to **see** any of
that.

Jarvis OS is that surface. It is a premium, systematic web control plane for an operator: what
the system is doing, what needs a person, where each boundary sits, and what is deliberately
switched off.

## It is powerless, and that is a design constraint rather than a phase

Jarvis OS holds **no business authority**, and holds no backend connection at all. QuickFurno Core
and n8n are both `NOT_CONNECTED`: no live read protocol has been adopted in this repository, and
neither is contacted from here.

It creates no approval and answers none. It sends no communication and reaches no provider.
It invokes no n8n workflow and calls no Meta API. It mutates no QuickFurno Core record and no
Jarvis durable state. It reaches no database and performs no network access whatsoever — a
source-level test asserts the absence of `fetch`, `XMLHttpRequest`, `WebSocket`, any URL literal,
browser storage, `'use server'`, and any import of a backend workspace package or a database,
provider, n8n or Meta client.

JOS-01C **narrowed** two of those rules rather than dropping them, and the tests enforce the narrow
version. `process.env` is permitted in exactly two reviewed places — the auth config-path boundary
(one variable, holding a PATH and never secret material) and the proxy's `NODE_ENV` check for
development-only CSP relaxations — and `node:fs` in exactly one, the auth config loader. Everywhere
else, including every page, component and control-plane module, both remain forbidden. The one
mutation the application performs is setting or clearing its own session cookie.

The permanent boundary is unchanged and is stated on the surfaces themselves:

> **Jarvis** recommends, reasons, correlates and observes.
> **QuickFurno Core** authorizes and owns business truth.
> **n8n** executes approved intents and decides nothing.
> **Providers** deliver and decide nothing; results return to Core.

QuickFurno Core remains authoritative for vendors, customers and leads, packages and pricing,
payments, consent and opt-out, assignments, registration and activation, commercial outcomes,
and every authorization decision. Jarvis OS displays that split on a dedicated screen rather
than assuming a reader knows it.

## Web now, Android later — one set of contracts

Android is **not** built in this track, and no React Native or Expo file exists. What this
release does instead is put every meaningful fact behind a governed boundary so a future
Android client can reuse it without a second business-logic stack:

```
apps/jarvis-os/src/lib/control-plane/
  types.ts          the read-model DTOs — SystemHealth, AgentSummary, ApprovalQueueRow, …
  demo-provider.ts  a READ-ONLY adapter over a local synthetic snapshot
  index.ts          controlPlane() — the one seam every surface reads through
```

**No business decision lives in a React component.** A component receives a `SystemHealth`
and paints it; it does not decide what healthy means, which agent owns which vendor, or
whether anything may be sent. JOS-01B replaced the demo provider with a repository baseline and no
screen changes. A later Android client consumes that same API — the conceptual contracts
travel, the transport does not, and Next.js internals are never a dependency of anything but
the web app.

The read model interface has **only readers**. There is no writer on it and no place to add
one without editing that file — which is exactly the friction that should exist before a
surface acquires the ability to change something.

## Authentication and the operator session (JOS-01C)

Every operator page and the snapshot API require a **verified** session. `/login` is the only
public page, and it renders no `AppShell` — the module navigation, the agent roster and the
boundary sections would otherwise be readable by anyone who can load the page.

| Control | Production |
| --- | --- |
| Password hashing | Argon2id v19, 19 MiB, 2 passes, 32-byte digest, `timingSafeEqual` |
| MFA | **Required** TOTP (RFC 6238, SHA-1, 6 digits, 30s, ±1 step) |
| Session | AES-256-GCM, random IV per token, 1-hour server-enforced absolute expiry |
| Cookie | `__Host-qfj-jos-session`, `Secure`, `HttpOnly`, `SameSite=Strict`, no `Max-Age` |
| CSRF | Exact-origin check on every mutation, plus a session-bound token for sign-out |
| Secrets | ONE read-only JSON file outside the repository; one env var holding a PATH |

**Authentication is not authority.** A signed-in OWNER may view Jarvis OS. It implies no approval,
no communication authorization, no dispatch, no consent, no payment or activation right and no Core
mutation. The only state this phase mutates anywhere is a browser cookie.

**Proxy is optimistic; the DAL is the authority.** `src/proxy.ts` mints the CSP nonce and checks
whether a session cookie is present. The protected layout and the snapshot route each verify
properly, close to the data. Delete the proxy and every protected surface stays closed — the tests
prove it by calling the route handlers directly.

**Known limitation, stated rather than implied.** This stateless model has no per-session
revocation: a stolen token is valid until it expires or the configuration file is rotated.
Revocation is global — bump `session.revision` or remove a key and every session dies at the next
request. A durable identity/session provider MUST be adopted before multi-operator use or any
write-capable control-plane feature.

## Capability-aware UI

`src/lib/capabilities/catalog.ts` holds one closed vocabulary, used everywhere:

| Lifecycle | Means |
| --- | --- |
| `AVAILABLE` | Implemented, merged, usable through the surfaces this release ships. |
| `PLANNED` | Designed and owner-approved, not implemented. Renders as a preview. |
| `DISABLED` | Implemented and deliberately switched off. Not a fault. |
| `SHADOW` | Runs observed-only; its output authorizes nothing. |
| `NOT_CONNECTED` | Implemented here; the system it depends on is unreachable from this surface. |
| `ROLLOUT_OFF` | Gated behind production rollout, which is off. |

**A capability state is a presentation fact and never an authority.** It decides whether a
surface renders as usable and nothing else — Jarvis OS holds no power for a flag to unlock.
The reason to centralise it is that ad-hoc booleans drift: `enabled`, `ready`, `isLive` and
`available` accumulate until nobody can say which one an operator's screen is reading, and at
that point a surface can claim a system is live because a variable said so.

Tests pin that `AVAILABLE` is the only interactive state, and that `approval.submit`,
`conversation.control.write`, `communication.live-send`, `execution.n8n.bridge` and
`aarohi.vendor-growth` are none of them.

## The demo read model

**JOS-01B changed the default.** JOS-01A rendered a local synthetic snapshot on every screen; the
default is now a **repository baseline** built from merged governance and merged packages, and the
demo fixture is reachable only from tests and visual fixtures.

The rule that replaced it: **unreadable is not empty.** Every operational section carries an explicit
availability — `AVAILABLE`, `STATIC_BASELINE`, `NOT_CONNECTED`, `PLANNED`, `ROLLOUT_OFF` — with a
reason and the source that will eventually supply it, and the contract parser REJECTS any unavailable
section that carries rows or any unavailable series that carries points. An empty array reads as
"zero"; "the approval source is not connected" is the opposite fact, and the two can no longer render
alike. No chart draws a flat zero line for a source nobody connected.

The retained fixture still obeys the JOS-01A rules:

- **Nothing real.** No person, vendor, customer, phone number or email address appears.
  Identifiers carry a `-DEMO-` segment (`CONV-DEMO-1042`, `VENDOR-DEMO-18`) so a screenshot or
  a support ticket is self-labelling. A test asserts the segment is present and that no
  email-shaped or E.164-shaped string exists anywhere in the model.
- **No invented connection.** Where a system is unreachable the state says `NOT_CONNECTED`
  rather than showing a plausible number. A dashboard that invents a healthy reading for a
  system it cannot see is worse than one that shows nothing.

Control-looking actions — Approve, Reject, Take over, Resume — are rendered so the layout is
proved at real width, and every one is `disabled` with a stated reason. A test asserts that
every `<button>` in the application except the navigation drawer's open/close controls carries
`disabled`.

## Agents — and the separation that matters

Four surfaces, one reusable component family, four distinct scopes:

| Agent | Scope | State |
| --- | --- | --- |
| **Jarvis** | Orchestration, case routing, founder decision support | `SHADOW` |
| **Riya** | Customer conversation and qualification | `SHADOW` |
| **Aarohi — Vendor Growth** | Vendor **acquisition** — not-yet-registered vendors | `PLANNED` / disabled |
| **Anisha** | **Registered**-vendor relationship, support and success | `SHADOW` |

**Aarohi and Anisha are separate agents and must never be merged, visually or conceptually.**
Aarohi acquires vendors who are not yet registered; Anisha cares for vendors QuickFurno Core
has already registered. The cost of blurring them is concrete: an acquisition agent reaching
existing-vendor relationships, or a care agent acquiring an outreach channel. Both pages state
the boundary against the other, and tests assert separate routes, separate scopes, separate
capabilities and reciprocal naming.

Aarohi is an **owner-locked product surface with no runtime**. Every funnel stage is zero, no
prospect exists, no outreach has been attempted, and no channel is attached. This track adds
no Aarohi runtime and broadens no Anisha behaviour.

> **JOS merge dependency — satisfied.** Canonical Aarohi / QuickFurno Vendor Growth Engine
> governance is **merged**: [ADR-0085](../decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md)
> (PR #89, merge commit `22f48b09`) adopts Aarohi as the fourth governed agent under **QFJ-P12**,
> narrows Anisha to the registered-vendor lifecycle, and records the AVG-0…AVG-12 overlay.
> This surface therefore now agrees with the constitution rather than anticipating it.
>
> That ordering was deliberate. This track never rewrote the agent constitution or the authority
> matrix — the governance change landed first, on its own branch, under its own ADR and review.
> A product surface must not be the first canonical statement that an agent exists.
>
> What is unchanged: Aarohi remains a **`PLANNED`/disabled product surface with no runtime**, no
> outreach, no channel and no credential, and the canonical boundary it renders is Core's
> registration truth — **on Core's authoritative `ACTIVE` confirmation, acquisition selling stops
> and relationship ownership moves to Anisha**, and a party Core reports as registered, active,
> inactive, dormant, former, previously contacted, duplicate or do-not-contact is never an
> acquisition target.

## Phase track

JOS is a product and UI overlay. It is **not** a new canonical QFJ major phase, it renumbers
nothing, and there is no QFJ-P13.

| Phase | Scope |
| --- | --- |
| **JOS-01A** | Premium dashboard foundation — shell, design system, capability model, demo read model. |
| **JOS-01B** | Read-only control-plane contract and snapshot API; truthful default surface. Replaces the demo provider. |
| **JOS-01C** | Owner authentication, TOTP MFA and the operator session boundary. |
| **JOS-01D** | Isolated Docker image, VPS deployment, Traefik TLS, auth-protected staging. |
| **JOS-01E** | Progressive backend wiring, capability by capability. |

**After the Jarvis OS foundation track, main Jarvis backend work resumes at QFJ-P09.02** — the
test-only authorized dispatch envelope and n8n bridge validation. That marker is rendered on
the Execution and Governance surfaces so it cannot be lost, and a test asserts it is present.

## Deployment topology

**The read API exists in source and is NOT deployed.** `GET /api/control-plane/v1/snapshot` has no
authentication; JOS-01C adds it and JOS-01D deploys only afterwards. **`apps/api` was not turned into
an HTTP server** — it still exports nothing and runs none — and server components call the pure
snapshot builder directly rather than self-fetching, so the page and the API cannot drift.

The shared `@qf-jarvis/control-plane-read-contract` package is framework-neutral: zod is its only
dependency, and it carries no Next, React, Node or browser type, no filesystem path, no cookie or
session assumption and no `process.env`. A future React Native / Expo Android client compiles it
unchanged. **No Android files are added in this track.**

**Nothing is deployed.** The VPS is untouched, no Traefik route is added, no DNS is
changed, and no container is built. `next.config.ts` sets `output: 'standalone'` so that
JOS-01D can build an isolated image without a configuration change landing alongside a
deployment.

Known VPS layout, for JOS-01D's reference only:

| Component | Status |
| --- | --- |
| Traefik | Shared ingress |
| `qf-core-staging` | Isolated compose project/network — **temporary** |
| `n8n-cjls` | Isolated compose project/network — **permanent** |
| `/srv/qf-jarvis` | **Permanent** Jarvis home |

JOS-01D owns the Dockerfile, the isolated `qf-jarvis` compose project, private container
validation, `jarvis.quickfurno.in`, Traefik TLS and auth-protected staging.

## Toolchain

Next.js App Router 16.2.11, React 19.2.0, Tailwind CSS 4.3.0, TypeScript strict with
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Every icon and chart is
code-native SVG: no icon package, no charting library, no UI component library, no font
package, and no runtime CDN or Google Fonts fetch. The type stack is system/local only.

All repository supply-chain controls stay intact — exact pinned versions, `strictPeerDependencies`,
`engineStrict`, `minimumReleaseAge: 1440` with strict enforcement, and `onlyBuiltDependencies: []`.

**One supply-chain note.** `sharp` is an optional dependency of `next`, used only for
production image optimization, and it requires a lifecycle build script that
`onlyBuiltDependencies: []` forbids. It is listed under `ignoredOptionalDependencies` in
`pnpm-workspace.yaml`, which **removes** it from the tree. That is a tightening, not an
exemption: no build script was permitted, `onlyBuiltDependencies` remains empty, and one fewer
native binary is installed. Jarvis OS ships no optimized raster images and this repository runs
no production Next.js server, so nothing needs it.
