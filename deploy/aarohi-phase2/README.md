# Aarohi Phase 2 production container

This deployment packages the already-governed Aarohi acquisition worker as a private,
non-authoritative Jarvis runtime role.

## Authority

Aarohi may discover candidates, ingest structured social signals and submit signed proposals to
QuickFurno Core. It does not approve a vendor, activate an account, debit/credit a wallet, bypass
consent, or send an ungoverned business effect.

## Image lineage

The role deliberately reuses the same exact-SHA API-worker image built from
`deploy/quickfurno-worker/Dockerfile`. The image already contains `apps/api/dist`; this Compose
file overrides only the command.

This avoids a second nearly-identical Dockerfile and dependency graph drifting away from the
WhatsApp worker.

## Secret boundary

Create a dedicated host directory:

`/srv/qf-jarvis/secrets/aarohi-phase2`

Only Aarohi Phase 2 files belong there. It is mounted read-only as
`/run/secrets/aarohi-phase2`.

The worker config is:

`/run/secrets/aarohi-phase2/worker.json`

Provider bearer-token files and the QuickFurno signing key referenced by that config must also live
inside the same dedicated mount. Never mount the generic Jarvis secret directory.

## Disabled-by-default behavior

`enabled: false` causes the executable to print `qfj-aarohi-phase2-worker DISABLED` and exit 0.
The Compose restart policy is `on-failure:5`, so a disabled worker does not restart-loop.

Enabling providers remains a separately governed activation decision. Deploying this container
definition does not activate Instagram, Facebook, X, Google, Justdial, IndiaMART or any other
provider.

## Scaling boundary

This phase makes the runtime reproducible and container-safe. It does not claim multi-owner
conversation semantics or permission to exceed QuickFurno Core governance. Provider concurrency,
distributed scheduler ownership and horizontal agent scaling remain later scale phases.
