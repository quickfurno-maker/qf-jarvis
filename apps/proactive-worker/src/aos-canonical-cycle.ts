import { bridgeCanonicalCoreEvent } from '@qf-jarvis/aos-core-event-bridge';
import type {
  AosBehaviourRuntimeBinding,
  AosCaseContextMemory,
  AosEvidenceFact,
  AosObservation,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type { AosDecisionAdjudicator } from '@qf-jarvis/aos-governance-integration';

import {
  runAosShadowCycle,
  type AosShadowBehaviourMaterial,
  type AosShadowCaseMaterial,
  type AosShadowCycleResult,
  type AosShadowPersistencePort,
} from './aos-shadow-cycle.js';

export interface AosCanonicalEventCycleInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly events: readonly unknown[];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
  readonly aiBudget?: {
    readonly monthlyBudget: number;
    readonly spent: number;
  };
}

export interface AosCanonicalEventCycleResult {
  readonly protocol: 'qfj.aos.canonical-event-cycle.v1';
  readonly receivedEvents: number;
  readonly bridgedEvents: number;
  readonly ignoredEvents: number;
  readonly invalidEvents: number;
  readonly shadow: AosShadowCycleResult;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

interface PendingMaterial {
  readonly caseKey: string;
  readonly facts: AosEvidenceFact[];
  readonly policyRefs: string[];
  readonly behaviours: AosShadowBehaviourMaterial[];
}

function eventFact(
  observation: Extract<AosObservation, { readonly kind: 'BUSINESS_EVENT' }>,
  eventType: string,
): AosEvidenceFact {
  const sourceRef = observation.input.evidenceRefs[0];
  if (sourceRef === undefined) throw new TypeError('aos-canonical-event-evidence-missing');
  return Object.freeze({
    factId: 'fact:event-type:' + observation.input.signalId,
    kind: 'CORE_FACT' as const,
    dataClass: 'OPAQUE_REFERENCE' as const,
    sourceRef,
    observedAt: observation.input.observedAt,
    value: eventType,
  });
}

function metricFacts(
  observation: Extract<AosObservation, { readonly kind: 'BUSINESS_EVENT' }>,
  behaviour: AosShadowBehaviourMaterial,
): readonly AosEvidenceFact[] {
  const sourceRef = observation.input.evidenceRefs[0];
  if (sourceRef === undefined) throw new TypeError('aos-canonical-event-evidence-missing');
  return Object.entries(behaviour.context.metrics).map(([field, value]) =>
    Object.freeze({
      factId: 'fact:metric:' + field + ':' + observation.input.signalId,
      kind: 'METRIC' as const,
      dataClass: 'OPERATIONAL' as const,
      sourceRef,
      observedAt: observation.input.observedAt,
      value,
    }),
  );
}

export async function runAosCanonicalEventShadowCycle(
  input: AosCanonicalEventCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  adjudicator?: AosDecisionAdjudicator,
): Promise<AosCanonicalEventCycleResult> {
  if (
    input.events.length > 10_000 ||
    input.generatedAt.length < 1 ||
    input.generatedAt.length > 64
  ) {
    throw new TypeError('aos-canonical-event-cycle-input-invalid');
  }

  const observations: AosObservation[] = [];
  const materialByCase = new Map<string, PendingMaterial>();
  let bridgedEvents = 0;
  let ignoredEvents = 0;
  let invalidEvents = 0;

  for (const raw of input.events) {
    const bridged = bridgeCanonicalCoreEvent(raw);
    if (bridged.outcome === 'INVALID') {
      invalidEvents += 1;
      continue;
    }
    if (bridged.outcome === 'IGNORED') {
      ignoredEvents += 1;
      continue;
    }
    bridgedEvents += 1;
    const observation = bridged.observation;
    observations.push(observation);
    const behaviour: AosShadowBehaviourMaterial = Object.freeze({
      trigger: bridged.behaviour.trigger,
      context: bridged.behaviour.context,
    });
    const existing = materialByCase.get(observation.input.caseKey);
    const facts = [
      eventFact(observation, bridged.eventType),
      ...metricFacts(observation, behaviour),
    ];

    if (existing === undefined) {
      materialByCase.set(observation.input.caseKey, {
        caseKey: observation.input.caseKey,
        facts: [...facts],
        policyRefs: ['core:canonical-event'],
        behaviours: [behaviour],
      });
    } else {
      existing.facts.push(...facts);
      existing.behaviours.push(behaviour);
    }
  }

  const caseMaterial: AosShadowCaseMaterial[] = [...materialByCase.values()].map((material) =>
    Object.freeze({
      caseKey: material.caseKey,
      facts: Object.freeze(material.facts),
      policyRefs: Object.freeze([...new Set(material.policyRefs)].sort()),
      behaviours: Object.freeze(material.behaviours),
      routing: Object.freeze({
        noveltyScore: 0,
        evidenceConflictCount: 0,
        similarResolvedCaseCount: 100,
        routineBudgetAvailable: false,
        deepBudgetAvailable: false,
      }),
    }),
  );

  const shadow = await runAosShadowCycle(
    {
      cycleId: input.cycleId,
      batch: Object.freeze({
        batchId: input.cycleId + '.canonical',
        observations: Object.freeze(observations),
        generatedAt: input.generatedAt,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      }),
      caseMaterial: Object.freeze(caseMaterial),
      ...(input.caseContextMemory === undefined
        ? {}
        : { caseContextMemory: input.caseContextMemory }),
      ...(input.behaviourBinding === undefined ? {} : { behaviourBinding: input.behaviourBinding }),
      ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
    },
    reasoner,
    persistence,
    adjudicator,
  );

  return Object.freeze({
    protocol: 'qfj.aos.canonical-event-cycle.v1' as const,
    receivedEvents: input.events.length,
    bridgedEvents,
    ignoredEvents,
    invalidEvents,
    shadow,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
