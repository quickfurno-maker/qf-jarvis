# Jarvis OS deployment (JOS-01D, ADR-0088)

Deployment topology for `jarvis.quickfurno.in`. **Gate 1 (this PR) ships artefacts and an audit.
Nothing is deployed.**

## Two gates, deliberately not collapsed

| Gate                                         | What happens                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — this PR**                              | Artefacts written, image built and proved locally from a tracked-only context, VPS audited read-only, runtime image scanned. **No deployment, no DNS change, no Traefik change.** |
| **2 — after this PR is reviewed and merged** | Deploy the exact merged SHA, mount the production secret, activate the router, verify TLS/HSTS/rate limits/auth, prove rollback.                                                  |

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

| File                          | Purpose                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `Dockerfile`                  | Multi-stage build. Base pinned by **digest**; non-root `10001:10001`; no secret; no npm/perl. |
| `compose.production.yml`      | The **private** container. No published port, `traefik.enable=false`. Reachable by nobody.    |
| `compose.ingress.yml`         | Additive overlay: routers, TLS, rate limits. **This is what makes it public.**                |
| `compose.hsts.yml`            | Additive overlay: HSTS, applied only after TLS is proven.                                     |
| `verify-merged-sha.sh`        | Fails closed unless a SHA is well-formed, exists, and is contained in `origin/main`.          |
| `prepare-release.sh`          | Materialises the immutable release package for one SHA and prints its path.                   |
| `verify-release-artifacts.sh` | Proves a release directory IS that commit's configuration, byte for byte.                     |
| `deploy.sh`                   | Gate 2 step 1. Builds one exact merged SHA and starts it **privately**, then proves it.       |
| `activate.sh`                 | Gate 2 steps 2 and 4. Applies the `ingress` then `hsts` overlay, recreating **only** JOS.     |
| `rollback.sh`                 | Gate 2. Re-points **only** the JOS project at a previous immutable tag, at an explicit stage. |
| `smoke.sh`                    | Gate 2. External checks in `pre-hsts` and `final` modes. Fails closed.                        |

### Why the container and its router are separate files

The Docker provider discovers labels the instant a container starts. With router labels in the same
file, the router would be live before the first "private" proof ran — so every check afterwards
would be measuring something already serving the internet. Splitting them is what lets Gate 2 prove
identity, filesystem, capabilities, secret mount and auth boundary **before** exposure.

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

**A release is one SHA across both halves: the application image and the deployment
configuration.** Every step runs from the immutable release directory for that SHA, and every step
re-verifies both before touching Docker.

```bash
SHA=<exact merge commit>

# 1. DNS resolves to the VPS, verified externally
dig +short A jarvis.quickfurno.in            # expect 200.141.10.108

# 2. Secret installed (above)

# 3. Materialise the immutable release package for that commit.
#    Extracts ONLY deploy/jarvis-os from `git archive $SHA` (tracked files only), verifies every
#    byte against Git, and publishes by atomic rename. Prints the directory.
ssh qf-staging "/srv/qf-jarvis/repo/deploy/jarvis-os/prepare-release.sh $SHA"
RELEASE="/srv/qf-jarvis/releases/$SHA/jarvis-os"

# 4. Build and start PRIVATELY. No router exists yet.
#    Verifies the commit is in origin/main AND that this directory is that commit's configuration,
#    then proves revision, uid/gid, read-only rootfs, dropped caps, no-new-privileges, no published
#    port, the secret mount, internal 200/307/401, and NO Traefik routing labels.
ssh qf-staging "$RELEASE/deploy.sh $SHA"

# 5. Make it public — reviewed overlay from the same release, recreates only qf-jarvis-os
ssh qf-staging "$RELEASE/activate.sh ingress $SHA"

# 6. Verify trusted TLS externally. HSTS must still be ABSENT here.
"$RELEASE/smoke.sh" pre-hsts jarvis.quickfurno.in

# 7. Only now attach HSTS — reviewed overlay, recreates only qf-jarvis-os
ssh qf-staging "$RELEASE/activate.sh hsts $SHA"

# 8. Final gate. Fails closed on missing HSTS, wrong max-age, or a duplicate CSP header.
"$RELEASE/smoke.sh" final jarvis.quickfurno.in
```

There is **no shared mutable deployment directory.** The verifier refuses any package that does not
sit at `/srv/qf-jarvis/releases/<SHA>/jarvis-os`, so a hand-edited copy cannot be deployed from —
and there is no fallback path to fall back to.

**HSTS is a reviewed file, not a production edit.** `compose.hsts.yml` holds
`stsSeconds=31536000`, `stsIncludeSubdomains=false`, `stsPreload=false`, `forceSTSHeader=false`.
It is applied last because HSTS sent before a valid certificate exists pins browsers to a hostname
that does not yet serve HTTPS, and the pin outlives the mistake.

## Rollback restores both halves

```bash
/srv/qf-jarvis/releases/<PREVIOUS_SHA>/jarvis-os/rollback.sh <PREVIOUS_SHA> <private|ingress|hsts>
```

It uses **`PREVIOUS_SHA`'s own release package**, not the compose files beside whatever script you
happen to run. Re-pointing only the image would combine an old known-good image with today's
hardening, Traefik labels, HSTS values and rate limits — and if today's configuration is the fault
being rolled back from, that "rollback" carries the fault along.

It verifies the previous package byte-for-byte against Git first, and **fails closed** if the
package is missing or altered, telling you to restore it with `prepare-release.sh`. It never
fetches and never rebuilds: an emergency is not the moment to depend on a reachable remote, and
`main` may itself be broken.

The stage is required, not defaulted: `private` would silently drop HSTS from a host whose browsers
have already been told to refuse plain HTTP, and the full set would silently expose a container
that was still private. After bringing the container up it verifies the revision **and** that the
container actually landed in the stage that was named.

It prunes nothing; `system prune`, `image prune -a`, `volume prune` and `network prune` would all
reach shared Traefik, n8n and Core resources.

## Runtime image vulnerability disposition

Digest pinning gives reproducibility, not absence of vulnerabilities. Docker Scout on the first
image found **3 CRITICAL / 6 HIGH**, every one in the base image's build toolchain and **none** in
the application's traced `node_modules`. The pinned digest is already the current published digest
for `node:24.18.0-bookworm-slim`, so there was no fixed base to move to.

The runtime never installs a package, so the toolchain was removed: npm, npx, corepack and `perl`.

|                      | Before | After |
| -------------------- | ------ | ----- |
| CRITICAL             | 3      | 2     |
| HIGH                 | 6      | 2     |
| **Fixable CRITICAL** | 1      | **0** |
| **Fixable HIGH**     | 4      | **0** |

The 4 residual findings are all in `perl-base` (`Essential: yes` — dpkg requires it) and all report
**"Fixed version: not fixed"** for this base. Precisely: **no fixed package is currently available
in Debian bookworm for this pinned runtime base** — not that no fix exists anywhere; some of these
CVEs are fixed on newer Debian branches, and reaching them means leaving the pinned Node version.

Accepted on that basis: nothing in the request path invokes perl, and the container is non-root on a
read-only root filesystem with all capabilities dropped.

**The image is not vulnerability-free and is not claimed to be.** This scan is point-in-time and
must be re-run immediately before Gate 2 production activation.

## What this phase does NOT change

Authentication (JOS-01C) remains the access boundary. QuickFurno Core stays authoritative and
`NOT_CONNECTED`; n8n stays execution-only and `NOT_CONNECTED`. No database, no managed database, no
Meta or provider, no business mutation, no migration. **Production business rollout remains OFF.**
