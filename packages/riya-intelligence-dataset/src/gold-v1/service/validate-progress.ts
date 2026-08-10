/**
 * The plan-aware progress board (HGV1-A owner correction, ADR-0108 §20).
 *
 * ### Why a record cannot check this itself
 *
 * A progress record knows its assignment id, its status and its review count. It does not know the
 * assignment's RISK CLASS — and the review requirement depends entirely on that: one accepted review
 * for a standard slot, two for a high-risk one.
 *
 * So a record saying `HIGH_RISK`-slot, `ACCEPTED`, `reviewCount: 1` is internally consistent and
 * globally wrong. Worse, it is wrong in the direction that hides itself: the slot leaves the
 * awaiting-second-review queue and joins the accepted count, and a wave looks finished while a
 * high-risk conversation has been read by one person. That is the exact rule the review policy exists
 * for, and a board that can quietly break it is a board nobody should plan around.
 *
 * Teaching the record constructor to guess risk from an id would be worse: two sources of truth for
 * the plan, and the wrong one is the one that is easy to reach. The plan comes in as an argument
 * instead, and this boundary is the authority.
 *
 * ### It stays content-free
 *
 * Findings carry a reason and an assignment id. Nothing here reads, holds or reports dialogue.
 */
import { summarizeRiyaGoldV1Progress } from '../contracts/progress.js';
import type { RiyaGoldProgressSummary, RiyaGoldV1ProgressV1 } from '../contracts/progress.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';
import type { RiyaGoldFinding } from './validate-plan.js';

/** Reviews an accepted slot must carry, by risk class. Restated from RID-F1, applied to the board. */
export const RIYA_GOLD_REQUIRED_ACCEPTED_REVIEWS: Readonly<Record<string, number>> = Object.freeze({
  STANDARD: 1,
  HIGH_RISK: 2,
});

export interface RiyaGoldProgressBoardReport {
  readonly totalRecords: number;
  /** Records that contradict no plan rule. Only these are summarized. */
  readonly validRecords: number;
  readonly findings: readonly RiyaGoldFinding[];
  /** Computed from the valid records only, so `accepted` cannot count a row the plan refuses. */
  readonly summary: RiyaGoldProgressSummary;
  readonly valid: boolean;
}

/**
 * Validate a progress board against the plan it tracks.
 *
 * A row that produces a finding is EXCLUDED from the summary. Counting it anyway would mean the
 * headline number reports work the same report has just refused, which is how a board ends up more
 * reassuring than the thing it describes.
 */
export function validateRiyaGoldV1ProgressBoard(
  records: readonly RiyaGoldV1ProgressV1[],
  assignments: readonly RiyaGoldV1AssignmentV1[],
): RiyaGoldProgressBoardReport {
  const findings: RiyaGoldFinding[] = [];
  const byAssignment = new Map(assignments.map((one) => [one.assignmentId, one]));
  const highRisk = new Set(
    assignments.filter((one) => one.riskClass === 'HIGH_RISK').map((one) => one.assignmentId),
  );

  const seen = new Set<string>();
  const valid: RiyaGoldV1ProgressV1[] = [];

  for (const record of records) {
    const assignment = byAssignment.get(record.assignmentId);
    if (assignment === undefined) {
      findings.push({
        reason: 'PROGRESS_WITHOUT_ASSIGNMENT',
        locationRef: record.assignmentId,
      });
      continue;
    }
    if (seen.has(record.assignmentId)) {
      // Two rows for one slot is two answers to "is this done", and the board would report whichever
      // it happened to iterate last.
      findings.push({ reason: 'DUPLICATE_PROGRESS_RECORD', locationRef: record.assignmentId });
      continue;
    }
    seen.add(record.assignmentId);

    let rowValid = true;

    // One slot, one conversation -- the same mapping the corpus validator enforces. A board pointing
    // at some other trajectory is a board that cannot be reconciled with the corpus.
    if (record.trajectoryId !== undefined && record.trajectoryId !== record.assignmentId) {
      findings.push({ reason: 'PROGRESS_TRAJECTORY_MISMATCH', locationRef: record.assignmentId });
      rowValid = false;
    }

    if (record.status === 'ACCEPTED') {
      const required = RIYA_GOLD_REQUIRED_ACCEPTED_REVIEWS[assignment.riskClass] ?? 1;
      if (record.reviewCount < required) {
        findings.push({
          reason: 'ACCEPTED_WITHOUT_REQUIRED_REVIEWS',
          locationRef: record.assignmentId,
        });
        rowValid = false;
      }
    }

    if (rowValid) {
      valid.push(record);
    }
  }

  return Object.freeze({
    totalRecords: records.length,
    validRecords: valid.length,
    findings: Object.freeze(findings),
    summary: summarizeRiyaGoldV1Progress(valid, highRisk),
    valid: findings.length === 0,
  });
}
