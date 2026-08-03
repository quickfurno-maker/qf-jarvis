# ADR-0086 — JOS-01B Jarvis OS Read-Only Control-Plane Contract and Snapshot API

**Status:** Accepted — JOS-01B (a versioned read contract, a pure snapshot builder and one GET route; no authentication, no deployment, no live source, no mutation, no migration, no managed database)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md) · [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md)

## Context

Baseline: `main` at `b90073cc30ff46a125c698f83ca8bb303a276ee7`, the merge of PR #88 (JOS-01A). Collision
checks on that baseline: `ADR-0086` unclaimed — its only occurrence anywhere was inside ADR-0085's
own collision note recording it as free — no `packages/control-plane-read-contract`, no reference to
`@qf-jarvis/control-plane-read-contract`, zero open PRs; migrations `0001`–`0009` with no `0010`,
`0009` at `e834bc3c…`.

JOS-01A shipped a premium operator surface backed by a synthetic fixture. It was labelled honestly —
a banner on every page, `-DEMO-` in every identifier — and it was still the wrong default.

The reason is specific. A control plane is read to answer questions like _is anything waiting for
me?_ and _is the model gateway healthy?_, and the answer an operator retains is the **number**, not
the banner above it. JOS-01A's approval desk showed five requests waiting; its overview showed 1,284
conversations and a latency curve. None of those described anything. The moment that surface is
opened next to a real incident, the demo becomes indistinguishable from data, and the failure is
silent: nobody reports a dashboard that looks fine.

There is a second, subtler version of the same defect, and it is the one that outlives the fixture:
**an empty array reads as zero.** If the approval queue is unreachable and the surface renders an
empty table, an operator concludes there is nothing waiting. "There are no pending approvals" and
"nobody has connected the approval source" are opposite facts, and a bare `[]` expresses both.

JOS-01B fixes both, and does it behind a contract that a future Android client can share.

## Decision

### 1. A framework-neutral read contract, in its own package

`@qf-jarvis/control-plane-read-contract`: **four** root runtime symbols — a version constant, an
error-code list, one error class, one parse function. Its only dependency is zod. There is no Next,
no React, no Node API, no filesystem, no network, no clock, no database, no provider, no Core or n8n
client and no `process.env`.

That constraint is what makes the Android position real rather than aspirational. A React
Native/Expo client compiles this package unchanged and inherits the same shapes, the same version
and the same rules, instead of growing a second definition of what the operator surface means. **No
Android files are added in this phase.**

The schemas are deliberately **not** exported. If callers could compose sub-schemas they would build
half-validated shapes, and the single-entry guarantee — everything that reaches a surface went
through `parseControlPlaneSnapshotV1` — would quietly stop holding.

### 2. The contract cannot express authority

There is no `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `approvalGranted` or
`dispatchAllowed` anywhere in it; every object is `.strict()`, so there is nowhere to add one without
editing the contract and failing review; `rollout.enabled` is the literal `false`; and there are no
methods, because a JSON contract with a method is an API client and an Android app parsing this must
receive data and nothing that can act.

The authority boundary is restated **on every snapshot** as four literals — Jarvis
`RECOMMENDS_AND_OBSERVES`, QuickFurno Core `AUTHORIZES_AND_OWNS_BUSINESS_TRUTH`, n8n `EXECUTES_ONLY`,
provider `DELIVERS_ONLY`. A snapshot claiming otherwise cannot be parsed.

Every string is length-bounded and every array size-bounded. Unbounded fields are how a stack trace,
a raw message body or an entire table ends up rendered in a browser.

### 3. Availability is part of the data: unreadable is not empty

Every operational section carries `{ availability, reason, expectedSource, items }`, where
availability is `AVAILABLE`, `STATIC_BASELINE`, `NOT_CONNECTED`, `PLANNED` or `ROLLOUT_OFF`. A
top-level refinement **rejects** any `NOT_CONNECTED`/`PLANNED`/`ROLLOUT_OFF` section that carries
rows, and any unavailable series that carries points — so a chart cannot draw a flat zero line for a
source nobody connected.

This is the load-bearing design decision of the phase. It makes the ambiguous empty array
unrepresentable rather than merely discouraged.

### 4. One pure builder, two callers — and no self-fetch

`buildControlPlaneSnapshot({ generatedAt })` reads no clock, no environment, no file, no network
and no database, and is deterministic. It validates its own output through
`parseControlPlaneSnapshotV1` before returning, so the server holds itself to exactly what a client
enforces and fails closed on an invalid construction.

A server component calling its own HTTP route would add a hop, a failure mode and a second source
of truth; the page and the route are two callers of one function, which is why they cannot drift.

### 4a. Generation time is not source freshness

`generatedAt` answers **when this JSON was produced**. `source.freshness` answers **when the
underlying facts were last actually observed**. They are different questions and the contract keeps
them apart.

An earlier revision of this phase conflated them: the builder accepted `freshness` as a parameter
and the route passed `REQUEST_TIME`, so every response labelled a compiled-in repository baseline as
request-time fresh. That is wrong in a way that matters. A deployed binary could be a week old,
answer every call with a brand-new timestamp, and still be reciting facts fixed when it was built —
while the payload asserted they had just been read. The request re-read no Git, no governance
document, no QuickFurno Core, no n8n and no adapter.

The correction has three parts, and the third is the one that lasts:

1. The field is named `generatedAt`, so its meaning is not open to interpretation.
2. The builder **derives** the source block instead of accepting it. A caller may vary the envelope
   instant and nothing else.
3. The **parser** enforces the cross-field invariants, so no future caller on any platform can
   construct the claim even if the builder is bypassed:
   - `REPOSITORY_BASELINE` ⇒ `BUILD_DECLARATION`, `liveOperationalData: false`
   - `DEMO_FIXTURE` ⇒ `BUILD_DECLARATION`, `liveOperationalData: false`
   - `LIVE_ADAPTER` claiming live data ⇒ `REQUEST_TIME`

There is deliberately no source-level `NOT_CONNECTED` freshness. Connectivity is a per-section fact
and `SectionAvailability` already owns it; a second, coarser copy could only disagree with the
sections beneath it.

### 4b. Roadmap markers carry a track, and the running slice is `current`

Markers carry `track: QFJ | JOS` and `state: merged | current | next | planned`.

`track` exists because the two tracks advance independently: a single flat list cannot say
"QFJ-P09.02 is next" and "JOS-01C is next" at the same time without one of them being wrong.

`current` exists because `next` was wrong for the slice a build is actually running. Marking
JOS-01B as `next` inside a build that **is** JOS-01B was false the day it shipped and would have
stayed false. `current` describes the software slice compiled into this build — not a GitHub merge
state, which the repository is the wrong place to track and which invalidates itself the moment a
pull request lands. The same reasoning governs the architecture documents: they describe build and
architecture state, and leave merge state to GitHub.

### 5. `GET /api/control-plane/v1/snapshot`, and nothing else

Only `GET` is exported, so the App Router answers every mutating verb with `405` — the absence is the
enforcement. Responses carry `no-store`, `nosniff`, `Referrer-Policy: no-referrer`, a contract-version
header, and **no CORS header at all**: not a wildcard, not an echo of `Origin`. Until JOS-01C adds
authentication, the correct CORS policy is silence.

Query parameters are **rejected**, not ignored. Ignoring unknown parameters is how `?tenant=other`
becomes a supported feature nobody designed. Failures return a fixed body with no code, message,
stack or field path from the thrown value.

**`apps/api` is not turned into an HTTP server.** It still exports nothing and still runs none. The
route is an operator-surface BFF over declarations this repository already makes — not Core, not
business truth, not an integration point.

### 6. The default surface is the repository baseline

`controlPlane()` now returns a baseline read model, `kind: 'baseline'`. QuickFurno Core and n8n both
report `NOT_CONNECTED`; approvals, conversation control, workload, latency, models, knowledge,
evaluations, business analytics and n8n execution all carry no rows and state why; Aarohi's funnel is
`PLANNED` and empty. What the baseline **does** state is checkable against merged artifacts: four
governed agents, the capability inventory, rollout OFF, QFJ-P09.01 merged, QFJ-P09.02 next, the
Aarohi AVG overlay planned, the ownership boundary and the JOS phase track.

The demo fixture is retained for tests and visual fixtures, reports `DEMO_FIXTURE`, and is asserted
never to be the default again.

## Rejected alternatives

**Make `apps/api` an HTTP server and have Jarvis OS fetch it.** Rejected. It would turn a
composition root that deliberately exports nothing into a network surface, before authentication
exists, to serve data that lives in the same repository.

**Keep bare arrays and add a page-level "some data may be unavailable" banner.** Rejected. Operators
stop reading banners; they do not stop reading numbers. Availability belongs to the section, next to
the thing it qualifies, and enforced by the parser.

**Render zeroes for unconnected sources and label them.** Rejected outright — this is the exact
defect. A zero is a measurement.

**Define the contract inside `apps/jarvis-os`.** Rejected. An Android client cannot import from a
Next.js app, and a contract that lives in one client is not a contract.

**Have server components fetch the route.** Rejected: a network hop, a new failure mode, and two
paths that can disagree, for no benefit.

## Consequences

- The surface is mostly `NOT_CONNECTED`, and looks it. That is the honest state of the system.
- Adding a live adapter later is a `source.kind` change plus one implementation; no page changes.
- Jarvis OS may now import exactly one workspace package. The containment rule is **narrowed** to
  that allowlist rather than dropped, and every backend package remains forbidden.
- The route exists in source and is **not deployed**. JOS-01C adds authentication; JOS-01D deploys.

## Non-goals

No authentication, session, cookie or operator identity. No live Core, n8n, Meta or provider access.
No database of any kind, managed or local. No migration — `0010` is not created. No deployment, DNS,
Traefik or VPS change. No Android files. No change to QFJ-P09.01 execution-intent semantics.
Production rollout remains **OFF**.

## Change-control rule

`contractVersion` is `"1"`. A breaking change to the snapshot shape requires a new version and a
superseding ADR, not an edit in place — a shipped Android client cannot be asked to re-parse. Adding
an authority field, a credential field, a contact detail or an unbounded value is prohibited at every
version.
