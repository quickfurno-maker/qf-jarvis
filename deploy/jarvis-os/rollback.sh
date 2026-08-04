#!/usr/bin/env bash
# Jarvis OS rollback (JOS-01D, ADR-0088). GATE 2 ONLY.
#
# Re-points ONLY the qf-jarvis-os project at a previous immutable tag. It touches no other
# compose project, and it prunes nothing: `docker system prune`, `image prune -a`, `volume prune`
# and `network prune` would all reach shared Traefik, n8n and Core resources.
set -Eeuo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  echo "usage: rollback.sh <previous-known-good-git-sha>" >&2
  echo "available:" >&2
  docker images --filter 'reference=qf-jarvis-os' --format '  {{.Tag}}  ({{.CreatedSince}})' >&2
  exit 2
fi

if ! docker image inspect "qf-jarvis-os:${SHA}" >/dev/null 2>&1; then
  echo "FATAL: image qf-jarvis-os:${SHA} is not present. Rollback needs the previous image kept." >&2
  exit 1
fi

COMPOSE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.production.yml"
echo "==> rolling back to qf-jarvis-os:${SHA}"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os -f "$COMPOSE" up -d

RUNNING="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
echo "==> running revision: $RUNNING"
[[ "$RUNNING" == "$SHA" ]] || { echo "FATAL: rollback did not take effect." >&2; exit 1; }
