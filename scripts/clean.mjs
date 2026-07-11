/**
 * Remove generated build and test artifacts, on any platform.
 *
 * This exists as a Node script rather than a package.json one-liner because
 * `rm -rf` does not exist on Windows PowerShell and `rimraf` would be a
 * dependency installed purely for convenience. Node's own `fs.rm` already does
 * the job identically on Windows, Linux, and macOS.
 *
 * Only generated, git-ignored paths are removed. Every target is resolved and
 * then checked to be inside the repository root before it is touched, so a bug
 * in a future edit to this list cannot escape the repository.
 */

import { readdir, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Directories whose immediate children each own a `dist/`. */
const WORKSPACE_ROOTS = ['apps', 'packages'];

/** Generated paths at the repository root. */
const ROOT_TARGETS = ['coverage', '.eslintcache', 'tsconfig.tsbuildinfo'];

/**
 * Read the child directories of a workspace root. A missing directory is not an
 * error — `packages/` legitimately holds no packages yet.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function childDirectories(dir) {
  try {
    const entries = await readdir(resolve(ROOT, dir), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
  } catch (error) {
    if (error instanceof Error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Delete a repository-relative path, refusing anything that resolves outside the
 * repository root.
 *
 * @param {string} relativePath
 * @returns {Promise<void>}
 */
async function remove(relativePath) {
  const target = resolve(ROOT, relativePath);
  const inside = relative(ROOT, target);

  if (inside === '' || inside.startsWith('..')) {
    throw new Error(`Refusing to delete a path outside the repository: ${target}`);
  }

  await rm(target, { recursive: true, force: true });
}

const workspaceTargets = (await Promise.all(WORKSPACE_ROOTS.map(childDirectories)))
  .flat()
  .flatMap((packageDir) => [join(packageDir, 'dist'), join(packageDir, 'tsconfig.tsbuildinfo')]);

await Promise.all([...ROOT_TARGETS, ...workspaceTargets].map(remove));

process.stdout.write('Removed generated build and test artifacts.\n');
