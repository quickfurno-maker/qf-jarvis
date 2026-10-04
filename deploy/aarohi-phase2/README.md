# Aarohi Phase 2 production container role

Aarohi Phase 2 uses the **same immutable Jarvis worker image** as the WhatsApp worker, with an
explicit command override. This keeps one certified worker filesystem while allowing the process
roles to scale and fail independently later.

## Safety contract

- The service is behind the `aarohi-phase2` Compose profile and is not started by a plain
  `docker compose up`.
- The production config remains the authority for activation. With `enabled: false`, the process
  prints `DISABLED` and exits successfully.
- No public port or Traefik router exists.
- The Core signing key and worker config are bind-mounted read-only.
- Provider bearer-token files are **not** mounted by this base definition. When a provider is
  formally approved, its credential must be added through a reviewed provider-specific overlay.
- The image carries no provider secret and this Compose file activates no provider.

## Start only after explicit activation approval

```bash
QFJ_WORKER_IMAGE_TAG=<exact-merged-sha> \
docker compose -f deploy/aarohi-phase2/compose.production.yml \
  --profile aarohi-phase2 up -d
```

Do not use a mutable tag. Do not enable the config merely to test the container. Container
certification uses a temporary disabled config.
