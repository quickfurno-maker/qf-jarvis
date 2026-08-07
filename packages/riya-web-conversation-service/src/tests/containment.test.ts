/**
 * Containment for the private Riya web conversation service (RWC-P2C, ADR-0094).
 *
 * The behaviour spec proves what a turn does. These prove what the package cannot do at all: no
 * transport, no server, no route, no database, no streaming, no transcript, no reducer, and no
 * business authority — plus no drift in the contracts it reuses rather than replaces.
 *
 * Scans read production source with comments stripped: this package necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionCode = (): string =>
  walk(SRC, true)
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('the public surface is four runtime values', () => {
  it('exports exactly the approved runtime symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_WEB_CONVERSATION_DISPOSITIONS',
      'RIYA_WEB_CONVERSATION_ERROR_CODES',
      'RiyaWebConversationError',
      'createRiyaWebConversationService',
    ]);
  });

  it('exports no schema, fake, envelope builder, mapper, handler or key helper', () => {
    for (const forbidden of [
      'webConversationTurnSchema',
      'buildWebInboundEnvelope',
      'InMemoryContinuityStore',
      'UnavailableContinuityStore',
      'dispositionFor',
      'initialContinuity',
      'keyOf',
      'RIYA_CONTINUITY_CAS_OUTCOMES',
      'handler',
      'route',
      'createServer',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('(41) exposes no streaming symbol of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'AsyncIterable',
      'AsyncGenerator',
      'ReadableStream',
      'EventSource',
      'WebSocket',
      'text/event-stream',
      'onToken',
      'onChunk',
      'onDelta',
      'partial',
      'stream',
      'chunk',
      'delta',
      'yield ',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(barrel).some((key) => /stream|chunk|token|delta/iu.test(key))).toBe(false);
  });

  it('(48, 49) exports no reducer, extraction, canSubmit, lead or consent capability', () => {
    for (const forbidden of [
      'determineNextPhase',
      'advancePhase',
      'mergeProvenance',
      'applyFieldUpdate',
      'applyExtraction',
      'extractRequirements',
      'classifyIntent',
      'computeCanSubmit',
      'canSubmit',
      'createLead',
      'recordConsent',
      'assignVendor',
      'submit',
      'send',
      'execute',
      'authorize',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });
});

describe('(42-46) the service reaches nothing', () => {
  it('(42, 51) contains no HTTP server, route or public endpoint', () => {
    const code = productionCode();
    for (const forbidden of [
      'createServer',
      'listen(',
      'express',
      'fastify',
      'hono',
      'app.post',
      'app.get',
      'router.post',
      'router.get',
      'NextRequest',
      'NextResponse',
      'Request',
      'Response',
      'http://',
      'https://',
      'cors',
      'Access-Control',
      'cookie',
      'setHeader',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(43) contains no network client', () => {
    const code = productionCode();
    for (const forbidden of ['fetch(', 'axios', 'undici', 'node-fetch', 'XMLHttpRequest', 'got(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('(44, 45, 52) touches no database, cache or managed configuration', () => {
    const code = productionCode();
    for (const forbidden of [
      "'pg'",
      'Pool',
      'PoolClient',
      'supabase',
      'redis',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'CREATE TABLE',
      'migration',
      'DATABASE_URL',
      'connectionString',
      'process.env',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(46) reaches no provider, n8n or model gateway', () => {
    const code = productionCode();
    for (const forbidden of [
      'n8n',
      'whatsapp',
      'twilio',
      'graph.facebook',
      'webhook',
      'model-gateway',
      'promptRef',
      'draftReply',
      'apiKey',
      'credential',
      'Bearer',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(47) holds no transcript, history or rolling summary', () => {
    const code = productionCode();
    // `messages` alone is deliberately NOT in this list: `MESSAGES` is the fixed error-message table
    // in `errors.ts`, and banning the word would ban the very thing that keeps errors content-free.
    // What must stay absent is a CONVERSATION transcript.
    for (const forbidden of [
      'transcript',
      'chatMessages',
      'messageList',
      'previousTurns',
      'recentTurns',
      'priorTurns',
      'conversationHistory',
      'messageHistory',
      'rollingSummary',
      'conversationSummary',
      'contextWindow',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('reads no clock and no randomness', () => {
    // `receivedAt` arrives on the turn. A clock here would be a second opinion about when a message
    // arrived, and the runtime already treats the envelope instant as the truth.
    const code = productionCode();
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'hrtime']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('depends on exactly the four workspace packages and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-continuity',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
  });

  it('the dependency direction is one-way: nothing it depends on depends back', () => {
    // PRODUCTION source only. A containment spec in one of those packages legitimately NAMES this
    // one -- that is how it pins the exact set of packages allowed to import it -- and scanning
    // those specs would report the lock as the violation it exists to prevent.
    for (const pkg of [
      'riya-agent',
      'riya-conversation-continuity',
      'agent-runtime',
      'jarvis-runtime',
    ]) {
      const code = walk(join(REPO_ROOT, 'packages', pkg, 'src'), true)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
      expect(code, pkg).not.toContain('riya-web-conversation-service');
    }
  });

  it('imports no private module of another package', () => {
    // Deep-importing an orchestrator file would be composing a second orchestration path with extra
    // steps, and it would do it below the public API that governs the first.
    const code = productionCode();
    expect(code).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
    expect(code).not.toContain('orchestrate-inbound');
    expect(code).not.toContain('createOrchestrator');
    expect(code).not.toContain('runAgentTurn');
    expect(code).not.toContain('composeAndProcess');
  });
});

describe('(50, 53-57) the repository invariants this slice must not move', () => {
  it('(50) no QuickFurno adapter or browser client exists anywhere', () => {
    const offenders: string[] = [];
    for (const root of ['packages', 'apps']) {
      for (const file of walk(join(REPO_ROOT, root), false)) {
        const normalised = file.replace(/\\/gu, '/');
        if (/riya-ui|jarvisClient|quickfurno-adapter/u.test(normalised)) {
          offenders.push(normalised);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('(51) the only HTTP routes remain the three operator-plane routes', () => {
    const routes = walk(join(REPO_ROOT, 'apps', 'jarvis-os', 'src', 'app'), false)
      .map((file) => file.replace(/\\/gu, '/'))
      .filter((file) => /\/route\.tsx?$/u.test(file))
      .map((file) => file.split('/src/app/')[1] ?? file)
      .sort();
    expect(routes).toStrictEqual([
      'api/auth/login/route.ts',
      'api/auth/logout/route.ts',
      'api/control-plane/v1/snapshot/route.ts',
    ]);
    // And apps/api still runs no server.
    const apiIndex = readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'), 'utf8');
    expect(codeOnly(apiIndex).trim()).toBe('export {};');
  });

  it('(53) migrations are still exactly 0001-0011, byte-identical, with no 0012', () => {
    const LOCKED: Readonly<Record<string, string>> = {
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
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
      '0011_riya_conversation_continuity.sql':
        '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
    };
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toStrictEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
        name,
      ).toBe(hash);
    }
    expect(sql.some((name) => Number.parseInt(name.slice(0, 4), 10) > 11)).toBe(false);
  });

  it('(54, 55) the two channel vocabularies are exactly as JRW-0B left them', () => {
    // Read from SOURCE rather than imported: `@qf-jarvis/contracts` is deliberately not a dependency
    // of this package, and the point of the check is that this slice did not touch either.
    const runtime = readFileSync(
      join(REPO_ROOT, 'packages/agent-runtime/src/contracts/vocabularies.ts'),
      'utf8',
    );
    const contracts = readFileSync(
      join(REPO_ROOT, 'packages/contracts/src/communications/communication-channel.ts'),
      'utf8',
    );
    expect(runtime).toContain(
      "export const RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL', 'WEB'] as const;",
    );
    expect(contracts).toContain(
      "export const COMMUNICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'voice'] as const;",
    );
  });

  it('(56, 57) the P2A and jarvis-runtime public APIs are unchanged', async () => {
    const continuity =
      (await import('@qf-jarvis/riya-conversation-continuity')) as unknown as Record<
        string,
        unknown
      >;
    expect(Object.keys(continuity).sort()).toStrictEqual([
      'RIYA_CONVERSATION_CONTINUITY_ERROR_CODES',
      'RIYA_CONVERSATION_PHASES',
      'RIYA_FIELD_PROVENANCE_SOURCES',
      'RiyaConversationContinuityError',
      'createRiyaConversationContinuityState',
    ]);

    const runtime = (await import('@qf-jarvis/jarvis-runtime')) as unknown as Record<
      string,
      unknown
    >;
    // Zero API growth. The service consumes `createJarvisRuntime`'s existing `processInbound`
    // entry point, so no seam had to be opened.
    expect(Object.keys(runtime)).toHaveLength(6);
    expect(Object.keys(runtime).sort()).toStrictEqual([
      'JARVIS_RUNTIME_ERROR_CODES',
      'JARVIS_RUNTIME_EVENT_TYPES',
      'JARVIS_RUNTIME_OUTCOMES',
      'JarvisRuntimeError',
      'NOOP_JARVIS_RUNTIME_OBSERVABILITY',
      'createJarvisRuntime',
    ]);
  });

  it('no application composes this service, and the only package importing it takes types alone', () => {
    // P2C delivered the service and its proof, and until RWC-P2B the guarantee was simply "nothing
    // imports it". RWC-P2B (ADR-0095) changed that fact and no other: the durable continuity store
    // implements the `RiyaContinuityStorePort` this package OWNS, so it imports the port's types.
    //
    // The lock is made MORE precise rather than dropped. An adapter implementing a declared port is
    // not a composition; an application reaching for the service IS. So:
    //   * the importing PACKAGE set is pinned exactly to one;
    //   * no application may import the service at all;
    //   * and the importer must not construct it — a store that called the service would have
    //     inverted the dependency and composed the very thing this asserts nobody has composed.
    const ALLOWED_PACKAGE_IMPORTERS = ['postgres-riya-conversation-continuity-store'];
    const importingPackages = new Set<string>();
    const importingApps = new Set<string>();

    for (const [root, sink] of [
      ['packages', importingPackages],
      ['apps', importingApps],
    ] as const) {
      for (const entry of readdirSync(join(REPO_ROOT, root))) {
        if (entry === 'riya-web-conversation-service' || NOT_SOURCE.has(entry)) continue;
        const srcDir = join(REPO_ROOT, root, entry, 'src');
        let files: string[];
        try {
          files = walk(srcDir, false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-web-conversation-service')) {
            sink.add(entry);
          }
        }
      }
    }

    expect([...importingPackages].sort()).toStrictEqual(ALLOWED_PACKAGE_IMPORTERS);
    expect([...importingApps]).toStrictEqual([]);

    // Type-only, and specifically NOT a construction of the service.
    const storeSrc = join(REPO_ROOT, 'packages/postgres-riya-conversation-continuity-store/src');
    // PRODUCTION files only. The store's own specs necessarily NAME this package — they read its
    // port and its in-memory fake to prove the two implementations answer to the same words — and
    // scanning them would report that proof as its own violation.
    for (const file of walk(storeSrc, false)) {
      if (file.replace(/\\/gu, '/').includes('/src/tests/')) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('createRiyaWebConversationService');
      if (text.includes('@qf-jarvis/riya-web-conversation-service')) {
        expect(text, file).toMatch(
          /import type \{[\s\S]*?\} from '@qf-jarvis\/riya-web-conversation-service';/u,
        );
      }
    }
  });
});
