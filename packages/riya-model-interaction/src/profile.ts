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
import {
  everyCitationIsGrounded,
  groundedContextAgreesWithPlan,
} from './internal/grounded-context.js';
import type { RiyaGroundedKnowledgeContextV1 } from './internal/grounded-context.js';
import { buildRiyaUserContent } from './internal/input-projection.js';
import {
  isModelProducibleObservation,
  riyaGroundedReplyOutputSchema,
  riyaStructuredOutputSchema,
} from './internal/output-schema.js';

/**
 * How a grounded profile reads this turn's governed knowledge (RWC-P7, ADR-0103 §6).
 *
 * A READER rather than a value, and that is load-bearing. M2 calls the knowledge port and THEN M4
 * builds the request, so at the moment a composition constructs this profile the retrieval has not
 * happened yet. Passing a snapshot taken at construction would always read `undefined`, and a
 * grounded deployment would silently serve ungrounded turns that still looked entirely correct.
 *
 * The reader is the per-RUN bridge's capture. It is never a module-level slot.
 */
type RiyaGroundedKnowledgeSource = () => RiyaGroundedKnowledgeContextV1 | undefined;

/**
 * What `buildUserContent` needs off the generic M2 plan, and nothing more.
 *
 * Typed STRUCTURALLY rather than as the kernel plan type, so this package keeps no dependency on
 * `agent-runtime` — the business-neutral kernel it has no business knowing about. Method parameter
 * bivariance makes the narrower shape assignable to the generic seam.
 *
 * `citations` joins `normalizedText` for RWC-P7: they are the citations M2 authorized from the ONE
 * governed retrieval, and the grounded profiles cross-check the captured content against them before
 * a single byte reaches the gateway.
 */
interface RiyaModelPlanView {
  readonly normalizedText: string | undefined;
  readonly citations: readonly { readonly knowledgeId: string; readonly version: number }[];
}

/**
 * The grounded-citation rule shared by both profiles (RWC-P7, ADR-0103 §12).
 *
 * When records WERE supplied, a factual grounded answer must cite at least one of them, and every
 * citation must name a record the model actually read. When none were supplied there is nothing to
 * cite and the requirement does not apply.
 *
 * A subset is fine — an answer need not cite everything it was shown. What is refused is the whole
 * structured answer, never a quiet drop: silently removing a fabricated citation would leave a reply
 * body still asserting the thing that citation was supposed to support.
 */
function groundedCitationsAcceptable(
  grounded: RiyaGroundedKnowledgeContextV1 | undefined,
  cited: readonly { readonly knowledgeId: string; readonly version: number }[],
): boolean {
  if (grounded === undefined) {
    return true;
  }
  return cited.length > 0 && everyCitationIsGrounded(grounded, cited);
}

/**
 * Refuse before the gateway unless the captured content and the plan's citations are the same
 * retrieval (ADR-0103 §13).
 *
 * Thrown rather than returned: `buildUserContent` throwing is the adapter's own documented way to
 * fail closed before a request is built, and there is no half-grounded turn worth sending.
 */
function assertGroundingMatchesPlan(
  grounded: RiyaGroundedKnowledgeContextV1 | undefined,
  plan: RiyaModelPlanView,
): void {
  if (grounded === undefined) {
    return;
  }
  if (!groundedContextAgreesWithPlan(grounded, plan.citations)) {
    throw new Error('riya-grounded-plan-mismatch');
  }
}

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
  /**
   * The RWC-P7 grounded knowledge reader, or absent.
   *
   * ADDITIVE. With it absent this profile behaves exactly as RWC-P4B left it, down to the serialized
   * user bytes — P7 does not duplicate P4B, it extends the same one call.
   */
  readonly groundedKnowledgeSource?: RiyaGroundedKnowledgeSource;
}): ModelReplyStructuredOutputProfile {
  const { current, availabilitySnapshot } = args;
  const readGrounded = args.groundedKnowledgeSource;

  return Object.freeze({
    structuredSchema: riyaStructuredOutputSchema,

    buildUserContent(plan: RiyaModelPlanView): string {
      const grounded = readGrounded?.();
      assertGroundingMatchesPlan(grounded, plan);
      return buildRiyaUserContent({
        current,
        message: plan.normalizedText,
        availabilitySnapshot,
        ...(grounded === undefined ? {} : { groundedKnowledge: grounded }),
      });
    },

    projectStructuredResult(value: unknown): ModelReplyStructuredProjection | undefined {
      const parsed = riyaStructuredOutputSchema.safeParse(value);
      if (!parsed.success) {
        return undefined;
      }
      const answer = parsed.data;

      // GROUNDED CITATIONS, before anything else is judged (RWC-P7). If records were shown, the
      // answer must cite at least one of them and may cite nothing it did not read.
      if (!groundedCitationsAcceptable(readGrounded?.(), answer.reply.citations)) {
        return undefined;
      }

      // The CANONICAL batch, built through RWC-P4A's own constructor. A duplicate field, an
      // out-of-bounds value or anything else it refuses takes the whole model answer with it --
      // there is no partial acceptance of an inference.
      let batch: RiyaConversationObservationBatchV1;
      try {
        batch = createRiyaConversationObservationBatch({
          version: 1,
          // HF4: the observation is a UNION now, so `value` exists only on the SET branch. Narrowing
          // on the operation is what makes that structural — there is no longer a way to reach a
          // CLEAR's value, because a CLEAR does not have one.
          // POST-SDH4: the provider representation splits the operations into two typed arrays, so
          // the operation is recovered from WHICH array an item came from rather than from a tagged
          // union under array items — the exact fragment SDH4 proved Groq rejects.
          //
          // Order is sets-then-clears and is deterministic, so two identical answers always produce
          // the same canonical list. The COMBINED list is what the canonical constructor sees, which
          // is where the total ceiling and the one-per-field rule are enforced: two arrays each
          // bounded at seven do not prove a combined seven, and this is the seam that does.
          observations: [
            ...answer.evolution.observations.sets.map((observation) => ({
              field: observation.field,
              operation: 'SET' as const,
              value: observation.value,
              provenance: observation.provenance,
            })),
            ...answer.evolution.observations.clears.map((observation) => ({
              field: observation.field,
              operation: 'CLEAR' as const,
              provenance: observation.provenance,
            })),
          ],
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
          // HF4: the model-facing schema requires `reasonCode` and permits `null`, because Groq
          // strict mode cannot express an absent property. Null projects back to ABSENCE here, so the
          // provider-neutral `StructuredReply` is byte-for-byte what it was before — "no reason
          // code" is still an absent key, and the M4 re-proof is unaffected.
          ...(answer.reply.reasonCode === null ? {} : { reasonCode: answer.reply.reasonCode }),
          citations: Object.freeze(answer.reply.citations.map((c) => Object.freeze({ ...c }))),
        }),
        detail,
      };
    },
  });
}

/**
 * The POST-SUMMARY grounded reply profile (RWC-P7, ADR-0103 §16).
 *
 * ### Why a second profile rather than a flag on the first
 *
 * Past `SUMMARY` the conversation belongs to RWC-P6, whose structured actions make ZERO model calls.
 * A client may still ask "how long does installation take?" and deserves an answer — but that answer
 * must be incapable of moving anything. A flag on the evolution profile would leave the observation
 * machinery present and one condition away from running; a separate profile whose schema has no
 * `evolution` key cannot express a state change at all.
 *
 * So: reply only, `profileDetail` absent, and no path from a sentence to a phase.
 *
 * The Core availability snapshot is still projected. A post-summary client asking "do you work in
 * Beta?" must be answered from CURRENT Core authority, not from whatever a governed document said
 * when it was approved — RWC-P5 outranks a snapshot for that question, and P7 does not restate the
 * rule, it keeps the input.
 */
export function createRiyaGroundedReplyModelProfile(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
  readonly groundedKnowledgeSource?: RiyaGroundedKnowledgeSource;
}): ModelReplyStructuredOutputProfile {
  const { current, availabilitySnapshot } = args;
  const readGrounded = args.groundedKnowledgeSource;

  return Object.freeze({
    structuredSchema: riyaGroundedReplyOutputSchema,

    buildUserContent(plan: RiyaModelPlanView): string {
      const grounded = readGrounded?.();
      assertGroundingMatchesPlan(grounded, plan);
      return buildRiyaUserContent({
        current,
        message: plan.normalizedText,
        availabilitySnapshot,
        ...(grounded === undefined ? {} : { groundedKnowledge: grounded }),
      });
    },

    projectStructuredResult(value: unknown): ModelReplyStructuredProjection | undefined {
      const parsed = riyaGroundedReplyOutputSchema.safeParse(value);
      if (!parsed.success) {
        return undefined;
      }
      const answer = parsed.data;
      if (!groundedCitationsAcceptable(readGrounded?.(), answer.reply.citations)) {
        return undefined;
      }
      // NO detail. There is no observation batch, no continuity change and nothing for a composition
      // to persist -- returning an empty one would invite a caller to write a revision for a turn
      // that changed nothing.
      return {
        reply: Object.freeze({
          kind: answer.reply.kind,
          replyBody: answer.reply.replyBody,
          // HF4, exactly as in the evolution profile: a required-but-null `reasonCode` projects back
          // to an absent key, so both profiles keep the same provider-neutral reply contract.
          ...(answer.reply.reasonCode === null ? {} : { reasonCode: answer.reply.reasonCode }),
          citations: Object.freeze(answer.reply.citations.map((c) => Object.freeze({ ...c }))),
        }),
      };
    },
  });
}
