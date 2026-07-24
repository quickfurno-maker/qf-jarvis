/**
 * QFJ-P04.01A — containment proofs (ADR-0045).
 *
 * Prove the slice stays within its envelope: the new package depends only on zod (no network/provider
 * SDK/database/env); it exposes only the root and the `./testing` subpath; the FakeModelProvider is not
 * a production-root export; there is no real provider adapter; the event-backbone root API remains 39
 * and its barrel is untouched; migrations 0001–0007 are exact and there is no 0008; and Kimi appears
 * nowhere in the package. No database is used.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
function readRepo(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkSource(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const LOCKED_MIGRATION_HASHES: Record<string, string> = {
  '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
  '0002_event_runtime_grants.sql':
    '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
  '0003_ingestion_rejection_and_event_conflict.sql':
    '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
  '0004_projection_foundation.sql':
    '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
  '0005_projection_event_positions.sql':
    '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
  '0006_projection_failure_operations.sql':
    'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
  '0007_subject_activity_projection.sql':
    '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
};

describe('model-gateway package containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  it('depends only on zod — no network/provider-SDK/database dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    const all = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
    for (const name of Object.keys(all)) {
      expect(name).not.toMatch(
        /pg|postgres|groq|openai|anthropic|ollama|llama|axios|node-fetch|undici/i,
      );
    }
  });

  it('exposes only the root and the ./testing subpath', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('does not export FakeModelProvider from the production root', () => {
    const barrel = readRepo('packages/model-gateway/src/index.ts');
    // The barrel must not RE-EXPORT the fake provider or reach the ./testing subpath.
    expect(barrel).not.toMatch(/export\b[^;]*FakeModelProvider/);
    expect(barrel).not.toMatch(/from ['"][^'"]*testing/);
  });

  it('performs no network / provider-SDK / env / filesystem I/O in production source', () => {
    const files = walkSource(fileURLToPath(new URL('src', PKG_DIR))).filter(
      (f) => !f.replace(/\\/g, '/').includes('/tests/'),
    );
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process)['"]/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|axios|undici)['"]/,
      );
    }
  });

  it('contains no real provider adapter and no Kimi reference in production source', () => {
    const files = walkSource(fileURLToPath(new URL('src', PKG_DIR))).filter(
      (f) => !f.replace(/\\/g, '/').includes('/tests/'),
    );
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/kimi/i);
      expect(text).not.toMatch(
        /class\s+GroqProvider|class\s+OpenAIProvider|class\s+LocalOpenAiCompatibleProvider/,
      );
    }
  });
});

describe('cross-package invariants (QFJ-P04.01A must not disturb the event backbone)', () => {
  it('the event-backbone public-api lock remains 39', () => {
    const test = readRepo('packages/event-backbone/src/tests/public-api.test.ts');
    expect(test).toContain('toHaveLength(39)');
  });

  it('migrations 0001–0007 are byte-exact and there is no 0008', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      const actual = createHash('sha256')
        .update(readFileSync(join(dir, name)))
        .digest('hex');
      expect(actual).toBe(hash);
    }
    expect(sql.some((n) => n.startsWith('0008'))).toBe(false);
  });
});
