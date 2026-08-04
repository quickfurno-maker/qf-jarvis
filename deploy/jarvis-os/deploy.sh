#!/usr/bin/env bash
# Jarvis OS deployment (JOS-01D, ADR-0088). GATE 2 ONLY.
#
# Builds and starts the image for one exact Git SHA. Every guard here exists because the
# alternative failure is silent: deploying a tag that moved, deploying a dirty tree, or recreating
# a shared container that other services depend on.
set -Eeuo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  echo "usage: deploy.sh <exact-merged-git-sha>" >&2
  exit 2
fi

REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
SECRET="/srv/qf-jarvis/secrets/jarvis-os-auth.json"
COMPOSE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.production.yml"

# The secret must already exist, with owner-only permissions. The application refuses a
# group- or world-readable file, so failing here gives a clearer message than a 503 later.
if [[ ! -f "$SECRET" ]]; then
  echo "FATAL: $SECRET is missing. Install it before deploying." >&2
  exit 1
fi
MODE="$(stat -c '%a' "$SECRET")"
OWNER="$(stat -c '%u:%g' "$SECRET")"
if [[ "$MODE" != "400" && "$MODE" != "600" ]]; then
  echo "FATAL: $SECRET mode is $MODE; expected 400 or 600." >&2
  exit 1
fi
if [[ "$OWNER" != "10001:10001" ]]; then
  echo "FATAL: $SECRET owner is $OWNER; expected 10001:10001." >&2
  exit 1
fi

# Build from a CLEAN checkout of the exact SHA. `git archive` produces tracked files only, so
# untracked local material -- including protected paths -- cannot enter the build context.
BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$BUILD_CTX"

echo "==> building qf-jarvis-os:${SHA}"
docker build \
  --file "$BUILD_CTX/deploy/jarvis-os/Dockerfile" \
  --build-arg "GIT_SHA=${SHA}" \
  --tag "qf-jarvis-os:${SHA}" \
  "$BUILD_CTX"

echo "==> starting (project qf-jarvis-os only)"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os -f "$COMPOSE" up -d

# Prove the running container is the intended revision rather than a cached older layer.
RUNNING="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
if [[ "$RUNNING" != "$SHA" ]]; then
  echo "FATAL: running image revision is $RUNNING, expected $SHA." >&2
  exit 1
fi
echo "==> running revision confirmed: $RUNNING"
