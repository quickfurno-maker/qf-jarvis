# Phase 19 — Kubernetes-ready Jarvis artifacts

This package proves that the current signed Jarvis images are portable to Kubernetes. It does not create or authorize a production cluster.

## Scale and authority rules

- Jarvis OS is stateless/read-only and may scale from 2 to 4 replicas with a one-pod-per-minute CPU HPA.
- Gateway remains exactly 2 replicas × 3 PostgreSQL connections.
- WhatsApp worker remains exactly 2 replicas × 5 PostgreSQL connections.
- The resulting 16 application connections exactly match the certified Jarvis Phase 09 application budget. There is intentionally no HPA on gateway or worker until that global budget changes.
- Worker termination grace is 120 seconds, preserving the durable lease/recovery boundary.

## Secret compatibility

Jarvis OS intentionally rejects auth files with any group/other permission bits. Kubernetes Secret volumes are root-owned, so the manifest does not weaken the application check. A narrowly privileged init container, using the same signed Jarvis OS image, copies the projected auth JSON to a memory-backed emptyDir, sets owner 10001:10001 and mode 0600, then exits. The runtime container remains non-root, read-only and capability-free.

## Health and availability

- Jarvis OS startup/readiness use the public-safe `/login` route; liveness is a TCP process check.
- Gateway startup/readiness use `/healthz`; liveness is TCP.
- Worker readiness checks its mounted config plus process liveness; liveness checks PID 1.
- Multi-replica services use `maxUnavailable: 1` PDBs, topology spread and preferred anti-affinity.
- Default-deny networking is the baseline; only DNS, provider HTTPS, PostgreSQL and Redis egress are opened. Public ingress is only Jarvis OS.

## Certification

CI uses an ephemeral Kind v1.31.6 cluster. Jarvis OS is actually started from the exact Phase 18 signed digest with a synthetic production-shaped auth file. Gateway and worker Deployments are API-server validated but held at zero replicas in certification because CI has no real database/provider credentials; separate hardened Jobs run those exact signed images and verify their production runtime artifacts.

No PVC/hostPath business state, production Kubernetes apply, DB migration, traffic cutover or authority expansion is part of Phase 19.
