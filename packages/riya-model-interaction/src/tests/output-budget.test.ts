/**
 * POST-S11 REQUEST-CONTRACT REPAIR — the Riya completion budget is DERIVED from the schema.
 *
 * S11 proved the exact request path is sensitive to the production high completion cap: D1 (minimal
 * strict schema, tiny messages, 512) returned HTTP 200 and D2 (identical but 65,536) returned HTTP
 * 413. The repair is not to lower the model's published capability — it is to stop every invocation
 * asking for the whole of it.
 *
 * These specs exist so the budget cannot become a guess. They re-derive it from the schema's own
 * maxima and pin the governed constant against that derivation, so widening a bound fails here rather
 * than silently re-budgeting production.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveRiyaCompletionBudgetTokens,
  largestValidRiyaStructuredOutput,
  maxRiyaStructuredOutputBytes,
  PESSIMISTIC_BYTES_PER_TOKEN,
  RIYA_COMPLETION_BUDGET_TOKENS,
} from '../internal/output-budget.js';
import { riyaStructuredOutputSchema } from '../internal/output-schema.js';

describe('the worst case is a fact about the schema, not an estimate', () => {
  it('the constructed largest document is actually schema-valid', () => {
    // If this ever fails, the measurement below is measuring something Riya would refuse.
    expect(riyaStructuredOutputSchema.safeParse(largestValidRiyaStructuredOutput()).success).toBe(
      true,
    );
  });

  it('every bounded field is filled to its maximum', () => {
    const largest = largestValidRiyaStructuredOutput() as {
      reply: { replyBody: string; reasonCode: string; citations: unknown[] };
      evolution: { observations: unknown[]; questionPlan: { questionFields: unknown[] } };
    };
    expect(largest.reply.replyBody).toHaveLength(2500);
    expect(largest.reply.reasonCode).toHaveLength(64);
    expect(largest.reply.citations).toHaveLength(64);
    // One observation per governed discovery field — the schema's array maximum.
    expect(largest.evolution.observations).toHaveLength(7);
    expect(largest.evolution.questionPlan.questionFields).toHaveLength(2);
  });

  it('the measured worst case is a positive byte count', () => {
    expect(maxRiyaStructuredOutputBytes()).toBeGreaterThan(0);
  });
});

describe('the governed budget is the derivation, pinned', () => {
  it('RIYA_COMPLETION_BUDGET_TOKENS equals the derivation', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(deriveRiyaCompletionBudgetTokens());
  });

  it('it covers the schema worst case under the pessimistic token ratio', () => {
    const bytes = maxRiyaStructuredOutputBytes();
    // The budget must be able to carry every schema-legal document. A budget that truncates a legal
    // answer produces malformed strict JSON, which would read as a model quality failure.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeGreaterThanOrEqual(
      Math.ceil(bytes / PESSIMISTIC_BYTES_PER_TOKEN),
    );
  });

  it('it is far below the model capability ceiling, which is the whole point', () => {
    // The model-level maximum stays 65,536; this is an APPLICATION budget and must be much smaller,
    // or the repair would have changed nothing.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(65_536 / 2);
  });
});
