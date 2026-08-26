/**
 * Shared JAO-7 test fixtures.
 *
 * ### The Core artifacts are built HERE, and that is the point
 *
 * `ApprovalDecisionV1` and `ExecutionIntentV1` are constructed by these helpers because JAO-7 cannot
 * construct them. Every test that moves a run past the authority gate has to reach outside the slice
 * for the artifacts, exactly as production would have to reach out to QuickFurno Core — and the
 * posture literal `INJECTED_OFFLINE_CORE_FIXTURE` records honestly that these are fixtures rather
 * than authenticated Core output.
 *
 * A fixture builder that lived inside the slice would be a constructor inside the slice.
 */
import { randomUUID } from 'node:crypto';

import type { ApprovalDecisionV1, ExecutionIntentV1, RecommendationV1 } from '@qf-jarvis/contracts';

import type { Jao7Proposal } from '../jao/advanced-governed-autonomy/proposal.js';

export const CORRELATION_ID = '3f2c1a44-0d1e-4a7b-9c2e-1b0a5d6e7f80';
export const EVENT_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
export const T0 = Date.parse('2026-08-26T09:00:00.000Z');

export const CLIENT_SALES_SIGNALS = Object.freeze({
  hasPriorSalesContext: true,
  requestedHumanAssistance: true,
  requestedQuoteOrConsultation: false,
  providedRequirementDetail: true,
  askedAboutReadiness: false,
  outOfSalesScope: false,
  missingDiscoveryFieldCount: 2,
});

export const OPERATOR_TASK = Object.freeze({
  taskReasonCode: 'client-sales-conversation-stalled' as const,
  taskClass: 'sales-followup-review' as const,
  dueWindowCode: 'within-1-business-day' as const,
  priorityBand: 'routine' as const,
});

export const SATURATED_OBSERVATION = Object.freeze({
  poolCode: 'synthetic-pool-alpha' as const,
  currentConcurrency: 8,
  queueDepthBand: 'HIGH' as const,
  errorRateBand: 'LOW' as const,
  saturationBand: 'SATURATED' as const,
});

export const EVIDENCE = Object.freeze([
  Object.freeze({
    evidenceType: 'canonical-event' as const,
    eventId: EVENT_ID,
    eventType: 'client.conversation-stalled',
    description: 'A stalled client-sales conversation was recorded in Core.',
  }),
]);

/** A synthetic diagnostic bundle for the JAO-4 workbench step. Sanitised, and never a real log. */
export function artifactBundle(): Record<string, unknown> {
  return {
    bundleId: 'jao7.bundle.001',
    dataClass: 'SYNTHETIC_OR_SANITIZED_OPERATIONAL_ARTIFACTS',
    containsSecrets: false,
    sourcePosture: 'INJECTED_OFFLINE',
    artifacts: [
      {
        artifactId: 'jao7.artifact.diagnostics',
        path: 'diagnostics/pool-alpha.txt',
        contentClass: 'DIAGNOSTIC_TEXT',
        content: 'queue_depth_band=HIGH\nerror_rate_band=LOW\nsaturation_band=SATURATED\n',
      },
    ],
  };
}

/** One bounded read. The output is UNTRUSTED evidence for a human, never a source of authority. */
export function artifactCalls(runId: string): readonly Record<string, unknown>[] {
  return [
    {
      callId: 'jao7.call.001',
      runId: `${runId}.evidence`,
      toolId: 'artifact.read.v1',
      toolVersion: '1',
      path: 'diagnostics/pool-alpha.txt',
      maxChars: 512,
    },
  ];
}

/** The per-step request every mission shares. */
export function advanceRequest(
  runId: string,
  operationId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runId,
    operationId,
    correlationId: CORRELATION_ID,
    summary: 'A stalled client-sales conversation needs an internal follow-up task.',
    rationale: 'Riya observed a stall and a human-assistance request; an operator should review.',
    evidence: [...EVIDENCE],
    confidence: 0.6,
    clientSalesSignals: { ...CLIENT_SALES_SIGNALS },
    operatorTask: { ...OPERATOR_TASK },
    ...over,
  };
}

/** The capacity mission's per-step request. Note there is no `targetConcurrency` to supply. */
export function capacityRequest(
  runId: string,
  operationId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runId,
    operationId,
    correlationId: CORRELATION_ID,
    summary: 'Synthetic pool alpha is saturated with a healthy error rate.',
    rationale: 'Queue depth is high and errors are low; one additional worker is warranted.',
    evidence: [...EVIDENCE],
    confidence: 0.7,
    capacityObservation: { ...SATURATED_OBSERVATION },
    artifactBundle: artifactBundle(),
    artifactCalls: [...artifactCalls(runId)],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Core artifacts. Built OUTSIDE the slice, because the slice cannot build them.
// ---------------------------------------------------------------------------

/** A human Core approver. `decidedBy` is an opaque Core reference; Jarvis carries it, never owns it. */
export const HUMAN_APPROVER = Object.freeze({
  actorType: 'human' as const,
  actor: Object.freeze({ entityType: 'staff', entityId: 'staff.approver.1' }),
});

/**
 * A POLICY Core approver.
 *
 * Level-4 policy automation is a thing Core may do for low-risk reversible actions after evaluation.
 * JAO-7 tests that it can CORRELATE such a decision; it does not define Core's policy engine, and it
 * certainly does not auto-approve.
 */
export const POLICY_APPROVER = Object.freeze({
  actorType: 'policy' as const,
  policyId: 'core.low-risk-reversible-automation',
  policyVersion: 1,
});

export function approvalDecision(
  proposal: Jao7Proposal,
  over: Record<string, unknown> = {},
): ApprovalDecisionV1 {
  const recommendation: RecommendationV1 = proposal.recommendation;
  const action = recommendation.proposedActions[0];
  return {
    decisionId: randomUUID(),
    recommendationId: recommendation.recommendationId,
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: { ...HUMAN_APPROVER },
    decidedAt: recommendation.createdAt,
    outcome: 'approved',
    actionDecisions: [{ actionId: action?.actionId ?? '', decision: 'approved' }],
    reasonCode: 'operator-approved',
    correlationId: CORRELATION_ID,
    ...over,
  };
}

export function executionIntent(
  proposal: Jao7Proposal,
  decision: ApprovalDecisionV1,
  over: Record<string, unknown> = {},
): ExecutionIntentV1 {
  const recommendation = proposal.recommendation;
  const action = recommendation.proposedActions[0];
  return {
    executionIntentId: randomUUID(),
    contractVersion: 1,
    recommendationId: recommendation.recommendationId,
    approvalDecisionId: decision.decisionId,
    approvedActionId: action?.actionId ?? '',
    actionType: action?.actionType ?? '',
    actionContractVersion: action?.actionContractVersion ?? 1,
    parameters: { ...(action?.parameters ?? {}) },
    // Core issues. n8n executes. JAO-7 correlates and stops.
    issuer: 'quickfurno-core',
    executor: 'n8n',
    issuedAt: decision.decidedAt,
    expiresAt: recommendation.expiresAt,
    idempotencyKey: `jao7-intent-${randomUUID()}`,
    deliverySemantics: 'at-most-once',
    correlationId: CORRELATION_ID,
    ...over,
  };
}

/** A steppable clock. Injectable so a durability proof is deterministic. */
export class SteppableClock {
  private value: number;
  constructor(startMs = T0) {
    this.value = startMs;
  }
  nowMs(): number {
    return this.value;
  }
  set(ms: number): void {
    this.value = ms;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}
