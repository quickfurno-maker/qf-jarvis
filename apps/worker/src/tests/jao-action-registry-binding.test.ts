import {
  createJaoActionRegistry,
  JAO_ENGINEERING_REGISTRY_V1,
  type JaoActionDefinition,
} from '@qf-jarvis/jao-action-registry';
import { describe, expect, it, vi } from 'vitest';

import {
  proposeRegisteredJaoAction,
  proposeRegisteredJaoActionInternal,
} from '../jao/registered-action-proposal.js';
import { REQUEST } from './jao6-fixtures.js';

function action(actionId: string): JaoActionDefinition {
  const found = JAO_ENGINEERING_REGISTRY_V1.actions.find((one) => one.actionId === actionId);
  if (found === undefined) throw new Error('engineering-action-missing');
  return found;
}

function enabled(actionId: string) {
  return createJaoActionRegistry({
    registryRef: `qfj.jao-action-registry.test-reviewed.${actionId}.v1`,
    actions: [{ ...action(actionId), enabled: true }],
  });
}

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
  it('canonical engineering registry refuses before invoking any binding', () => {
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
    const result = proposeRegisteredJaoActionInternal(
      admission,
      enabled('propose_vendor_follow_up'),
      proposer,
    );
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
      enabled('propose_vendor_follow_up'),
      proposer,
    );
    expect(result.outcome).toBe('BINDING_MISMATCH');
    expect(proposer).not.toHaveBeenCalled();
  });

  it('builds a powerless human-takeover proposal rather than a control command', () => {
    const proposer = vi.fn();
    const result = proposeRegisteredJaoActionInternal(
      {
        ...admission,
        actionId: 'request_human_takeover',
        agentScope: 'RIYA',
        proposalRequest: {
          conversationId: 'conversation.1',
          reasonCode: 'human-help-requested',
        },
      },
      enabled('request_human_takeover'),
      proposer,
    );

    expect(result).toEqual({
      outcome: 'HUMAN_TAKEOVER_PROPOSAL_READY',
      assessment: {
        actionId: 'request_human_takeover',
        actionVersion: 1,
        registryRef: 'qfj.jao-action-registry.test-reviewed.request_human_takeover.v1',
        effectClass: 'CORE_PROPOSAL',
        bindingRef: 'conversation.human-takeover.v1',
        decision: 'ELIGIBLE_FOR_PROPOSAL',
      },
      proposal: {
        protocol: 'qfj.jao.human-takeover-proposal.v1',
        conversationId: 'conversation.1',
        requestedAction: 'TAKE_OWNERSHIP',
        reasonCode: 'human-help-requested',
        businessEffect: false,
        controlCommandCreated: false,
      },
    });
    expect(proposer).not.toHaveBeenCalled();
    if (result.outcome === 'HUMAN_TAKEOVER_PROPOSAL_READY') {
      expect('operatorRef' in result.proposal).toBe(false);
      expect('expectedRevision' in result.proposal).toBe(false);
      expect('commandId' in result.proposal).toBe(false);
    }
  });

  it('builds a content-minimized Temporal request without starting a workflow', () => {
    const proposer = vi.fn();
    const result = proposeRegisteredJaoActionInternal(
      {
        ...admission,
        actionId: 'start_governed_followup',
        proposalRequest: {
          journey: {
            protocol: 'qfj.temporal.orchestration.v1',
            journeyId: 'journey.1',
            kind: 'FOUNDER_TASK',
            actor: 'JARVIS',
            subjectRef: 'founder-attention.1',
            startedFromEventRef: 'event.1',
            policyRevision: 'policy.followup.1',
            generation: 0,
            cycleBase: 0,
          },
          wake: {
            eventRef: 'event.1',
            reasonCode: 'followup-requested',
          },
        },
      },
      enabled('start_governed_followup'),
      proposer,
    );

    expect(result).toMatchObject({
      outcome: 'TEMPORAL_REQUEST_READY',
      assessment: {
        decision: 'ELIGIBLE_FOR_PROPOSAL',
        bindingRef: 'temporal.governed-followup.v1',
      },
      request: {
        protocol: 'qfj.jao.temporal-followup-request.v1',
        businessEffect: false,
        workflowStarted: false,
      },
    });
    expect(proposer).not.toHaveBeenCalled();
    if (result.outcome === 'TEMPORAL_REQUEST_READY') {
      expect(result.request.journey.actor).toBe('JARVIS');
      expect(result.request.wake.reasonCode).toBe('followup-requested');
      expect('client' in result.request).toBe(false);
    }
  });

  it('fails closed on malformed takeover and Temporal binding payloads', () => {
    const proposer = vi.fn();
    const takeover = proposeRegisteredJaoActionInternal(
      {
        ...admission,
        actionId: 'request_human_takeover',
        proposalRequest: {
          conversationId: 'conversation.1',
          reasonCode: 'bad reason with prose',
          operatorRef: 'operator.1',
        },
      },
      enabled('request_human_takeover'),
      proposer,
    );
    const temporal = proposeRegisteredJaoActionInternal(
      {
        ...admission,
        actionId: 'start_governed_followup',
        proposalRequest: {
          journey: {
            protocol: 'qfj.temporal.orchestration.v1',
            journeyId: 'journey.1',
            kind: 'CLIENT_SUCCESS',
            actor: 'JARVIS',
            subjectRef: 'client.1',
            startedFromEventRef: 'event.1',
            policyRevision: 'policy.followup.1',
          },
          wake: { eventRef: 'event.1', reasonCode: 'followup-requested' },
        },
      },
      enabled('start_governed_followup'),
      proposer,
    );
    expect(takeover.outcome).toBe('BINDING_MISMATCH');
    expect(temporal.outcome).toBe('BINDING_MISMATCH');
    expect(proposer).not.toHaveBeenCalled();
  });
});
