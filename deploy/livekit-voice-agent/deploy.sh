#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
CONFIG='/srv/qf-jarvis/secrets/qf-jarvis-livekit-voice-agent.json'

die() { echo "FATAL: $1" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "usage: deploy.sh <exact-merged-git-sha>"

"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die "$CONFIG must be a regular non-symlink file."
mode="$(stat -c '%a' "$CONFIG")"
owner="$(stat -c '%u:%g' "$CONFIG")"
[[ "$mode" == "400" || "$mode" == "600" ]] || die "$CONFIG mode is $mode; expected 400 or 600."
[[ "$owner" == "10004:10004" ]] || die "$CONFIG owner is $owner; expected 10004:10004."

BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$BUILD_CTX"

echo "==> building qf-jarvis-livekit-voice-agent:$SHA"
docker build \
  --file "$BUILD_CTX/deploy/livekit-voice-agent/Dockerfile" \
  --build-arg "GIT_SHA=$SHA" \
  --tag "qf-jarvis-livekit-voice-agent:$SHA" \
  "$BUILD_CTX"

echo "==> starting private LiveKit voice agent"
QFJ_VOICE_IMAGE_TAG="$SHA" docker compose \
  -p qf-jarvis-livekit-voice-agent \
  -f "$BUILD_CTX/deploy/livekit-voice-agent/compose.production.yml" \
  up -d

for _ in $(seq 1 30); do
  running="$(docker inspect qf-jarvis-livekit-voice-agent --format '{{.State.Running}}' 2>/dev/null || echo false)"
  [[ "$running" == "true" ]] && break
  sleep 1
done
[[ "${running:-false}" == "true" ]] || die "voice agent is not running."

fail=0
prove() {
  if [[ "$2" == "$3" ]]; then printf '  ok    %-34s %s\n' "$1" "$3"; else
    printf '  FAIL  %-34s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

prove "image revision" "$SHA" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}')"
prove "uid:gid" "10004:10004" "$(docker exec qf-jarvis-livekit-voice-agent sh -c 'printf \"%s:%s\" \"$(id -u)\" \"$(id -g)\"')"
prove "read-only rootfs" "true" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{.HostConfig.ReadonlyRootfs}}')"
prove "capabilities dropped" "[ALL]" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{.HostConfig.CapDrop}}')"
prove "published host ports" "" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}')"
prove "traefik disabled" "false" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{ index .Config.Labels \"traefik.enable\" }}')"
prove "config source" "$CONFIG" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{range .Mounts}}{{if eq .Destination \"/run/secrets/qf-jarvis-livekit-voice-agent.json\"}}{{.Source}}{{end}}{{end}}')"
prove "config read-only" "false" "$(docker inspect qf-jarvis-livekit-voice-agent --format '{{range .Mounts}}{{if eq .Destination \"/run/secrets/qf-jarvis-livekit-voice-agent.json\"}}{{.RW}}{{end}}{{end}}')"

[[ "$fail" -eq 0 ]] || die "voice-agent deployment proof failed."

echo
echo "LiveKit voice agent deployed privately for $SHA."
echo "It exposes no host port and holds no Core, operator-command, SIP or business-send credential."
