# Jarvis Phase 16 placement and HA contract

## Locked placement

Jarvis and central AGNI are colocated initially on one larger dedicated VPS.

QuickFurno remains on its own dedicated VPS and must continue operating if the Jarvis/AGNI host is unavailable.

## Logical isolation on the shared Jarvis/AGNI host

- Jarvis and AGNI remain separate Docker projects.
- Networks are separate unless an explicitly reviewed integration edge is required.
- Resource limits and bounded logging remain mandatory.
- Credentials and secrets remain separate.
- Release manifests and rollback controls remain separate.
- Jarvis application containers do not receive a Docker socket.
- AGNI's raw Docker socket is limited to its governed restart-guard component and is not exposed to Jarvis or the AGNI control plane.

## Multi-host readiness

Jarvis is not being expanded to multiple production VPSs in Phase 16. The runtime must nevertheless remain portable:

- gateway turn durability stays in PostgreSQL;
- workers remain multi-replica safe;
- host-local observation files are non-authoritative operational snapshots only;
- correctness cannot depend on local observation files;
- immutable release artifacts from Phase 15 remain mandatory.

## Safety

Phase 16 makes no production traffic cutover, no production database migration and grants AGNI no additional production authority.
