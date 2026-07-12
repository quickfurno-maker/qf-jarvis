/**
 * RecommendationEvaluationV1 — was this recommendation any good?
 *
 * Acceptance, and calibration. Deliberately **not** outcome — that is a different
 * contract, and the separation is the most important idea in this file
 * (see outcome-feedback.ts).
 *
 * ### Acceptance is a proxy, and this contract knows it
 *
 * A high acceptance rate means humans *liked* the recommendations. It does not mean
 * the recommendations were *right*. Those come apart in a specific and dangerous way:
 * an agent that learns to produce plausible, agreeable, low-friction suggestions will
 * score beautifully on acceptance while moving no business metric at all — and it will
 * do so *because* acceptance was the thing being optimized.
 *
 * "Evaluating on proxies rather than outcomes — high acceptance on recommendations that
 * changed nothing" is named in the roadmap as the principal risk of the evaluation
 * phase, and the mitigation is stated there too: **outcome correlation is required
 * before any automation promotion, not just acceptance** (phased-roadmap.md, Phase 14).
 *
 * Keeping acceptance and outcome in two contracts is how that requirement stays
 * enforceable. If they shared a shape, "we have evaluation data" would be true of a
 * system that had never once checked whether anything got better.
 *
 * ### Calibration
 *
 * `confidenceCalibration` records how the stated confidence compared with what actually
 * turned out to be true. An agent that says 0.9 and is right 60% of the time is not
 * merely wrong; it is **wrong in a way that makes its confidence actively misleading** —
 * and a founder who has learned to trust 0.9 will act on the next one too.
 */

import { z } from 'zod';

import {
  correlationIdSchema,
  evaluationIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { agentIdSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const RECOMMENDATION_EVALUATION_CONTRACT_VERSION = 1;

/**
 * What a human did with it.
 *
 * `expired` and `dismissed` are outcomes, not absences. A recommendation nobody ever
 * looked at is the **stale-recommendation rate** — the project's adoption canary — and
 * a system that only records the ones people engaged with cannot see it going wrong.
 */
export const ACCEPTANCE_OUTCOMES = [
  'accepted',
  'rejected',
  'changes-requested',
  'dismissed',
  'expired-unread',
] as const;

export const acceptanceOutcomeSchema = z.enum(ACCEPTANCE_OUTCOMES);
export type AcceptanceOutcome = z.infer<typeof acceptanceOutcomeSchema>;

/** How good it was, as a band a human can assign consistently. */
export const QUALITY_BANDS = ['poor', 'weak', 'adequate', 'good', 'excellent'] as const;

export const qualityBandSchema = z.enum(QUALITY_BANDS);
export type QualityBand = z.infer<typeof qualityBandSchema>;

export const recommendationEvaluationV1Schema = z.strictObject({
  evaluationId: evaluationIdSchema,
  contractVersion: z.literal(RECOMMENDATION_EVALUATION_CONTRACT_VERSION),

  recommendationId: recommendationIdSchema,

  /** Which agent is being evaluated, and which build of it. */
  evaluatedAgent: agentIdSchema,
  evaluatedAgentVersion: machineTokenSchema,

  /** A human, or a named and versioned evaluation policy. Never the agent under evaluation. */
  evaluator: actorReferenceSchema,
  evaluatedAt: utcTimestampSchema,

  acceptanceOutcome: acceptanceOutcomeSchema,
  qualityBand: qualityBandSchema.optional(),

  /**
   * The confidence the agent stated, and whether reality bore it out.
   *
   * Both are optional because calibration cannot always be assessed at evaluation
   * time — sometimes you have to wait and see, and that is what outcome feedback is
   * for. But when it *can* be assessed, it must be recorded, or the confidence number
   * on every recommendation is decoration.
   */
  statedConfidence: z.number().min(0).max(1).optional(),
  confidenceWasJustified: z.boolean().optional(),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export type RecommendationEvaluationV1 = z.infer<typeof recommendationEvaluationV1Schema>;
