#!/usr/bin/env bash
# Jarvis OS release-artifact integrity check (JOS-01D, ADR-0088).
#
#   verify-release-artifacts.sh <sha> <release-dir> [repo-dir] [releases-root]
#
# Proves that a release directory IS the deployment configuration from one exact commit, byte for
# byte, before anything touches Docker. Exits 0 only if every check passes.
#
# ### What this exists to stop
#
# The image was already bound to a commit: it is built from `git archive <sha>` and its OCI
# revision label is checked. The CONFIGURATION was not. Compose files, Traefik labels, HSTS values
# and the scripts themselves were read from whatever directory the script happened to live in.
#
# So this was possible, with every existing check passing and reporting success:
#
#   * the requested SHA is genuinely contained in origin/main;
#   * the image is genuinely built from it;
#   * the running container genuinely reports that revision;
#   * and `compose.production.yml` beside the script is stale, hand-edited, or from another commit.
#
# The deployment would be truthfully labelled with a commit whose hardening, rate limits and HSTS
# it was not actually running. A release identity has to cover both halves or it covers neither.
#
# ### Why bytes, not a REVISION file
#
# A marker file recording "this is <sha>" is written by the same process that could have written
# the wrong files. It proves intent, not content. Every file here is compared against the actual
# Git blob at that commit, so the only way to pass is to BE that commit's configuration.
#
# ### Upstream containment is deliberately NOT checked here
#
# That is `verify-merged-sha.sh`, called separately by deploy.sh and activate.sh. Keeping them
# apart is what lets `rollback.sh` verify artefact integrity during an emergency without fetching
# a remote that may be unreachable, or being blocked because main is currently broken.
set -Eeuo pipefail

SHA="${1:-}"
RELEASE_DIR="${2:-}"
REPO_DIR="${3:-${REPO_DIR:-/srv/qf-jarvis/repo}}"
# The approved root is a defaulted ARGUMENT rather than an environment variable: an env var is
# invisible in the command an operator types and in the shell history afterwards. The deployment
# scripts never pass this, so production always gets the default.
RELEASES_ROOT="${4:-/srv/qf-jarvis/releases}"

SUBDIR='deploy/jarvis-os'

die() {
  echo "FATAL: $1" >&2
  exit 1
}

[[ -n "$SHA" && -n "$RELEASE_DIR" ]] ||
  die "usage: verify-release-artifacts.sh <sha> <release-dir> [repo-dir] [releases-root]"

[[ "$SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die "'$SHA' is not a full 40-character hex commit SHA."
[[ -d "$REPO_DIR/.git" || -f "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git repository."
git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null ||
  die "commit $SHA does not exist in $REPO_DIR."

# --- the package must be a real directory, not a symlink pointed somewhere else ------------------
[[ ! -L "$RELEASE_DIR" ]] || die "$RELEASE_DIR is a symlink. A release package must be a real directory."
[[ -d "$RELEASE_DIR" ]] || die "$RELEASE_DIR does not exist."

# --- it must live at the approved immutable location ---------------------------------------------
# This is what forbids deploying from a mutable shared copy such as /srv/qf-jarvis/deploy: that
# path can be edited between releases and belongs to no commit.
EXPECTED_ROOT="${RELEASES_ROOT}/${SHA}/jarvis-os"
ACTUAL="$(cd "$RELEASE_DIR" && pwd -P)"
EXPECTED="$(cd "$(dirname "$EXPECTED_ROOT")" 2>/dev/null && pwd -P)/$(basename "$EXPECTED_ROOT")" ||
  EXPECTED="$EXPECTED_ROOT"
[[ "$ACTUAL" == "$EXPECTED" ]] ||
  die "release directory is '$ACTUAL'; expected '$EXPECTED'. Refusing to deploy from an unapproved path."

# --- the file set must equal the commit's file set, in both directions ---------------------------
# Derived from the commit rather than hardcoded, so a deployment file added in a future phase is
# covered automatically instead of being silently unchecked.
EXPECTED_FILES="$(git -C "$REPO_DIR" ls-tree -r --name-only "$SHA" -- "$SUBDIR" | sed "s|^${SUBDIR}/||" | sort)"
[[ -n "$EXPECTED_FILES" ]] || die "commit $SHA contains no files under $SUBDIR."

ACTUAL_FILES="$(cd "$RELEASE_DIR" && find . -mindepth 1 \( -type f -o -type l \) -printf '%P\n' | sort)"

if [[ "$EXPECTED_FILES" != "$ACTUAL_FILES" ]]; then
  echo "FATAL: release file set does not match commit $SHA." >&2
  # An EXTRA file matters as much as a missing one: a stray compose fragment or a shadowing script
  # in this directory can change what Compose merges or what the scripts source.
  diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES") >&2 || true
  exit 1
fi

# --- every file: not a symlink, exact bytes, exact executable bit, not group/world writable ------
while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  path="$RELEASE_DIR/$name"

  [[ ! -L "$path" ]] || die "$name is a symlink. Release artefacts must be ordinary files."
  [[ -f "$path" ]] || die "$name is not an ordinary file."

  # Bytes, compared against the Git object itself.
  git -C "$REPO_DIR" cat-file blob "${SHA}:${SUBDIR}/${name}" | cmp -s - "$path" ||
    die "$name does not match its Git blob at $SHA. The release package is stale or edited."

  # Executable bit, as recorded in the tree (100755 vs 100644).
  git_mode="$(git -C "$REPO_DIR" ls-tree "$SHA" -- "${SUBDIR}/${name}" | awk '{print $1}')"
  if [[ "$git_mode" == "100755" ]]; then
    [[ -x "$path" ]] || die "$name is executable in Git but not on disk."
  else
    [[ ! -x "$path" ]] || die "$name is NOT executable in Git but is on disk."
  fi

  # Group- or world-writable artefacts let anyone in the group rewrite the deployment between the
  # verification and the deployment that trusts it.
  mode="$(stat -c '%a' "$path" 2>/dev/null || echo '')"
  if [[ -n "$mode" ]]; then
    printf -v padded '%03d' "$((10#$mode))"
    # The write bit is 2, so the writable octal digits are 2, 3, 6 and 7 -- NOT simply 6 and 7.
    # Permitting 0,1,4,5 is the whole set that lacks it.
    [[ "${padded:1:1}" =~ ^[0145]$ && "${padded:2:1}" =~ ^[0145]$ ]] ||
      die "$name has mode $mode; it is group- or world-writable."
  fi
done <<<"$EXPECTED_FILES"

# --- no secret may live inside an immutable, world-readable release package ----------------------
# The auth JSON is bind-mounted from /srv/qf-jarvis/secrets at run time. One appearing here would
# be copied with every release and outlive any revocation.
STRAY="$(cd "$RELEASE_DIR" && find . -iname '*auth*.json' -o -iname '.env*' -o -iname '*.pem' -o -iname '*.key' | head -5)"
[[ -z "$STRAY" ]] || die "secret-shaped file(s) inside the release package: $STRAY"

echo "ok: release artefacts at $RELEASE_DIR match $SHA byte for byte"
