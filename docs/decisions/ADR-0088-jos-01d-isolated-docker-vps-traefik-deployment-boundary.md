# ADR-0088 — Jarvis OS Isolated Docker, VPS and Traefik Deployment Boundary

**Status:** Accepted — JOS-01D Gate 1 (deployment artefacts and a read-only audit; nothing deployed, no DNS change, no Traefik change, no database, no business mutation, no migration)
**Deciders:** Owner
**Relates to:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) · [ADR-0086](./ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md) · [ADR-0087](./ADR-0087-jos-01c-owner-authentication-and-operator-session-boundary.md)

## Context

Baseline: `main` at `f75eb50e987bc2b5f68ed44d17101d0e35492fd5`, the merge of PR #91 (JOS-01C).
Collision checks: `ADR-0088` unclaimed and unreferenced anywhere, zero open PRs, migrations
`0001`–`0009` with no `0010`.

JOS-01C made every operator page and the snapshot API require a verified session. That was the
prerequisite for exposing anything: before it, an unauthenticated `GET` returned the system's whole
posture. With it in place, deployment becomes a question about _where the process runs and what it
can reach_ rather than about what a stranger can read.

This phase changes **where Jarvis OS runs, not what it may do.**

## Decision

### 1. Two gates, not one

Gate 1 (this ADR) produces the artefacts and audits the host read-only. Gate 2 — only after this is
independently reviewed and merged — deploys the exact merged SHA and verifies it.

Collapsing them would mean the deployment arrives with its own review, which is no review. It also
separates two failure modes that want different responses: "this topology is wrong" is a code
review, and "this deployment misbehaved" is an incident.

### 2. The audit found the topology already exists — so shared Traefik is not touched

Read-only findings on `srv1873796` (Ubuntu 24.04.4, Docker 29.6.1, 2 vCPU / 7.8 GiB / 96 GB):

- Traefik **3.7.10**, `network_mode: host`, configured image tag `traefik:latest`
- `--providers.docker=true`, `--providers.docker.exposedbydefault=false` — labels are opt-in
- Entrypoints `web` (:80), `websecure` (:443); HTTP→HTTPS redirect already global on `web`
- Resolver `letsencrypt`, HTTP-01, storage `/letsencrypt/acme.json` (0600 root)
- `--api.dashboard=false --api.insecure=false`; Docker socket mounted read-only
- `qf-core-staging` (172.16.1.2) and `n8n-cjls` (172.16.0.2) run on private bridges with **no
  published ports**; host-network Traefik reaches them by container IP

That last point is the load-bearing one. It means Jarvis OS needs **no published port at all** — not
even a loopback fallback — and its router arrives entirely through labels on its own container.
Bringing JOS up creates the router; removing JOS removes it; Traefik is never restarted, recreated,
pulled or upgraded.

**The configured tag is `traefik:latest`.** Any `docker compose pull` or `up -d` against that
project would silently upgrade shared ingress for every service on the host. Gate 1 ran none of
those, and Gate 2 must not either. That is recorded here because the danger is invisible: the
command looks routine and the blast radius is every hostname the VPS serves.

### 3. The image is immutable and holds no secret

Base pinned by **digest** (`node:24.18.0-bookworm-slim`,
`sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`), not by tag: a tag is
republished on every Debian security update, so two builds of one commit could differ. Tagged by
exact Git SHA — never `latest`, `main` or `stable` — so "which code is running" is answerable and
rollback is a re-tag rather than a rebuild.

No secret enters a layer. An image is copied, pushed and cached, and a secret baked into one cannot
be revoked by deleting a file. The auth JSON is bind-mounted read-only at run time, and a scan of
the built image for the password digest, session key, TOTP secret and the string `auth.json`
returned **zero** files.

### 4. The container is unprivileged and mostly unwritable

Non-root `10001:10001` (fixed, because the host secret is chowned to the same numeric id),
`read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `pids: 256`, bounded CPU/memory/logs. The
writable set is exactly `/tmp` on a `noexec,nosuid,nodev` tmpfs. No Docker socket, no privileged, no
added capabilities, no host PID/IPC, no devices.

Proved by running it: `uid=10001`, `touch /app/x` → `Read-only file system`, and the application
serving `/login` 200, unauthenticated `/` 307, unauthenticated snapshot 401, and — after a real
login — the authenticated overview and a snapshot parsed through the shared contract.

### 5. The monorepo trace is proved, not assumed

Jarvis OS imports `@qf-jarvis/control-plane-read-contract`, a workspace link. Next's standalone
tracer produces a minimal `node_modules` from the actual import graph, and a tracer that missed the
workspace package would yield an image that builds cleanly and fails with `MODULE_NOT_FOUND` on the
first request that needs it.

So it was exercised rather than inspected: an authenticated snapshot request through the container
returned `contractVersion=1`, 17 sections and 4 agents. No `outputFileTracingRoot` change was
needed.

### 6. Rate limits belong at the edge, and CSP does not

The application keeps its process-local login limiter, which is defense in depth and disappears on
restart. Traefik adds the perimeter one: 30 r/s general, and a higher-priority router for
`Path(/api/auth/login)` at 5/minute with an 8 KiB body cap. Buffering is scoped to that route only —
applying it to the main router would break Next's streaming for every page.

**No CSP middleware anywhere.** Jarvis OS emits a per-request nonce policy; a static edge CSP cannot
know the nonce, so it would break every script either by overriding the app's header or by sitting
alongside it (two CSP headers intersect to the strictest).

### 7. HSTS and DNS wait for Gate 2

`jarvis.quickfurno.in` has **no A record**; the VPS is `200.141.10.108`, confirmed from the host and
from the working `staging-core` record. HTTP-01 cannot issue a certificate until the owner adds it.

HSTS is prepared but not enabled. Sending it before a valid certificate exists pins browsers to a
hostname that does not yet serve HTTPS, and the pin outlives the mistake.

## Rejected alternatives

**Publish `0.0.0.0:3000`.** Rejected outright: it puts the application on a public interface,
bypassing Traefik, TLS and every rate limit.

**A loopback `127.0.0.1:<port>` fallback.** Prepared as a contingency and found unnecessary — the
audit proved host-network Traefik already reaches private bridge IPs. An unused published port is
still an attack surface and a thing to forget about.

**Upgrade or restart shared Traefik to "make routing cleaner".** Rejected. It is on `traefik:latest`
and serves every hostname on the host; the win would be cosmetic and the risk is total.

**Kubernetes, Terraform, Pulumi, PM2, an nginx sidecar.** Rejected. One container behind an existing
ingress does not need an orchestration platform, and each would add a permanent operational surface
larger than the thing it deploys.

**A `/api/health` route.** Rejected. It would be a new public unauthenticated endpoint added purely
for a probe, when `/login` is already public by design.

## Consequences

- Jarvis OS can be deployed by building one SHA and starting one project; nothing else changes.
- Rollback re-points only the JOS project at a previous immutable tag. No prune command is ever run,
  because each would reach shared Traefik, n8n and Core resources.
- Traefik, n8n and QuickFurno Core staging were read and not modified in any way.

## Non-goals

No deployment in Gate 1. No DNS change. No Traefik restart, recreate, pull or upgrade. No database,
managed database, Core, n8n, Meta or provider connection. No business mutation. No migration —
`0010` is not created. Production business rollout remains **OFF**.

## Change-control rule

The no-published-port topology, the non-root read-only container, the digest-pinned base, the
SHA-only image tag and the prohibition on modifying shared Traefik may be changed only by a
superseding ADR. Gate 2 may not begin until this ADR is merged and the DNS A record exists.
