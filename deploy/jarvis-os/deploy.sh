#!/usr/bin/env bash
# Jarvis OS PRIVATE deployment (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   deploy.sh <exact-merged-git-sha>
#
# Builds one exact merged commit and starts it PRIVATELY, then proves it. It deliberately stops
# before ingress: making the container publicly routable is `activate.sh ingress`, a separate
# reviewed step that runs only after every proof below has passed.
#
# Every guard here exists because the alternative failure is silent -- deploying a commit that was
# never reviewed, deploying a tag that moved, or "verifying" a container that has been serving the
# internet since the moment it started.
set -Eeuo pipefail

SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  echo "usage: deploy.sh <exact-merged-git-sha>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
SECRET="/srv/qf-jarvis/secrets/jarvis-os-auth.json"
BASE="$HERE/compose.production.yml"

# ---------------------------------------------------------------------------------------------
# 1. The commit must be reviewed code
# ---------------------------------------------------------------------------------------------
# Fails closed unless the SHA is well-formed, exists, and is contained in origin/main. Nothing is
# built and nothing is started if this fails.
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

# ---------------------------------------------------------------------------------------------
# 1b. THIS SCRIPT's own directory must be that commit's release package
# ---------------------------------------------------------------------------------------------
# Everything below -- the Dockerfile that gets built, the Compose file that defines the hardening,
# the overlays that activate.sh will apply -- is read from $HERE. Verifying only the image would
# leave the configuration unbound: a deployment could be truthfully labelled with a commit whose
# Compose file it was not actually running.
#
# The check also forbids a mutable shared directory such as /srv/qf-jarvis/deploy, because the
# package must sit at /srv/qf-jarvis/releases/<sha>/jarvis-os. There is no fallback path.
#
# Run prepare-release.sh <sha> first; it prints the directory to run this from.
"$HERE/verify-release-artifacts.sh" "$SHA" "$HERE" "$REPO_DIR"

# ---------------------------------------------------------------------------------------------
# 2. The secret must already be installed correctly
# ---------------------------------------------------------------------------------------------
# The application refuses a group- or world-readable file, so failing here gives a clearer message
# than a 503 later.
[[ -f "$SECRET" ]] || {
  echo "FATAL: $SECRET is missing. Install it before deploying." >&2
  exit 1
}
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

# ---------------------------------------------------------------------------------------------
# 3. Build from a clean checkout of that exact commit
# ---------------------------------------------------------------------------------------------
# `git archive` produces TRACKED files only, so untracked local material -- including protected
# paths -- cannot enter the build context regardless of the state of the working tree.
BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$BUILD_CTX"

echo "==> building qf-jarvis-os:${SHA}"
docker build \
  --file "$BUILD_CTX/deploy/jarvis-os/Dockerfile" \
  --build-arg "GIT_SHA=${SHA}" \
  --tag "qf-jarvis-os:${SHA}" \
  "$BUILD_CTX"

# ---------------------------------------------------------------------------------------------
# 4. Start PRIVATELY -- base compose only, no ingress overlay
# ---------------------------------------------------------------------------------------------
echo "==> starting privately (no Traefik router; project qf-jarvis-os only)"
JOS_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-os -f "$BASE" up -d

echo "==> waiting for container health"
for _ in $(seq 1 60); do
  STATUS="$(docker inspect qf-jarvis-os --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 2
done
[[ "$STATUS" == "healthy" ]] || {
  echo "FATAL: container did not become healthy (last status: $STATUS)." >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------
# 5. Prove it, while it is still private
# ---------------------------------------------------------------------------------------------
fail=0
prove() { # name expected actual
  if [[ "$2" == "$3" ]]; then printf '  ok    %-40s %s\n' "$1" "$3"; else
    printf '  FAIL  %-40s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

echo "==> private proof"
prove "image revision" "$SHA" \
  "$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
prove "uid:gid" "10001:10001" "$(docker exec qf-jarvis-os id -u):$(docker exec qf-jarvis-os id -g)"
prove "read-only rootfs" "true" "$(docker inspect qf-jarvis-os --format '{{.HostConfig.ReadonlyRootfs}}')"
prove "capabilities dropped" "[ALL]" "$(docker inspect qf-jarvis-os --format '{{.HostConfig.CapDrop}}')"
prove "capabilities added" "[]" "$(docker inspect qf-jarvis-os --format '{{.HostConfig.CapAdd}}')"
prove "no-new-privileges" "true" \
  "$(docker inspect qf-jarvis-os --format '{{range .HostConfig.SecurityOpt}}{{if eq . "no-new-privileges:true"}}true{{end}}{{end}}')"
# Projected to HOST PORTS, not compared against the raw map.
#
# The Dockerfile has `EXPOSE 3000`, so an unpublished container still reports
# `map[3000/tcp:[]]` -- the key exists with an empty binding list. Asserting `map[]` would fail on a
# correct deployment and pass only if EXPOSE were removed. What must be empty is the set of HOST
# bindings, which is what this projection yields: empty here, and "31234" for a container run with
# `-p 127.0.0.1:31234:3000`. Both were measured.
prove "published host ports" "" \
  "$(docker inspect qf-jarvis-os --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}')"
prove "secret mounted read-only" "true" \
  "$(docker inspect qf-jarvis-os --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/qf-jarvis-os-auth.json"}}{{not .RW}}{{end}}{{end}}')"

# Internal HTTP, from inside the container: the application is not reachable any other way yet.
IN() { docker exec qf-jarvis-os node -e "fetch('http://127.0.0.1:3000'+process.argv[1],{redirect:'manual'}).then(r=>console.log(r.status)).catch(()=>console.log('ERR'))" "$1"; }
prove "internal /login" "200" "$(IN /login)"
prove "internal / (unauth)" "307" "$(IN /)"
prove "internal snapshot (unauth)" "401" "$(IN /api/control-plane/v1/snapshot)"

# ---------------------------------------------------------------------------------------------
# 6. Prove Traefik has NOT picked it up
# ---------------------------------------------------------------------------------------------
# The point of the private stage. `traefik.enable` must be false and no router/service/middleware
# label may exist on the running container -- read from the container itself, not from the file, so
# this reflects what Traefik's Docker provider can actually see.
echo "==> proving no public router exists yet"
ENABLED="$(docker inspect qf-jarvis-os --format '{{ index .Config.Labels "traefik.enable" }}')"
prove "traefik.enable" "false" "$ENABLED"
ROUTERS="$(docker inspect qf-jarvis-os --format '{{range $k,$v := .Config.Labels}}{{$k}}
{{end}}' | grep -c '^traefik\.http\.' || true)"
prove "traefik routing labels" "0" "$ROUTERS"

if [[ "$fail" -ne 0 ]]; then
  echo "FATAL: private proof failed. Do NOT activate ingress." >&2
  exit 1
fi

cat <<EOF

==> PRIVATE deployment verified: qf-jarvis-os:${SHA}

Image AND deployment configuration are both bound to ${SHA}.
It is running and reachable by nobody: no published port, no Traefik router.

Next, in order -- all from this same verified release directory:
  1. Confirm DNS:            dig +short A jarvis.quickfurno.in
  2. Activate ingress:       ${HERE}/activate.sh ingress ${SHA}
  3. Verify TLS externally:  ${HERE}/smoke.sh pre-hsts jarvis.quickfurno.in
  4. Activate HSTS:          ${HERE}/activate.sh hsts ${SHA}
  5. Final verification:     ${HERE}/smoke.sh final jarvis.quickfurno.in
EOF
