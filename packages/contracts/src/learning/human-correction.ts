/**
 * HumanCorrectionV1 — a human said the agent was wrong, and said how.
 *
 * The most valuable signal in the system, and the easiest one to lose.
 *
 * ### A correction is a new record. It is never an edit.
 *
 * "Corrections are **new records**, not edits. The history of what we believed and
 * when is part of the audit" (docs/governance/auditability-principles.md).
 *
 * So this contract does not mutate the recommendation it corrects. It points at it.
 * The wrong recommendation stays exactly as wrong as it was, forever, next to the
 * record of a human disagreeing with it — which is the only arrangement in which
 * anyone can later ask *how often were we wrong, and about what*.
 *
 * A system that edits the original loses that question permanently, and it loses it
 * silently: every recommendation in the store looks correct, because every incorrect
 * one was fixed.
 *
 * ### Only a human corrects
 *
 * `correctedBy` is a `HumanActor` — not an `ActorReference`. A policy cannot correct
 * an agent, and neither can another agent. This is deliberate and it is narrower than
 * the approval path, which does admit a versioned policy as a decider.
 *
 * The reason: an approval is a *decision under a rule*, and a rule can encode one. A
 * correction is a *judgment that the rule or the model got it wrong*, and there is no
 * coherent sense in which a policy makes that judgment about itself. An agent
 * correcting an agent is a feedback loop with no ground truth in it — and it is
 * precisely how a model learns to satisfy another model rather than to be right.
 */

import { z } from 'zod';

import {
  correctionIdSchema,
  correlationIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { humanActorSchema } from '../common/actor.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const HUMAN_CORRECTION_CONTRACT_VERSION = 1;

/**
 * What kind of thing the agent got wrong.
 *
 * Bands, so the answer to "what does this agent get wrong?" is countable rather than
 * anecdotal. An agent whose corrections are overwhelmingly `evidence-wrong` has a
 * data problem; one whose corrections are `judgment-wrong` has a model problem. Those
 * need different fixes, and a free-text field would hide the difference.
 */
export const CORRECTION_TYPES = [
  'evidence-wrong',
  'judgment-wrong',
  'risk-misclassified',
  'priority-wrong',
  'action-inappropriate',
  'should-not-have-recommended',
  'missed-something',
] as const;

export const correctionTypeSchema = z.enum(CORRECTION_TYPES);
export type CorrectionType = z.infer<typeof correctionTypeSchema>;

export const humanCorrectionV1Schema = z.strictObject({
  correctionId: correctionIdSchema,
  contractVersion: z.literal(HUMAN_CORRECTION_CONTRACT_VERSION),

  /** What was corrected. Pointed at, never modified. */
  recommendationId: recommendationIdSchema,

  /** A human. Not a policy, and never another agent. */
  correctedBy: humanActorSchema,
  correctedAt: utcTimestampSchema,

  correctionType: correctionTypeSchema,
  reasonCode: reasonCodeSchema,

  /**
   * What the human said should have happened instead.
   *
   * Bounded text, written to be read by another human and by an evaluator. It is not
   * a new recommendation, it does not execute, and it authorizes nothing — it is a
   * note attached to a mistake.
   */
  correctedSummary: boundedText(TEXT_LIMITS.summary).optional(),
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export type HumanCorrectionV1 = z.infer<typeof humanCorrectionV1Schema>;
