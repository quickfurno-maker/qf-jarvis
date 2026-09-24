# Jarvis OS — the operator control plane

**Status:** JOS-01A through JOS-01E form the merged bounded foundation. JOS-01G is the current mobile-ready Jarvis OS slice, building on the JOS-01F live command-center layer. This operator-platform extension keeps those boundaries and adds optional adopted live sources, a versioned web/mobile operator API, and a separately signed QuickFurno Core command bridge. A source is shown as live only when it is actually observed for the current request; otherwise the same sections fail closed to `NOT_CONNECTED`. Certification-sensitive Jarvis governance actions remain locked. Whether a deployment is running, which optional sources are mounted, and whether the Core command bridge is enabled are operational facts, not repository claims.

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

## It has no business authority — even when it can submit operator commands

Jarvis OS is an **operator client**, not a business authority and not an execution engine. It can
observe bounded live state and, for a small closed set of Core-owned controls, submit an authenticated
operator request to QuickFurno Core. Core performs the current-state validation and is the component
that actually applies or refuses the change.

The split is deliberate:

- **Read path:** adopted, bounded observation adapters populate versioned snapshot sections. Jarvis OS
  receives no database credential and no provider credential.
- **Command path:** a separate Ed25519 identity signs a closed operator command vocabulary. QuickFurno
  Core verifies the signature, freshness, operator identity, idempotency and current revision/state
  before applying anything.
- **Execution/provider path:** Jarvis OS never calls QuickFurno Core Automation, Meta, Groq or another
  delivery provider directly.
- **Governance path:** certification-sensitive settings such as agent enablement, knowledge mode and
  production rollout remain `LOCKED` until a separate governed command path is certified.

The command result deliberately says `jarvisAuthorized: false` even when Core applies a request.
That field is a permanent reminder that the UI did not authorize the action; it asked the authority
to decide.

Ambient configuration remains narrow. Environment variables contain **paths**, never secret key
material. Authentication, Core-read and Core-command key material are loaded from separate bounded
read-only files. Operational adapters may perform only the reviewed network/file reads required by
their contracts; React components never receive credentials and never import database/provider
clients.

The permanent boundary is unchanged and is stated on the surfaces themselves:

> **Jarvis** recommends, reasons, correlates and observes.
> **QuickFurno Core** authorizes and owns business truth.
> **QuickFurno Core Automation** executes approved intents and decides nothing.
> **Providers** deliver and decide nothing; results return to Core.

QuickFurno Core remains authoritative for vendors, customers and leads, packages and pricing,
payments, consent and opt-out, assignments, registration and activation, commercial outcomes,
and every authorization decision. Jarvis OS displays that split on a dedicated screen rather
than assuming a reader knows it.

## Web now, native mobile next — one operator platform

No React Native or Expo application is shipped by this repository yet. The platform boundary for
that app **is** shipped, and the web UI is now its first client rather than a special case.

Three framework-neutral packages define the shared surface:

```
@qf-jarvis/control-plane-read-contract   versioned snapshot DTOs and parsers
@qf-jarvis/operator-api-contract         modules, capabilities, commands and outcomes
@qf-jarvis/operator-client-core          transport-injected client used by web and future iOS/Android
```

The authenticated application exposes the same versioned API the native client will consume:

```
GET  /api/operator/v1/bootstrap
GET  /api/operator/v1/snapshot
POST /api/operator/v1/commands
```

Commands carry an explicit `WEB | IOS | ANDROID` platform field. The shared client core owns
response parsing, protocol correlation and command-outcome semantics; platform adapters own only
transport and secure session storage. A future Expo/React Native client therefore does **not**
reimplement authorization rules, snapshot parsing, idempotency semantics or Core outcomes.

**No business decision lives in a React component.** Components render a versioned read model and
submit versioned operator commands. QuickFurno Core still decides whether a Core-owned action may be
applied. Jarvis-governance actions such as knowledge-mode or rollout changes remain explicitly
`LOCKED` until their separate certified command path exists.

Read trust and command trust are deliberately separate. Jarvis OS uses distinct Ed25519 identities
for the QuickFurno read snapshot and the QuickFurno command bridge, so a credential that can observe
business state cannot automatically mutate it. This separation is preserved for the future mobile
device-session design.

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
| Secrets | Separate read-only auth, Core-read and Core-command files; env vars contain paths only |

**Authentication is not authority.** A signed-in OWNER may view Jarvis OS and may submit only
those operator commands the bootstrap marks `AVAILABLE`. Authentication by itself grants no approval,
communication authorization, dispatch, consent, payment or activation right. For Core-owned commands,
QuickFurno Core still validates current state and either applies or refuses the request.

**Proxy is optimistic; the DAL is the authority.** `src/proxy.ts` mints the CSP nonce and checks
whether a session cookie is present. The protected layout and the snapshot route each verify
properly, close to the data. Delete the proxy and every protected surface stays closed — the tests
prove it by calling the route handlers directly.

**Known limitation, stated rather than implied.** The current web session model is intentionally
single-operator and stateless: a stolen token is valid until it expires or the configuration file is
rotated. Revocation is global — bump `session.revision` or remove a key and every web session dies at
the next request. A durable identity/device-session provider with per-device revocation and step-up
authentication MUST be adopted before multi-operator use or native mobile command access.

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
`conversation.control.write`, `communication.live-send`, `execution.QuickFurno Core Automation.bridge` and
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

Operator controls are capability-driven. Approve, Reject, Take over, Pause AI and Resume AI
become interactive only when the separate Core-command secret is mounted and the bootstrap reports
their capability as `AVAILABLE`. The browser submits a versioned command with CSRF protection; Jarvis
OS signs it with the command-only Ed25519 identity; QuickFurno Core then validates state and returns
`APPLIED_BY_AUTHORITY`, `REFUSED`, `CONFLICT` or `UNAVAILABLE`. Certification-sensitive Jarvis
governance controls remain visibly `LOCKED` rather than being rendered as fake switches.

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
| **JOS-01D** | Isolated Docker image, immutable exact-SHA release topology, Traefik TLS, authenticated operator boundary. |
| **JOS-01E** | Progressive backend read wiring: a governed source-composition boundary, adopted one source at a time. |
| **JOS-01F** | Live command-center layer: worker observation, signed QuickFurno operator observation, attention synthesis, notifications and premium responsive shell. |
| **JOS-01G** | Shared web/mobile operator platform boundary: versioned bootstrap/snapshot/command APIs, framework-neutral client core, split read/command trust lanes and mobile-primary navigation metadata. |

### Mobile-next architecture

Jarvis OS is implemented as the first client of a versioned operator platform, not as the platform
itself. Web-specific code is restricted to rendering, cookie-session adaptation and browser
navigation. The following packages are framework-neutral and are the foundation for the next
React Native / Expo client:

- `@qf-jarvis/control-plane-read-contract` — strict V2 snapshot and provenance.
- `@qf-jarvis/operator-api-contract` — module catalog, platform identity, capabilities, commands
  and results shared by WEB, IOS and ANDROID.
- `@qf-jarvis/operator-client-core` — injected-transport client with no React, Next, DOM,
  filesystem, cookie or Node dependency.
- `@qf-jarvis/quickfurno-operator-observation-contract` — bounded QuickFurno/Core observation
  transport.
- `@qf-jarvis/quickfurno-operator-command-contract` — a separate signed command lane for
  Core-owned operator actions.

The native application must not embed a Jarvis-to-Core signing key. Native authentication will
mint a revocable device session at the Jarvis OS API boundary; Jarvis OS remains the confidential
client that signs QuickFurno transport requests. The current bootstrap therefore reports
`mobileDeviceSession: false` until that device-session boundary is implemented and reviewed.

Read credentials and command credentials are deliberately separate. Compromise of the observation
lane cannot enable a command, and a future mobile read-only role can be issued without any command
capability. QuickFurno remains the authority for approval and conversation state changes; Jarvis OS
submits attributed, idempotent requests and renders the authoritative result.

**After the Jarvis OS foundation track, main Jarvis backend work resumes at QFJ-P09.02** — the
test-only authorized dispatch envelope and QuickFurno Core Automation bridge validation. That marker is rendered on
the Execution and Governance surfaces so it cannot be lost, and a test asserts it is present.

## Deployment topology

**Whether Jarvis OS is currently running is an operational fact this repository does not assert.**
`GET /api/control-plane/v1/snapshot` had no authentication when JOS-01B shipped it; JOS-01C added
that boundary, and JOS-01D supplies the immutable exact-SHA deployment topology and scripts that can
place the route behind the reviewed authenticated Traefik boundary. What is deployed, and when, is
answered by the host — not here. **`apps/api` was not turned into an HTTP server** — it still exports nothing and runs none — and
server components call the request-scoped snapshot loader directly rather than self-fetching; that
loader performs bounded acquisition and normalization, then hands collected observations to the pure
snapshot builder/composer. JOS-01E made that a real guarantee rather than a claim: the page and the
API go through one request-scoped boundary, so neither can compose its own variant and a page can no
longer recite a snapshot built when the process started.

The shared `@qf-jarvis/control-plane-read-contract` package is framework-neutral: zod is its only
dependency, and it carries no Next, React, Node or browser type, no filesystem path, no cookie or
session assumption and no `process.env`. A future React Native / Expo Android client compiles it
unchanged. **No Android files are added in this track.**

**No slice of this track deploys anything by being merged, and JOS-01E changes no deployment
artefact, no Traefik configuration, no DNS record and no container definition.** Shared Traefik,
QuickFurno Core staging and QuickFurno Core Automation are not modified by it. `next.config.ts` sets `output: 'standalone'`
so that the isolated image builds without a configuration change landing alongside a deployment.

Deployment is a separate, governed act: a per-SHA release package is materialised from `git archive`,
every file is verified byte-for-byte against its Git blob before Docker is touched, and the sequence
runs private → ingress → HSTS so the container is proved before any router exists.

Known VPS layout, as audited when the deployment topology was designed:

| Component | Status |
| --- | --- |
| Traefik | Shared ingress |
| `qf-core-staging` | Isolated compose project/network — **temporary** |
| `QuickFurno Core Automation-cjls` | Isolated compose project/network — **permanent** |
| `/srv/qf-jarvis` | **Permanent** Jarvis home |

JOS-01D owns the Dockerfile, the isolated `qf-jarvis` compose project, the private-container
proof, `jarvis.quickfurno.in`, Traefik TLS and the authenticated operator boundary.

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
