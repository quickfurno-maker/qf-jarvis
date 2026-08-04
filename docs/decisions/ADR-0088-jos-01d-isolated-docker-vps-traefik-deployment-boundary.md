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

### 1b. Runtime bring-up is separate from ingress activation

The first version of this design put the Traefik router labels in the same Compose file as the
container. That made the Gate 2 sequence a fiction: the Docker provider discovers labels the moment
a container starts, so the router would be live before the first "private" proof ran. Every
subsequent check would have been measuring something already serving the internet.

So the topology is three additive files:

| File                     | Effect                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `compose.production.yml` | The container. `traefik.enable=false`. Reachable by nobody. |
| `+ compose.ingress.yml`  | Routers, TLS, rate limits. This is what makes it public.    |
| `+ compose.hsts.yml`     | HSTS, after TLS is proven working.                          |

`traefik.enable` is stated as `false` rather than left absent. Absence is already safe given the
host's `exposedByDefault=false`, but that is a setting on a shared component this project does not
own; stating it means the private stage stays private even if that setting is ever flipped, and it
gives the tests a positive fact to assert rather than an absence they could satisfy by typo.

Each stage recreates only the JOS container. Shared Traefik still sees nothing but label changes.

### 1c. Deployment refuses any commit that is not in `origin/main`

`deploy.sh` verified that the running image reported the requested SHA. That catches a stale cache
and nothing else — it will faithfully confirm you deployed exactly the wrong thing. The realistic
failure is not an attacker; it is pasting the head of the feature branch you were just reading.

`verify-merged-sha.sh` fails closed unless the argument is a full 40-hex SHA, exists as a commit,
and is an ancestor of a freshly fetched `origin/main`. Abbreviated SHAs, tags and branch names are
rejected because each can resolve differently at different times, which is the ambiguity an
immutable deployment exists to remove. A failed fetch is fatal rather than a warning: deciding
"is this reviewed?" from a stale ref is worse than not deciding.

It is a separate file so the test suite can execute it against real commits — including a real
unmerged one — without running a deployment. No GitHub CLI and no API token: `git merge-base`
against the remote the host already uses is sufficient, and adding an API dependency would widen
the trust boundary for no gain.

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

### 2b. The redirect status was measured, not assumed

`smoke.sh` originally asserted a 308 on the HTTP→HTTPS redirect. The shared `web` entrypoint
actually returns **301** — measured against an existing hostname on the host. Traefik's entrypoint
redirection returns 302 unless `permanent` is set, and the `redirectScheme` middleware returns
302/308, so the value could not be inferred from the version alone. Gate 2 would have failed on a
correct deployment.

It is pinned to the measured 301 and the `Location` is checked to be the HTTPS form of the same
host. Relaxing it to "any 3xx" would accept a redirect to anywhere, which is the one thing a
redirect check exists to catch.

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

### 3b. Digest pinning gives reproducibility, not safety — so the image was scanned

Pinning a digest fixes _which_ vulnerabilities you ship, not _whether_ you ship any. Docker Scout
on the first image reported **3 CRITICAL and 6 HIGH**.

Every one of them was in the base image's build toolchain — npm's bundled `tar`, `undici`,
`brace-expansion` and `ip-address`, plus Debian's `perl`. **None were in the application's traced
`node_modules`**, verified by listing both paths inside the image rather than inferring it.

The pinned digest is already the current published digest for `node:24.18.0-bookworm-slim`, so
there was no fixed base to move to. Waiting was the only option that preserved Node 24.18.0 — or
removing the packages, which is what happened. The runtime runs `node apps/jarvis-os/server.js` and
never installs anything, so npm, npx, corepack and perl are pure surface:

|                  | Before        | After |
| ---------------- | ------------- | ----- |
| CRITICAL         | 3             | 2     |
| HIGH             | 6             | 2     |
| Fixable CRITICAL | 1 (`npm/tar`) | **0** |
| Fixable HIGH     | 4             | **0** |

The four residual findings (CVE-2026-13221, CVE-2026-12087 critical; CVE-2026-48959, CVE-2026-48962
high) are all in `perl-base`, which is marked `Essential: yes` — dpkg itself depends on it — and all
are reported **"Fixed version: not fixed"** upstream in Debian bookworm. They are accepted: nothing
in the request path invokes perl, the container is non-root with a read-only root filesystem and no
shell reachable from the handler, and no fix exists to apply.

Removing `npm` and `npx` is worth doing at zero CVEs anyway — in a container they are an
arbitrary-package install-and-execute primitive for anyone who gets code execution.

One honest limitation: the files are deleted in the runtime stage, so they are absent from the
merged filesystem the container runs on, but the underlying base layer still carries the bytes.
That removes runtime reachability, not the layer's contents.

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

### 7. HSTS is a committed artefact, activated last

`jarvis.quickfurno.in` has **no A record**; the VPS is `200.141.10.108`, confirmed from the host and
from the working `staging-core` record. HTTP-01 cannot issue a certificate until the owner adds it.

HSTS was originally described as "prepared" while the README told the operator to add the middleware
label by hand after merge. That is an unreviewed production edit, and it makes the deployed
configuration differ from the reviewed one — which defeats the point of deploying an exact merged
SHA. It is now `compose.hsts.yml`, reviewed here, in Git, before anything is deployed:

```
stsSeconds: 31536000        one year
stsIncludeSubdomains: false sibling names under quickfurno.in are not this project's to bind
stsPreload: false           preload is effectively irreversible and is a whole-domain decision
forceSTSHeader: false       the header is only meaningful on an already-secure connection
```

It is a separate overlay from ingress because HSTS tells a browser "never speak plain HTTP to this
host again, for a year". Sent before a valid certificate exists, it pins clients to a hostname that
does not work, and the pin cannot be recalled by fixing the server. So it is applied only after
`smoke.sh pre-hsts` proves trusted TLS end to end.

Because `middlewares` is a single ordered label rather than a list that can be appended to, the
overlay restates each router's full chain. A test asserts every middleware from the ingress overlay
survives into the HSTS chains — a silent divergence there would drop a rate limiter while appearing
to add only HSTS.

### 7b. The final smoke gate fails closed

`smoke.sh` has two modes. Before activation, HSTS must be **absent** — present would mean it was
attached before TLS was proven. At the final gate it must be **present**, with `max-age=31536000`
and without `includeSubDomains` or `preload`.

It also requires **exactly one** CSP header. The previous version counted them and discarded the
result with `|| true`, so an edge-injected second policy — which silently breaks every nonced
script — passed. A count of one is now an assertion, not a note.

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
