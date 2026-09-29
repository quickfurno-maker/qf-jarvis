#!/usr/bin/env bash
set -Eeuo pipefail

TARGET='/srv/qf-jarvis/secrets/openai-production.key'
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

[[ -t 0 ]] || { echo 'FATAL: interactive terminal required.' >&2; exit 1; }
printf 'Paste OpenAI project/service-account API key (input hidden): ' >&2
IFS= read -r -s KEY
printf '\n' >&2

[[ -n "$KEY" ]] || { echo 'FATAL: empty key.' >&2; exit 1; }
[[ "$KEY" != *$'\n'* && "$KEY" != *$'\r'* ]] || {
  echo 'FATAL: key contains a newline.' >&2
  exit 1
}

umask 077
printf '%s' "$KEY" > "$TMP"
unset KEY
install -o 10003 -g 10002 -m 0400 "$TMP" "$TARGET"

mode="$(stat -c '%a' "$TARGET")"
owner="$(stat -c '%u:%g' "$TARGET")"
[[ "$mode" == '400' && "$owner" == '10003:10002' ]] || {
  echo 'FATAL: credential permissions are invalid.' >&2
  exit 1
}

echo 'OPENAI_CREDENTIAL_INSTALLED=PASS'
