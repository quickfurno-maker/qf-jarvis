/**
 * Containment and port conformance for the durable continuity store (RWC-P2B, ADR-0095).
 *
 * The integration suite proves the store BEHAVES correctly against real PostgreSQL. These prove it
 * CANNOT DO the wrong things -- that no future edit quietly turns a working-state row into a
 * transcript, a memory record, a business authority, an ingress or a retention job.
 *
 * Scans read production source only (`src/tests/**` is excluded, and excluded from the emitting
 * build too), and they read CODE with comments stripped: this package necessarily NAMES the things
 * it refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import { createPostgresRiyaConversationContinuityStore } from '../index.js';
import type { PostgresRiyaContinuityStore } from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block comments and whole-line `//` comments so a scan reads CODE, not documentation. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionFiles = (): string[] => walk(SRC);
const productionCode = (): string =>
  productionFiles()
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('the public surface', () => {
  it('exports exactly three runtime symbols', () => {
    const runtime = Object.keys(barrel).sort();
    expect(runtime).toStrictEqual([
      'POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES',
      'PostgresRiyaContinuityStoreError',
      'createPostgresRiyaConversationContinuityStore',
    ]);
  });

  it('exports no SQL, table name, row codec, key validator or error classifier', () => {
    const b = barrel as Record<string, unknown>;
    for (const internal of [
      'SELECT_STATE',
      'INSERT_INITIAL_STATE',
      'UPDATE_STATE_IF_REVISION_MATCHES',
      'SELECT_EXISTS',
      'canonicalizeRow',
      'toStateParameters',
      'validateKey',
      'classifyDatabaseError',
      'TABLE',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('offers no escape hatch that would widen the port', () => {
    const b = barrel as Record<string, unknown>;
    for (const forbidden of [
      'deleteState',
      'clear',
      'prune',
      'reset',
      'listConversations',
      'countConversations',
      'createPool',
      'connect',
    ]) {
      expect(b[forbidden], forbidden).toBeUndefined();
    }
  });
});

describe('port conformance', () => {
  it('satisfies RiyaContinuityStorePort structurally, at compile time', () => {
    // The assignment itself is the assertion: `PostgresRiyaContinuityStore` IS the port, so this
    // stops compiling the moment the adapter's shape drifts from the contract it implements.
    const built: PostgresRiyaContinuityStore = createPostgresRiyaConversationContinuityStore({
      pool: { connect: () => Promise.reject(new Error('unused')) } as never,
    });
    expect(typeof built.load).toBe('function');
    expect(typeof built.createInitialIfAbsent).toBe('function');
    expect(typeof built.compareAndSet).toBe('function');
  });

  it('declares exactly the port methods and nothing more', () => {
    const built = createPostgresRiyaConversationContinuityStore({
      pool: { connect: () => Promise.reject(new Error('unused')) } as never,
    });
    expect(Object.keys(built).sort()).toStrictEqual([
      'compareAndSet',
      'createInitialIfAbsent',
      'load',
    ]);
  });

  it('matches the vocabulary the test-only in-memory fake uses', () => {
    // The fake is the semantic reference RWC-P2C was reviewed against. Reading it here keeps the two
    // implementations answerable to the same words; a durable store that invented a fourth create
    // disposition or a fourth CAS outcome would be a different contract wearing the same name.
    const fake = readFileSync(
      join(
        REPO_ROOT,
        'packages/riya-web-conversation-service/src/tests/fakes/in-memory-continuity-store.ts',
      ),
      'utf8',
    );
    for (const token of [
      "'CREATED'",
      "'EXISTING'",
      "'UPDATED'",
      "'REVISION_CONFLICT'",
      "'NOT_FOUND'",
    ]) {
      expect(fake, token).toContain(token);
      expect(productionCode(), token).toContain(token);
    }
    // And the fake's winner rule, which the durable store must not weaken.
    expect(fake).toContain('The loser gets the WINNER');
  });

  it('does not modify the port to make the adapter easier', () => {
    const port = readFileSync(
      join(REPO_ROOT, 'packages/riya-web-conversation-service/src/contracts/store-port.ts'),
      'utf8',
    );
    expect(port).toContain("readonly disposition: 'CREATED' | 'EXISTING'");
    expect(port).toContain(
      "export const RIYA_CONTINUITY_CAS_OUTCOMES = ['UPDATED', 'REVISION_CONFLICT', 'NOT_FOUND'] as const;",
    );
    expect(port).toContain('readonly tenantId: string;');
    expect(port).toContain('readonly conversationId: string;');
  });
});

describe('what this package cannot become', () => {
  it('contains no HTTP, ingress, browser or streaming surface', () => {
    const code = productionCode();
    for (const forbidden of [
      'express',
      'fastify',
      'hono',
      'createServer',
      '.listen(',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'cookie',
      'Cookie',
      'csrf',
      'CSRF',
      'cors',
      'CORS',
      'rateLimit',
      'sessionToken',
      'req.',
      'res.',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no environment variable and constructs no pool', () => {
    const code = productionCode();
    for (const forbidden of ['process.env', 'DATABASE_URL', 'new Pool(', 'connectionString']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('holds no clock, randomness or retry loop', () => {
    const code = productionCode();
    for (const forbidden of [
      'Date.now',
      'new Date(',
      'Math.random',
      'setTimeout',
      'setInterval',
      'retry',
      'Retry',
      'SERIALIZABLE',
      'pg_advisory',
      'FOR UPDATE',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('implements no reducer: no phase transition, extraction or provenance merge', () => {
    const code = productionCode();
    for (const forbidden of [
      'advancePhase',
      'nextPhase',
      'transition',
      'extract',
      'mergeProvenance',
      'PROVENANCE_PRECEDENCE',
      'reduce(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And it never computes a revision of its own.
    expect(code).not.toContain('expectedRevision + 1');
    expect(code).not.toContain('continuityRevision + 1');
  });

  it('stores and names no transcript, contact detail or business authority', () => {
    const code = productionCode();
    for (const forbidden of [
      'transcript',
      'messageHistory',
      'recentTurns',
      'rollingSummary',
      'contextWindow',
      'channel',
      'phoneNumber',
      'emailAddress',
      'consent',
      'optOut',
      'suppression',
      'canSubmit',
      'leadId',
      'vendorId',
      'price',
      'package',
      'sourceEventIds',
      'rebuildable',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('performs no deletion and issues no retention policy', () => {
    const code = productionCode();
    for (const forbidden of [
      'DELETE FROM',
      'TRUNCATE',
      'DROP ',
      'ttl',
      'TTL',
      'sweep',
      'archive',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('never returns a raw row or raw JSON as a continuity state', () => {
    const code = productionCode();
    // Every exit from the adapter goes through the canonical constructor.
    expect(code).toContain('canonicalizeRow');
    expect(code).not.toContain('return result.rows');
    expect(code).not.toContain('JSON.parse');
  });

  it('depends on nothing beyond the two contracts and pg', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toStrictEqual([
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-web-conversation-service',
      'pg',
    ]);
  });

  it('deep-imports no other package private module', () => {
    const code = productionCode();
    // A workspace import must name the package root and stop there.
    const imports = code.match(/from '(@qf-jarvis\/[^']+)'/gu) ?? [];
    for (const specifier of imports) {
      expect(specifier, specifier).toMatch(/from '@qf-jarvis\/[a-z-]+'/u);
    }
  });
});

describe('nothing composes this adapter', () => {
  it('is imported by no application, runtime or other package', () => {
    const searched: string[] = [];
    const roots = ['apps', 'packages'];
    for (const root of roots) {
      const base = join(REPO_ROOT, root);
      const stack = [base];
      while (stack.length > 0) {
        const dir = stack.pop();
        if (dir === undefined) break;
        for (const entry of readdirSync(dir)) {
          if (entry === 'node_modules' || entry === 'dist') continue;
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            stack.push(full);
          } else if (entry.endsWith('.ts')) {
            searched.push(full);
          }
        }
      }
    }
    const importers = searched.filter((file) => {
      // The package's own source obviously refers to itself in prose; skip it.
      if (file.startsWith(PACKAGE_ROOT)) return false;
      return readFileSync(file, 'utf8').includes(
        "from '@qf-jarvis/postgres-riya-conversation-continuity-store'",
      );
    });
    expect(importers).toStrictEqual([]);
  });

  it('RWC-P2C still requires an injected store and ships no default', () => {
    const service = readFileSync(
      join(REPO_ROOT, 'packages/riya-web-conversation-service/src/service/create-service.ts'),
      'utf8',
    );
    expect(service).not.toContain('postgres-riya-conversation-continuity-store');
    expect(service).not.toContain('InMemoryContinuityStore');
  });
});
