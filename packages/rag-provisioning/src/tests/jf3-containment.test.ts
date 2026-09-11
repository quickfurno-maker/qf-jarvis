/**
 * JF-3 matrix items 45–58 — containment (ADR-0148 §11).
 *
 * ACTIVE retrieval is the one thing JF-3 turned on. These pin everything it did NOT turn on, by
 * scanning this package's production source rather than by asserting intent in prose.
 *
 * Items 54–57 name the regression suites that must stay green — the RWC-P7 grounded path, JF-1
 * training-offline containment, JF-2A provider identity, JF-2B activation. Those are proven by RUNNING
 * them, and their exit codes belong in the lane report; what is checked here is narrower and still
 * worth having: that JF-3 did not delete, move or hollow out the locks they depend on.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
/** Production source only: `src/tests` is excluded from the emitting build and from every scan. */
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

describe('JF-3 containment', () => {
  it('(JF3-45,46) contains no embedding and no vector implementation', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      // Any call site, not just an import: an embedding written by hand is still an embedding.
      expect(text).not.toMatch(/\b(embed|embedding|embedText|toVector|vectorize)\s*\(/i);
      expect(text).not.toMatch(/\b(cosine|dotProduct|euclidean|knn|nearestNeighbou?r|hnsw)\b/i);
      expect(text).not.toMatch(/\b(topK|rerank|similarityScore|ann_?search)\b/i);
      expect(text).not.toMatch(/\bpgvector\b|<->|<=>/);
      expect(text).not.toMatch(
        /from ['"](pinecone|@pinecone-database\/pinecone|weaviate-ts-client|@qdrant\/js-client-rest|qdrant|chromadb|milvus|@zilliz\/milvus2-sdk-node|faiss-node|hnswlib-node|@xenova\/transformers|onnxruntime-node|langchain|llamaindex)['"]/,
      );
    }
  });

  it('(JF3-47) makes no model or provider call', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(
        /from ['"](openai|groq-sdk|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|replicate)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"]@qf-jarvis\/(model-gateway|model-gateway-composition)['"]/,
      );
      expect(text).not.toMatch(
        /\b(chatCompletion|createCompletion|invokeModel|generateText)\s*\(/i,
      );
      // A key or endpoint would be the tell even if the call itself were somewhere else.
      expect(text).not.toMatch(/\bsk-[A-Za-z0-9]/);
      expect(text).not.toMatch(/https?:\/\/(?!github\.com)/);
    }
  });

  it('(JF3-48) has no network client and no ambient environment read', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/);
      expect(text).not.toMatch(/from ['"](axios|undici|node-fetch|got|superagent|ws)['"]/);
      // `node:crypto` is permitted in ONE file for deterministic content identity; the ADR-0053
      // containment spec pins exactly which. Everything else here is unchanged.
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|worker_threads)['"]/,
      );
      // Spelled indirectly on purpose in production source; here it is the literal being banned.
      expect(text).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('(JF3-49,50) imports nothing from QuickFurno or OneDecore, and names no database of theirs', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text.toLowerCase()).not.toContain('quickfurno');
      expect(text.toLowerCase()).not.toContain('onedecore');
      expect(text).not.toMatch(
        /from ['"](pg|postgres|drizzle-orm|prisma|@supabase\/supabase-js)['"]/,
      );
      expect(text).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\s+.*\bFROM\b/);
    }
  });

  it('(JF3-51) imports nothing from the offline training or evaluation side', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(
        /from ['"]@qf-jarvis\/(model-evaluation|riya-ai-synthetic-generation|riya-ai-synthetic-provider-adapters|riya-candidate-evaluation-runner|dataset)[^'"]*['"]/,
      );
      expect(text).not.toMatch(
        /\b(fineTune|trainModel|buildDataset|ingestCorpus|autoIngest)\s*\(/i,
      );
    }
  });

  it('(JF3-52,53) changes no model gateway and no Mastra production path', () => {
    // Structural, not aspirational: no production file here reaches either, so nothing JF-3 did can
    // reach them. The gateway and the orchestration boundary are separate lanes with their own gates.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from ['"]@qf-jarvis\/model-gateway/);
      expect(text).not.toMatch(/from ['"]@mastra\//);
      expect(text.toLowerCase()).not.toContain('mastra');
    }
    // And this package is not reachable FROM the runtime side either: the packages that would
    // compose it keep their own bans, which JF-3 did not touch.
    for (const guard of [
      'packages/agent-runtime/src/tests/containment.test.ts',
      'packages/core-decision-adapter/src/tests/containment.test.ts',
      'packages/model-reply-adapter/src/tests/containment.test.ts',
    ]) {
      expect(readRepo(guard)).toContain('rag-provisioning');
    }
  });

  it('(JF3-54,55,56,57) leaves the regression locks it depends on in place', () => {
    // These suites are proven by RUNNING them; what is checked here is that JF-3 did not quietly
    // remove or hollow out the locks whose green is being claimed.
    //
    // RWC-P7 (ADR-0103): the Riya grounded-knowledge bridge, which is the OTHER consumer of the same
    // authority. JF-3 built a separate provisioning boundary and changed nothing about that path.
    const bridge = readRepo('packages/jarvis-runtime/src/composition/riya-grounded-knowledge.ts');
    expect(bridge).toContain('MAX_RIYA_GROUNDED_RECORDS');
    expect(bridge).toContain('retrieveGovernedKnowledge');

    // JF-1 (ADR-0145): training stays offline.
    const trainingOffline = readRepo(
      'packages/contracts/src/tests/training-offline-containment.test.ts',
    );
    expect(trainingOffline).toContain('OFFLINE_ONLY_PACKAGES');
    expect(trainingOffline).toContain('PRODUCTION_RUNTIME_PACKAGES');

    // JF-2A (ADR-0146): canonical hosted provider identity.
    const identity = readRepo('packages/model-gateway/src/contracts/provider-identity.ts');
    expect(identity).toContain('GROQ_CANONICAL_PROVIDER_ID');
    expect(identity).toContain('NARA_CANONICAL_PROVIDER_ID');

    // JF-2B (ADR-0147): the evidence gate on production activation.
    const production = readRepo(
      'packages/model-gateway-composition/src/create-production-model-gateway.ts',
    );
    expect(production).toContain('verifyServingProvider');
  });

  it('(JF3-58) adds no migration: 0001-0014 stand and there is no 0015', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(14);
    expect(sql[0]).toBe('0001_event_log.sql');
    expect(sql[12]).toBe('0013_communication_state_projection.sql');
    expect(sql.some((n) => n.startsWith('0015'))).toBe(false);
    // And this package still owns no schema of its own, in any form.
    for (const file of productionFiles()) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/CREATE\s+(TABLE|INDEX|SCHEMA)/i);
    }
  });
});
