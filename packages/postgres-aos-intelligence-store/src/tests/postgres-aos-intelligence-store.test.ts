import { readFileSync } from 'node:fs';

import { digestAosBehaviourRegistry } from '@qf-jarvis/aos-behaviour-control';
import {
  buildAosEvidencePacket,
  createAosCase,
  createAosCaseContextMemory,
  createAosRecommendation,
  createAosSignal,
  createAosBehaviourManifest,
  createAosBehaviourPolicy,
  createAosBehaviourRegistry,
  type AosOutcomeRecord,
} from '@qf-jarvis/aos-intelligence';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import { AosStoreConflictError, createPostgresAosIntelligenceStore } from '../index.js';

const at = '2026-10-01T07:30:00.000Z';

function aosCase() {
  return createAosCase('case.store-test', [
    createAosSignal({
      signalId: 'signal.store-test',
      detectorId: 'detector.store-test',
      detectorType: 'SLA',
      caseKey: 'lead-store-test.first-contact',
      subjectRef: 'lead:store-test',
      priority: 'P1',
      score: 0.9,
      observedAt: at,
      evidenceRefs: ['core:event:store-test'],
      reasonCode: 'FIRST_CONTACT_GAP',
    }),
  ]);
}

function recommendation() {
  const oneCase = aosCase();
  const packet = buildAosEvidencePacket({
    case: oneCase,
    generatedAt: at,
    policyRefs: ['policy:store-test'],
    facts: [
      {
        factId: 'fact:elapsed',
        kind: 'METRIC',
        dataClass: 'OPERATIONAL',
        sourceRef: 'metric:elapsed',
        observedAt: at,
        value: 35,
      },
    ],
  });
  return createAosRecommendation(packet, {
    recommendationId: 'recommendation.store-test',
    action: 'REQUEST_REPLACEMENT_BATCH',
    confidence: 0.95,
    rationale: 'Replacement review is appropriate after the governed contact window.',
    evidenceRefs: ['fact:elapsed'],
    policyRefs: ['policy:store-test'],
    requiresOwnerReview: true,
  });
}

interface FakePoolState {
  readonly queries: { readonly text: string; readonly values?: readonly unknown[] }[];
  readonly recommendationDigests: Map<string, string>;
  readonly caseContextDigests: Map<string, string>;
}

function result<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: 'TEST',
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

function fakePool(state: FakePoolState): Pool {
  const pool = {
    async query(text: string, values?: readonly unknown[]) {
      await Promise.resolve();
      state.queries.push({ text, ...(values === undefined ? {} : { values }) });
      if (text.includes('INSERT INTO qf_jarvis_aos.case_context_memory')) {
        const key = String(values?.[0]) + '@' + String(values?.[2]);
        const oneDigest = String(values?.[5]);
        if (state.caseContextDigests.has(key)) return result([], 0);
        state.caseContextDigests.set(key, oneDigest);
        return result([], 1);
      }
      if (text.includes('SELECT memory_digest AS digest')) {
        const key = String(values?.[0]) + '@' + String(values?.[1]);
        const oneDigest = state.caseContextDigests.get(key);
        return result(oneDigest === undefined ? [] : [{ digest: oneDigest }]);
      }
      if (text.includes('INSERT INTO qf_jarvis_aos.recommendation')) {
        const id = String(values?.[0]);
        const oneDigest = String(values?.[6]);
        if (state.recommendationDigests.has(id)) return result([], 0);
        state.recommendationDigests.set(id, oneDigest);
        return result([], 1);
      }
      if (text.includes('SELECT recommendation_digest AS digest')) {
        const id = String(values?.[0]);
        const oneDigest = state.recommendationDigests.get(id);
        return result(oneDigest === undefined ? [] : [{ digest: oneDigest }]);
      }
      if (text.includes('INSERT INTO qf_jarvis_aos.case_snapshot')) {
        return result([], 1);
      }
      if (text.includes('INSERT INTO qf_jarvis_aos.outcome_observation')) {
        return result([], 1);
      }
      if (text.includes('INSERT INTO qf_jarvis_aos.behaviour_manifest')) {
        return result([], 1);
      }
      if (text.includes('FROM qf_jarvis_aos.outcome_observation')) {
        const record: AosOutcomeRecord = {
          caseId: 'case.store-test',
          recommendationId: 'recommendation.store-test',
          ownerDecision: 'APPROVE',
          outcome: 'RECOVERED',
          policyViolation: false,
          unsupportedReasoning: false,
        };
        return result([{ outcome_json: record, false_positive: false }]);
      }
      throw new Error('unexpected-query:' + text);
    },
  };
  return pool as unknown as Pool;
}

describe('Postgres AOS intelligence store', () => {
  it('ships a reviewed, non-auto-applied schema with no local authorization state', () => {
    const sql = readFileSync(
      new URL('../migrations/0001_aos_shadow_intelligence.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('REVIEWED SOURCE ARTIFACT ONLY');
    expect(sql).toContain('REVOKE ALL ON SCHEMA qf_jarvis_aos FROM PUBLIC');
    expect(sql).not.toMatch(/is_authorized|execution_authorized|approveds+boolean/iu);
  });

  it('stores immutable case snapshots without creating business authority', async () => {
    const state: FakePoolState = {
      queries: [],
      recommendationDigests: new Map(),
      caseContextDigests: new Map(),
    };
    const store = createPostgresAosIntelligenceStore(fakePool(state));
    const stored = await store.appendCaseSnapshot({
      case: aosCase(),
      storedAt: at,
    });
    expect(stored.outcome).toBe('STORED');
    expect(stored.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(state.queries[0]?.text).toContain('case_snapshot');
  });

  it('stores bounded case context memory so correlation can survive worker cycles', async () => {
    const state: FakePoolState = {
      queries: [],
      recommendationDigests: new Map(),
      caseContextDigests: new Map(),
    };
    const store = createPostgresAosIntelligenceStore(fakePool(state));
    const memory = createAosCaseContextMemory({
      caseKey: 'lead-store-test.first-contact',
      subjectRef: 'lead:store-test',
      updatedAt: at,
      facts: [
        {
          factId: 'fact:context',
          kind: 'CORE_FACT',
          dataClass: 'OPERATIONAL',
          sourceRef: 'core:context',
          observedAt: at,
          value: true,
        },
      ],
      behaviours: [
        {
          trigger: 'VENDOR_FIRST_CONTACT_MISSING',
          context: { metrics: { successfulVendorContacts: 1 } },
          observedAt: at,
          sourceRef: 'core:context',
        },
      ],
      policyRefs: ['policy:store-test'],
    });

    expect(await store.appendCaseContextMemory({ memory, storedAt: at })).toMatchObject({
      outcome: 'STORED',
    });
    expect(await store.appendCaseContextMemory({ memory, storedAt: at })).toMatchObject({
      outcome: 'DUPLICATE',
    });
    expect(state.queries.some((one) => one.text.includes('case_context_memory'))).toBe(true);
  });

  it('treats an exact recommendation retry as duplicate and rejects ID substitution', async () => {
    const state: FakePoolState = {
      queries: [],
      recommendationDigests: new Map(),
      caseContextDigests: new Map(),
    };
    const store = createPostgresAosIntelligenceStore(fakePool(state));
    const one = recommendation();

    expect(await store.appendRecommendation({ recommendation: one, storedAt: at })).toMatchObject({
      outcome: 'STORED',
    });
    expect(await store.appendRecommendation({ recommendation: one, storedAt: at })).toMatchObject({
      outcome: 'DUPLICATE',
    });

    state.recommendationDigests.set(one.recommendationId, 'sha256:' + '0'.repeat(64));
    await expect(
      store.appendRecommendation({ recommendation: one, storedAt: at }),
    ).rejects.toBeInstanceOf(AosStoreConflictError);
  });

  it('persists outcome evidence and reads it back for the learning loop', async () => {
    const state: FakePoolState = {
      queries: [],
      recommendationDigests: new Map(),
      caseContextDigests: new Map(),
    };
    const store = createPostgresAosIntelligenceStore(fakePool(state));
    const record: AosOutcomeRecord = {
      caseId: 'case.store-test',
      recommendationId: 'recommendation.store-test',
      ownerDecision: 'APPROVE',
      outcome: 'RECOVERED',
      policyViolation: false,
      unsupportedReasoning: false,
    };

    expect(
      await store.appendOutcome({
        observationId: 'outcome.store-test',
        capabilityRef: 'lead.vendor-first-contact-recovery',
        record,
        falsePositive: false,
        observedAt: at,
        storedAt: at,
      }),
    ).toMatchObject({ outcome: 'STORED' });

    expect(await store.readCapabilityLearning('lead.vendor-first-contact-recovery', 100)).toEqual([
      { record, falsePositive: false },
    ]);
  });

  it('stores exact behaviour manifests as evidence, never as an authorization flag', async () => {
    const state: FakePoolState = {
      queries: [],
      recommendationDigests: new Map(),
      caseContextDigests: new Map(),
    };
    const store = createPostgresAosIntelligenceStore(fakePool(state));
    const registry = createAosBehaviourRegistry({
      registryRef: 'qfj.aos.behaviour-registry.store-test',
      policies: [
        createAosBehaviourPolicy({
          policyId: 'lead.vendor-first-contact-recovery',
          version: 1,
          lifecycle: 'SUGGESTING',
          title: 'Stored first-contact recovery',
          trigger: 'VENDOR_FIRST_CONTACT_MISSING',
          priority: 'P1',
          scope: { cityRefs: [], localityRefs: [], categoryRefs: [] },
          conditions: [{ field: 'elapsedMinutes', operator: 'GTE', value: 20 }],
          action: 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP',
          ownerApprovalRequired: false,
          coreDecisionRequired: true,
          maximumVendorExposureWithoutOwnerApproval: 3,
          communication: {
            cooldownMinutes: 10,
            maxMessagesPer30Days: 8,
            directPhoneAllowed: false,
            maskedOpportunityOnly: true,
          },
        }),
      ],
    });
    const manifest = createAosBehaviourManifest({
      manifestId: 'aos.behaviour.store-test',
      manifestVersion: 1,
      lifecycle: 'DRAFT',
      registryRef: registry.registryRef,
      policyVersionRefs: ['lead.vendor-first-contact-recovery.v1'],
      configurationDigest: digestAosBehaviourRegistry(registry),
      createdAt: at,
    });

    expect(await store.appendBehaviourManifest({ manifest, registry, storedAt: at })).toMatchObject(
      { outcome: 'STORED' },
    );
    expect(state.queries.at(-1)?.text).toContain('behaviour_manifest');
  });
});
