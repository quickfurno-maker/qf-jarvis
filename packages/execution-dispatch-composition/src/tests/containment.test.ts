/**
 * What this composition cannot become.
 *
 * A composition package is the most tempting place in this architecture to grow a transport: it
 * already knows about a verifier and a database, and "just call n8n from here" would look like the
 * obvious next line. It is not, and these specs are why it stays not.
 *
 * The permanent flow is unchanged by composing two merged capabilities: Jarvis recommends,
 * QuickFurno Core authorizes and issues the intent, this boundary VERIFIES, n8n executes behind a
 * future adopted transport, providers deliver, results return to Core.
 *
 * Scans read source with comments stripped, because this package documents at length the things it
 * refuses to be and scanning the prose would report every prohibition as a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('it adopts no transport and executes nothing', () => {
  it('names no endpoint, webhook, workflow, provider or channel', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'http://',
        'https://',
        'webhook',
        'endpoint',
        'n8n.',
        'workflowid',
        'graph.facebook',
        'whatsapp',
        'meta',
        'twilio',
        'axios',
        'undici',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      expect(code, `${file} must not call fetch`).not.toMatch(/[^a-zA-Z]fetch\(/u);
    }
  });

  it('names no send, execute, retry, poll or queue verb', () => {
    // The composition validates. It does not act, and it does not schedule acting.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'sendMessage',
        'dispatchTo',
        'executeIntent',
        'setTimeout',
        'setInterval',
        'retry',
        'poll',
        'enqueue',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reads no environment and no credential', () => {
    // The harness is the only module allowed to read DATABASE_URL, and it is test-only.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['process.env', 'DATABASE_URL', 'credential', 'apiKey', 'secret']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exposes nothing that could be mistaken for permission to act', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'canExecute',
        'canSend',
        'isAuthorized',
        'consentValid',
        'retryAllowed',
        'executed',
        'delivered',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('it adds no schema and owns no storage', () => {
  it('writes no SQL and creates no migration', () => {
    // Migration 0010 belongs to QFJ-P09.03 and is reused unchanged. Composition does not justify
    // schema, so this package issues no DDL and contains no query of its own.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'CREATE TABLE',
        'ALTER TABLE',
        'INSERT INTO',
        'UPDATE ',
        'DELETE FROM',
        'SELECT ',
      ]) {
        expect(code, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('ships no migration file of its own', () => {
    const files = walk(SRC, false);
    for (const file of files) {
      expect(file.endsWith('.sql'), file).toBe(false);
    }
  });

  it('never closes a pool it did not open', () => {
    // The caller owns the pool. A composition that closed it would break the caller's other users
    // of the same pool, and there is no seam here that could.
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not end a pool`).not.toContain('.end(');
    }
  });
});

describe('the dependency direction is inward, and the surface is minimal', () => {
  it('declares exactly the two packages it composes', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/execution-dispatch-runtime',
      '@qf-jarvis/postgres-execution-replay-store',
      'pg',
    ]);
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
  });

  it('NEITHER composed package depends back on this one', () => {
    // The whole point of a composition leaf. An arrow back would make the two lower packages
    // unusable without it, and would let transport concerns leak downward.
    const specifier = ['@qf-jarvis', 'execution-dispatch-composition'].join('/');
    for (const entry of ['execution-dispatch-runtime', 'postgres-execution-replay-store']) {
      for (const file of walk(join(REPO_ROOT, 'packages', entry, 'src'), false)) {
        expect(readFileSync(file, 'utf8'), file).not.toContain(specifier);
      }
      const manifest = readFileSync(join(REPO_ROOT, 'packages', entry, 'package.json'), 'utf8');
      expect(manifest).not.toContain(specifier);
    }
  });

  it('exports exactly the reviewed surface', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    // One factory. A composition with a second entry point would be two compositions.
    expect(Object.keys(barrel)).toStrictEqual(['createDurableExecutionDispatchBoundary']);
  });

  it('NO application composes it yet', () => {
    // Wiring this into a running application is a later, separately authorized slice. Asserted so
    // the first consumer is a deliberate decision rather than an accident.
    const specifier = ['@qf-jarvis', 'execution-dispatch-composition'].join('/');
    const importers: string[] = [];
    for (const entry of readdirSync(join(REPO_ROOT, 'apps'))) {
      let files: string[];
      try {
        files = walk(join(REPO_ROOT, 'apps', entry, 'src'), false);
      } catch {
        continue;
      }
      for (const file of files) {
        if (readFileSync(file, 'utf8').includes(specifier)) {
          importers.push(file);
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });
});
