# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS builder
ARG PNPM_VERSION=11.11.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /build

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/operator-api-contract/package.json packages/operator-api-contract/
COPY apps/livekit-voice-agent/package.json apps/livekit-voice-agent/
RUN pnpm install --frozen-lockfile --filter @qf-jarvis/livekit-voice-agent... --filter .

COPY packages/operator-api-contract packages/operator-api-contract
COPY apps/livekit-voice-agent apps/livekit-voice-agent
RUN pnpm --filter @qf-jarvis/operator-api-contract build \
 && pnpm --filter @qf-jarvis/livekit-voice-agent build \
 && find packages/operator-api-contract apps/livekit-voice-agent -type d -name tests -prune -exec rm -rf '{}' + \
 && find packages/operator-api-contract apps/livekit-voice-agent -type f \( -name '*.tsbuildinfo' -o -name '*.map' \) -delete

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    QFJ_LIVEKIT_VOICE_AGENT_CONFIG_FILE=/run/secrets/qf-jarvis-livekit-voice-agent.json
# Debian already reserves the conventional "voice" group, so use a service-specific
# principal while keeping the fixed numeric identity used by the secret mount and Compose policy.
RUN groupadd --gid 10004 jarvisvoice \
 && useradd --uid 10004 --gid 10004 --no-create-home --shell /usr/sbin/nologin jarvisvoice \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm /tmp/*
WORKDIR /app
COPY --from=builder --chown=10004:10004 /build/node_modules ./node_modules
COPY --from=builder --chown=10004:10004 /build/packages/operator-api-contract ./packages/operator-api-contract
COPY --from=builder --chown=10004:10004 /build/apps/livekit-voice-agent ./apps/livekit-voice-agent
USER 10004:10004
CMD ["node", "apps/livekit-voice-agent/dist/agent.js", "start"]

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="qf-jarvis-livekit-voice-agent" \
      org.opencontainers.image.description="Private read-only LiveKit operator voice agent for Jarvis OS" \
      org.opencontainers.image.source="https://github.com/quickfurno-maker/qf-jarvis" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="UNLICENSED"
