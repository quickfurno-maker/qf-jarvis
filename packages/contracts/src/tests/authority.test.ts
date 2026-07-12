/**
 * The authority boundary, as tests.
 *
 * Each of these corresponds to one line of the permanent rule. If any of them ever
 * goes green in the wrong direction, the architecture has a hole in it — and it
 * would be a hole nobody could see by reading the code, because the shapes would
 * still typecheck.
 */

import { describe, expect, it } from 'vitest';

import {
  cloneFixture,
  validApprovalDecisionByHuman,
  validExecutionIntent,
  validExecutionResultIndeterminate,
} from '../fixtures/index.js';
import {
  safeParseApprovalDecision,
  safeParseExecutionIntent,
  safeParseExecutionResult,
  safeParseRecommendation,
} from '../index.js';
import { validActionableRecommendation } from '../fixtures/valid.js';

describe('Jarvis recommends — and only Jarvis recommends', () => {
  it('accepts a recommendation produced by qf-jarvis', () => {
    expect(safeParseRecommendation(cloneFixture(validActionableRecommendation)).success).toBe(true);
  });

  it.each(['quickfurno-core', 'n8n', 'qf-communications-runtime'])(
    'refuses a recommendation produced by %s',
    (system) => {
      const forged = { ...cloneFixture(validActionableRecommendation), producingSystem: system };
      expect(safeParseRecommendation(forged).success).toBe(false);
    },
  );
});

describe('QuickFurno authorizes — Jarvis may not mark its own recommendation approved', () => {
  it.each(['qf-jarvis', 'n8n', 'qf-communications-runtime'])(
    'refuses an approval decision issued by %s',
    (system) => {
      const forged = { ...cloneFixture(validApprovalDecisionByHuman), issuer: system };
      expect(safeParseApprovalDecision(forged).success).toBe(false);
    },
  );

  it.each([
    ['an agent', { actorType: 'agent', agentId: 'jarvis' }],
    ['a system', { actorType: 'system', systemId: 'qf-jarvis' }],
    ['a bare agent name', 'jarvis'],
  ])('refuses %s as the deciding actor: the shape does not exist', (_label, actor) => {
    const forged = { ...cloneFixture(validApprovalDecisionByHuman), decidedBy: actor };
    expect(safeParseApprovalDecision(forged).success).toBe(false);
  });

  it('accepts only a named human or a named, versioned policy', () => {
    const byHuman = cloneFixture(validApprovalDecisionByHuman);
    expect(safeParseApprovalDecision(byHuman).success).toBe(true);

    const byPolicy = {
      ...cloneFixture(validApprovalDecisionByHuman),
      decidedBy: { actorType: 'policy', policyId: 'low-risk', policyVersion: 2 },
    };
    expect(safeParseApprovalDecision(byPolicy).success).toBe(true);
  });

  it('refuses a policy with no version: "the policy allowed it" is not an audit record', () => {
    const unversioned = {
      ...cloneFixture(validApprovalDecisionByHuman),
      decidedBy: { actorType: 'policy', policyId: 'low-risk' },
    };
    expect(safeParseApprovalDecision(unversioned).success).toBe(false);
  });
});

describe('Jarvis may not generate a valid Core-issued execution intent', () => {
  it('accepts an intent issued by Core and executed by n8n', () => {
    expect(safeParseExecutionIntent(cloneFixture(validExecutionIntent)).success).toBe(true);
  });

  it.each(['qf-jarvis', 'n8n', 'qf-communications-runtime'])(
    'refuses an intent issued by %s',
    (system) => {
      const forged = { ...cloneFixture(validExecutionIntent), issuer: system };
      expect(safeParseExecutionIntent(forged).success).toBe(false);
    },
  );

  it.each(['qf-jarvis', 'quickfurno-core', 'whatsapp-provider', 'twilio'])(
    'refuses an intent executed by %s — only n8n executes',
    (executor) => {
      const forged = { ...cloneFixture(validExecutionIntent), executor };
      expect(safeParseExecutionIntent(forged).success).toBe(false);
    },
  );
});

describe('at-most-once execution', () => {
  it('requires an idempotency key', () => {
    const intent: Record<string, unknown> = cloneFixture(validExecutionIntent);
    delete intent['idempotencyKey'];

    expect(safeParseExecutionIntent(intent).success).toBe(false);
  });

  it('refuses a short idempotency key, because a short key is a colliding key', () => {
    const forged = { ...cloneFixture(validExecutionIntent), idempotencyKey: 'abc' };
    expect(safeParseExecutionIntent(forged).success).toBe(false);
  });

  it.each(['at-least-once', 'exactly-once', 'best-effort'])(
    'refuses delivery semantics of %s',
    (semantics) => {
      const forged = { ...cloneFixture(validExecutionIntent), deliverySemantics: semantics };
      expect(safeParseExecutionIntent(forged).success).toBe(false);
    },
  );

  it.each([
    ['autoRetry', { autoRetry: true }],
    ['retries', { retries: 3 }],
    ['maxAttempts', { maxAttempts: 5 }],
    ['redial', { redial: true }],
    ['resend', { resend: true }],
  ])('refuses retry permission smuggled into parameters as %s', (_label, extra) => {
    const forged = {
      ...cloneFixture(validExecutionIntent),
      parameters: { templateId: 'client-followup-v2', ...extra },
    };
    expect(safeParseExecutionIntent(forged).success).toBe(false);
  });
});

describe('an ambiguous provider outcome is never a success', () => {
  it('accepts indeterminate when it is classified for reconciliation', () => {
    expect(safeParseExecutionResult(cloneFixture(validExecutionResultIndeterminate)).success).toBe(
      true,
    );
  });

  it('refuses an indeterminate result classified as retryable', () => {
    const forged = {
      ...cloneFixture(validExecutionResultIndeterminate),
      failure: {
        failureCode: 'provider.no-terminal-status',
        failureCategory: 'ambiguous',
        retryClassification: 'retryable',
      },
    };

    expect(safeParseExecutionResult(forged).success).toBe(false);
  });

  it('refuses an indeterminate result with no failure at all', () => {
    const forged: Record<string, unknown> = cloneFixture(validExecutionResultIndeterminate);
    delete forged['failure'];

    expect(safeParseExecutionResult(forged).success).toBe(false);
  });

  it('refuses a success that carries a failure', () => {
    const forged = { ...cloneFixture(validExecutionResultIndeterminate), outcome: 'succeeded' };
    expect(safeParseExecutionResult(forged).success).toBe(false);
  });

  it('refuses a result reported by Jarvis, which executes nothing and observes nothing', () => {
    const forged = {
      ...cloneFixture(validExecutionResultIndeterminate),
      reportingSystem: 'qf-jarvis',
    };
    expect(safeParseExecutionResult(forged).success).toBe(false);
  });
});
