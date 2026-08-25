/**
 * The JAO-6 governed business-action proposal contracts (ADR-0120).
 *
 * JAO-6 is a QFJ-P12 capability overlay, not a phase. It lets the supervisor construct a proposal
 * that ENTERS the existing path -- recommendation, then Core/human authorization, then execution
 * intent -- and it stops at the first step. It introduces no parallel execution system, and it is
 * the artifacts of the existing kernel it produces, not new ones of its own.
 *
 * ### What this file is for
 *
 * The vocabularies and the two boundary shapes: what a caller may state (`Jao6ProposalRequest`) and
 * what it gets back (`Jao6ProposalResult`). Both are `z.strictObject`, so an unknown key is a
 * refusal rather than something quietly dropped.
 *
 * ### The request is deliberately small, and the omissions are the design
 *
 * A caller states a SUBJECT, EVIDENCE, bounded WORDING, bounded PARAMETERS and TIMING. It does not
 * state `risk`, `requiredApproval`, `recommendationType`, `actionType`, `actionContractVersion` or
 * the producing agent, because those come from a static reviewed policy. Risk determines the
 * approval path, so a caller that could state it would be choosing how much human oversight its own
 * proposal receives.
 *
 * `confidence` is accepted and is wired to nothing. It travels onto the recommendation as data and
 * changes no gate. A model score can never reduce an approval requirement.
 *
 * ### The result says what was produced AND what was not
 *
 * "Ready to enter the path" and "authorized" are different states, and the difference has to be
 * structural rather than a matter of documentation. So the result carries literal posture: no
 * approval decision was created, no execution intent was created, nothing was sent, no provider was
 * called, nothing was persisted. There is no `canExecute`, no `canSend`, no `authorized` and no
 * `permissionGranted` field, because the honest answer is that this layer does not know and may
 * never claim to.
 */
import {
  boundedText,
  entityReferenceSchema,
  evidenceItemSchema,
  machineTokenSchema,
  MAX_EVIDENCE_ITEMS,
  prioritySchema,
  TEXT_LIMITS,
  utcTimestampSchema,
  correlationIdSchema,
} from '@qf-jarvis/contracts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Closed vocabularies.
// ---------------------------------------------------------------------------

/**
 * Why a proposal was refused. A closed set, and a total message map below.
 *
 * A new member cannot inherit an existing verdict: `Record<Jao6RefusalReason, string>` fails to
 * compile until the new code is given its own sentence.
 */
export const JAO6_REFUSAL_REASONS = [
  'REQUEST_INVALID',
  'POLICY_UNKNOWN',
  'POLICY_VERSION_MISMATCH',
  'POLICY_NOT_ACTIVE',
  'SUBJECT_TYPE_NOT_ALLOWED',
  'EVIDENCE_INVALID',
  'PARAMETERS_INVALID',
  'LIFETIME_EXCEEDED',
  'TIMING_INVALID',
  'RECOMMENDATION_REFUSED',
  'BINDING_MISMATCH',
  'APPROVAL_REQUEST_REFUSED',
] as const;

export type Jao6RefusalReason = (typeof JAO6_REFUSAL_REASONS)[number];

/** The fixed sentence per code, chosen BY the code and never built FROM an input. A total map. */
const JAO6_MESSAGES: Readonly<Record<Jao6RefusalReason, string>> = Object.freeze({
  REQUEST_INVALID: 'The proposal request is invalid.',
  POLICY_UNKNOWN: 'No such proposal policy is registered.',
  POLICY_VERSION_MISMATCH: 'That proposal policy version is not the registered one.',
  POLICY_NOT_ACTIVE: 'That proposal policy is not active for this proof.',
  SUBJECT_TYPE_NOT_ALLOWED: 'The subject entity type is not allowed by the policy.',
  EVIDENCE_INVALID: 'The evidence does not satisfy the policy.',
  PARAMETERS_INVALID: 'The parameters do not satisfy the policy parameter schema.',
  LIFETIME_EXCEEDED: 'The requested lifetime exceeds the policy ceiling.',
  TIMING_INVALID: 'The requested timing is not internally consistent.',
  RECOMMENDATION_REFUSED: 'The canonical recommendation runtime refused the assembled input.',
  BINDING_MISMATCH: 'The action binding did not match the canonical recommendation.',
  APPROVAL_REQUEST_REFUSED: 'The canonical approval runtime refused the assembled request.',
});

/** The only outcomes. There is no `APPROVED`, no `AUTHORIZED` and no `EXECUTED`. */
export const JAO6_OUTCOMES = ['PROPOSAL_READY', 'REFUSED'] as const;
export type Jao6Outcome = (typeof JAO6_OUTCOMES)[number];

/**
 * The refusal, carrying a code and nothing else.
 *
 * The thrown object from an inner runtime is never read for its message: a Zod issue tree can quote
 * the very parameters the governed schemas exist to keep out of logs.
 */
export class Jao6ProposalError extends Error {
  readonly code: Jao6RefusalReason;

  constructor(code: Jao6RefusalReason) {
    super(JAO6_MESSAGES[code]);
    this.name = 'Jao6ProposalError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// The request.
// ---------------------------------------------------------------------------

/**
 * What a caller may state.
 *
 * Strict. Every field the policy owns is absent, so naming one is an unknown key and therefore
 * `REQUEST_INVALID`. That is what closes the whole policy-smuggling class in one place: `risk`,
 * `requiredApproval`, `recommendationType`, `actionType`, `actionContractVersion`,
 * `producingAgent`, `recommendationId`, `actionId`, `actionFingerprint`, `approvalRequestId`,
 * `approved`, `authorized`, `canExecute`, `canSend`, `approvalDecision`, `executionIntent`,
 * `provider`, `executor`, `n8n`, `webhookUrl`, `recipient`, `phoneNumber` and any credential key
 * are all simply not fields here.
 *
 * `parameters` is `unknown` on purpose. Its real shape is the POLICY's parameter schema, which is
 * chosen after the policy is resolved -- so validating it here would mean guessing which policy
 * applies before reading which policy was named.
 */
export const jao6ProposalRequestSchema = z.strictObject({
  proposalPolicyId: machineTokenSchema,
  proposalPolicyVersion: z.number().int().min(1).max(1_000),

  /** An opaque Core reference. Its `entityType` must be one the policy allows. */
  subject: entityReferenceSchema,

  priority: prioritySchema,
  /** Data. Calibration and prioritization only -- never permission, at any value. */
  confidence: z.number().min(0).max(1),

  summary: boundedText(TEXT_LIMITS.summary),
  rationale: boundedText(TEXT_LIMITS.rationale),

  /** The canonical contract evidence shapes. There is no free-text reasoning blob. */
  evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),

  /** Validated against the resolved POLICY's exact schema, not here. */
  parameters: z.unknown(),

  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,

  correlationId: correlationIdSchema,
});

export type Jao6ProposalRequest = z.infer<typeof jao6ProposalRequestSchema>;

// ---------------------------------------------------------------------------
// The result.
// ---------------------------------------------------------------------------

/**
 * The literal sentence attached to every communication-facing proposal.
 *
 * A constant, so a caller cannot influence what the result says about its own limits, and so the
 * rule is greppable rather than folklore.
 */
export const JAO6_EXECUTION_ELIGIBILITY_NOTICE =
  'This proposal is NOT send permission. Consent, opt-out, suppression and STOP eligibility must ' +
  'be re-read at execution time through the existing QuickFurno Core and communications path.';

/**
 * The posture every JAO-6 result carries, whatever the outcome.
 *
 * Literals, not computed values. A field that could be computed is a field that could one day be
 * computed differently; these are the boundary, so they are pinned by `z.literal`.
 *
 * Note what is NOT here: `canExecute`, `canSend`, `authorized`, `approved`, `permissionGranted`,
 * `consentValid`, `suppressionClear`, `recipientResolved`. Absence is stronger than a false
 * boolean, because a boolean is one edit away from being true.
 */
export const jao6PostureSchema = z.strictObject({
  mode: z.literal('SHADOW'),
  authority: z.literal('RECOMMEND_ONLY'),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),
  approvalDecisionCreated: z.literal(false),
  executionIntentCreated: z.literal(false),
  communicationAuthorizationCreated: z.literal(false),
  communicationEligibilityChecked: z.literal(false),
  coreMutations: z.literal(0),
  n8nExecutions: z.literal(0),
  channelSends: z.literal(0),
  providerCalls: z.literal(0),
  modelCalls: z.literal(0),
  specialistCalls: z.literal(0),
  toolCalls: z.literal(0),
  memoryWrites: z.literal(0),
});

export type Jao6Posture = z.infer<typeof jao6PostureSchema>;

/** The frozen posture value. One object, reused, never rebuilt from anything a caller supplied. */
export const JAO6_POSTURE: Jao6Posture = Object.freeze(
  jao6PostureSchema.parse({
    mode: 'SHADOW',
    authority: 'RECOMMEND_ONLY',
    businessEffect: false,
    productionMutation: false,
    approvalDecisionCreated: false,
    executionIntentCreated: false,
    communicationAuthorizationCreated: false,
    communicationEligibilityChecked: false,
    coreMutations: 0,
    n8nExecutions: 0,
    channelSends: 0,
    providerCalls: 0,
    modelCalls: 0,
    specialistCalls: 0,
    toolCalls: 0,
    memoryWrites: 0,
  }),
);

/**
 * One proposal attempt.
 *
 * The canonical artifacts are carried by reference -- `RecommendationV1`, the runtime's own
 * `RecommendationActionBinding` triple, and `ApprovalRequestV1` -- because re-declaring their shapes
 * here would create a second definition of contracts `@qf-jarvis/contracts` already owns, and a
 * second definition is a definition that can drift. They are typed, not re-validated into a local
 * copy.
 *
 * The cross-field rules below are what make the two states honest: a ready proposal has all three
 * artifacts and no refusal; a refusal has none of them and a code.
 */
export interface Jao6ProposalResult {
  readonly outcome: Jao6Outcome;
  readonly refusalReason: Jao6RefusalReason | null;

  readonly proposalPolicyId: string;
  readonly proposalPolicyVersion: number;
  readonly correlationId: string;

  /** The canonical inert artifact, or null. Produced by `@qf-jarvis/recommendation-runtime`. */
  readonly recommendation: unknown;
  /** The canonical `{ recommendationId, proposedActionId, actionFingerprint }` triples. */
  readonly actionBindings: readonly unknown[];
  /** The canonical POWERLESS ask, or null. Produced by `@qf-jarvis/approval-runtime`. */
  readonly approvalRequest: unknown;

  readonly posture: Jao6Posture;

  /**
   * True when this proposal class reaches a client or a vendor.
   *
   * It states that a SECOND yes is mandatory later; it never states that the second yes exists.
   */
  readonly communicationExecutionEligibilityRequired: boolean;
  /** The literal notice, or null when the class is not communication-facing. */
  readonly executionEligibilityNotice: string | null;
}
