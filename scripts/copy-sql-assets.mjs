/**
 * Copy `.sql` assets from `src/` into `dist/`, on any platform.
 *
 * ### Why this exists
 *
 * `tsc` compiles TypeScript. It does not copy assets, so a `migrations/*.sql` file that
 * lives beside its loader in `src/` simply is not there in `dist/` — and the migration
 * CLI, which runs from `dist/`, finds an empty directory and cheerfully reports "already
 * up to date" against a database with no tables.
 *
 * That failure is silent, which is why this script exists rather than a note in a README.
 *
 * ### Why not resolve the migrations from `src/` at runtime instead?
 *
 * Because a compiled artifact that reaches back into its own source tree is a compiled
 * artifact that breaks the moment anything is deployed without `src/`. Copying the asset
 * makes `dist/` self-contained, which is what `dist/` is for.
 *
 * Only `.sql` files are copied, and only from inside the repository.
 */

import { statSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Directories whose immediate children may be workspace packages. */
const WORKSPACE_ROOTS = ['apps', 'packages'];

/**
 * Immediate child directories of a workspace root. A missing root is not an error.
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
 * Resolve a repository-relative path, refusing anything that escapes the repository.
 *
 * @param {string} relativePath
 * @returns {string}
 */
function insideRepository(relativePath) {
  const target = resolve(ROOT, relativePath);
  const inside = relative(ROOT, target);

  if (inside === '' || inside.startsWith('..')) {
    throw new Error(`Refusing to touch a path outside the repository: ${target}`);
  }

  return target;
}

const packageDirectories = (await Promise.all(WORKSPACE_ROOTS.map(childDirectories))).flat();

let copied = 0;

for (const packageDirectory of packageDirectories) {
  const source = insideRepository(join(packageDirectory, 'src'));
  const destination = insideRepository(join(packageDirectory, 'dist'));

  // A package with no compiled output has nothing to copy into. That is normal:
  // `apps/api` and `apps/worker` are compileable boundaries with no assets.
  try {
    await readdir(destination);
  } catch {
    continue;
  }

  await cp(source, destination, {
    recursive: true,
    force: true,
    // Directories are traversed so the tree is walked; among files, only `.sql` is
    // copied. Returning false for a directory would prune the whole subtree.
    filter: (path) => {
      if (statSync(path).isDirectory()) {
        return true;
      }
      return path.endsWith('.sql');
    },
  });

  copied += 1;
}

process.stdout.write(`Copied SQL assets for ${String(copied)} package(s).\n`);
