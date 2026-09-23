import {
  createJaoActionRegistry,
  JAO_ENGINEERING_REGISTRY_V1,
} from '@qf-jarvis/jao-action-registry';
import { describe, expect, it, vi } from 'vitest';

import {
  proposeRegisteredJaoAction,
  proposeRegisteredJaoActionInternal,
} from '../jao/registered-action-proposal.js';
import { REQUEST } from './jao6-fixtures.js';

const engineeringAction = JAO_ENGINEERING_REGISTRY_V1.actions[0];
if (engineeringAction === undefined) throw new Error('engineering-action-missing');

const enabledRegistry = createJaoActionRegistry({
  registryRef: 'qfj.jao-action-registry.test-reviewed.v1',
  actions: [{ ...engineeringAction, enabled: true }],
});

const admission = {
  actionId: 'propose_vendor_follow_up',
  actionVersion: 1,
  agentScope: 'JARVIS' as const,
  maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE' as const,
  authorityEvidenceRef: 'authority.evidence.1',
  approvalEvidenceRef: 'approval.evidence.1',
  proposalRequest: REQUEST(),
};

describe('registered JAO action proposal binding', () => {
  it('canonical engineering registry refuses before invoking JAO-6', () => {
    const result = proposeRegisteredJaoAction(admission);
    expect(result).toMatchObject({
      outcome: 'REGISTRY_REFUSED',
      assessment: { decision: 'ACTION_DISABLED', actionId: 'propose_vendor_follow_up' },
    });
  });

  it('an enabled reviewed binding enters only the existing JAO-6 proposal path', () => {
    const proposal = {
      outcome: 'REFUSED' as const,
      refusalReason: 'REQUEST_INVALID' as const,
      proposalPolicyId: 'jao6.vendor-follow-up',
      proposalPolicyVersion: 1,
      correlationId: '3f2c1a44-0d1e-4a7b-9c2e-1b0a5d6e7f80',
      recommendation: null,
      actionBindings: [] as const,
      approvalRequest: null,
      posture: {
        mode: 'SHADOW' as const,
        authority: 'RECOMMEND_ONLY' as const,
        businessEffect: false as const,
        productionMutation: false as const,
        approvalDecisionCreated: false as const,
        executionIntentCreated: false as const,
        communicationAuthorizationCreated: false as const,
        communicationEligibilityChecked: false as const,
        coreMutations: 0 as const,
        coreAutomationExecutions: 0 as const,
        channelSends: 0 as const,
        providerCalls: 0 as const,
        modelCalls: 0 as const,
        specialistCalls: 0 as const,
        toolCalls: 0 as const,
        memoryWrites: 0 as const,
      },
      communicationExecutionEligibilityRequired: true,
      executionEligibilityNotice:
        'This proposal is NOT send permission. Consent, opt-out, suppression and STOP eligibility must be re-read at execution time through the existing QuickFurno Core and communications path.',
    };
    const proposer = vi.fn().mockReturnValue(proposal);
    const result = proposeRegisteredJaoActionInternal(admission, enabledRegistry, proposer);
    expect(result).toMatchObject({
      outcome: 'PROPOSAL_PATH_ENTERED',
      assessment: {
        decision: 'ELIGIBLE_FOR_PROPOSAL',
        bindingRef: 'jao6.vendor-follow-up.v1',
      },
    });
    expect(proposer).toHaveBeenCalledOnce();
    expect('executed' in result).toBe(false);
    expect('authorized' in result).toBe(false);
  });

  it('refuses a request that tries to switch the bound JAO-6 policy', () => {
    const proposer = vi.fn();
    const result = proposeRegisteredJaoActionInternal(
      {
        ...admission,
        proposalRequest: REQUEST({ proposalPolicyId: 'jao6.vendor-quotation-escalation' }),
      },
      enabledRegistry,
      proposer,
    );
    expect(result.outcome).toBe('BINDING_MISMATCH');
    expect(proposer).not.toHaveBeenCalled();
  });
});
