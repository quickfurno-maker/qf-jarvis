/**
 * The structured summary edit (RWC-P6, ADR-0101 §18).
 *
 * ### Why a caller cannot choose provenance
 *
 * This is THE structured summary surface: the place a client is shown their answers and changes one.
 * Every edit through it is therefore stamped `user_confirmed`, and the payload has no `provenance`
 * field at all.
 *
 * That absence is the design. A caller able to choose would be a caller able to write
 * `user_confirmed` for something a model guessed — which is precisely the authority RWC-P4A and
 * RWC-P4B spent two slices keeping away from inference. `user_confirmed` means *the client was shown
 * it and agreed it is right*, and only a surface that actually showed it can say so.
 *
 * ### And cannot choose `skipProjectDetails` either
 *
 * That flag means the client explicitly declined optional project-detail collection. It is a
 * conversational act, observed during a turn — not something a summary edit performs. A structured
 * edit always sends `false`, so editing a value can never silently close a question the client never
 * answered.
 *
 * ### What it does not carry
 *
 * No evidence quote, no raw text, no model confidence, no reasoning, no contact, no consent, no
 * business field. `.strict()` at every level, so each is a refusal rather than a value dropped.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { z } from 'zod';

import { RiyaConversationCompletionError } from './errors.js';

/** What one edit does to one field. The same two operations RWC-P4A already understands. */
export const RIYA_SUMMARY_EDIT_OPERATIONS = ['SET', 'CLEAR'] as const;
export type RiyaSummaryEditOperation = (typeof RIYA_SUMMARY_EDIT_OPERATIONS)[number];

export interface RiyaSummaryFieldEditV1 {
  readonly field: DiscoveryField;
  readonly operation: RiyaSummaryEditOperation;
  /** Required for `SET`, forbidden for `CLEAR`. Bounded by the canonical `NeedDiscovery` field. */
  readonly value?: string;
}

/** One structured edit action. */
export interface RiyaSummaryEditV1 {
  readonly version: 1;
  readonly edits: readonly RiyaSummaryFieldEditV1[];
}

const editSchema = z
  .object({
    field: z.enum(DISCOVERY_FIELDS_FROZEN as readonly [DiscoveryField, ...DiscoveryField[]]),
    operation: z.enum(RIYA_SUMMARY_EDIT_OPERATIONS),
    // Bounded here only so an absurd string cannot reach the canonical constructor. The
    // AUTHORITATIVE per-field bounds stay in `riya-agent` and are applied when the merged discovery
    // is rebuilt; restating them per field would be a second set to keep in step with the first.
    value: z.string().min(1).max(2048).optional(),
  })
  .strict()
  .superRefine((edit, ctx) => {
    if (edit.operation === 'SET' && edit.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'SET requires a value.' });
    }
    if (edit.operation === 'CLEAR' && edit.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'CLEAR forbids a value.' });
    }
  });

const summaryEditSchema = z
  .object({
    version: z.literal(1),
    // At least one: an edit action that edits nothing is a revision spent on no change.
    // At most one per canonical field; a longer array could only contain a duplicate.
    edits: z.array(editSchema).min(1).max(DISCOVERY_FIELDS_FROZEN.length),
  })
  .strict();

/**
 * Build a frozen structured summary edit, or refuse.
 *
 * A duplicated field refuses the ENTIRE action rather than picking a winner — the same rule RWC-P4A
 * applies to a duplicated observation, for the same reason: two edits to one field in one action is
 * not a merge this package should silently resolve, and whichever it chose would be a rule nobody
 * wrote down.
 */
export function createRiyaSummaryEditV1(input: unknown): RiyaSummaryEditV1 {
  const parsed = summaryEditSchema.safeParse(input);
  if (!parsed.success) {
    // The zod issue is discarded: its path names the failing field and its message can quote the
    // value, and the value here is a person's own words about their home.
    throw new RiyaConversationCompletionError('invalid-summary-edit');
  }
  const fields = parsed.data.edits.map((edit) => edit.field);
  if (new Set(fields).size !== fields.length) {
    throw new RiyaConversationCompletionError('invalid-summary-edit');
  }
  return Object.freeze({
    version: 1 as const,
    edits: Object.freeze(
      parsed.data.edits.map((edit) =>
        Object.freeze({
          field: edit.field,
          operation: edit.operation,
          ...(edit.value === undefined ? {} : { value: edit.value }),
        }),
      ),
    ),
  });
}
