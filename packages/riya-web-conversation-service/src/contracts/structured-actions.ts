/**
 * The four internal structured actions (RWC-P6B, ADR-0102 §1, §4).
 *
 * ### These are INTERNAL trusted capabilities, and they carry no prose
 *
 * A structured action is what a QuickFurno surface sends when a client presses something: *change
 * this value*, *yes that is right*, *my details are with you*, *submit it*. There is no message, no
 * transcript and no free text of any kind — which is the whole reason these actions may produce
 * `user_confirmed` and `COMPLETE` while a conversational turn may not.
 *
 * ### What a caller may state, and what it structurally cannot
 *
 * It may state WHICH conversation, at WHICH revision, and WHAT it wants. It may not state a phase, a
 * provenance, a consent decision, an idempotency key, an availability snapshot, a Core intake state or
 * a completion evidence reference. Every schema is `.strict()`, so each of those is a REFUSAL rather
 * than a value quietly dropped: a caller able to supply `provenance` could write `user_confirmed` for
 * a guess, and a caller able to supply `completionEvidenceRef` could complete a conversation Core
 * never accepted.
 *
 * ### `expectedContinuityRevision` is the client's evidence, not bookkeeping
 *
 * It says *this is the summary I was shown*. ADR-0102 §4 checks it before any outbound call, so a
 * stale action costs one store read and reaches no external system. And ADR-0101 §14 forbids
 * confirming a NEWER summary: a mismatch fails closed rather than being reconciled onto a state the
 * client never saw.
 *
 * ### `actionRef` correlates and nothing else
 *
 * It is not persisted, it is not the submission's identity and it is deliberately excluded from the
 * idempotency preimage (ADR-0102 §11). A key that varied per press would make every retry a new
 * enquiry — the exact failure the key exists to prevent.
 */
import { z } from 'zod';

import type { RiyaSummaryEditV1 } from '@qf-jarvis/riya-conversation-completion';

/**
 * The identifier bound shared by every reference on an action.
 *
 * The same grammar the Core intake boundary and continuity's own evidence field use — no `@`, no `+`,
 * no whitespace, no `/` — so an email, an E.164 number, a URL and a sentence are unrepresentable in
 * any field a caller controls.
 */
export const MAX_RIYA_STRUCTURED_ACTION_REF_CHARS = 128;

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(MAX_RIYA_STRUCTURED_ACTION_REF_CHARS)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const CONTINUITY_REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** What every structured action carries. */
const BASE_SHAPE = {
  version: z.literal(1),
  tenantId: OPAQUE_REF,
  conversationId: OPAQUE_REF,
  expectedContinuityRevision: CONTINUITY_REVISION,
  actionRef: OPAQUE_REF,
} as const;

/** The identity every structured action carries. */
export interface RiyaStructuredActionIdentityV1 {
  readonly version: 1;
  readonly tenantId: string;
  readonly conversationId: string;
  /** The revision the client's surface was rendered from. Exact, never a floor. */
  readonly expectedContinuityRevision: number;
  /** Correlation only. Never persisted, and never part of the submission identity. */
  readonly actionRef: string;
}

/** Change one or more summary values, then re-merge through RWC-P4A. */
export interface RiyaSummaryEditActionV1 extends RiyaStructuredActionIdentityV1 {
  readonly edit: RiyaSummaryEditV1;
}

/** Agree to the summary exactly as rendered at `expectedContinuityRevision`. */
export type RiyaSummaryConfirmActionV1 = RiyaStructuredActionIdentityV1;

/** Advance `CONTACT → CONSENT` once Core holds contact for this subject. */
export interface RiyaContactAdvanceActionV1 extends RiyaStructuredActionIdentityV1 {
  /** The opaque Core customer reference. The only customer identity that crosses. */
  readonly subjectRef: string;
}

/** Submit the confirmed intake to Core, at most once. */
export type RiyaIntakeSubmissionActionV1 = RiyaContactAdvanceActionV1;

export const riyaSummaryEditActionSchema = z
  .object({
    ...BASE_SHAPE,
    // Re-proved separately through the REAL `createRiyaSummaryEditV1`, for the same reason the Core
    // submission re-proves its discovery: a second copy of the edit rules here is how this service and
    // RWC-P6A would come to disagree about what a valid edit is.
    edit: z.looseObject({}),
  })
  .strict();

export const riyaSummaryConfirmActionSchema = z.object({ ...BASE_SHAPE }).strict();

export const riyaContactAdvanceActionSchema = z
  .object({ ...BASE_SHAPE, subjectRef: OPAQUE_REF })
  .strict();

export const riyaIntakeSubmissionActionSchema = riyaContactAdvanceActionSchema;
