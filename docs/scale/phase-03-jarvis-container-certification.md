# Phase 03 — Jarvis production container certification

Status: implementation / certification

Baseline source SHA: `7101b3c7cae2cfe384c416ad870cc1dbe4458253`

## Runtime role map

| Role                                     | Production state          | Container boundary                                   | Phase 03 classification                             |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| Jarvis OS                                | active                    | `deploy/jarvis-os`                                   | certified hardened runtime                          |
| QuickFurno ↔ Jarvis gateway              | active                    | `deploy/quickfurno-gateway`                          | certified hardened runtime                          |
| WhatsApp / Riya / Anisha governed worker | active                    | `deploy/quickfurno-worker`                           | certified hardened SINGLE_OWNER runtime             |
| Aarohi Phase 2 acquisition worker        | disabled / providers off  | shared worker image + `deploy/aarohi-phase2` command | container-ready, not activated                      |
| Proactive worker                         | dormant library/app only  | none in production                                   | not a current production runtime                    |
| Temporal worker                          | not deployed              | none in production                                   | container gate required before activation           |
| LiveKit voice agent                      | optional separate feature | `deploy/livekit-voice-agent`                         | outside current marketplace text-runtime activation |

## Authority boundary

Containerization changes deployment mechanics only.

Jarvis may reason, orchestrate and produce proposals. QuickFurno Core remains the only business
authority for authorization, marketplace truth and effect execution.

## State classification

### Durable correctness state — blocks horizontal ownership today

The gateway and WhatsApp worker share `/var/lib/qfj-turns`, backed by the host
`/srv/qf-jarvis/state/quickfurno-gateway-turns`.

The current implementation is a filesystem durable spool with atomic file creation/rename. This is
valid for the current single-owner host topology. It is **not** certified for multi-host ownership.

The production worker configuration therefore remains hard-locked to:

```text
deploymentMode: SINGLE_OWNER
```

Phase 03 deliberately keeps that lock. Phase 07/12 must replace or wrap this spool with a shared
atomic ownership primitive and certify ordering/replay/lease semantics before N active owners are
allowed.

### Replaceable telemetry/control state

- worker observation snapshots
- agent-flow trace snapshots
- release-assurance receipts
- local kill-switch/control files

These are operational surfaces, not canonical business truth. Phase 13 externalizes/coordinates
them where required for multi-host operation.

## Aarohi image strategy

Aarohi does not need a duplicate image. The existing worker image already contains
`apps/api/dist/bin/run-aarohi-phase2-worker.js`.

The tracked Aarohi Compose definition therefore uses the same exact-SHA worker image and overrides
the command. Benefits:

- one worker dependency graph to certify
- no image drift between WhatsApp and Aarohi
- independent process/container scaling remains possible
- provider activation remains an explicit config + secret overlay decision

The base Aarohi Compose definition mounts no provider bearer tokens. Current production config is
disabled with zero providers.

## Certification requirements

CI must prove:

1. Node base images are digest-pinned.
2. runtime images are non-root and carry the exact Git revision.
3. production Compose roles are read-only, capability-dropped, resource-bounded and log-bounded.
4. gateway/worker containers are private by default.
5. the filesystem durable spool is still classified and `SINGLE_OWNER` remains enforced.
6. Aarohi uses the same immutable worker image, an explicit profile and no ingress.
7. the three active image families build from a clean checkout.
8. a disabled Aarohi process starts from the worker image, prints `DISABLED` and exits 0.
9. existing repository quality/certification tests remain green.
10. pull-request image identity is bound to the actual PR head SHA, never GitHub's synthetic merge SHA.

## Explicit non-goals

- no Jarvis production deployment
- no provider activation
- no Aarohi activation
- no removal of `SINGLE_OWNER`
- no shared multi-host durable-turn design in Phase 03
- no Temporal/proactive production activation
