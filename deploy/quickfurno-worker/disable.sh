#!/usr/bin/env bash
# Emergency/local operator disable. Creating this file blocks new spool claims and model invocations.
set -Eeuo pipefail

CONTROL_DIR='/srv/qf-jarvis/state/quickfurno-worker-control'
DISABLE_FILE="$CONTROL_DIR/DISABLE_MODEL"

install -d -m 0755 "$CONTROL_DIR"
: > "$DISABLE_FILE"
chmod 0444 "$DISABLE_FILE"
echo "disabled: $DISABLE_FILE is present"
