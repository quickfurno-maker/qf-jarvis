#!/usr/bin/env bash
# Jarvis OS rollback (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   rollback.sh <previous-known-good-git-sha> <private|ingress|hsts>
#
# Re-points ONLY the qf-jarvis-os project at a previous immutable tag. It touches no other compose
# project, and it prunes nothing: `docker system prune`, `image prune -a`, `volume prune` and
# `network prune` would all reach shared Traefik, n8n and Core resources.
#
# ### Why the stage is required rather than defaulted
#
# The overlay set decides what the rolled-back container exposes. Defaulting to the full set could
# silently activate ingress on a container that was still private; defaulting to `private` could
# silently DROP HSTS from a host whose browsers have already been told to refuse plain HTTP for a
# year -- they would keep refusing, and the site would simply stop working for them.
#
# Neither default is safe, so there is none: state the stage that is currently live.
set -Eeuo pipefail

SHA="${1:-}"
STAGE="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "usage: rollback.sh <previous-known-good-git-sha> <private|ingress|hsts>" >&2
  echo "       (state the stage that is CURRENTLY live)" >&2
  echo "available images:" >&2
  docker images --filter 'reference=qf-jarvis-os' --format '  {{.Tag}}  ({{.CreatedSince}})' >&2
  exit 2
}
[[ -n "$SHA" && -n "$STAGE" ]] || usage

case "$STAGE" in
  private) FILES=(-f "$HERE/compose.production.yml") ;;
  ingress) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml") ;;
  hsts) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml" -f "$HERE/compose.hsts.yml") ;;
  *) usage ;;
esac

# Rollback deliberately does NOT re-check origin/main containment. The target is a commit that was
# already deployed through the guarded path, and the realistic emergency is that main now contains
# something broken -- a rollback that insisted on containment in the current main would refuse to
# work at exactly the moment it is needed. The image must already exist locally, which is the
# stronger constraint here: it can only have been produced by a guarded deploy.
if ! docker image inspect "qf-jarvis-os:${SHA}" >/dev/null 2>&1; then
  echo "FATAL: image qf-jarvis-os:${SHA} is not present. Rollback needs the previous image kept." >&2
  exit 1
fi

echo "==> rolling back to qf-jarvis-os:${SHA} at stage '${STAGE}' (project qf-jarvis-os only)"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os "${FILES[@]}" up -d

RUNNING="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
echo "==> running revision: $RUNNING"
[[ "$RUNNING" == "$SHA" ]] || {
  echo "FATAL: rollback did not take effect." >&2
  exit 1
}
