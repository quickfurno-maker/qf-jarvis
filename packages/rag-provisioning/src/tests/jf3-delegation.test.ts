/**
 * JF-3 matrix items 13–18 — delegation to the knowledge authority (ADR-0148 §4).
 *
 * This package provisions access to an authority; it is not one. These pin that it calls the authority
 * exactly once per request, never a second time behind the caller's back, never with a request the
 * caller did not make — and that what comes back is passed through with its identity intact rather
 * than re-projected into a second, lossier account of the same records.
 */
import { retrieveGovernedKnowledge } from '@qf-jarvis/governed-knowledge';
import type { KnowledgeRetrievalRequest } from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  activeProvisioner,
  testBackend,
  testPack,
  testRecordInput,
  testRequest,
} from './knowledge-fixtures.js';

const RECORD = testRecordInput();

/** A backend that records every request it is handed, and otherwise delegates unchanged. */
function watching(): { backend: RagRetrievalBackend; seen: KnowledgeRetrievalRequest[] } {
  const seen: KnowledgeRetrievalRequest[] = [];
  const inner = testBackend();
  return {
    seen,
    backend: Object.freeze({
      backendKind: 'GOVERNED_EXACT' as const,
      knowledgeRevision: inner.knowledgeRevision,
      retrieve: (request: KnowledgeRetrievalRequest) => {
        seen.push(request);
        return inner.retrieve(request);
      },
    }),
  };
}

describe('JF-3 delegation', () => {
  it('(JF3-13) one RAG request calls governed retrieval exactly once', () => {
    const { backend, seen } = watching();
    const request = testRequest();
    const outcome = invokeRagRetrieval(activeProvisioner(backend), request);
    expect(outcome.ok).toBe(true);
    expect(seen).toHaveLength(1);
    // Exactly the request the caller made -- not a copy, not a normalised variant, not a widened one.
    expect(seen[0]).toBe(request);
  });

  it('(JF3-14) there is no second hidden retrieval, including when the first returns nothing', () => {
    // A bounded exact lookup that retries looser is a search. This is where that would start, and
    // it would arrive looking like a helpful improvement.
    const { backend, seen } = watching();
    const provisioner = activeProvisioner(backend);
    const missing = testRequest({ selectors: { topics: ['synthetic-absent'] } });
    expect(invokeRagRetrieval(provisioner, missing).ok).toBe(false);
    expect(seen).toHaveLength(1);

    invokeRagRetrieval(provisioner, testRequest());
    expect(seen).toHaveLength(2);
    // Two invocations, two authority calls. No caching, no pre-warming, no speculative second lookup.
    expect(seen[0]).toBe(missing);
  });

  it('(JF3-15) a backend throw maps to a bounded failure and never escapes', () => {
    const throwing: RagRetrievalBackend = Object.freeze({
      backendKind: 'GOVERNED_EXACT' as const,
      knowledgeRevision: testPack().knowledgeRevision,
      retrieve: (): never => {
        throw new Error('SYNTHETIC BACKEND FAILURE carrying pretend record content');
      },
    });
    const outcome = invokeRagRetrieval(activeProvisioner(throwing), testRequest());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe('rag-backend-failed');
    expect(outcome.counters.augmentedCharacterCount).toBe(0);
  });

  it('(JF3-16) no raw error text leaks into the outcome', () => {
    // The thrown value is never read, wrapped, logged or re-thrown: a throw from a retrieval boundary
    // is exactly the place where the content this boundary bounds would ride out in a message.
    const secretish = 'SYNTHETIC LEAK MARKER 0xdeadbeef pretend-customer-detail';
    const throwing: RagRetrievalBackend = Object.freeze({
      backendKind: 'GOVERNED_EXACT' as const,
      knowledgeRevision: testPack().knowledgeRevision,
      retrieve: (): never => {
        throw new Error(secretish);
      },
    });
    const outcome = invokeRagRetrieval(activeProvisioner(throwing), testRequest());
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('SYNTHETIC LEAK MARKER');
    expect(serialized).not.toContain('0xdeadbeef');
    expect(serialized).not.toContain('pretend-customer-detail');
    expect(Object.keys(outcome)).not.toContain('error');
    expect(Object.keys(outcome)).not.toContain('cause');
  });

  it('(JF3-17) citation identity survives delegation unchanged', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(),
      testRequest({ selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const citation = outcome.records[0]?.citation;
    expect(citation).toEqual({
      knowledgeId: RECORD.knowledgeId,
      version: RECORD.version,
      sourceRef: RECORD.sourceRef,
      sourceRevision: RECORD.sourceRevision,
      authorityTier: RECORD.authorityTier,
      effectiveFrom: RECORD.effectiveFrom,
      expiresAt: undefined,
      contentDigest: RECORD.contentDigest,
    });
  });

  it('(JF3-18) returned record identity survives delegation unchanged', () => {
    // Byte-identical to calling the authority directly. This package adds no field, drops none,
    // renames none and rewrites none -- so there is no second projection over the governed contract
    // in which those rules could quietly drift.
    const request = testRequest();
    const direct = retrieveGovernedKnowledge(testPack().registry, request);
    const viaRag = invokeRagRetrieval(activeProvisioner(), request);
    expect(viaRag.ok).toBe(true);
    expect(direct.ok).toBe(true);
    if (!viaRag.ok || !direct.ok) {
      return;
    }
    expect(viaRag.records).toEqual(direct.records);
    expect(JSON.stringify(viaRag.records)).toBe(JSON.stringify(direct.records));
  });
});
