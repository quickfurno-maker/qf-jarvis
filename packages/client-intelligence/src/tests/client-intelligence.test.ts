import { describe, expect, it } from 'vitest';

import {
  buildClientBehaviourState,
  createClientBehaviourSignal,
  createServiceBlueprintRegistry,
  evaluateClientServiceOpportunities,
  missingMandatoryQualificationFields,
  planClientNextBestAction,
} from '../index.js';
import type {
  ClientNextBestActionInput,
  ClientOpportunityContext,
  ServiceBlueprint,
} from '../index.js';

const BLUEPRINTS: readonly ServiceBlueprint[] = [
  {
    version: 1,
    serviceRef: 'interior-design',
    coreCategoryRef: 'cat.interior',
    qualification: {
      mandatoryFieldRefs: ['name', 'area', 'propertyType', 'scope'],
      optionalFieldRefs: ['budget', 'timeline'],
    },
    relatedServices: [
      { targetServiceRef: 'modular-kitchen', relevance: 'HIGH' },
      {
        targetServiceRef: 'painting',
        relevance: 'HIGH',
        timing: { sourceState: 'EITHER', possessionWithinDays: 30 },
      },
      {
        targetServiceRef: 'sofa',
        relevance: 'MEDIUM',
        timing: { sourceState: 'EITHER', propertyStageRefs: ['layout-final'] },
      },
    ],
  },
  {
    version: 1,
    serviceRef: 'modular-kitchen',
    coreCategoryRef: 'cat.kitchen',
    qualification: { mandatoryFieldRefs: ['name', 'area'], optionalFieldRefs: [] },
    relatedServices: [],
  },
  {
    version: 1,
    serviceRef: 'painting',
    coreCategoryRef: 'cat.painting',
    qualification: { mandatoryFieldRefs: ['name', 'area'], optionalFieldRefs: [] },
    relatedServices: [],
  },
  {
    version: 1,
    serviceRef: 'sofa',
    coreCategoryRef: 'cat.sofa',
    qualification: { mandatoryFieldRefs: ['name', 'area'], optionalFieldRefs: [] },
    relatedServices: [],
  },
];

const registry = () => createServiceBlueprintRegistry(BLUEPRINTS);

const context = (over: Partial<ClientOpportunityContext> = {}): ClientOpportunityContext => ({
  sourceServiceRefs: ['interior-design'],
  activeServiceRefs: ['interior-design'],
  completedServiceRefs: [],
  declinedServiceRefs: [],
  recentNurtureServiceRefs: [],
  explicitInterestServiceRefs: [],
  propertyStageRef: 'design',
  daysToPossession: 20,
  hasUnresolvedServiceIssue: false,
  ...over,
});

describe('service blueprint registry', () => {
  it('freezes and deterministically indexes blueprints', () => {
    const one = registry();
    expect(one.blueprints.map((item) => item.serviceRef)).toStrictEqual([
      'interior-design',
      'modular-kitchen',
      'painting',
      'sofa',
    ]);
    expect(one.get('interior-design')?.coreCategoryRef).toBe('cat.interior');
    expect(Object.isFrozen(one.blueprints)).toBe(true);
  });

  it('refuses a dangling service relation', () => {
    const interior = BLUEPRINTS.find((item) => item.serviceRef === 'interior-design');
    if (interior === undefined) throw new Error('test-blueprint-missing');
    expect(() =>
      createServiceBlueprintRegistry([
        {
          ...interior,
          relatedServices: [{ targetServiceRef: 'unknown', relevance: 'HIGH' }],
        },
      ]),
    ).toThrow('service-blueprint-related-service-missing');
  });
  it('returns mandatory qualification gaps in configured order', () => {
    const blueprint = registry().get('interior-design');
    if (blueprint === undefined) throw new Error('test-blueprint-missing');
    expect(
      missingMandatoryQualificationFields({
        blueprint,
        knownFieldRefs: ['name', 'propertyType'],
      }),
    ).toStrictEqual(['area', 'scope']);
    expect(
      missingMandatoryQualificationFields({
        blueprint,
        knownFieldRefs: ['name', 'area', 'propertyType', 'scope'],
      }),
    ).toStrictEqual([]);
  });

  it('refuses mandatory/optional field overlap', () => {
    expect(() =>
      createServiceBlueprintRegistry([
        {
          version: 1,
          serviceRef: 'painting',
          coreCategoryRef: 'cat.painting',
          qualification: {
            mandatoryFieldRefs: ['area'],
            optionalFieldRefs: ['area'],
          },
          relatedServices: [],
        },
      ]),
    ).toThrow('service-blueprint-field-overlap');
  });
});

describe('behaviour intelligence', () => {
  it('keeps the latest non-expired signal per bounded type', () => {
    const signals = [
      createClientBehaviourSignal({
        signalType: 'URGENCY',
        value: 'NORMAL',
        confidence: 0.8,
        evidenceRef: 'turn.1',
        observedAt: '2026-09-30T08:00:00.000Z',
        expiresAt: '2026-10-01T08:00:00.000Z',
      }),
      createClientBehaviourSignal({
        signalType: 'URGENCY',
        value: 'URGENT',
        confidence: 0.9,
        evidenceRef: 'turn.2',
        observedAt: '2026-09-30T09:00:00.000Z',
        expiresAt: '2026-10-01T09:00:00.000Z',
      }),
    ];
    const state = buildClientBehaviourState(signals, '2026-09-30T10:00:00.000Z');
    expect(state.URGENCY?.value).toBe('URGENT');
    expect(state.URGENCY?.authority).toBe('ADVISORY_ONLY');
  });

  it('drops expired signals instead of turning them into permanent profile truth', () => {
    const signal = createClientBehaviourSignal({
      signalType: 'SENTIMENT',
      value: 'FRUSTRATED',
      confidence: 0.9,
      evidenceRef: 'turn.3',
      observedAt: '2026-09-29T08:00:00.000Z',
      expiresAt: '2026-09-30T08:00:00.000Z',
    });
    expect(
      buildClientBehaviourState([signal], '2026-09-30T09:00:00.000Z').SENTIMENT,
    ).toBeUndefined();
  });

  it('refuses values outside the approved service-interaction vocabulary', () => {
    expect(() =>
      createClientBehaviourSignal({
        signalType: 'URGENCY',
        value: 'PANICKED' as never,
        confidence: 0.5,
        evidenceRef: 'turn.4',
        observedAt: '2026-09-30T09:00:00.000Z',
      }),
    ).toThrow('client-behaviour-signal-value-invalid');
  });
});

describe('service opportunity engine', () => {
  it('surfaces related services only when timing is relevant', () => {
    const items = evaluateClientServiceOpportunities({ registry: registry(), context: context() });
    expect(items.map((item) => item.serviceRef)).toStrictEqual(['painting', 'modular-kitchen']);
    expect(items.map((item) => item.authority)).toStrictEqual(['ADVISORY_ONLY', 'ADVISORY_ONLY']);
  });

  it('suppresses proactive cross-sell while an unresolved service issue exists', () => {
    const items = evaluateClientServiceOpportunities({
      registry: registry(),
      context: context({ hasUnresolvedServiceIssue: true }),
    });
    expect(items).toStrictEqual([]);
  });

  it('allows explicit client interest to become an opportunity even before normal timing', () => {
    const items = evaluateClientServiceOpportunities({
      registry: registry(),
      context: context({
        hasUnresolvedServiceIssue: true,
        explicitInterestServiceRefs: ['sofa'],
      }),
    });
    expect(items.map((item) => item.serviceRef)).toStrictEqual(['sofa']);
    expect(items[0]?.explicitInterest).toBe(true);
  });

  it('does not resurface active, completed, declined, or recently nurtured services', () => {
    const items = evaluateClientServiceOpportunities({
      registry: registry(),
      context: context({
        activeServiceRefs: ['interior-design', 'modular-kitchen'],
        completedServiceRefs: ['painting'],
        declinedServiceRefs: ['sofa'],
        recentNurtureServiceRefs: ['sofa'],
        propertyStageRef: 'layout-final',
      }),
    });
    expect(items).toStrictEqual([]);
  });
});

const nbaInput = (over: Partial<ClientNextBestActionInput> = {}): ClientNextBestActionInput => ({
  clientQuestionPending: false,
  humanHandoffRequested: false,
  unresolvedServiceIssue: false,
  explicitReassignmentRequested: false,
  extraVendorReviewRequested: false,
  matchRequested: false,
  matchReady: false,
  missingMandatoryFieldRefs: [],
  vendorsReleased: 0,
  vendorNoContactCount: 0,
  allReleasedVendorsContacted: false,
  satisfactionKnown: false,
  followUpDue: false,
  opportunities: [],
  ...over,
});

describe('next best action', () => {
  it('asks only the first missing mandatory field before a requested match', () => {
    const result = planClientNextBestAction(
      nbaInput({
        matchRequested: true,
        missingMandatoryFieldRefs: ['area', 'propertyType'],
      }),
    );
    expect(result.action).toBe('ASK_MISSING_FIELD');
    expect(result.requiredFieldRef).toBe('area');
    expect(result.executionAuthorized).toBe(false);
    expect(result.businessEffect).toBe(false);
  });

  it('requests Core matching only when the requirement is ready', () => {
    const result = planClientNextBestAction(nbaInput({ matchRequested: true, matchReady: true }));
    expect(result).toMatchObject({
      action: 'REQUEST_MATCH',
      requiresCoreDecision: true,
      executionAuthorized: false,
    });
  });

  it('never turns an extra-vendor request into automatic assignment', () => {
    const result = planClientNextBestAction(
      nbaInput({ extraVendorReviewRequested: true, vendorsReleased: 3 }),
    );
    expect(result.action).toBe('REQUEST_EXTRA_VENDOR_REVIEW');
    expect(result.requiresCoreDecision).toBe(true);
  });

  it('prioritizes explicit reassignment over generic recovery', () => {
    const result = planClientNextBestAction(
      nbaInput({
        explicitReassignmentRequested: true,
        unresolvedServiceIssue: true,
        vendorsReleased: 3,
        vendorNoContactCount: 1,
      }),
    );
    expect(result.action).toBe('REQUEST_REASSIGNMENT');
  });

  it('keeps unresolved service recovery ahead of cross-sell', () => {
    const opportunities = evaluateClientServiceOpportunities({
      registry: registry(),
      context: context({ explicitInterestServiceRefs: ['sofa'] }),
    });
    const result = planClientNextBestAction(
      nbaInput({ unresolvedServiceIssue: true, opportunities }),
    );
    expect(result.action).toBe('SERVICE_RECOVERY');
  });

  it('asks for satisfaction after the released vendor batch has contacted the client', () => {
    const result = planClientNextBestAction(
      nbaInput({
        vendorsReleased: 3,
        allReleasedVendorsContacted: true,
        satisfactionKnown: false,
      }),
    );
    expect(result.action).toBe('ASK_SATISFACTION');
  });

  it('surfaces only the highest-ranked opportunity', () => {
    const opportunities = evaluateClientServiceOpportunities({
      registry: registry(),
      context: context({ propertyStageRef: 'layout-final' }),
    });
    const result = planClientNextBestAction(nbaInput({ opportunities }));
    expect(result.action).toBe('SURFACE_ADDITIONAL_SERVICE');
    expect(result.serviceRef).toBe('painting');
  });

  it('answers the current client question before progressing the workflow', () => {
    const result = planClientNextBestAction(
      nbaInput({
        clientQuestionPending: true,
        matchRequested: true,
        matchReady: true,
      }),
    );
    expect(result.action).toBe('ANSWER_CLIENT');
  });
});
