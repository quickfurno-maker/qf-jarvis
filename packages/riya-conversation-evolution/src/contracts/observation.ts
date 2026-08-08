/**
 * The observation batch: what one turn learned, already reduced to facts (RWC-P4A, ADR-0098).
 *
 * ### This is an INPUT contract, not a model output contract
 *
 * RWC-P4A performs no extraction. It receives observations somebody else produced and decides what
 * they mean for the state. RWC-P4B will decide how a validated single-inference structured result
 * may produce a batch; that question is deliberately not answered here, because a reducer that knew
 * where its input came from would start trusting some sources more than the provenance says to.
 *
 * ### `provenance` is the ORIGIN of the fact, not the mechanism that read it
 *
 * This is the single most consequential rule in the package, and getting it backwards would make
 * every extracted fact permanently one rank too weak.
 *
 * A model that parses the literal words *"budget is 8 lakh"* has not inferred anything — the client
 * stated it, and the origin is `user_stated`. A model that concludes a budget the client never
 * mentioned HAS inferred it, and the origin is `model_inferred`. A chip tap is `user_selected`; a
 * governed server seed or entry context is `server_runtime`; a value the client was shown and
 * agreed to is `user_confirmed`.
 *
 * Deciding which category a given model output belongs to is the PRODUCER's job. This package
 * enforces the merge semantics and never re-derives provenance from who called it, what model ran,
 * or how confident anything was.
 *
 * ### What a batch may not carry
 *
 * No evidence quote or span, no raw client text, no confidence, no reasoning, no chain-of-thought,
 * no `messageId`, no channel, no contact detail, and no business authority field. The schema is
 * `.strict()`, so each of those is a refusal rather than a value quietly dropped.
 *
 * Evidence quotes are refused deliberately rather than for tidiness: a quote is a verbatim fragment
 * of what a person said, and retaining fragments is how a system acquires a transcript nobody
 * decided to keep. A `CLEAR`/`SET` operation plus a provenance carries every fact the merge needs.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { RIYA_FIELD_PROVENANCE_SOURCES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaFieldProvenance } from '@qf-jarvis/riya-conversation-continuity';
import { z } from 'zod';

import { RiyaConversationEvolutionError } from './errors.js';

/**
 * What an observation does to a field.
 *
 * Two operations, because "the client told us their budget" and "the client withdrew what they told
 * us" are different acts and a single nullable value could not tell them apart: an absent value
 * would be indistinguishable from a field the batch simply did not mention.
 */
export const RIYA_DISCOVERY_OBSERVATION_OPERATIONS = ['SET', 'CLEAR'] as const;

export type RiyaDiscoveryObservationOperation =
  (typeof RIYA_DISCOVERY_OBSERVATION_OPERATIONS)[number];

/** One thing a turn learned about one discovery field. */
export interface RiyaDiscoveryObservationV1 {
  readonly field: DiscoveryField;
  readonly operation: RiyaDiscoveryObservationOperation;
  /** Required for `SET`, forbidden for `CLEAR`. Bounded by the canonical `NeedDiscovery` field. */
  readonly value?: string;
  /** The ORIGIN of the fact. See the module note — not the mechanism that read it. */
  readonly provenance: RiyaFieldProvenance;
}

/** Everything one turn learned, as one atomic batch. */
export interface RiyaConversationObservationBatchV1 {
  readonly version: 1;
  readonly observations: readonly RiyaDiscoveryObservationV1[];
  /**
   * The client EXPLICITLY declined or skipped optional project-detail collection this turn.
   *
   * Never inferred from silence. A client who asked a side question, or said nothing about property
   * type, has not skipped anything — and treating quiet as a decision is how a conversation stops
   * asking the one question it still needed. Only an explicit decline sets this.
   */
  readonly skipProjectDetails: boolean;
}

const observationSchema = z
  .object({
    field: z.enum(DISCOVERY_FIELDS_FROZEN as readonly [DiscoveryField, ...DiscoveryField[]]),
    operation: z.enum(RIYA_DISCOVERY_OBSERVATION_OPERATIONS),
    // Bounded here only so an absurd string cannot reach the canonical constructor. The AUTHORITATIVE
    // per-field bounds stay in `riya-agent` -- `scopeSummary`, the two notes and the opaque refs each
    // have their own -- and are applied when the merged discovery is rebuilt. Restating them per
    // field here would be a second set of bounds to keep in step with the first.
    value: z.string().min(1).max(2048).optional(),
    provenance: z.enum(RIYA_FIELD_PROVENANCE_SOURCES),
  })
  .strict()
  .superRefine((observation, ctx) => {
    if (observation.operation === 'SET' && observation.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'SET requires a value.' });
    }
    if (observation.operation === 'CLEAR' && observation.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'CLEAR forbids a value.' });
    }
  });

const batchSchema = z
  .object({
    version: z.literal(1),
    // At most one observation per canonical field. A longer array could only contain a duplicate,
    // and the duplicate check below refuses the whole batch anyway.
    observations: z.array(observationSchema).max(DISCOVERY_FIELDS_FROZEN.length),
    skipProjectDetails: z.boolean(),
  })
  .strict();

/**
 * Build a frozen observation batch. Throws `invalid-observation-batch` on anything invalid.
 *
 * A duplicated field refuses the ENTIRE batch rather than picking a winner. Two observations about
 * one field in one turn is not a merge this reducer should silently resolve: whichever it chose
 * would be a rule nobody wrote down, and the producer is the only party that knows which of the two
 * it actually meant.
 */
export function createRiyaConversationObservationBatch(input: {
  readonly version: 1;
  readonly observations: readonly RiyaDiscoveryObservationV1[];
  readonly skipProjectDetails: boolean;
}): RiyaConversationObservationBatchV1 {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    // The zod issue is discarded: its path names the failing field and its message can quote the
    // value, and the value here is a person's own words about their home.
    throw new RiyaConversationEvolutionError('invalid-observation-batch');
  }
  const fields = parsed.data.observations.map((observation) => observation.field);
  if (new Set(fields).size !== fields.length) {
    throw new RiyaConversationEvolutionError('invalid-observation-batch');
  }
  return Object.freeze({
    version: 1 as const,
    observations: Object.freeze(
      parsed.data.observations.map((observation) =>
        Object.freeze({
          field: observation.field,
          operation: observation.operation,
          ...(observation.value === undefined ? {} : { value: observation.value }),
          provenance: observation.provenance,
        }),
      ),
    ),
    skipProjectDetails: parsed.data.skipProjectDetails,
  });
}
