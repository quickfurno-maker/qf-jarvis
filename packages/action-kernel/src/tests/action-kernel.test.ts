import { describe, expect, it, vi } from 'vitest';
import type { CoreDecisionRequest } from '@qf-jarvis/agent-runtime';
import { createActionKernel } from '../index.js';

const REQUEST: CoreDecisionRequest = Object.freeze({
  proposalId: 'proposal.1',
  proposalVersion: 1,
  conversationId: 'conversation.1',
  expectedRevision: 7,
  assignedActor: 'RIYA',
  partyType: 'CLIENT',
  proposalKind: 'REPLY',
  structuredIntent: Object.freeze({ requirement: 'kitchen' }),
  policyRevision: 'policy.1',
  evaluationRef: undefined,
  citations: Object.freeze([]),
  proposedReplyBody: 'bounded draft',
});

it('single-flights identical in-flight submissions and still grants no authority', async () => {
  let resolve!: (value: { outcome: 'ACCEPTED' }) => void;
  const pending = new Promise<{ outcome: 'ACCEPTED' }>((done) => {
    resolve = done;
  });
  const decide = vi.fn(() => pending);
  const kernel = createActionKernel({ coreDecision: { decide } });
  const a = kernel.submit(REQUEST);
  const b = kernel.submit(REQUEST);
  expect(decide).toHaveBeenCalledTimes(1);
  resolve({ outcome: 'ACCEPTED' });
  const [ra, rb] = await Promise.all([a, b]);
  expect(ra).toEqual(rb);
  expect(ra.canExecute).toBe(false);
  expect(ra.executionAuthority).toBe('NONE');
});

describe('capability firewall', () => {
  it('keeps Temporal and Jarvis outside execution authority', () => {
    const kernel = createActionKernel({
      coreDecision: { decide: () => Promise.resolve({ outcome: 'REJECTED' as const }) },
    });
    expect(kernel.capabilities()).toMatchObject({
      quickFurnoCoreIsAuthority: true,
      quickFurnoCoreAutomationIsExecutor: true,
      temporalIsCoordinationOnly: true,
      temporalCanAuthorize: false,
      temporalCanExecuteBusinessEffects: false,
      directBusinessMutation: 'FORBIDDEN',
      directCoreAutomationCall: 'FORBIDDEN',
      directProviderCall: 'FORBIDDEN',
      executionAuthority: 'NONE',
    });
    const surface = kernel as unknown as Record<string, unknown>;
    for (const forbidden of ['execute', 'send', 'authorize', 'callCoreAutomation']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});
