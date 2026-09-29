#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/srv/qf-jarvis/repo}"
CONFIG='/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json'
OPENAI='/srv/qf-jarvis/secrets/openai-production.key'
SEALS='/srv/qf-jarvis/seals'
FINAL_SEAL="$SEALS/openai-v1-production-seal.json"
OWNER_REF="${QFJ_OPENAI_OWNER_REF:-owner.quickfurno}"
EVIDENCE_ROOT='/srv/qf-jarvis/evidence'
EVIDENCE_DIR="$EVIDENCE_ROOT/openai-launch-$SHA"

die() { echo "FATAL: $1" >&2; exit 1; }
[[ -n "$SHA" ]] || die "usage: launch-openai.sh <exact-merged-git-sha>"
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"

[[ -f "$OPENAI" && ! -L "$OPENAI" ]] || die "OpenAI credential is not installed."
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die "worker config is missing."
[[ "$(stat -c '%a' "$OPENAI")" == "400" || "$(stat -c '%a' "$OPENAI")" == "600" ]] ||
  die "OpenAI credential permissions must be 400 or 600."
[[ "$(stat -c '%u:%g' "$OPENAI")" == "10003:10002" ]] ||
  die "OpenAI credential owner must be 10003:10002."

"$HERE/disable.sh"
BUILD_CTX="$(mktemp -d)"
CONFIG_OUT="$(mktemp -d)"
trap 'rm -rf "$BUILD_CTX" "$CONFIG_OUT"' EXIT

git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" |
  tar -x -C "$BUILD_CTX"

echo "==> building exact OpenAI-capable worker image $SHA"
docker build   --file "$BUILD_CTX/deploy/quickfurno-worker/Dockerfile"   --build-arg "GIT_SHA=$SHA"   --tag "qf-jarvis-whatsapp-worker:$SHA"   "$BUILD_CTX"

image_revision="$(docker image inspect "qf-jarvis-whatsapp-worker:$SHA" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[[ "$image_revision" == "$SHA" ]] || die "built image revision mismatch."

install -d -o 10003 -g 10002 -m 0700 "$EVIDENCE_ROOT"
rm -rf -- "$EVIDENCE_DIR"
install -d -o 10003 -g 10002 -m 0700 "$EVIDENCE_DIR"

smoke_args=(
  --approve-production
  --credential-file /run/secrets/openai-production.key
  --output-dir /out
  --head-sha "$SHA"
  --owner-ref "$OWNER_REF"
)
if [[ -n "${QFJ_OPENAI_KNOWLEDGE_REVISION:-}" ]]; then
  smoke_args+=(--knowledge-revision "$QFJ_OPENAI_KNOWLEDGE_REVISION")
fi
echo "==> running six-call OpenAI production smoke (Luna/Sol x Riya/Anisha/Aarohi)"
docker run --rm   --user 10003:10002   --read-only   --cap-drop ALL   --security-opt no-new-privileges:true   --memory 1024m   --cpus 1.0   --mount "type=bind,source=$OPENAI,target=/run/secrets/openai-production.key,readonly"   --mount "type=bind,source=$EVIDENCE_DIR,target=/out"   "qf-jarvis-whatsapp-worker:$SHA"   node apps/api/dist/bin/run-openai-launch-smoke.js "${smoke_args[@]}"

[[ -f "$EVIDENCE_DIR/openai-v1-production-seal.json" ]] ||
  die "OpenAI production seal was not produced."
install -d -o 10003 -g 10002 -m 0700 "$SEALS"
install -o 10003 -g 10002 -m 0400   "$EVIDENCE_DIR/openai-v1-production-seal.json"   "$FINAL_SEAL"

chown 10003:10002 "$CONFIG_OUT"
chmod 0700 "$CONFIG_OUT"
echo "==> converting current worker configuration to OpenAI without changing QuickFurno settings"
docker run --rm   --user 10003:10002   --read-only   --cap-drop ALL   --security-opt no-new-privileges:true   --mount "type=bind,source=$CONFIG,target=/input/worker.json,readonly"   --mount "type=bind,source=$CONFIG_OUT,target=/out"   "qf-jarvis-whatsapp-worker:$SHA"   node -e '
const fs=require("node:fs");
const input=process.argv[1];
const output=process.argv[2];
const revision=process.argv[3];
const config=JSON.parse(fs.readFileSync(input,"utf8"));
config.revision=revision;
delete config.sealFile;
delete config.groqCredentialReference;
delete config.groqCredentialFile;
config.openai={
  sealFile:"/run/secrets/openai-v1-production-seal.json",
  credentialReference:"openai.qfj.production.v1",
  credentialFile:"/run/secrets/openai-production.key"
};
fs.writeFileSync(output,JSON.stringify(config,null,2)+"\n",{flag:"wx",mode:0o600});
' /input/worker.json /out/worker.json "$SHA"

[[ -f "$CONFIG_OUT/worker.json" ]] || die "OpenAI worker config was not produced."
install -o 10003 -g 10002 -m 0400 "$CONFIG_OUT/worker.json" "$CONFIG"

echo "==> deploying OpenAI worker disabled and verifying deployment"
QFJ_WORKER_PROVIDER_MODE=OPENAI_LUNA_SOL QFJ_WORKER_SKIP_BUILD=1 "$HERE/deploy.sh" "$SHA"

ready_line="$(docker logs qf-jarvis-whatsapp-worker 2>&1 | grep 'qfj-whatsapp-worker READY' | tail -n 1 || true)"
[[ "$ready_line" == *"providerMode=OPENAI_LUNA_SOL"* ]] ||
  die "worker READY line does not report OPENAI_LUNA_SOL."
[[ "$ready_line" == *"approvals=6"* ]] ||
  die "worker READY line does not report six verified OpenAI approvals."

echo "==> activating OpenAI worker for real traffic"
"$HERE/activate.sh" "$SHA"

sleep 2
running="$(docker inspect qf-jarvis-whatsapp-worker --format '{{.State.Running}}' 2>/dev/null || echo false)"
[[ "$running" == "true" ]] || die "worker stopped after activation."

echo "OPENAI_LAUNCH=ACTIVE"
echo "OPENAI_ROUTING=SIMPLE:LUNA,STANDARD:LUNA,COMPLEX:SOL"
echo "OPENAI_CAPACITY=200_CONVERSATIONS,50_MODEL_ACTIVE,150_MODEL_QUEUE"
echo "ROLLBACK_COMMAND=$HERE/disable.sh"
