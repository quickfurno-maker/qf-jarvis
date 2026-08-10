/**
 * The dataset release gate (RID-F1, ADR-0107 §22–§25, §29, §34).
 *
 * Pure and deterministic: same trajectories plus same policy plus same protected index, same report,
 * every time. No clock, no randomness, no I/O, no model.
 *
 * ### The order of the checks is the order of the risks
 *
 * Privacy first, because a leaked secret is unrecoverable once trained. Then the protected-exam
 * firewall, because a leaked exam invalidates every later measurement and does it invisibly. Then
 * lineage and cross-split duplicates, because they silently inflate validation scores. Then business
 * facts, reviews and coverage.
 *
 * Nothing here throws for a finding. The report LISTS everything so one pass tells an author the
 * whole story, rather than making them fix one problem to discover the next.
 */
import {
  jaccard,
  longestCommonRun,
  ngrams,
  normalizeForComparison,
  tokenize,
} from '../internal/normalization.js';
import { collidesWithProtectedIdentity, matchProtectedText } from '../internal/leakage.js';
import type { ProtectedTextIndex } from '../internal/leakage.js';
import { scanLocated } from '../internal/privacy-scan.js';
import { createProtectedTextIndex } from '../internal/leakage.js';
import { coveragePolicySha256 } from '../contracts/release-policy.js';
import type { RiyaDatasetReleasePolicyV1 } from '../contracts/release-policy.js';
import type {
  RiyaDatasetFindingLocation,
  RiyaDatasetReleaseBindingFailure,
  RiyaDatasetReleaseReportV1,
} from '../contracts/report.js';
import { reportSha256, validatedDatasetSha256 } from '../internal/report-integrity.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import {
  RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS,
  RIYA_DATASET_OBJECTION_INTERACTION_KINDS,
  RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS,
  RIYA_DATASET_REQUIRED_REVIEWS,
} from '../contracts/vocabularies.js';
import type {
  RiyaDatasetInteractionKind,
  RiyaDatasetQualityDimension,
  RiyaDatasetSplit,
} from '../contracts/vocabularies.js';

/**
 * The cross-split near-duplicate bounds.
 *
 * Deliberately the same shape as the protected-exam test, and for the same reason: a paraphrase of a
 * TRAIN conversation sitting in VALIDATION measures memorisation, exactly as a paraphrase of an exam
 * question does. Conversations are longer than single fixtures, so the run threshold is higher —
 * twelve consecutive identical tokens across two multi-turn conversations is a copy, not a
 * coincidence of phrasing.
 */
export const CROSS_SPLIT_NEAR_MIN_COMMON_RUN_TOKENS = 12;
export const CROSS_SPLIT_NEAR_MIN_JACCARD = 0.8;
const CROSS_SPLIT_NGRAM_SIZE = 5;

export interface ValidateRiyaDatasetOptions {
  /**
   * The protected RWC-P10 corpus, supplied by the caller.
   *
   * Still optional as an ARGUMENT — a dry run without one is useful — but an absent or mismatched
   * index can no longer produce an eligible report. The release policy pins which corpus, how many
   * entries and which digest, and a failure to bind is recorded and blocks (owner correction on
   * PR #112).
   */
  readonly protectedIndex?: ProtectedTextIndex;
  /**
   * The release policy this validation is gated under. Carries the coverage policy and the pinned
   * protected-corpus identity. Absent means the run is a dry run and can never be eligible.
   */
  readonly releasePolicy?: RiyaDatasetReleasePolicyV1;
}

const tally = <Key extends string>(
  keys: readonly Key[],
): Readonly<Partial<Record<Key, number>>> => {
  const out: Partial<Record<Key, number>> = {};
  for (const key of keys) {
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.freeze(out);
};

/** Every spoken turn of a trajectory, paired with its ref. Context turns speak to nobody. */
const spokenTurns = (trajectory: RiyaIntelligenceTrajectoryV1) =>
  trajectory.turns.filter((turn) => turn.type === 'USER' || turn.type === 'ASSISTANT');

/** Which dimensions this trajectory's reviewers must have satisfied. */
function requiredReviewDimensions(
  trajectory: RiyaIntelligenceTrajectoryV1,
): readonly RiyaDatasetQualityDimension[] {
  const kinds: readonly RiyaDatasetInteractionKind[] = [
    trajectory.primaryInteractionKind,
    ...trajectory.secondaryInteractionKinds,
  ];
  const needsObjection = kinds.some((kind) => RIYA_DATASET_OBJECTION_INTERACTION_KINDS.has(kind));
  return needsObjection
    ? [...RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS, ...RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS]
    : RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS;
}

/** Validate a whole dataset and produce a content-free release report. */
export function validateRiyaIntelligenceDataset(
  supplied: readonly RiyaIntelligenceTrajectoryV1[],
  options: ValidateRiyaDatasetOptions = {},
): RiyaDatasetReleaseReportV1 {
  // DEEP re-proof at the boundary (owner correction on PR #112). A caller can reach this function
  // with objects that never went through the trajectory constructor -- parsed from somewhere,
  // hand-assembled, or edited after construction -- and gating them would otherwise mean gating
  // whatever they claimed to be.
  const trajectories = supplied.map((trajectory) =>
    createRiyaIntelligenceTrajectory(trajectory as never),
  );
  const protectedIndex = options.protectedIndex ?? createProtectedTextIndex([]);
  const releasePolicy = options.releasePolicy;

  // ---- release binding -----------------------------------------------------------------------
  const releaseBindingFailures: RiyaDatasetReleaseBindingFailure[] = [];
  if (releasePolicy === undefined) {
    releaseBindingFailures.push('RELEASE_POLICY_MISSING');
  } else {
    if (options.protectedIndex === undefined) {
      // An empty substitute index matches nothing and yields a clean report. That is the shape of a
      // release whose exam firewall never ran.
      releaseBindingFailures.push('PROTECTED_INDEX_MISSING');
    }
    if (protectedIndex.entryCount !== releasePolicy.protectedEntryCount) {
      releaseBindingFailures.push('PROTECTED_INDEX_COUNT_MISMATCH');
    }
    if (protectedIndex.indexSha256 !== releasePolicy.protectedIndexSha256) {
      releaseBindingFailures.push('PROTECTED_INDEX_DIGEST_MISMATCH');
    }
  }

  const duplicateTrajectoryIds: RiyaDatasetFindingLocation[] = [];
  const lineageSplitViolations: RiyaDatasetFindingLocation[] = [];
  const exactCrossSplitDuplicates: RiyaDatasetFindingLocation[] = [];
  const nearCrossSplitDuplicates: RiyaDatasetFindingLocation[] = [];
  const sameSplitNearDuplicates: RiyaDatasetFindingLocation[] = [];
  const protectedExactLeakage: RiyaDatasetFindingLocation[] = [];
  const protectedNearLeakage: RiyaDatasetFindingLocation[] = [];
  const privacyViolations: (RiyaDatasetFindingLocation & { kind: string })[] = [];
  const unsupportedBusinessFacts: RiyaDatasetFindingLocation[] = [];
  const insufficientReview: RiyaDatasetFindingLocation[] = [];

  // ---- per-trajectory -----------------------------------------------------------------------
  const seenIds = new Set<string>();
  const lineageSplits = new Map<string, Set<RiyaDatasetSplit>>();
  const lineageOwner = new Map<string, string>();

  for (const trajectory of trajectories) {
    const id = trajectory.trajectoryId;
    if (seenIds.has(id)) {
      duplicateTrajectoryIds.push(Object.freeze({ trajectoryId: id }));
    }
    seenIds.add(id);

    // Lineage: every variant of one example belongs to one split, or a paraphrase of a TRAIN
    // conversation ends up scoring the model in VALIDATION.
    const splits = lineageSplits.get(trajectory.lineageRootRef) ?? new Set<RiyaDatasetSplit>();
    splits.add(trajectory.split);
    lineageSplits.set(trajectory.lineageRootRef, splits);
    const owner = lineageOwner.get(trajectory.lineageRootRef);
    if (owner === undefined) {
      lineageOwner.set(trajectory.lineageRootRef, id);
    } else if (splits.size > 1) {
      lineageSplitViolations.push(Object.freeze({ trajectoryId: id, counterpartRef: owner }));
    }

    // A training identity that sits in the exam's namespace would collide with it in every tool that
    // keys on ids, and would eventually be treated as one.
    if (
      collidesWithProtectedIdentity(protectedIndex, id) ||
      collidesWithProtectedIdentity(protectedIndex, trajectory.lineageRootRef)
    ) {
      protectedExactLeakage.push(Object.freeze({ trajectoryId: id }));
    }

    for (const turn of trajectory.turns) {
      if (turn.type === 'AUTHORITATIVE_CONTEXT') {
        for (const fact of turn.facts) {
          for (const finding of scanLocated(fact.factRef, fact.value)) {
            privacyViolations.push(
              Object.freeze({
                trajectoryId: id,
                locationRef: finding.locationRef,
                kind: finding.kind,
              }),
            );
          }
        }
        continue;
      }

      for (const finding of scanLocated(turn.turnRef, turn.text)) {
        privacyViolations.push(
          Object.freeze({ trajectoryId: id, locationRef: finding.locationRef, kind: finding.kind }),
        );
      }

      const match = matchProtectedText(protectedIndex, turn.text);
      if (match.verdict === 'EXACT') {
        protectedExactLeakage.push(
          Object.freeze({
            trajectoryId: id,
            locationRef: turn.turnRef,
            ...(match.protectedRef === undefined ? {} : { counterpartRef: match.protectedRef }),
          }),
        );
      } else if (match.verdict === 'NEAR') {
        protectedNearLeakage.push(
          Object.freeze({
            trajectoryId: id,
            locationRef: turn.turnRef,
            ...(match.protectedRef === undefined ? {} : { counterpartRef: match.protectedRef }),
          }),
        );
      }

      if (turn.type === 'ASSISTANT') {
        // The trajectory constructor already refuses a forward or dangling citation. This restates
        // the invariant at dataset level so a caller that assembled records another way -- parsed
        // JSONL, for instance -- is still gated.
        const available = new Set<string>();
        for (const earlier of trajectory.turns) {
          if (earlier.turnRef === turn.turnRef) {
            break;
          }
          if (earlier.type === 'AUTHORITATIVE_CONTEXT') {
            for (const fact of earlier.facts) {
              available.add(fact.factRef);
            }
          }
        }
        for (const ref of turn.annotation.supportedFactRefs) {
          if (!available.has(ref)) {
            unsupportedBusinessFacts.push(
              Object.freeze({ trajectoryId: id, locationRef: turn.turnRef, counterpartRef: ref }),
            );
          }
        }
      }
    }

    // Review policy.
    const accepted = trajectory.review.filter(
      (review) =>
        review.decision === 'ACCEPTED' &&
        // The author is not a reviewer. Somebody checking their own work is the failure the rule
        // exists to prevent, not an instance of it.
        review.reviewRef !== trajectory.source.sourceRef,
    );
    const required = requiredReviewDimensions(trajectory);
    const qualifying = accepted.filter((review) =>
      required.every((dimension) => review.satisfiedQualityDimensions.includes(dimension)),
    );
    if (qualifying.length < RIYA_DATASET_REQUIRED_REVIEWS[trajectory.riskClass]) {
      insufficientReview.push(Object.freeze({ trajectoryId: id }));
    }
  }

  // ---- cross-trajectory duplicates ----------------------------------------------------------
  const prepared = trajectories.map((trajectory) => {
    const normalized = spokenTurns(trajectory)
      .map((turn) => normalizeForComparison(turn.text))
      .join(' ');
    const tokens = tokenize(normalized);
    return {
      trajectory,
      fingerprint: trajectoryConversationFingerprint(trajectory),
      tokens,
      grams: new Set(ngrams(tokens, CROSS_SPLIT_NGRAM_SIZE)),
    };
  });

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i];
      const right = prepared[j];
      if (left === undefined || right === undefined) {
        continue;
      }
      const sameSplit = left.trajectory.split === right.trajectory.split;
      const location = Object.freeze({
        trajectoryId: right.trajectory.trajectoryId,
        counterpartRef: left.trajectory.trajectoryId,
      });

      if (left.fingerprint === right.fingerprint) {
        if (!sameSplit) {
          exactCrossSplitDuplicates.push(location);
        }
        continue;
      }

      const near =
        longestCommonRun(left.tokens, right.tokens) >= CROSS_SPLIT_NEAR_MIN_COMMON_RUN_TOKENS ||
        jaccard(left.grams, right.grams) >= CROSS_SPLIT_NEAR_MIN_JACCARD;
      if (!near) {
        continue;
      }
      if (sameSplit) {
        // Allowed, and REPORTED. A family of variants living together is the intended shape; it
        // still belongs in the dedupe stats so nobody discovers the redundancy after training.
        sameSplitNearDuplicates.push(location);
      } else {
        nearCrossSplitDuplicates.push(location);
      }
    }
  }

  // ---- coverage -----------------------------------------------------------------------------
  const countsByLanguage = tally(trajectories.map((one) => one.languageMode));
  const countsByPrimaryInteraction = tally(trajectories.map((one) => one.primaryInteractionKind));
  const countsByPersona = tally(trajectories.map((one) => one.persona));
  const countsByDifficulty = tally(trajectories.map((one) => one.difficulty));
  const countsByRiskClass = tally(trajectories.map((one) => one.riskClass));
  const countsBySourceKind = tally(trajectories.map((one) => one.source.kind));

  const coverageShortfalls: {
    dimension: string;
    key: string;
    observed: number;
    required: number;
  }[] = [];
  const policy = releasePolicy?.coveragePolicy;
  if (policy !== undefined) {
    const check = (
      dimension: string,
      minima: Readonly<Partial<Record<string, number>>>,
      observedCounts: Readonly<Partial<Record<string, number>>>,
    ): void => {
      for (const [key, required] of Object.entries(minima)) {
        if (required === undefined) {
          continue;
        }
        const observed = observedCounts[key] ?? 0;
        if (observed < required) {
          coverageShortfalls.push(Object.freeze({ dimension, key, observed, required }));
        }
      }
    };
    if (trajectories.length < policy.minimumTotalTrajectories) {
      coverageShortfalls.push(
        Object.freeze({
          dimension: 'TOTAL',
          key: 'TOTAL',
          observed: trajectories.length,
          required: policy.minimumTotalTrajectories,
        }),
      );
    }
    check('LANGUAGE', policy.minimumByLanguage, countsByLanguage);
    check('PRIMARY_INTERACTION', policy.minimumByPrimaryInteraction, countsByPrimaryInteraction);
    check('PERSONA', policy.minimumByPersona, countsByPersona);
    check('DIFFICULTY', policy.minimumByDifficulty, countsByDifficulty);
    check('RISK_CLASS', policy.minimumByRiskClass, countsByRiskClass);
  }

  const countsBySplit: Record<RiyaDatasetSplit, number> = { TRAIN: 0, VALIDATION: 0, HOLDOUT: 0 };
  for (const trajectory of trajectories) {
    countsBySplit[trajectory.split] += 1;
  }

  const eligible =
    trajectories.length > 0 &&
    // The release binding first: an unbound report describes a validation whose gates may not have
    // run at all, and no amount of clean findings makes that releasable.
    releaseBindingFailures.length === 0 &&
    duplicateTrajectoryIds.length === 0 &&
    lineageSplitViolations.length === 0 &&
    exactCrossSplitDuplicates.length === 0 &&
    // A quarantine is not a soft warning. Release requires it RESOLVED -- by relabelling the split,
    // merging the lineage, or rewriting the example -- so the list must be empty here.
    nearCrossSplitDuplicates.length === 0 &&
    protectedExactLeakage.length === 0 &&
    protectedNearLeakage.length === 0 &&
    privacyViolations.length === 0 &&
    unsupportedBusinessFacts.length === 0 &&
    insufficientReview.length === 0 &&
    coverageShortfalls.length === 0;

  const body = {
    version: 1 as const,
    ...(releasePolicy === undefined
      ? {}
      : {
          releasePolicyId: releasePolicy.policyId,
          releasePolicyVersion: releasePolicy.policyVersion,
          coveragePolicyId: releasePolicy.coveragePolicy.policyId,
          coveragePolicyVersion: releasePolicy.coveragePolicy.policyVersion,
          // The DIGEST too, so a policy edited in place without a version bump stops attesting.
          coveragePolicySha256: coveragePolicySha256(releasePolicy.coveragePolicy),
          protectedCorpusRef: releasePolicy.protectedCorpusRef,
          protectedIndexSha256: releasePolicy.protectedIndexSha256,
          protectedEntryCount: releasePolicy.protectedEntryCount,
        }),
    releaseBindingFailures: Object.freeze([...releaseBindingFailures].sort()),
    // Computed from the CANONICAL validated trajectories, and recomputable from a manifest's
    // records. This is what makes a report and a manifest provably the same corpus.
    validatedDatasetSha256: validatedDatasetSha256(
      trajectories.map((trajectory) => ({
        trajectoryId: trajectory.trajectoryId,
        trajectoryRevision: trajectory.trajectoryRevision,
        lineageRootRef: trajectory.lineageRootRef,
        split: trajectory.split,
        artifactSha256: trajectoryArtifactSha256(trajectory),
        normalizedFingerprint: trajectoryConversationFingerprint(trajectory),
      })),
    ),
    totalTrajectories: trajectories.length,
    totalAssistantTurns: trajectories.reduce(
      (total, one) => total + one.turns.filter((turn) => turn.type === 'ASSISTANT').length,
      0,
    ),
    countsBySplit: Object.freeze(countsBySplit),
    countsByLanguage: countsByLanguage,
    countsByPrimaryInteraction: countsByPrimaryInteraction,
    countsByPersona: countsByPersona,
    countsByDifficulty: countsByDifficulty,
    countsByRiskClass: countsByRiskClass,
    countsBySourceKind: countsBySourceKind,
    reviewedTrajectories: trajectories.length - insufficientReview.length,
    insufficientReview: Object.freeze(insufficientReview),
    duplicateTrajectoryIds: Object.freeze(duplicateTrajectoryIds),
    lineageSplitViolations: Object.freeze(lineageSplitViolations),
    exactCrossSplitDuplicates: Object.freeze(exactCrossSplitDuplicates),
    nearCrossSplitDuplicates: Object.freeze(nearCrossSplitDuplicates),
    sameSplitNearDuplicates: Object.freeze(sameSplitNearDuplicates),
    protectedExactLeakage: Object.freeze(protectedExactLeakage),
    protectedNearLeakage: Object.freeze(protectedNearLeakage),
    privacyViolations: Object.freeze(privacyViolations),
    unsupportedBusinessFacts: Object.freeze(unsupportedBusinessFacts),
    coverageShortfalls: Object.freeze(coverageShortfalls),
    eligible,
  };

  return Object.freeze({ ...body, reportSha256: reportSha256(body) });
}
