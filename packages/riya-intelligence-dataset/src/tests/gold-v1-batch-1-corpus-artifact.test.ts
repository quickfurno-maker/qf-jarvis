/**
 * HGV1-B — the Batch-1 Human Gold corpus artifact and its acceptance harness.
 *
 * ### What this file is for
 *
 * `data/human-gold-v1/wave-1/batch-1.jsonl` is where human authors put real Gold trajectories. This
 * test is the gate that file passes through on every CI run: it reads the committed artifact,
 * re-proves every line through the canonical trajectory parser, and validates the rows against the
 * Batch-1 assignments they claim to fulfil.
 *
 * ### Filesystem I/O lives here, not in the package
 *
 * `src/service/jsonl.ts` deliberately has no filesystem access — serialising a trajectory and knowing
 * where trajectories are stored are different responsibilities, and giving the package a file reader
 * would make it something a runtime could point at a directory. So the harness owns the `readFileSync`
 * and the package stays pure.
 *
 * ### Nothing here re-implements a validator
 *
 * Every rule that can be delegated is delegated: {@link parseRiyaTrajectoryJsonlLine} re-proves each
 * record through `createRiyaIntelligenceTrajectory`, {@link validateRiyaGoldV1Corpus} runs the full
 * RID-F1 gate plus the Gold matrix, and the allowed slots come from the scheduler rather than a second
 * hard-coded list. What this file adds is only the part nothing else can know: **which file**, **which
 * batch**, and **what an incomplete authoring state legitimately looks like.**
 *
 * ### The empty state is a real state
 *
 * At the scaffold commit the file is zero bytes, and that is correct: JSONL is data, not
 * documentation, so the first line in it must be a real human-authored trajectory rather than a
 * placeholder somebody later forgets to delete. Zero records means **authoring has not started** — not
 * eligible, not calibrated, and producing no release evidence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RIYA_GOLD_WAVE_1_ANCHOR_BATCH,
  riyaGoldWave1BatchAssignments,
} from '../gold-v1/plan/wave-1-batches.js';
import { riyaGoldV1WaveAssignments } from '../gold-v1/plan/generate-plan.js';
import { validateRiyaGoldV1Corpus } from '../gold-v1/service/validate-corpus.js';
import {
  parseRiyaTrajectoryJsonlLine,
  serializeRiyaTrajectoryJsonlLine,
} from '../service/jsonl.js';
import type { RiyaDatasetFindingLocation } from '../contracts/report.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_PATH = join(PKG, 'data', 'human-gold-v1', 'wave-1', 'batch-1.jsonl');

/** The only slots open for authoring. Derived from the scheduler, never a second hard-coded list. */
const BATCH_1 = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);
const BATCH_1_IDS = new Set(BATCH_1.map((one) => one.assignmentId));

const RAW = readFileSync(CORPUS_PATH, 'utf8');

/** One trajectory per non-empty line. Blank lines are ignored; anything else must parse. */
const LINES: readonly string[] = RAW.split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const TRAJECTORIES: readonly RiyaIntelligenceTrajectoryV1[] = LINES.map((line) =>
  // The trust boundary. NOT JSON.parse: this re-proves the whole record through the trajectory
  // constructor, so a structurally plausible but invalid row cannot enter the corpus.
  parseRiyaTrajectoryJsonlLine(line),
);

/**
 * The assignments actually attempted so far.
 *
 * Deliberately the subset, not all twelve. Passing the full anchor while three rows exist would
 * report nine `ASSIGNMENT_UNFULFILLED` findings on every commit during incremental authoring, and a
 * gate that is always red teaches people to ignore it. When the twelfth row lands this set becomes the
 * complete anchor on its own.
 */
const PRESENT_ASSIGNMENTS = BATCH_1.filter((assignment) =>
  TRAJECTORIES.some((trajectory) => trajectory.trajectoryId === assignment.assignmentId),
);

/**
 * Findings that mean the DATA is wrong, as opposed to the release binding being absent.
 *
 * An authoring dry run has no release policy and no protected index, so `eligible` and `goldEligible`
 * are legitimately false and `releaseBindingFailures` is legitimately non-empty. That is not a data
 * defect and asserting `goldEligible === true` here would either fail forever or push somebody to fake
 * a policy. Everything below, by contrast, is a real problem with an authored row.
 */
function substantiveFailures(
  report: ReturnType<typeof validateRiyaGoldV1Corpus>,
): readonly string[] {
  const dataset = report.datasetReport;
  const problems: string[] = [];

  // A finding is keyed by the trajectory it belongs to. `locationRef` is an optional narrower
  // pointer (a turn or fact ref) and is deliberately not required here.
  const push = (label: string, locations: readonly RiyaDatasetFindingLocation[]): void => {
    for (const location of locations) problems.push(`${label}:${location.trajectoryId}`);
  };

  push('INSUFFICIENT_REVIEW', dataset.insufficientReview);
  push('DUPLICATE_TRAJECTORY_ID', dataset.duplicateTrajectoryIds);
  push('LINEAGE_SPLIT_VIOLATION', dataset.lineageSplitViolations);
  push('EXACT_CROSS_SPLIT_DUPLICATE', dataset.exactCrossSplitDuplicates);
  push('NEAR_CROSS_SPLIT_DUPLICATE', dataset.nearCrossSplitDuplicates);
  // `sameSplitNearDuplicates` is DELIBERATELY absent. RID-F1 calls that category "Allowed, and
  // REPORTED -- a family of variants living together is the intended shape", and it is the one
  // duplicate list the canonical `eligible` expression omits. Promoting it to a blocker here would
  // make this harness a stricter shadow policy than the validator it is supposed to reuse, and would
  // reject a legitimate corpus shape. It stays available as reporting and calibration evidence.
  push('PROTECTED_EXACT_LEAKAGE', dataset.protectedExactLeakage);
  push('PROTECTED_NEAR_LEAKAGE', dataset.protectedNearLeakage);
  push('UNSUPPORTED_BUSINESS_FACT', dataset.unsupportedBusinessFacts);
  // Privacy findings carry a `kind` and never the matched value.
  for (const violation of dataset.privacyViolations) {
    problems.push(`PRIVACY:${violation.kind}:${violation.trajectoryId}`);
  }
  // EVERY Gold matrix finding is substantive, `ASSIGNMENT_UNFULFILLED` included.
  //
  // It is tempting to tolerate that one during incremental authoring, but the subset design already
  // makes it impossible: `PRESENT_ASSIGNMENTS` is built from the trajectories that exist, so an
  // assignment with no row is never passed to the validator in the first place. If it appears anyway,
  // something is wrong -- a subset-selection regression, a validator integration bug, or a broken
  // assignment-to-trajectory mapping -- and ignoring it would hide exactly the class of defect this
  // harness exists to catch.
  for (const finding of report.findings) {
    const where: string = finding.locationRef ?? '';
    problems.push(`${finding.reason}:${where}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The artifact.
// ---------------------------------------------------------------------------

describe('the canonical Batch-1 corpus file', () => {
  it('exists and is readable', () => {
    expect(typeof RAW).toBe('string');
  });

  it('holds no more than the twelve authorized slots', () => {
    expect(TRAJECTORIES.length).toBeLessThanOrEqual(12);
  });

  it('every line parses through the canonical trajectory parser', () => {
    // Already enforced at module load — a bad line throws before any test runs. Restated so the
    // guarantee is visible in the report rather than implied by an import.
    expect(TRAJECTORIES).toHaveLength(LINES.length);
  });

  it('carries one trajectory per non-empty line', () => {
    expect(new Set(TRAJECTORIES.map((one) => one.trajectoryId)).size).toBe(TRAJECTORIES.length);
  });
});

describe('the authoring state', () => {
  it('reports honestly whether authoring has started', () => {
    if (TRAJECTORIES.length === 0) {
      // The scaffold state. Not eligible, not calibrated, no release evidence — and correct.
      expect(PRESENT_ASSIGNMENTS).toHaveLength(0);
      return;
    }
    expect(PRESENT_ASSIGNMENTS.length).toBe(TRAJECTORIES.length);
  });
});

// ---------------------------------------------------------------------------
// Every row that IS present must be a lawful Batch-1 row.
// ---------------------------------------------------------------------------

describe('every authored row belongs to Batch 1 and is human-authored', () => {
  it('claims only an open Batch-1 slot', () => {
    const outside = TRAJECTORIES.map((one) => one.trajectoryId).filter(
      (id) => !BATCH_1_IDS.has(id),
    );

    expect(outside).toStrictEqual([]);
  });

  it('claims no Wave-1 slot from a later, still-blocked batch', () => {
    const laterBatchIds = new Set(
      riyaGoldV1WaveAssignments(1)
        .map((one) => one.assignmentId)
        .filter((id) => !BATCH_1_IDS.has(id)),
    );
    const trespassers = TRAJECTORIES.map((one) => one.trajectoryId).filter((id) =>
      laterBatchIds.has(id),
    );

    expect(trespassers).toStrictEqual([]);
  });

  it('uses the assignment id as the trajectory id', () => {
    // One row fulfils one slot, and the id says which. Without this the corpus and the plan can only
    // be related by guesswork.
    for (const trajectory of TRAJECTORIES) {
      expect(BATCH_1_IDS.has(trajectory.trajectoryId), trajectory.trajectoryId).toBe(true);
    }
  });

  it('is HUMAN_AUTHORED_SYNTHETIC with no teacher', () => {
    for (const trajectory of TRAJECTORIES) {
      expect(trajectory.source.kind, trajectory.trajectoryId).toBe('HUMAN_AUTHORED_SYNTHETIC');
      expect(trajectory.source.teacherRef, trajectory.trajectoryId).toBeUndefined();
      expect(typeof trajectory.source.sourceRef).toBe('string');
      expect(trajectory.source.sourceRef.length).toBeGreaterThan(0);
    }
  });

  it('is stored in canonical serialization', () => {
    // The committed bytes must be what the serializer produces. Otherwise two identical trajectories
    // could differ on disk, and a diff would show churn that means nothing.
    for (const [index, trajectory] of TRAJECTORIES.entries()) {
      expect(serializeRiyaTrajectoryJsonlLine(trajectory), trajectory.trajectoryId).toBe(
        LINES[index],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The Gold gate itself, delegated.
// ---------------------------------------------------------------------------

describe('the authored subset passes the Gold validator', () => {
  it('has no substantive data failure', () => {
    const report = validateRiyaGoldV1Corpus(TRAJECTORIES, PRESENT_ASSIGNMENTS);

    // Insufficient review is INCLUDED here on purpose. A row awaiting its independent review fails
    // this gate, and an authoring PR may legitimately be red until the review is attached.
    expect(substantiveFailures(report)).toStrictEqual([]);
  });

  it('matches every present assignment when rows exist', () => {
    const report = validateRiyaGoldV1Corpus(TRAJECTORIES, PRESENT_ASSIGNMENTS);

    expect(report.matchedAssignments).toBe(PRESENT_ASSIGNMENTS.length);
  });

  it('does not claim release eligibility from an authoring dry run', () => {
    // No release policy and no protected index are bound here, so eligibility is not this harness's
    // to assert. Claiming it would be the one shortcut that actually matters.
    const report = validateRiyaGoldV1Corpus(TRAJECTORIES, PRESENT_ASSIGNMENTS);

    expect(report.datasetReport.releasePolicyId).toBeUndefined();
    expect(report.datasetReport.protectedIndexSha256).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Harness self-proof — no dialogue is authored to test the gate.
// ---------------------------------------------------------------------------

describe('the harness policy is the strict one', () => {
  it('treats insufficient review as a blocker, not a warning', () => {
    const report = {
      datasetReport: {
        insufficientReview: [{ trajectoryId: 'gold.v1.w1.en.discovery.01' }],
        duplicateTrajectoryIds: [],
        lineageSplitViolations: [],
        exactCrossSplitDuplicates: [],
        nearCrossSplitDuplicates: [],
        sameSplitNearDuplicates: [],
        protectedExactLeakage: [],
        protectedNearLeakage: [],
        unsupportedBusinessFacts: [],
        privacyViolations: [],
      },
      findings: [],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    expect(substantiveFailures(report)).toStrictEqual([
      'INSUFFICIENT_REVIEW:gold.v1.w1.en.discovery.01',
    ]);
  });

  it('treats a non-human source as a blocker', () => {
    const report = {
      datasetReport: {
        insufficientReview: [],
        duplicateTrajectoryIds: [],
        lineageSplitViolations: [],
        exactCrossSplitDuplicates: [],
        nearCrossSplitDuplicates: [],
        sameSplitNearDuplicates: [],
        protectedExactLeakage: [],
        protectedNearLeakage: [],
        unsupportedBusinessFacts: [],
        privacyViolations: [],
      },
      findings: [{ reason: 'NOT_HUMAN_AUTHORED', locationRef: 'gold.v1.w1.en.discovery.01' }],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    expect(substantiveFailures(report)).toStrictEqual([
      'NOT_HUMAN_AUTHORED:gold.v1.w1.en.discovery.01',
    ]);
  });

  it('treats ASSIGNMENT_UNFULFILLED as a blocker, because the subset makes it impossible', () => {
    // `PRESENT_ASSIGNMENTS` only ever contains assignments that HAVE a row, so this finding cannot
    // arise from ordinary incremental authoring. If it shows up, the subset selection or the
    // validator integration is broken, and that must fail rather than be waved through.
    const base = {
      insufficientReview: [],
      duplicateTrajectoryIds: [],
      lineageSplitViolations: [],
      exactCrossSplitDuplicates: [],
      nearCrossSplitDuplicates: [],
      sameSplitNearDuplicates: [],
      protectedExactLeakage: [],
      protectedNearLeakage: [],
      unsupportedBusinessFacts: [],
      privacyViolations: [],
    };
    const unfulfilled = {
      datasetReport: base,
      findings: [{ reason: 'ASSIGNMENT_UNFULFILLED', locationRef: 'gold.v1.w1.hi.complete-qa.01' }],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;
    const authorityUnused = {
      datasetReport: base,
      findings: [
        { reason: 'REQUIRED_AUTHORITY_CLASS_UNUSED', locationRef: 'gold.v1.w1.hi.out-of-scope.02' },
      ],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    expect(substantiveFailures(unfulfilled)).toStrictEqual([
      'ASSIGNMENT_UNFULFILLED:gold.v1.w1.hi.complete-qa.01',
    ]);
    expect(substantiveFailures(authorityUnused)).toStrictEqual([
      'REQUIRED_AUTHORITY_CLASS_UNUSED:gold.v1.w1.hi.out-of-scope.02',
    ]);
  });

  it('leaves same-split near duplicates as REPORT-ONLY, matching RID-F1', () => {
    // The category RID-F1 allows on purpose: a family of variants sharing a split is the intended
    // shape, and it is the one duplicate list the canonical `eligible` expression omits. A harness
    // that blocked on it would be stricter than the validator it reuses.
    const report = {
      datasetReport: {
        insufficientReview: [],
        duplicateTrajectoryIds: [],
        lineageSplitViolations: [],
        exactCrossSplitDuplicates: [],
        nearCrossSplitDuplicates: [],
        sameSplitNearDuplicates: [{ trajectoryId: 'gold.v1.w1.en.discovery.01' }],
        protectedExactLeakage: [],
        protectedNearLeakage: [],
        unsupportedBusinessFacts: [],
        privacyViolations: [],
      },
      findings: [],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    expect(substantiveFailures(report)).toStrictEqual([]);
  });

  it('still blocks the two duplicate categories that ARE eligibility blockers', () => {
    // Same-split being report-only must not soften its cross-split neighbours, which the canonical
    // `eligible` expression does require to be empty.
    const base = {
      insufficientReview: [],
      duplicateTrajectoryIds: [],
      lineageSplitViolations: [],
      exactCrossSplitDuplicates: [],
      nearCrossSplitDuplicates: [],
      sameSplitNearDuplicates: [],
      protectedExactLeakage: [],
      protectedNearLeakage: [],
      unsupportedBusinessFacts: [],
      privacyViolations: [],
    };
    const exact = {
      datasetReport: { ...base, exactCrossSplitDuplicates: [{ trajectoryId: 'a' }] },
      findings: [],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;
    const near = {
      datasetReport: { ...base, nearCrossSplitDuplicates: [{ trajectoryId: 'b' }] },
      findings: [],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    expect(substantiveFailures(exact)).toStrictEqual(['EXACT_CROSS_SPLIT_DUPLICATE:a']);
    expect(substantiveFailures(near)).toStrictEqual(['NEAR_CROSS_SPLIT_DUPLICATE:b']);
  });

  it('reports a privacy finding by kind, never by value', () => {
    const report = {
      datasetReport: {
        insufficientReview: [],
        duplicateTrajectoryIds: [],
        lineageSplitViolations: [],
        exactCrossSplitDuplicates: [],
        nearCrossSplitDuplicates: [],
        sameSplitNearDuplicates: [],
        protectedExactLeakage: [],
        protectedNearLeakage: [],
        unsupportedBusinessFacts: [],
        privacyViolations: [{ kind: 'PHONE', trajectoryId: 'gold.v1.w1.en.discovery.01' }],
      },
      findings: [],
    } as unknown as ReturnType<typeof validateRiyaGoldV1Corpus>;

    const failures = substantiveFailures(report);
    expect(failures).toStrictEqual(['PRIVACY:PHONE:gold.v1.w1.en.discovery.01']);
    // A closed code and a location. The matched text never appears.
    expect(failures.join('')).not.toContain('+');
  });
});

describe('the allowed-slot set comes from the scheduler', () => {
  it('is exactly the twelve anchor assignments', () => {
    expect(BATCH_1).toHaveLength(12);
    expect(BATCH_1_IDS.size).toBe(12);
  });

  it('excludes every other Wave-1 slot', () => {
    const wave1 = riyaGoldV1WaveAssignments(1);

    expect(wave1).toHaveLength(72);
    expect(wave1.filter((one) => BATCH_1_IDS.has(one.assignmentId))).toHaveLength(12);
  });

  it('is not a second hard-coded list — it tracks the scheduler', () => {
    // Re-derived, so a scheduler change moves the gate with it rather than leaving the corpus open to
    // slots the schedule no longer contains.
    const again = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);

    expect(again.map((one) => one.assignmentId)).toStrictEqual(
      BATCH_1.map((one) => one.assignmentId),
    );
  });
});
