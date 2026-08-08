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
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
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

import { isActiveCity, isActiveService, pairAvailable } from './internal/availability.js';
import { buildRiyaUserContent } from './internal/input-projection.js';
import {
  isModelProducibleObservation,
  riyaStructuredOutputSchema,
} from './internal/output-schema.js';

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
 * This is the guard a composition uses INSTEAD of blindly casting the generic seam's `unknown`, so
 * it has to be as strict as the schema that produced the value. A guard weaker than the thing it
 * guards is not a guard: a detail arriving by any other route would slip past a rule the model
 * itself could never have broken.
 *
 * Three checks, in order:
 *
 * 1. **Exactly** the two own keys `version` and `observationBatch`. An extra key means this did not
 *    come from `projectStructuredResult`, and whatever else it carries has passed nothing.
 * 2. Re-proof through RWC-P4A's own canonical constructor — a duplicate field, an out-of-bounds
 *    value or an unknown key refuses the whole batch, exactly as it would for the reducer.
 * 3. The MODEL-PRODUCER rule, shared with the output schema. P4A legitimately accepts five origins
 *    because many producers may exist; a forged `user_confirmed` would otherwise arrive here
 *    perfectly valid and then outrank a fact a person actually agreed to.
 *
 * Nothing about a rejected value is returned, thrown or otherwise surfaced.
 */
export function parseRiyaModelProfileDetail(value: unknown): RiyaModelProfileDetailV1 | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'observationBatch' || keys[1] !== 'version') {
    return undefined;
  }
  const candidate = value as { readonly version?: unknown; readonly observationBatch?: unknown };
  if (candidate.version !== 1) {
    return undefined;
  }
  const batch = candidate.observationBatch;
  if (typeof batch !== 'object' || batch === null) {
    return undefined;
  }
  let canonical: RiyaConversationObservationBatchV1;
  try {
    canonical = createRiyaConversationObservationBatch(batch as RiyaConversationObservationBatchV1);
  } catch {
    return undefined;
  }
  if (!canonical.observations.every((observation) => isModelProducibleObservation(observation))) {
    return undefined;
  }
  // A FRESH frozen detail around the CANONICAL batch — never the caller's object, which may be a
  // live reference somebody else still holds.
  return Object.freeze({ version: 1 as const, observationBatch: canonical });
}

/**
 * Build the profile for ONE turn, bound to the continuity that turn started from AND to the Core
 * availability snapshot captured for that same turn (RWC-P5, ADR-0100).
 *
 * Both are captured ONCE. The snapshot is never re-read, and in particular is never refreshed during
 * a compare-and-set reconciliation: the observations belong to one model turn reasoning against one
 * authoritative context, and refreshing authority afterwards could invalidate text no second model
 * call is allowed to replace.
 */
export function createRiyaConversationModelProfile(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
}): ModelReplyStructuredOutputProfile {
  const { current, availabilitySnapshot } = args;

  return Object.freeze({
    structuredSchema: riyaStructuredOutputSchema,

    // The parameter is typed STRUCTURALLY rather than as `ReplyPlan`. This profile needs exactly one
    // field of it, and importing the plan would give this package a dependency on `agent-runtime` --
    // the business-neutral kernel it has no business knowing about. Method parameter bivariance
    // makes the narrower shape assignable to the generic seam.
    buildUserContent(plan: { readonly normalizedText: string | undefined }): string {
      return buildRiyaUserContent({
        current,
        message: plan.normalizedText,
        availabilitySnapshot,
      });
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

      // CORE AUTHORITY, part one: every ref the model asserts must exist in the current snapshot
      // (RWC-P5, ADR-0100 s17). A `CLEAR` names no value and needs no check -- withdrawing a fact is
      // not a claim about the catalogue.
      //
      // Whole-answer refusal, not per-observation dropping. The model already drafted its reply text
      // against its own claim, so quietly deleting an observation would leave a reply that no longer
      // matches what would be persisted -- and P4B forbids a second model call to fix it.
      for (const observation of batch.observations) {
        if (observation.operation !== 'SET' || observation.value === undefined) {
          continue;
        }
        if (
          observation.field === 'serviceInterest' &&
          !isActiveService(availabilitySnapshot, observation.value)
        ) {
          return undefined;
        }
        if (
          observation.field === 'location' &&
          !isActiveCity(availabilitySnapshot, observation.value)
        ) {
          return undefined;
        }
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

      // CORE AUTHORITY, part two: the PROSPECTIVE final state (RWC-P5, ADR-0100 s18).
      //
      // Checking the batch alone is not enough, because a batch that is individually valid can still
      // COMBINE with what the conversation already holds to produce an impossible state -- a client
      // who already told us a service and now names a city that does not have it. So the check runs
      // against `decided.state`, which is exactly what would be persisted.
      //
      // This is what keeps continuity V1 unchanged. P4A has no field for "these two are individually
      // fine but the pair is not", and structural presence of both would make the conversation look
      // summary-ready. Refusing the answer instead means such a state can never exist.
      const prospective = decided.state.discovery;
      const prospectiveService = prospective.serviceInterestRef;
      const prospectiveLocation = prospective.locationRef;
      if (
        prospectiveService !== undefined &&
        !isActiveService(availabilitySnapshot, prospectiveService)
      ) {
        return undefined;
      }
      if (
        prospectiveLocation !== undefined &&
        !isActiveCity(availabilitySnapshot, prospectiveLocation)
      ) {
        return undefined;
      }
      if (
        prospectiveService !== undefined &&
        prospectiveLocation !== undefined &&
        !pairAvailable(availabilitySnapshot, prospectiveService, prospectiveLocation)
      ) {
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
          // `REPLY` and a body, both required by the Riya schema: this path produces the one kind
          // the authoritative Riya pipeline can actually carry as a draft.
          kind: answer.reply.kind,
          replyBody: answer.reply.replyBody,
          ...(answer.reply.reasonCode === undefined ? {} : { reasonCode: answer.reply.reasonCode }),
          citations: Object.freeze(answer.reply.citations.map((c) => Object.freeze({ ...c }))),
        }),
        detail,
      };
    },
  });
}
