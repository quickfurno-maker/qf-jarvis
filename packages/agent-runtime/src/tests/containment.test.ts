/**
 * QFJ-M1 — observability and containment (ADR-0054 §K, §M).
 *
 * Matrix items 24, 25, 27–35: content-free events; no message/subject/PII/token in events; no
 * WhatsApp/n8n/provider/DB/network coupling and no P04 package import; no schema/migration 0008;
 * migrations 0001–0007 exact; event-backbone API 39; locked public API; production-only dist; no
 * control byte.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import type { RuntimeEvent, RuntimeObservabilityHook } from '../contracts/observability.js';
import { createAgentRuntime } from '../runtime/create-agent-runtime.js';
import { processInbound } from '../runtime/process-inbound.js';
import { createConversationContext } from '../contracts/conversation-context.js';
import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import { createDeterministicPrivacyGate } from '../testing/deterministic-privacy-gate.js';
import { contextInput, envelopeInput, syntheticPolicy } from '../testing/fixtures.js';

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

function recorder(): { hook: RuntimeObservabilityHook; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

describe('observability', () => {
  it('(24,25) emits content-free events with no message text, subject, or token', async () => {
    const { hook, events } = recorder();
    const runtime = createAgentRuntime({
      policy: syntheticPolicy(),
      privacyGate: createDeterministicPrivacyGate({ statuses: { 'subject.SECRET': 'clear' } }),
      observability: hook,
    });
    const context = createConversationContext(contextInput({ subjectRef: 'subject.SECRET' }));
    const envelope = createInboundEnvelope(
      envelopeInput({ normalizedText: 'SECRET-MESSAGE-BODY' }),
    );
    await processInbound(runtime, context, envelope);
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['SECRET-MESSAGE-BODY', 'subject.SECRET', 'wamid', 'sk-']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('(27,28,31) has no WhatsApp/n8n/provider/DB/network library and no P04 package import', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|axios|undici|whatsapp-web\.js|@whiskeysockets\/baileys)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"]@qf-jarvis\/(model-gateway|governed-knowledge|model-evaluation|rag-provisioning|event-backbone)['"]/,
      );
    }
  });

  it('(32,35) depends only on zod and exposes only the root and ./testing', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(32) locks the public API surface', () => {
    const EXPECTED = [
      'AI_AGENT_ACTORS',
      'AgentRuntimeError',
      'CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS',
      'CONVERSATION_STATES',
      'NOOP_RUNTIME_OBSERVABILITY',
      'PROPOSAL_AUTHORITY_STATUS',
      'RUNTIME_ACTORS',
      'RUNTIME_CHANNELS',
      'RUNTIME_DATA_CLASSES',
      'RUNTIME_DIRECTIONS',
      'RUNTIME_ERROR_CODES',
      'RUNTIME_EVENT_TYPES',
      'RUNTIME_EXECUTION_CLASSES',
      'RUNTIME_PARTY_TYPES',
      'RUNTIME_PROPOSAL_KINDS',
      'RUNTIME_REASONS',
      'RUNTIME_SUBJECT_STATUSES',
      'assertActorPartyCompatible',
      'assignAgent',
      'createAgentRuntime',
      'createConversationContext',
      'createInboundEnvelope',
      'createProposal',
      'createRuntimePolicy',
      'isActorPartyCompatible',
      'isValidConversationTransition',
      'processInbound',
      // M2 orchestration (ADR-0055).
      'ORCHESTRATION_PROPOSAL_KINDS',
      'CORE_DECISION_OUTCOMES',
      'ORCHESTRATION_REASONS',
      'ORCHESTRATION_EVENT_TYPES',
      'NOOP_ORCHESTRATION_OBSERVABILITY',
      'createOrchestrationContext',
      'createOrchestrationProposal',
      'coreDecision',
      'createReplyPlan',
      'validateReplyDraft',
      'createOrchestrator',
      'orchestrateInbound',
    ];
    expect(Object.keys(barrel).sort()).toEqual([...EXPECTED].sort());
    const b = barrel as Record<string, unknown>;
    expect(b['createDeterministicPrivacyGate']).toBeUndefined();
    expect(b['envelopeInput']).toBeUndefined();
  });

  it('(29,30) migrations 0001–0007 are byte-exact and there is no 0008', () => {
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

  it('(31) the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('(34) contains no NUL/control byte in production source', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });

  it('(ADR-0058 §5) uses no sync-over-async blocking primitive in production source', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/Atomics\s*\.\s*wait\b/);
      expect(text).not.toMatch(/\b(execSync|spawnSync|deasync)\b/);
      expect(text).not.toMatch(/from ['"]deasync['"]/);
    }
  });
});
