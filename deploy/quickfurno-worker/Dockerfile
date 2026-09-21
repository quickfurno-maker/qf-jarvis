# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS builder
ARG PNPM_VERSION=11.11.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /build

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/quickfurno-gateway ./apps/quickfurno-gateway

RUN pnpm install --frozen-lockfile --filter @qf-jarvis/api... --filter @qf-jarvis/quickfurno-gateway... --filter .
RUN pnpm --filter @qf-jarvis/api... build

# Production image needs package manifests + dist only. Remove TypeScript sources/tests from the
# copied workspace packages after build while preserving pnpm's workspace symlink layout.
RUN find packages apps/api apps/quickfurno-gateway -type d \( -name src -o -name tests \) -prune -exec rm -rf '{}' + \
 && find packages apps/api apps/quickfurno-gateway -type f \( -name '*.tsbuildinfo' -o -name '*.map' \) -delete

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN groupadd --gid 10002 qfturns \
 && useradd --uid 10003 --gid 10002 --no-create-home --shell /usr/sbin/nologin worker \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm /tmp/*
WORKDIR /app

COPY --from=builder --chown=10003:10002 /build/node_modules ./node_modules
COPY --from=builder --chown=10003:10002 /build/packages ./packages
COPY --from=builder --chown=10003:10002 /build/apps/api ./apps/api
COPY --from=builder --chown=10003:10002 /build/apps/quickfurno-gateway ./apps/quickfurno-gateway

USER 10003:10002
CMD ["node", "apps/api/dist/bin/run-quickfurno-whatsapp-production-worker.js", "--config", "/run/secrets/qf-jarvis-whatsapp-worker.json"]

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="qf-jarvis-quickfurno-worker" \
      org.opencontainers.image.description="Private evidence-gated Groq-only QuickFurno WhatsApp worker" \
      org.opencontainers.image.source="https://github.com/quickfurno-maker/qf-jarvis" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="UNLICENSED"
