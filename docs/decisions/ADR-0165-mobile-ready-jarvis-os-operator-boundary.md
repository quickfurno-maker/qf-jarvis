# ADR-0165 — Mobile-ready Jarvis OS operator boundary

- **Status:** Accepted
- **Date:** 2026-09-24
- **Owners:** QF Jarvis / QuickFurno
- **Scope:** Jarvis OS web control plane and future native mobile clients

## Context

Jarvis OS began as a deliberately powerless authenticated read surface. That preserved authority boundaries, but most screens remained repository baselines because no governed production observation path connected QuickFurno business state or the production worker.

The next product step is a native mobile application. Duplicating business logic, navigation semantics, authority rules, or data contracts inside React Native would create a second control plane and a second source of truth.

## Decision

Jarvis OS web and future iOS/Android clients SHALL share a framework-neutral Operator API contract. The contract defines client platforms, module catalog, bootstrap capabilities, command envelopes, and command results. React/Next and future React Native code remain presentation/transport adapters only.

The shared operator surface uses versioned endpoints:
- `GET /api/operator/v1/bootstrap` — module catalog, client capability, and command readiness.
- `GET /api/operator/v1/snapshot` — the same governed Control Plane Snapshot V2 used by server-rendered web pages.
- `POST /api/operator/v1/commands` — command requests only; a request is never an authorization.

QuickFurno exposes a separate signed read-only operator observation endpoint. Jarvis OS accesses it using a dedicated Ed25519 read identity whose public verification key is configured separately from Jarvis action-signing trust. A compromised read client therefore does not inherit a credential trusted to propose or authorize business actions.

Jarvis OS receives no QuickFurno database credential, Meta credential, provider credential, or business-authority bit. QuickFurno returns bounded aggregate or masked operational state only. Content-free worker observations remain a separate read-only source.

## Authority and command rules

QuickFurno Core remains authoritative for business truth, approvals, conversation control, consent, commercial state, and execution eligibility. Jarvis governance remains authoritative for agent configuration, knowledge mode, and rollout certification.

A command capability is `AVAILABLE`, `LOCKED`, or `NOT_CONNECTED`. The UI MUST NOT render a functional command simply because a button exists. Until an authority bridge is reviewed and connected, the shared command endpoint fails closed with `authorized:false`.

Knowledge-mode changes remain certification-lineage changes. Production rollout remains separately owner-authorized and certification-gated.

## Mobile consequences

Native clients consume the same module catalog, snapshot contract, provenance semantics, and command envelopes as web. Mobile device sessions are explicitly disabled until a dedicated device-authentication design is reviewed. Cookie/session behavior from the web client must not be copied into native clients.

The mobile application may add offline presentation caches later, but cached values must retain source timestamps and provenance and must never be relabelled as live.

## Security consequences

The only reviewed outbound HTTPS source inside Jarvis OS is the signed QuickFurno operator-read adapter. All database/provider clients remain forbidden. Read-source ownership is section-bounded, freshness-window checked, response-size bounded, and fail-closed.

Production deployment mounts operator auth, operator-read identity, and worker observations read-only. Worker observation uses a directory bind because atomic rename would make a single-file bind stale.

## Result

Jarvis OS becomes a live, premium operator control plane without becoming a business authority. Web is the first client; native mobile is a planned peer client of the same contracts rather than a rewrite.
