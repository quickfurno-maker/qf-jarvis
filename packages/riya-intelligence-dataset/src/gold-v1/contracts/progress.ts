/**
 * Authoring progress (HGV1-A, ADR-0108 §31).
 *
 * ### Workflow metadata, and nothing else
 *
 * Which slot, what state, which trajectory fulfils it, who is writing it, how many reviews it has.
 * No dialogue, no reviewer decision text, no notes. A progress board is the artifact most likely to
 * be screenshotted into a chat, and it should be safe to screenshot.
 *
 * No database, no API, no clock. A progress record is a value a caller holds; summarising a list of
 * them is a pure function. Nothing here can drift while nobody is looking.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { RIYA_GOLD_PROGRESS_STATUSES } from './vocabularies.js';
import type { RiyaGoldProgressStatus } from './vocabularies.js';

export interface RiyaGoldV1ProgressV1 {
  readonly version: 1;
  readonly assignmentId: string;
  readonly status: RiyaGoldProgressStatus;
  /** Present once a draft exists. Equals the assignment id by Gold convention. */
  readonly trajectoryId?: string;
  /** An opaque author handle. Never a name, an email or an employee id. */
  readonly authorRef?: string;
  readonly reviewCount: number;
  readonly lastRevision: number;
}

export type RiyaGoldV1ProgressInput = RiyaGoldV1ProgressV1;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const progressSchema = z
  .object({
    version: z.literal(1),
    assignmentId: REF,
    status: z.enum(RIYA_GOLD_PROGRESS_STATUSES),
    trajectoryId: REF.optional(),
    authorRef: REF.optional(),
    reviewCount: z.int().min(0).max(16),
    lastRevision: z.int().min(0).max(1_000_000),
  })
  .strict();

/** Validate and freeze one progress record. Throws `invalid-gold-progress`. */
export function createRiyaGoldV1Progress(input: RiyaGoldV1ProgressInput): RiyaGoldV1ProgressV1 {
  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-gold-progress');
  }
  // A slot that is drafting or beyond must name the trajectory it produced, or the board records
  // progress nobody can find.
  const needsTrajectory = parsed.data.status !== 'NOT_STARTED';
  if (needsTrajectory !== (parsed.data.trajectoryId !== undefined)) {
    throw new RiyaDatasetError('invalid-gold-progress');
  }
  if (parsed.data.status === 'ACCEPTED' && parsed.data.reviewCount === 0) {
    throw new RiyaDatasetError('invalid-gold-progress');
  }
  return Object.freeze({
    version: 1 as const,
    assignmentId: parsed.data.assignmentId,
    status: parsed.data.status,
    ...(parsed.data.trajectoryId === undefined ? {} : { trajectoryId: parsed.data.trajectoryId }),
    ...(parsed.data.authorRef === undefined ? {} : { authorRef: parsed.data.authorRef }),
    reviewCount: parsed.data.reviewCount,
    lastRevision: parsed.data.lastRevision,
  });
}

export interface RiyaGoldProgressSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<RiyaGoldProgressStatus, number>>;
  readonly byWave: Readonly<Record<string, number>>;
  readonly acceptedByLanguage: Readonly<Record<string, number>>;
  readonly acceptedByInteraction: Readonly<Record<string, number>>;
  readonly accepted: number;
  readonly rejected: number;
  /** High-risk slots that have one accepted review and still need the second. */
  readonly highRiskAwaitingSecondReview: number;
}

/** The wave, language and kind an assignment id encodes. Parsing beats threading extra state. */
function partsOf(assignmentId: string): {
  readonly wave: string;
  readonly language: string;
  readonly kind: string;
} {
  const segments = assignmentId.split('.');
  return {
    wave: segments[2] ?? 'unknown',
    language: segments[3] ?? 'unknown',
    kind: segments[4] ?? 'unknown',
  };
}

/**
 * Summarize a progress board. Pure, deterministic, and content-free.
 *
 * `highRiskAwaitingSecondReview` is the number worth watching during a wave: high-risk slots stall
 * there, and a board that only reported "accepted" would make the queue invisible until the end.
 */
export function summarizeRiyaGoldV1Progress(
  records: readonly RiyaGoldV1ProgressV1[],
  highRiskAssignmentIds: ReadonlySet<string> = new Set(),
): RiyaGoldProgressSummary {
  const byStatus: Record<RiyaGoldProgressStatus, number> = {
    NOT_STARTED: 0,
    DRAFTING: 0,
    READY_FOR_REVIEW: 0,
    ACCEPTED: 0,
    REJECTED: 0,
  };
  const byWave: Record<string, number> = {};
  const acceptedByLanguage: Record<string, number> = {};
  const acceptedByInteraction: Record<string, number> = {};
  let awaitingSecond = 0;

  for (const record of records) {
    byStatus[record.status] += 1;
    const parts = partsOf(record.assignmentId);
    byWave[parts.wave] = (byWave[parts.wave] ?? 0) + 1;
    if (record.status === 'ACCEPTED') {
      acceptedByLanguage[parts.language] = (acceptedByLanguage[parts.language] ?? 0) + 1;
      acceptedByInteraction[parts.kind] = (acceptedByInteraction[parts.kind] ?? 0) + 1;
    }
    if (
      highRiskAssignmentIds.has(record.assignmentId) &&
      record.status === 'READY_FOR_REVIEW' &&
      record.reviewCount === 1
    ) {
      awaitingSecond += 1;
    }
  }

  return Object.freeze({
    total: records.length,
    byStatus: Object.freeze(byStatus),
    byWave: Object.freeze(byWave),
    acceptedByLanguage: Object.freeze(acceptedByLanguage),
    acceptedByInteraction: Object.freeze(acceptedByInteraction),
    accepted: byStatus.ACCEPTED,
    rejected: byStatus.REJECTED,
    highRiskAwaitingSecondReview: awaitingSecond,
  });
}
