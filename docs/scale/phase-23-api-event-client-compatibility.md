# Phase 23 — API, Event & Client Compatibility Governance

Jarvis now participates in an explicit N/N-1 compatibility contract with QuickFurno rather than relying on synchronized deployment.

The existing signed `qfj.scale.http` current version remains v1 and the locked V0 coexistence window remains valid until no earlier than 2027-01-05. Accepted gateway requests now return current/minimum compatibility headers; legacy requests additionally receive deprecation and sunset headers. Gateway ingress records `qf.compatibility.requests` telemetry without giving telemetry any authority over request verification.

The canonical event registry remains strict and static: `eventType + eventVersion` identifies one reviewed contract, unknown types/versions fail closed, future versions never fall back, and runtime registration is impossible. Existing registry tests are part of the Phase 23 gate.

A frozen cross-system fixture proves QuickFurno and Jarvis calculate the same body digest and signing input and that N-1 consumers tolerate additive response fields.

Jarvis also runs its own disposable PostgreSQL N/N-1 rehearsal: expand, compatibility write path, bounded backfill, rollback during overlap, reintroduction of N, then destructive contract only after N-1 retirement.

Jarvis gains no QuickFurno business/API authority. No production event schema, production DB, production traffic, or live compatibility window is changed by this phase.

**Next:** Phase 24 — Shadow Migration, Dual-Run & CDC.
