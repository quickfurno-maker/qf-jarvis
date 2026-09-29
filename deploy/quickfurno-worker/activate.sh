#!/usr/bin/env bash
# Explicit final activation. This script is intentionally separate from deploy.sh.
set -Eeuo pipefail

SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
DISABLE='/srv/qf-jarvis/state/quickfurno-worker-control/DISABLE_MODEL'

die() { echo "FATAL: $1" >&2; exit 1; }
[[ -n "$SHA" ]] || die "usage: activate.sh <exact-merged-git-sha>"
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

revision="$(docker inspect qf-jarvis-whatsapp-worker --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
[[ "$revision" == "$SHA" ]] || die "running worker revision '$revision' does not equal requested SHA."
docker logs qf-jarvis-whatsapp-worker 2>&1 | grep -q "qfj-whatsapp-worker READY" ||
  die "worker has not reached evidence-gated READY."
[[ -f "$DISABLE" ]] || die "worker is already armed or control state is invalid."

rm -- "$DISABLE"
echo "ACTIVATED: DISABLE_MODEL removed for qf-jarvis-whatsapp-worker $SHA"
