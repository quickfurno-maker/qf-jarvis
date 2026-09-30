import { describe, expect, it } from 'vitest';

import {
  AAROHI_ACQUISITION_FLOW_V1,
  ANISHA_VENDOR_FLOW_V1,
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
} from '@qf-jarvis/agent-flow-registry';
import { createJaoActionRegistry } from '@qf-jarvis/jao-action-registry';

import {
  AAROHI_PHASE3_ORCHESTRATION_V1,
  AGENT_FLOW_ALL_VIEW_V1,
  ANISHA_PHASE3_ORCHESTRATION_V1,
  PHASE3_ORCHESTRATION_PROFILES,
  RIYA_PHASE3_ORCHESTRATION_V1,
  assessAgentFlowHumanHandoff,
  createAgentFlowDurableRetryPlan,
  createAgentFlowDurableWaitPlan,
  createAgentFlowResumeSignal,
  createAgentFlowSoftOrchestrationProfile,
  evaluateAgentFlowRoute,
  prepareAgentFlowCrossAgentHandoff,
  validateAgentFlowSoftOrchestrationProfile,
} from '../index.js';

describe('Agent Flow Studio Phase 3 orchestration', () => {
  it('ships one valid controlled profile for every governed agent', () => {
    expect(PHASE3_ORCHESTRATION_PROFILES.map((profile) => profile.actor)).toEqual([
      'RIYA',
      'ANISHA',
      'AAROHI',
    ]);
    for (const [flow, profile] of [
      [RIYA_PHASE3_CONTROLLED_FLOW_V2, RIYA_PHASE3_ORCHESTRATION_V1],
      [ANISHA_VENDOR_FLOW_V1, ANISHA_PHASE3_ORCHESTRATION_V1],
      [AAROHI_ACQUISITION_FLOW_V1, AAROHI_PHASE3_ORCHESTRATION_V1],
    ] as const) {
      expect(validateAgentFlowSoftOrchestrationProfile({ flow, profile })).toEqual({
        valid: true,
        issues: [],
        actor: flow.actor,
        flowId: flow.flowId,
      });
    }
  });

  it('routes only on closed typed conditions', () => {
    expect(
      evaluateAgentFlowRoute({
        profile: RIYA_PHASE3_ORCHESTRATION_V1,
        routeId: 'riya.next.wait',
        signals: { 'control.waitRequired': true },
      }),
    ).toMatchObject({ decision: 'ROUTE', matched: true, nextNodeId: 'riya.wait.durable' });
    expect(
      evaluateAgentFlowRoute({
        profile: RIYA_PHASE3_ORCHESTRATION_V1,
        routeId: 'riya.next.wait',
        signals: {},
      }),
    ).toEqual({ decision: 'SIGNAL_MISSING', routeId: 'riya.next.wait' });
  });

  it('compiles a bounded Riya wait onto the existing durable contract with no authority', () => {
    const plan = createAgentFlowDurableWaitPlan({
      profile: RIYA_PHASE3_ORCHESTRATION_V1,
      waitPolicyId: 'riya.wait.client-followup.24h.v1',
      journeyId: 'journey-1',
      subjectRef: 'client-1',
      conversationRef: 'conversation-1',
      startedFromEventRef: 'event-1',
      policyRevision: 'phase3-v1',
    });
    expect(plan.start).toMatchObject({ kind: 'CLIENT_SUCCESS', actor: 'RIYA' });
    expect(plan.directive).toMatchObject({ disposition: 'WAIT', coreOutcome: 'NONE' });
    expect(plan.authority).toBe('NONE');
    expect(plan.canExecute).toBe(false);
  });

  it('maps Anisha and Aarohi to their existing durable journey kinds', () => {
    const build = (
      profile: typeof ANISHA_PHASE3_ORCHESTRATION_V1 | typeof AAROHI_PHASE3_ORCHESTRATION_V1,
      waitPolicyId: string,
      subjectRef: string,
    ) =>
      createAgentFlowDurableWaitPlan({
        profile,
        waitPolicyId,
        journeyId: 'journey-2',
        subjectRef,
        startedFromEventRef: 'event-2',
        policyRevision: 'phase3-v1',
      });
    expect(build(ANISHA_PHASE3_ORCHESTRATION_V1, 'anisha.wait.vendor-followup.24h.v1', 'vendor-1').start.kind).toBe(
      'VENDOR_SUCCESS',
    );
    expect(build(AAROHI_PHASE3_ORCHESTRATION_V1, 'aarohi.wait.nurture.24h.v1', 'prospect-1').start.kind).toBe(
      'PROSPECT_GROWTH',
    );
  });

  it('keeps retry plans bounded and inert', () => {
    const plan = createAgentFlowDurableRetryPlan({
      profile: ANISHA_PHASE3_ORCHESTRATION_V1,
      retryPolicyId: 'anisha.retry.safe-turn.v1',
    });
    expect(plan.maxAttempts).toBe(3);
    expect(plan.directive).toMatchObject({
      disposition: 'RETRY_SOON',
      waitMs: 5_000,
      coreOutcome: 'NONE',
    });
    expect(plan.canExecute).toBe(false);
  });

  it('creates validated content-free resume signals', () => {
    expect(createAgentFlowResumeSignal({ eventRef: 'event-3', reasonCode: 'core-event' })).toEqual({
      eventRef: 'event-3',
      reasonCode: 'core-event',
    });
  });

  it('keeps human takeover disabled under the existing engineering registry', () => {
    expect(
      assessAgentFlowHumanHandoff({
        profile: RIYA_PHASE3_ORCHESTRATION_V1,
        maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
        authorityEvidenceRef: 'authority-1',
        approvalEvidenceRef: 'approval-1',
      }).assessment.decision,
    ).toBe('ACTION_DISABLED');
  });

  it('can only make human takeover proposal-eligible with an enabled governed registry and evidence', () => {
    const registry = createJaoActionRegistry({
      registryRef: 'test.phase3.actions.v1',
      actions: [
        {
          actionId: 'request_human_takeover',
          actionVersion: 1,
          riskClass: 'LOW',
          effectClass: 'CORE_PROPOSAL',
          allowedAgentScopes: ['RIYA'],
          requiredAuthorityRef: 'authority.quickfurno.core',
          approvalPolicyRef: 'approval.human-takeover.v1',
          idempotencyPolicyRef: 'idempotency.logical-action.v1',
          rollbackPolicyRef: 'rollback.release-human-takeover.v1',
          bindingRef: 'conversation.human-takeover.v1',
          enabled: true,
        },
      ],
    });
    const result = assessAgentFlowHumanHandoff({
      profile: RIYA_PHASE3_ORCHESTRATION_V1,
      registry,
      maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
      authorityEvidenceRef: 'authority-1',
      approvalEvidenceRef: 'approval-1',
    });
    expect(result.assessment.decision).toBe('ELIGIBLE_FOR_PROPOSAL');
    expect(result.canExecute).toBe(false);
  });

  it('requires Core assignment evidence for cross-agent handoff', () => {
    expect(
      prepareAgentFlowCrossAgentHandoff({
        fromAgent: 'AAROHI',
        toAgent: 'ANISHA',
        partyType: 'VENDOR',
        conversationRef: 'conversation-2',
        reasonCode: 'core-active',
      }).decision,
    ).toEqual({ decision: 'AUTHORITY_EVIDENCE_MISSING' });

    const accepted = prepareAgentFlowCrossAgentHandoff({
      fromAgent: 'AAROHI',
      toAgent: 'ANISHA',
      partyType: 'VENDOR',
      conversationRef: 'conversation-2',
      coreAssignmentEvidenceRef: 'core-assignment-2',
      reasonCode: 'core-active',
    });
    expect(accepted.decision.decision).toBe('HANDOFF_PROPOSAL_READY');
    expect(accepted.authority).toBe('NONE');
    expect(accepted.canExecute).toBe(false);
  });

  it('publishes an ALL view without acquiring business or execution authority', () => {
    expect(AGENT_FLOW_ALL_VIEW_V1.actors).toEqual(['RIYA', 'ANISHA', 'AAROHI']);
    expect(AGENT_FLOW_ALL_VIEW_V1.flowIds).toHaveLength(3);
    expect(AGENT_FLOW_ALL_VIEW_V1.crossAgentLinks).toEqual([
      expect.objectContaining({ fromAgent: 'AAROHI', toAgent: 'ANISHA', partyType: 'VENDOR' }),
    ]);
    expect(AGENT_FLOW_ALL_VIEW_V1.businessAuthority).toBe('QUICKFURNO_CORE');
    expect(AGENT_FLOW_ALL_VIEW_V1.executionAuthority).toBe('NONE');
  });

  it('rejects attempts to approve an intelligence node as an action', () => {
    expect(() =>
      createAgentFlowSoftOrchestrationProfile({
        flow: ANISHA_VENDOR_FLOW_V1,
        profile: {
          ...ANISHA_PHASE3_ORCHESTRATION_V1,
          approvedActionNodeIds: [
            ...ANISHA_PHASE3_ORCHESTRATION_V1.approvedActionNodeIds,
            'anisha.intelligence.domain',
          ],
        },
      }),
    ).toThrowError('agent-flow-soft-orchestration-profile-invalid');
  });
});
