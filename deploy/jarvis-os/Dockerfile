# syntax=docker/dockerfile:1
#
# Jarvis OS production image (JOS-01D, ADR-0088).
#
# ### Pinned by digest, not by tag
#
# The base is pinned to an exact digest. A tag is a mutable pointer: `node:24.18.0-bookworm-slim`
# is republished whenever the Debian layer gets a security update, so two builds a week apart can
# produce different filesystems from identical source. That is fine for a laptop and wrong for a
# deployment artefact whose whole purpose is to be reproducible and rollback-able. The digest is
# recorded in ADR-0088 and in this file, and updating it is a reviewed change.
#
# ### What is deliberately NOT here
#
# No build-time secret, no `.env`, no auth configuration, no `.git`, no docs, no tests, no
# reconciliation reports. The auth JSON is bind-mounted read-only at run time and never enters an
# image layer — an image is copied, pushed and cached, and a secret baked into one is a secret you
# cannot revoke by deleting a file.
#
# Base: node:24.18.0-bookworm-slim
# Digest: sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG NODE_IMAGE=node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

# ---------------------------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

# Exact pnpm, matching packageManager in the root manifest. Corepack pins it rather than resolving
# "whatever pnpm 11 means today", so the lockfile is interpreted by the version that wrote it.
ARG PNPM_VERSION=11.11.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /build

# Manifests and lockfile first, so a source-only change does not re-resolve the dependency graph.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/control-plane-read-contract/package.json packages/control-plane-read-contract/
COPY apps/jarvis-os/package.json apps/jarvis-os/

# `--frozen-lockfile` is the supply-chain contract: the lockfile is authoritative, and a manifest
# that drifted from it fails the build rather than silently resolving something new. Every root
# policy (minimumReleaseAge, strictPeerDependencies, engineStrict, onlyBuiltDependencies: [])
# applies here exactly as it does locally, because they live in pnpm-workspace.yaml.
RUN pnpm install --frozen-lockfile --filter @qf-jarvis/jarvis-os... --filter .

# Only the two workspaces Jarvis OS actually needs.
COPY packages/control-plane-read-contract packages/control-plane-read-contract
COPY apps/jarvis-os apps/jarvis-os

# The shared contract must be compiled before Next traces it: Jarvis OS imports the built `dist`,
# not the TypeScript source.
RUN pnpm --filter @qf-jarvis/control-plane-read-contract build \
 && pnpm --filter @qf-jarvis/jarvis-os build

# ---------------------------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# A fixed, unprivileged identity. Fixed rather than auto-assigned because the bind-mounted secret
# on the host is chowned to the same numeric id, and a UID that moved between builds would either
# break the mount or invite a world-readable workaround.
RUN groupadd --gid 10001 jarvis \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin jarvis

# Strip the build toolchain the runtime has no use for.
#
# This runs `node apps/jarvis-os/server.js`. It never installs a package, so npm, npx, corepack and
# perl are pure surface. Two independent reasons to remove them:
#
# 1. Vulnerabilities. A scan of the previous image found 3 CRITICAL and 6 HIGH findings, and EVERY
#    one was in this toolchain -- npm's bundled tar/undici/brace-expansion/ip-address, and Debian's
#    perl -- with NONE in the application's traced node_modules. The pinned digest is already the
#    current published digest for node:24.18.0-bookworm-slim, so there is no fixed base to move to;
#    the packages had to go rather than be waited on.
#
# 2. Post-exploitation. `npm`/`npx` in a container is an arbitrary-package install-and-execute
#    primitive. Removing them is worth doing even at zero known CVEs.
#
# perl has no installed reverse dependencies here (`apt-cache rdepends --installed perl` is empty).
# The Essential `perl-base` is deliberately left alone -- dpkg itself needs it.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
 && apt-get purge -y perl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /root/.npm /tmp/*

WORKDIR /app

# Next's standalone output plus the two directories it does not include.
#
# `standalone` contains a minimal `node_modules` traced from the actual import graph — which is why
# the monorepo trace is proved by a test rather than assumed: `@qf-jarvis/control-plane-read-contract`
# is a workspace link, and a tracer that missed it would produce an image that builds cleanly and
# crashes with MODULE_NOT_FOUND on first request.
COPY --from=builder --chown=10001:10001 /build/apps/jarvis-os/.next/standalone ./
COPY --from=builder --chown=10001:10001 /build/apps/jarvis-os/.next/static ./apps/jarvis-os/.next/static

# There is deliberately no `public/` copy: Jarvis OS ships no static assets outside `.next`. Adding
# a COPY for a directory that does not exist fails the build, and creating an empty one to satisfy
# a template would be worse -- an unreviewed public-file drop point in a hardened image.

USER 10001:10001

EXPOSE 3000

# Liveness ONLY: "the Node process answers HTTP".
#
# It deliberately does not mean the auth configuration is valid, TLS works, DNS resolves, or Core
# and n8n are reachable — none of which this container can honestly assess. `/login` is used
# because it is the one route that is public by design, so a healthy answer needs no credential.
# Node's built-in fetch is used rather than installing curl: a health probe is not a reason to add
# a binary with its own CVE stream to a hardened image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Standalone emits the server at the app's path inside the traced tree.
CMD ["node", "apps/jarvis-os/server.js"]

# OCI metadata. `revision` is the exact Git SHA the image was built from, so a running container
# can be checked against the merged commit it is supposed to be.
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="qf-jarvis-os" \
      org.opencontainers.image.description="QF Jarvis OS operator control plane (read-only surface; QuickFurno Core authorizes)" \
      org.opencontainers.image.source="https://github.com/quickfurno-maker/qf-jarvis" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.base.name="node:24.18.0-bookworm-slim" \
      org.opencontainers.image.base.digest="sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d"
