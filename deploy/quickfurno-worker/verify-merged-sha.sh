#!/usr/bin/env bash
# Refuse any QuickFurno worker deployment that is not an exact commit contained in origin/main.
set -Eeuo pipefail

SHA="${1:-}"
REPO_DIR="${2:-${REPO_DIR:-/srv/qf-jarvis/repo}}"

die() { echo "FATAL: $1" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die "usage: verify-merged-sha.sh <full-merged-sha> [repo-dir]"
[[ -d "$REPO_DIR/.git" || -f "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git repository."

git -C "$REPO_DIR" fetch --prune origin >/dev/null 2>&1 ||
  die "could not refresh origin/main; refusing a stale containment decision."
git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null ||
  die "commit $SHA does not exist."
git -C "$REPO_DIR" rev-parse --verify --quiet 'origin/main^{commit}' >/dev/null ||
  die "origin/main does not exist."
git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" 'origin/main^{commit}' 2>/dev/null ||
  die "$SHA is not contained in origin/main."

echo "ok: $SHA is contained in origin/main"
