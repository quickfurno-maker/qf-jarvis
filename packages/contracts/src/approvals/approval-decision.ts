/**
 * ApprovalDecisionV1 — the record of a decision QuickFurno Core made.
 *
 * **This contract records a decision. It does not execute one, and it does not
 * make one.** An approval becomes authoritative when Core records it — not when
 * Jarvis constructs an object that says so.
 *
 * Two structural facts do the work here, and neither is a rule anyone has to
 * remember:
 *
 * 1. `issuer` is the literal `quickfurno-core`. A decision issued by anything else
 *    does not parse. Jarvis cannot manufacture authority by manufacturing an
 *    artifact (execution-governance.md §3).
 *
 * 2. `decidedBy` is a human **or** a named, versioned policy — and there is no
 *    third variant. An agent cannot be represented as an approval authority
 *    because the shape does not exist (see common/actor.ts). "No agent
 *    self-approval, at any confidence, in any circumstance."
 *
 * There is also no `expiresAt`-driven auto-approval and no timeout-to-yes. An
 * undecided recommendation expires; expiry is not approval. **Silence is never
 * consent** (execution-governance.md §2).
 */

import { z } from 'zod';

import { actorReferenceSchema } from '../common/actor.js';
import {
  actionIdSchema,
  correlationIdSchema,
  decisionIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';

/**
 * The three outcomes an authorized decider may reach.
 *
 * Taken verbatim from execution-governance.md §2: **approved**, **rejected**, or
 * **changes requested**. There is no fourth, and in particular there is no
 * "pending" or "auto" — a decision that has not been made is not a decision, and
 * it is represented by the *absence* of this record.
 */
export const APPROVAL_OUTCOMES = ['approved', 'rejected', 'changes-requested'] as const;

export const approvalOutcomeSchema = z.enum(APPROVAL_OUTCOMES);
export type ApprovalOutcome = z.infer<typeof approvalOutcomeSchema>;

/** A per-action verdict. Only ever approved or rejected — no middle state. */
export const actionDecisionSchema = z.strictObject({
  actionId: actionIdSchema,
  decision: z.enum(['approved', 'rejected']),
});

export type ActionDecision = z.infer<typeof actionDecisionSchema>;

export const MAX_ACTION_DECISIONS = 20;

export const APPROVAL_DECISION_CONTRACT_VERSION = 1;

const approvalDecisionShapeSchema = z.strictObject({
  decisionId: decisionIdSchema,
  recommendationId: recommendationIdSchema,
  contractVersion: z.literal(APPROVAL_DECISION_CONTRACT_VERSION),

  /** The authority. Always Core, and the literal is what makes that true. */
  issuer: quickfurnoCoreSchema,

  /** A named human, or a named and versioned policy. Never an agent. */
  decidedBy: actorReferenceSchema,
  decidedAt: utcTimestampSchema,

  outcome: approvalOutcomeSchema,

  /**
   * Per-action verdicts, which is how **partial approval** is expressed: approve
   * the follow-up message, reject the discount. A rejected action is not
   * executable, and no execution intent may reference one.
   */
  actionDecisions: z.array(actionDecisionSchema).max(MAX_ACTION_DECISIONS),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  /**
   * How long this authorization remains usable.
   *
   * "An authorization that made sense at 09:00 may be wrong at 17:00."
   * Optional, because not every decision is time-boxed; but when present it must
   * be after the decision, or it authorizes nothing.
   */
  validUntil: utcTimestampSchema.optional(),

  correlationId: correlationIdSchema,
});

export const approvalDecisionV1Schema = approvalDecisionShapeSchema.superRefine((value, ctx) => {
  const actionIds = value.actionDecisions.map((decision) => decision.actionId);
  if (new Set(actionIds).size !== actionIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['actionDecisions'],
      message: 'Every actionDecisions[].actionId must be unique',
    });
  }

  if (value.validUntil !== undefined && !isStrictlyBefore(value.decidedAt, value.validUntil)) {
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'validUntil must be strictly after decidedAt',
    });
  }

  const approvedActions = value.actionDecisions.filter(
    (decision) => decision.decision === 'approved',
  );

  // An "approved" outcome must actually approve something, or the execution path
  // has authorization with nothing to execute — an ambiguity Core would have to
  // resolve by guessing.
  if (value.outcome === 'approved' && approvedActions.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['actionDecisions'],
      message: 'An approved decision must approve at least one action',
    });
  }

  // "Rejected actions cannot be treated as executable." A rejected or
  // changes-requested outcome that nonetheless approves an action would be
  // exactly the contradiction an attacker — or a bug — would look for.
  if (value.outcome !== 'approved' && approvedActions.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['actionDecisions'],
      message: `A "${value.outcome}" decision must not approve any action`,
    });
  }
});

export type ApprovalDecisionV1 = z.infer<typeof approvalDecisionV1Schema>;
