#!/usr/bin/env bash
# Jarvis OS merged-main commit guard (JOS-01D, ADR-0088).
#
#   verify-merged-sha.sh <sha> [repo-dir]
#
# Exits 0 only if <sha> is a full commit SHA that exists and is CONTAINED IN origin/main.
# Exits non-zero, with a reason on stderr, otherwise.
#
# ### Why this is its own file
#
# It is the one guard that decides whether unreviewed code can reach production, so it is kept
# small enough to read in full and executable on its own — the test suite runs it directly against
# real commits, including a real unmerged branch commit. A guard embedded in the middle of
# deploy.sh could only be tested by running a deployment.
#
# ### What it is defending against
#
# "Deploy this SHA" is trusted input from a tired operator, not an attacker: the realistic failure
# is pasting the head of the feature branch you were just reading instead of the merge commit.
# Verifying that the running image reports the requested SHA does not catch that -- it faithfully
# confirms you deployed exactly the wrong thing. Containment in origin/main is the check that
# "reviewed" and "deployed" refer to the same code.
#
# No GitHub CLI, no network credential, no API token: `git merge-base` against a freshly fetched
# origin/main is sufficient and keeps the trust boundary at the Git remote the host already uses.
set -Eeuo pipefail

SHA="${1:-}"
REPO_DIR="${2:-${REPO_DIR:-/srv/qf-jarvis/repo}}"

die() {
  echo "FATAL: $1" >&2
  exit 1
}

[[ -n "$SHA" ]] || die "usage: verify-merged-sha.sh <sha> [repo-dir]"

# A full 40-character hex SHA, and nothing else. Abbreviated SHAs, tags, branch names and
# `HEAD`/`main` are all rejected: each of them can resolve to different commits at different times,
# which is the exact ambiguity an immutable deployment is supposed to remove.
[[ "$SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die "'$SHA' is not a full 40-character hex commit SHA."

[[ -d "$REPO_DIR/.git" || -f "$REPO_DIR/.git" ]] || die "$REPO_DIR is not a git repository."

# Refresh origin first. Without this, a commit merged minutes ago looks unmerged and a branch
# deleted upstream still looks live. Failure to reach the remote is fatal rather than a warning:
# proceeding would mean deciding "is this reviewed?" from a stale answer.
#
# There is deliberately NO skip flag. An escape hatch on the one guard standing between unreviewed
# code and production is the thing that gets used at 2am. The test suite exercises this path for
# real against a local file remote rather than switching it off.
git -C "$REPO_DIR" fetch --prune origin >/dev/null 2>&1 ||
  die "could not fetch origin. Refusing to decide containment from a stale ref."

git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null ||
  die "commit $SHA does not exist in $REPO_DIR."

git -C "$REPO_DIR" rev-parse --verify --quiet 'origin/main^{commit}' >/dev/null ||
  die "origin/main does not exist in $REPO_DIR."

git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" 'origin/main^{commit}' 2>/dev/null ||
  die "commit $SHA is NOT contained in origin/main. Refusing to deploy unreviewed code."

echo "ok: $SHA is contained in origin/main"
