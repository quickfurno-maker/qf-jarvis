import {
  DURABLE_ORCHESTRATION_PROTOCOL,
  durableJourneyCycleResultV1Schema,
  durableJourneyStartV1Schema,
  durableJourneyWakeV1Schema,
  type DurableJourneyKind,
  type DurableJourneyWakeV1,
} from '@qf-jarvis/durable-orchestration-contracts';

import type {
  AgentFlowControlActor,
  AgentFlowDurableRetryPlan,
  AgentFlowDurableWaitPlan,
  AgentFlowSoftOrchestrationProfile,
} from './contracts.js';

const KIND_BY_ACTOR: Readonly<Record<AgentFlowControlActor, DurableJourneyKind>> = Object.freeze({
  RIYA: 'CLIENT_SUCCESS',
  ANISHA: 'VENDOR_SUCCESS',
  AAROHI: 'PROSPECT_GROWTH',
});

export function createAgentFlowDurableWaitPlan(input: {
  readonly profile: AgentFlowSoftOrchestrationProfile;
  readonly waitPolicyId: string;
  readonly journeyId: string;
  readonly subjectRef: string;
  readonly conversationRef?: string;
  readonly startedFromEventRef: string;
  readonly policyRevision: string;
}): AgentFlowDurableWaitPlan {
  const wait = input.profile.waits.find((candidate) => candidate.policyId === input.waitPolicyId);
  if (wait === undefined) throw new TypeError('agent-flow-wait-policy-unknown');

  const start = durableJourneyStartV1Schema.parse({
    protocol: DURABLE_ORCHESTRATION_PROTOCOL,
    journeyId: input.journeyId,
    kind: KIND_BY_ACTOR[input.profile.actor],
    actor: input.profile.actor,
    subjectRef: input.subjectRef,
    ...(input.conversationRef === undefined ? {} : { conversationRef: input.conversationRef }),
    startedFromEventRef: input.startedFromEventRef,
    policyRevision: input.policyRevision,
    generation: 0,
    cycleBase: 0,
  });
  const directive = durableJourneyCycleResultV1Schema.parse({
    disposition: 'WAIT',
    waitMs: wait.waitMs,
    coreOutcome: 'NONE',
    reasonCode: 'agent-flow.wait',
  });

  return Object.freeze({
    authority: 'NONE' as const,
    canExecute: false as const,
    start,
    directive,
    resumeEventRef: wait.resumeEventRef,
    expiryFallbackNodeId: wait.expiryFallbackNodeId,
  });
}

export function createAgentFlowDurableRetryPlan(input: {
  readonly profile: AgentFlowSoftOrchestrationProfile;
  readonly retryPolicyId: string;
}): AgentFlowDurableRetryPlan {
  const retry = input.profile.retries.find(
    (candidate) => candidate.policyId === input.retryPolicyId,
  );
  if (retry === undefined) throw new TypeError('agent-flow-retry-policy-unknown');
  const directive = durableJourneyCycleResultV1Schema.parse({
    disposition: 'RETRY_SOON',
    waitMs: retry.backoffMs,
    coreOutcome: 'NONE',
    reasonCode: 'agent-flow.retry',
  });
  return Object.freeze({
    authority: 'NONE' as const,
    canExecute: false as const,
    policyId: retry.policyId,
    maxAttempts: retry.maxAttempts,
    directive,
    fallbackNodeId: retry.fallbackNodeId,
  });
}

export function createAgentFlowResumeSignal(input: {
  readonly eventRef: string;
  readonly reasonCode: string;
}): DurableJourneyWakeV1 {
  return durableJourneyWakeV1Schema.parse(input);
}
