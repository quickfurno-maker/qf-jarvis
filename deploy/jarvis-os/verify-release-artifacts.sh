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

# Group- or world-writable means anyone in the group can swap the contents between the moment this
# check passes and the moment the deployment trusts it.
not_writable() { # path label
  local mode padded
  mode="$(stat -c '%a' "$1" 2>/dev/null || echo '')"
  [[ -n "$mode" ]] || return 0 # filesystem does not report POSIX modes; nothing to assert
  printf -v padded '%03d' "$((10#$mode))"
  # The write bit is 2, so the writable octal digits are 2, 3, 6 and 7 -- NOT simply 6 and 7.
  # The whole set that lacks it is 0, 1, 4, 5.
  [[ "${padded:1:1}" =~ ^[0145]$ && "${padded:2:1}" =~ ^[0145]$ ]] ||
    die "$2 has mode $mode; it is group- or world-writable."
}

# --- the approved location, checked without following anything attacker-controlled ---------------
#
# This is what forbids deploying from a mutable shared copy such as /srv/qf-jarvis/deploy: that path
# can be edited between releases and belongs to no commit.
#
# The subtlety is HOW the comparison is made. An earlier version canonicalised the expected path by
# `cd`-ing through <root>/<sha> -- the very directory an attacker would control. If that directory
# were a symlink to /tmp/evil, both the actual and the expected path resolved through the same
# symlink and compared equal, so a package anywhere on the filesystem could present itself as the
# approved release.
#
# So the expected path is now built from the canonical ROOT and the literal SHA, and every link in
# the chain is required to be a real directory rather than resolved through.
[[ -d "$RELEASES_ROOT" ]] || die "releases root $RELEASES_ROOT does not exist."
[[ ! -L "$RELEASES_ROOT" ]] || die "releases root $RELEASES_ROOT is a symlink. It must be a real directory."

SHA_DIR="${RELEASES_ROOT}/${SHA}"
[[ -d "$SHA_DIR" ]] || die "$SHA_DIR does not exist."
[[ ! -L "$SHA_DIR" ]] || die "$SHA_DIR is a symlink. A release SHA directory must be a real directory."

[[ ! -L "$RELEASE_DIR" ]] || die "$RELEASE_DIR is a symlink. A release package must be a real directory."
[[ -d "$RELEASE_DIR" ]] || die "$RELEASE_DIR does not exist."

CANON_ROOT="$(cd "$RELEASES_ROOT" && pwd -P)"
EXPECTED="${CANON_ROOT}/${SHA}/jarvis-os"
ACTUAL="$(cd "$RELEASE_DIR" && pwd -P)"

[[ "$ACTUAL" == "$EXPECTED" ]] ||
  die "release directory is '$ACTUAL'; expected '$EXPECTED'. Refusing to deploy from an unapproved path."

# Belt and braces: even if the equality above were ever loosened, the package must still sit
# beneath the canonical root. The trailing slash keeps `/srv/qf-jarvis/releases-evil` from passing
# as a prefix match of `/srv/qf-jarvis/releases`.
[[ "$ACTUAL" == "$CANON_ROOT"/* ]] ||
  die "release directory '$ACTUAL' is not beneath '$CANON_ROOT'."

# The trusted parent chain matters as much as the files: a writable parent lets the whole directory
# be replaced after verification.
not_writable "$CANON_ROOT" "releases root $CANON_ROOT"
not_writable "$SHA_DIR" "release SHA directory $SHA_DIR"
not_writable "$RELEASE_DIR" "release directory $RELEASE_DIR"

# --- the file set must equal the commit's file set, in both directions ---------------------------
# Derived from the commit rather than hardcoded, so a deployment file added in a future phase is
# covered automatically instead of being silently unchecked.
EXPECTED_FILES="$(git -C "$REPO_DIR" ls-tree -r --name-only "$SHA" -- "$SUBDIR" | sed "s|^${SUBDIR}/||" | sort)"
[[ -n "$EXPECTED_FILES" ]] || die "commit $SHA contains no files under $SUBDIR."

# `-printf` is a GNU extension; the `./` prefix is stripped with sed so this works wherever a POSIX
# find does. Symlinks are listed as well as regular files -- they must appear in the comparison and
# then be rejected below, not vanish from it.
ACTUAL_FILES="$(cd "$RELEASE_DIR" && find . -mindepth 1 \( -type f -o -type l \) | sed 's|^\./||' | sort)"

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
  not_writable "$path" "$name"
done <<<"$EXPECTED_FILES"

# --- no secret may live inside an immutable, world-readable release package ----------------------
# The auth JSON is bind-mounted from /srv/qf-jarvis/secrets at run time. One appearing here would
# be copied with every release and outlive any revocation.
STRAY="$(cd "$RELEASE_DIR" && find . -iname '*auth*.json' -o -iname '.env*' -o -iname '*.pem' -o -iname '*.key' | head -5)"
[[ -z "$STRAY" ]] || die "secret-shaped file(s) inside the release package: $STRAY"

echo "ok: release artefacts at $RELEASE_DIR match $SHA byte for byte"
