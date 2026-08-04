#!/usr/bin/env bash
# Jarvis OS EXTERNAL smoke runner (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   external-smoke.sh <extract|pre-hsts|final> <host> <sha> [repo-dir]
#
# Runs on the OPERATOR'S OWN MACHINE, not on the VPS. It materialises `smoke.sh` from one exact
# merged commit into a temporary directory outside the repository, proves its bytes against the Git
# object, and runs that copy.
#
# ### Why the external smoke cannot run from the VPS release directory
#
# `/srv/qf-jarvis/releases/<sha>/jarvis-os` exists on the host, not on the operator's workstation.
# Documenting `"$RELEASE/smoke.sh"` outside an `ssh` was simply a path that does not exist locally.
#
# Running it over `ssh` instead is not an equivalent fix, and that is the real point: the smoke test
# checks public DNS resolution, a trusted TLS chain, edge headers, and that no application port is
# reachable. From inside the VPS, DNS may resolve differently, TLS terminates locally, and the
# "no direct port" check would be testing loopback rather than the internet. A check that only
# passes when run from the machine being checked is not an external check.
#
# ### Why not just run the smoke.sh in the working tree
#
# Because it would be whatever is checked out — a different branch, uncommitted edits, or a
# different commit than the one deployed. The image, the deployment configuration and the external
# verification must all derive from the same merged SHA, or "verified" refers to three things.
#
#   extract   materialise and verify only; print the path. Use it to read the script before running.
#   pre-hsts  run the verified copy in pre-HSTS mode.
#   final     run the verified copy in final mode.
set -Eeuo pipefail

MODE="${1:-}"
HOST="${2:-}"
SHA="${3:-}"
REPO_DIR="${4:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

REL_PATH='deploy/jarvis-os/smoke.sh'

die() {
  echo "FATAL: $1" >&2
  exit 1
}

case "$MODE" in
  extract | pre-hsts | final) ;;
  *) die "usage: external-smoke.sh <extract|pre-hsts|final> <host> <sha> [repo-dir]" ;;
esac
[[ -n "$HOST" && -n "$SHA" ]] ||
  die "usage: external-smoke.sh <extract|pre-hsts|final> <host> <sha> [repo-dir]"

[[ "$SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die "'$SHA' is not a full 40-character hex commit SHA."
[[ -d "$REPO_DIR/.git" || -f "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git repository."

# Same containment rule as the host side: the script that decides whether a deployment passed must
# come from reviewed code, not from a branch that happens to be checked out.
git -C "$REPO_DIR" fetch --prune origin >/dev/null 2>&1 ||
  die "could not fetch origin. Refusing to decide containment from a stale ref."
git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null ||
  die "commit $SHA does not exist in $REPO_DIR."
git -C "$REPO_DIR" rev-parse --verify --quiet 'origin/main^{commit}' >/dev/null ||
  die "origin/main does not exist in $REPO_DIR."
git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" 'origin/main^{commit}' 2>/dev/null ||
  die "commit $SHA is NOT contained in origin/main."

# Outside the repository, so nothing here can be mistaken for a working-tree file or picked up by a
# later `git status`.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/qf-jos-smoke-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# ONE file, from that commit. Line-ending conversion is pinned off for the same reason as the
# release package: otherwise the extracted bytes depend on the operator's Git configuration and the
# comparison below is checking a moving target.
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" -- "$REL_PATH" |
  tar -x -C "$TMP" ||
  die "could not extract $REL_PATH from $SHA."

SMOKE="$TMP/$REL_PATH"
[[ -f "$SMOKE" ]] || die "$REL_PATH is not present in $SHA."
[[ ! -L "$SMOKE" ]] || die "extracted $REL_PATH is a symlink."

# Bytes, against the Git object itself. The archive and the blob are two different code paths out
# of Git; agreeing is what makes this a verification rather than a restatement.
git -C "$REPO_DIR" cat-file blob "${SHA}:${REL_PATH}" | cmp -s - "$SMOKE" ||
  die "extracted $REL_PATH does not match its Git blob at $SHA."

if [[ "$MODE" == "extract" ]]; then
  # Keep it: the operator asked for a copy to inspect.
  trap - EXIT
  KEEP="$TMP/$REL_PATH"
  echo "verified $REL_PATH from $SHA"
  echo "$KEEP"
  exit 0
fi

echo "==> running $REL_PATH from $SHA (verified) against $HOST, mode $MODE"
bash "$SMOKE" "$MODE" "$HOST"
