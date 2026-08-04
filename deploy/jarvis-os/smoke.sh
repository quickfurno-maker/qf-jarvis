#!/usr/bin/env bash
# Jarvis OS external smoke test (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   smoke.sh pre-hsts <host>   # after ingress activation, before HSTS
#   smoke.sh final    <host>   # after HSTS activation -- the release gate
#
# Checks what the container's own healthcheck honestly cannot: DNS, trusted TLS, the edge, and the
# authentication boundary as an outside caller experiences it. It performs no login -- credentials
# must never enter a script or a shell history.
#
# ### Modes exist so that "HSTS absent" can be correct once and fatal later
#
# Before activation HSTS must be absent, and afterwards it must be present. A single mode could
# only ever treat one of those as a warning, and a warning at the final gate is how a missing
# security header ships.
set -Eeuo pipefail

MODE="${1:-}"
HOST="${2:-}"
case "$MODE" in
  pre-hsts | final) ;;
  *)
    echo "usage: smoke.sh <pre-hsts|final> <host>" >&2
    exit 2
    ;;
esac
[[ -n "$HOST" ]] || {
  echo "usage: smoke.sh <pre-hsts|final> <host>" >&2
  exit 2
}

fail=0
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then printf '  ok    %-46s %s\n' "$1" "$3"; else
    printf '  FAIL  %-46s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}
bad() {
  printf '  FAIL  %s\n' "$1"
  fail=1
}
good() { printf '  ok    %s\n' "$1"; }

echo "== $HOST (mode: $MODE) =="

# --- TLS must be TRUSTED, not merely present ---------------------------------------------------
# curl without -k fails on an untrusted chain, so a self-signed or half-issued certificate is a
# hard failure here rather than something the later checks quietly tunnel through.
check "trusted TLS handshake" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/login" || echo ERR)"

# --- HTTP to HTTPS -----------------------------------------------------------------------------
# Exactly 301, and the Location must be the HTTPS form of this host.
#
# 301 is not a guess and not Traefik's default: it is what the shared `web` entrypoint was MEASURED
# returning for an existing hostname on this host during the JOS-01D audit. Traefik's entrypoint
# redirection returns 302 unless `permanent` is set, and the `redirectScheme` middleware returns
# 302/308 -- so pinning the observed value is what makes this check able to notice that shared
# ingress behaviour changed underneath us. "Any 3xx" would accept a redirect to anywhere.
check "http -> https status" "301" \
  "$(curl -s -o /dev/null -w '%{http_code}' "http://${HOST}/login" || echo ERR)"
LOC="$(curl -sI "http://${HOST}/login" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
case "$LOC" in
  "https://${HOST}/login") good "http -> https location                        $LOC" ;;
  *) bad "http -> https location: expected https://${HOST}/login, got '${LOC:-<none>}'" ;;
esac

# --- authentication boundary -------------------------------------------------------------------
check "https / (unauth)" "307" "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/" || echo ERR)"
check "snapshot (unauth)" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' "https://${HOST}/api/control-plane/v1/snapshot" || echo ERR)"

# An invalid cookie must reach the login form, not a redirect loop (JOS-01C correction).
check "invalid cookie -> /login (no loop)" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -L --max-redirs 5 \
    -H 'Cookie: __Host-qfj-jos-session=garbage' "https://${HOST}/login" || echo ERR)"

# --- headers -----------------------------------------------------------------------------------
echo "-- headers --"
H="$(curl -sI "https://${HOST}/login" | tr -d '\r')"
count_header() { # name -> count on stdout, never trips set -e
  printf '%s\n' "$H" | grep -ci "^$1:" || true
}

# EXACTLY one CSP header. Not "at least one".
#
# The application emits a per-request nonce policy. If the edge ever adds its own, browsers
# intersect the two into the strictest combination and every nonced script stops running -- while a
# naive "is a CSP present?" check still passes. That failure is silent in production and obvious
# here, so it is fatal.
CSP_COUNT="$(count_header 'content-security-policy')"
check "content-security-policy header count" "1" "$CSP_COUNT"
if printf '%s\n' "$H" | grep -qi '^content-security-policy:.*nonce-'; then
  good "CSP carries a per-request nonce"
else
  bad "CSP is missing its per-request nonce (edge override?)"
fi

STS_COUNT="$(count_header 'strict-transport-security')"
if [[ "$MODE" == "pre-hsts" ]]; then
  # Absent is CORRECT here, and present is a real failure: it means HSTS was attached before TLS
  # was proven, which is the one HSTS mistake that cannot be undone by fixing the server.
  check "HSTS absent before activation" "0" "$STS_COUNT"
else
  check "HSTS header count" "1" "$STS_COUNT"
  STS="$(printf '%s\n' "$H" | grep -i '^strict-transport-security:' | head -1)"
  case "$STS" in
    *max-age=31536000*) good "HSTS max-age=31536000" ;;
    *) bad "HSTS max-age is not 31536000: '$STS'" ;;
  esac
  # Both were reviewed as deliberately OFF: includeSubDomains would impose HTTPS-only on sibling
  # hostnames this project does not own, and preload is effectively irreversible.
  case "$STS" in
    *includeSubDomains*) bad "HSTS includeSubDomains must be absent: '$STS'" ;;
    *) good "HSTS includeSubDomains absent" ;;
  esac
  case "$STS" in
    *preload*) bad "HSTS preload must be absent: '$STS'" ;;
    *) good "HSTS preload absent" ;;
  esac
fi

check "x-frame-options" "1" "$(count_header 'x-frame-options')"
printf '%s\n' "$H" | grep -qi '^x-frame-options: *DENY' && good "X-Frame-Options DENY" || bad "X-Frame-Options is not DENY"
printf '%s\n' "$H" | grep -qi '^referrer-policy: *no-referrer' && good "Referrer-Policy no-referrer" || bad "Referrer-Policy"
printf '%s\n' "$H" | grep -qi '^x-content-type-options: *nosniff' && good "X-Content-Type-Options nosniff" || bad "X-Content-Type-Options"

# --- leakage ------------------------------------------------------------------------------------
# The unauthenticated surface must not disclose internal paths, server software or the secret's
# location. A generic fail-closed body is the JOS-01B/01C contract.
echo "-- leakage --"
BODY="$(curl -s "https://${HOST}/api/control-plane/v1/snapshot" || true)"
for needle in 'qf-jarvis-os-auth' '/run/secrets' '/srv/qf-jarvis' 'argon2' 'totp'; do
  if printf '%s' "$BODY$H" | grep -qi -- "$needle"; then bad "response discloses '$needle'"; else good "no '$needle' in unauth response"; fi
done

# --- no direct application port ------------------------------------------------------------------
echo "-- no direct application port exposed --"
for p in 3000 3001 3100 5678; do
  if timeout 4 bash -c "</dev/tcp/${HOST}/${p}" 2>/dev/null; then
    bad "port ${p} is reachable"
  else good "port ${p} closed"; fi
done

echo
if [[ "$fail" -ne 0 ]]; then
  echo "SMOKE FAILED ($MODE)." >&2
else
  echo "smoke passed ($MODE)."
fi
exit $fail
