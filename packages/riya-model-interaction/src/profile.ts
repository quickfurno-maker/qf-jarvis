/**
 * The Riya structured-output profile (RWC-P4B, ADR-0099).
 *
 * This is the Riya half of the ONE model call. It is handed to the generic M4 adapter, which invokes
 * the gateway exactly once; this package invokes nothing itself.
 *
 * It does three things and refuses to do a fourth:
 *
 * 1. builds the content-minimised current-continuity user message;
 * 2. declares the strict reply+observations schema the answer must satisfy;
 * 3. projects the answer to an ordinary reply plus a CANONICAL RWC-P4A observation batch —
 *    but only after checking the model's claimed question plan against what the P4A reducer
 *    independently decides.
 *
 * The fourth thing it will not do is decide the conversation. The model returns a claimed plan so
 * the one-call answer can be *checked*; the reducer remains the phase and provenance authority, and
 * a disagreement refuses the whole structured result rather than trusting either side.
 */
import type {
  ModelReplyStructuredOutputProfile,
  ModelReplyStructuredProjection,
} from '@qf-jarvis/model-reply-adapter';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import {
  createRiyaConversationObservationBatch,
  evolveRiyaConversation,
} from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationObservationBatchV1 } from '@qf-jarvis/riya-conversation-evolution';

import { buildRiyaUserContent } from './internal/input-projection.js';
import { riyaStructuredOutputSchema } from './internal/output-schema.js';

/**
 * What the profile hands back through the generic M4 `profileDetail`.
 *
 * Deliberately nothing but the canonical batch. No reply body, no raw model result, no current
 * continuity, no input message, no prompt, no provider response, no reasoning, no citations, no
 * confidence — the detail crosses a boundary whose whole purpose is that content does not.
 */
export interface RiyaModelProfileDetailV1 {
  readonly version: 1;
  readonly observationBatch: RiyaConversationObservationBatchV1;
}

/**
 * Parse a generic `unknown` profile detail into the Riya shape, or `undefined`.
 *
 * Provided so a composition never blindly casts. The generic seam types the detail as `unknown`
 * precisely because M4 must not know what it is; the package that produced it owns the guard.
 */
export function parseRiyaModelProfileDetail(value: unknown): RiyaModelProfileDetailV1 | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as { version?: unknown; observationBatch?: unknown };
  if (candidate.version !== 1) {
    return undefined;
  }
  const batch = candidate.observationBatch;
  if (typeof batch !== 'object' || batch === null) {
    return undefined;
  }
  let canonical: RiyaConversationObservationBatchV1;
  try {
    // Re-proved rather than trusted. A detail that reached here through anything other than this
    // package's own projection must still be a batch the reducer would accept.
    canonical = createRiyaConversationObservationBatch(batch as RiyaConversationObservationBatchV1);
  } catch {
    return undefined;
  }
  return Object.freeze({ version: 1 as const, observationBatch: canonical });
}

/** Build the profile for ONE turn, bound to the continuity that turn started from. */
export function createRiyaConversationModelProfile(args: {
  readonly current: RiyaConversationContinuityStateV1;
}): ModelReplyStructuredOutputProfile {
  const { current } = args;

  return Object.freeze({
    structuredSchema: riyaStructuredOutputSchema,

    // The parameter is typed STRUCTURALLY rather than as `ReplyPlan`. This profile needs exactly one
    // field of it, and importing the plan would give this package a dependency on `agent-runtime` --
    // the business-neutral kernel it has no business knowing about. Method parameter bivariance
    // makes the narrower shape assignable to the generic seam.
    buildUserContent(plan: { readonly normalizedText: string | undefined }): string {
      return buildRiyaUserContent({ current, message: plan.normalizedText });
    },

    projectStructuredResult(value: unknown): ModelReplyStructuredProjection | undefined {
      const parsed = riyaStructuredOutputSchema.safeParse(value);
      if (!parsed.success) {
        return undefined;
      }
      const answer = parsed.data;

      // The CANONICAL batch, built through RWC-P4A's own constructor. A duplicate field, an
      // out-of-bounds value or anything else it refuses takes the whole model answer with it --
      // there is no partial acceptance of an inference.
      let batch: RiyaConversationObservationBatchV1;
      try {
        batch = createRiyaConversationObservationBatch({
          version: 1,
          observations: answer.evolution.observations.map((observation) => ({
            field: observation.field,
            operation: observation.operation,
            ...(observation.value === undefined ? {} : { value: observation.value }),
            provenance: observation.provenance,
          })),
          skipProjectDetails: answer.evolution.skipProjectDetails,
        });
      } catch {
        return undefined;
      }

      // The agreement check. The reducer decides; the model's claim is compared to that decision.
      let decided;
      try {
        decided = evolveRiyaConversation({ current, batch });
      } catch {
        // An observation the reducer refuses outright -- an oversized note reaching the canonical
        // per-field bound, say -- invalidates the answer rather than half of it.
        return undefined;
      }

      const claimed = answer.evolution.questionPlan;
      const actual = decided.questionPlan;
      if (claimed.phase !== actual.phase) {
        return undefined;
      }
      // EXACT, including order. `['budget','timeline']` and `['timeline','budget']` are different
      // questions to ask, and accepting either would make the plan advisory.
      if (claimed.questionFields.length !== actual.questionFields.length) {
        return undefined;
      }
      for (const [index, field] of actual.questionFields.entries()) {
        if (claimed.questionFields[index] !== field) {
          return undefined;
        }
      }

      const detail: RiyaModelProfileDetailV1 = Object.freeze({
        version: 1 as const,
        observationBatch: batch,
      });

      return {
        // Projected verbatim. The M4 adapter re-proves it against the real `structuredReplySchema`,
        // so this profile cannot widen what counts as a reply.
        reply: Object.freeze({
          kind: answer.reply.kind,
          ...(answer.reply.replyBody === undefined ? {} : { replyBody: answer.reply.replyBody }),
          ...(answer.reply.reasonCode === undefined ? {} : { reasonCode: answer.reply.reasonCode }),
          citations: Object.freeze(answer.reply.citations.map((c) => Object.freeze({ ...c }))),
        }),
        detail,
      };
    },
  });
}
