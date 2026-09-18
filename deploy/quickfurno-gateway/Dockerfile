# syntax=docker/dockerfile:1
# Dedicated QuickFurno <-> Jarvis machine gateway.
ARG NODE_IMAGE=node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS builder
ARG PNPM_VERSION=11.11.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /build

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY apps/quickfurno-gateway/package.json apps/quickfurno-gateway/
RUN pnpm install --frozen-lockfile --filter @qf-jarvis/quickfurno-gateway... --filter .

COPY apps/quickfurno-gateway apps/quickfurno-gateway
RUN pnpm --filter @qf-jarvis/quickfurno-gateway build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN groupadd --gid 10002 gateway \
 && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin gateway \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /root/.npm /tmp/*
WORKDIR /app
COPY --from=builder --chown=10002:10002 /build/apps/quickfurno-gateway/dist ./dist
USER 10002:10002
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="qf-jarvis-quickfurno-gateway" \
      org.opencontainers.image.description="Signed machine-to-machine ingress for QuickFurno Core to Jarvis" \
      org.opencontainers.image.source="https://github.com/quickfurno-maker/qf-jarvis" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="UNLICENSED"
