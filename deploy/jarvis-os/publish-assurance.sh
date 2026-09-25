#!/usr/bin/env bash
# Publish the exact-release Jarvis OS assurance receipt AFTER the verified external final smoke.
#
#   publish-assurance.sh <exact-merged-git-sha> EXTERNAL_SMOKE_PASSED
#
# This script does not perform the external smoke itself. It is deliberately a host-side second
# half of that gate: external-smoke.sh runs from the operator machine and invokes this only after
# its exact-SHA smoke succeeds. This side then re-proves the local release/container before writing
# a bounded content-free receipt visible to Jarvis OS through a read-only directory mount.
set -Eeuo pipefail

SHA="${1:-}"
CONFIRM="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
ASSURANCE_DIR="${QFJ_RELEASE_ASSURANCE_DIR:-/srv/qf-jarvis/state/release-assurance}"

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "usage: publish-assurance.sh <exact-merged-git-sha> EXTERNAL_SMOKE_PASSED" >&2
  exit 2
}
[[ "$CONFIRM" == "EXTERNAL_SMOKE_PASSED" ]] || {
  echo "FATAL: assurance publication requires the verified external-smoke handoff." >&2
  exit 2
}

# Both the commit and THIS publisher must be the reviewed immutable release package.
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"
"$HERE/verify-release-artifacts.sh" "$SHA" "$HERE" "$REPO_DIR"

RUNNING_SHA="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
[[ "$RUNNING_SHA" == "$SHA" ]] || {
  echo "FATAL: running Jarvis OS revision '$RUNNING_SHA' does not equal $SHA." >&2
  exit 1
}

HEALTH="$(docker inspect qf-jarvis-os --format '{{.State.Health.Status}}' 2>/dev/null || true)"
[[ "$HEALTH" == "healthy" ]] || {
  echo "FATAL: Jarvis OS health is '$HEALTH', expected healthy." >&2
  exit 1
}

TRAEFIK="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.enable" }}')"
[[ "$TRAEFIK" == "true" ]] || {
  echo "FATAL: public ingress is not active." >&2
  exit 1
}

STS="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.http.middlewares.qf-jarvis-os-hsts.headers.stsSeconds" }}')"
[[ "$STS" == "31536000" ]] || {
  echo "FATAL: final HSTS label is '$STS', expected 31536000." >&2
  exit 1
}

MOUNT_SOURCE="$(docker inspect qf-jarvis-os --format '{{range .Mounts}}{{if eq .Destination "/run/release-assurance"}}{{.Source}}{{end}}{{end}}')"
MOUNT_RO="$(docker inspect qf-jarvis-os --format '{{range .Mounts}}{{if eq .Destination "/run/release-assurance"}}{{not .RW}}{{end}}{{end}}')"
[[ "$MOUNT_SOURCE" == "$ASSURANCE_DIR" && "$MOUNT_RO" == "true" ]] || {
  echo "FATAL: release-assurance mount is not the reviewed read-only host directory." >&2
  exit 1
}

ENV_SHA="$(docker inspect qf-jarvis-os --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="QFJ_JOS_RELEASE_SHA"{print $2}')"
[[ "$ENV_SHA" == "$SHA" ]] || {
  echo "FATAL: container release-SHA binding is '$ENV_SHA', expected $SHA." >&2
  exit 1
}

[[ -d "$ASSURANCE_DIR" && ! -L "$ASSURANCE_DIR" ]] || {
  echo "FATAL: $ASSURANCE_DIR is missing or unsafe." >&2
  exit 1
}
OWNER="$(stat -c '%u:%g' "$ASSURANCE_DIR")"
MODE="$(stat -c '%a' "$ASSURANCE_DIR")"
[[ "$OWNER" == "0:10001" && "$MODE" == "750" ]] || {
  echo "FATAL: $ASSURANCE_DIR is $OWNER mode $MODE; expected 0:10001 mode 750." >&2
  exit 1
}

EMITTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TMP="$ASSURANCE_DIR/.current.$$.tmp"
trap 'rm -f "$TMP"' EXIT
umask 027
cat >"$TMP" <<EOF
{
  "protocol": "qfj.release-assurance-observation.v1",
  "emittedAt": "$EMITTED_AT",
  "releaseSha": "$SHA",
  "dimensions": [
    {
      "id": "release-identity",
      "label": "Exact release identity",
      "state": "HEALTHY",
      "detail": "The running container and immutable deployment package both match the exact reviewed Git revision."
    },
    {
      "id": "container-health",
      "label": "Container health",
      "state": "HEALTHY",
      "detail": "The exact-release Jarvis OS container is healthy after final public activation."
    },
    {
      "id": "trusted-external-smoke",
      "label": "External release verification",
      "state": "HEALTHY",
      "detail": "The verified exact-SHA external smoke completed successfully before this receipt was published."
    },
    {
      "id": "hsts-posture",
      "label": "HSTS posture",
      "state": "HEALTHY",
      "detail": "The reviewed final HSTS middleware is active with the required one-year max-age."
    },
    {
      "id": "assurance-containment",
      "label": "Assurance containment",
      "state": "HEALTHY",
      "detail": "Release evidence is exposed to Jarvis OS only through the reviewed read-only assurance mount."
    },
    {
      "id": "final-release-gate",
      "label": "Final release gate",
      "state": "AVAILABLE",
      "detail": "All release-assurance preconditions for this exact Jarvis OS deployment were revalidated."
    }
  ]
}
EOF
chown 0:10001 "$TMP"
chmod 0640 "$TMP"
mv -f "$TMP" "$ASSURANCE_DIR/current.json"
trap - EXIT

echo "JARVIS_OS_RELEASE_ASSURANCE=PASS sha=$SHA"
