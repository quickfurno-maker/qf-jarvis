import { createHash } from 'node:crypto';

import { verifyAosBehaviourRuntimeBinding } from '@qf-jarvis/aos-behaviour-control';
import {
  AOS_BEHAVIOUR_REGISTRY_V1,
  AOS_CONDITION_FIELDS,
  buildAosEvidencePacket,
  chooseAosModelRoute,
  createAosCase,
  createAosCaseContextMemory,
  createAosRecommendation,
  critiqueAosRecommendation,
  evaluateAosAiBudget,
  detectAosObservation,
  evaluateAosBehaviourPolicy,
  mergeAosCaseContextMemory,
  recommendationActionForBehaviour,
  transitionAosCase,
  type AosBehaviourContext,
  type AosBehaviourPolicy,
  type AosBehaviourRegistry,
  type AosBehaviourRuntimeBinding,
  type AosBehaviourTrigger,
  type AosCase,
  type AosCaseBehaviourEvidence,
  type AosCaseContextMemory,
  type AosCritique,
  type AosEvidenceFact,
  type AosModelRoute,
  type AosObservationBatch,
  type AosRecommendation,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type {
  AosAdjudicationDecision,
  AosDecisionAdjudicator,
} from '@qf-jarvis/aos-governance-integration';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

export interface AosShadowRoutingEvidence {
  readonly noveltyScore: number;
  readonly evidenceConflictCount: number;
  readonly similarResolvedCaseCount: number;
  readonly routineBudgetAvailable: boolean;
  readonly deepBudgetAvailable: boolean;
}

export interface AosShadowBehaviourMaterial {
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
}

export interface AosShadowCaseMaterial {
  readonly caseKey: string;
  readonly facts: readonly AosEvidenceFact[];
  readonly policyRefs: readonly string[];
  readonly behaviours: readonly AosShadowBehaviourMaterial[];
  readonly routing: AosShadowRoutingEvidence;
}

export interface AosShadowCycleInput {
  readonly cycleId: string;
  readonly batch: AosObservationBatch;
  readonly caseMaterial: readonly AosShadowCaseMaterial[];
  readonly caseContextMemory?: readonly AosCaseContextMemory[];
  readonly behaviourBinding?: AosBehaviourRuntimeBinding;
  /**
   * Optional external spend snapshot. AOS never guesses provider spend from
   * token counts; when supplied, this acts only as a model-routing circuit breaker.
   */
  readonly aiBudget?: {
    readonly monthlyBudget: number;
    readonly spent: number;
  };
}

export interface AosShadowPersistencePort {
  appendCaseSnapshot(input: {
    readonly case: AosCase;
    readonly storedAt: string;
  }): Promise<unknown>;
  appendRecommendation(input: {
    readonly recommendation: AosRecommendation;
    readonly storedAt: string;
  }): Promise<unknown>;
  appendCaseContextMemory?(input: {
    readonly memory: AosCaseContextMemory;
    readonly storedAt: string;
  }): Promise<unknown>;
}

export type AosShadowCaseReason =
  | 'NO_POLICY_MATCH'
  | 'DETERMINISTIC_RECOMMENDATION'
  | 'MODEL_RECOMMENDATION'
  | 'MODEL_REQUIRED_BUT_UNAVAILABLE'
  | 'MODEL_REFUSED'
  | 'CRITIC_HOLD'
  | 'ADJUDICATION_HOLD'
  | 'EVIDENCE_MISSING';

export interface AosShadowCaseResult {
  readonly case: AosCase;
  readonly route: AosModelRoute;
  readonly matchedPolicyRefs: readonly string[];
  readonly recommendation?: AosRecommendation;
  readonly critique?: AosCritique;
  readonly adjudication?: AosAdjudicationDecision;
  readonly reason: AosShadowCaseReason;
}

export interface AosShadowCycleResult {
  readonly protocol: 'qfj.aos.shadow-cycle.v1';
  readonly cycleId: string;
  readonly observations: number;
  readonly signals: number;
  readonly cases: readonly AosShadowCaseResult[];
  readonly recommendations: number;
  readonly caseContextMemory: readonly AosCaseContextMemory[];
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

function caseId(caseKey: string): string {
  return 'case.aos.' + createHash('sha256').update(caseKey, 'utf8').digest('hex').slice(0, 24);
}

function policyRef(policy: AosBehaviourPolicy): string {
  return policy.policyId + '.v' + String(policy.version);
}

function correlatedContext(
  current: AosShadowBehaviourMaterial,
  behaviours: readonly AosShadowBehaviourMaterial[],
): AosBehaviourContext {
  const metrics: Partial<Record<(typeof AOS_CONDITION_FIELDS)[number], number>> = {};
  for (const field of AOS_CONDITION_FIELDS) {
    const currentValue = current.context.metrics[field];
    if (currentValue !== undefined) {
      metrics[field] = currentValue;
      continue;
    }
    const values = behaviours
      .map((behaviour) => behaviour.context.metrics[field])
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const firstValue = values[0];
    if (firstValue !== undefined && values.every((value) => value === firstValue)) {
      metrics[field] = firstValue;
    }
  }
  return Object.freeze({
    ...(current.context.cityRef === undefined ? {} : { cityRef: current.context.cityRef }),
    ...(current.context.localityRef === undefined
      ? {}
      : { localityRef: current.context.localityRef }),
    ...(current.context.categoryRef === undefined
      ? {}
      : { categoryRef: current.context.categoryRef }),
    metrics: Object.freeze(metrics),
  });
}

function matchingPolicies(
  material: AosShadowCaseMaterial,
  registry: AosBehaviourRegistry,
): readonly AosBehaviourPolicy[] {
  return registry.policies
    .filter((policy) =>
      material.behaviours.some(
        (behaviour) =>
          evaluateAosBehaviourPolicy(
            policy,
            behaviour.trigger,
            correlatedContext(behaviour, material.behaviours),
          ).matched,
      ),
    )
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
        right.conditions.length - left.conditions.length ||
        left.policyId.localeCompare(right.policyId),
    );
}

function currentBehaviourEvidence(
  material: AosShadowCaseMaterial,
  observedAt: string,
  cycleId: string,
): readonly AosCaseBehaviourEvidence[] {
  return Object.freeze(
    material.behaviours.map((behaviour) =>
      Object.freeze({
        trigger: behaviour.trigger,
        context: behaviour.context,
        observedAt,
        sourceRef: 'aos-cycle:' + cycleId,
      }),
    ),
  );
}

function materialWithMemory(
  material: AosShadowCaseMaterial,
  memory: AosCaseContextMemory | undefined,
): AosShadowCaseMaterial {
  if (memory === undefined) return material;
  return Object.freeze({
    ...material,
    facts: Object.freeze([...memory.facts, ...material.facts]),
    policyRefs: Object.freeze([...new Set([...memory.policyRefs, ...material.policyRefs])].sort()),
    behaviours: Object.freeze([
      ...memory.behaviours.map((behaviour) =>
        Object.freeze({
          trigger: behaviour.trigger,
          context: behaviour.context,
        }),
      ),
      ...material.behaviours,
    ]),
  });
}

function nextCaseContextMemory(input: {
  readonly previous?: AosCaseContextMemory;
  readonly material: AosShadowCaseMaterial;
  readonly subjectRef: string;
  readonly updatedAt: string;
  readonly cycleId: string;
}): AosCaseContextMemory {
  const behaviours = currentBehaviourEvidence(input.material, input.updatedAt, input.cycleId);
  if (input.previous === undefined) {
    return createAosCaseContextMemory({
      caseKey: input.material.caseKey,
      subjectRef: input.subjectRef,
      updatedAt: input.updatedAt,
      facts: input.material.facts,
      behaviours,
      policyRefs: input.material.policyRefs,
    });
  }
  return mergeAosCaseContextMemory({
    previous: input.previous,
    updatedAt: input.updatedAt,
    subjectRef: input.subjectRef,
    facts: input.material.facts,
    behaviours,
    policyRefs: input.material.policyRefs,
  });
}

function hasShadowAuthorityPosture(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record['executionAuthority'] === 'NONE' && record['businessEffect'] === false;
}

function hasBehaviourBindingPosture(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  return (
    record['protocol'] === 'qfj.aos.behaviour-binding.v1' &&
    record['mode'] === 'SUGGEST_SHADOW' &&
    hasShadowAuthorityPosture(value)
  );
}

function hasCaseContextPosture(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record['protocol'] === 'qfj.aos.case-context.v1' && hasShadowAuthorityPosture(value);
}

function validateInput(input: AosShadowCycleInput): void {
  if (
    !REF.test(input.cycleId) ||
    input.batch.observations.length > 10_000 ||
    input.caseMaterial.length > 2_000 ||
    (input.caseContextMemory?.length ?? 0) > 2_000 ||
    !hasShadowAuthorityPosture(input.batch) ||
    (input.aiBudget !== undefined &&
      (!Number.isFinite(input.aiBudget.monthlyBudget) ||
        input.aiBudget.monthlyBudget <= 0 ||
        !Number.isFinite(input.aiBudget.spent) ||
        input.aiBudget.spent < 0)) ||
    (input.behaviourBinding !== undefined &&
      (!hasBehaviourBindingPosture(input.behaviourBinding) ||
        !verifyAosBehaviourRuntimeBinding(input.behaviourBinding)))
  ) {
    throw new TypeError('aos-shadow-cycle-input-invalid');
  }
  const caseKeys = new Set<string>();
  for (const material of input.caseMaterial) {
    if (
      caseKeys.has(material.caseKey) ||
      material.caseKey.length < 1 ||
      material.caseKey.length > 256 ||
      material.behaviours.length < 1 ||
      material.behaviours.length > 32
    ) {
      throw new TypeError('aos-shadow-cycle-material-invalid');
    }
    caseKeys.add(material.caseKey);
  }

  const memoryKeys = new Set<string>();
  for (const memory of input.caseContextMemory ?? []) {
    if (memoryKeys.has(memory.caseKey) || !hasCaseContextPosture(memory)) {
      throw new TypeError('aos-shadow-cycle-context-memory-invalid');
    }
    memoryKeys.add(memory.caseKey);
  }
}

export async function runAosShadowCycle(
  input: AosShadowCycleInput,
  reasoner?: AosModelReasoner,
  persistence?: AosShadowPersistencePort,
  adjudicator?: AosDecisionAdjudicator,
): Promise<AosShadowCycleResult> {
  validateInput(input);
  const registry = input.behaviourBinding?.registry ?? AOS_BEHAVIOUR_REGISTRY_V1;
  const contextMemoryByCase = new Map<string, AosCaseContextMemory>(
    (input.caseContextMemory ?? []).map((memory) => [memory.caseKey, memory]),
  );

  const signals = input.batch.observations
    .map(detectAosObservation)
    .filter((signal) => signal !== undefined);

  const grouped = new Map<string, typeof signals>();
  for (const signal of signals) {
    const existing = grouped.get(signal.caseKey);
    if (existing === undefined) grouped.set(signal.caseKey, [signal]);
    else existing.push(signal);
  }

  const results: AosShadowCaseResult[] = [];
  for (const [caseKey, caseSignals] of grouped.entries()) {
    let currentCase = createAosCase(caseId(caseKey), caseSignals);
    currentCase = transitionAosCase(currentCase, 'ANALYZING');
    const sourceMaterial = input.caseMaterial.find((one) => one.caseKey === caseKey);
    if (sourceMaterial === undefined) {
      results.push(
        Object.freeze({
          case: currentCase,
          route: 'NO_MODEL' as const,
          matchedPolicyRefs: Object.freeze([]),
          reason: 'EVIDENCE_MISSING' as const,
        }),
      );
      continue;
    }

    const previousMemory = contextMemoryByCase.get(caseKey);
    const material = materialWithMemory(sourceMaterial, previousMemory);
    contextMemoryByCase.set(
      caseKey,
      nextCaseContextMemory({
        ...(previousMemory === undefined ? {} : { previous: previousMemory }),
        material: sourceMaterial,
        subjectRef: currentCase.subjectRef,
        updatedAt: input.batch.generatedAt,
        cycleId: input.cycleId,
      }),
    );

    const matched = matchingPolicies(material, registry);
    const matchedPolicyRefs = Object.freeze(matched.map(policyRef));
    if (matched.length === 0) {
      results.push(
        Object.freeze({
          case: currentCase,
          route: 'NO_MODEL' as const,
          matchedPolicyRefs,
          reason: 'NO_POLICY_MATCH' as const,
        }),
      );
      continue;
    }

    const packet = buildAosEvidencePacket({
      case: currentCase,
      facts: material.facts,
      policyRefs: [...material.policyRefs, ...matchedPolicyRefs],
      generatedAt: input.batch.generatedAt,
    });
    const budgetGate =
      input.aiBudget === undefined
        ? undefined
        : evaluateAosAiBudget({
            monthlyBudget: input.aiBudget.monthlyBudget,
            spent: input.aiBudget.spent,
            priority: currentCase.priority,
          });
    const route = chooseAosModelRoute({
      priority: currentCase.priority,
      ...material.routing,
      deterministicRecommendationAvailable: true,
      routineBudgetAvailable:
        material.routing.routineBudgetAvailable && (budgetGate?.routineAllowed ?? true),
      deepBudgetAvailable:
        material.routing.deepBudgetAvailable && (budgetGate?.deepAllowed ?? true),
    });
    const allowedActions = Object.freeze([
      ...new Set(matched.map((policy) => recommendationActionForBehaviour(policy.action))),
    ]);

    let recommendation: AosRecommendation | undefined;
    let critique: AosCritique | undefined;
    let adjudication: AosAdjudicationDecision | undefined;
    let reason: AosShadowCaseReason;
    const modelEscalationRequired =
      currentCase.priority === 'P0' ||
      material.routing.evidenceConflictCount > 0 ||
      material.routing.noveltyScore >= 0.8;

    if (route === 'NO_MODEL' && modelEscalationRequired) {
      reason = 'MODEL_REQUIRED_BUT_UNAVAILABLE';
    } else if (route === 'NO_MODEL') {
      const primary = matched[0];
      if (primary === undefined) throw new TypeError('aos-shadow-cycle-policy-invalid');
      recommendation = createAosRecommendation(packet, {
        recommendationId: 'recommendation.' + currentCase.caseId + '.policy',
        action: recommendationActionForBehaviour(primary.action),
        confidence: 1,
        rationale: 'Deterministic governed behaviour policy matched the current evidence.',
        alternatives: allowedActions.slice(1),
        evidenceRefs: packet.facts.map((fact) => fact.factId),
        policyRefs: matchedPolicyRefs,
        requiresOwnerReview: primary.ownerApprovalRequired,
      });
      critique = critiqueAosRecommendation(currentCase, packet, recommendation);
      reason = critique.result === 'PASS' ? 'DETERMINISTIC_RECOMMENDATION' : 'CRITIC_HOLD';
    } else if (reasoner === undefined) {
      reason = 'MODEL_REQUIRED_BUT_UNAVAILABLE';
    } else {
      const model = await reasoner.reason({
        runId: input.cycleId + '.' + currentCase.caseId,
        packet,
        route,
        allowedActions,
        routingSignals: {
          priority: currentCase.priority,
          noveltyScore: material.routing.noveltyScore,
          evidenceConflictCount: material.routing.evidenceConflictCount,
          highRisk:
            currentCase.priority === 'P0' || matched.some((policy) => policy.ownerApprovalRequired),
        },
      });
      if (!model.ok) {
        reason = 'MODEL_REFUSED';
      } else {
        recommendation = createAosRecommendation(packet, model.candidate);
        critique = critiqueAosRecommendation(currentCase, packet, recommendation);
        reason = critique.result === 'PASS' ? 'MODEL_RECOMMENDATION' : 'CRITIC_HOLD';
      }
    }

    if (recommendation !== undefined && critique?.result === 'PASS') {
      if (adjudicator !== undefined) {
        adjudication = await adjudicator.adjudicate({
          caseRef: currentCase.caseId,
          recommendation,
          signals: {
            priority: currentCase.priority,
            noveltyScore: material.routing.noveltyScore,
            evidenceConflictCount: material.routing.evidenceConflictCount,
            recommendationConfidence: recommendation.confidence,
            ownerReviewAlreadyRequired: recommendation.requiresOwnerReview,
          },
        });
        if (adjudication.outcome === 'HOLD_FOR_HUMAN_REVIEW') {
          reason = 'ADJUDICATION_HOLD';
        }
      }
      currentCase = transitionAosCase(currentCase, 'RECOMMENDED');
    } else {
      recommendation = undefined;
    }

    results.push(
      Object.freeze({
        case: currentCase,
        route,
        matchedPolicyRefs,
        ...(recommendation === undefined ? {} : { recommendation }),
        ...(critique === undefined ? {} : { critique }),
        ...(adjudication === undefined ? {} : { adjudication }),
        reason,
      }),
    );
  }

  if (persistence !== undefined) {
    for (const one of results) {
      await persistence.appendCaseSnapshot({
        case: one.case,
        storedAt: input.batch.generatedAt,
      });
      if (one.recommendation !== undefined) {
        await persistence.appendRecommendation({
          recommendation: one.recommendation,
          storedAt: input.batch.generatedAt,
        });
      }
    }
    if (persistence.appendCaseContextMemory !== undefined) {
      for (const memory of contextMemoryByCase.values()) {
        await persistence.appendCaseContextMemory({
          memory,
          storedAt: input.batch.generatedAt,
        });
      }
    }
  }

  return Object.freeze({
    protocol: 'qfj.aos.shadow-cycle.v1' as const,
    cycleId: input.cycleId,
    observations: input.batch.observations.length,
    signals: signals.length,
    cases: Object.freeze(results),
    recommendations: results.filter((result) => result.recommendation !== undefined).length,
    caseContextMemory: Object.freeze(
      [...contextMemoryByCase.values()].sort((left, right) =>
        left.caseKey.localeCompare(right.caseKey),
      ),
    ),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
