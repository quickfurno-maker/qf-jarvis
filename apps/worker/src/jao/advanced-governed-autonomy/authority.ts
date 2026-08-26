/**
 * The JAO-7 authority gate (ADR-0121).
 *
 * ### The single most important boundary in this slice
 *
 * JAO-7 does not create an `ApprovalDecisionV1`. It does not create an `ExecutionIntentV1`. It does
 * not infer them, edit them, call Core to obtain them, or call n8n with them. There is no
 * constructor for either artifact anywhere in this module or in the packages it imports: the
 * approval runtime only VALIDATES a decision Core has already issued, and the execution-intent
 * runtime only VALIDATES an intent Core has already issued and has no method that creates one.
 *
 * What arrives here arrives from outside — from a caller, from a test fixture — and correlation is
 * the only thing that happens to it.
 *
 * ### What correlation proves, and what it does not
 *
 * It proves that the supplied artifacts are structurally valid by their own governed contracts, and
 * that they describe EXACTLY this recommendation, this proposed action, this fingerprint and these
 * parameters. `executionIntentV1Schema` is doing most of that work structurally: it establishes that
 * the issuer is `quickfurno-core`, the executor is `n8n`, delivery is at-most-once, an idempotency
 * key is present, and the parameters carry no contact detail, credential or smuggled retry
 * permission. None of that is restated below, because re-implementing it would create a second
 * definition of a contract `@qf-jarvis/contracts` already owns.
 *
 * It does NOT prove that QuickFurno Core authenticated anything. In this offline proof the artifacts
 * are injected, and the posture literal says so: `INJECTED_OFFLINE_CORE_FIXTURE`. Production source
 * authentication is a separate integration that does not exist yet, and pretending otherwise would
 * be the one lie this slice most needs not to tell.
 *
 * ### And the intent is still not executed
 *
 * A validated `ExecutionIntentV1` names `n8n` as its executor. JAO-7 records a bounded OBSERVATION —
 * digests and identities — and stops. It does not become n8n because it happens to be holding the
 * intent.
 */
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import { createExecutionIntentRuntime } from '@qf-jarvis/execution-intent-runtime';
import { approvalDecisionV1Schema, executionIntentV1Schema } from '@qf-jarvis/contracts';
import type { ApprovalDecisionV1, ExecutionIntentV1 } from '@qf-jarvis/contracts';

import { Jao7AutonomyError, type Jao7AuthorityObservation } from './contracts.js';
import { jao7Digest } from './mission-registry.js';
import type { Jao7Proposal } from './proposal.js';

/**
 * The externally supplied Core artifacts.
 *
 * Both optional, because "no decision yet" is a real and common state that must not be an error, and
 * "approved but no intent issued yet" is another. Neither absence is filled in by JAO-7.
 */
export interface Jao7AuthorityEvidence {
  /** UNKNOWN on purpose. Parsed by the canonical contract schema, never cast into place. */
  readonly approvalDecision?: unknown;
  readonly executionIntent?: unknown;
}

/** What correlation concluded. Digests and identities only — nothing reusable, nothing granting. */
export interface Jao7AuthorityCorrelation {
  readonly observationCode: Jao7AuthorityObservation;
  readonly approvalDecisionDigest: string;
  readonly executionIntentDigest: string | null;
  readonly recommendationId: string;
  readonly proposedActionId: string;
  readonly actionFingerprint: string;
  /** True only when an approved action AND a matching Core-issued intent both correlated. */
  readonly executionChainCorrelated: boolean;
}

/**
 * A stable digest over an artifact's IDENTITY fields.
 *
 * Deliberately not a hash of the whole artifact. What is worth recording is which decision and which
 * intent correlated; a digest that changed when an unrelated optional field changed would be a worse
 * audit key, and one that could be inverted back into the artifact would defeat the point of not
 * storing it.
 */
function decisionDigest(decision: ApprovalDecisionV1): string {
  return jao7Digest([
    'APPROVAL_DECISION',
    decision.decisionId,
    decision.recommendationId,
    decision.issuer,
    decision.outcome,
    decision.decidedAt,
    decision.reasonCode,
  ]);
}

function intentDigest(intent: ExecutionIntentV1): string {
  return jao7Digest([
    'EXECUTION_INTENT',
    intent.executionIntentId,
    intent.recommendationId,
    intent.approvalDecisionId,
    intent.approvedActionId,
    intent.issuer,
    intent.executor,
    intent.issuedAt,
  ]);
}

/**
 * Correlate whatever authority evidence exists against this run's exact proposal.
 *
 * Every failure is a distinct refusal, because an operator needs to tell "Core said no" from "the
 * artifact does not describe this action" from "there is no decision yet". Collapsing them would
 * make the most dangerous case — an intent bound to a different action — indistinguishable from the
 * most ordinary one.
 */
export function correlateJao7Authority(
  proposal: Jao7Proposal,
  evidence: Jao7AuthorityEvidence,
): Jao7AuthorityCorrelation {
  // Parsed by Core's OWN governed schema, never repaired and never cast. That parse is what
  // structurally establishes `issuer = quickfurno-core` before anything else is considered.
  const parsedDecision = approvalDecisionV1Schema.safeParse(evidence.approvalDecision);
  if (!parsedDecision.success) {
    // Also the "no decision yet" case, which is not a defect: silence is never consent, and there is
    // no timeout that ripens an unanswered request into an approval.
    throw new Jao7AutonomyError('APPROVAL_DECISION_INVALID');
  }
  const decision: ApprovalDecisionV1 = parsedDecision.data;

  const binding = proposal.actionBindings[0];
  const action = proposal.recommendation.proposedActions[0];
  if (action === undefined) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  // The decision must be ABOUT this recommendation before anything else is considered.
  if (decision.recommendationId !== proposal.recommendation.recommendationId) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  const evidenceForRuntime = {
    source: proposal.source,
    request: proposal.approvalRequest,
    decision,
  };

  // The canonical approval runtime re-proves the decision against the request, the recommendation,
  // the action and a RECOMPUTED fingerprint. JAO-7 does not second-guess any of that.
  let correlation;
  try {
    // The canonical runtime, constructed HERE from this module's own import. There is no
    // parameter through which a caller could pass a different one.
    correlation = createApprovalRuntime().validateDecision(evidenceForRuntime);
  } catch {
    throw new Jao7AutonomyError('APPROVAL_DECISION_INVALID');
  }

  // The PER-ACTION verdict, never the overall outcome. Under partial approval a decision may be
  // `approved` overall because a DIFFERENT action was approved while this one was rejected — and
  // rehearsing on the overall outcome would rehearse something a human refused.
  if (correlation.actionDecision.decision !== 'approved') {
    return Object.freeze({
      observationCode: 'DECISION_NOT_APPROVING_THIS_ACTION' as const,
      approvalDecisionDigest: decisionDigest(decision),
      executionIntentDigest: null,
      recommendationId: proposal.recommendation.recommendationId,
      proposedActionId: action.actionId,
      actionFingerprint: binding.actionFingerprint,
      executionChainCorrelated: false,
    });
  }

  if (correlation.actionFingerprint !== binding.actionFingerprint) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  const parsedIntent = executionIntentV1Schema.safeParse(evidence.executionIntent);
  if (evidence.executionIntent !== undefined && !parsedIntent.success) {
    throw new Jao7AutonomyError('EXECUTION_INTENT_INVALID');
  }
  const intent: ExecutionIntentV1 | undefined = parsedIntent.success
    ? parsedIntent.data
    : undefined;
  if (intent === undefined) {
    // A real state, and it stops here. An approved action without a Core-issued intent is not an
    // execution chain, and rehearsing one would rehearse a step Core has not taken.
    return Object.freeze({
      observationCode: 'CORRELATED_APPROVED_ACTION_WITHOUT_INTENT' as const,
      approvalDecisionDigest: decisionDigest(decision),
      executionIntentDigest: null,
      recommendationId: proposal.recommendation.recommendationId,
      proposedActionId: action.actionId,
      actionFingerprint: binding.actionFingerprint,
      executionChainCorrelated: false,
    });
  }

  // The canonical execution-intent runtime proves the intent names and exactly reproduces the
  // approved action — same recommendation, same decision, same action id, same action type, same
  // contract version, structurally identical governed parameters.
  let observation;
  try {
    observation = createExecutionIntentRuntime().validate({
      intent,
      approval: evidenceForRuntime,
    });
  } catch {
    throw new Jao7AutonomyError('EXECUTION_INTENT_INVALID');
  }

  if (
    observation.approvedAction.actionId !== action.actionId ||
    observation.intent.recommendationId !== proposal.recommendation.recommendationId ||
    observation.approvalCorrelation.actionFingerprint !== binding.actionFingerprint
  ) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }

  return Object.freeze({
    observationCode: 'CORRELATED_APPROVED_ACTION_AND_INTENT' as const,
    approvalDecisionDigest: decisionDigest(decision),
    executionIntentDigest: intentDigest(intent),
    recommendationId: proposal.recommendation.recommendationId,
    proposedActionId: action.actionId,
    actionFingerprint: binding.actionFingerprint,
    executionChainCorrelated: true,
  });
}
