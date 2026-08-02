/**
 * The strict runtime input (QFJ-P05.05, ADR-0079).
 *
 * ### What a caller may state, and what it may not
 *
 * A caller states SEMANTICS: what this is about, how risky it is, what approval it would need, the
 * evidence behind it, and what could be done. The runtime supplies IDENTITY and PROVENANCE:
 * `recommendationId`, each `actionId`, `contractVersion`, and the literal `producingSystem`.
 *
 * The split is not a convenience. `producingSystem` is the structural boundary that says only QF
 * Jarvis produces recommendations, and an identifier a caller chose is an identifier a caller can
 * reuse — which would let two different recommendations share an approval decision. So neither is
 * accepted, and both schemas below are `strictObject`: an unknown key is a refusal, not something
 * quietly dropped.
 *
 * ### Why there is no inference
 *
 * It would be easy to derive `risk` from `actionType`, or `requiredApproval` from `risk`, and it
 * would be wrong. Risk determines the approval path (execution-governance.md §9), so a runtime that
 * guessed it would be deciding how much human oversight an action receives — from a heuristic, in a
 * package with no authority to decide anything. The caller states both, and `recommendationV1Schema`
 * enforces the governed relationship between them (informational ⇒ no actions and no approval;
 * money-related ⇒ stronger approval or founder). A wrong pairing is refused; it is never repaired.
 *
 * Confidence is present and is deliberately wired to nothing.
 */
import {
  actionParametersSchema,
  agentIdSchema,
  approvalLevelSchema,
  boundedText,
  contractVersionSchema,
  correlationIdSchema,
  entityReferenceSchema,
  evidenceItemSchema,
  machineTokenSchema,
  MAX_CONTRIBUTING_AGENTS,
  MAX_EVIDENCE_ITEMS,
  MAX_PROPOSED_ACTIONS,
  prioritySchema,
  riskClassSchema,
  specialistAgentIdSchema,
  TEXT_LIMITS,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import type { JsonObject } from '@qf-jarvis/contracts';
import { z } from 'zod';

/**
 * One proposed action, as a caller describes it.
 *
 * Exactly four fields, and `actionId` is not among them — the runtime generates it. Nor is
 * `actionFingerprint`: a fingerprint a caller supplied would be a claim about content rather than a
 * measurement of it, and the whole point of the digest is that nobody has to trust the claim.
 *
 * There is no `recipient`, no `executor`, no `approval` and no credential field, here or anywhere
 * below. `parameters` is scanned by `actionParametersSchema`, so they cannot be smuggled in as data
 * either.
 */
export const proposedActionDraftSchema = z.strictObject({
  actionType: machineTokenSchema,
  actionContractVersion: contractVersionSchema,
  summary: boundedText(TEXT_LIMITS.summary),
  parameters: actionParametersSchema,
});

export interface ProposedActionDraft {
  readonly actionType: string;
  readonly actionContractVersion: number;
  readonly summary: string;
  readonly parameters: JsonObject;
}

/**
 * The full input.
 *
 * Every field here appears on `RecommendationV1` unchanged. The four the runtime owns —
 * `recommendationId`, `contractVersion`, `producingSystem`, and each action's `actionId` — are
 * absent, so supplying one is an unknown key and therefore `invalid-input`.
 */
export const recommendationRuntimeInputSchema = z.strictObject({
  recommendationType: machineTokenSchema,
  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  producingAgent: agentIdSchema,
  producingAgentVersion: machineTokenSchema,
  subject: entityReferenceSchema,
  priority: prioritySchema,
  confidence: z.number().min(0).max(1),
  risk: riskClassSchema,
  requiredApproval: approvalLevelSchema,
  summary: boundedText(TEXT_LIMITS.summary),
  rationale: boundedText(TEXT_LIMITS.rationale),
  evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),
  proposedActions: z.array(proposedActionDraftSchema).max(MAX_PROPOSED_ACTIONS),
  composite: z.boolean(),
  contributingAgents: z
    .array(specialistAgentIdSchema)
    .min(1)
    .max(MAX_CONTRIBUTING_AGENTS)
    .optional(),
  correlationId: correlationIdSchema,
});

export type RecommendationRuntimeInput = z.infer<typeof recommendationRuntimeInputSchema>;
