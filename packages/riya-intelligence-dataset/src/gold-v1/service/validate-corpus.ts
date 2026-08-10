/**
 * The Gold V1 corpus validator (HGV1-A, ADR-0108).
 *
 * ### It reuses the RID-F1 gate rather than replacing it
 *
 * Everything RID-F1 already enforces — deep re-proof, lineage isolation, the protected-exam firewall,
 * privacy, business-fact authority, risk-based review, the release binding — runs first, unchanged. A
 * Gold corpus that is not a valid dataset is not a valid Gold corpus.
 *
 * What this adds is the MATRIX: does the finished corpus actually match the plan it was written
 * against? A dataset can pass every generic gate and still be the wrong corpus — 300 discovery
 * examples and 60 of everything else would sail through RID-F1 and be useless.
 *
 * ### Human Gold means human-authored
 *
 * A `TEACHER_GENERATED_SYNTHETIC` trajectory does not count toward Human Gold V1, and no approval,
 * review or helper can change that. Provenance is a statement about who wrote the words, and a human
 * clicking accept did not write them. Teacher-generated content has its own future dataset; this
 * validator simply refuses to count it here.
 */
import { validateRiyaIntelligenceDataset } from '../../service/validate-dataset.js';
import type { ValidateRiyaDatasetOptions } from '../../service/validate-dataset.js';
import type { RiyaDatasetReleaseReportV1 } from '../../contracts/report.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../../contracts/trajectory.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';
import type { RiyaGoldFinding } from './validate-plan.js';
import { assistantTurnCountOf, riyaGoldRepetitionMetrics } from './repetition.js';
import type { RiyaGoldRepetitionMetrics } from './repetition.js';

/**
 * The one Gold provenance.
 *
 * Not a preference. A corpus is Human Gold because humans wrote the words in it.
 */
export const RIYA_GOLD_REQUIRED_SOURCE_KIND = 'HUMAN_AUTHORED_SYNTHETIC';

export interface RiyaGoldCorpusReport {
  /** The full RID-F1 gate, unchanged. */
  readonly datasetReport: RiyaDatasetReleaseReportV1;
  readonly matchedAssignments: number;
  readonly repetition: RiyaGoldRepetitionMetrics;
  readonly findings: readonly RiyaGoldFinding[];
  /** True only when the RID-F1 dataset is eligible AND the Gold matrix holds. */
  readonly goldEligible: boolean;
}

/**
 * Validate a Gold corpus against its plan.
 *
 * `trajectoryId` must equal the `assignmentId` it fulfils. That is the whole mapping: one slot, one
 * conversation, and a corpus cannot quietly gain an extra example or reuse a slot twice.
 */
export function validateRiyaGoldV1Corpus(
  trajectories: readonly RiyaIntelligenceTrajectoryV1[],
  assignments: readonly RiyaGoldV1AssignmentV1[],
  options: ValidateRiyaDatasetOptions = {},
): RiyaGoldCorpusReport {
  const datasetReport = validateRiyaIntelligenceDataset(trajectories, options);
  const findings: RiyaGoldFinding[] = [];

  const byAssignment = new Map(assignments.map((one) => [one.assignmentId, one]));
  const used = new Set<string>();
  let matched = 0;

  for (const trajectory of trajectories) {
    const assignment = byAssignment.get(trajectory.trajectoryId);
    if (assignment === undefined) {
      findings.push({
        reason: 'TRAJECTORY_WITHOUT_ASSIGNMENT',
        locationRef: trajectory.trajectoryId,
      });
      continue;
    }
    if (used.has(assignment.assignmentId)) {
      findings.push({ reason: 'ASSIGNMENT_USED_TWICE', locationRef: assignment.assignmentId });
      continue;
    }
    used.add(assignment.assignmentId);
    matched += 1;

    if (trajectory.split !== assignment.split) {
      findings.push({ reason: 'SPLIT_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.languageMode !== assignment.languageMode) {
      findings.push({ reason: 'LANGUAGE_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.primaryInteractionKind !== assignment.primaryInteractionKind) {
      findings.push({ reason: 'PRIMARY_KIND_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.persona !== assignment.persona) {
      findings.push({ reason: 'PERSONA_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.riskClass !== assignment.riskClass) {
      findings.push({ reason: 'RISK_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.source.kind !== RIYA_GOLD_REQUIRED_SOURCE_KIND) {
      // The provenance rule, enforced rather than documented. A teacher-written conversation is not
      // Human Gold, whoever approved it.
      findings.push({ reason: 'NOT_HUMAN_AUTHORED', locationRef: trajectory.trajectoryId });
    }

    // Depth may drift by one when naturalness demands it. Anything further is REPORTED rather than
    // silently accepted -- a reviewer decides whether the scenario genuinely needed it.
    const actual = assistantTurnCountOf(trajectory);
    const drift = Math.abs(actual - assignment.targetAssistantTurns);
    if (drift > 1) {
      findings.push({ reason: 'DEPTH_DEVIATION', locationRef: trajectory.trajectoryId });
    }
  }

  for (const assignment of assignments) {
    if (!used.has(assignment.assignmentId)) {
      findings.push({ reason: 'ASSIGNMENT_UNFULFILLED', locationRef: assignment.assignmentId });
    }
  }

  const repetition = riyaGoldRepetitionMetrics(trajectories);

  return Object.freeze({
    datasetReport,
    matchedAssignments: matched,
    repetition,
    findings: Object.freeze(findings),
    goldEligible: datasetReport.eligible && findings.length === 0,
  });
}
