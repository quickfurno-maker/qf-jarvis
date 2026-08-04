#!/usr/bin/env bash
# Jarvis OS external smoke test (JOS-01D, ADR-0088). GATE 2 ONLY.
#
# Checks what the container's own healthcheck honestly cannot: DNS, TLS, the edge, and the
# authentication boundary as an outside caller experiences it. It performs no login -- credentials
# must never enter a script or shell history.
set -Eeuo pipefail

HOST="${1:-jarvis.quickfurno.in}"
fail=0
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then printf '  ok    %-44s %s\n' "$1" "$3"
  else printf '  FAIL  %-44s expected %s, got %s\n' "$1" "$2" "$3"; fail=1; fi
}

echo "== $HOST =="
check "http -> https redirect"  "308" "$(curl -s -o /dev/null -w '%{http_code}' "http://${HOST}/login" || echo ERR)"
check "https /login"            "200" "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/login" || echo ERR)"
check "https / (unauth)"        "307" "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/" || echo ERR)"
check "snapshot (unauth)"       "401" "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/api/control-plane/v1/snapshot" || echo ERR)"

# An invalid cookie must reach the login form, not a redirect loop (JOS-01C correction).
code=$(curl -s -o /dev/null -w '%{http_code}' -L --max-redirs 5 -H 'Cookie: __Host-qfj-jos-session=garbage' "https://${HOST}/login" || echo ERR)
check "invalid cookie -> /login (no loop)" "200" "$code"

echo "-- headers --"
H=$(curl -sI "https://${HOST}/login")
grep -qi '^strict-transport-security'    <<<"$H" && echo "  ok    HSTS present"            || echo "  note  HSTS absent (expected until Gate 2 enables it)"
grep -qi "^content-security-policy:.*nonce-" <<<"$H" && echo "  ok    per-request nonce CSP intact" || { echo "  FAIL  nonce CSP missing or overridden"; fail=1; }
grep -qic '^content-security-policy' <<<"$H" | grep -q '^1$' || true
grep -qi '^x-frame-options: DENY'        <<<"$H" && echo "  ok    X-Frame-Options DENY"    || { echo "  FAIL  X-Frame-Options"; fail=1; }
grep -qi '^referrer-policy: no-referrer' <<<"$H" && echo "  ok    Referrer-Policy"         || { echo "  FAIL  Referrer-Policy"; fail=1; }

echo "-- no direct application port exposed --"
for p in 3000 3001 3100 5678; do
  if timeout 4 bash -c "</dev/tcp/${HOST}/${p}" 2>/dev/null; then echo "  FAIL  port ${p} is reachable"; fail=1
  else echo "  ok    port ${p} closed"; fi
done

exit $fail
