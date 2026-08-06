import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

/**
 * Containment for the execution-dispatch boundary (QFJ-P09.02, ADR-0090).
 *
 * The tests above prove the boundary REFUSES the right things. These prove it CANNOT DO the wrong
 * ones — that no future edit quietly turns a validator into a dispatcher.
 *
 * Scans read production source only (`src/tests/**` is excluded, and excluded from the emitting
 * build too), and they read CODE with comments stripped: this package necessarily NAMES the things
 * it refuses to be, so scanning the prose would report every prohibition as its own violation.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url));

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

describe('the public surface is small and deliberate', () => {
  it('exports exactly the approved runtime values', () => {
    // Locked from the day it lands. The envelope parser, the nominal digest, the signing-input
    // builder, the internal key record and the crypto helpers are all absent on purpose: each is
    // an internal detail whose misuse would weaken the boundary.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'EXECUTION_DISPATCH_DOMAIN_SEPARATOR',
      'EXECUTION_DISPATCH_KEY_PURPOSE',
      'EXECUTION_DISPATCH_REASONS',
      'ExecutionDispatchConfigError',
      'ExecutionDispatchKeyRegistry',
      'ExecutionDispatchKeyRegistryError',
      'verifyExecutionDispatch',
    ]);
  });

  it('exports no test fake and no bridge fixture', () => {
    for (const forbidden of [
      'InMemoryReplayGuard',
      'UnavailableReplayGuard',
      'NonsenseReplayGuard',
      'TestExecutionBridge',
      'createTestSigner',
      'signEnvelope',
      'makeIntent',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('exposes no in-package default replay store', () => {
    // A default store would pass every test, lose its state on restart, and produce exactly the
    // duplicate effect this boundary exists to prevent.
    const code = productionCode();
    expect(code).not.toMatch(/new\s+Map\s*<[^>]*>\s*\(\)\s*;?\s*\/\/\s*replay/u);
    expect(code).not.toContain('DEFAULT_REPLAY_GUARD');
    expect(code).not.toContain('createInMemoryReplayGuard');
  });
});

describe('no transport, no provider, no credential', () => {
  it('contains no network client of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'fetch(',
      'axios',
      'undici',
      'node-fetch',
      'got(',
      'XMLHttpRequest',
      'WebSocket',
      'node:http',
      'node:https',
      'node:net',
      'node:dgram',
      'node:tls',
      'createServer',
      'listen(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('names no endpoint, webhook, workflow or provider', () => {
    const code = productionCode();
    for (const forbidden of [
      'https://',
      'http://',
      'webhook',
      'workflowId',
      'n8n.io',
      'graph.facebook.com',
      'whatsapp',
      'WhatsApp',
      'twilio',
      'sendgrid',
      'apiKey',
      'accessToken',
      'bearer',
      'Authorization',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no environment, no filesystem and no clock', () => {
    const code = productionCode();
    for (const forbidden of [
      'process.env',
      'node:fs',
      'readFileSync',
      'Date.now',
      'setTimeout',
      'setInterval',
      'Math.random',
      'randomUUID',
      'console.',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('reaches no database and writes no persistence', () => {
    const code = productionCode();
    for (const forbidden of [
      'pg',
      'postgres',
      'supabase',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the boundary imports nothing that would blur it', () => {
  it('does NOT import event-ingestion — a different domain and key purpose', () => {
    // The single most dangerous shortcut available in this phase: reusing the B1 registry and
    // signing helpers would silently unify two trust purposes that must stay separate.
    expect(productionCode()).not.toContain('@qf-jarvis/event-ingestion');
  });

  it('does NOT import approval, communication or intent-correlation runtimes', () => {
    const code = productionCode();
    for (const forbidden of [
      '@qf-jarvis/approval-runtime',
      '@qf-jarvis/approval-core-adapter',
      '@qf-jarvis/communication-authorization-runtime',
      '@qf-jarvis/execution-intent-runtime',
      '@qf-jarvis/event-backbone',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('depends on @qf-jarvis/contracts and nothing else', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    );
    const deps = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {};
    expect(Object.keys(deps)).toStrictEqual(['@qf-jarvis/contracts']);
  });
});

describe('no execution authority is created', () => {
  it('defines no authority or outcome field anywhere in production code', () => {
    const code = productionCode();
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'consentValid',
      'communicationAllowed',
      'retryAllowed',
      'isFresh',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('constructs no ExecutionResultV1 and claims no delivery', () => {
    const code = productionCode();
    // Execution truth belongs to QuickFurno Core after a real execution returns. A validation
    // boundary that minted results would be inventing outcomes it never witnessed.
    for (const forbidden of [
      'executionResultV1Schema',
      'ExecutionResultV1',
      'executionResultId',
      'createExecutionResult',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('offers no function that hands a validated dispatch to a transport', () => {
    const code = productionCode();
    for (const forbidden of [
      'sendToN8n',
      'callN8n',
      'dispatchToN8n',
      'executeIntent',
      'postDispatch',
      'deliver(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('nothing consumes this package yet', () => {
  it('is a leaf: no workspace package or application imports it', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const roots = [join(repoRoot, 'packages'), join(repoRoot, 'apps')];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const entry of readdirSync(root)) {
        // Skip this package itself, and never traverse build output.
        if (entry === 'execution-dispatch-runtime') continue;
        const srcDir = join(root, entry, 'src');
        let files: string[];
        try {
          files = walkAll(srcDir);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/execution-dispatch-runtime')) {
            offenders.push(file);
          }
        }
      }
    }

    // P09.02 delivers the boundary and its proof. Wiring it to anything is a later, separately
    // authorized slice -- and until that slice exists, "nothing imports it" is the guarantee.
    expect(offenders).toStrictEqual([]);
  });
});

/** Walk every `.ts` under a directory, including tests. Used only for the leaf check. */
function walkAll(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkAll(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}
