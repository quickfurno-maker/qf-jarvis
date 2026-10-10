#!/usr/bin/env bash
# Build and start the exact merged QuickFurno WhatsApp worker SHA in DISABLED mode.
set -Eeuo pipefail

SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"

CONFIG='/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json'
GROQ='/srv/qf-jarvis/secrets/groq-production.key'
OPENAI='/srv/qf-jarvis/secrets/openai-production.key'
JEV='/srv/qf-jarvis/secrets/typesafe-jev-production.key'
SIGNING='/srv/qf-jarvis/secrets/quickfurno-signing.key'
EMBEDDING='/srv/qf-jarvis/secrets/embedding-production.key'
GROQ_SEAL='/srv/qf-jarvis/seals/jf5c-production-seal.json'
OPENAI_SEAL='/srv/qf-jarvis/seals/openai-v1-production-seal.json'
CA='/srv/qf-jarvis/secrets/postgres-ca.pem'
PROVIDER_MODE="${QFJ_WORKER_PROVIDER_MODE:-GROQ_ONLY}"
KNOWLEDGE_MODE="${QFJ_WORKER_KNOWLEDGE_MODE:-DISABLED}"
JEV_MODE="${QFJ_WORKER_JEV_MODE:-DISABLED}"
CONTROL='/srv/qf-jarvis/state/quickfurno-worker-control'
OBSERVABILITY='/srv/qf-jarvis/state/observability'
DISABLE="$CONTROL/DISABLE_MODEL"

die() { echo "FATAL: $1" >&2; exit 1; }
[[ -n "$SHA" ]] || die "usage: deploy.sh <exact-merged-git-sha>"

"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

# Deployment is intentionally impossible in an armed state. Activation is a different operator step.
[[ -f "$DISABLE" ]] || die "$DISABLE is missing. Run disable.sh before deploy."
[[ "$PROVIDER_MODE" == "GROQ_ONLY" || "$PROVIDER_MODE" == "OPENAI_LUNA_SOL" ]] ||
  die "QFJ_WORKER_PROVIDER_MODE must be GROQ_ONLY or OPENAI_LUNA_SOL."
[[ "$KNOWLEDGE_MODE" == "DISABLED" || "$KNOWLEDGE_MODE" == "HYBRID" ]] ||
  die "QFJ_WORKER_KNOWLEDGE_MODE must be DISABLED or HYBRID."
[[ "$JEV_MODE" == "DISABLED" || "$JEV_MODE" == "SHADOW" ]] ||
  die "QFJ_WORKER_JEV_MODE must be DISABLED or SHADOW."

# PostgreSQL is the durable production turn store for every provider mode.
# The CA is therefore required even when knowledge/RAG is disabled.
required_files=("$CONFIG" "$SIGNING" "$CA")
if [[ "$PROVIDER_MODE" == "OPENAI_LUNA_SOL" ]]; then
  required_files+=("$OPENAI" "$OPENAI_SEAL")
else
  required_files+=("$GROQ" "$GROQ_SEAL")
fi
if [[ "$JEV_MODE" == "SHADOW" ]]; then
  required_files+=("$JEV")
fi
if [[ "$KNOWLEDGE_MODE" == "HYBRID" ]]; then
  required_files+=("$EMBEDDING")
fi

for file in "${required_files[@]}"; do
  [[ -f "$file" && ! -L "$file" ]] || die "$file must be a regular non-symlink file."
done
[[ -d "$CONTROL" && ! -L "$CONTROL" ]] || die "$CONTROL must be a real directory."
[[ -d "$OBSERVABILITY" && ! -L "$OBSERVABILITY" ]] || die "$OBSERVABILITY must be a real directory."

# The worker writes observations as 10003:10002 and Jarvis OS reads them as 10001 plus
# supplementary group 10002. Keep the shared directory root-controlled, group-writable
# for atomic replacement, and group-traversable/readable without granting world access.
install -d -o 0 -g 10002 -m 0770 "$OBSERVABILITY"
[[ "$(stat -c '%u:%g' "$OBSERVABILITY")" == "0:10002" ]] ||
  die "$OBSERVABILITY owner/group must be 0:10002."
[[ "$(stat -c '%a' "$OBSERVABILITY")" == "770" ]] ||
  die "$OBSERVABILITY mode must be 770."

# Durable turn ownership lives in PostgreSQL. No application-host spool directory is
# created, repaired, mounted or permissioned here. The control and observability paths
# below are operational surfaces only; neither is business truth.

# Every mounted secret/evidence file is privately readable by the worker uid. Knowledge-only files are
# checked and mounted only when HYBRID is explicitly requested.
for file in "${required_files[@]}"; do
  mode="$(stat -c '%a' "$file")"
  owner="$(stat -c '%u:%g' "$file")"
  [[ "$mode" == "400" || "$mode" == "600" ]] ||
    die "$file mode is $mode; expected 400 or 600."
  [[ "$owner" == "10003:10002" ]] ||
    die "$file owner is $owner; expected 10003:10002."
done

obs_group="$(stat -c '%g' "$OBSERVABILITY")"
[[ "$obs_group" == "10002" ]] || die "$OBSERVABILITY gid is $obs_group; expected 10002."
obs_mode="$(stat -c '%a' "$OBSERVABILITY")"
obs_group_digit="${obs_mode: -2:1}"
[[ "$obs_group_digit" == "7" ]] ||
  die "$OBSERVABILITY mode $obs_mode does not grant the shared group read/write/traverse."

BUILD_CTX="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX"' EXIT
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" |
  tar -x -C "$BUILD_CTX"

if [[ "${QFJ_WORKER_SKIP_BUILD:-0}" == "1" ]]; then
  image_revision="$(docker image inspect "qf-jarvis-whatsapp-worker:$SHA" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
  [[ "$image_revision" == "$SHA" ]] || die "prebuilt worker image is missing or has the wrong revision."
  echo "==> reusing exact prebuilt qf-jarvis-whatsapp-worker:$SHA"
else
  echo "==> building qf-jarvis-whatsapp-worker:$SHA"
  docker build --file "$BUILD_CTX/deploy/quickfurno-worker/Dockerfile" --build-arg "GIT_SHA=$SHA" --tag "qf-jarvis-whatsapp-worker:$SHA" "$BUILD_CTX"
fi

if [[ "$PROVIDER_MODE" == "OPENAI_LUNA_SOL" ]]; then
  BASE="$BUILD_CTX/deploy/quickfurno-worker/compose.openai.production.yml"
else
  BASE="$BUILD_CTX/deploy/quickfurno-worker/compose.production.yml"
fi
KNOWLEDGE_OVERRIDE="$BUILD_CTX/deploy/quickfurno-worker/compose.knowledge.yml"
JEV_OVERRIDE="$BUILD_CTX/deploy/quickfurno-worker/compose.jev.yml"
compose_args=(-p qf-jarvis-whatsapp-worker -f "$BASE")
if [[ "$KNOWLEDGE_MODE" == "HYBRID" ]]; then
  compose_args+=(-f "$KNOWLEDGE_OVERRIDE")
fi
if [[ "$JEV_MODE" == "SHADOW" ]]; then
  compose_args+=(-f "$JEV_OVERRIDE")
fi
echo "==> starting worker disabled (provider=$PROVIDER_MODE knowledge=$KNOWLEDGE_MODE jev=$JEV_MODE)"
QFJ_WORKER_IMAGE_TAG="$SHA" docker compose "${compose_args[@]}" up -d

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

aos_observation_status="missing"
for _ in $(seq 1 30); do
  if docker exec qf-jarvis-whatsapp-worker node -e '
    const fs=require("node:fs");
    const market=JSON.parse(fs.readFileSync("/var/run/qfj-observability/aos-market-capacity.json","utf8"));
    if(market.protocol!=="qfj.aos.market-capacity-observation.v1")process.exit(2);
    if(market.executionAuthority!=="NONE"||market.businessEffect!==false||market.productionMutation!==false)process.exit(3);
    const attention=JSON.parse(fs.readFileSync("/var/run/qfj-observability/aos-owner-attention.json","utf8"));
    if(attention.protocol!=="qfj.aos.owner-attention-observation.v1")process.exit(4);
    if(attention.executionAuthority!=="NONE"||attention.businessEffect!==false||attention.outboundNotificationAuthorized!==false)process.exit(5);
  ' >/dev/null 2>&1; then
    aos_observation_status="ready"
    break
  fi
  sleep 1
done
if [[ "$aos_observation_status" != "ready" ]]; then
  echo "AOS_SHADOW_OBSERVATION_NOT_READY" >&2
  docker logs qf-jarvis-whatsapp-worker 2>&1 |
    grep 'aos.market_capacity.cycle_failed' |
    tail -n 1 >&2 || true
fi

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
prove "legacy turn spool absent" ""   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/lib/qfj-turns"}}{{.Source}}{{end}}{{end}}')"
prove "postgres CA source" "$CA"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/postgres-ca.pem"}}{{.Source}}{{end}}{{end}}')"
prove "observation source" "$OBSERVABILITY"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/run/qfj-observability"}}{{.Source}}{{end}}{{end}}')"
prove "observation writable" "true"   "$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/var/run/qfj-observability"}}{{.RW}}{{end}}{{end}}')"
prove "AOS shadow observations" "ready" "$aos_observation_status"
prove "kill switch visible" "true"   "$(docker exec qf-jarvis-whatsapp-worker node -e "const fs=require('node:fs');console.log(fs.existsSync('/var/run/qfj-control/DISABLE_MODEL'))")"

openai_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/openai-production.key"}}{{.Source}}{{end}}{{end}}')"
openai_seal_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/openai-v1-production-seal.json"}}{{.Source}}{{end}}{{end}}')"
groq_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/groq-production.key"}}{{.Source}}{{end}}{{end}}')"
if [[ "$PROVIDER_MODE" == "OPENAI_LUNA_SOL" ]]; then
  prove "OpenAI secret source" "$OPENAI" "$openai_mount"
  prove "OpenAI seal source" "$OPENAI_SEAL" "$openai_seal_mount"
  prove "Groq secret absent" "" "$groq_mount"
else
  prove "Groq secret source" "$GROQ" "$groq_mount"
  prove "OpenAI secret absent" "" "$openai_mount"
fi

jev_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/typesafe-jev-production.key"}}{{.Source}}{{end}}{{end}}')"
if [[ "$JEV_MODE" == "SHADOW" ]]; then
  prove "TypeSafe Jev secret source" "$JEV" "$jev_mount"
else
  prove "TypeSafe Jev secret absent" "" "$jev_mount"
fi

embedding_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/embedding-production.key"}}{{.Source}}{{end}}{{end}}')"
ca_mount="$(docker inspect qf-jarvis-whatsapp-worker --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/postgres-ca.pem"}}{{.Source}}{{end}}{{end}}')"
if [[ "$KNOWLEDGE_MODE" == "HYBRID" ]]; then
  prove "embedding secret source" "$EMBEDDING" "$embedding_mount"
  prove "postgres CA source" "$CA" "$ca_mount"
else
  prove "embedding secret absent" "" "$embedding_mount"
  prove "postgres CA absent" "" "$ca_mount"
fi

[[ "$fail" -eq 0 ]] || die "disabled deployment proof failed."

if [[ "$PROVIDER_MODE" == "OPENAI_LUNA_SOL" ]]; then
  PROVIDER_GATE="the six-call OpenAI launch smoke passed and the exact OpenAI v1 production seal is mounted"
else
  PROVIDER_GATE="the exact merged SHA has the matching Groq JF-5C production seal mounted"
fi

cat <<EOF

DISABLED deployment verified for $SHA (provider=$PROVIDER_MODE knowledge=$KNOWLEDGE_MODE jev=$JEV_MODE).
No public port exists and the worker cannot claim a turn while DISABLE_MODEL exists.

Before activation confirm:
  - $PROVIDER_GATE,
  - QuickFurno's matching merged SHA/config is deployed,
  - the worker READY line reports the intended provider mode and approval count.

Activation is a separate command:
  $HERE/activate.sh $SHA
EOF
