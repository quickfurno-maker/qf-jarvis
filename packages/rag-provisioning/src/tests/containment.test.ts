/**
 * QFJ-P04.05 — authority boundaries and containment (ADR-0053 §K, §L).
 *
 * Matrix items 26–38: Core authority / scope separation preserved; Conversation Operations Center
 * documented-mandatory but absent; no RAG/embedding/vector/network implementation; P04.03/P04.04
 * untouched; no DB and no migration of its own; migrations exact; event-backbone API 39; public API locked; dist
 * production-only; no control byte.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import { RAG_DATA_CLASSES, RUNTIME_ELIGIBLE_BACKEND } from '../contracts/vocabularies.js';

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
  '0011_riya_conversation_continuity.sql':
    '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
};

describe('authority and Conversation Operations boundary', () => {
  it('(26) preserves the standard data-class lattice and only NONE is runtime-eligible', () => {
    expect([...RAG_DATA_CLASSES]).toEqual(['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY']);
    expect(RUNTIME_ELIGIBLE_BACKEND).toBe('NONE');
  });

  it('(27) documents the Conversation Operations Center as mandatory-later but implements none of it', () => {
    const adr = readRepo('docs/decisions/ADR-0053-qfj-p04-05-no-op-rag-provisioning.md');
    expect(adr).toMatch(/Conversation Operations Center/);
    expect(adr).toMatch(/mandatory later phase/i);
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      expect(text).not.toContain('whatsapp');
      expect(text).not.toContain('dashboard');
    }
  });
});

describe('containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('(30,31,35) has no retrieval/embedding/vector/network library, no P04.03/P04.04 import, no n8n/agent', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|pinecone|weaviate|qdrant|chroma|faiss|hnswlib|langchain|@xenova\/transformers|onnxruntime-node|axios|undici)['"]/,
      );
      expect(text).not.toMatch(/from ['"]@qf-jarvis\/(governed-knowledge|model-evaluation)['"]/);
      expect(text).not.toMatch(/\bn8n\b|kimi|semantic search|cosine/i);
    }
  });

  it('(35,36) depends only on zod and exposes only the root and ./testing', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(36) locks the public API surface', () => {
    const EXPECTED = [
      'NOOP_RAG_OBSERVABILITY',
      'RAG_BACKEND_KINDS',
      'RAG_DATA_CLASSES',
      'RAG_ERROR_CODES',
      'RAG_PROVISIONING_MODES',
      'RAG_REASONS',
      'RAG_TASK_CLASSES',
      'RUNTIME_ELIGIBLE_BACKEND',
      'RagProvisioningError',
      'createRagProvisioner',
      'createRagProvisioningProfile',
      'createRagRequestMetadata',
      'invokeNoOpRag',
    ];
    expect(Object.keys(barrel).sort()).toEqual(EXPECTED);
    const b = barrel as Record<string, unknown>;
    expect(b['disabledProfileInput']).toBeUndefined();
    expect(b['tryCreateRagProvisioningProfile']).toBeUndefined();
  });

  it('(32,33) migrations 0001–0011 are byte-exact and there is no 0012', () => {
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
    expect(sql.some((n) => n.startsWith('0012'))).toBe(false);
  });

  it('(34) the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('(38) contains no NUL/control byte in production source', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
