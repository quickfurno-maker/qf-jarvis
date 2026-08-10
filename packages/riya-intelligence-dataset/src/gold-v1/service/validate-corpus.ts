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
 * ### Every field the assignment fixes is checked
 *
 * Split, language, primary kind, persona, risk, difficulty, starting phase, required secondary kinds,
 * required authority classes and depth. An assignment field nobody validates is a field the corpus is
 * free to drift on, and it drifts in one direction: toward the easier conversation.
 *
 * ### Human Gold means human-authored — a rule this validator ENFORCES but cannot PROVE
 *
 * A trajectory declaring `TEACHER_GENERATED_SYNTHETIC` does not count toward Human Gold V1, and no
 * approval, review or helper can change that. That much is enforced here.
 *
 * What cannot be enforced here is the honesty of the declaration. `source.kind` is a claim the author
 * makes, and no deterministic text validator can tell a human-written sentence from a model-written
 * one. A caller who deliberately mislabels AI-written dialogue as human-authored commits a governance
 * violation this code will not detect — see ADR-0108 §9. Authorship is process-attested: controlled
 * authoring, artifact-bound provenance, Git history and independent review make it auditable, not
 * mathematically certain. There is no AI-authorship detector here and there will not be one.
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
 * The one Gold provenance, as DECLARED on the artifact.
 *
 * Not a preference. A corpus is Human Gold because humans wrote the words in it — and this constant
 * is how that requirement is checked, not how it is guaranteed.
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
    if (trajectory.difficulty !== assignment.difficulty) {
      // Difficulty is a coverage axis with its own floors. A corpus that quietly rewrote every EDGE
      // slot as STANDARD would satisfy the total, the languages and the kinds, and would have
      // dropped the hardest sixth of what the plan set out to teach.
      findings.push({ reason: 'DIFFICULTY_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.initialState.phase !== assignment.startPhase) {
      // Starting phase IS the scenario. A slot written to open mid-conversation, with facts already
      // known, teaches something a fresh INTRO cannot -- and rewriting it as an INTRO is the easiest
      // way to make a hard assignment easy without appearing to change anything.
      findings.push({ reason: 'START_PHASE_MISMATCH', locationRef: trajectory.trajectoryId });
    }
    if (trajectory.source.kind !== RIYA_GOLD_REQUIRED_SOURCE_KIND) {
      // Declared provenance, refused. A trajectory declaring a teacher source is not Human Gold,
      // whoever approved it. What this cannot see is a caller who declares the wrong thing --
      // authorship is process-attested, and §9 of ADR-0108 says so plainly.
      findings.push({ reason: 'NOT_HUMAN_AUTHORED', locationRef: trajectory.trajectoryId });
    }

    // Required secondary kinds are a SUBSET check, not an equality check. An assignment naming
    // CORRECTION as secondary is saying the conversation must contain a correction; an author who
    // also produced a natural GROUNDING_QA moment along the way has not violated anything.
    for (const kind of assignment.requiredSecondaryKinds) {
      if (!trajectory.secondaryInteractionKinds.includes(kind)) {
        findings.push({
          reason: 'REQUIRED_SECONDARY_KIND_MISSING',
          locationRef: `${trajectory.trajectoryId}/${kind}`,
        });
      }
    }

    // Business-fact classes are checked in two halves, because the two failures are different.
    //
    // PRESENT means the authoritative context actually supplied a fact of that class. UNUSED means
    // it supplied one and the assistant never cited it -- a conversation about price where the price
    // arrives and nobody mentions it is not the conversation the slot asked for, and it is exactly
    // what an author produces when they write around a fact they found awkward.
    //
    // RID-F1 already proves citation ORDER and authority consistency, so this reads the resolved
    // structure rather than re-deriving it, and it infers nothing from prose.
    const suppliedClasses = new Map<string, string>();
    for (const turn of trajectory.turns) {
      if (turn.type === 'AUTHORITATIVE_CONTEXT') {
        for (const fact of turn.facts) {
          suppliedClasses.set(fact.factRef, fact.factClass);
        }
      }
    }
    const citedClasses = new Set<string>();
    for (const turn of trajectory.turns) {
      if (turn.type === 'ASSISTANT') {
        for (const factRef of turn.annotation.supportedFactRefs) {
          const factClass = suppliedClasses.get(factRef);
          if (factClass !== undefined) {
            citedClasses.add(factClass);
          }
        }
      }
    }
    for (const factClass of assignment.requiredAuthorityFactClasses) {
      if (![...suppliedClasses.values()].includes(factClass)) {
        findings.push({
          reason: 'REQUIRED_AUTHORITY_CLASS_MISSING',
          locationRef: `${trajectory.trajectoryId}/${factClass}`,
        });
        continue;
      }
      if (!citedClasses.has(factClass)) {
        findings.push({
          reason: 'REQUIRED_AUTHORITY_CLASS_UNUSED',
          locationRef: `${trajectory.trajectoryId}/${factClass}`,
        });
      }
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
