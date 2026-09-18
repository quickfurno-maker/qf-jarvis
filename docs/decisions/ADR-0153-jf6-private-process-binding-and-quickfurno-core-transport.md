# ADR-0153 — JF-6: private process binding and QuickFurno Core transport composition

- **Status:** Accepted for **INTERNAL_SHADOW / NON-AUTHORIZING** deployment preparation only.
  This ADR does not approve production activation, a provider release, or a customer-facing rollout.
- **Date:** 2026-09-15
- **Baseline:** `origin/main` at `59052d8c4aaf754f3ca360b7a59037b00f5c0f44`, the merge of PR #204
  (signed QuickFurno Core decision HTTP transport). Migrations remain `0001`–`0014`; JF-6 adds none.
- **Governed by:** ADR-0147 (production activation gate), ADR-0148 (governed RAG), ADR-0149/0150
  (customer and three-agent runtime composition), ADR-0151/0152 (provider readiness/certification).

## Context

Before this slice, Jarvis already had the hardened private Riya `RequestListener`, the channel-neutral
customer runtime, the Core decision adapter, and the signed QuickFurno Core HTTP transport. What it did
not have was the narrow process seam that actually binds the already-reviewed listener, reports
readiness, and injects the concrete Core transport into the existing Core decision adapter.

That gap must be closed without turning process binding into production approval. JF-5B still lacks a
fully qualifying Nara result, JF-5C has not sealed production evidence, and ADR-0147 explicitly forbids
`AUTO` production activation until all providers that can answer have production evidence.

## Decision

### 1. One explicit private process binder

`apps/api/src/jf6-private-process/create-private-process.ts` is the only new production file permitted
to call `createServer` / `listen`. The existing private Riya ingress remains a listener factory only and
continues to bind nothing by itself.
The binder accepts only `127.0.0.1`, `::1`, or `localhost`. `0.0.0.0`, arbitrary LAN addresses, and
public addresses are refused at construction. It reads no environment, selects no port by convention,
and starts nothing merely because the module was imported or composed.

### 2. Lifecycle is explicit and fail-closed

Construction returns `STOPPED`. `start()` is the only operation that can create and bind the server.
A second start is refused. `stop()` closes the bound server and is idempotent once stopped. Listen and
close failures map to the closed JF-6 error vocabulary; raw network errors do not become authority.

The HTTP server carries bounded request, header and keep-alive timeouts. It adds no retry loop, polling
loop, watcher, scheduler, provider fallback, or background worker.

### 3. Readiness states facts, not approval

The content-free readiness endpoint is `/internal/jarvis/readiness`. It reports the exact repository
revision injected by the trusted process composition plus lifecycle state and mode.

The mode is permanently `INTERNAL_SHADOW` in this slice and the response permanently carries
`productionAuthorizing: false`. A healthy process therefore cannot be mistaken for an approved
production release. Readiness is `200` only while the listener is actually `READY`; otherwise it is
non-ready. Responses are no-store, set no cookie, and add no browser/CORS affordance.

### 4. Every non-readiness request delegates to the reviewed ingress

The binder contains no Riya behavior, classification, model, RAG, Core, persistence, or business rule.
After the readiness path check it delegates exactly once to the injected private ingress listener. The
existing ingress remains responsible for its path, method, signature, replay, body and classification
gates.

### 5. QuickFurno Core remains the sole acceptance authority

`create-core-decision-boundary.ts` only joins `createQuickFurnoCoreTransport` to the existing
`createCoreDecisionAdapter`. The HTTP transport signs one bounded request; the adapter still applies its
pre-transport state gate, strict response identity validation, and post-response state gate.

No JF-6 code can manufacture `ACCEPTED`, upgrade `REJECTED`, bypass stale state, or skip the adapter.
A blocked conversation causes zero HTTP calls. A malformed, mismatched, unavailable or timed-out Core
response remains fail-closed exactly as before.

### 6. The transport is connectivity, not business authority

The API gains one workspace dependency: `@qf-jarvis/core-decision-http-transport`. It introduces no new
third-party package. The transport holds the injected Ed25519 signing key only for the bounded Core hop,
reads no environment, opens no database, calls no QuickFurno Core Automation surface, and selects no model or provider.

Production QuickFurno credentials, URLs and key material are not committed in this repository and are
not introduced by this ADR. JF-6 does not add a credential acquisition policy for them.

### 7. Containment is narrowed, not relaxed

The repository-wide credential/network containment scan names the JF-6 binder explicitly as the one new
production `node:http` exception. The older private ingress still cannot call `createServer` or
`listen`. The two JF-6 loopback integration specs are named explicitly beside the existing ingress HTTP
spec; every other spec remains barred from network-capable modules and `fetch`.

Package-root runtime API counts remain unchanged. `apps/api` still exports zero runtime symbols from its
package root. Migrations remain byte-locked through `0014`, with no `0015`.

### 8. What this slice proves

It proves that an already-composed Jarvis/Riya handler can be bound on a private loopback process, can
report truthful readiness, and can use the signed QuickFurno Core decision transport through the existing
Core adapter without adding a second authority path.

It does **not** prove provider quality, production capacity, external networking, managed-database
parity, production key distribution, QuickFurno deployment, or production operator approval.

### 9. Production activation remains blocked

Real Nara qualification remains deferred by owner decision. Therefore the final JF-5B all-six
provider/agent certification, blinded human review, Nara data-control acceptance, JF-5C production seal,
and JF-6 production activation are not satisfied by this branch.

Authenticated production operator controls and their durable audit trail remain a production-activation
requirement under ADR-0147. They are not fabricated for an internal shadow process simply to make the
phase appear closed.

### 10. Exit for this branch

This branch may merge only after focused JF-6 lifecycle/Core tests, repository containment, full unit
and integration gates, build/dist containment, and exact-head Linux CI all pass. After merge, the merged
SHA may be recorded as an **INTERNAL SHADOW / NON-AUTHORIZING** QuickFurno-integration baseline.

That baseline is permission to test the cross-repository handshake with all production activation gates
still closed. It is not permission to serve customer-facing AI traffic.

## Consequences

Positive: Jarvis gains the smallest honest process/deployment seam needed for shadow QuickFurno
integration, while the old ingress and Core adapter keep their existing responsibilities and authority
boundaries.

Negative, and accepted: production still cannot be declared ready until the deferred provider and
human/operator sealing gates are complete. That is a truthful dependency, not unfinished binder code.
