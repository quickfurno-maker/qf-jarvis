import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE_BATCH_SIZE = 6;
const LINTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.cache',
  'coverage',
  'dist',
  'node_modules',
]);

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot);
}

function containsLintableSource(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (containsLintableSource(join(directory, entry.name))) return true;
      continue;
    }
    if (entry.isFile() && LINTABLE_EXTENSIONS.has(extensionOf(entry.name))) return true;
  }
  return false;
}

function workspaceDirectories() {
  const result = [];
  for (const parentName of ['apps', 'packages']) {
    const parent = join(ROOT, parentName);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = join(parent, entry.name);
      if (!containsLintableSource(absolute)) continue;
      result.push(relative(ROOT, absolute).split(sep).join('/'));
    }
  }
  return result.sort();
}

function rootLintTargets() {
  const targets = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (
        entry.name === 'apps' ||
        entry.name === 'packages' ||
        IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }
      const absolute = join(ROOT, entry.name);
      if (containsLintableSource(absolute)) targets.push(entry.name);
      continue;
    }
    if (entry.isFile() && LINTABLE_EXTENSIONS.has(extensionOf(entry.name))) {
      targets.push(entry.name);
    }
  }
  return targets.sort();
}

function runEslint(targets, label) {
  if (targets.length === 0) return;

  process.stdout.write(
    `[lint] ${label}: ${targets.length} target${targets.length === 1 ? '' : 's'}\n`,
  );

  const packageManager = process.env['npm_execpath'];
  if (packageManager === undefined || packageManager.trim() === '') {
    throw new Error('lint runner requires the package-manager path supplied by pnpm run');
  }

  const result = spawnSync(
    process.execPath,
    [packageManager, 'exec', 'eslint', ...targets, '--max-warnings=0'],
    {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const rootTargets = rootLintTargets();
runEslint(rootTargets, 'repository files');

const workspaces = workspaceDirectories();
for (let index = 0; index < workspaces.length; index += WORKSPACE_BATCH_SIZE) {
  const batch = workspaces.slice(index, index + WORKSPACE_BATCH_SIZE);
  runEslint(
    batch,
    `workspace batch ${Math.floor(index / WORKSPACE_BATCH_SIZE) + 1}/${Math.ceil(
      workspaces.length / WORKSPACE_BATCH_SIZE,
    )}`,
  );
}
