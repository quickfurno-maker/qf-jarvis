# Jarvis OS deployment (JOS-01D, ADR-0088)

Deployment topology for `jarvis.quickfurno.in`. **Gate 1 (this PR) ships artefacts and an audit.
Nothing is deployed.**

## Two gates, deliberately not collapsed

| Gate                                         | What happens                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — this PR**                              | Artefacts written, image built and proved locally from a tracked-only context, VPS audited read-only. **No deployment, no DNS change, no Traefik change.** |
| **2 — after this PR is reviewed and merged** | Deploy the exact merged SHA, mount the production secret, activate the router, verify TLS/HSTS/rate limits/auth, prove rollback.                           |

The split exists so the artefacts are reviewed _before_ anything is exposed. A deployment that
arrives with its own review is a deployment nobody reviewed.

## What the audit found (Gate 1, read-only)

The VPS already has the topology Jarvis OS needs, so **shared Traefik is not modified at all**:

- Traefik **3.7.10**, `network_mode: host`, image tag `traefik:latest`
- `--providers.docker=true` with `--providers.docker.exposedbydefault=false` — labels are opt-in
- Entrypoints `web` (:80) and `websecure` (:443); HTTP→HTTPS redirect already global on `web`
- Cert resolver `letsencrypt`, HTTP-01 challenge, storage `/letsencrypt/acme.json` (0600 root)
- `--api.dashboard=false --api.insecure=false` — dashboard is **not** exposed
- Docker socket mounted **read-only**

`qf-core-staging` and `n8n-cjls` both sit on private bridges with **no published ports**, and
host-network Traefik reaches them by container IP. Jarvis OS uses that exact pattern.

> **The configured image is `traefik:latest`.** Any `docker compose pull`/`up -d` against the
> Traefik project would silently upgrade shared ingress for every service on the host. Gate 1 runs
> none of those, and Gate 2 must not either — JOS routing arrives entirely through labels on the
> JOS container, which the running Traefik picks up without a restart.

## Files

| File                     | Purpose                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `Dockerfile`             | Multi-stage build. Base pinned by **digest**; non-root `10001:10001`; no secret.             |
| `compose.production.yml` | Hardened service, **no published port**, Traefik labels, secret bind-mount.                  |
| `deploy.sh`              | Gate 2. Builds one exact SHA from a `git archive` context and verifies the running revision. |
| `rollback.sh`            | Gate 2. Re-points **only** the JOS project at a previous immutable tag.                      |
| `smoke.sh`               | Gate 2. External checks: DNS, TLS, redirect, 401, headers, no direct port.                   |

## Security posture

- Non-root `10001:10001`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `pids: 256`
- Writable set is exactly `/tmp` (tmpfs, `noexec,nosuid,nodev`, 64 MiB)
- **No published port.** No `0.0.0.0` binding, no loopback fallback needed
- Its own bridge; joins no n8n, Core or database network
- No Docker socket, no privileged, no capabilities, no host PID/IPC, no devices
- Bounded logs (10 MiB × 5) and resources (1 CPU, 1 GiB)
- Image tagged by exact Git SHA — never `latest`

**The healthcheck means one thing: the Node process answers HTTP.** It does not mean the auth
config is valid, TLS works, DNS resolves, or Core and n8n are reachable — the container cannot
honestly assess any of those. External readiness is `smoke.sh`, in Gate 2.

## Gate 2 — the production secret

Generated on the owner's machine, **outside the repository**, and never committed:

```bash
pnpm --filter @qf-jarvis/jarvis-os auth:bootstrap -- --output ~/qf-jarvis-os-auth.json
```

The tool prompts for the passphrase with echo disabled (it refuses `--password`), generates the
TOTP secret and session key, and prints the enrolment secret exactly once. Enrol the authenticator
before continuing, then clear the terminal scrollback.

Transfer and install:

```bash
scp ~/qf-jarvis-os-auth.json qf-staging:/tmp/jos-auth.json
ssh qf-staging '
  install -o 10001 -g 10001 -m 0400 /tmp/jos-auth.json /srv/qf-jarvis/secrets/jarvis-os-auth.json &&
  shred -u /tmp/jos-auth.json &&
  ls -la /srv/qf-jarvis/secrets/'
```

Never `cat` the file. Keep an encrypted backup outside Git. UID/GID **10001 are free on the host**
(verified in the audit) and are created implicitly by ownership — the container user is what reads
the file.

## Gate 2 — DNS prerequisite

`jarvis.quickfurno.in` currently has **no A record** (verified against 1.1.1.1). The VPS public
IPv4 is **200.141.10.108**, confirmed both from the host and from the working
`staging-core.quickfurno.in` record.

Required owner action before Gate 2 — Let's Encrypt HTTP-01 cannot issue without it:

```
Type: A      Host: jarvis      Value: 200.141.10.108      TTL: 600 (or provider default)
```

Do not change `quickfurno.in`, `www`, `staging-core` or the n8n hostname.

## Gate 2 — sequence

```bash
# 1. DNS resolves to the VPS, verified externally
dig +short A jarvis.quickfurno.in            # expect 200.141.10.108

# 2. Secret installed (above)

# 3. Deploy the exact merged SHA
ssh qf-staging '/srv/qf-jarvis/deploy/deploy.sh <exact-merged-sha>'

# 4. Private proof BEFORE the router is trusted
ssh qf-staging 'docker exec qf-jarvis-os id'          # uid=10001
ssh qf-staging 'docker inspect qf-jarvis-os --format "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}"'

# 5. External smoke
./smoke.sh jarvis.quickfurno.in

# 6. HSTS only AFTER TLS is confirmed working (add the middleware label, recreate JOS only)
```

**HSTS is deliberately absent until TLS is proven.** Sending it before a valid certificate exists
pins browsers to a hostname that does not yet serve HTTPS, and the pin outlives the mistake.

Rollback: `./rollback.sh <previous-sha>` — re-points only the JOS project. It prunes nothing;
`system prune`, `image prune -a`, `volume prune` and `network prune` would all reach shared
Traefik, n8n and Core resources.

## What this phase does NOT change

Authentication (JOS-01C) remains the access boundary. QuickFurno Core stays authoritative and
`NOT_CONNECTED`; n8n stays execution-only and `NOT_CONNECTED`. No database, no managed database, no
Meta or provider, no business mutation, no migration. **Production business rollout remains OFF.**
