import {
  bridgeMarketplaceSliceToAos,
  marketCellAssessmentForSlice,
  type AosBehaviourRuntimeBinding,
  type AosCaseContextMemory,
  type AosMarketplaceSliceSnapshot,
  type AosMarketCellAssessment,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type { AosDecisionAdjudicator } from '@qf-jarvis/aos-governance-integration';

import {
  runAosShadowCycle,
  type AosShadowCaseMaterial,
  type AosShadowCycleResult,
  type AosShadowPersistencePort,
} from './aos-shadow-cycle.js';

export interface AosMarketplaceShadowCycleInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly slices: readonly AosMarketplaceSliceSnapshot[];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
  readonly aiBudget?: {
    readonly monthlyBudget: number;
    readonly spent: number;
  };
}

export interface AosMarketplaceShadowCycleResult {
  readonly protocol: 'qfj.aos.marketplace-cycle.v1';
  readonly slices: number;
  readonly detections: number;
  readonly marketCells: readonly AosMarketCellAssessment[];
  readonly shadow: AosShadowCycleResult;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

export async function runAosMarketplaceShadowCycle(
  input: AosMarketplaceShadowCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  adjudicator?: AosDecisionAdjudicator,
): Promise<AosMarketplaceShadowCycleResult> {
  if (input.slices.length > 10_000) {
    throw new TypeError('aos-marketplace-cycle-input-invalid');
  }

  const marketCells = Object.freeze(
    input.slices.flatMap((slice) => {
      const assessment = marketCellAssessmentForSlice(slice);
      return assessment === undefined ? [] : [assessment];
    }),
  );
  const bridged = input.slices.flatMap((slice) => bridgeMarketplaceSliceToAos(slice));
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
        behaviours: one.behaviour === undefined ? [] : [one.behaviour],
      });
      continue;
    }
    existing.facts.push(...one.facts);
    existing.policyRefs.push(...one.policyRefs);
    if (one.behaviour !== undefined) existing.behaviours.push(one.behaviour);
  }

  const observations = Object.freeze(bridged.map((one) => one.observation));
  const caseMaterial: AosShadowCaseMaterial[] = [...materialByCase.values()]
    .filter((material) => material.behaviours.length > 0)
    .map((material) =>
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
          noveltyScore: 0.15,
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
        batchId: input.cycleId + '.marketplace',
        observations,
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
    protocol: 'qfj.aos.marketplace-cycle.v1' as const,
    slices: input.slices.length,
    detections: bridged.length,
    marketCells,
    shadow,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
