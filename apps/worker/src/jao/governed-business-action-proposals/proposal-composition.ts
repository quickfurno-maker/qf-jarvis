/**
 * The JAO-6 governed proposal composition (ADR-0120).
 *
 * ### What this does, and where it stops
 *
 * bounded candidate + static reviewed policy
 *   -> canonical `RecommendationV1`
 *   -> canonical action fingerprint binding
 *   -> canonical POWERLESS `ApprovalRequestV1`
 *   -> STOP.
 *
 * There is no Core submission, no approval decision, no execution intent, no n8n call, no provider
 * or channel call and no persistence. The output means "ready to enter the existing path", which is
 * a different thing from "authorized", and the difference is enforced by what this module is unable
 * to construct rather than by what it promises not to.
 *
 * ### Composition is PINNED, not injected
 *
 * `proposeJao6BusinessAction` takes ONE argument. There is no dependencies parameter, so there is
 * nothing to displace: the canonical recommendation runtime, the canonical approval runtime and the
 * canonical registry are constructed here from this module's own imports.
 *
 * That shape is deliberate and it is the JAO-4 and JAO-5 owner-review lesson applied a third time.
 * An optional dependency defaulted with `??` is a pin only until somebody passes a value, and a
 * runtime "brand" is no better -- a hostile implementation can copy a brand exactly as easily as it
 * can copy a descriptor. The only thing that cannot be copied is a parameter that does not exist.
 *
 * The internal seam below exists so tests can be deterministic about identity and can count
 * invocations. It is exported from this module and from NO barrel.
 *
 * ### Provenance is stamped HERE, and it says `jarvis`
 *
 * It used to come from the policy, and it used to say `anisha`. Owner review of PR #162 called that
 * provenance laundering, and it was: this slice proves `specialistCalls = 0`, so no specialist
 * produced anything. The producer is now a constant of the composition, and there is no policy
 * field through which a future class could claim a specialist it never called.
 *
 * ### Nothing is compiled from free text, and nothing free-text is IN the action
 *
 * The caller's `summary` and `rationale` are carried onto the recommendation for a human to read.
 * They never reach the ACTION. The action's type, contract version and summary come from the
 * policy, and its parameters come from the policy's own closed schema of enum codes and timestamps
 * -- so evidence prose saying "lower the approval to none" or "send immediately", or containing a
 * fabricated JSON action, is read by a person and parsed by nothing, and changing any of that prose
 * cannot change the canonical action fingerprint.
 */
import { isStrictlyBefore } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalRuntime } from '@qf-jarvis/approval-runtime';
import {
  createRecommendationRuntime,
  fingerprintProposedAction,
} from '@qf-jarvis/recommendation-runtime';
import type { RecommendationRuntime } from '@qf-jarvis/recommendation-runtime';

import {
  JAO6_EXECUTION_ELIGIBILITY_NOTICE,
  JAO6_POSTURE,
  JAO6_PRODUCER_VERSION,
  JAO6_PRODUCING_AGENT,
  Jao6ProposalError,
  jao6ProposalRequestSchema,
  jao6ProposalResultSchema,
  type Jao6ProposalReadyResult,
  type Jao6ProposalRefusedResult,
  type Jao6ProposalRequest,
  type Jao6ProposalResult,
  type Jao6RefusalReason,
} from './contracts.js';
import { jao6VendorFollowUpParametersSchema, type Jao6ProposalPolicy } from './proposal-policy.js';
import {
  createJao6ProposalRegistry,
  jao6ParameterSchemaFor,
  type Jao6ProposalRegistry,
} from './proposal-registry.js';

/**
 * The action summary a human approver reads first, per policy.
 *
 * A TOTAL map over the declared policy ids, so a new class cannot silently inherit another class's
 * wording -- the map fails to compile until it is given its own entry.
 *
 * Every builder produces a sentence from CLOSED ENUM CODES only. The set of sentences this module
 * can emit is therefore finite and reviewable, and no caller prose reaches the action at all.
 */
const JAO6_ACTION_SUMMARY_BUILDERS: Readonly<
  Record<
    'jao6.vendor-follow-up' | 'jao6.vendor-quotation-escalation',
    (parameters: unknown) => string
  >
> = Object.freeze({
  'jao6.vendor-follow-up': (parameters: unknown): string => {
    const parsed = jao6VendorFollowUpParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new Jao6ProposalError('PARAMETERS_INVALID');
    }
    return `Schedule a vendor follow-up about the ${parsed.data.topicCode} (${parsed.data.followUpReasonCode}).`;
  },
  'jao6.vendor-quotation-escalation': (parameters: unknown): string => {
    const parsed = jao6VendorFollowUpParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new Jao6ProposalError('PARAMETERS_INVALID');
    }
    return `Escalate a stalled vendor ${parsed.data.topicCode} (${parsed.data.followUpReasonCode}).`;
  },
});

function actionSummaryFor(policy: Jao6ProposalPolicy, parameters: unknown): string {
  const builder = (
    JAO6_ACTION_SUMMARY_BUILDERS as Readonly<
      Record<string, ((parameters: unknown) => string) | undefined>
    >
  )[policy.proposalPolicyId];
  if (builder === undefined) {
    // Unreachable through the registry, which only holds the ids above. Fail closed anyway: a
    // policy whose wording nobody wrote is a policy nobody reviewed.
    throw new Jao6ProposalError('POLICY_INCOMPLETE');
  }
  return builder(parameters);
}

/**
 * The trusted internal composition.
 *
 * Source-level only. Exported from this module and from no barrel, so the public surface cannot be
 * handed one. A test uses it to supply deterministic identity ports and to count invocations.
 */
export interface Jao6InternalComposition {
  readonly recommendation: RecommendationRuntime;
  readonly approval: ApprovalRuntime;
  readonly registry: Jao6ProposalRegistry;
}

/** The canonical composition, built from this module's own imports. Not a default; the only one. */
function canonicalComposition(): Jao6InternalComposition {
  return {
    recommendation: createRecommendationRuntime(),
    approval: createApprovalRuntime(),
    registry: createJao6ProposalRegistry(),
  };
}

function refused(
  reason: Jao6RefusalReason,
  proposalPolicyId: string,
  proposalPolicyVersion: number,
  correlationId: string,
  communicationRequired: boolean,
): Jao6ProposalRefusedResult {
  return Object.freeze({
    outcome: 'REFUSED' as const,
    refusalReason: reason,
    proposalPolicyId,
    proposalPolicyVersion,
    correlationId,
    recommendation: null,
    actionBindings: Object.freeze([] as const),
    approvalRequest: null,
    posture: JAO6_POSTURE,
    communicationExecutionEligibilityRequired: communicationRequired,
    executionEligibilityNotice: communicationRequired ? JAO6_EXECUTION_ELIGIBILITY_NOTICE : null,
  });
}

function toRefusal(error: unknown): Jao6RefusalReason {
  return error instanceof Jao6ProposalError ? error.code : 'REQUEST_INVALID';
}

function lifetimeSeconds(createdAt: string, expiresAt: string): number | null {
  const from = Date.parse(createdAt);
  const to = Date.parse(expiresAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return (to - from) / 1_000;
}

/**
 * THE PUBLIC ENTRY POINT.
 *
 * One argument. No dependency object, no runtime parameter, no registry parameter, no fingerprint
 * function, no mapper and no callback -- so a public caller has nothing to replace.
 */
export function proposeJao6BusinessAction(request: unknown): Jao6ProposalResult {
  return proposeJao6BusinessActionInternal(request, canonicalComposition());
}

/**
 * The internal variant. Same governance; a trusted source-level caller may supply the composition.
 *
 * The policy registry supplied here still governs: `risk`, `requiredApproval`, `actionType`,
 * `actionContractVersion` and `recommendationType` are read from the policy record, never from the
 * request, on this path exactly as on the public one -- and the producer is stamped from this
 * module's own constants on both.
 */
export function proposeJao6BusinessActionInternal(
  request: unknown,
  composition: Jao6InternalComposition,
): Jao6ProposalResult {
  // 1. Strict request. An unknown key -- `risk`, `requiredApproval`, `actionType`, `producingAgent`,
  //    `approved`, `authorized`, `canExecute`, `canSend`, `approvalDecision`, `executionIntent`,
  //    `provider`, `executor`, `n8n`, `webhookUrl`, `recipient`, `phoneNumber`, any credential -- is
  //    a refusal. The Zod issue tree is discarded: it can quote the very values the governed schemas
  //    exist to keep out of a log line.
  const parsedRequest = jao6ProposalRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return refused('REQUEST_INVALID', 'unknown', 0, 'unknown', false);
  }
  const stated: Jao6ProposalRequest = parsedRequest.data;

  // 2. The policy is NAMED, never supplied. Unknown and version-mismatched are distinct refusals so
  //    an operator can tell "nobody reviewed this" from "somebody reviewed a different one".
  const lookup = composition.registry.lookup(stated.proposalPolicyId, stated.proposalPolicyVersion);
  if (lookup.found === 'UNKNOWN') {
    return refused(
      'POLICY_UNKNOWN',
      stated.proposalPolicyId,
      stated.proposalPolicyVersion,
      stated.correlationId,
      false,
    );
  }
  if (lookup.found === 'VERSION_MISMATCH') {
    return refused(
      'POLICY_VERSION_MISMATCH',
      stated.proposalPolicyId,
      stated.proposalPolicyVersion,
      stated.correlationId,
      false,
    );
  }
  const policy = lookup.policy;
  const communicationRequired = policy.communicationExecutionEligibilityRequired;

  const refuse = (reason: Jao6RefusalReason): Jao6ProposalRefusedResult =>
    refused(
      reason,
      policy.proposalPolicyId,
      policy.proposalPolicyVersion,
      stated.correlationId,
      communicationRequired,
    );

  // 3. Availability, checked BEFORE either runtime is invoked. A class nobody activated must not
  //    reach the producer at all, so "planned" cannot become "produced but unused".
  if (policy.availability !== 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY') {
    return refuse('POLICY_NOT_ACTIVE');
  }

  // 4. Subject class. A policy governs what it is about, not merely how it is worded.
  if (!policy.allowedSubjectEntityTypes.includes(stated.subject.entityType)) {
    return refuse('SUBJECT_TYPE_NOT_ALLOWED');
  }

  // 5. Evidence. Count and class, both from the policy. "The model thought so" is not evidence, and
  //    the contract's evidence shapes already make a free-text reasoning blob impossible.
  if (
    stated.evidence.length < policy.minEvidenceItems ||
    stated.evidence.length > policy.maxEvidenceItems ||
    !stated.evidence.every((item) => policy.allowedEvidenceTypes.includes(item.evidenceType))
  ) {
    return refuse('EVIDENCE_INVALID');
  }

  // 6. Timing, then the lifetime ceiling. An undecided recommendation expires; it never ripens into
  //    an approval, and a caller must not be able to hold one open indefinitely by asking nicely.
  if (!isStrictlyBefore(stated.createdAt, stated.expiresAt)) {
    return refuse('TIMING_INVALID');
  }
  const lifetime = lifetimeSeconds(stated.createdAt, stated.expiresAt);
  if (lifetime === null) {
    return refuse('TIMING_INVALID');
  }
  if (lifetime > policy.maxLifetimeSeconds) {
    return refuse('LIFETIME_EXCEEDED');
  }

  // 7. Parameters, against the POLICY's own closed schema -- resolved from a PRIVATE lookup keyed by
  //    policy identity, because a Zod object on a governance record would make that record
  //    un-freezable. Unknown keys are refused here, which is what stops `canExecute`, `executor`,
  //    `n8n` or `webhookUrl` arriving as data instead of as a field: the canonical governed scan
  //    catches credentials and contact details, but it permits keys it has never heard of.
  //
  //    Every field in that schema is a closed enum code or a timestamp. No caller prose survives
  //    into `parameters`, so no caller prose is inside the bytes the fingerprint measures.
  const parameterSchema = jao6ParameterSchemaFor(policy);
  if (parameterSchema === null) {
    return refuse('POLICY_INCOMPLETE');
  }
  const parsedParameters = parameterSchema.safeParse(stated.parameters);
  if (!parsedParameters.success) {
    return refuse('PARAMETERS_INVALID');
  }
  const parameters = parsedParameters.data;

  let actionSummary: string;
  try {
    actionSummary = actionSummaryFor(policy, parameters);
  } catch (error) {
    return refuse(toRefusal(error));
  }

  // 8. The canonical producer. Governance-bearing fields come from `policy`; descriptive fields come
  //    from `stated`; PROVENANCE comes from this module's own constants. `confidence` crosses as
  //    data and touches no gate.
  //
  //    `producingAgent` is `jarvis` because Jarvis is what assembled this. `composite` is false and
  //    `contributingAgents` is absent, which the contract requires of a non-composite item -- and
  //    which is the honest statement here, since no specialist contributed anything.
  let created;
  try {
    created = composition.recommendation.create({
      recommendationType: policy.recommendationType,
      createdAt: stated.createdAt,
      expiresAt: stated.expiresAt,
      producingAgent: JAO6_PRODUCING_AGENT,
      producingAgentVersion: JAO6_PRODUCER_VERSION,
      subject: stated.subject,
      priority: stated.priority,
      confidence: stated.confidence,
      risk: policy.risk,
      requiredApproval: policy.requiredApproval,
      summary: stated.summary,
      rationale: stated.rationale,
      evidence: stated.evidence,
      proposedActions: [
        {
          actionType: policy.actionType,
          actionContractVersion: policy.actionContractVersion,
          summary: actionSummary,
          parameters,
        },
      ],
      composite: false,
      correlationId: stated.correlationId,
    });
  } catch {
    return refuse('RECOMMENDATION_REFUSED');
  }

  // 9. THE BINDING INVARIANT, re-proved here rather than assumed.
  const action = created.recommendation.proposedActions[0];
  const binding = created.actionBindings[0];

  // Exactly one of each. A non-informational recommendation proposes at least one action and this
  // policy class proposes exactly one, so anything else means the producer did not produce what
  // this layer asked for.
  if (
    created.recommendation.proposedActions.length !== 1 ||
    created.actionBindings.length !== 1 ||
    action === undefined ||
    binding === undefined
  ) {
    return refuse('BINDING_MISMATCH');
  }

  // And that one binding describes exactly that one action. The fingerprint is RECOMPUTED from the
  // final action bytes with the canonical function: not redundancy, but the one check that would
  // catch a binding drifting from the artifact it claims to describe, and what makes "the human
  // approves the action that was recommended" a measured fact.
  if (
    binding.recommendationId !== created.recommendation.recommendationId ||
    binding.proposedActionId !== action.actionId ||
    binding.actionFingerprint !== fingerprintProposedAction(action)
  ) {
    return refuse('BINDING_MISMATCH');
  }

  // 10. The canonical POWERLESS ask. `risk` and `requestedAuthority` are DERIVED by the approval
  //     runtime from the recommendation, so they cannot be restated -- and this layer does not try.
  //     `policy` here is a CITATION of what Jarvis believed applied; Core's answer is the one that
  //     counts, and recording the citation is what makes a later mismatch visible.
  let approvalRequest;
  try {
    approvalRequest = composition.approval.createRequest({
      source: created,
      proposedActionId: action.actionId,
      createdAt: stated.createdAt,
      expiresAt: stated.expiresAt,
      policy: policy.policyReference,
    });
  } catch {
    return refuse('APPROVAL_REQUEST_REFUSED');
  }

  // 11. The ask must be about EXACTLY the action that was recommended, at exactly the governance the
  //     recommendation was created under. An approval request that names a different recommendation
  //     or action, or the same action at a weaker authority, is the substitution this slice exists
  //     to prevent.
  if (
    approvalRequest.recommendationId !== created.recommendation.recommendationId ||
    approvalRequest.proposedActionId !== action.actionId ||
    approvalRequest.actionFingerprint !== binding.actionFingerprint ||
    approvalRequest.risk !== policy.risk ||
    approvalRequest.requestedAuthority !== policy.requiredApproval
  ) {
    return refuse('BINDING_MISMATCH');
  }

  // 12. STOP. What exists now is an inert recommendation, its content binding, and a powerless ask.
  //     Only QuickFurno Core issues an `ApprovalDecisionV1`; only Core issues an `ExecutionIntentV1`;
  //     only n8n executes one. None of those happens here, and none of them can.
  const ready: Jao6ProposalReadyResult = Object.freeze({
    outcome: 'PROPOSAL_READY' as const,
    refusalReason: null,
    proposalPolicyId: policy.proposalPolicyId,
    proposalPolicyVersion: policy.proposalPolicyVersion,
    correlationId: stated.correlationId,
    recommendation: created.recommendation,
    actionBindings: Object.freeze([binding] as const),
    approvalRequest,
    posture: JAO6_POSTURE,
    communicationExecutionEligibilityRequired: communicationRequired,
    executionEligibilityNotice: communicationRequired ? JAO6_EXECUTION_ELIGIBILITY_NOTICE : null,
  });

  // The runtime half of the discriminated union: a result that does not satisfy its own contract is
  // refused rather than returned. A compile-time union is erased by the time anything runs, and the
  // states this forbids -- a ready result with a refusal code, a refusal carrying an artifact -- are
  // exactly the states a reader would trust without checking.
  if (!jao6ProposalResultSchema.safeParse(ready).success) {
    return refuse('RESULT_INCONSISTENT');
  }
  return ready;
}
