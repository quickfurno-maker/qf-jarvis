#!/usr/bin/env bash
# Jarvis OS rollback (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   rollback.sh <previous-known-good-git-sha> <private|ingress|hsts>
#
# Restores a previous release: the previous IMAGE **and** the previous deployment CONFIGURATION.
#
# ### Why the configuration has to come along
#
# Re-pointing only the image tag, using whatever Compose files sit beside the currently running
# script, produces something that is not the release it claims to be: an old known-good image
# combined with today's hardening, Traefik labels, HSTS values and rate limits. If the reason for
# rolling back is that today's configuration is wrong, that rollback carries the fault with it.
#
# So this script does not use its OWN compose files. It locates the immutable release package for
# PREVIOUS_SHA, verifies its bytes against Git, and applies the overlays that were reviewed with
# that image.
#
# ### It touches no other project and prunes nothing
#
# `docker system prune`, `image prune -a`, `volume prune` and `network prune` would all reach
# shared Traefik, n8n and Core resources.
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
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
RELEASES_ROOT="${RELEASES_ROOT:-/srv/qf-jarvis/releases}"

usage() {
  echo "usage: rollback.sh <previous-known-good-git-sha> <private|ingress|hsts>" >&2
  echo "       (state the stage that is CURRENTLY live)" >&2
  echo "available images:" >&2
  docker images --filter 'reference=qf-jarvis-os' --format '  {{.Tag}}  ({{.CreatedSince}})' >&2
  exit 2
}
[[ -n "$SHA" && -n "$STAGE" ]] || usage
case "$STAGE" in
  private | ingress | hsts) ;;
  *) usage ;;
esac

# The previous image must already exist locally. Rollback never builds: the emergency is not the
# moment to discover that a rebuild is slow, or that it now fails.
if ! docker image inspect "qf-jarvis-os:${SHA}" >/dev/null 2>&1; then
  echo "FATAL: image qf-jarvis-os:${SHA} is not present. Rollback needs the previous image kept." >&2
  exit 1
fi

# The previous release package -- NOT this script's directory.
PREV="${RELEASES_ROOT}/${SHA}/jarvis-os"
if [[ ! -d "$PREV" ]]; then
  cat >&2 <<EOF
FATAL: no release package at $PREV

Rollback restores the previous image AND the deployment configuration that was reviewed with it.
Without that package this would apply the CURRENT configuration to an OLD image, which is not a
rollback and may reintroduce the fault being rolled back from.

Restore it from Git before continuing:
  $HERE/prepare-release.sh $SHA
EOF
  exit 1
fi

# Integrity is checked against Git objects. Upstream containment deliberately is NOT re-checked:
# `verify-merged-sha.sh` fetches, and a rollback that insisted on reaching the remote -- or on the
# commit still being contained in a main that may now be broken or rewritten -- would refuse to run
# at precisely the moment it is needed. The package matching its commit byte for byte is the
# property that matters here, and it can only have been produced from reviewed code.
"$HERE/verify-release-artifacts.sh" "$SHA" "$PREV" "$REPO_DIR" "$RELEASES_ROOT" || {
  echo "FATAL: release package at $PREV does not match $SHA. Refusing to roll back to an altered configuration." >&2
  exit 1
}

case "$STAGE" in
  private) FILES=(-f "$PREV/compose.production.yml") ;;
  ingress) FILES=(-f "$PREV/compose.production.yml" -f "$PREV/compose.ingress.yml") ;;
  hsts) FILES=(-f "$PREV/compose.production.yml" -f "$PREV/compose.ingress.yml" -f "$PREV/compose.hsts.yml") ;;
esac

echo "==> rolling back to release ${SHA} at stage '${STAGE}' (project qf-jarvis-os only)"
echo "    image:  qf-jarvis-os:${SHA}"
echo "    config: $PREV"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os "${FILES[@]}" up -d

fail=0
prove() { # name expected actual
  if [[ "$2" == "$3" ]]; then printf '  ok    %-34s %s\n' "$1" "$3"; else
    printf '  FAIL  %-34s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

label() { docker inspect qf-jarvis-os --format "{{ index .Config.Labels \"$1\" }}" 2>/dev/null; }

prove "image revision" "$SHA" "$(label 'org.opencontainers.image.revision')"

# The stage the container ended up in must be the stage that was asked for. Verifying only the
# image would let a rollback silently land in a different exposure state than the operator named.
case "$STAGE" in
  private)
    prove "traefik.enable" "false" "$(label 'traefik.enable')"
    ;;
  ingress)
    prove "traefik.enable" "true" "$(label 'traefik.enable')"
    prove "HSTS attached" "" "$(label 'traefik.http.middlewares.qf-jarvis-os-hsts.headers.stsSeconds')"
    ;;
  hsts)
    prove "traefik.enable" "true" "$(label 'traefik.enable')"
    prove "HSTS max-age" "31536000" "$(label 'traefik.http.middlewares.qf-jarvis-os-hsts.headers.stsSeconds')"
    ;;
esac

[[ "$fail" -eq 0 ]] || {
  echo "FATAL: rollback did not land in the requested state." >&2
  exit 1
}
echo "==> rolled back: image and configuration are both ${SHA}"
