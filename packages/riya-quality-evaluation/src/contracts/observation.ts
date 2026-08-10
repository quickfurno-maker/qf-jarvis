/**
 * The normalized quality observation — what a candidate DID, with nothing it said (RWC-P10 §11).
 *
 * ### It is a measurement, not a transcript
 *
 * The reply is present as a CHARACTER COUNT and a QUESTION COUNT. The user's message is not present
 * at all. That is the whole design: an evaluation corpus is copied, archived and shared far more
 * casually than a conversation store, and every field that could carry a sentence eventually does.
 *
 * The counts are enough. "Was the reply too long" and "did it ask three questions at once" are
 * exactly the objective faults worth gating, and neither needs the words. Everything that genuinely
 * requires reading the reply is a SUBJECTIVE dimension, and those are judged by a human who read it
 * in the review tool and returned a binary verdict — not a copy of the text.
 *
 * ### The batch is re-proved, never trusted
 *
 * `observationBatch` is rebuilt through the real `createRiyaConversationObservationBatch` from
 * `@qf-jarvis/riya-conversation-evolution`. A structurally-similar object literal would let a
 * fixture assert a batch the canonical constructor would have refused — a duplicated field, a `SET`
 * with no value, an unknown provenance — and the suite would then certify a Riya against a shape the
 * runtime cannot produce.
 *
 * ### What this may never carry
 *
 * No raw user text, no raw reply text, no prompt or system prompt, no provider response body, no
 * chain of thought, no confidence, no contact detail, no log line and no business data. `.strict()`
 * makes each of those a refusal.
 */
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { createRiyaConversationObservationBatch } from '@qf-jarvis/riya-conversation-evolution';
import type {
  RiyaConversationObservationBatchV1,
  RiyaDiscoveryObservationV1,
} from '@qf-jarvis/riya-conversation-evolution';
import { z } from 'zod';

import { RiyaQualityEvaluationError } from './errors.js';
import type { RiyaQualityHumanReviewV1 } from './human-review.js';
import { createRiyaQualityHumanReview } from './human-review.js';
import { RIYA_QUALITY_DISCOVERY_FIELDS, RIYA_QUALITY_LANGUAGE_MODES } from './vocabularies.js';
import type { RiyaQualityDiscoveryField, RiyaQualityLanguageMode } from './vocabularies.js';

/** A grounded-answer citation: which governed knowledge item, at which exact version. */
export interface RiyaQualityCitation {
  readonly knowledgeId: string;
  readonly version: number;
}

/** One candidate reply, normalized to what can be measured without keeping it. */
export interface RiyaQualityObservationV1 {
  readonly version: 1;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  /** Which mode the reply was ACTUALLY in. Compared against the scenario's required mode. */
  readonly languageMode: RiyaQualityLanguageMode;
  readonly replyCharCount: number;
  readonly questionCount: number;
  /** Which discovery fields the reply asked about. Order-insensitive; deduplicated. */
  readonly askedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  /** The canonical batch, rebuilt through the real constructor. */
  readonly observationBatch: RiyaConversationObservationBatchV1;
  readonly citations: readonly RiyaQualityCitation[];
  readonly continuityPhaseAfter: RiyaConversationPhase;
  /** Exactly two DISTINCT reviews wherever the scenario requires a subjective dimension. */
  readonly humanReviews: readonly RiyaQualityHumanReviewV1[];
}

export interface RiyaQualityObservationInput {
  readonly version: 1;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly replyCharCount: number;
  readonly questionCount: number;
  readonly askedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  readonly observationBatch: {
    readonly version: 1;
    readonly observations: readonly RiyaDiscoveryObservationV1[];
    readonly skipProjectDetails: boolean;
  };
  readonly citations: readonly RiyaQualityCitation[];
  readonly continuityPhaseAfter: RiyaConversationPhase;
  readonly humanReviews: readonly RiyaQualityHumanReviewV1[];
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);

const citationSchema = z
  .object({
    knowledgeId: IDENTIFIER,
    version: VERSION,
  })
  .strict();

const observationSchema = z
  .object({
    version: z.literal(1),
    scenarioId: IDENTIFIER,
    scenarioVersion: VERSION,
    languageMode: z.enum(RIYA_QUALITY_LANGUAGE_MODES),
    // Bounded well above any legitimate reply. The SCENARIO decides what is too long; this only
    // refuses a value that could not have come from a real measurement at all.
    replyCharCount: z.int().min(0).max(100_000),
    questionCount: z.int().min(0).max(100),
    askedDiscoveryFields: z
      .array(z.enum(RIYA_QUALITY_DISCOVERY_FIELDS as readonly [string, ...string[]]))
      .max(RIYA_QUALITY_DISCOVERY_FIELDS.length),
    // Deliberately loose here: the CANONICAL constructor below is the authority on this shape, and
    // restating its rules would be a second copy to keep in step with the first.
    observationBatch: z.object({}).loose(),
    citations: z.array(citationSchema).max(32),
    continuityPhaseAfter: z.enum(RIYA_CONVERSATION_PHASES),
    humanReviews: z.array(z.object({}).loose()).max(2),
  })
  .strict();

/**
 * Validate and freeze one quality observation. Throws `invalid-observation`.
 *
 * At most two reviews, and they must be distinct: a third would make "both reviewers agreed"
 * ambiguous, and a repeated `reviewRef` is one person counted twice, which is exactly the failure
 * the two-reviewer rule exists to prevent.
 */
export function createRiyaQualityObservation(
  input: RiyaQualityObservationInput,
): RiyaQualityObservationV1 {
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaQualityEvaluationError('invalid-observation');
  }

  const asked = input.askedDiscoveryFields;
  if (new Set(asked).size !== asked.length) {
    throw new RiyaQualityEvaluationError('invalid-observation');
  }

  // THE re-proof, and the WHOLE value goes through (owner correction on PR #111).
  //
  // Rebuilding only the known top-level fields first meant an extra key on the batch was silently
  // dropped instead of refused -- so a fixture could carry a field the canonical constructor would
  // have rejected, and the suite would measure a shape the runtime cannot produce. Passing the value
  // itself lets P4A's own `.strict()` schema see everything, which is the point of re-proving at all.
  let batch: RiyaConversationObservationBatchV1;
  try {
    batch = createRiyaConversationObservationBatch(input.observationBatch);
  } catch {
    // The canonical error is deliberately not re-thrown: it belongs to another package's vocabulary,
    // and a caller of this one should see this one's closed codes.
    throw new RiyaQualityEvaluationError('invalid-observation');
  }

  // Likewise the FULL nested review object, not a reconstruction of its known fields. Rebuilding
  // stripped a `comment`, a `name` or an `email` instead of refusing it -- and those are exactly the
  // fields the human-review contract exists to keep out, so silently dropping one would have meant
  // the strictest lock in the package was unenforced wherever it mattered most.
  let reviews: readonly RiyaQualityHumanReviewV1[];
  try {
    reviews = input.humanReviews.map((review) => createRiyaQualityHumanReview(review));
  } catch {
    // Normalized to THIS constructor's code, exactly as the batch failure above is. A caller of
    // `createRiyaQualityObservation` should see this contract's closed vocabulary, and the review
    // factory's own error is discarded rather than re-thrown so nothing it saw can travel with it.
    throw new RiyaQualityEvaluationError('invalid-observation');
  }
  const refs = reviews.map((review) => review.reviewRef);
  if (new Set(refs).size !== refs.length) {
    throw new RiyaQualityEvaluationError('invalid-observation');
  }

  const citationKeys = input.citations.map(
    (citation) => `${citation.knowledgeId}|${String(citation.version)}`,
  );
  if (new Set(citationKeys).size !== citationKeys.length) {
    throw new RiyaQualityEvaluationError('invalid-observation');
  }

  return Object.freeze({
    version: 1 as const,
    scenarioId: parsed.data.scenarioId,
    scenarioVersion: parsed.data.scenarioVersion,
    languageMode: parsed.data.languageMode,
    replyCharCount: parsed.data.replyCharCount,
    questionCount: parsed.data.questionCount,
    askedDiscoveryFields: Object.freeze([...asked].sort()),
    observationBatch: batch,
    citations: Object.freeze(
      [...input.citations]
        .map((citation) => Object.freeze({ ...citation }))
        .sort((a, b) =>
          a.knowledgeId === b.knowledgeId
            ? a.version - b.version
            : a.knowledgeId < b.knowledgeId
              ? -1
              : 1,
        ),
    ),
    continuityPhaseAfter: parsed.data.continuityPhaseAfter,
    // Sorted by ref so a case digest does not depend on which reviewer happened to submit first.
    humanReviews: Object.freeze(
      [...reviews].sort((a, b) =>
        a.reviewRef < b.reviewRef ? -1 : a.reviewRef > b.reviewRef ? 1 : 0,
      ),
    ),
  });
}

/** The exact key identifying which scenario an observation answers. */
export function observationKey(observation: RiyaQualityObservationV1): string {
  return `${observation.scenarioId}@${String(observation.scenarioVersion)}`;
}
