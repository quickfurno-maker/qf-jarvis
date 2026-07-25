/**
 * QFJ-M5 — content-free observability, public API, and containment (ADR-0059 §B, §H, §J).
 *
 * Composition events are closed and content-free (no inbound/reply/subject/secret); the runtime exposes
 * only processInbound; the root barrel surface is locked and the fakes stay under ./testing; production
 * source imports no provider SDK/network/env/transport/DB and no sync-over-async primitive; the
 * dependency direction is one-way (no reverse dependency / cycle); migrations 0001–0007 are byte-exact
 * with no 0008; the event-backbone public-api lock remains 39; production source holds no control byte;
 * the emitting build excludes tests so dist is production-only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';

import * as barrel from '../index.js';
import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { JarvisRuntimeEvent } from '../contracts/observability.js';
import { JARVIS_RUNTIME_EVENT_TYPES } from '../contracts/observability.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
function readRepo(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

// eslint-disable-next-line no-control-regex
const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');

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

describe('content-free observability', () => {
  it('emits only closed event types carrying no inbound/reply/subject/secret content', async () => {
    const events: JarvisRuntimeEvent[] = [];
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        gatewayInvoker: scriptedGatewayInvoker(
          structuredReply({ replyBody: 'SECRET-REPLY-BODY-XYZ', citations: [] }),
        ),
        observability: { onEvent: (e) => events.push(e) },
      }),
    ).processInbound(syntheticInboundEnvelope({ normalizedText: 'SECRET-INBOUND-XYZ' }));
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(JARVIS_RUNTIME_EVENT_TYPES).toContain(e.type);
      expect(e.runId).toBe('conv.1-msg.1');
    }
    expect(events.map((e) => e.type)).toContain('jarvis-completed');
    const serialized = JSON.stringify(events);
    for (const forbidden of [
      'SECRET-INBOUND-XYZ',
      'SECRET-REPLY-BODY-XYZ',
      'sk-',
      'wamid',
      'subject',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('public API lock', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('locks the root barrel value surface and hides the fakes', () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        'JARVIS_RUNTIME_ERROR_CODES',
        'JARVIS_RUNTIME_EVENT_TYPES',
        'JARVIS_RUNTIME_OUTCOMES',
        'JarvisRuntimeError',
        'NOOP_JARVIS_RUNTIME_OBSERVABILITY',
        'createJarvisRuntime',
      ].sort(),
    );
    const b = barrel as Record<string, unknown>;
    for (const testOnly of [
      'scriptedAuthoritativeState',
      'clearControlState',
      'syntheticRuntimeConfig',
      'mutableAuthoritativeState',
    ]) {
      expect(b[testOnly]).toBeUndefined();
    }
  });

  it('exposes only processInbound on the runtime (no send/deliver/execute/persist)', () => {
    const runtime = createJarvisRuntime(syntheticRuntimeConfig());
    expect(Object.keys(runtime)).toEqual(['processInbound']);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'persist', 'callN8n', 'authorize']) {
      expect(surface[forbidden]).toBeUndefined();
    }
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('depends only on agent-runtime + core-decision-adapter + model-reply-adapter, exposes root + ./testing', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/core-decision-adapter',
      '@qf-jarvis/model-reply-adapter',
    ]);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });
});

describe('containment', () => {
  it('production source imports no provider SDK/network/env/transport/DB', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|axios|undici|whatsapp-web\.js|@whiskeysockets\/baileys|n8n)['"]/,
      );
    }
  });

  it('uses no sync-over-async blocking primitive', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/Atomics\s*\.\s*wait\b/);
      expect(text).not.toMatch(/\b(execSync|spawnSync|deasync)\b/);
    }
  });

  it('has a one-way dependency direction with no reverse dependency or cycle', () => {
    for (const lower of ['agent-runtime', 'core-decision-adapter', 'model-reply-adapter']) {
      const pkg = JSON.parse(readRepo(`packages/${lower}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@qf-jarvis/jarvis-runtime');
    }
  });

  it('the emitting build excludes tests so dist is production-only', () => {
    // tsconfig.build.json carries JSONC comments, so assert on the raw exclude directive.
    const buildTsconfig = readFileSync(
      fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)),
      'utf8',
    );
    expect(buildTsconfig).toMatch(/"exclude"\s*:\s*\[\s*"src\/tests\/\*\*"\s*\]/);
  });

  it('migrations 0001–0007 are byte-exact and there is no 0008', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(sql.some((n) => n.startsWith('0008'))).toBe(false);
  });

  it('the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('production source contains no NUL/control byte', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
