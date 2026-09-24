import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const PACKAGES = [
  'digital-twin-simulation',
  'governed-agent-handoff',
  'model-intelligence-control',
  'multimodal-turn-planning',
  'semantic-context-engine',
] as const;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

describe('ADR-0162 adaptive-intelligence containment', () => {
  it('keeps all five capability foundations free of ambient I/O and execution authority', () => {
    for (const pkg of PACKAGES) {
      const files = walk(join(REPO_ROOT, 'packages', pkg, 'src')).filter(
        (file) => file.endsWith('.ts') && !normalize(file).includes(normalize('/tests/')),
      );
      for (const file of files) {
        const code = codeOnly(readFileSync(file, 'utf8'));
        expect(code, file).not.toMatch(
          /from ['"](?:pg|node:(?:fs|http|https|net|tls|child_process))['"]/u,
        );
        expect(code, file).not.toMatch(/\bfetch\s*\(|\baxios\b|\bundici\b/u);
        expect(code, file).not.toMatch(
          /\bprocess\.env\b|DATABASE_URL|META_(?:TOKEN|ACCESS)|WHATSAPP_TOKEN/u,
        );
        expect(code, file).not.toMatch(
          /\bcreateDatabasePool\b|\bstartWorkflow\b|\bdispatch\s*\(|\bsend\s*\(/u,
        );
        expect(code, file).not.toMatch(
          /ConversationControlCommand|CoreRiyaIntakePort|ExecutionIntentV1/u,
        );
      }
    }
  });

  it('declares no runtime or third-party dependencies', () => {
    for (const pkg of PACKAGES) {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      expect(manifest.dependencies ?? {}, pkg).toEqual({});
      expect(manifest.devDependencies ?? {}, pkg).toEqual({});
    }
  });

  it('pins the public runtime surfaces to the reviewed minimal exports', async () => {
    const expected: Readonly<Record<(typeof PACKAGES)[number], number>> = {
      'digital-twin-simulation': 2,
      'governed-agent-handoff': 2,
      'model-intelligence-control': 3,
      'multimodal-turn-planning': 1,
      'semantic-context-engine': 3,
    };
    for (const pkg of PACKAGES) {
      const barrel = (await import(`../../../../packages/${pkg}/dist/index.js`)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(barrel), pkg).toHaveLength(expected[pkg]);
    }
  });
});
