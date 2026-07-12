/**
 * AgentRunRecordV1 — one execution of one agent, and everything needed to explain it
 * later.
 *
 * When a recommendation is wrong, this is the record that makes the wrongness
 * *diagnosable*. Without it, "Kabir flagged a good lead as fraudulent" is a complaint.
 * With it, it is a question with an answer: which agent build, which model, which
 * prompt version, which configuration, which input events, which policy — and did the
 * deterministic rules even run before the model was asked?
 *
 * ### Deterministic rules run first, and the record proves it
 *
 * `deterministicRulesEvaluated` is mandatory. "Deterministic rules first: completeness,
 * format validity, threshold checks. Model reasoning only for genuine judgment"
 * (agent-model.md). An agent run that consulted a model while evaluating zero rules is
 * an agent using a model where a rule would do — the single most common and most
 * expensive failure mode in this class of system, and this field is what makes it
 * *visible* rather than a thing somebody has to go and read the code to discover.
 *
 * ### A run may legitimately have no model at all
 *
 * `model` and `promptConfiguration` are optional, and that is not laxity. A run that
 * evaluated deterministic rules and concluded without reasoning is the **best** kind of
 * run — cheaper, faster, and fully explainable. Requiring a model reference would force
 * every run to invent one, which would be a lie, and would quietly imply that using a
 * model is the normal path. It is not.
 *
 * The invariant that *is* enforced: if a model was used, its prompt configuration must
 * be recorded too. A model invocation with unknown prompt provenance is unauditable,
 * and an unauditable invocation is one whose behavior cannot be reproduced or fixed.
 *
 * ### What it will never carry
 *
 * No chain-of-thought. No raw model output. No assembled prompt. No personal data. The
 * inputs are recorded as **canonical event ids** — pointers to facts in Core — and not
 * as copies of what those facts contained.
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  correlationIdSchema,
  eventIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { agentIdSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { isAtOrBefore, utcTimestampSchema } from '../common/timestamp.js';
import { modelReferenceV1Schema } from './model-reference.js';
import { policyReferenceSchema } from '../common/policy.js';
import { promptConfigurationReferenceV1Schema } from './prompt-configuration.js';

export const AGENT_RUN_CONTRACT_VERSION = 1;

/** How a run ended. `refused` is a first-class outcome, not a failure. */
export const AGENT_RUN_OUTCOMES = [
  'completed',
  'completed-no-recommendation',
  'refused',
  'failed',
] as const;

export const agentRunOutcomeSchema = z.enum(AGENT_RUN_OUTCOMES);
export type AgentRunOutcome = z.infer<typeof agentRunOutcomeSchema>;

export const MAX_INPUT_EVENTS = 100;
export const MAX_PRODUCED_RECOMMENDATIONS = 20;

const agentRunShapeSchema = z.strictObject({
  agentRunId: agentRunIdSchema,
  contractVersion: z.literal(AGENT_RUN_CONTRACT_VERSION),

  agent: agentIdSchema,
  /** Which build of the agent. A wrong conclusion must be attributable to a version. */
  agentVersion: machineTokenSchema,

  startedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema,

  outcome: agentRunOutcomeSchema,

  /**
   * The facts it read, as pointers into Core. Never copies of them.
   *
   * May be empty: a scheduled run that found nothing to look at still happened, and
   * recording that it happened and concluded nothing is more honest than not recording
   * it at all.
   */
  inputEventIds: z.array(eventIdSchema).max(MAX_INPUT_EVENTS),

  /** What it produced. Empty for a run that concluded nothing — which is a fine outcome. */
  producedRecommendationIds: z.array(recommendationIdSchema).max(MAX_PRODUCED_RECOMMENDATIONS),

  /** How many deterministic rules ran. Zero, with a model invoked, is a smell worth seeing. */
  deterministicRulesEvaluated: z.int().min(0),

  /** Present only if a model was actually consulted. Most runs should not need one. */
  model: modelReferenceV1Schema.optional(),
  /** Mandatory whenever `model` is present. A model with unknown prompt provenance is unauditable. */
  promptConfiguration: promptConfigurationReferenceV1Schema.optional(),

  policy: policyReferenceSchema,

  /** Why it ended the way it did. Mandatory: every run is attributable. */
  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const agentRunRecordV1Schema = agentRunShapeSchema.superRefine((value, ctx) => {
  if (!isAtOrBefore(value.startedAt, value.completedAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'completedAt must not precede startedAt',
    });
  }

  // A model invocation whose prompt version nobody recorded cannot be reproduced,
  // cannot be regression-tested, and cannot be explained when it goes wrong.
  if (value.model !== undefined && value.promptConfiguration === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['promptConfiguration'],
      message:
        'A run that invoked a model must record the prompt configuration it invoked it with. Model provenance without prompt provenance is not provenance',
    });
  }

  // A prompt configuration with no model is a record of a prompt that was never used.
  if (value.model === undefined && value.promptConfiguration !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['model'],
      message:
        'A prompt configuration was recorded but no model was invoked. One of the two is wrong',
    });
  }

  // A run that produced recommendations but claims it produced none — or vice versa —
  // is a record that disagrees with itself, and evaluation would be built on it.
  if (value.outcome === 'completed' && value.producedRecommendationIds.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['producedRecommendationIds'],
      message:
        'A "completed" run produced at least one recommendation. A run that concluded nothing is "completed-no-recommendation"',
    });
  }

  if (
    value.outcome === 'completed-no-recommendation' &&
    value.producedRecommendationIds.length > 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['producedRecommendationIds'],
      message: 'A "completed-no-recommendation" run must not have produced recommendations',
    });
  }

  // A failed or refused run did not conclude, so it did not recommend.
  if (
    (value.outcome === 'failed' || value.outcome === 'refused') &&
    value.producedRecommendationIds.length > 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['producedRecommendationIds'],
      message: `A "${value.outcome}" run must not have produced recommendations`,
    });
  }
});

export type AgentRunRecordV1 = z.infer<typeof agentRunRecordV1Schema>;
