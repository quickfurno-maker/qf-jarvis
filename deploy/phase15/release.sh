#!/usr/bin/env bash
# QF Jarvis Scale Phase 15 immutable release controller.
# Jarvis OS is blue/green. Gateway + durable worker are updated by controlled
# rolling/drain only after the new OS traffic path is externally proven.
set -Eeuo pipefail
umask 077

COMMAND="${1:-}"
MANIFEST="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLI="$ROOT/scripts/scale/phase15-release.mjs"
STATE_ROOT="${QFJ_PHASE15_STATE_ROOT:-/var/lib/qf-jarvis-phase15}"
STATE_FILE="$STATE_ROOT/state.json"
STAGED_MANIFEST="$STATE_ROOT/staged-manifest.json"
CURRENT_MANIFEST="$STATE_ROOT/current-manifest.json"
PREVIOUS_MANIFEST="$STATE_ROOT/previous-manifest.json"
LOCK_FILE="$STATE_ROOT/release.lock"
SWITCH_ADAPTER="${QFJ_PHASE15_SWITCH_ADAPTER:-/usr/local/sbin/qfj-phase15-switch}"
PUBLIC_SMOKE_URL="${QFJ_PHASE15_PUBLIC_SMOKE_URL:-https://jarvis.quickfurno.in/login}"
TRAEFIK_DYNAMIC_FILE="${QFJ_PHASE15_TRAEFIK_DYNAMIC_FILE:-/docker/traefik/dynamic/jarvis-phase15.yml}"
REPO_DIR="${QFJ_REPO_DIR:-/srv/qf-jarvis/repo}"
WORKER_PROVIDER_MODE="${QFJ_WORKER_PROVIDER_MODE:-OPENAI_LUNA_SOL}"
WORKER_KNOWLEDGE_MODE="${QFJ_WORKER_KNOWLEDGE_MODE:-DISABLED}"
WORKER_JEV_MODE="${QFJ_WORKER_JEV_MODE:-DISABLED}"

OS_BASE="$ROOT/deploy/jarvis-os/compose.production.yml"
OS_REGISTRY="$ROOT/deploy/jarvis-os/compose.registry.yml"
OS_SLOT="$ROOT/deploy/phase15/compose.jarvis-os-slot.yml"
COORDINATION_COMPOSE="$ROOT/deploy/coordination/compose.production.yml"
GATEWAY_BASE="$ROOT/deploy/quickfurno-gateway/compose.production.yml"
GATEWAY_REGISTRY="$ROOT/deploy/quickfurno-gateway/compose.registry.yml"
GATEWAY_COORDINATION="$ROOT/deploy/quickfurno-gateway/compose.coordination.yml"
GATEWAY_INGRESS="$ROOT/deploy/quickfurno-gateway/compose.ingress.yml"
GATEWAY_OBSERVABILITY="$ROOT/deploy/quickfurno-gateway/compose.observability.yml"
GATEWAY_DATABASE_CONFIG="/srv/qf-jarvis/secrets/qf-jarvis-gateway-database.json"
GATEWAY_DATABASE_CA="/srv/qf-jarvis/secrets/postgres-ca.pem"
WORKER_BASE_GROQ="$ROOT/deploy/quickfurno-worker/compose.production.yml"
WORKER_BASE_OPENAI="$ROOT/deploy/quickfurno-worker/compose.openai.production.yml"
WORKER_REGISTRY="$ROOT/deploy/quickfurno-worker/compose.registry.yml"
WORKER_COORDINATION="$ROOT/deploy/quickfurno-worker/compose.coordination.yml"
WORKER_KNOWLEDGE="$ROOT/deploy/quickfurno-worker/compose.knowledge.yml"
WORKER_JEV="$ROOT/deploy/quickfurno-worker/compose.jev.yml"
WORKER_OBSERVABILITY="$ROOT/deploy/quickfurno-worker/compose.observability.yml"
WORKER_DISABLE="$ROOT/deploy/quickfurno-worker/disable.sh"
WORKER_ACTIVATE="$ROOT/deploy/quickfurno-worker/activate.sh"

die(){ echo "QFJ_PHASE15_REFUSED: $1" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "must run as root on the approved deployment host"

install -d -o 0 -g 0 -m 0700 "$STATE_ROOT"
[[ -d "$STATE_ROOT" && ! -L "$STATE_ROOT" ]] || die "state root invalid"
touch "$LOCK_FILE"; chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"; flock -x 9

manifest_value(){
  local file="$1" field="$2"
  node - "$file" "$field" <<'NODE'
const fs=require('node:fs');
const [file,field]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(file,'utf8'));
if(field==='sha') console.log(m.sourceSha);
else if(field==='release') console.log(m.releaseId);
else if(field.startsWith('image:')){
  const role=field.slice(6);
  const image=m.images.find((x)=>x.role===role);
  if(!image) process.exit(2);
  console.log(image.ref);
}else throw new Error('field');
NODE
}

state_value(){
  local field="$1"
  [[ -f "$STATE_FILE" ]] || { printf '\n'; return; }
  node -e 'const fs=require("node:fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=j[process.argv[2]];console.log(v==null?"":v)' "$STATE_FILE" "$field"
}

validate_manifest(){
  [[ -f "$1" && ! -L "$1" ]] || die "manifest must be regular non-symlink file"
  node "$CLI" validate --manifest "$1" --system JARVIS --promotable
}

verify_image(){
  local ref="$1" sha="$2" actual
  [[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "QFJ_PHASE15_IMAGE_REFUSED: mutable image reference" >&2; return 1; }
  docker pull "$ref" >/dev/null || return 1
  actual="$(docker image inspect "$ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$actual" == "$sha" ]] || { echo "QFJ_PHASE15_IMAGE_REFUSED: image revision $actual does not match $sha" >&2; return 1; }
}

target_slot(){
  local manifest="$1"
  if [[ -f "$STATE_FILE" ]]; then
    node "$CLI" plan --manifest "$manifest" --state "$STATE_FILE" --system JARVIS |
      node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).targetSlot));'
  else
    node "$CLI" plan --manifest "$manifest" --system JARVIS |
      node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).targetSlot));'
  fi
}

os_compose(){
  local slot="$1" manifest="$2"; shift 2
  local sha ref host_port
  sha="$(manifest_value "$manifest" sha)"
  ref="$(manifest_value "$manifest" image:jarvis-os)"
  case "$slot" in
    blue) host_port=3201 ;;
    green) host_port=3202 ;;
    *) die "invalid Jarvis OS slot: $slot" ;;
  esac
  env JOS_IMAGE_TAG="$sha" JOS_IMAGE_REF="$ref" QFJ_PHASE15_SLOT="$slot" QFJ_PHASE15_HOST_PORT="$host_port" \
    docker compose -p "qf-jarvis-os-$slot" -f "$OS_BASE" -f "$OS_REGISTRY" -f "$OS_SLOT" "$@"
}

wait_os(){
  local slot="$1" manifest="$2" id status sha
  sha="$(manifest_value "$manifest" sha)"
  id="$(os_compose "$slot" "$manifest" ps -q jarvis-os)"
  [[ -n "$id" ]] || die "Jarvis OS $slot container missing"
  status=unknown
  for _ in $(seq 1 60); do
    status="$(docker inspect "$id" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || die "Jarvis OS $slot unhealthy: $status"
  [[ "$(docker inspect "$id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] ||
    die "Jarvis OS revision mismatch"
  docker exec "$id" node -e "fetch('http://127.0.0.1:3000/login',{redirect:'manual'}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
  [[ "$(docker inspect "$id" --format '{{ index .Config.Labels "traefik.enable" }}')" == "false" ]] ||
    die "staged Jarvis OS must remain private"
}

switch_traffic(){
  local slot="$1" manifest="$2" id sha
  [[ -x "$SWITCH_ADAPTER" ]] || die "approved switch adapter missing: $SWITCH_ADAPTER"
  id="$(os_compose "$slot" "$manifest" ps -q jarvis-os)"
  sha="$(manifest_value "$manifest" sha)"
  "$SWITCH_ADAPTER" "$slot" "$id" "$sha"
}

public_smoke(){
  [[ "$PUBLIC_SMOKE_URL" == https://* ]] || die "public smoke must use HTTPS"
  curl --fail --silent --show-error --location --max-time 10 --retry 2 "$PUBLIC_SMOKE_URL" >/dev/null
}

legacy_runtime_healthy(){
  [[ "$(docker inspect qf-jarvis-os --format '{{.State.Health.Status}}' 2>/dev/null || true)" == "healthy" ]] || return 1
  [[ "$(docker inspect qf-jarvis-gateway --format '{{.State.Health.Status}}' 2>/dev/null || true)" == "healthy" ]] || return 1
  [[ "$(docker inspect qf-jarvis-whatsapp-worker --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]] || return 1
  docker logs qf-jarvis-whatsapp-worker 2>&1 | grep -q 'qfj-whatsapp-worker READY'
}

reconcile_bootstrap(){
  local active backup headers ok
  active="$(state_value activeSlot)"
  [[ -z "$active" ]] || die "bootstrap reconcile requires null release state"
  [[ ! -f "$CURRENT_MANIFEST" && ! -f "$PREVIOUS_MANIFEST" ]] ||
    die "bootstrap reconcile refuses signed current/previous state"
  [[ -f "$TRAEFIK_DYNAMIC_FILE" && ! -L "$TRAEFIK_DYNAMIC_FILE" ]] ||
    die "bootstrap reconcile route is absent"
  grep -Eq "127\\.0\\.0\\.1:(3201|3202)" "$TRAEFIK_DYNAMIC_FILE" ||
    die "bootstrap reconcile route is not a Phase-15 slot"
  legacy_runtime_healthy || die "legacy Jarvis runtime is not healthy"

  backup="$STATE_ROOT/bootstrap-reconcile-route.yml"
  install -o 0 -g 0 -m 0600 "$TRAEFIK_DYNAMIC_FILE" "$backup"
  rm -f "$TRAEFIK_DYNAMIC_FILE"

  ok=0
  for _ in $(seq 1 30); do
    headers="$(mktemp "$STATE_ROOT/.bootstrap-headers.XXXXXX")"
    if curl -fsS -D "$headers" -o /dev/null --max-time 10 "$PUBLIC_SMOKE_URL" &&
       ! tr -d '\r' < "$headers" | grep -qi '^x-qfj-release:'; then
      ok=1
      rm -f "$headers"
      break
    fi
    rm -f "$headers"
    sleep 2
  done
  if [[ "$ok" != "1" ]]; then
    install -o 0 -g 0 -m 0644 "$backup" "$TRAEFIK_DYNAMIC_FILE"
    die "legacy route did not recover; Phase-15 route restored"
  fi

  docker stop qf-jarvis-os-blue qf-jarvis-os-green >/dev/null 2>&1 || true
  rm -f "$STAGED_MANIFEST"
  echo "QFJ_PHASE15_BOOTSTRAP_RECONCILED route=legacy state=null"
}

ensure_coordination(){
  local id status
  [[ -f "$COORDINATION_COMPOSE" ]] || die "coordination compose missing"
  docker compose -p qf-jarvis-coordination -f "$COORDINATION_COMPOSE" up -d valkey ||
    die "coordination startup failed"
  id="$(docker compose -p qf-jarvis-coordination -f "$COORDINATION_COMPOSE" ps -q valkey)"
  [[ -n "$id" ]] || die "coordination container missing"
  status=unknown
  for _ in $(seq 1 45); do
    status="$(docker inspect "$id" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || die "coordination unhealthy: $status"
  docker network inspect qf-jarvis-coordination >/dev/null 2>&1 || die "coordination network missing"
}

preflight_gateway_database_secrets(){
  [[ -f "$GATEWAY_DATABASE_CONFIG" && ! -L "$GATEWAY_DATABASE_CONFIG" && -s "$GATEWAY_DATABASE_CONFIG" ]] || {
    echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway database config source must be a non-empty regular file" >&2
    return 1
  }
  [[ -f "$GATEWAY_DATABASE_CA" && ! -L "$GATEWAY_DATABASE_CA" && -s "$GATEWAY_DATABASE_CA" ]] || {
    echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway database CA source must be a non-empty regular file" >&2
    return 1
  }
  node - "$GATEWAY_DATABASE_CONFIG" <<'NODE' || return 1
const fs = require("node:fs");
const path = process.argv[2];
let value;
try {
  value = JSON.parse(fs.readFileSync(path, "utf8"));
} catch {
  process.stderr.write("QFJ_PHASE15_CONSUMER_REFUSED: gateway database config JSON invalid\n");
  process.exit(1);
}
const ok =
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof value.connectionString === "string" &&
  value.connectionString.length > 0 &&
  value.tls &&
  typeof value.tls === "object" &&
  value.tls.mode === "verify-full" &&
  value.tls.caFile === "/run/secrets/postgres-ca.pem" &&
  (value.maxConnections === undefined ||
    (Number.isInteger(value.maxConnections) && value.maxConnections >= 1 && value.maxConnections <= 3));
if (!ok) {
  process.stderr.write("QFJ_PHASE15_CONSUMER_REFUSED: gateway database config shape invalid\n");
  process.exit(1);
}
NODE
  openssl x509 -in "$GATEWAY_DATABASE_CA" -noout -text 2>/dev/null | grep -q 'CA:TRUE' || {
    echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway database CA bundle invalid" >&2
    return 1
  }
}

roll_gateway(){
  local manifest="$1" sha ref id status
  preflight_gateway_database_secrets || return 1
  sha="$(manifest_value "$manifest" sha)"
  ref="$(manifest_value "$manifest" image:jarvis-gateway)"
  verify_image "$ref" "$sha" || return 1
  env QFJ_GATEWAY_IMAGE_TAG="$sha" QFJ_GATEWAY_IMAGE_REF="$ref" \
    docker compose -p qf-jarvis-gateway \
      -f "$GATEWAY_BASE" -f "$GATEWAY_REGISTRY" -f "$GATEWAY_COORDINATION" -f "$GATEWAY_INGRESS" -f "$GATEWAY_OBSERVABILITY" up -d quickfurno-gateway || return 1
  id="$(env QFJ_GATEWAY_IMAGE_TAG="$sha" QFJ_GATEWAY_IMAGE_REF="$ref" docker compose -p qf-jarvis-gateway -f "$GATEWAY_BASE" -f "$GATEWAY_REGISTRY" -f "$GATEWAY_COORDINATION" -f "$GATEWAY_INGRESS" -f "$GATEWAY_OBSERVABILITY" ps -q quickfurno-gateway)"
  [[ -n "$id" ]] || { echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway container missing" >&2; return 1; }
  status=unknown
  for _ in $(seq 1 45); do
    status="$(docker inspect "$id" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || { echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway unhealthy: $status" >&2; return 1; }
  [[ "$(docker inspect "$id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] || {
    echo "QFJ_PHASE15_CONSUMER_REFUSED: gateway revision mismatch" >&2
    return 1
  }
}

worker_args(){
  local base
  case "$WORKER_PROVIDER_MODE" in
    GROQ_ONLY) base="$WORKER_BASE_GROQ" ;;
    OPENAI_LUNA_SOL) base="$WORKER_BASE_OPENAI" ;;
    *) die "worker provider mode invalid" ;;
  esac
  WORKER_ARGS=(-p qf-jarvis-whatsapp-worker -f "$base" -f "$WORKER_REGISTRY" -f "$WORKER_COORDINATION" -f "$WORKER_OBSERVABILITY")
  case "$WORKER_KNOWLEDGE_MODE" in
    DISABLED) ;;
    HYBRID) WORKER_ARGS+=(-f "$WORKER_KNOWLEDGE") ;;
    *) die "worker knowledge mode invalid" ;;
  esac
  case "$WORKER_JEV_MODE" in
    DISABLED) ;;
    SHADOW) WORKER_ARGS+=(-f "$WORKER_JEV") ;;
    *) die "worker JEV mode invalid" ;;
  esac
}

roll_worker_disabled(){
  local manifest="$1" sha ref id running
  sha="$(manifest_value "$manifest" sha)"
  ref="$(manifest_value "$manifest" image:jarvis-worker)"
  verify_image "$ref" "$sha" || return 1
  "$WORKER_DISABLE" >/dev/null || return 1
  worker_args
  env QFJ_WORKER_IMAGE_TAG="$sha" QFJ_WORKER_IMAGE_REF="$ref" \
    docker compose "${WORKER_ARGS[@]}" up -d quickfurno-worker || return 1
  id="$(env QFJ_WORKER_IMAGE_TAG="$sha" QFJ_WORKER_IMAGE_REF="$ref" docker compose "${WORKER_ARGS[@]}" ps -q quickfurno-worker)"
  [[ -n "$id" ]] || { echo "QFJ_PHASE15_CONSUMER_REFUSED: worker container missing" >&2; return 1; }
  running=false
  for _ in $(seq 1 60); do
    running="$(docker inspect "$id" --format '{{.State.Running}}' 2>/dev/null || echo false)"
    if [[ "$running" == "true" ]] && docker logs "$id" 2>&1 | grep -q 'qfj-whatsapp-worker READY'; then break; fi
    sleep 2
  done
  [[ "$running" == "true" ]] || { echo "QFJ_PHASE15_CONSUMER_REFUSED: worker not running" >&2; return 1; }
  docker logs "$id" 2>&1 | grep -q 'qfj-whatsapp-worker READY' || { echo "QFJ_PHASE15_CONSUMER_REFUSED: worker not READY" >&2; return 1; }
  [[ "$(docker inspect "$id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$sha" ]] || {
    echo "QFJ_PHASE15_CONSUMER_REFUSED: worker revision mismatch" >&2
    return 1
  }
}

activate_worker(){
  local manifest="$1" sha
  sha="$(manifest_value "$manifest" sha)"
  REPO_DIR="$REPO_DIR" "$WORKER_ACTIVATE" "$sha"
}

restore_runtime(){
  local slot="$1" manifest="$2"
  local failed=0
  switch_traffic "$slot" "$manifest" || failed=1
  public_smoke || failed=1
  roll_gateway "$manifest" || failed=1
  roll_worker_disabled "$manifest" || failed=1
  activate_worker "$manifest" || failed=1
  return "$failed"
}

write_state(){
  local current_slot="$1" current_manifest="$2" previous_slot="$3" previous_manifest="$4"
  node - "$STATE_FILE.tmp" "$current_slot" "$current_manifest" "$previous_slot" "$previous_manifest" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto');
const [out,currentSlot,currentPath,previousSlot,previousPath]=process.argv.slice(2);
const load=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const hash=(path)=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const current=load(currentPath);
let previous=null;
if(previousSlot && previousPath && fs.existsSync(previousPath)) previous=load(previousPath);
const state={
  protocol:'qf.release.state.v1',
  activeSlot:currentSlot,
  currentReleaseId:current.releaseId,
  currentSourceSha:current.sourceSha,
  currentManifestSha256:hash(currentPath),
  previousSlot:previous?previousSlot:null,
  previousReleaseId:previous?previous.releaseId:null,
  previousSourceSha:previous?previous.sourceSha:null,
  previousManifestSha256:previous?hash(previousPath):null,
};
fs.writeFileSync(out,JSON.stringify(state,null,2)+'\n',{mode:0o600});
NODE
  chmod 0600 "$STATE_FILE.tmp"; mv -f "$STATE_FILE.tmp" "$STATE_FILE"
}

stage(){
  [[ -n "$MANIFEST" ]] || die "stage requires manifest"
  validate_manifest "$MANIFEST"
  local sha slot osref
  sha="$(manifest_value "$MANIFEST" sha)"
  osref="$(manifest_value "$MANIFEST" image:jarvis-os)"
  verify_image "$osref" "$sha"
  slot="$(target_slot "$MANIFEST")"
  os_compose "$slot" "$MANIFEST" up -d jarvis-os
  wait_os "$slot" "$MANIFEST"
  install -o 0 -g 0 -m 0600 "$MANIFEST" "$STAGED_MANIFEST.tmp"
  mv -f "$STAGED_MANIFEST.tmp" "$STAGED_MANIFEST"
  echo "QFJ_PHASE15_STAGED slot=$slot source=$sha"
}

promote(){
  [[ -f "$STAGED_MANIFEST" ]] || die "no staged release"
  validate_manifest "$STAGED_MANIFEST"
  local target active
  target="$(target_slot "$STAGED_MANIFEST")"
  active="$(state_value activeSlot)"
  wait_os "$target" "$STAGED_MANIFEST"
  ensure_coordination
  switch_traffic "$target" "$STAGED_MANIFEST"
  if ! public_smoke; then
    if [[ -n "$active" && -f "$CURRENT_MANIFEST" ]]; then switch_traffic "$active" "$CURRENT_MANIFEST" || true; fi
    die "Jarvis OS public smoke failed"
  fi
  # Stateful/durable consumers deliberately do NOT run blue/green concurrently.
  if ! roll_gateway "$STAGED_MANIFEST" ||
     ! roll_worker_disabled "$STAGED_MANIFEST" ||
     ! activate_worker "$STAGED_MANIFEST"; then
    echo "QFJ_PHASE15_CONSUMER_PROMOTION_FAILED" >&2
    if [[ -n "$active" && -f "$CURRENT_MANIFEST" ]]; then
      restore_runtime "$active" "$CURRENT_MANIFEST" || true
    fi
    die "durable consumer promotion failed; previous runtime restored when available"
  fi

  if [[ -f "$CURRENT_MANIFEST" && -n "$active" ]]; then
    cp -f "$CURRENT_MANIFEST" "$PREVIOUS_MANIFEST.tmp"; chmod 0600 "$PREVIOUS_MANIFEST.tmp"; mv -f "$PREVIOUS_MANIFEST.tmp" "$PREVIOUS_MANIFEST"
  else
    rm -f "$PREVIOUS_MANIFEST"
  fi
  cp -f "$STAGED_MANIFEST" "$CURRENT_MANIFEST.tmp"; chmod 0600 "$CURRENT_MANIFEST.tmp"; mv -f "$CURRENT_MANIFEST.tmp" "$CURRENT_MANIFEST"
  write_state "$target" "$CURRENT_MANIFEST" "$active" "$PREVIOUS_MANIFEST"
  rm -f "$STAGED_MANIFEST"
  echo "QFJ_PHASE15_PROMOTED slot=$target source=$(manifest_value "$CURRENT_MANIFEST" sha)"
}

rollback(){
  [[ -f "$CURRENT_MANIFEST" && -f "$PREVIOUS_MANIFEST" && -f "$STATE_FILE" ]] || die "previous signed release unavailable"
  local active previous
  active="$(state_value activeSlot)"; previous="$(state_value previousSlot)"
  [[ -n "$active" && -n "$previous" && "$active" != "$previous" ]] || die "rollback state invalid"
  validate_manifest "$PREVIOUS_MANIFEST"
  wait_os "$previous" "$PREVIOUS_MANIFEST"
  # Durable consumers are rolled back disabled first; V0/V1 rolling compatibility keeps the boundary valid.
  roll_gateway "$PREVIOUS_MANIFEST"
  roll_worker_disabled "$PREVIOUS_MANIFEST"
  switch_traffic "$previous" "$PREVIOUS_MANIFEST"
  if ! public_smoke; then
    echo "QFJ_PHASE15_ROLLBACK_SMOKE_FAILED" >&2
    restore_runtime "$active" "$CURRENT_MANIFEST" || true
    die "rollback public smoke failed; current runtime restored when available"
  fi
  if ! activate_worker "$PREVIOUS_MANIFEST"; then
    echo "QFJ_PHASE15_ROLLBACK_WORKER_ACTIVATION_FAILED" >&2
    restore_runtime "$active" "$CURRENT_MANIFEST" || true
    die "rollback worker activation failed; current runtime restored when available"
  fi
  mv "$CURRENT_MANIFEST" "$STATE_ROOT/swap.json"
  mv "$PREVIOUS_MANIFEST" "$CURRENT_MANIFEST"
  mv "$STATE_ROOT/swap.json" "$PREVIOUS_MANIFEST"
  write_state "$previous" "$CURRENT_MANIFEST" "$active" "$PREVIOUS_MANIFEST"
  echo "QFJ_PHASE15_ROLLED_BACK slot=$previous source=$(manifest_value "$CURRENT_MANIFEST" sha)"
}

case "$COMMAND" in
  stage) stage ;;
  promote) promote ;;
  rollback) rollback ;;
  reconcile-bootstrap) reconcile_bootstrap ;;
  status) [[ -f "$STATE_FILE" ]] && cat "$STATE_FILE" || echo '{"protocol":"qf.release.state.v1","activeSlot":null}' ;;
  *) die "usage: release.sh <stage manifest|promote|rollback|reconcile-bootstrap|status>" ;;
esac
