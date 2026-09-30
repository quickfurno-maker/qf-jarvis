import {
  AAROHI_ACQUISITION_FLOW_V1,
  ANISHA_VENDOR_FLOW_V1,
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
} from '@qf-jarvis/agent-flow-registry';

import type { AgentFlowAllViewDefinition } from './contracts.js';
import { createAgentFlowSoftOrchestrationProfile } from './validate.js';

const BASELINE = 'qf-jarvis@f663d9b7df64ebc916ce260a8ac00c99ada757f6';

export const RIYA_PHASE3_ORCHESTRATION_V1 = createAgentFlowSoftOrchestrationProfile({
  flow: RIYA_PHASE3_CONTROLLED_FLOW_V2,
  profile: {
    profileId: 'riya.orchestration.phase3.v1',
    version: 1,
    actor: 'RIYA',
    flowId: RIYA_PHASE3_CONTROLLED_FLOW_V2.flowId,
    implementationVersionRef: BASELINE,
    approvedActionNodeIds: [
      'riya.action.record-vendor-feedback',
      'riya.action.request-match',
      'riya.action.write-reply',
      'riya.human.handoff',
    ],
    conditions: [
      { conditionId: 'riya.route.human', signalRef: 'control.humanRequired', operator: 'TRUTHY' },
      { conditionId: 'riya.route.wait', signalRef: 'control.waitRequired', operator: 'TRUTHY' },
      { conditionId: 'riya.route.reply', signalRef: 'control.replyReady', operator: 'TRUTHY' },
    ],
    routes: [
      {
        routeId: 'riya.next.human',
        fromNodeId: 'riya.condition.next-step',
        conditionRef: 'riya.route.human',
        whenTrueNodeId: 'riya.human.handoff',
        whenFalseNodeId: 'riya.action.write-reply',
      },
      {
        routeId: 'riya.next.wait',
        fromNodeId: 'riya.condition.next-step',
        conditionRef: 'riya.route.wait',
        whenTrueNodeId: 'riya.wait.durable',
        whenFalseNodeId: 'riya.action.write-reply',
      },
    ],
    waits: [
      {
        policyId: 'riya.wait.client-followup.24h.v1',
        waitMs: 24 * 60 * 60 * 1000,
        resumeEventRef: 'event.core.client-vendor-feedback-result',
        expiryFallbackNodeId: 'riya.human.handoff',
      },
    ],
    retries: [
      {
        policyId: 'riya.retry.safe-core-read.v1',
        maxAttempts: 3,
        backoffMs: 5_000,
        fallbackNodeId: 'riya.human.handoff',
        requiresIdempotency: true,
      },
    ],
    humanHandoff: {
      policyId: 'riya.handoff.human.v1',
      actionId: 'request_human_takeover',
      actionVersion: 1,
      fallbackNodeId: 'riya.queue.complete',
    },
  },
});

export const ANISHA_PHASE3_ORCHESTRATION_V1 = createAgentFlowSoftOrchestrationProfile({
  flow: ANISHA_VENDOR_FLOW_V1,
  profile: {
    profileId: 'anisha.orchestration.phase3.v1',
    version: 1,
    actor: 'ANISHA',
    flowId: ANISHA_VENDOR_FLOW_V1.flowId,
    implementationVersionRef: BASELINE,
    approvedActionNodeIds: ['anisha.action.write-reply', 'anisha.human.handoff'],
    conditions: [
      { conditionId: 'anisha.route.human', signalRef: 'control.humanRequired', operator: 'TRUTHY' },
      { conditionId: 'anisha.route.wait', signalRef: 'control.waitRequired', operator: 'TRUTHY' },
      { conditionId: 'anisha.route.reply', signalRef: 'control.replyReady', operator: 'TRUTHY' },
    ],
    routes: [
      {
        routeId: 'anisha.next.human',
        fromNodeId: 'anisha.condition.next-step',
        conditionRef: 'anisha.route.human',
        whenTrueNodeId: 'anisha.human.handoff',
        whenFalseNodeId: 'anisha.action.write-reply',
      },
      {
        routeId: 'anisha.next.wait',
        fromNodeId: 'anisha.condition.next-step',
        conditionRef: 'anisha.route.wait',
        whenTrueNodeId: 'anisha.wait.durable',
        whenFalseNodeId: 'anisha.action.write-reply',
      },
    ],
    waits: [
      {
        policyId: 'anisha.wait.vendor-followup.24h.v1',
        waitMs: 24 * 60 * 60 * 1000,
        resumeEventRef: 'event.core.vendor-lifecycle',
        expiryFallbackNodeId: 'anisha.human.handoff',
      },
    ],
    retries: [
      {
        policyId: 'anisha.retry.safe-turn.v1',
        maxAttempts: 3,
        backoffMs: 5_000,
        fallbackNodeId: 'anisha.human.handoff',
        requiresIdempotency: true,
      },
    ],
    humanHandoff: {
      policyId: 'anisha.handoff.human.v1',
      actionId: 'request_human_takeover',
      actionVersion: 1,
      fallbackNodeId: 'anisha.queue.complete',
    },
  },
});

export const AAROHI_PHASE3_ORCHESTRATION_V1 = createAgentFlowSoftOrchestrationProfile({
  flow: AAROHI_ACQUISITION_FLOW_V1,
  profile: {
    profileId: 'aarohi.orchestration.phase3.v1',
    version: 1,
    actor: 'AAROHI',
    flowId: AAROHI_ACQUISITION_FLOW_V1.flowId,
    implementationVersionRef: BASELINE,
    approvedActionNodeIds: ['aarohi.action.write-reply', 'aarohi.human.handoff'],
    conditions: [
      { conditionId: 'aarohi.route.human', signalRef: 'control.humanRequired', operator: 'TRUTHY' },
      { conditionId: 'aarohi.route.wait', signalRef: 'control.waitRequired', operator: 'TRUTHY' },
      { conditionId: 'aarohi.route.reply', signalRef: 'control.replyReady', operator: 'TRUTHY' },
    ],
    routes: [
      {
        routeId: 'aarohi.next.human',
        fromNodeId: 'aarohi.condition.next-step',
        conditionRef: 'aarohi.route.human',
        whenTrueNodeId: 'aarohi.human.handoff',
        whenFalseNodeId: 'aarohi.action.write-reply',
      },
      {
        routeId: 'aarohi.next.wait',
        fromNodeId: 'aarohi.condition.next-step',
        conditionRef: 'aarohi.route.wait',
        whenTrueNodeId: 'aarohi.wait.durable',
        whenFalseNodeId: 'aarohi.action.write-reply',
      },
    ],
    waits: [
      {
        policyId: 'aarohi.wait.nurture.24h.v1',
        waitMs: 24 * 60 * 60 * 1000,
        resumeEventRef: 'event.core.prospect-lifecycle',
        expiryFallbackNodeId: 'aarohi.human.handoff',
      },
    ],
    retries: [
      {
        policyId: 'aarohi.retry.safe-turn.v1',
        maxAttempts: 2,
        backoffMs: 5_000,
        fallbackNodeId: 'aarohi.human.handoff',
        requiresIdempotency: true,
      },
    ],
    humanHandoff: {
      policyId: 'aarohi.handoff.human.v1',
      actionId: 'request_human_takeover',
      actionVersion: 1,
      fallbackNodeId: 'aarohi.queue.complete',
    },
  },
});

export const PHASE3_ORCHESTRATION_PROFILES = Object.freeze([
  RIYA_PHASE3_ORCHESTRATION_V1,
  ANISHA_PHASE3_ORCHESTRATION_V1,
  AAROHI_PHASE3_ORCHESTRATION_V1,
]);

export const AGENT_FLOW_ALL_VIEW_V1: AgentFlowAllViewDefinition = Object.freeze({
  viewId: 'agent-flow.all.v1',
  label: 'ALL — Riya + Anisha + Aarohi',
  actors: Object.freeze(['RIYA', 'ANISHA', 'AAROHI'] as const),
  flowIds: Object.freeze([
    RIYA_PHASE3_CONTROLLED_FLOW_V2.flowId,
    ANISHA_VENDOR_FLOW_V1.flowId,
    AAROHI_ACQUISITION_FLOW_V1.flowId,
  ]),
  crossAgentLinks: Object.freeze([
    Object.freeze({
      linkId: 'handoff.aarohi-to-anisha.core-active',
      fromAgent: 'AAROHI',
      toAgent: 'ANISHA',
      partyType: 'VENDOR',
      reason: 'Core-confirmed ACTIVE conversion is the ownership boundary.',
    }),
  ]),
  businessAuthority: 'QUICKFURNO_CORE',
  executionAuthority: 'NONE',
});
