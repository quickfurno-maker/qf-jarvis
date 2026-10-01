import type { AosPriority } from './contracts.js';

export const AOS_AI_BUDGET_LEVELS = ['NORMAL', 'CONSERVE', 'CRITICAL', 'EXHAUSTED'] as const;
export type AosAiBudgetLevel = (typeof AOS_AI_BUDGET_LEVELS)[number];

export interface AosAiBudgetPolicy {
  readonly conserveAt: number;
  readonly criticalAt: number;
  readonly exhaustedAt: number;
}

export const DEFAULT_AOS_AI_BUDGET_POLICY: AosAiBudgetPolicy = Object.freeze({
  conserveAt: 0.7,
  criticalAt: 0.85,
  exhaustedAt: 1,
});

export interface AosAiBudgetInput {
  readonly monthlyBudget: number;
  readonly spent: number;
  readonly priority: AosPriority;
}

export interface AosAiBudgetDecision {
  readonly level: AosAiBudgetLevel;
  readonly utilization: number;
  readonly routineAllowed: boolean;
  readonly deepAllowed: boolean;
  readonly asynchronousBatchPreferred: boolean;
  readonly reasonCode: 'BUDGET_NORMAL' | 'BUDGET_CONSERVE' | 'BUDGET_CRITICAL' | 'BUDGET_EXHAUSTED';
  readonly executionAuthority: 'NONE';
}

function validatePolicy(policy: AosAiBudgetPolicy): void {
  if (
    !Number.isFinite(policy.conserveAt) ||
    !Number.isFinite(policy.criticalAt) ||
    !Number.isFinite(policy.exhaustedAt) ||
    policy.conserveAt <= 0 ||
    policy.conserveAt >= policy.criticalAt ||
    policy.criticalAt >= policy.exhaustedAt ||
    policy.exhaustedAt < 1
  ) {
    throw new TypeError('aos-ai-budget-policy-invalid');
  }
}

export function evaluateAosAiBudget(
  input: AosAiBudgetInput,
  policy: AosAiBudgetPolicy = DEFAULT_AOS_AI_BUDGET_POLICY,
): AosAiBudgetDecision {
  validatePolicy(policy);
  if (
    !Number.isFinite(input.monthlyBudget) ||
    input.monthlyBudget <= 0 ||
    !Number.isFinite(input.spent) ||
    input.spent < 0
  ) {
    throw new TypeError('aos-ai-budget-input-invalid');
  }

  const utilization = input.spent / input.monthlyBudget;
  if (utilization >= policy.exhaustedAt) {
    return Object.freeze({
      level: 'EXHAUSTED' as const,
      utilization,
      routineAllowed: false,
      deepAllowed: false,
      asynchronousBatchPreferred: true,
      reasonCode: 'BUDGET_EXHAUSTED' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  if (utilization >= policy.criticalAt) {
    return Object.freeze({
      level: 'CRITICAL' as const,
      utilization,
      routineAllowed: input.priority === 'P0' || input.priority === 'P1',
      deepAllowed: input.priority === 'P0',
      asynchronousBatchPreferred: true,
      reasonCode: 'BUDGET_CRITICAL' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  if (utilization >= policy.conserveAt) {
    return Object.freeze({
      level: 'CONSERVE' as const,
      utilization,
      routineAllowed: input.priority !== 'P3',
      deepAllowed: input.priority === 'P0' || input.priority === 'P1',
      asynchronousBatchPreferred: input.priority === 'P2' || input.priority === 'P3',
      reasonCode: 'BUDGET_CONSERVE' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  return Object.freeze({
    level: 'NORMAL' as const,
    utilization,
    routineAllowed: true,
    deepAllowed: true,
    asynchronousBatchPreferred: input.priority === 'P3',
    reasonCode: 'BUDGET_NORMAL' as const,
    executionAuthority: 'NONE' as const,
  });
}
