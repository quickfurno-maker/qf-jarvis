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
