#!/usr/bin/env bash
# Jarvis OS staged ingress activation (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   activate.sh ingress <exact-merged-git-sha>   # make the router live
#   activate.sh hsts    <exact-merged-git-sha>   # attach HSTS, AFTER TLS is proven
#   activate.sh voice   <exact-merged-git-sha>   # add LiveKit token config after voice worker exists
#
# Each stage recreates ONLY the qf-jarvis-os container by re-applying the reviewed compose files
# with one more additive overlay. Voice activation is last: it preserves ingress + HSTS and adds
# only the protected LiveKit token-minting configuration after the private voice worker is running. Shared Traefik is never restarted, recreated, pulled or upgraded:
# it discovers the new labels through the Docker provider it is already watching.
#
# Nothing here edits a live configuration by hand. Both stages are exactly the artefacts that were
# reviewed in the pull request, which is what makes "deploy the exact merged SHA" mean anything.
set -Eeuo pipefail

STAGE="${1:-}"
SHA="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"

usage() {
  echo "usage: activate.sh <ingress|hsts|voice> <exact-merged-git-sha>" >&2
  exit 2
}
[[ -n "$STAGE" && -n "$SHA" ]] || usage

case "$STAGE" in
  ingress) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml") ;;
  # HSTS is additive on top of ingress, never instead of it. Applying the HSTS overlay without the
  # ingress overlay would define the middleware and attach it to routers that do not exist.
  hsts) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml" -f "$HERE/compose.hsts.yml") ;;
  voice) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml" -f "$HERE/compose.hsts.yml" -f "$HERE/compose.voice.yml") ;;
  *) usage ;;
esac

# The same two guards deploy.sh uses. Activation re-resolves the image tag AND applies overlays, so
# an unmerged SHA or a drifted overlay must be refused here too, not only at build time.
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"
"$HERE/verify-release-artifacts.sh" "$SHA" "$HERE" "$REPO_DIR"

docker image inspect "qf-jarvis-os:${SHA}" >/dev/null 2>&1 || {
  echo "FATAL: image qf-jarvis-os:${SHA} is not present. Run deploy.sh first." >&2
  exit 1
}

# The running container must ALREADY be this SHA.
#
# Staged activation adds a layer of configuration to a deployment that is already in place and
# already proved. Allowing it to run against a different revision would let overlays from one
# commit be applied to an image from another -- exactly the split identity this release model
# exists to prevent -- and it would silently upgrade or downgrade the application as a side effect
# of a step whose stated purpose is to attach a router or a header.
#
# Changing revisions is deploy.sh's job, and it starts from the private stage.
RUNNING_BEFORE="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || echo 'not-running')"
[[ "$RUNNING_BEFORE" == "$SHA" ]] || {
  echo "FATAL: running revision is '$RUNNING_BEFORE', but activation was requested for $SHA." >&2
  echo "       Run deploy.sh $SHA from that release directory first." >&2
  exit 1
}

if [[ "$STAGE" == "voice" ]]; then
  LIVEKIT_CONFIG='/srv/qf-jarvis/secrets/qf-jarvis-os-livekit.json'
  [[ -f "$LIVEKIT_CONFIG" && ! -L "$LIVEKIT_CONFIG" ]] || {
    echo "FATAL: $LIVEKIT_CONFIG must be a regular non-symlink file." >&2
    exit 1
  }
  LIVEKIT_MODE="$(stat -c '%a' "$LIVEKIT_CONFIG")"
  LIVEKIT_OWNER="$(stat -c '%u:%g' "$LIVEKIT_CONFIG")"
  [[ "$LIVEKIT_MODE" == "400" || "$LIVEKIT_MODE" == "600" ]] || {
    echo "FATAL: $LIVEKIT_CONFIG mode is $LIVEKIT_MODE; expected 400 or 600." >&2
    exit 1
  }
  [[ "$LIVEKIT_OWNER" == "10001:10001" ]] || {
    echo "FATAL: $LIVEKIT_CONFIG owner is $LIVEKIT_OWNER; expected 10001:10001." >&2
    exit 1
  }

  VOICE_AGENT_RUNNING="$(docker inspect qf-jarvis-livekit-voice-agent --format '{{.State.Running}}' 2>/dev/null || echo false)"
  [[ "$VOICE_AGENT_RUNNING" == "true" ]] || {
    echo "FATAL: qf-jarvis-livekit-voice-agent must be running before Jarvis OS voice is enabled." >&2
    exit 1
  }
  VOICE_AGENT_REVISION="$(docker inspect qf-jarvis-livekit-voice-agent --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
  [[ "$VOICE_AGENT_REVISION" == "$SHA" ]] || {
    echo "FATAL: voice agent revision '$VOICE_AGENT_REVISION' does not match Jarvis OS release '$SHA'." >&2
    exit 1
  }
fi

if [[ "$STAGE" == "hsts" ]]; then
  cat <<'EOF'
==> HSTS activation

Only proceed if `smoke.sh pre-hsts <host>` has just passed against trusted TLS.

HSTS instructs browsers to refuse plain HTTP to this host for a year. Sent before a valid
certificate is serving, it pins clients to a hostname that does not work, and the pin cannot be
recalled by fixing the server.
EOF
fi

echo "==> applying stage '${STAGE}' to project qf-jarvis-os only"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os "${FILES[@]}" up -d

# Compose recreation is asynchronous. Re-prove application health before claiming an ingress
# stage is active; otherwise the next external smoke can race both Node startup and Traefik's
# Docker-provider registration.
STATUS=unknown
for _ in $(seq 1 30); do
  STATUS="$(docker inspect qf-jarvis-os --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 1
done
[[ "$STATUS" == "healthy" ]] || {
  echo "FATAL: container did not become healthy after '${STAGE}' activation (last status: $STATUS)." >&2
  exit 1
}

RUNNING="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[[ "$RUNNING" == "$SHA" ]] || {
  echo "FATAL: running revision is $RUNNING, expected $SHA." >&2
  exit 1
}

ENABLED="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.enable" }}')"
[[ "$ENABLED" == "true" ]] || {
  echo "FATAL: traefik.enable is '$ENABLED' after activation; expected true." >&2
  exit 1
}

if [[ "$STAGE" == "hsts" || "$STAGE" == "voice" ]]; then
  STS="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.http.middlewares.qf-jarvis-os-hsts.headers.stsSeconds" }}')"
  [[ "$STS" == "31536000" ]] || {
    echo "FATAL: HSTS max-age label is '$STS', expected 31536000." >&2
    exit 1
  }
  echo "==> HSTS middleware present (max-age=$STS)"
fi

if [[ "$STAGE" == "voice" ]]; then
  VOICE_ENV="$(docker inspect qf-jarvis-os --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^QFJ_JOS_LIVEKIT_CONFIG_FILE=' || true)"
  [[ "$VOICE_ENV" == "QFJ_JOS_LIVEKIT_CONFIG_FILE=/run/secrets/qf-jarvis-os-livekit.json" ]] || {
    echo "FATAL: LiveKit config environment path is not active." >&2
    exit 1
  }
  VOICE_SOURCE="$(docker inspect qf-jarvis-os --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/qf-jarvis-os-livekit.json"}}{{.Source}}{{end}}{{end}}')"
  VOICE_RW="$(docker inspect qf-jarvis-os --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/qf-jarvis-os-livekit.json"}}{{.RW}}{{end}}{{end}}')"
  [[ "$VOICE_SOURCE" == "/srv/qf-jarvis/secrets/qf-jarvis-os-livekit.json" && "$VOICE_RW" == "false" ]] || {
    echo "FATAL: LiveKit config mount is absent or writable." >&2
    exit 1
  }
  echo "==> LiveKit token config mounted read-only"
fi

echo "==> stage '${STAGE}' active on revision $RUNNING"
echo "    verify externally before going further:"
if [[ "$STAGE" == "ingress" ]]; then
  echo "      ./deploy/jarvis-os/external-smoke.sh pre-hsts jarvis.quickfurno.in ${SHA}"
else
  echo "      ./deploy/jarvis-os/external-smoke.sh final jarvis.quickfurno.in ${SHA}"
fi
