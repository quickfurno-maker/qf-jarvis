#!/usr/bin/env bash
# Jarvis OS immutable release preparation (JOS-01D, ADR-0088). GATE 2 ONLY.
#
#   prepare-release.sh <sha> [repo-dir] [releases-root]
#
# Materialises the deployment configuration for one exact merged commit at
# /srv/qf-jarvis/releases/<sha>/jarvis-os, and prints that path. Every later Gate 2 command runs
# from there.
#
# ### Why a per-SHA directory instead of one shared one
#
# A shared /srv/qf-jarvis/deploy belongs to no commit. It is whatever was last copied into it, and
# nothing about a successful deployment would reveal that its Compose file had drifted from the
# commit the image was built from. Binding the configuration to the SHA makes "the release" a
# single identity covering both halves.
#
# It also makes rollback honest: the previous release's own Compose files and overlays are still
# on disk, so rolling back restores the configuration that was reviewed with that image rather
# than combining an old image with today's labels.
#
# ### Tracked content only
#
# The package is built with `git archive`, which emits tracked files exclusively. Untracked local
# material cannot enter a release regardless of the state of the working tree, and the whole
# repository is never copied -- only `deploy/jarvis-os`.
set -Eeuo pipefail

SHA="${1:-}"
REPO_DIR="${2:-${REPO_DIR:-/srv/qf-jarvis/repo}}"
RELEASES_ROOT="${3:-/srv/qf-jarvis/releases}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBDIR='deploy/jarvis-os'

die() {
  echo "FATAL: $1" >&2
  exit 1
}

[[ -n "$SHA" ]] || die "usage: prepare-release.sh <sha> [repo-dir] [releases-root]"

# The commit must be reviewed code before any of it is written to the release root.
"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR" >/dev/null

TARGET="${RELEASES_ROOT}/${SHA}/jarvis-os"

# Already prepared? Accept it only if it still matches the commit exactly. This makes the script
# idempotent without making it a way to bless a directory that has since been edited.
if [[ -e "$TARGET" ]]; then
  if "$HERE/verify-release-artifacts.sh" "$SHA" "$TARGET" "$REPO_DIR" "$RELEASES_ROOT" >/dev/null; then
    echo "$TARGET"
    exit 0
  fi
  die "$TARGET already exists and does NOT match $SHA. Refusing to overwrite a divergent release.
     Inspect it, move it aside deliberately, and re-run."
fi

mkdir -p "${RELEASES_ROOT}/${SHA}"

# Staged in a sibling directory on the SAME filesystem so the publish step is an atomic rename.
# Extracting straight into $TARGET would leave a half-written release visible under its final name
# if the extraction failed midway -- and the next command would deploy it.
STAGE="$(mktemp -d "${RELEASES_ROOT}/${SHA}/.staging-XXXXXX")"
cleanup() { [[ -d "$STAGE" ]] && rm -rf "$STAGE"; }
trap cleanup EXIT

# Only deploy/jarvis-os, with its path prefix stripped. `git archive` preserves the tracked
# executable bits, which the verifier then checks against the tree.
#
# `core.autocrlf=false` and `core.eol=lf` are pinned on the invocation because `git archive`
# otherwise applies the host's line-ending configuration. The bytes of a release package must be
# the bytes of the commit -- not the bytes of the commit as filtered by whatever Git config the
# machine happens to carry -- or the byte-for-byte verification below is checking a moving target.
git -c core.autocrlf=false -c core.eol=lf -C "$REPO_DIR" archive --format=tar "$SHA" -- "$SUBDIR" |
  tar -x -C "$STAGE" --strip-components=2 ||
  die "could not extract $SUBDIR from $SHA."

# Deployment artefacts are read, never written, once published.
chmod -R go-w "$STAGE"

# Verify the STAGED bytes before publishing.
#
# The full verifier cannot run yet: one of its checks is that the package sits at
# <root>/<sha>/jarvis-os, and the staging directory deliberately does not, so that a half-written
# release is never reachable under its final name. Content is therefore compared directly against
# the Git objects here, and the full verifier runs immediately after the rename.
while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  [[ ! -L "$STAGE/$name" ]] || die "staged $name is a symlink."
  git -C "$REPO_DIR" cat-file blob "${SHA}:${SUBDIR}/${name}" | cmp -s - "$STAGE/$name" ||
    die "staged $name does not match its Git blob at $SHA."
done < <(git -C "$REPO_DIR" ls-tree -r --name-only "$SHA" -- "$SUBDIR" | sed "s|^${SUBDIR}/||")

# Atomic publish.
mv -T "$STAGE" "$TARGET" 2>/dev/null || mv "$STAGE" "$TARGET" ||
  die "could not publish release to $TARGET."
trap - EXIT

# Final verification at the real location, with the real approved root. If this fails the release
# is unusable and every deployment script will refuse it -- which is the intended outcome.
"$HERE/verify-release-artifacts.sh" "$SHA" "$TARGET" "$REPO_DIR" "$RELEASES_ROOT" >/dev/null ||
  die "published release at $TARGET failed verification."

echo "$TARGET"
