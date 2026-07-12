/**
 * RecommendationLifecycleRecordV1 — where a recommendation stands.
 *
 * The fourteen states are taken **verbatim** from the approved lifecycle
 * (docs/architecture/recommendation-lifecycle.md). They are not renamed, merged,
 * or "tidied up" here. A state that is convenient to rename is a state somebody
 * else is relying on.
 *
 * ### What this contract does not do: transitions
 *
 * The approved lifecycle includes a state diagram, and it would be easy to encode
 * it as a transition matrix. This contract deliberately does not.
 *
 * A lifecycle record is a **point-in-time fact** — "this recommendation was in
 * this state at this instant, for this reason". Validating a *transition* requires
 * the previous state, which a single record does not carry, and it requires
 * knowing the recommendation's history, which is a stateful concern, not a schema
 * one. Encoding a matrix here would mean either inventing a `previousState` field
 * that Phase 0 never asked for, or pretending a stateless validator can enforce a
 * stateful rule.
 *
 * **Transition validity is therefore policy, enforced by the coordination layer in
 * Phase 4 against stored history — not by this schema.** That is stated plainly
 * rather than quietly assumed, because a reader who believes the schema enforces
 * transitions will not build the thing that actually does.
 *
 * What the schema *does* enforce is reference integrity: a state that only Core
 * can produce must carry the Core record that produced it.
 */

import { z } from 'zod';

import {
  correlationIdSchema,
  decisionIdSchema,
  executionIntentIdSchema,
  executionResultIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

/**
 * The fourteen authoritative states, exactly as approved.
 *
 * Machine values are lowercase kebab-case; the display labels are in
 * `RECOMMENDATION_STATE_LABELS`. Machines switch on the former; humans read the
 * latter. Deriving one from the other at runtime is how a display change silently
 * becomes a behavior change.
 */
export const RECOMMENDATION_STATES = [
  'received',
  'validated',
  'routed',
  'analyzed',
  'recommended',
  'awaiting-approval',
  'approved',
  'rejected',
  'changes-requested',
  'expired',
  'converted-to-execution-intent',
  'executed',
  'result-received',
  'closed',
] as const;

export const recommendationStateSchema = z.enum(RECOMMENDATION_STATES);
export type RecommendationState = z.infer<typeof recommendationStateSchema>;

export const RECOMMENDATION_STATE_LABELS: Readonly<Record<RecommendationState, string>> = {
  received: 'Received',
  validated: 'Validated',
  routed: 'Routed',
  analyzed: 'Analyzed',
  recommended: 'Recommended',
  'awaiting-approval': 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  'changes-requested': 'Changes requested',
  expired: 'Expired',
  'converted-to-execution-intent': 'Converted to execution intent',
  executed: 'Executed',
  'result-received': 'Result received',
  closed: 'Closed',
};

/**
 * States that exist only because QuickFurno Core recorded a decision.
 *
 * "Jarvis never sets `approved` itself" (recommendation-lifecycle.md, rule 3).
 * Requiring the decision reference is how that stops being a rule people
 * remember and starts being a record that must exist.
 */
const STATES_REQUIRING_DECISION: readonly RecommendationState[] = [
  'approved',
  'rejected',
  'changes-requested',
];

/** "Only `approved` recommendations may become execution intents" (rule 4). */
const STATES_REQUIRING_INTENT: readonly RecommendationState[] = [
  'converted-to-execution-intent',
  'executed',
];

const STATES_REQUIRING_RESULT: readonly RecommendationState[] = ['result-received'];

export const RECOMMENDATION_LIFECYCLE_CONTRACT_VERSION = 1;

const recommendationLifecycleShapeSchema = z.strictObject({
  recommendationId: recommendationIdSchema,
  contractVersion: z.literal(RECOMMENDATION_LIFECYCLE_CONTRACT_VERSION),
  state: recommendationStateSchema,
  recordedAt: utcTimestampSchema,

  /** Present exactly when Core has recorded a decision that produced this state. */
  approvalDecisionId: decisionIdSchema.optional(),
  executionIntentId: executionIntentIdSchema.optional(),
  executionResultId: executionResultIdSchema.optional(),

  /** Why this state was recorded. Mandatory: "every transition is attributable". */
  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const recommendationLifecycleRecordV1Schema = recommendationLifecycleShapeSchema.superRefine(
  (value, ctx) => {
    if (STATES_REQUIRING_DECISION.includes(value.state) && value.approvalDecisionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvalDecisionId'],
        message: `State "${value.state}" exists only because QuickFurno Core recorded a decision, so approvalDecisionId is required`,
      });
    }

    if (STATES_REQUIRING_INTENT.includes(value.state) && value.executionIntentId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionIntentId'],
        message: `State "${value.state}" requires the executionIntentId that QuickFurno Core issued`,
      });
    }

    if (STATES_REQUIRING_RESULT.includes(value.state) && value.executionResultId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionResultId'],
        message: `State "${value.state}" requires the executionResultId that QuickFurno Core recorded`,
      });
    }
  },
);

export type RecommendationLifecycleRecordV1 = z.infer<typeof recommendationLifecycleRecordV1Schema>;
