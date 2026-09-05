/**
 * The automated acceptance gate (AS1, ADR-0143 §8, §10, §14).
 *
 * ### It REUSES the deterministic validator. It does not reimplement one.
 *
 * `validateRiyaIntelligenceDataset` runs first, with the acceptance policy's own base release policy
 * and the pinned protected index. That is what keeps deep trajectory re-proof, the privacy scan, the
 * protected-exam firewall, authority consistency, lineage isolation, the duplicate rules and coverage
 * identical across both lanes. A second copy of those algorithms would drift, and the day it did, the
 * AI lane would be enforcing a firewall that was subtly weaker than the one everybody believed in.
 *
 * ### Exactly one generic blocker is set aside, and only when it is earned
 *
 * `insufficientReview` — because a teacher-generated corpus legitimately has no human reviews, and
 * the generic report is right to say so under its own meaning of eligibility.
 *
 * The bypass is CONDITIONAL. It applies only after this validator has proved, from the data:
 *
 * - the policy's review mode is `AUTOMATED_SYNTHETIC`;
 * - every trajectory is `TEACHER_GENERATED_SYNTHETIC`;
 * - every `review` array is empty;
 * - every trajectory carries valid, content-bound automated acceptance evidence.
 *
 * If any of those fails, `insufficientReview` is re-raised as a blocker alongside the failure. The
 * bypass is a reward for proving the alternative, never a mode somebody selects.
 *
 * Everything else the generic report can block on stays blocking, `protectedNearLeakage` very much
 * included: there is no human to adjudicate a quarantine here, so a near-leak is discarded rather
 * than argued about.
 *
 * ### AS1-B: two provenance modes, one gate
 *
 * A row's provenance is either the AS2 in-repo record or the external manual intake record, and the
 * gate does not soften for the second one. It runs the same base validator, requires the same
 * content-bound evidence, the same critic count, the same critic independence and the SAME required
 * quality dimensions. What differs is only what can truthfully be compared: the external mode has two
 * generation role refs rather than five, and it must carry a deterministic verifier RUN where the
 * in-repo mode carries an annotation verifier config ref.
 *
 * That last one is an addition, not a substitution. Nothing about the in-repo route changed here, and
 * no existing finding, threshold or bypass condition was relaxed to let the external mode through.
 */
import type { ProtectedTextIndex } from '../../internal/leakage.js';
import { validateRiyaIntelligenceDataset } from '../../service/validate-dataset.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../../internal/trajectory-digest.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../../contracts/trajectory.js';
import type { RiyaDatasetReleaseReportV1 } from '../../contracts/report.js';
import type { RiyaAiSyntheticAcceptancePolicyV1 } from '../contracts/acceptance-policy.js';
import {
  createRiyaAiSyntheticAcceptancePolicy,
  riyaAiSyntheticAcceptancePolicySha256,
} from '../contracts/acceptance-policy.js';
import type { RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1 } from '../contracts/acceptance-evidence.js';
import { riyaAiSyntheticProvenanceSha256 } from '../contracts/generation-provenance.js';
import { isRiyaAiSyntheticExternalIntakeProvenance } from '../contracts/external-intake-provenance.js';
import type { RiyaAiSyntheticProvenanceV1 } from '../contracts/external-intake-provenance.js';
import type { RiyaAiSyntheticScenarioV1 } from '../contracts/scenario.js';
import { riyaAiSyntheticScenarioSha256 } from '../contracts/scenario.js';
import type {
  RiyaAiSyntheticAcceptanceReportV1,
  RiyaAiSyntheticFindingV1,
} from '../contracts/report.js';
import { riyaAiSyntheticReportSha256 } from '../contracts/report.js';
import { riyaAiSyntheticDiversityMetrics } from './diversity.js';

export interface ValidateRiyaAiSyntheticOptions {
  readonly trajectories: readonly RiyaIntelligenceTrajectoryV1[];
  readonly scenarios: readonly RiyaAiSyntheticScenarioV1[];
  /**
   * Provenance in either mode, in one list.
   *
   * A corpus is allowed to be mixed. The lookup is by `generationRef`, which both modes carry, and
   * every rule below either applies to both or narrows explicitly — so an external row is gated by
   * the same evidence, scenario, digest and critic rules an in-repo row is, plus the ones only it can
   * satisfy. There is no path on which choosing the external mode asks for less.
   */
  readonly provenances: readonly RiyaAiSyntheticProvenanceV1[];
  readonly evidence: readonly RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1[];
  readonly policy: RiyaAiSyntheticAcceptancePolicyV1;
  /** The pinned protected corpus. Absent can never be eligible — the base policy pins it. */
  readonly protectedIndex?: ProtectedTextIndex;
}

export interface RiyaAiSyntheticValidationResult {
  readonly baseReport: RiyaDatasetReleaseReportV1;
  readonly report: RiyaAiSyntheticAcceptanceReportV1;
}

const assistantTurnsOf = (trajectory: RiyaIntelligenceTrajectoryV1) =>
  trajectory.turns.filter((turn) => turn.type === 'ASSISTANT');

/**
 * The refs a critic or a verifier may not be, for this row.
 *
 * ADR-0143 §9 and §12: the judge may not be the thing it is judging, nor any other role in the bundle
 * that produced it. Which refs those ARE depends on the mode, and the external mode has exactly two —
 * the intake bundle and the producer's teacher. It does not get a longer list by inventing planner
 * and simulator refs it never had; it gets the list of what is true, and every ref in it is compared.
 */
function generationRoleRefs(provenance: RiyaAiSyntheticProvenanceV1): ReadonlySet<string> {
  if (isRiyaAiSyntheticExternalIntakeProvenance(provenance)) {
    return new Set([provenance.generationRef, provenance.producerTeacherRef]);
  }
  return new Set([
    provenance.generationRef,
    provenance.scenarioPlannerConfigRef,
    provenance.customerSimulatorConfigRef,
    provenance.riyaTeacherConfigRef,
    provenance.annotationVerifierConfigRef,
  ]);
}

/** The generic blockers that stay blocking. `insufficientReview` is handled separately, above. */
function baseBlockers(base: RiyaDatasetReleaseReportV1): readonly RiyaAiSyntheticFindingV1[] {
  const out: RiyaAiSyntheticFindingV1[] = [];
  const push = (locations: readonly { readonly trajectoryId: string }[]): void => {
    for (const location of locations) {
      out.push({ kind: 'BASE_VALIDATION_BLOCKED', trajectoryId: location.trajectoryId });
    }
  };
  for (const failure of base.releaseBindingFailures) {
    out.push({ kind: 'BASE_VALIDATION_BLOCKED', counterpartRef: failure });
  }
  push(base.duplicateTrajectoryIds);
  push(base.lineageSplitViolations);
  push(base.exactCrossSplitDuplicates);
  push(base.nearCrossSplitDuplicates);
  push(base.protectedExactLeakage);
  // Terminal in this lane. ADR-0143 §19: no human adjudicates a quarantine, so it is not resolvable.
  push(base.protectedNearLeakage);
  push(base.privacyViolations);
  push(base.unsupportedBusinessFacts);
  // `sameSplitNearDuplicates` is DELIBERATELY absent: RID-F1 keeps it report-only and this lane does
  // not promote it. Excessive same-lineage redundancy is caught by the diversity policy instead,
  // which is a versioned decision rather than a stricter shadow of the generic rule.
  for (const shortfall of base.coverageShortfalls) {
    out.push({
      kind: 'BASE_VALIDATION_BLOCKED',
      counterpartRef: `${shortfall.dimension}:${shortfall.key}`,
      observed: shortfall.observed,
      required: shortfall.required,
    });
  }
  return out;
}

/**
 * Validate a teacher-generated corpus under an automated acceptance policy.
 *
 * Returns both reports. The base one is not swallowed: a caller that wants to know why the generic
 * gate said what it said should not have to re-run it.
 */
export function validateRiyaAiSyntheticCorpus(
  options: ValidateRiyaAiSyntheticOptions,
): RiyaAiSyntheticValidationResult {
  const { trajectories, scenarios, provenances, evidence } = options;

  // DEEP re-proof at the boundary, mirroring what the generic validator does with trajectories.
  //
  // A caller can reach this function with a policy object that never went through the constructor —
  // parsed from somewhere, hand-assembled, or cast — and gating a corpus under an unvalidated policy
  // would mean gating it under whatever the caller claimed. Throws `invalid-ai-synthetic-policy`.
  //
  // This is ALSO what makes `reviewMode` an enforced fact rather than a type-level hope. The
  // constructor does not accept a review mode; it ASSIGNS the literal. So every policy that survives
  // this call is automated-mode by construction, there is no reachable state in which it is not, and
  // a `REVIEW_MODE_NOT_AUTOMATED` finding would be advertising a check that cannot fire.
  const policy = createRiyaAiSyntheticAcceptancePolicy({
    policyId: options.policy.policyId,
    policyVersion: options.policy.policyVersion,
    baseReleasePolicy: options.policy.baseReleasePolicy,
    criticPolicy: options.policy.criticPolicy,
    diversityPolicy: options.policy.diversityPolicy,
    assistantTurnTolerance: options.policy.assistantTurnTolerance,
  });

  const baseReport = validateRiyaIntelligenceDataset(trajectories, {
    // Spread rather than assigned: `exactOptionalPropertyTypes` makes an explicit `undefined`
    // different from an absent key, and the generic validator's own default depends on absence.
    ...(options.protectedIndex === undefined ? {} : { protectedIndex: options.protectedIndex }),
    releasePolicy: policy.baseReleasePolicy,
  });

  const findings: RiyaAiSyntheticFindingV1[] = [...baseBlockers(baseReport)];

  // ---- automated-mode preconditions -----------------------------------------------------------
  //
  // "Did anything fail?" is derived from `findings.length`, never from a mutable boolean. A
  // `let ok = true` assigned only inside a closure is invisible to control-flow analysis, so the
  // later `if (ok)` reads as a constant: the check still runs, but nothing can see that it matters.
  // A length watermark is both provable and exactly equivalent.
  const findingsBeforePreconditions = findings.length;
  const fail = (finding: RiyaAiSyntheticFindingV1): void => {
    findings.push(finding);
  };

  // The review mode is NOT checked here. `RiyaAiSyntheticAcceptancePolicyV1.reviewMode` is the
  // literal `'AUTOMATED_SYNTHETIC'`, so the type is the enforcement and a runtime comparison would be
  // a branch that can never be taken.

  for (const trajectory of trajectories) {
    if (trajectory.source.kind !== 'TEACHER_GENERATED_SYNTHETIC') {
      // Covers both a human-authored row and a mixed corpus: every offending row is named.
      fail({ kind: 'SOURCE_NOT_TEACHER_GENERATED', trajectoryId: trajectory.trajectoryId });
    }
    if (trajectory.review.length > 0) {
      // No fabricated ACCEPTED records. A teacher row carrying reviews is claiming a human looked.
      fail({ kind: 'REVIEW_RECORDS_PRESENT', trajectoryId: trajectory.trajectoryId });
    }
    if (trajectory.source.teacherRef === undefined) {
      fail({ kind: 'TEACHER_REF_MISSING', trajectoryId: trajectory.trajectoryId });
    }
  }

  // ---- evidence pairing -----------------------------------------------------------------------
  const evidenceById = new Map<string, RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1[]>();
  for (const item of evidence) {
    const bucket = evidenceById.get(item.trajectoryId) ?? [];
    bucket.push(item);
    evidenceById.set(item.trajectoryId, bucket);
  }
  const trajectoryIds = new Set(trajectories.map((one) => one.trajectoryId));
  for (const [id, bucket] of evidenceById) {
    if (!trajectoryIds.has(id)) {
      fail({ kind: 'EVIDENCE_UNMATCHED', trajectoryId: id });
    }
    if (bucket.length > 1) {
      fail({ kind: 'EVIDENCE_DUPLICATED', trajectoryId: id, observed: bucket.length, required: 1 });
    }
  }

  const scenarioByRef = new Map(scenarios.map((one) => [one.scenarioRef, one]));
  const provenanceByRef = new Map(provenances.map((one) => [one.generationRef, one]));
  let acceptedEvidenceCount = 0;

  for (const trajectory of trajectories) {
    const bucket = evidenceById.get(trajectory.trajectoryId) ?? [];
    const item = bucket[0];
    if (item === undefined) {
      fail({ kind: 'EVIDENCE_MISSING', trajectoryId: trajectory.trajectoryId });
      continue;
    }

    // This row is accepted only if it adds no finding of its own.
    const findingsBeforeRow = findings.length;

    // THE content binding. Recomputed, never taken on trust. Every other digest on this row is
    // compared against this recomputation rather than against the claim beside it.
    const artifactSha256 = trajectoryArtifactSha256(trajectory);

    if (item.trajectoryArtifactSha256 !== artifactSha256) {
      fail({ kind: 'TRAJECTORY_DIGEST_MISMATCH', trajectoryId: trajectory.trajectoryId });
    }
    if (item.conversationFingerprint !== trajectoryConversationFingerprint(trajectory)) {
      fail({ kind: 'CONVERSATION_FINGERPRINT_MISMATCH', trajectoryId: trajectory.trajectoryId });
    }
    if (trajectory.source.teacherRef !== item.generationRef) {
      fail({
        kind: 'TEACHER_REF_NOT_BOUND_TO_GENERATION',
        trajectoryId: trajectory.trajectoryId,
        counterpartRef: item.generationRef,
      });
    }

    // ---- scenario ----------------------------------------------------------------------------
    const scenario = scenarioByRef.get(item.scenarioRef);
    if (scenario === undefined) {
      fail({
        kind: 'SCENARIO_MISSING',
        trajectoryId: trajectory.trajectoryId,
        counterpartRef: item.scenarioRef,
      });
    } else {
      if (riyaAiSyntheticScenarioSha256(scenario) !== item.scenarioSha256) {
        fail({
          kind: 'SCENARIO_DIGEST_MISMATCH',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: scenario.scenarioRef,
        });
      }
      const mismatched =
        scenario.lineageRootRef !== trajectory.lineageRootRef ||
        scenario.split !== trajectory.split ||
        scenario.languageMode !== trajectory.languageMode ||
        scenario.primaryInteractionKind !== trajectory.primaryInteractionKind ||
        scenario.persona !== trajectory.persona ||
        scenario.difficulty !== trajectory.difficulty ||
        scenario.riskClass !== trajectory.riskClass ||
        scenario.startPhase !== trajectory.initialState.phase ||
        !scenario.secondaryInteractionKinds.every((kind) =>
          trajectory.secondaryInteractionKinds.includes(kind),
        );
      if (mismatched) {
        fail({
          kind: 'SCENARIO_TRAJECTORY_MISMATCH',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: scenario.scenarioRef,
        });
      }
      const depth = assistantTurnsOf(trajectory).length;
      const drift = Math.abs(depth - scenario.targetAssistantTurns);
      if (drift > policy.assistantTurnTolerance) {
        fail({
          kind: 'SCENARIO_DEPTH_OUT_OF_TOLERANCE',
          trajectoryId: trajectory.trajectoryId,
          observed: depth,
          required: scenario.targetAssistantTurns,
        });
      }
    }

    // ---- provenance and role separation -------------------------------------------------------
    const provenance = provenanceByRef.get(item.generationRef);
    if (provenance === undefined) {
      fail({
        kind: 'PROVENANCE_DIGEST_MISMATCH',
        trajectoryId: trajectory.trajectoryId,
        counterpartRef: item.generationRef,
      });
    } else if (riyaAiSyntheticProvenanceSha256(provenance) !== item.provenanceSha256) {
      fail({
        kind: 'PROVENANCE_DIGEST_MISMATCH',
        trajectoryId: trajectory.trajectoryId,
        counterpartRef: provenance.generationRef,
      });
    } else if (provenance.scenarioRef !== item.scenarioRef) {
      fail({
        kind: 'PROVENANCE_ROLE_NOT_SEPARATED',
        trajectoryId: trajectory.trajectoryId,
        counterpartRef: provenance.scenarioRef,
      });
    }

    // ---- external intake source binding -------------------------------------------------------
    //
    // An external row claims a source it was derived from, and the claim is checked against the
    // record in hand. Otherwise "this came from batch B" would be a label rather than a binding: a
    // re-derivation that changed a reply, or a swap onto a different scenario, would keep citing a
    // delivery that no longer describes it, and the intake trail would quietly stop being true.
    if (provenance !== undefined && isRiyaAiSyntheticExternalIntakeProvenance(provenance)) {
      if (
        provenance.sourceTrajectoryArtifactSha256 !== artifactSha256 ||
        provenance.scenarioSha256 !== item.scenarioSha256
      ) {
        fail({
          kind: 'EXTERNAL_SOURCE_DIGEST_MISMATCH',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: provenance.batchRef,
        });
      }
    }

    // ---- the deterministic verifier -----------------------------------------------------------
    //
    // The external route has no `annotationVerifierConfigRef`, because no AS2 role allocation ever
    // ran for it. A run record stands in that place, and it is REQUIRED there — a route with no
    // verification must not be indistinguishable from one with a clean deterministic pass.
    //
    // On the in-repo route the run stays optional, exactly as it was. But an untruthful one is
    // refused on both: present means checked.
    const verifierRun = item.deterministicVerifierRun;
    if (verifierRun === undefined) {
      if (provenance !== undefined && isRiyaAiSyntheticExternalIntakeProvenance(provenance)) {
        fail({ kind: 'VERIFIER_RUN_MISSING', trajectoryId: trajectory.trajectoryId });
      }
    } else {
      if (verifierRun.verdict !== 'PASSED') {
        fail({
          kind: 'VERIFIER_VERDICT_NOT_PASSED',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: verifierRun.verifierRef,
        });
      }
      // Recomputed, so a clean run record cannot be pasted from a different row.
      if (verifierRun.trajectoryArtifactSha256 !== artifactSha256) {
        fail({
          kind: 'VERIFIER_RUN_NOT_BOUND_TO_TRAJECTORY',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: verifierRun.verifierRef,
        });
      }
      // Verifier is not teacher, and not any other generation role. Critic-vs-verifier is enforced
      // one layer up, in the evidence constructor, where both are present without a join.
      if (provenance !== undefined) {
        const roles = generationRoleRefs(provenance);
        if (
          roles.has(verifierRun.verifierRef) ||
          roles.has(verifierRun.verifierImplementationRef)
        ) {
          fail({
            kind: 'VERIFIER_NOT_INDEPENDENT',
            trajectoryId: trajectory.trajectoryId,
            counterpartRef: verifierRun.verifierRef,
          });
        }
      }
    }

    // ---- critics ------------------------------------------------------------------------------
    const critic = policy.criticPolicy;
    const verdicts = item.criticVerdicts;
    const accepted = verdicts.filter((one) => one.decision === 'ACCEPTED');

    // One explicit rejection is decisive, however many acceptances sit beside it.
    for (const verdict of verdicts) {
      if (verdict.decision === 'REJECTED') {
        fail({
          kind: 'CRITIC_REJECTED',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: verdict.criticRef,
        });
      }
    }
    if (accepted.length < critic.minAcceptedCritics) {
      fail({
        kind: 'CRITIC_COUNT_BELOW_POLICY',
        trajectoryId: trajectory.trajectoryId,
        observed: accepted.length,
        required: critic.minAcceptedCritics,
      });
    }
    const configs = verdicts.map((one) => one.criticConfigRef);
    if (critic.requireDistinctCriticConfigs && new Set(configs).size !== configs.length) {
      fail({ kind: 'CRITIC_DUPLICATE_CONFIG', trajectoryId: trajectory.trajectoryId });
    }
    if (critic.requireCriticConfigDistinctFromGeneration && provenance !== undefined) {
      // ADR-0143 §9 and §12: the critic may not be the thing it is judging, nor any other role in
      // the bundle that produced it. The role list is mode-dependent; the rule is not.
      const generationRoles = generationRoleRefs(provenance);
      for (const verdict of verdicts) {
        if (generationRoles.has(verdict.criticConfigRef)) {
          fail({
            kind: 'CRITIC_CONFIG_NOT_INDEPENDENT',
            trajectoryId: trajectory.trajectoryId,
            counterpartRef: verdict.criticRef,
          });
        }
      }
    }
    if (critic.requireDistinctCriticModelFamilies) {
      const families = verdicts
        .map((one) => one.criticModelFamilyRef)
        .filter((one): one is string => one !== undefined);
      // Undeclared families cannot be proved distinct. Refusing is the safe reading: the policy was
      // switched on deliberately, so silently passing when the data is absent would defeat it.
      if (families.length !== verdicts.length || new Set(families).size !== families.length) {
        fail({
          kind: 'CRITIC_MODEL_FAMILY_NOT_DISTINCT',
          trajectoryId: trajectory.trajectoryId,
        });
      }
    }
    const satisfied = new Set(accepted.flatMap((one) => one.satisfiedQualityDimensions));
    for (const dimension of critic.requiredQualityDimensions) {
      if (!satisfied.has(dimension)) {
        fail({
          kind: 'CRITIC_DIMENSION_MISSING',
          trajectoryId: trajectory.trajectoryId,
          counterpartRef: dimension,
        });
      }
    }

    if (findings.length === findingsBeforeRow) acceptedEvidenceCount += 1;
  }

  // ---- the conditional bypass -----------------------------------------------------------------
  const preconditionsHold = findings.length === findingsBeforePreconditions;
  const everyRowHasEvidence = acceptedEvidenceCount === trajectories.length;
  if (!preconditionsHold || !everyRowHasEvidence) {
    // The bypass was not earned, so the human-review blocker is re-raised exactly as the generic
    // validator reported it.
    for (const location of baseReport.insufficientReview) {
      findings.push({ kind: 'BASE_VALIDATION_BLOCKED', trajectoryId: location.trajectoryId });
    }
  }

  // ---- diversity -------------------------------------------------------------------------------
  const diversityMetrics = riyaAiSyntheticDiversityMetrics(trajectories);
  const diversity = policy.diversityPolicy;
  const check = (
    kind: RiyaAiSyntheticFindingV1['kind'],
    observed: number,
    required: number,
    mode: 'floor' | 'cap',
  ): void => {
    const failed = mode === 'floor' ? observed < required : observed > required;
    if (failed) findings.push({ kind, observed, required });
  };
  if (trajectories.length > 0) {
    check(
      'DIVERSITY_FINGERPRINT_UNIQUENESS_BELOW_FLOOR',
      diversityMetrics.fingerprintUniquenessBp,
      diversity.minFingerprintUniquenessBp,
      'floor',
    );
    check(
      'DIVERSITY_OPENER_RECURRENCE_ABOVE_CAP',
      diversityMetrics.topOpenerRecurrenceBp,
      diversity.maxOpenerRecurrenceBp,
      'cap',
    );
    check(
      'DIVERSITY_CLOSER_RECURRENCE_ABOVE_CAP',
      diversityMetrics.topCloserRecurrenceBp,
      diversity.maxCloserRecurrenceBp,
      'cap',
    );
    check(
      'DIVERSITY_QUESTION_SEQUENCE_ABOVE_CAP',
      diversityMetrics.topQuestionSequenceRecurrenceBp,
      diversity.maxQuestionSequenceRecurrenceBp,
      'cap',
    );
    check(
      'DIVERSITY_PHASE_SEQUENCE_ABOVE_CAP',
      diversityMetrics.topPhaseSequenceRecurrenceBp,
      diversity.maxPhaseSequenceRecurrenceBp,
      'cap',
    );
    check(
      'DIVERSITY_LINEAGE_VARIANTS_ABOVE_CAP',
      diversityMetrics.maxVariantsPerLineage,
      diversity.maxVariantsPerLineage,
      'cap',
    );
    check(
      'DIVERSITY_DEPTH_BAND_COVERAGE_BELOW_FLOOR',
      diversityMetrics.depthBandsCovered,
      diversity.minDepthBandsCovered,
      'floor',
    );
    check(
      'DIVERSITY_DECISION_COVERAGE_BELOW_FLOOR',
      diversityMetrics.decisionsCovered,
      diversity.minDecisionsCovered,
      'floor',
    );
    check(
      'DIVERSITY_OBJECTIVE_COVERAGE_BELOW_FLOOR',
      diversityMetrics.objectivesCovered,
      diversity.minObjectivesCovered,
      'floor',
    );
    check(
      'DIVERSITY_SAME_LINEAGE_REDUNDANCY_ABOVE_CAP',
      diversityMetrics.sameLineageNearDuplicateBp,
      diversity.maxSameLineageNearDuplicateBp,
      'cap',
    );
  }

  const sorted = Object.freeze(
    [...findings].sort((a, b) => {
      const byKind = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
      if (byKind !== 0) return byKind;
      return (a.trajectoryId ?? '') < (b.trajectoryId ?? '')
        ? -1
        : (a.trajectoryId ?? '') > (b.trajectoryId ?? '')
          ? 1
          : 0;
    }),
  );

  const body = {
    version: 1 as const,
    reviewMode: 'AUTOMATED_SYNTHETIC' as const,
    baseReportSha256: baseReport.reportSha256,
    validatedDatasetSha256: baseReport.validatedDatasetSha256,
    acceptancePolicyId: policy.policyId,
    acceptancePolicyVersion: policy.policyVersion,
    acceptancePolicySha256: riyaAiSyntheticAcceptancePolicySha256(policy),
    ...(baseReport.releasePolicyId === undefined
      ? {}
      : { baseReleasePolicyId: baseReport.releasePolicyId }),
    ...(baseReport.releasePolicyVersion === undefined
      ? {}
      : { baseReleasePolicyVersion: baseReport.releasePolicyVersion }),
    ...(baseReport.protectedIndexSha256 === undefined
      ? {}
      : { protectedIndexSha256: baseReport.protectedIndexSha256 }),
    ...(baseReport.protectedEntryCount === undefined
      ? {}
      : { protectedEntryCount: baseReport.protectedEntryCount }),
    totalTrajectories: trajectories.length,
    acceptedEvidenceCount,
    diversityMetrics,
    findings: sorted,
    eligible: sorted.length === 0 && trajectories.length > 0,
  };

  return {
    baseReport,
    report: Object.freeze({ ...body, reportSha256: riyaAiSyntheticReportSha256(body) }),
  };
}
