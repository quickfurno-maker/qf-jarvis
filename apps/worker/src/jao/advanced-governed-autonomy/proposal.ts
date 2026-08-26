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
import { jao7ResultProposalSchema } from './public-contracts.js';

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

// ---------------------------------------------------------------------------
// FINDING 4: re-validating the proposal a caller carried back.
// ---------------------------------------------------------------------------

/** The durable identity a run recorded when its proposal step committed. */
export interface Jao7ProposalBinding {
  readonly recommendationId: string | null;
  readonly proposedActionId: string | null;
  readonly actionFingerprint: string | null;
}

/**
 * Re-prove a carried-back proposal from its own bytes.
 *
 * ### What the previous check actually checked
 *
 * Three string comparisons against the run's durable binding, over an object that had been CAST to
 * `Jao7Proposal` after one `typeof === 'object'` test. The canonical schemas were never run, and the
 * fingerprint was never recomputed -- it was read out of the carried object and compared to the
 * stored one, so the value under test was supplied by the same caller as the value it was tested
 * against. A caller could therefore carry back a recommendation whose action had been rewritten
 * entirely -- different type, different parameters, different summary -- keep the three identity
 * strings, and have that action rehearsed. The identity matched; the ACTION was somebody else's.
 *
 * ### What it checks now
 *
 * The artifacts are PARSED by their canonical contracts, and then the fingerprint is RECOMPUTED from
 * the final action bytes with the same canonical function that produced the stored one. That is what
 * makes the binding a binding: the stored digest measures action CONTENT, so an action whose content
 * changed cannot reproduce it, whatever identity it wears.
 *
 * The reviewed policy is re-applied on top -- action type, contract version, risk, approval level and
 * the governed parameter shape -- so a well-formed artifact from a DIFFERENT mission is refused too.
 *
 * `source` is reconstructed rather than carried. It is exactly `{ recommendation, actionBindings }`,
 * and accepting a caller's copy of two fields already present would be accepting a third opinion
 * about them.
 */
export function jao7ValidateCarriedProposal(
  supplied: unknown,
  policy: Jao7MissionPolicy,
  binding: Jao7ProposalBinding,
): Jao7Proposal {
  if (
    binding.recommendationId === null ||
    binding.proposedActionId === null ||
    binding.actionFingerprint === null
  ) {
    // No durable binding means no proposal step has committed for this run, so there is nothing a
    // carried artifact could be checked against and nothing it could legitimately be.
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  // UNKNOWN until the canonical contracts have spoken. A cast here would be this function deciding
  // the caller supplied a `RecommendationV1` because the caller said so.
  const parsed = jao7ResultProposalSchema.safeParse(supplied);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const carried = parsed.data;

  const action = carried.recommendation.proposedActions[0];
  const carriedBinding = carried.actionBindings[0];
  if (action === undefined || carriedBinding === undefined) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }

  // THE RECOMPUTED FINGERPRINT. Not the one the caller carried: that one is under test.
  if (fingerprintProposedAction(action) !== binding.actionFingerprint) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }
  if (
    carriedBinding.actionFingerprint !== binding.actionFingerprint ||
    carriedBinding.recommendationId !== binding.recommendationId ||
    carriedBinding.proposedActionId !== binding.proposedActionId ||
    carried.recommendation.recommendationId !== binding.recommendationId ||
    action.actionId !== binding.proposedActionId
  ) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  // The REVIEWED POLICY, re-applied. A perfectly valid proposal from another mission is still not
  // this run's proposal, and this is where that is decided rather than assumed.
  if (
    carried.recommendation.recommendationType !== policy.recommendationType ||
    carried.recommendation.risk !== policy.requiredRisk ||
    carried.recommendation.requiredApproval !== policy.requiredApproval ||
    carried.recommendation.producingAgent !== JAO7_PRODUCING_AGENT ||
    action.actionType !== policy.actionType ||
    action.actionContractVersion !== policy.actionContractVersion ||
    carried.approvalRequest.risk !== policy.requiredRisk ||
    carried.approvalRequest.requestedAuthority !== policy.requiredApproval
  ) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  // The governed parameter shape, so the values a rehearsal will read are the closed ones the
  // mission declared rather than whatever survived a JSON round trip.
  if (!jao7ParameterSchemaFor(policy).safeParse(action.parameters).success) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  return Object.freeze({
    recommendation: carried.recommendation,
    actionBindings: Object.freeze([carriedBinding] as const),
    approvalRequest: carried.approvalRequest,
    source: Object.freeze({
      recommendation: carried.recommendation,
      actionBindings: Object.freeze([carriedBinding] as const),
    }),
  });
}
