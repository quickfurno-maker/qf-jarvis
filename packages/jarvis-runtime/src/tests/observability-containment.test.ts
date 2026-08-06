/**
 * QFJ-M5 — content-free observability, public API, and containment (ADR-0059 §B, §H, §J).
 *
 * Composition events are closed and content-free (no inbound/reply/subject/secret); the runtime exposes
 * only processInbound; the root barrel surface is locked and the fakes stay under ./testing; production
 * source imports no provider SDK/network/env/transport/DB and no sync-over-async primitive; the
 * dependency direction is one-way (no reverse dependency / cycle); migrations 0001–0010 are byte-exact
 * with no 0011; the event-backbone public-api lock remains 39; production source holds no control byte;
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
  '0008_conversation_control_persistence.sql':
    'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
  '0009_durable_approval_queue.sql':
    'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
  '0010_execution_replay_claim.sql':
    '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
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
      // ADR-0069: the canonical run identifier is the envelope's runtimeId, not a concatenation.
      expect(e.runId).toBe('rt.1');
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

  it('exposes only the three composition methods (no send/deliver/execute/persist)', () => {
    // QFJ-P08-A (ADR-0075) adds two OPERATOR methods beside the one inbound method. Still an EXACT
    // set match, and still nothing that sends, delivers, executes, persists or authorizes.
    const runtime = createJarvisRuntime(syntheticRuntimeConfig());
    expect(Object.keys(runtime).sort()).toEqual([
      'applyConversationControlCommand',
      'processInbound',
      'readConversationOperationsSnapshot',
    ]);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of [
      'send',
      'deliver',
      'execute',
      'persist',
      'callN8n',
      'authorize',
      'approve',
      'dispatch',
      'webhook',
      'startWorker',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('(ADR-0075) the operator surface performs no I/O, transport, persistence or business action', () => {
    // The two new production modules ARE the operator surface. They must be as inert as the inbound
    // composition: a control plane that could reach a database or a provider would be a second
    // authority, and this one is deliberately a decision boundary only.
    const withoutComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of ['control-surface.ts', 'operations-snapshot.ts']) {
      const code = withoutComments(
        readFileSync(fileURLToPath(new URL(`../composition/${file}`, import.meta.url)), 'utf8'),
      );
      expect(code).not.toMatch(/process\.env/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(code).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|axios|undici)['"]/,
      );
      expect(code).not.toMatch(/supabase|postgres|redis|SELECT |INSERT |UPDATE |DELETE /i);
      expect(code).not.toMatch(/\bn8n\b|whatsapp|groq/i);
      // Note the trailing `\s*\(`: `applyConversationControlCommand` is the sanctioned method name,
      // so the scan bans the ACTIONS, not every identifier that happens to contain "apply".
      expect(code).not.toMatch(/\b(send|deliver|execute|persist|approve|dispatch)\s*\(/);
      expect(code).not.toMatch(/\b(payment|refund|entitlement|verification)\b/i);
      // No production store, and no clock: the operator's own instant is the evidence. A collection
      // built INSIDE a function is a local and is fine -- the validators use one; what would be a
      // store is a MODULE-LEVEL one, so only unindented declarations are checked.
      const moduleLevel = code.split('\n').filter((line) => /^[A-Za-z]/.test(line));
      expect(moduleLevel.some((line) => /=\s*new\s+(Map|Set|WeakMap|WeakSet)/.test(line))).toBe(
        false,
      );
      expect(code).not.toMatch(/^(let|var)\s/m);
      expect(code).not.toMatch(/Date\.now|Math\.random|config\.clock/);
    }
  });

  it('depends only on the three lower packages + the two behaviour agents, exposes root + ./testing', () => {
    // QFJ-S3-C-B (ADR-0068) added @qf-jarvis/riya-agent; QFJ-S3-D-B (ADR-0071) adds
    // @qf-jarvis/anisha-agent. The composition root is the ONE layer allowed to know both the generic
    // pipeline and a business agent, and each behaviour package depends only on agent-runtime, so the
    // graph stays acyclic and the two agents never see each other. Still an EXACT set match.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/anisha-agent',
      // QFJ-P08-A (ADR-0075): the pure control reducer behind the operator surface. EXACT set match.
      '@qf-jarvis/conversation-control',
      '@qf-jarvis/core-decision-adapter',
      '@qf-jarvis/model-reply-adapter',
      // QFJ-S3-I-B (ADR-0073): the injected prompt registry. Still an EXACT set match.
      '@qf-jarvis/prompt-registry',
      '@qf-jarvis/riya-agent',
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

  it('migrations 0001–0010 are byte-exact and there is no 0011', () => {
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
    expect(sql.some((n) => n.startsWith('0011'))).toBe(false);
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
