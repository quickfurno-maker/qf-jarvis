#!/usr/bin/env bash
# Build and start the exact merged QuickFurno WhatsApp worker SHA in DISABLED mode.
set -Eeuo pipefail

SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"

CONFIG='/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json'
GROQ='/srv/qf-jarvis/secrets/groq-production.key'
SIGNING='/srv/qf-jarvis/secrets/quickfurno-signing.key'
EMBEDDING='/srv/qf-jarvis/secrets/embedding-production.key'
RIYA_DECISION='/srv/qf-jarvis/secrets/riya-persistence-owner-decision.json'
SEAL='/srv/qf-jarvis/seals/jf5c-production-seal.json'
CA='/srv/qf-jarvis/secrets/postgres-ca.pem'
SPOOL='/srv/qf-jarvis/state/quickfurno-gateway-turns'
CONTROL='/srv/qf-jarvis/state/quickfurno-worker-control'
OBSERVABILITY='/srv/qf-jarvis/state/observability'
DISABLE="$CONTROL/DISABLE_MODEL"

die() { echo "FATAL: $1" >&2; exit 1; }
[[ -n "$SHA" ]] || die "usage: deploy.sh <exact-merged-git-sha>"

"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

# Deployment is intentionally impossible in an armed state. Activation is a different operator step.
[[ -f "$DISABLE" ]] || die "$DISABLE is missing. Run disable.sh before deploy."

for file in "$CONFIG" "$GROQ" "$SIGNING" "$EMBEDDING" "$RIYA_DECISION" "$SEAL" "$CA"; do
  [[ -f "$file" && ! -L "$file" ]] || die "$file must be a regular non-symlink file."
done
[[ -d "$SPOOL" && ! -L "$SPOOL" ]] || die "$SPOOL must be the gateway's real spool directory."
[[ -d "$CONTROL" && ! -L "$CONTROL" ]] || die "$CONTROL must be a real directory."
[[ -d "$OBSERVABILITY" && ! -L "$OBSERVABILITY" ]] || die "$OBSERVABILITY must be a real directory."

# Secret-bearing config/key are readable only by the worker uid. The seal and CA are also installed
# privately to keep one simple mount/ownership policy.
for file in "$CONFIG" "$GROQ" "$SIGNING" "$EMBEDDING" "$RIYA_DECISION" "$SEAL" "$CA"; do
  mode="$(stat -c '%a' "$file")"
  owner="$(stat -c '%u:%g' "$file")"
  [[ "$mode" == "400" || "$mode" == "600" ]] ||
    die "$file mode is $mode; expected 400 or 600."
  [[ "$owner" == "10003:10002" ]] ||
    die "$file owner is $owner; expected 10003:10002."
done

# Gateway is uid/gid 10002. Worker is uid 10003 in the SAME gid, so the durable queue has one shared
# group rather than world-writable permissions.
spool_group="$(stat -c '%g' "$SPOOL")"
[[ "$spool_group" == "10002" ]] || die "$SPOOL gid is $spool_group; expected 10002."
spool_mode="$(stat -c '%a' "$SPOOL")"
group_digit="${spool_mode: -2:1}"
[[ "$group_digit" == "7" || "$group_digit" == "6" ]] ||
  die "$SPOOL mode $spool_mode does not grant the shared group read/write."

obs_group="$(stat -c '%g' "$OBSERVABILITY")"
[[ "$obs_group" == "10002" ]] || die "$OBSERVABILITY gid is $obs_group; expected 10002."
obs_mode="$(stat -c '%a' "$OBSERVABILITY")"
obs_group_digit="${obs_mode: -2:1}"
[[ "$obs_group_digit" == "7" || "$obs_group_digit" == "6" ]] ||
  die "$OBSERVABILITY mode $obs_mode does not grant the shared group read/write."

BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" |
  tar -x -C "$BUILD_CTX"

echo "==> building qf-jarvis-whatsapp-worker:$SHA"
docker build   --file "$BUILD_CTX/deploy/quickfurno-worker/Dockerfile"   --build-arg "GIT_SHA=$SHA"   --tag "qf-jarvis-whatsapp-worker:$SHA"   "$BUILD_CTX"

BASE="$BUILD_CTX/deploy/quickfurno-worker/compose.production.yml"
echo "==> starting worker disabled"
QFJ_WORKER_IMAGE_TAG="$SHA" docker compose -p qf-jarvis-whatsapp-worker -f "$BASE" up -d

for _ in $(seq 1 45); do
  running="$(docker inspect qf-jarvis-whatsapp-worker --format '{{.State.Running}}' 2>/dev/null || echo false)"
  if [[ "$running" == "true" ]] &&
     docker logs qf-jarvis-whatsapp-worker 2>&1 | grep -q "qfj-whatsapp-worker READY"; then
    break
  fi
  sleep 2
done
[[ "${running:-false}" == "true" ]] || die "worker is not running."
docker logs qf-jarvis-whatsapp-worker 2>&1 | grep -q "qfj-whatsapp-worker READY" ||
  die "worker never reached evidence-gated READY."

fail=0
prove() {
  if [[ "$2" == "$3" ]]; then printf '  ok    %-38s %s\n' "$1" "$3"; else
    printf '  FAIL  %-38s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

echo "==> disabled deployment proof"
prove "image revision" "$SHA"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
prove "uid:gid" "10003:10002"   "$(docker exec qf-jarvis-whatsapp-worker sh -c 'printf "%s:%s" "$(id -u)" "$(id -g)"')"
prove "read-only rootfs" "true"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{.HostConfig.ReadonlyRootfs}}')"
prove "capabilities dropped" "[ALL]"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{.HostConfig.CapDrop}}')"
prove "capabilities added" "[]"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{.HostConfig.CapAdd}}')"
prove "no-new-privileges" "true"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .HostConfig.SecurityOpt}}{{if eq . "no-new-privileges:true"}}true{{end}}{{end}}')"
prove "published host ports" ""   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}')"
prove "traefik disabled" "false"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{ index .Config.Labels "traefik.enable" }}')"
prove "gateway spool source" "$SPOOL"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/lib/qfj-turns"}}{{.Source}}{{end}}{{end}}')"
prove "spool writable" "true"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/lib/qfj-turns"}}{{.RW}}{{end}}{{end}}')"
prove "observation source" "$OBSERVABILITY"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/run/qfj-observability"}}{{.Source}}{{end}}{{end}}')"
prove "observation writable" "true"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/run/qfj-observability"}}{{.RW}}{{end}}{{end}}')"
prove "kill switch visible" "true"   "$(docker exec qf-jarvis-whatsapp-worker node -e "const fs=require('node:fs');console.log(fs.existsSync('/var/run/qfj-control/DISABLE_MODEL'))")"

[[ "$fail" -eq 0 ]] || die "disabled deployment proof failed."

cat <<EOF

DISABLED deployment verified for $SHA.
No public port exists and the worker cannot claim a turn while DISABLE_MODEL exists.

Do not activate until:
  - the exact merged SHA has a passing JF-5B run,
  - all three blinded human reviews ACCEPT,
  - owner ACCEPT is recorded,
  - the matching JF-5C v2 seal is mounted,
  - QuickFurno's matching merged SHA/config is deployed,
  - the operator has approved the production canary.

Activation is a separate command:
  $HERE/activate.sh $SHA
EOF
