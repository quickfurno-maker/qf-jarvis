/**
 * JF-3 matrix items 28–35 — lifecycle, freshness and subject privacy (ADR-0148 §5, §6).
 *
 * These are the rules that decide whether a record may reach a model at all, and every one of them
 * belongs to `@qf-jarvis/governed-knowledge`. What is pinned here is that the RAG boundary does not
 * weaken, bypass, retry around or paper over any of them — including the one that matters most in
 * practice, which is that a stale answer is never quietly substituted for a refused one.
 */
import { createDeterministicPrivacyGate } from '@qf-jarvis/governed-knowledge/testing';
import { describe, expect, it } from 'vitest';

import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  activeProvisioner,
  digest,
  testBackend,
  testPack,
  testRecordInput,
  testRequest,
} from './knowledge-fixtures.js';

const RECORD = testRecordInput();

/** The exact-id request, which is the path on which the authority reports its specific reason. */
function byId(knowledgeId = RECORD.knowledgeId, version = 1) {
  return testRequest({ selectors: { ids: [{ knowledgeId, version }] } });
}

function reasonOf(outcome: { ok: boolean }): string | undefined {
  return (outcome as { knowledgeReason?: string }).knowledgeReason;
}

describe('JF-3 lifecycle and privacy', () => {
  it('(JF3-28) a not-yet-effective record refuses', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(testBackend([testRecordInput({ effectiveFrom: '2026-06-01T00:00:00Z' })])),
      byId(),
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toBe('knowledge-not-effective');
  });

  it('(JF3-29) an expired record refuses', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({ sourceType: 'PACKAGE_REFERENCE', expiresAt: '2026-01-15T00:00:00Z' }),
        ]),
      ),
      byId(),
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toBe('knowledge-expired');
  });

  it('(JF3-30) a superseded record refuses', () => {
    const outcome = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({
            supersededBy: { knowledgeId: RECORD.knowledgeId, version: 2 },
            lifecycleState: 'RETIRED',
          }),
          testRecordInput({
            version: 2,
            content: 'SYNTHETIC TEST RECORD ALPHA v2. Invented for a spec; not business truth.',
            contentDigest: digest('d'),
          }),
        ]),
      ),
      byId(),
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toBe('knowledge-superseded');
  });

  it('(JF3-31) an erased or tombstoned subject refuses', () => {
    for (const status of ['erased', 'tombstoned', 'anonymised', 'in-progress'] as const) {
      const backend = createGovernedExactBackend({
        pack: testPack([
          testRecordInput({ subjectRef: 'subject.test.1', classification: 'LOCAL_ONLY' }),
        ]),
        privacyGate: createDeterministicPrivacyGate({
          statuses: { 'subject.test.1': status },
        }),
      });
      const outcome = invokeRagRetrieval(
        activeProvisioner(backend),
        testRequest({
          dataClass: 'LOCAL_ONLY',
          selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] },
        }),
      );
      expect(outcome.ok).toBe(false);
      expect(reasonOf(outcome)).toBe('knowledge-subject-erased');
    }
  });

  it('(JF3-32) a subject-linked record with no privacy gate refuses', () => {
    // No gate is invented here to "make retrieval work". The gate is missing precisely when nobody
    // decided who may see the subject, and answering that question is not this package's to answer.
    const outcome = invokeRagRetrieval(
      activeProvisioner(
        testBackend([
          testRecordInput({ subjectRef: 'subject.test.1', classification: 'LOCAL_ONLY' }),
        ]),
      ),
      testRequest({
        dataClass: 'LOCAL_ONLY',
        selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toBe('knowledge-privacy-gate-missing');
  });

  it('(JF3-33) a gate that clears a DIFFERENT subject does not authorize this one', () => {
    // A gate is not a flag saying "privacy was considered". It answers about one subject, and a
    // clearance for somebody else is not a clearance.
    const backend = createGovernedExactBackend({
      pack: testPack([
        testRecordInput({ subjectRef: 'subject.test.2', classification: 'LOCAL_ONLY' }),
      ]),
      privacyGate: createDeterministicPrivacyGate({
        statuses: { 'subject.test.1': 'clear' },
        defaultStatus: 'erased',
      }),
    });
    const outcome = invokeRagRetrieval(
      activeProvisioner(backend),
      testRequest({
        dataClass: 'LOCAL_ONLY',
        selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toBe('knowledge-subject-erased');
  });

  it('(JF3-34) HUMAN_ONLY and the data-class lattice still hold', () => {
    // HUMAN_ONLY is never delivered to a model, at any request class -- including a request that
    // declares itself HUMAN_ONLY, which is the loophole a rank comparison alone would leave open.
    for (const dataClass of ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const) {
      const outcome = invokeRagRetrieval(
        activeProvisioner(testBackend([testRecordInput({ classification: 'HUMAN_ONLY' })])),
        testRequest({
          dataClass,
          selectors: { ids: [{ knowledgeId: RECORD.knowledgeId, version: 1 }] },
        }),
      );
      expect(outcome.ok).toBe(false);
      expect(reasonOf(outcome)).toBe('knowledge-data-class-denied');
    }
    // And a LOCAL_ONLY record is not delivered to a HOSTED_ALLOWED request.
    const leaky = invokeRagRetrieval(
      activeProvisioner(testBackend([testRecordInput({ classification: 'LOCAL_ONLY' })])),
      byId(),
    );
    expect(leaky.ok).toBe(false);
    expect(reasonOf(leaky)).toBe('knowledge-data-class-denied');
  });

  it('(JF3-35) there is no stale fallback: an ineligible current record does not yield an older one', () => {
    // The failure this prevents is the most seductive one in the whole lane. The newest record is
    // expired, an older version exists and reads fine, and returning it looks like graceful
    // degradation -- while actually telling a customer something the business has withdrawn.
    const backend = testBackend([
      testRecordInput({
        version: 1,
        supersededBy: { knowledgeId: RECORD.knowledgeId, version: 2 },
        lifecycleState: 'RETIRED',
        content: 'SYNTHETIC WITHDRAWN RECORD. Invented for a spec; not business truth.',
        contentDigest: digest('e'),
      }),
      testRecordInput({
        version: 2,
        sourceType: 'PACKAGE_REFERENCE',
        expiresAt: '2026-01-15T00:00:00Z',
        content: 'SYNTHETIC EXPIRED CURRENT RECORD. Invented for a spec; not business truth.',
        contentDigest: digest('f'),
      }),
    ]);
    const provisioner = activeProvisioner(backend);

    // By topic: the current record is expired, the older one is superseded, and the answer is a
    // refusal rather than the withdrawn text.
    const byTopic = invokeRagRetrieval(provisioner, testRequest());
    expect(byTopic.ok).toBe(false);
    expect(reasonOf(byTopic)).toBe('knowledge-not-found');

    // By exact id of the expired current version: still a refusal, not a silent downgrade to v1.
    const current = invokeRagRetrieval(provisioner, byId(RECORD.knowledgeId, 2));
    expect(current.ok).toBe(false);
    expect(reasonOf(current)).toBe('knowledge-expired');
    expect(JSON.stringify(current)).not.toContain('WITHDRAWN');
  });
});
