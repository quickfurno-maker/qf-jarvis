import {
  bridgeLeadDeliveryProjectionToAos,
  type AosLeadDeliveryProjection,
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

export interface AosLeadDeliveryShadowCycleInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly projections: readonly AosLeadDeliveryProjection[];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
  readonly aiBudget?: {
    readonly monthlyBudget: number;
    readonly spent: number;
  };
}

export interface AosLeadDeliveryShadowCycleResult {
  readonly protocol: 'qfj.aos.lead-delivery-cycle.v1';
  readonly projections: number;
  readonly detections: number;
  readonly shadow: AosShadowCycleResult;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

export async function runAosLeadDeliveryShadowCycle(
  input: AosLeadDeliveryShadowCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  adjudicator?: AosDecisionAdjudicator,
): Promise<AosLeadDeliveryShadowCycleResult> {
  if (input.projections.length > 10_000) {
    throw new TypeError('aos-lead-delivery-cycle-input-invalid');
  }

  const bridged = input.projections.flatMap((projection) =>
    bridgeLeadDeliveryProjectionToAos(projection),
  );
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
    const key = one.observation.input.caseKey;
    const existing = materialByCase.get(key);
    if (existing === undefined) {
      materialByCase.set(key, {
        caseKey: key,
        facts: [...one.facts],
        policyRefs: [...one.policyRefs],
        behaviours: [one.behaviour],
      });
      continue;
    }
    existing.facts.push(...one.facts);
    existing.policyRefs.push(...one.policyRefs);
    existing.behaviours.push(one.behaviour);
  }

  const caseMaterial: AosShadowCaseMaterial[] = [...materialByCase.values()].map((material) =>
    Object.freeze({
      caseKey: material.caseKey,
      facts: Object.freeze(
        [...new Map(material.facts.map((fact) => [fact.factId, fact])).values()].sort(
          (left, right) => left.factId.localeCompare(right.factId),
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
        batchId: input.cycleId + '.lead-delivery',
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
      ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
    },
    reasoner,
    persistence,
    adjudicator,
  );

  return Object.freeze({
    protocol: 'qfj.aos.lead-delivery-cycle.v1' as const,
    projections: input.projections.length,
    detections: bridged.length,
    shadow,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
