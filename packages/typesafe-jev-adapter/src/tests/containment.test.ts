import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const NEW_PACKAGES = [
  'system-one-decision-runtime',
  'system-one-decision-policy',
  'typesafe-jev-adapter',
] as const;

function walk(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function sourceFiles(root: string): string[] {
  return walk(root).filter((file) => ['.ts', '.tsx', '.js', '.mjs'].includes(extname(file)));
}

describe('TypeSafe Jev containment', () => {
  it('is not imported by any application or serving process in the foundation slice', () => {
    const appFiles = sourceFiles(join(REPO_ROOT, 'apps'));
    for (const file of appFiles) {
      const text = readFileSync(file, 'utf8');
      for (const packageName of NEW_PACKAGES) {
        expect(text, file).not.toContain(`@qf-jarvis/${packageName}`);
      }
      expect(text.toLowerCase(), file).not.toContain('api.typesafe.ai');
    }
  });

  it('keeps network access inside the one pinned Jev adapter', () => {
    const adapter = readFileSync(
      join(REPO_ROOT, 'packages/typesafe-jev-adapter/src/index.ts'),
      'utf8',
    );
    expect(adapter.match(/\bfetch\s*\(/gu)).toHaveLength(1);
    expect(adapter.match(/https:\/\/api\.typesafe\.ai\/v1\/systemone/gu)).toHaveLength(1);

    for (const packageName of ['system-one-decision-runtime', 'system-one-decision-policy']) {
      for (const file of sourceFiles(join(REPO_ROOT, 'packages', packageName, 'src'))) {
        if (file.includes(join('src', 'tests'))) continue;
        const text = readFileSync(file, 'utf8');
        expect(text, file).not.toMatch(/\bfetch\s*\(|node:https|node:http|process\.env/u);
      }
    }
  });

  it('depends on no workspace capability besides the neutral System-One runtime', () => {
    const expectedWorkspaceDependencies: Readonly<
      Record<(typeof NEW_PACKAGES)[number], readonly string[]>
    > = Object.freeze({
      'system-one-decision-runtime': Object.freeze([]),
      'system-one-decision-policy': Object.freeze(['@qf-jarvis/system-one-decision-runtime']),
      'typesafe-jev-adapter': Object.freeze(['@qf-jarvis/system-one-decision-runtime']),
    });

    for (const packageName of NEW_PACKAGES) {
      const rawManifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'),
      ) as unknown;
      if (typeof rawManifest !== 'object' || rawManifest === null || Array.isArray(rawManifest)) {
        throw new TypeError('jev-containment-manifest-invalid');
      }
      const dependencies = (rawManifest as Readonly<Record<string, unknown>>)['dependencies'];
      if (
        dependencies !== undefined &&
        (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies))
      ) {
        throw new TypeError('jev-containment-dependencies-invalid');
      }
      const workspaceDependencies =
        dependencies === undefined
          ? []
          : Object.keys(dependencies)
              .filter((one) => one.startsWith('@qf-jarvis/'))
              .sort();
      expect(workspaceDependencies, packageName).toEqual(
        [...expectedWorkspaceDependencies[packageName]].sort(),
      );

      for (const file of sourceFiles(join(REPO_ROOT, 'packages', packageName, 'src'))) {
        if (file.includes(join('src', 'tests'))) continue;
        const text = readFileSync(file, 'utf8');
        const imports = [
          ...new Set(
            [...text.matchAll(/from\s+['"](@qf-jarvis\/[^'"]+)['"]/gu)]
              .map((match) => match[1])
              .filter((one): one is string => one !== undefined),
          ),
        ].sort();
        expect(imports, file).toEqual([...expectedWorkspaceDependencies[packageName]].sort());
        expect(text, file).not.toMatch(/\b(?:exec|spawn)\s*\(/u);
      }
    }
  });
});
