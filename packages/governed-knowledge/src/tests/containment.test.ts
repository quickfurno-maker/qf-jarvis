/**
 * QFJ-P04.03 — authority/integration boundaries and containment (ADR-0051 §N, §O, §P).
 *
 * Matrix items 58–76: knowledge grants no business authority; agent scopes stay distinct; the
 * Conversation Operations Center is documented-mandatory but absent; no provider/RAG/DB/secret/n8n
 * dependency; the public API is locked; migrations 0001–0009 are exact with no 0010; the event-backbone
 * root API remains 39; and no tracked source carries a control byte.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import { createGovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';
import { createRetrievalRequest } from '../contracts/retrieval-request.js';
import { retrieveGovernedKnowledge } from '../retrieval/retrieve-governed-knowledge.js';
import { KNOWLEDGE_AGENT_SCOPES } from '../contracts/vocabularies.js';
import { createKnowledgeRecord } from '../contracts/knowledge-record.js';
import { recordInput, requestInput } from './fixtures.js';

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

// A control-byte matcher built from an escaped string, so this source stays control-byte free.
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
    '1927f32aff3b3b42a987fe6ff0c53f1caa2403040377c3effbba88817a1d2257',
};

describe('authority and integration boundaries', () => {
  it('(58,59) grants no business authority — no authorize/execute/tool/n8n method', () => {
    const registry = createGovernedKnowledgeRegistry([recordInput()]) as unknown as Record<
      string,
      unknown
    >;
    for (const method of ['authorize', 'execute', 'invoke', 'run', 'mutate', 'send', 'callN8n']) {
      expect(registry[method]).toBeUndefined();
    }
    const result = retrieveGovernedKnowledge(
      createGovernedKnowledgeRegistry([recordInput()]),
      createRetrievalRequest(
        requestInput({ selectors: { ids: [{ knowledgeId: 'kb.policy.sla', version: 1 }] } }),
      ),
    );
    if (result.ok) {
      const entry = result.records[0] as unknown as Record<string, unknown>;
      expect(entry['authorize']).toBeUndefined();
      expect(entry['execute']).toBeUndefined();
    }
  });

  it('(61) keeps the agent scopes distinct (Riya CLIENT / Anisha VENDOR / Jarvis COORDINATION)', () => {
    expect([...KNOWLEDGE_AGENT_SCOPES]).toEqual(['CLIENT', 'VENDOR', 'COORDINATION', 'SYSTEM']);
    expect(new Set(KNOWLEDGE_AGENT_SCOPES).size).toBe(KNOWLEDGE_AGENT_SCOPES.length);
  });

  it('(62) documents the Conversation Operations Center as mandatory-later but implements none of it', () => {
    const adr = readRepo('docs/decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md');
    expect(adr).toMatch(/Conversation Operations Center/);
    expect(adr).toMatch(/mandatory later phase/i);
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      expect(text).not.toContain('whatsapp');
      expect(text).not.toContain('dashboard');
    }
  });

  it('(64) fabricates no evaluation approval — a record has no boolean `approved` field', () => {
    const record = createKnowledgeRecord(recordInput()) as unknown as Record<string, unknown>;
    expect('approved' in record).toBe(false);
    expect(record['approved']).toBeUndefined();
  });

  it('(63,65,71,72) has no provider/RAG/model/network/n8n/agent term in production source', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|axios|undici)['"]/,
      );
      expect(text).not.toMatch(/embedding|vector|semantic search|cosine|\bRAG\b/i);
      expect(text).not.toMatch(/\bn8n\b|kimi/i);
    }
  });
});

describe('containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  it('(63) depends only on zod', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
  });

  it('(74) exposes only the root and the ./testing subpath', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(66,73) does not export mutable internals or the test gate from the root barrel', () => {
    const b = barrel as Record<string, unknown>;
    expect(b['createDeterministicPrivacyGate']).toBeUndefined();
    expect(b['resolveTopic']).toBeUndefined();
    expect(b['recordEligibility']).toBeUndefined();
  });

  it('(73) locks the public API surface', () => {
    const EXPECTED = [
      'GLOBAL_TENANT',
      'GovernedKnowledgeError',
      'KNOWLEDGE_AGENT_SCOPES',
      'KNOWLEDGE_AUTHORITY_TIERS',
      'KNOWLEDGE_CONTENT_FORMATS',
      'KNOWLEDGE_DATA_CLASSES',
      'KNOWLEDGE_ERROR_CODES',
      'KNOWLEDGE_LIFECYCLE_STATES',
      'KNOWLEDGE_LIFECYCLE_TRANSITIONS',
      'KNOWLEDGE_PURPOSES',
      'KNOWLEDGE_RETRIEVAL_REASONS',
      'KNOWLEDGE_SOURCE_TYPES',
      'KNOWLEDGE_SUBJECT_STATUSES',
      'MAX_RECORD_CONTENT_CHARS',
      'MAX_REQUEST_SELECTORS',
      'NOOP_KNOWLEDGE_OBSERVABILITY',
      'VOLATILE_SOURCE_TYPES',
      'auditLookup',
      'authorityRank',
      'createGovernedKnowledgeRegistry',
      'createKnowledgeRecord',
      'createRetrievalRequest',
      'dataClassRank',
      'isValidLifecycleTransition',
      'recordIdentityKey',
      'retrieveGovernedKnowledge',
    ];
    expect(Object.keys(barrel).sort()).toEqual(EXPECTED);
  });

  it('(67,68) migrations 0001–0009 are byte-exact and there is no 0010', () => {
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
    expect(sql.some((n) => n.startsWith('0010'))).toBe(false);
  });

  it('(69) the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('(76) contains no NUL/control byte in production source', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
