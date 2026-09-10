/**
 * JF-3 matrix items 19–27 — governed resolution and bounds (ADR-0148 §4, §5).
 *
 * Exact id and exact topic retrieval, and every way a bounded exact lookup is allowed to fail: a
 * missing id, a topic with no eligible current record, a topic conflict, and the two hard budgets.
 * Item 27 is the load-bearing one — resolution through this package is byte-identical to resolution
 * through the authority, so none of the rules above is being re-decided here.
 */
import { retrieveGovernedKnowledge } from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  activeProvisioner,
  digest,
  testBackend,
  testRecordInput,
  testRegistry,
  testRequest,
} from './knowledge-fixtures.js';

const RECORD = testRecordInput();
const BETA = testRecordInput({
  knowledgeId: 'kb.synthetic.beta',
  topic: 'synthetic-beta',
  content: 'SYNTHETIC TEST RECORD BETA. Invented for a spec; not business truth.',
  contentDigest: digest('b'),
});

describe('JF-3 governed resolution', () => {
  it('(JF3-19) exact ID retrieval works', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([RECORD, BETA])),
      testRequest({
        selectors: {
          ids: [
            { knowledgeId: RECORD.knowledgeId, version: 1 },
            { knowledgeId: BETA.knowledgeId, version: 1 },
          ],
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.records.map((r) => r.record.knowledgeId)).toEqual([
      RECORD.knowledgeId,
      BETA.knowledgeId,
    ]);
    expect(outcome.counters.retrievalCount).toBe(1);
  });

  it('(JF3-20) exact topic retrieval works', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([RECORD, BETA])),
      testRequest({ selectors: { topics: ['synthetic-beta', 'synthetic-alpha'] } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // Caller-ordered: the topics are passed through verbatim, and nothing here ranks or reorders them.
    expect(outcome.records.map((r) => r.record.topic)).toEqual([
      'synthetic-beta',
      'synthetic-alpha',
    ]);
  });

  it('(JF3-21) a missing exact ID fails the whole retrieval', () => {
    // Strict, not best-effort. A partial answer to an exact request is a quietly wrong answer: the
    // caller asked for three specific records and would be grounding on two without being told.
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([RECORD])),
      testRequest({
        selectors: {
          ids: [
            { knowledgeId: RECORD.knowledgeId, version: 1 },
            { knowledgeId: 'kb.synthetic.absent', version: 1 },
          ],
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe('rag-retrieval-refused');
    expect(outcome.knowledgeReason).toBe('knowledge-not-found');
  });

  it('(JF3-22) a topic with no eligible current record fails', () => {
    // Both shapes of "nothing eligible": a topic nobody ever published, and a topic whose only record
    // is not deliverable. Neither becomes an empty success.
    const absent = invokeRagRetrieval(
      activeProvisioner(),
      testRequest({ selectors: { topics: ['synthetic-absent'] } }),
    );
    expect((absent as { knowledgeReason?: string }).knowledgeReason).toBe('knowledge-not-found');

    const notActive = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({
            lifecycleState: 'REVIEWED',
            approvedBy: undefined,
            approvedAt: undefined,
          }),
        ]),
      ),
      testRequest(),
    );
    expect(notActive.ok).toBe(false);
    expect((notActive as { knowledgeReason?: string }).knowledgeReason).toBe('knowledge-not-found');
  });

  it('(JF3-23) a topic conflict fails rather than picking a winner', () => {
    // Two equally-authoritative current records for one topic. Choosing between them would be this
    // boundary inventing an authority ordering the business never declared.
    const conflicting = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          RECORD,
          testRecordInput({
            knowledgeId: 'kb.synthetic.alpha-rival',
            content: 'SYNTHETIC RIVAL RECORD. Invented for a spec; not business truth.',
            contentDigest: digest('c'),
          }),
        ]),
      ),
      testRequest(),
    );
    expect(conflicting.ok).toBe(false);
    expect((conflicting as { knowledgeReason?: string }).knowledgeReason).toBe(
      'knowledge-conflict',
    );
  });

  it('(JF3-24) exceeding maxRecords fails rather than truncating', () => {
    // Truncation is the tempting behaviour and the wrong one: the caller set a budget to bound what
    // reaches a model, and silently dropping the overflow answers a different question than asked.
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([RECORD, BETA])),
      testRequest({ maxRecords: 1, selectors: { topics: ['synthetic-alpha', 'synthetic-beta'] } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.knowledgeReason).toBe('knowledge-limit-exceeded');
    expect(outcome.counters.augmentedCharacterCount).toBe(0);
  });

  it('(JF3-25) exceeding maxContentChars fails rather than truncating', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([RECORD])),
      testRequest({ maxContentChars: 4 }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.knowledgeReason).toBe('knowledge-limit-exceeded');
    // Nothing partial came back: no truncated record, no elided content, no character count.
    expect(outcome).not.toHaveProperty('records');
    expect(outcome.counters.augmentedCharacterCount).toBe(0);
  });

  it('(JF3-26) a record selected twice is returned once', () => {
    // The authority de-duplicates by exact identity; this package neither re-duplicates it by
    // re-projecting the list nor counts the same content twice into the character budget.
    const outcome = invokeRagRetrieval(
      activeProvisioner(),
      testRequest({
        selectors: {
          ids: [
            { knowledgeId: RECORD.knowledgeId, version: 1 },
            { knowledgeId: RECORD.knowledgeId, version: 1 },
          ],
          topics: ['synthetic-alpha'],
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.records).toHaveLength(1);
    expect(outcome.counters.augmentedCharacterCount).toBe(RECORD.content.length);
  });

  it('(JF3-27) authority resolution is unchanged: identical results through both paths', () => {
    // The strongest statement this suite can make. If a rule ever starts being decided here instead
    // of in the authority, these two stop agreeing -- for a request nobody thought to enumerate.
    const registry = testRegistry([RECORD, BETA]);
    const provisioner = activeProvisioner(testBackend([RECORD, BETA]));
    for (const request of [
      testRequest(),
      testRequest({ selectors: { topics: ['synthetic-beta'] } }),
      testRequest({ selectors: { ids: [{ knowledgeId: BETA.knowledgeId, version: 1 }] } }),
      testRequest({ selectors: { topics: ['synthetic-absent'] } }),
      testRequest({ maxRecords: 1, selectors: { topics: ['synthetic-alpha', 'synthetic-beta'] } }),
      testRequest({ maxContentChars: 3 }),
      testRequest({ agentScope: 'VENDOR', purpose: 'VENDOR_RESPONSE' }),
      testRequest({ dataClass: 'HUMAN_ONLY' }),
    ]) {
      const direct = retrieveGovernedKnowledge(registry, request);
      const viaRag = invokeRagRetrieval(provisioner, request);
      expect(viaRag.ok).toBe(direct.ok);
      if (direct.ok && viaRag.ok) {
        expect(JSON.stringify(viaRag.records)).toBe(JSON.stringify(direct.records));
      } else if (!direct.ok && !viaRag.ok) {
        expect(viaRag.knowledgeReason).toBe(direct.reason);
      }
    }
  });
});
