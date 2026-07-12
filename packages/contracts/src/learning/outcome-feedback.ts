/**
 * OutcomeFeedbackV1 — the recommendation was acted upon. Did anything actually get
 * better?
 *
 * This is the contract that keeps the evaluation loop honest, and it is separate from
 * `RecommendationEvaluationV1` on purpose (see the reasoning there).
 *
 * Acceptance asks: *did a human like it?* Outcome asks: **did the business metric
 * move, in the direction the agent said it would?** An agent can score perfectly on
 * the first while being worthless on the second — and an agent optimized against the
 * first will *reliably* become worthless on the second, because agreeable and correct
 * are different targets and only one of them was being measured.
 *
 * ### `movedInExpectedDirection` is the whole contract
 *
 * Everything else here is context. This one boolean is the difference between "our
 * agents are well-liked" and "our agents work", and it is the field that Phase 14's
 * automation gates actually read: **no recommendation class is promoted to automation
 * on acceptance data alone** (phased-roadmap.md, Phase 15).
 *
 * ### `unknown` is a permitted, and frequently correct, answer
 *
 * The outcome class includes `unknown`, and it is not a cop-out. Business outcomes are
 * confounded — a client converted, but a campaign also changed, and the season turned.
 * A system that forces every outcome into positive or negative manufactures a
 * correlation, and a manufactured correlation is worse than an admitted ignorance
 * because somebody will promote an agent on the strength of it.
 *
 * When we do not know, we say so, and the example does not count toward a gate.
 */

import { z } from 'zod';

import {
  correlationIdSchema,
  outcomeFeedbackIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { evidenceItemSchema, MAX_EVIDENCE_ITEMS } from '../recommendations/recommendation.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const OUTCOME_FEEDBACK_CONTRACT_VERSION = 1;

/**
 * What happened after the recommendation was acted upon.
 *
 * `unknown` is a first-class member. See the file header — forcing a verdict where
 * none exists is how a system talks itself into automating something.
 */
export const OUTCOME_CLASSES = ['positive', 'negative', 'neutral', 'unknown'] as const;

export const outcomeClassSchema = z.enum(OUTCOME_CLASSES);
export type OutcomeClass = z.infer<typeof outcomeClassSchema>;

const outcomeFeedbackShapeSchema = z.strictObject({
  outcomeFeedbackId: outcomeFeedbackIdSchema,
  contractVersion: z.literal(OUTCOME_FEEDBACK_CONTRACT_VERSION),

  recommendationId: recommendationIdSchema,

  observedAt: utcTimestampSchema,

  outcomeClass: outcomeClassSchema,

  /**
   * Which business metric this is about — cost per verified lead, vendor retention,
   * client conversion. A stable code, so it can be counted and compared across agents.
   */
  outcomeMetricCode: machineTokenSchema,

  /**
   * Did it move the way the agent said it would?
   *
   * Optional **only** when the outcome class is `unknown` — enforced below. If we
   * claim to know the outcome, we must say whether it matched the prediction, or the
   * outcome record tells us nothing we can evaluate against.
   */
  movedInExpectedDirection: z.boolean().optional(),

  /**
   * The facts behind the claim. Pointers into Core, never copies.
   *
   * Mandatory for any outcome we claim to know. "The model thought so" is not evidence,
   * and neither is "the number went up" without a pointer to the number.
   */
  evidence: z.array(evidenceItemSchema).max(MAX_EVIDENCE_ITEMS),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export const outcomeFeedbackV1Schema = outcomeFeedbackShapeSchema.superRefine((value, ctx) => {
  const isKnown = value.outcomeClass !== 'unknown';

  // A known outcome that does not say whether the prediction held is not usable as
  // evaluation data — which means it would inflate the denominator of a gate while
  // contributing nothing to its numerator.
  if (isKnown && value.movedInExpectedDirection === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['movedInExpectedDirection'],
      message:
        'A known outcome must state whether the metric moved in the direction the recommendation predicted. Outcome data that cannot be compared with the prediction is not outcome data',
    });
  }

  // Claiming to know the outcome while pointing at nothing is exactly the
  // unfalsifiable assertion the evidence rule exists to forbid.
  if (isKnown && value.evidence.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['evidence'],
      message: 'A known outcome must carry at least one evidence item',
    });
  }

  // If we do not know what happened, we cannot also know that it went as predicted.
  if (!isKnown && value.movedInExpectedDirection !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['movedInExpectedDirection'],
      message:
        'An "unknown" outcome cannot also claim the metric moved as predicted. If we know that, the outcome is not unknown',
    });
  }
});

export type OutcomeFeedbackV1 = z.infer<typeof outcomeFeedbackV1Schema>;
