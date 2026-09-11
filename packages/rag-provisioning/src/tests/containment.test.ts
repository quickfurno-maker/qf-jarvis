/**
 * QFJ-P04.05 — authority boundaries and containment (ADR-0053 §K, §L).
 *
 * Matrix items 26–38: Core authority / scope separation preserved; Conversation Operations Center
 * documented-mandatory but absent; no embedding/vector/similarity/network implementation; no DB and no
 * migration of its own; migrations exact; public API locked; dist production-only; no control byte.
 *
 * ### What JF-3 (ADR-0148) changed here, and what it did NOT
 *
 * ADR-0053 banned `@qf-jarvis/governed-knowledge` from this package outright, because a boundary that
 * could not retrieve had no business reaching the knowledge authority. ACTIVE retrieval delegates to
 * that authority by design, so the ban is REPLACED rather than dropped: the import is permitted in an
 * EXACT allowlist of three files and refused everywhere else, and `@qf-jarvis/model-evaluation` stays
 * banned without exception. Every embedding/vector/similarity/network/filesystem/env ban is untouched
 * and still applies to every production file, ACTIVE path included.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import {
  ACTIVE_ELIGIBLE_BACKEND,
  RAG_DATA_CLASSES,
  RUNTIME_ELIGIBLE_BACKEND,
} from '../contracts/vocabularies.js';

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
  // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
  // BELOW the ingress transport replay guard rather than replacing it. Repository and
  // LOCAL/CI only; nothing is applied to a managed database.
  '0012_riya_logical_turn_idempotency.sql':
    '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
  '0013_communication_state_projection.sql':
    '4f533fb60ea96bedd11bf2f5b3177376517c07633d3b7e71e0341b43c1a72919',
  '0014_conversation_prospect_party_type.sql':
    '572ba13764cffed600d8580e00b781502ddc85c19126e3621d0a8127e5dc536e',
};

describe('authority and Conversation Operations boundary', () => {
  it('(26) preserves the standard data-class lattice and pins both eligible backends', () => {
    expect([...RAG_DATA_CLASSES]).toEqual(['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY']);
    // The no-op path still pairs with NONE, byte-for-byte as ADR-0053 fixed it.
    expect(RUNTIME_ELIGIBLE_BACKEND).toBe('NONE');
    // ACTIVE admits exactly ONE backend kind, and it is the deterministic exact one. The FUTURE_*
    // vector placeholders remain placeholders: JF-3 built no vector retrieval of any kind.
    expect(ACTIVE_ELIGIBLE_BACKEND).toBe('GOVERNED_EXACT');
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

  it('(30,31,35) has no embedding/vector/similarity/network library, no n8n/agent, no env/fs/crypto', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(/from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process)['"]/);
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|pinecone|weaviate|qdrant|chroma|faiss|hnswlib|langchain|@xenova\/transformers|onnxruntime-node|axios|undici)['"]/,
      );
      // The P04.04 evaluation authority stays banned WITHOUT exception: nothing in a retrieval
      // boundary should be able to read, produce or consult evaluation evidence.
      expect(text).not.toMatch(/from ['"]@qf-jarvis\/model-evaluation['"]/);
      expect(text).not.toMatch(/\bn8n\b|kimi|semantic search|cosine/i);
      // JF-3 restated: ACTIVE mode introduced no similarity, ranking or free-text retrieval.
      expect(text).not.toMatch(/\b(embedding|embed|vectorStore|similarity|rerank|topK)\s*\(/i);
    }
  });

  it('(30) permits node:crypto in ONE file, for deterministic content identity only', () => {
    // ADR-0053 banned it outright, correctly: a boundary that did nothing had no digest to compute.
    // The JF-3 owner correction derives the knowledge revision from the records it names, and that
    // needs a hash. The ban is NARROWED rather than dropped -- one file, named exactly -- and every
    // network, filesystem, environment and process ban above is untouched.
    //
    // What the hash is: a local, synchronous content identity. It is not a signature, it reaches no
    // network, it reads no key, and it proves nothing about who authored the records.
    const pkgRoot = fileURLToPath(PKG_DIR).replace(/\\/g, '/');
    const importers = productionFiles()
      .filter((f) => /from ['"]node:crypto['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/\\/g, '/').replace(pkgRoot, ''))
      .sort();
    expect(importers).toEqual(['src/service/create-revision-bound-knowledge-pack.ts']);

    // And in that one file it is a hash and nothing else: no cipher, no key material, no randomness
    // that would make a revision non-deterministic.
    const text = readRepo(
      'packages/rag-provisioning/src/service/create-revision-bound-knowledge-pack.ts',
    );
    expect(text).toContain("import { createHash } from 'node:crypto'");
    for (const forbidden of [
      'createCipheriv',
      'createDecipheriv',
      'createSign',
      'createVerify',
      'generateKeyPair',
      'randomBytes',
      'randomUUID',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('(30,35) permits the governed-knowledge authority in an EXACT allowlist of files only', () => {
    // ACTIVE retrieval delegates to the knowledge authority -- that is the whole design, and hiding
    // it behind a re-export would only make the dependency harder to see. What must NOT happen is
    // the import spreading: a vocabulary file or the no-op path reaching the authority would mean a
    // second place where retrieval could start, on a path nobody reviewed for it.
    const ALLOWED = [
      'src/contracts/observability.ts',
      'src/contracts/retrieval-backend.ts',
      'src/contracts/retrieval-outcome.ts',
      'src/contracts/revision-bound-knowledge-pack.ts',
      'src/knowledge-pack/production-knowledge-pack.ts',
      'src/service/create-revision-bound-knowledge-pack.ts',
      'src/service/governed-exact-backend.ts',
      'src/service/invoke-rag-retrieval.ts',
    ];
    const pkgRoot = fileURLToPath(PKG_DIR).replace(/\\/g, '/');
    const importers = productionFiles()
      .filter((f) => /from ['"]@qf-jarvis\/governed-knowledge['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/\\/g, '/').replace(pkgRoot, ''))
      .sort();
    expect(importers).toEqual(ALLOWED);
  });

  it('(35,36) depends only on zod and the knowledge authority, and exposes two subpaths', () => {
    // EXACT set match. JF-3 records ONE authorized addition -- the governed-knowledge authority that
    // ACTIVE retrieval delegates to -- and does not relax the assertion. There is still no provider
    // SDK, no HTTP client, no database driver, and no vector or embedding library.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/governed-knowledge',
      'zod',
    ]);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(36) locks the public API surface', () => {
    const EXPECTED = [
      'ACTIVE_ELIGIBLE_BACKEND',
      'MISSING_PRODUCTION_KNOWLEDGE',
      'NOOP_RAG_OBSERVABILITY',
      'PRODUCTION_KNOWLEDGE_PACK_LABEL',
      'PRODUCTION_KNOWLEDGE_PACK_MANIFEST',
      'PRODUCTION_KNOWLEDGE_PACK_REVISION',
      'PRODUCTION_KNOWLEDGE_RECORDS',
      'RAG_BACKEND_KINDS',
      'RAG_DATA_CLASSES',
      'RAG_ERROR_CODES',
      'RAG_PROVISIONING_MODES',
      'RAG_REASONS',
      'RAG_TASK_CLASSES',
      'RUNTIME_ELIGIBLE_BACKEND',
      'RagProvisioningError',
      'createGovernedExactBackend',
      'createProductionRagBackend',
      'createRagProvisioner',
      'createRagProvisioningProfile',
      'createRagRequestMetadata',
      'createRevisionBoundKnowledgePack',
      'invokeNoOpRag',
      'invokeRagRetrieval',
      'productionKnowledgePack',
    ];
    expect(Object.keys(barrel).sort()).toEqual(EXPECTED);
    const b = barrel as Record<string, unknown>;
    expect(b['disabledProfileInput']).toBeUndefined();
    expect(b['tryCreateRagProvisioningProfile']).toBeUndefined();
    // The barrel exports no re-export of the knowledge authority: a caller that wants governed
    // records asks the authority for them, rather than reaching them through a RAG boundary that
    // would then be a second, unreviewed door onto the same store.
    for (const leaked of [
      'retrieveGovernedKnowledge',
      'createGovernedKnowledgeRegistry',
      'createRetrievalRequest',
      'createKnowledgeRecord',
      'auditLookup',
    ]) {
      expect(b[leaked]).toBeUndefined();
    }
    // JF-3 owner correction: no exported helper pairs an arbitrary registry with an arbitrary
    // revision. A revision is only ever DERIVED, and the removed helpers are named here so that
    // restoring one would fail this lock rather than quietly reopening the substitution.
    for (const removed of [
      'createProductionKnowledgeRegistry',
      'createKnowledgeRevision',
      'labelRegistry',
      'bindRevision',
    ]) {
      expect(b[removed]).toBeUndefined();
    }
  });

  it('(32,33) migrations 0001–0014 are byte-exact and there is no 0015', () => {
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
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((n) => n.startsWith('0015'))).toBe(false);
  });

  it('(34) the event-backbone public-api lock remains 38', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(38)',
    );
  });

  it('(38) contains no NUL/control byte in production source', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
