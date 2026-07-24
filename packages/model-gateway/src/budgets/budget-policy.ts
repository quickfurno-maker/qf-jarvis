/**
 * Injectable token/cost budget policy (QFJ-P04.01A, ADR-0045).
 *
 * The gateway refuses a request that would exceed its budget rather than silently truncating it into a
 * wrong answer. Budgets are an INJECTABLE policy (so a real per-agent/aggregate accounting policy can
 * replace the default later without touching the gateway). No billing system and no database in this
 * slice; the default is a deterministic in-memory estimate. The gateway carries NO financial authority.
 */
import type { ModelRequest } from '../contracts/request.js';
import type { ModelUsage } from '../contracts/response.js';

/** A budget admission decision. `code` is present iff `admitted` is false. */
export type BudgetDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: 'token-budget-exceeded' | 'cost-budget-exceeded' };

/** The gateway's budget policy: admit before invocation, settle actual usage after. */
export interface GatewayBudgetPolicy {
  admit(request: ModelRequest): BudgetDecision;
  settle(request: ModelRequest, usage: ModelUsage): void;
}

/** A deterministic rough estimate of a request's input tokens (≈ 4 chars/token). Never a wall clock. */
export function estimateInputTokens(request: ModelRequest): number {
  let chars = 0;
  for (const message of request.messages) {
    chars += message.content.length;
  }
  return Math.ceil(chars / 4);
}

/** Optional aggregate caps for the default policy. */
export interface EstimatedBudgetPolicyConfig {
  readonly costPerInputToken?: number;
  readonly aggregateTokenBudget?: number;
  readonly aggregateCostBudget?: number;
}

/**
 * The deterministic default budget policy: it enforces each request's own `tokenBudget`/`costBudget`
 * against a rough estimate, plus optional aggregate caps. Fully in-memory and side-effect-free beyond
 * its own counters.
 */
export function createEstimatedBudgetPolicy(
  config: EstimatedBudgetPolicyConfig = {},
): GatewayBudgetPolicy {
  const costPerInputToken = config.costPerInputToken ?? 0;
  let spentTokens = 0;
  let spentCost = 0;

  return {
    admit(request: ModelRequest): BudgetDecision {
      const estimatedTokens = estimateInputTokens(request);
      const estimatedCost = estimatedTokens * costPerInputToken;

      if (estimatedTokens > request.tokenBudget) {
        return { admitted: false, code: 'token-budget-exceeded' };
      }
      if (
        config.aggregateTokenBudget !== undefined &&
        spentTokens + estimatedTokens > config.aggregateTokenBudget
      ) {
        return { admitted: false, code: 'token-budget-exceeded' };
      }
      if (estimatedCost > request.costBudget) {
        return { admitted: false, code: 'cost-budget-exceeded' };
      }
      if (
        config.aggregateCostBudget !== undefined &&
        spentCost + estimatedCost > config.aggregateCostBudget
      ) {
        return { admitted: false, code: 'cost-budget-exceeded' };
      }
      return { admitted: true };
    },

    settle(request: ModelRequest, usage: ModelUsage): void {
      spentTokens += usage.totalTokens ?? estimateInputTokens(request);
      spentCost += usage.cost ?? estimateInputTokens(request) * costPerInputToken;
    },
  };
}
