#!/usr/bin/env bash
# Jarvis OS staged ingress activation (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   activate.sh ingress <exact-merged-git-sha>   # make the router live
#   activate.sh hsts    <exact-merged-git-sha>   # attach HSTS, AFTER TLS is proven
#
# Each stage recreates ONLY the qf-jarvis-os container by re-applying the reviewed compose files
# with one more additive overlay. Shared Traefik is never restarted, recreated, pulled or upgraded:
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
  echo "usage: activate.sh <ingress|hsts> <exact-merged-git-sha>" >&2
  exit 2
}
[[ -n "$STAGE" && -n "$SHA" ]] || usage

case "$STAGE" in
  ingress) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml") ;;
  # HSTS is additive on top of ingress, never instead of it. Applying the HSTS overlay without the
  # ingress overlay would define the middleware and attach it to routers that do not exist.
  hsts) FILES=(-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml" -f "$HERE/compose.hsts.yml") ;;
  *) usage ;;
esac

# The same containment guard deploy.sh uses. Activation re-resolves the image tag, so an unmerged
# SHA must be refused here too rather than only at build time.
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

docker image inspect "qf-jarvis-os:${SHA}" >/dev/null 2>&1 || {
  echo "FATAL: image qf-jarvis-os:${SHA} is not present. Run deploy.sh first." >&2
  exit 1
}

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

if [[ "$STAGE" == "hsts" ]]; then
  STS="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.http.middlewares.qf-jarvis-os-hsts.headers.stsSeconds" }}')"
  [[ "$STS" == "31536000" ]] || {
    echo "FATAL: HSTS max-age label is '$STS', expected 31536000." >&2
    exit 1
  }
  echo "==> HSTS middleware present (max-age=$STS)"
fi

echo "==> stage '${STAGE}' active on revision $RUNNING"
echo "    verify externally before going further:"
if [[ "$STAGE" == "ingress" ]]; then
  echo "      ./smoke.sh pre-hsts jarvis.quickfurno.in"
else
  echo "      ./smoke.sh final jarvis.quickfurno.in"
fi
