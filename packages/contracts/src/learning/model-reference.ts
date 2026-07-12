/**
 * ModelReferenceV1 — which model produced this, and under what configuration.
 *
 * **A citation, not a channel.** This contract names a model. It does not call one,
 * cannot call one, and carries nothing that would let anything else call one either.
 * There is no API key, no endpoint, no base URL, no header, and no token — and there
 * is no field in which one could be put, because the shape is strict and every field
 * in it is a machine token or an integer.
 *
 * Phase 2 implements **no model gateway and no provider integration**. Claude and
 * ChatGPT are the initial reasoning providers behind a future model-agnostic gateway,
 * and that gateway is a later phase's work. What exists here is the *shape of the
 * provenance record* the gateway will one day have to produce — written now, before
 * anything depends on it, which is the entire premise of this phase.
 *
 * ### Why provenance is not optional
 *
 * When a recommendation turns out to be wrong, the first question is *which model,
 * which version, which configuration*. A system that cannot answer that cannot tell a
 * bad prompt from a bad model from a bad upgrade, and so it cannot fix any of them.
 * Worse, it cannot detect a regression: "the agent got worse last Tuesday" is
 * unactionable unless something recorded what changed on Tuesday.
 *
 * ### What it will never carry
 *
 * No raw model output. No completion. No chain-of-thought. Those are refused by name
 * in every governed container in this package (`MODEL_INTERNAL_KEYS`), and they have
 * no field here in the first place. **Chain-of-thought is never stored**
 * (agent-model.md, privacy-principles.md).
 */

import { z } from 'zod';

import { contractVersionSchema } from '../common/identifiers.js';
import { machineTokenSchema } from '../common/text.js';

/**
 * The reasoning providers, as a closed set.
 *
 * Closed for the same reason the event registry is closed: adding a provider must be
 * a **diff a human reviews**, not a string a caller invents. A model provider is a
 * party we send reasoning to; that is not a decision to make at runtime.
 *
 * Claude and ChatGPT are the initial two. No integration with either exists in
 * Phase 2.
 */
export const MODEL_PROVIDERS = ['anthropic', 'openai'] as const;

export const modelProviderSchema = z.enum(MODEL_PROVIDERS);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const MODEL_REFERENCE_CONTRACT_VERSION = 1;

/**
 * A model identifier, as the provider names it.
 *
 * Bounded and constrained to a machine token. It identifies a model; it is not a
 * place to record what the model said.
 */
export const modelIdSchema = machineTokenSchema;

export const modelReferenceV1Schema = z.strictObject({
  contractVersion: z.literal(MODEL_REFERENCE_CONTRACT_VERSION),

  provider: modelProviderSchema,

  /** The model, as the provider names it. */
  modelId: modelIdSchema,
  /** The specific build. "Which model" without "which version" is not provenance. */
  modelVersion: machineTokenSchema,

  /**
   * The version of the invocation configuration — temperature, tool set, limits.
   *
   * A *version*, not the configuration itself. The configuration lives where it is
   * governed; this records which one was in force, so that a behavior change can be
   * traced to the change that caused it.
   */
  invocationConfigurationVersion: contractVersionSchema,
});

export type ModelReferenceV1 = z.infer<typeof modelReferenceV1Schema>;
