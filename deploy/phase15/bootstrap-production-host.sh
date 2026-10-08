#!/usr/bin/env bash
# One-time, fail-closed Jarvis Phase-15 host bootstrap.
#
# Adds a Traefik file-provider seam and installs the immutable release-control
# closure. It does NOT switch Jarvis traffic or promote an image.
set -Eeuo pipefail
umask 077

EXPECTED_SOURCE_SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$HERE/../.." && pwd)"
CONTROL_ROOT="/srv/qf-jarvis/release-control"
TRAEFIK_ROOT="/docker/traefik"
TRAEFIK_COMPOSE="$TRAEFIK_ROOT/docker-compose.yml"
TRAEFIK_DYNAMIC="$TRAEFIK_ROOT/dynamic"
TRAEFIK_CONTAINER="traefik-traefik-1"
BACKUP_ROOT="/var/lib/qf-jarvis-phase15-bootstrap"

die(){ echo "QFJ_PHASE15_BOOTSTRAP_REFUSED: $1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "must run as root on the approved Jarvis host"
[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "usage: bootstrap-production-host.sh <source-sha>"
command -v docker >/dev/null 2>&1 || die "Docker missing"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 missing"
command -v git >/dev/null 2>&1 || die "git missing"
[[ -d "$SOURCE_ROOT/.git" ]] || die "bootstrap must run from the trusted Jarvis Git checkout"
[[ "$(git -C "$SOURCE_ROOT" rev-parse HEAD)" == "$EXPECTED_SOURCE_SHA" ]] ||
  die "source checkout is not the requested SHA"
git -C "$SOURCE_ROOT" cat-file -e "$EXPECTED_SOURCE_SHA^{commit}" 2>/dev/null ||
  die "requested source commit missing"
git -C "$SOURCE_ROOT" merge-base --is-ancestor "$EXPECTED_SOURCE_SHA" origin/main ||
  die "requested source is not contained in origin/main"

[[ -f "$TRAEFIK_COMPOSE" && ! -L "$TRAEFIK_COMPOSE" ]] || die "shared Traefik compose missing"
docker inspect "$TRAEFIK_CONTAINER" >/dev/null 2>&1 || die "shared Traefik container missing"
[[ -d /srv/qf-jarvis/repo/.git ]] || die "worker activation Git checkout missing"

for port in 3201 3202; do
  if ss -lnt | awk '{print $4}' | grep -Eq "[:.]$port$"; then
    die "Jarvis Phase-15 loopback slot port already occupied: $port"
  fi
done

[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://jarvis.quickfurno.in/login)" == "200" ]] ||
  die "current Jarvis public login smoke failed"

install -d -o 0 -g 0 -m 0700 "$BACKUP_ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/$STAMP"
install -d -o 0 -g 0 -m 0700 "$BACKUP"
install -o 0 -g 0 -m 0600 "$TRAEFIK_COMPOSE" "$BACKUP/traefik-compose.yml"

# Install a minimal root-owned release closure. Secret files are not copied.
rm -rf "$CONTROL_ROOT.new"
install -d -o 0 -g 0 -m 0755 "$CONTROL_ROOT.new"
tar -C "$SOURCE_ROOT" -cf -   deploy/phase15   deploy/jarvis-os   deploy/quickfurno-gateway   deploy/quickfurno-worker   scripts/scale/phase15-release.mjs   contracts/qf-release-phase15-v1.schema.json |
  (cd "$CONTROL_ROOT.new" && umask 022 && tar --no-same-owner --no-same-permissions -xf -)
chown -R 0:0 "$CONTROL_ROOT.new"
find "$CONTROL_ROOT.new" -type d -exec chmod go-w {} +
find "$CONTROL_ROOT.new" -type f -exec chmod go-w {} +
chmod 0755 "$CONTROL_ROOT.new/deploy/phase15/release.sh"
chmod 0755 "$CONTROL_ROOT.new/deploy/phase15/qfj-phase15-release.wrapper"
chmod 0755 "$CONTROL_ROOT.new/deploy/phase15/qfj-phase15-switch"
chmod 0755 "$CONTROL_ROOT.new/deploy/quickfurno-worker/disable.sh"
chmod 0755 "$CONTROL_ROOT.new/deploy/quickfurno-worker/activate.sh"
chmod 0755 "$CONTROL_ROOT.new/deploy/quickfurno-worker/verify-merged-sha.sh"
printf '%s\n' "$EXPECTED_SOURCE_SHA" > "$CONTROL_ROOT.new/SOURCE_SHA"
chown 0:0 "$CONTROL_ROOT.new/SOURCE_SHA"
chmod 0444 "$CONTROL_ROOT.new/SOURCE_SHA"

if [[ -d "$CONTROL_ROOT" ]]; then
  mv "$CONTROL_ROOT" "$BACKUP/release-control"
fi
mv "$CONTROL_ROOT.new" "$CONTROL_ROOT"

install -o 0 -g 0 -m 0755 "$CONTROL_ROOT/deploy/phase15/qfj-phase15-release.wrapper" /usr/local/sbin/qfj-phase15-release
install -o 0 -g 0 -m 0755 "$CONTROL_ROOT/deploy/phase15/qfj-phase15-switch" /usr/local/sbin/qfj-phase15-switch

id qfjdeploy >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/qf-jarvis/runner --shell /bin/bash qfjdeploy
TMP_SUDO="$(mktemp /tmp/qfj-phase15-sudoers.XXXXXX)"
cat >"$TMP_SUDO" <<'SUDO'
qfjdeploy ALL=(root) NOPASSWD: /usr/local/sbin/qfj-phase15-release stage *, /usr/local/sbin/qfj-phase15-release promote, /usr/local/sbin/qfj-phase15-release rollback, /usr/local/sbin/qfj-phase15-release status
SUDO
chmod 0440 "$TMP_SUDO"
visudo -cf "$TMP_SUDO" >/dev/null
install -o 0 -g 0 -m 0440 "$TMP_SUDO" /etc/sudoers.d/qfj-phase15-deployer
rm -f "$TMP_SUDO"

install -d -o 0 -g 0 -m 0755 "$TRAEFIK_DYNAMIC"
BEFORE_IMAGE="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{.Image}}')"

python3 - "$TRAEFIK_COMPOSE" <<'PY'
import sys
path=sys.argv[1]
with open(path,encoding="utf-8") as fh:
    text=fh.read()
provider_a="      - --providers.file.directory=/dynamic\n"
provider_b="      - --providers.file.watch=true\n"
mount="      - /docker/traefik/dynamic:/dynamic:ro\n"
have_provider=provider_a in text and provider_b in text
have_mount=mount in text
if (provider_a in text) != (provider_b in text):
    raise SystemExit("partial Traefik file-provider configuration")
if not have_provider:
    anchor="      - --providers.docker.exposedbydefault=false\n"
    if text.count(anchor)!=1:
        raise SystemExit("unexpected Traefik provider topology")
    text=text.replace(anchor,anchor+provider_a+provider_b,1)
if not have_mount:
    anchor="      - /var/run/docker.sock:/var/run/docker.sock:ro\n"
    if text.count(anchor)!=1:
        raise SystemExit("unexpected Traefik volume topology")
    text=text.replace(anchor,anchor+mount,1)
with open(path,"w",encoding="utf-8") as fh:
    fh.write(text)
PY
chown 0:0 "$TRAEFIK_COMPOSE"
chmod 0644 "$TRAEFIK_COMPOSE"

rollback_traefik(){
  echo "QFJ_PHASE15_BOOTSTRAP_ROLLBACK: restoring Traefik compose" >&2
  install -o 0 -g 0 -m 0644 "$BACKUP/traefik-compose.yml" "$TRAEFIK_COMPOSE"
  (cd "$TRAEFIK_ROOT" && docker compose up -d --no-deps traefik >/dev/null 2>&1) || true
}

if ! (cd "$TRAEFIK_ROOT" && docker compose config --quiet); then
  rollback_traefik
  die "Traefik compose validation failed"
fi
if ! (cd "$TRAEFIK_ROOT" && docker compose up -d --no-deps traefik); then
  rollback_traefik
  die "Traefik file-provider activation failed"
fi

AFTER_IMAGE="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{.Image}}')"
if [[ "$AFTER_IMAGE" != "$BEFORE_IMAGE" ]]; then
  rollback_traefik
  die "Traefik image changed during bootstrap"
fi

CMD_JSON="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{json .Config.Cmd}}')"
[[ "$CMD_JSON" == *"--providers.file.directory=/dynamic"* ]] || { rollback_traefik; die "file provider absent"; }
[[ "$CMD_JSON" == *"--providers.file.watch=true"* ]] || { rollback_traefik; die "file watch absent"; }
docker inspect "$TRAEFIK_CONTAINER" --format '{{range .Mounts}}{{println .Destination}}{{end}}' |
  grep -Fx '/dynamic' >/dev/null || { rollback_traefik; die "dynamic mount absent"; }

OK=0
for _ in $(seq 1 30); do
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://jarvis.quickfurno.in/login || true)" == "200" ]]; then
    OK=1
    break
  fi
  sleep 2
done
if [[ "$OK" != "1" ]]; then
  rollback_traefik
  die "Jarvis public route failed after file-provider bootstrap"
fi

/usr/local/sbin/qfj-phase15-release status >/dev/null

echo "QFJ_PHASE15_BOOTSTRAP_READY source=$EXPECTED_SOURCE_SHA backup=$BACKUP"
echo "TRAFFIC_UNCHANGED router=legacy-docker-provider"
echo "NEXT: register qfj-phase15-deployer, then run the already verified exact-digest promotion."
