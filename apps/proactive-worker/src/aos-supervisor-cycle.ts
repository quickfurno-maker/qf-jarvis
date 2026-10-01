import {
  rankAosOwnerAttention,
  type AosBehaviourRuntimeBinding,
  type AosCaseContextMemory,
  type AosMarketplaceSliceSnapshot,
  type AosOwnerAttentionItem,
  type AosRecommendation,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type {
  AosCanonicalRecommendationProjection,
  AosCanonicalRecommendationProjector,
  AosDecisionAdjudicator,
} from '@qf-jarvis/aos-governance-integration';
import type {
  AosLeadDeliveryProjection,
  AosVendorSuccessProjection,
} from '@qf-jarvis/aos-core-event-bridge';

import {
  runAosCanonicalEventShadowCycle,
  type AosCanonicalEventCycleResult,
} from './aos-canonical-cycle.js';
import {
  runAosClientIntelligenceShadowCycle,
  type AosClientIntelligenceShadowCycleInput,
  type AosClientIntelligenceShadowCycleResult,
} from './aos-client-intelligence-cycle.js';
import {
  runAosLeadDeliveryShadowCycle,
  type AosLeadDeliveryShadowCycleResult,
} from './aos-lead-delivery-cycle.js';
import {
  runAosMarketplaceShadowCycle,
  type AosMarketplaceShadowCycleResult,
} from './aos-marketplace-cycle.js';
import {
  runAosVendorSuccessShadowCycle,
  type AosVendorSuccessShadowCycleResult,
} from './aos-vendor-success-cycle.js';
import type { AosShadowCaseResult, AosShadowPersistencePort } from './aos-shadow-cycle.js';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface AosSupervisorClientInput {
  readonly subjectRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly snapshot: AosClientIntelligenceShadowCycleInput['snapshot'];
}

export interface AosSupervisorAiBudget {
  readonly monthlyBudget: number;
  readonly spent: number;
}

export interface AosSupervisorCycleInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly canonicalEvents?: readonly unknown[];
  readonly leadDeliveries?: readonly AosLeadDeliveryProjection[];
  readonly clients?: readonly AosSupervisorClientInput[];
  readonly vendors?: readonly AosVendorSuccessProjection[];
  readonly marketplaceSlices?: readonly AosMarketplaceSliceSnapshot[];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
  readonly aiBudget?: AosSupervisorAiBudget;
}

export interface AosSupervisorGovernanceExtensions {
  readonly adjudicator?: AosDecisionAdjudicator;
  readonly canonicalProjector?: AosCanonicalRecommendationProjector;
}

export interface AosSupervisorCycleResult {
  readonly protocol: 'qfj.aos.supervisor-cycle.v1';
  readonly cycleId: string;
  readonly sourceSummary: {
    readonly canonicalEvents: number;
    readonly leadDeliveryProjections: number;
    readonly clientSnapshots: number;
    readonly vendorProjections: number;
    readonly marketplaceSlices: number;
  };
  readonly canonical?: AosCanonicalEventCycleResult;
  readonly leadDelivery?: AosLeadDeliveryShadowCycleResult;
  readonly clients: readonly AosClientIntelligenceShadowCycleResult[];
  readonly vendors?: AosVendorSuccessShadowCycleResult;
  readonly marketplace?: AosMarketplaceShadowCycleResult;
  readonly cases: readonly AosShadowCaseResult[];
  readonly recommendations: readonly AosRecommendation[];
  readonly adjudicationHolds: number;
  readonly canonicalRecommendations: readonly AosCanonicalRecommendationProjection[];
  readonly canonicalProjectionFailures: number;
  readonly ownerAttention: readonly AosOwnerAttentionItem[];
  readonly caseContextMemory: readonly AosCaseContextMemory[];
  readonly modelCalls: number;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateInput(input: AosSupervisorCycleInput): void {
  if (
    !REF.test(input.cycleId) ||
    !validInstant(input.generatedAt) ||
    (input.canonicalEvents?.length ?? 0) > 10_000 ||
    (input.leadDeliveries?.length ?? 0) > 10_000 ||
    (input.clients?.length ?? 0) > 2_000 ||
    (input.vendors?.length ?? 0) > 10_000 ||
    (input.marketplaceSlices?.length ?? 0) > 10_000 ||
    (input.caseContextMemory?.length ?? 0) > 10_000
  ) {
    throw new TypeError('aos-supervisor-cycle-input-invalid');
  }
  const leadKeys = new Set<string>();
  for (const lead of input.leadDeliveries ?? []) {
    const key = lead.leadRef + '|' + lead.requirementRef;
    if (leadKeys.has(key)) {
      throw new TypeError('aos-supervisor-lead-delivery-input-duplicate');
    }
    leadKeys.add(key);
  }

  const clientKeys = new Set<string>();
  for (const client of input.clients ?? []) {
    const key = client.subjectRef + '|' + client.requirementRef;
    if (
      clientKeys.has(key) ||
      client.subjectRef.length < 1 ||
      client.requirementRef.length < 1 ||
      client.evidenceRef.length < 1
    ) {
      throw new TypeError('aos-supervisor-client-input-invalid');
    }
    clientKeys.add(key);
  }
  const vendorKeys = new Set<string>();
  for (const vendor of input.vendors ?? []) {
    if (vendorKeys.has(vendor.subjectRef)) {
      throw new TypeError('aos-supervisor-vendor-input-duplicate');
    }
    vendorKeys.add(vendor.subjectRef);
  }
  if (
    input.aiBudget !== undefined &&
    (!Number.isFinite(input.aiBudget.monthlyBudget) ||
      input.aiBudget.monthlyBudget <= 0 ||
      !Number.isFinite(input.aiBudget.spent) ||
      input.aiBudget.spent < 0)
  ) {
    throw new TypeError('aos-supervisor-budget-invalid');
  }
}

function mergeMemory(
  previous: readonly AosCaseContextMemory[],
  incoming: readonly AosCaseContextMemory[],
): readonly AosCaseContextMemory[] {
  const byCase = new Map<string, AosCaseContextMemory>();
  for (const memory of [...previous, ...incoming]) {
    const existing = byCase.get(memory.caseKey);
    if (
      existing === undefined ||
      memory.revision > existing.revision ||
      (memory.revision === existing.revision && memory.updatedAt >= existing.updatedAt)
    ) {
      byCase.set(memory.caseKey, memory);
    }
  }
  return Object.freeze(
    [...byCase.values()].sort((left, right) => left.caseKey.localeCompare(right.caseKey)),
  );
}

function finalCases(inputs: readonly AosShadowCaseResult[]): readonly AosShadowCaseResult[] {
  const byCase = new Map<string, AosShadowCaseResult>();
  for (const one of inputs) byCase.set(one.case.caseId, one);
  return Object.freeze(
    [...byCase.values()].sort(
      (left, right) =>
        left.case.priority.localeCompare(right.case.priority) ||
        left.case.caseId.localeCompare(right.case.caseId),
    ),
  );
}

function attentionFor(
  cases: readonly AosShadowCaseResult[],
  memories: readonly AosCaseContextMemory[],
  generatedAt: string,
): readonly AosOwnerAttentionItem[] {
  const now = Date.parse(generatedAt);
  const memoryByCase = new Map(memories.map((memory) => [memory.caseKey, memory]));
  return rankAosOwnerAttention(
    cases.map((one) => {
      const first = Date.parse(one.case.firstObservedAt);
      const ageMinutes =
        Number.isFinite(first) && first <= now ? Math.floor((now - first) / 60_000) : 0;
      const revision = memoryByCase.get(one.case.caseKey)?.revision ?? 1;
      return Object.freeze({
        case: one.case,
        ...(one.recommendation === undefined ? {} : { recommendation: one.recommendation }),
        ageMinutes,
        repeatedSignalCount: Math.max(one.case.signalIds.length, revision),
      });
    }),
  );
}

/**
 * One SHADOW/SUGGEST supervisor for all AOS business loops.
 *
 * It sequentially reuses the same case memory across canonical Core events,
 * Client Intelligence and marketplace slices. It does not create an execution
 * intent, communication request, approval decision or Core mutation.
 */
export async function runAosSupervisorShadowCycle(
  input: AosSupervisorCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  governance: AosSupervisorGovernanceExtensions = Object.freeze({}),
): Promise<AosSupervisorCycleResult> {
  validateInput(input);

  let modelCalls = 0;
  const countedReasoner: AosModelReasoner | undefined =
    reasoner === undefined
      ? undefined
      : Object.freeze({
          async reason(request: Parameters<AosModelReasoner['reason']>[0]) {
            modelCalls += 1;
            return reasoner.reason(request);
          },
        });

  let memory = Object.freeze([...(input.caseContextMemory ?? [])]);
  const collectedCases: AosShadowCaseResult[] = [];

  let canonical: AosCanonicalEventCycleResult | undefined;
  const canonicalEvents = input.canonicalEvents ?? [];
  if (canonicalEvents.length > 0) {
    canonical = await runAosCanonicalEventShadowCycle(
      {
        cycleId: input.cycleId + '.core',
        generatedAt: input.generatedAt,
        events: canonicalEvents,
        caseContextMemory: memory,
        ...(input.behaviourBinding === undefined
          ? {}
          : { behaviourBinding: input.behaviourBinding }),
        ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
      },
      countedReasoner,
      persistence,
      governance.adjudicator,
    );
    memory = mergeMemory(memory, canonical.shadow.caseContextMemory);
    collectedCases.push(...canonical.shadow.cases);
  }

  let leadDelivery: AosLeadDeliveryShadowCycleResult | undefined;
  const leadDeliveries = input.leadDeliveries ?? [];
  if (leadDeliveries.length > 0) {
    leadDelivery = await runAosLeadDeliveryShadowCycle(
      {
        cycleId: input.cycleId + '.lead-delivery',
        generatedAt: input.generatedAt,
        projections: leadDeliveries,
        caseContextMemory: memory,
        ...(input.behaviourBinding === undefined
          ? {}
          : { behaviourBinding: input.behaviourBinding }),
        ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
      },
      countedReasoner,
      persistence,
      governance.adjudicator,
    );
    memory = mergeMemory(memory, leadDelivery.shadow.caseContextMemory);
    collectedCases.push(...leadDelivery.shadow.cases);
  }

  const clientResults: AosClientIntelligenceShadowCycleResult[] = [];
  for (const [index, client] of (input.clients ?? []).entries()) {
    const one = await runAosClientIntelligenceShadowCycle(
      {
        cycleId: input.cycleId + '.client.' + String(index + 1),
        generatedAt: input.generatedAt,
        subjectRef: client.subjectRef,
        requirementRef: client.requirementRef,
        evidenceRef: client.evidenceRef,
        snapshot: client.snapshot,
        caseContextMemory: memory,
        ...(input.behaviourBinding === undefined
          ? {}
          : { behaviourBinding: input.behaviourBinding }),
        ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
      },
      countedReasoner,
      persistence,
      governance.adjudicator,
    );
    clientResults.push(one);
    memory = mergeMemory(memory, one.shadow.caseContextMemory);
    collectedCases.push(...one.shadow.cases);
  }

  let vendors: AosVendorSuccessShadowCycleResult | undefined;
  const vendorProjections = input.vendors ?? [];
  if (vendorProjections.length > 0) {
    vendors = await runAosVendorSuccessShadowCycle(
      {
        cycleId: input.cycleId + '.vendors',
        generatedAt: input.generatedAt,
        projections: vendorProjections,
        caseContextMemory: memory,
        ...(input.behaviourBinding === undefined
          ? {}
          : { behaviourBinding: input.behaviourBinding }),
        ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
      },
      countedReasoner,
      persistence,
      governance.adjudicator,
    );
    memory = mergeMemory(memory, vendors.shadow.caseContextMemory);
    collectedCases.push(...vendors.shadow.cases);
  }

  let marketplace: AosMarketplaceShadowCycleResult | undefined;
  const marketplaceSlices = input.marketplaceSlices ?? [];
  if (marketplaceSlices.length > 0) {
    marketplace = await runAosMarketplaceShadowCycle(
      {
        cycleId: input.cycleId + '.marketplace',
        generatedAt: input.generatedAt,
        slices: marketplaceSlices,
        caseContextMemory: memory,
        ...(input.behaviourBinding === undefined
          ? {}
          : { behaviourBinding: input.behaviourBinding }),
        ...(input.aiBudget === undefined ? {} : { aiBudget: input.aiBudget }),
      },
      countedReasoner,
      persistence,
      governance.adjudicator,
    );
    memory = mergeMemory(memory, marketplace.shadow.caseContextMemory);
    collectedCases.push(...marketplace.shadow.cases);
  }

  const cases = finalCases(collectedCases);
  const recommendations = Object.freeze(
    cases.flatMap((one) => (one.recommendation === undefined ? [] : [one.recommendation])),
  );
  const adjudicationHolds = cases.filter(
    (one) => one.adjudication?.outcome === 'HOLD_FOR_HUMAN_REVIEW',
  ).length;
  const canonicalRecommendations: AosCanonicalRecommendationProjection[] = [];
  let canonicalProjectionFailures = 0;
  if (governance.canonicalProjector !== undefined) {
    for (const one of cases) {
      if (
        one.recommendation === undefined ||
        one.adjudication?.outcome === 'HOLD_FOR_HUMAN_REVIEW'
      ) {
        continue;
      }
      try {
        canonicalRecommendations.push(
          governance.canonicalProjector.project({
            case: one.case,
            recommendation: one.recommendation,
            createdAt: input.generatedAt,
          }),
        );
      } catch {
        canonicalProjectionFailures += 1;
      }
    }
  }

  return Object.freeze({
    protocol: 'qfj.aos.supervisor-cycle.v1' as const,
    cycleId: input.cycleId,
    sourceSummary: Object.freeze({
      canonicalEvents: canonicalEvents.length,
      leadDeliveryProjections: leadDeliveries.length,
      clientSnapshots: input.clients?.length ?? 0,
      vendorProjections: vendorProjections.length,
      marketplaceSlices: marketplaceSlices.length,
    }),
    ...(canonical === undefined ? {} : { canonical }),
    ...(leadDelivery === undefined ? {} : { leadDelivery }),
    clients: Object.freeze(clientResults),
    ...(vendors === undefined ? {} : { vendors }),
    ...(marketplace === undefined ? {} : { marketplace }),
    cases,
    recommendations,
    adjudicationHolds,
    canonicalRecommendations: Object.freeze(canonicalRecommendations),
    canonicalProjectionFailures,
    ownerAttention: attentionFor(cases, memory, input.generatedAt),
    caseContextMemory: memory,
    modelCalls,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
