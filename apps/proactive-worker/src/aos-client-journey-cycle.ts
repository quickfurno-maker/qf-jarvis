import {
  bridgeClientJourneyToAos,
  type AosClientJourneyBridgeInput,
} from '@qf-jarvis/aos-core-event-bridge';
import type { AosBehaviourRuntimeBinding, AosCaseContextMemory } from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type { AosDecisionAdjudicator } from '@qf-jarvis/aos-governance-integration';

import {
  runAosShadowCycle,
  type AosShadowCaseMaterial,
  type AosShadowCycleResult,
  type AosShadowPersistencePort,
} from './aos-shadow-cycle.js';

export interface AosClientJourneyShadowCycleInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly subjectRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly journey: AosClientJourneyBridgeInput['journey'];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
}

export interface AosClientJourneyShadowCycleResult {
  readonly protocol: 'qfj.aos.client-journey-cycle.v1';
  readonly bridgedSignals: number;
  readonly shadow: AosShadowCycleResult;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

export async function runAosClientJourneyShadowCycle(
  input: AosClientJourneyShadowCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  adjudicator?: AosDecisionAdjudicator,
): Promise<AosClientJourneyShadowCycleResult> {
  const bridged = bridgeClientJourneyToAos({
    subjectRef: input.subjectRef,
    requirementRef: input.requirementRef,
    evidenceRef: input.evidenceRef,
    observedAt: input.generatedAt,
    journey: input.journey,
  });

  const materialByCase = new Map<
    string,
    {
      readonly caseKey: string;
      readonly facts: AosShadowCaseMaterial['facts'][number][];
      readonly policyRefs: string[];
      readonly behaviours: AosShadowCaseMaterial['behaviours'][number][];
    }
  >();

  for (const one of bridged) {
    const caseKey = one.observation.input.caseKey;
    const existing = materialByCase.get(caseKey);
    if (existing === undefined) {
      materialByCase.set(caseKey, {
        caseKey,
        facts: [...one.facts],
        policyRefs: [...one.policyRefs],
        behaviours: [one.behaviour],
      });
    } else {
      existing.facts.push(...one.facts);
      existing.policyRefs.push(...one.policyRefs);
      existing.behaviours.push(one.behaviour);
    }
  }

  const caseMaterial: AosShadowCaseMaterial[] = [...materialByCase.values()].map((material) =>
    Object.freeze({
      caseKey: material.caseKey,
      facts: Object.freeze(
        [...new Map(material.facts.map((fact) => [fact.factId, fact])).values()].sort((a, b) =>
          a.factId.localeCompare(b.factId),
        ),
      ),
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
        batchId: input.cycleId + '.client-journey',
        observations: Object.freeze(bridged.map((one) => one.observation)),
        generatedAt: input.generatedAt,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      }),
      caseMaterial: Object.freeze(caseMaterial),
      ...(input.caseContextMemory === undefined
        ? {}
        : { caseContextMemory: input.caseContextMemory }),
      ...(input.behaviourBinding === undefined ? {} : { behaviourBinding: input.behaviourBinding }),
    },
    reasoner,
    persistence,
    adjudicator,
  );

  return Object.freeze({
    protocol: 'qfj.aos.client-journey-cycle.v1' as const,
    bridgedSignals: bridged.length,
    shadow,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
