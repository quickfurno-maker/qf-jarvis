/**
 * The JAO-7 canonical remediation proposal (ADR-0121).
 *
 * ### Reuse, not re-implementation
 *
 * `@qf-jarvis/recommendation-runtime` produces the validated inert `RecommendationV1` and the
 * canonical SHA-256 action fingerprint. `@qf-jarvis/approval-runtime` turns that triple into a
 * POWERLESS `ApprovalRequestV1` whose `risk` and `requestedAuthority` it DERIVES from the
 * recommendation rather than accepting from a caller. Neither package is modified, and JAO-7 creates
 * no second recommendation format, no second approval-request format and no second fingerprint.
 *
 * ### Why this is distinct from JAO-6
 *
 * JAO-6 proposes BUSINESS actions -- a vendor follow-up that would reach a vendor. JAO-7 proposes
 * OPERATIONAL remediation: an internal task, or a bounded concurrency adjustment on a synthetic pool.
 * Both are `low-risk-reversible` here, and neither slice's policy registry can see the other's.
 * JAO-6 is untouched.
 *
 * ### What a caller may state
 *
 * Nothing that decides anything. The risk class, the approval level, the recommendation type, the
 * action type and the contract version come from the reviewed mission policy; the producer comes from
 * this slice's own constants; the identities come from the canonical runtimes; and the action
 * parameters are computed from closed codes and bands. Caller prose reaches the recommendation's
 * `summary` and `rationale`, where a human reads it, and reaches the ACTION nowhere at all -- so
 * changing it cannot move the fingerprint a human approves against.
 */
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalRequestV1, EvidenceItem, RecommendationV1 } from '@qf-jarvis/contracts';
import {
  createRecommendationRuntime,
  fingerprintProposedAction,
} from '@qf-jarvis/recommendation-runtime';
import type {
  RecommendationActionBinding,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';

import { JAO7_PRODUCER_VERSION, JAO7_PRODUCING_AGENT, Jao7AutonomyError } from './contracts.js';
import { jao7ParameterSchemaFor } from './mission-registry.js';
import type { Jao7MissionPolicy } from './mission-policy.js';

/** What the coordinator hands in. Descriptive fields only; every gate comes from the policy. */
export interface Jao7ProposalInput {
  readonly policy: Jao7MissionPolicy;
  readonly subject: { readonly entityType: string; readonly entityId: string };
  readonly summary: string;
  readonly rationale: string;
  readonly evidence: readonly EvidenceItem[];
  /** Computed from closed codes and bands, never supplied as prose. */
  readonly parameters: unknown;
  /** Data. Calibration only; it touches no gate at any value. */
  readonly confidence: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
}

/** The three canonical artifacts, and the exact one-tuple of bindings. */
export interface Jao7Proposal {
  readonly recommendation: RecommendationV1;
  readonly actionBindings: readonly [RecommendationActionBinding];
  readonly approvalRequest: ApprovalRequestV1;
  /** The exact runtime result, kept so authority correlation can re-prove it verbatim. */
  readonly source: RecommendationRuntimeResult;
}

/**
 * The action summary a human approver reads first, per mission.
 *
 * A TOTAL map over the declared mission classes, so a new class cannot silently inherit another's
 * wording. Every builder emits a sentence from CLOSED ENUM CODES only, so the set of sentences this
 * module can produce is finite and reviewable -- and no caller prose reaches the action.
 */
const ACTION_SUMMARY_BUILDERS: Readonly<
  Record<
    'CLIENT_SALES_STALL_REMEDIATION' | 'SYNTHETIC_CAPACITY_REMEDIATION',
    (parameters: Record<string, unknown>) => string
  >
> = Object.freeze({
  CLIENT_SALES_STALL_REMEDIATION: (parameters): string =>
    `Create an internal ${String(parameters['taskClass'])} task (${String(parameters['taskReasonCode'])}), due ${String(parameters['dueWindowCode'])}.`,
  SYNTHETIC_CAPACITY_REMEDIATION: (parameters): string =>
    `Adjust ${String(parameters['poolCode'])} concurrency from ${String(parameters['currentConcurrency'])} to ${String(parameters['targetConcurrency'])} (${String(parameters['adjustmentReasonCode'])}).`,
});

/**
 * Build the canonical proposal, then re-prove the binding rather than assuming it.
 *
 * The fingerprint is RECOMPUTED here from the final action bytes with the canonical function. That
 * is not redundancy: it is the one check that would catch a binding drifting from the artifact it
 * claims to describe, and it is what makes "the human approves the action that was recommended" a
 * measured fact rather than a property of a package that happened to behave.
 */
export function buildJao7Proposal(input: Jao7ProposalInput): Jao7Proposal {
  const { policy } = input;

  const parsedParameters = jao7ParameterSchemaFor(policy).safeParse(input.parameters);
  if (!parsedParameters.success) {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }
  const parameters = parsedParameters.data as Record<string, unknown>;

  const builder = ACTION_SUMMARY_BUILDERS[policy.missionClass];
  const actionSummary = builder(parameters);

  let created;
  try {
    created = createRecommendationRuntime().create({
      recommendationType: policy.recommendationType,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      // PROVENANCE, from this slice's constants. Riya may have advised on Mission A; Jarvis
      // concluded, and stamping a specialist id here would claim otherwise.
      producingAgent: JAO7_PRODUCING_AGENT,
      producingAgentVersion: JAO7_PRODUCER_VERSION,
      subject: input.subject,
      priority: 'medium',
      confidence: input.confidence,
      // From the reviewed policy, and from nowhere else.
      risk: policy.requiredRisk,
      requiredApproval: policy.requiredApproval,
      summary: input.summary,
      rationale: input.rationale,
      evidence: [...input.evidence],
      proposedActions: [
        {
          actionType: policy.actionType,
          actionContractVersion: policy.actionContractVersion,
          summary: actionSummary,
          parameters,
        },
      ],
      composite: false,
      correlationId: input.correlationId,
    });
  } catch {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }

  const action = created.recommendation.proposedActions[0];
  const binding = created.actionBindings[0];
  if (
    created.recommendation.proposedActions.length !== 1 ||
    created.actionBindings.length !== 1 ||
    action === undefined ||
    binding === undefined
  ) {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }
  if (
    binding.recommendationId !== created.recommendation.recommendationId ||
    binding.proposedActionId !== action.actionId ||
    binding.actionFingerprint !== fingerprintProposedAction(action)
  ) {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }

  let approvalRequest: ApprovalRequestV1;
  try {
    approvalRequest = createApprovalRuntime().createRequest({
      source: created,
      proposedActionId: action.actionId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      // A CITATION of what Jarvis believed applied. Core's answer is the one that counts, and
      // recording the citation is what makes a later mismatch visible rather than silent.
      policy: policy.policyReference,
    });
  } catch {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }

  // The ask must be about EXACTLY the action that was recommended, at exactly the governance the
  // recommendation was created under. A valid recommendation behind a request that asks a smaller
  // room to say yes is the laundering this check exists to prevent.
  if (
    approvalRequest.recommendationId !== created.recommendation.recommendationId ||
    approvalRequest.proposedActionId !== action.actionId ||
    approvalRequest.actionFingerprint !== binding.actionFingerprint ||
    approvalRequest.risk !== policy.requiredRisk ||
    approvalRequest.requestedAuthority !== policy.requiredApproval
  ) {
    throw new Jao7AutonomyError('PROPOSAL_REFUSED');
  }

  return Object.freeze({
    recommendation: created.recommendation,
    actionBindings: Object.freeze([binding] as const),
    approvalRequest,
    source: created,
  });
}
