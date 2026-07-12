/**
 * RecommendationV1 — an inert proposal.
 *
 * **This object cannot cause an effect.** It is a structured proposal and nothing
 * more: evidence, rationale, confidence, risk, priority, expiry, required
 * approval. It has no mechanism to send a message, move money, assign a lead, or
 * authorize itself. Even a fully compromised agent emitting a malicious
 * recommendation has, at most, *proposed* something that a human or a policy will
 * then decline (docs/architecture/execution-governance.md §1).
 *
 * That inertness is not a limitation to engineer around. It is the product.
 *
 * The schema enforces it structurally:
 *
 * - `producingSystem` is the literal `qf-jarvis`, and nothing else parses.
 * - There is no `approved` field, no `authorized` field, no `sent` field — and an
 *   action's parameters are scanned so none can be smuggled in as data.
 * - There is no recipient phone number or email address to send anything to.
 * - Confidence is present, and is deliberately *not* wired to anything: a
 *   0.99-confidence recommendation to spend money needs exactly the same
 *   authorization as a 0.6-confidence one.
 */

import { z } from 'zod';

import {
  actionIdSchema,
  contractVersionSchema,
  correlationIdSchema,
  eventIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { actionParametersSchema, evidenceValueSchema } from '../common/governed-parameters.js';
import { agentIdSchema, qfJarvisSchema, specialistAgentIdSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';

/**
 * Risk class. Taken verbatim from the approved approval matrix
 * (docs/architecture/execution-governance.md §9).
 *
 * **Risk determines the approval path. Confidence does not.**
 */
export const RISK_CLASSES = [
  'informational',
  'low-risk-reversible',
  'client-or-vendor-facing-communication',
  'outbound-voice-call',
  'money-related',
  'high-risk-or-novel',
] as const;

export const riskClassSchema = z.enum(RISK_CLASSES);
export type RiskClass = z.infer<typeof riskClassSchema>;

/**
 * The approval a recommendation would require.
 *
 * `none` exists for exactly one case — an informational item with no proposed
 * action, which executes nothing. It is **never** valid for anything that reaches
 * a client, a vendor, or an ad account, and the schema enforces that below.
 */
export const APPROVAL_LEVELS = [
  'none',
  'delegated-approver',
  'authorized-team-human',
  'stronger-approval',
  'founder',
] as const;

export const approvalLevelSchema = z.enum(APPROVAL_LEVELS);
export type ApprovalLevel = z.infer<typeof approvalLevelSchema>;

/** Approval levels that satisfy "stronger approval" for money-related actions. */
const STRONGER_APPROVAL_LEVELS: readonly ApprovalLevel[] = ['stronger-approval', 'founder'];

/**
 * Business impact and time sensitivity — not recency.
 *
 * Phase 0 requires a priority but does not enumerate one. This closed set is a
 * Phase 2 decision, recorded in ADR-0014.
 */
export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

/**
 * Evidence. Mandatory, always.
 *
 * "A recommendation without evidence is a defect. If an agent cannot point at the
 * facts that produced its conclusion, the conclusion does not ship. 'The model
 * thought so' is not evidence." (agent-model.md)
 *
 * Note the two shapes, and note what is missing. Evidence either points at a
 * canonical event a reviewer can go and check in Core, or states a derived signal
 * with a stable code. There is **no free-text `reasoning` blob**, because that is
 * where chain-of-thought would live, and chain-of-thought is never stored
 * (agent-model.md, privacy-principles.md).
 */
export const canonicalEventEvidenceSchema = z.strictObject({
  evidenceType: z.literal('canonical-event'),
  eventId: eventIdSchema,
  eventType: machineTokenSchema,
  description: boundedText(TEXT_LIMITS.description),
});

export const derivedSignalEvidenceSchema = z.strictObject({
  evidenceType: z.literal('derived-signal'),
  signalCode: reasonCodeSchema,
  description: boundedText(TEXT_LIMITS.description),
  value: evidenceValueSchema.optional(),
});

export const evidenceItemSchema = z.discriminatedUnion('evidenceType', [
  canonicalEventEvidenceSchema,
  derivedSignalEvidenceSchema,
]);

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const MAX_EVIDENCE_ITEMS = 50;
export const MAX_PROPOSED_ACTIONS = 20;
export const MAX_CONTRIBUTING_AGENTS = 4;

/**
 * A proposed action. Inert data describing what *could* be done.
 *
 * It is bounded and specific so that Core can later turn it into an execution
 * intent "without reinterpretation" — but it is not itself permission to do
 * anything, and its parameters are scanned so it cannot pretend to be.
 */
export const proposedActionSchema = z.strictObject({
  actionId: actionIdSchema,
  actionType: machineTokenSchema,
  actionContractVersion: contractVersionSchema,
  summary: boundedText(TEXT_LIMITS.summary),
  parameters: actionParametersSchema,
});

export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const RECOMMENDATION_CONTRACT_VERSION = 1;

const recommendationShapeSchema = z.strictObject({
  recommendationId: recommendationIdSchema,
  contractVersion: z.literal(RECOMMENDATION_CONTRACT_VERSION),

  /** The bounded class of thing being recommended. Core's taxonomy is deferred. */
  recommendationType: machineTokenSchema,

  createdAt: utcTimestampSchema,
  /** Mandatory. Every recommendation goes stale, and a stale one must not be acted upon. */
  expiresAt: utcTimestampSchema,

  /** Only QF Jarvis produces recommendations. The literal is the boundary. */
  producingSystem: qfJarvisSchema,
  producingAgent: agentIdSchema,
  /** Which version of the agent concluded this, so a wrong conclusion is attributable. */
  producingAgentVersion: machineTokenSchema,

  /** What this is about, by opaque Core reference. */
  subject: entityReferenceSchema,

  priority: prioritySchema,
  /** Calibrated over time. Informs prioritization and evaluation; never permission. */
  confidence: z.number().min(0).max(1),
  risk: riskClassSchema,
  requiredApproval: approvalLevelSchema,

  summary: boundedText(TEXT_LIMITS.summary),
  /** The reasoning the agent stands behind, written to be read and challenged. */
  rationale: boundedText(TEXT_LIMITS.rationale),

  evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),
  proposedActions: z.array(proposedActionSchema).max(MAX_PROPOSED_ACTIONS),

  /**
   * True when Jarvis assembled several specialists' conclusions into one item.
   *
   * Explicit rather than inferred, because "is this a composite?" must have an
   * answer that a validator can check — see the invariants below.
   */
  composite: z.boolean(),
  contributingAgents: z
    .array(specialistAgentIdSchema)
    .min(1)
    .max(MAX_CONTRIBUTING_AGENTS)
    .optional(),

  correlationId: correlationIdSchema,
});

/**
 * Cross-field invariants. Each one is traceable to an approved document; none is
 * invented here.
 */
export const recommendationV1Schema = recommendationShapeSchema.superRefine((value, ctx) => {
  // Expiry is mandatory and must be in the future *relative to creation* — not
  // relative to now. Validation reads no clock: an event that was valid when it
  // was emitted must not become invalid because it was replayed tomorrow.
  if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiresAt must be strictly after createdAt',
    });
  }

  // Action identity must be unique, or an approval decision that approves one
  // action and rejects another cannot say which is which.
  const actionIds = value.proposedActions.map((action) => action.actionId);
  if (new Set(actionIds).size !== actionIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['proposedActions'],
      message: 'Every proposedActions[].actionId must be unique within the recommendation',
    });
  }

  // Informational recommendations propose nothing and execute nothing:
  // "Informational | an attention item with no proposed action | None — nothing
  // executes" (execution-governance.md §9). Everything else proposes at least one
  // action and requires a real approval level — "never 'none' for anything that
  // reaches a client, vendor, or ad account" (agent-model.md).
  if (value.risk === 'informational') {
    if (value.proposedActions.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['proposedActions'],
        message: 'An informational recommendation must propose no actions',
      });
    }
    if (value.requiredApproval !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredApproval'],
        message: 'An informational recommendation requires no approval, because nothing executes',
      });
    }
  } else {
    if (value.proposedActions.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['proposedActions'],
        message: 'A non-informational recommendation must propose at least one action',
      });
    }
    if (value.requiredApproval === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredApproval'],
        message:
          'requiredApproval must not be "none" for a recommendation that can reach a client, vendor, or ad account',
      });
    }
  }

  // Money escalates, always. "Stronger approval — the founder, or an administrator
  // with explicit authority. Never delegated by default." (execution-governance.md §9)
  if (
    value.risk === 'money-related' &&
    !STRONGER_APPROVAL_LEVELS.includes(value.requiredApproval)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiredApproval'],
      message: 'A money-related recommendation requires "stronger-approval" or "founder"',
    });
  }

  // "A composite recommendation with no attributable contributors is a Jarvis
  // conclusion wearing a disguise, and it is a defect." (agent-model.md)
  if (value.composite) {
    if (value.producingAgent !== 'jarvis') {
      ctx.addIssue({
        code: 'custom',
        path: ['producingAgent'],
        message: 'Only Jarvis produces a composite recommendation',
      });
    }
    if (value.contributingAgents === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributingAgents'],
        message: 'A composite recommendation must attribute its contributing specialists',
      });
    } else if (new Set(value.contributingAgents).size !== value.contributingAgents.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributingAgents'],
        message: 'contributingAgents must be unique',
      });
    }
  } else if (value.contributingAgents !== undefined) {
    // "Do not force specialist attribution on a bounded recommendation produced
    // directly by one specialist" — and do not permit it either, or the field
    // becomes ambiguous.
    ctx.addIssue({
      code: 'custom',
      path: ['contributingAgents'],
      message: 'contributingAgents may only be present on a composite recommendation',
    });
  }
});

export type RecommendationV1 = z.infer<typeof recommendationV1Schema>;
