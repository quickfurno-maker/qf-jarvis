import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = resolve(PKG, '../..');
const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') return [];
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith('.ts') && !path.includes(join('src', 'tests'))
      ? [path]
      : [];
  });
}

function repositoryProductionSources(): string[] {
  return ['apps', 'packages'].flatMap((root) => {
    const base = join(ROOT, root);
    return sourceFiles(base).filter((path) => !path.includes(join('src', 'tests')));
  });
}

describe('TypeSafe Jev containment', () => {
  it('depends only on the provider-neutral decision contract', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/decision-intelligence',
    ]);
  });

  it('locks transport to the two official TypeSafe endpoints and reads no environment', () => {
    const source = sourceFiles(join(PKG, 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).toContain('https://api.typesafe.ai/v1/systemone');
    expect(source).toContain('https://api.typesafe.ai/v1/models');
    expect(source).not.toMatch(
      /process\.env|DATABASE_URL|SUPABASE|QUICKFURNO_CORE|ACTION_KERNEL/iu,
    );
  });

  it('has no database, filesystem, child-process, action-kernel or JAO runtime dependency', () => {
    const source = sourceFiles(join(PKG, 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /from ['"](?:node:fs|node:child_process|pg|@supabase\/|@qf-jarvis\/(?:action-kernel|jao-action-registry|core-decision-adapter))/u,
    );
  });

  it('is composed only by the reviewed WhatsApp production boundary', () => {
    const refs = repositoryProductionSources()
      .filter((path) => !path.startsWith(join(PKG, 'src')))
      .filter((path) => readFileSync(path, 'utf8').includes('@qf-jarvis/jev-decision-adapter'))
      .map((path) => relative(ROOT, path).replaceAll('\\', '/'))
      .sort();
    expect(refs).toStrictEqual([
      'apps/api/src/quickfurno-whatsapp/production-worker-config.ts',
      'apps/api/src/quickfurno-whatsapp/production-worker.ts',
    ]);
  });
});
