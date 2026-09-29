#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export QFJ_WORKER_PROVIDER_MODE=OPENAI_LUNA_SOL
exec "$HERE/deploy.sh" "$@"
