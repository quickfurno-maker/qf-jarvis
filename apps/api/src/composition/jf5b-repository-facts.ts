/**
 * The repository facts the preflight asserts, read once at the process boundary.
 *
 * Separated from the composition so the CLI receives FACTS rather than a way to discover them. A CLI
 * that could shell out to git is a CLI whose preflight a test would have to fake by intercepting a
 * subprocess; a CLI handed a record asserts the same rules with a literal.
 *
 * `git` is invoked with a fixed argument list and no shell, and only to read: the head, whether the
 * tree is clean, and where the repository root is. Nothing here writes, checks out or fetches.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import type { RepositoryFacts } from '@qf-jarvis/jarvis-v1-provider-certification-live';

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8', windowsHide: true }).trim();
}

/**
 * Read the facts.
 *
 * The output directory is resolved through `realpath` where it already exists, so a junction or a
 * symlink that points back into the repository is caught by the containment check rather than by the
 * string it was typed as. A path that does not exist yet cannot be a link, so the resolved form stands.
 */
export function readRepositoryFacts(resolvedOutputDirectory: string): RepositoryFacts {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']);
  let realOutput = resolvedOutputDirectory;
  try {
    realOutput = realpathSync(resolvedOutputDirectory);
  } catch {
    // Not created yet. The resolved absolute path is what the containment check reads.
  }
  return Object.freeze({
    headSha: git(['rev-parse', 'HEAD']),
    worktreeClean: git(['status', '--porcelain']).length === 0,
    repositoryRoot: realpathSync(repositoryRoot),
    resolvedOutputDirectory: realOutput,
  });
}
