/**
 * HGV1-B — the Wave-1 micro-batch schedule (ADR-0108, post-acceptance note of 2026-09-02).
 *
 * The scheduler decides ORDER and nothing else, so most of this file is about what it must leave
 * alone. A scheduler that quietly edited an assignment would make the plan the reviewers approved
 * different from the plan the authors write against, and the difference would surface as a corpus
 * defect months later.
 *
 * The exact Batch-1 list is pinned. It is the calibration anchor: the batch whose review teaches
 * everyone what "accepted" means, so it may not drift silently under a plan change.
 */
import { describe, expect, it } from 'vitest';

import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../contracts/vocabularies.js';
import { riyaGoldV1WaveAssignments } from '../gold-v1/plan/generate-plan.js';
import {
  RIYA_GOLD_WAVE_1_ANCHOR_BATCH,
  RIYA_GOLD_WAVE_1_BATCHES,
  RIYA_GOLD_WAVE_1_BATCH_SIZE,
  riyaGoldWave1BatchAssignments,
  riyaGoldWave1BatchOf,
  riyaGoldWave1Schedule,
} from '../gold-v1/plan/wave-1-batches.js';

const WAVE_1 = riyaGoldV1WaveAssignments(1);
const SCHEDULE = riyaGoldWave1Schedule();
const FLAT = SCHEDULE.flat();

/** The owner-ratified calibration anchor. Pinned, not derived, so a plan change cannot move it quietly. */
const BATCH_1_IDS: readonly string[] = [
  'gold.v1.w1.en.discovery.01',
  'gold.v1.w1.hi.correction.02',
  'gold.v1.w1.hinglish.objection-price.01',
  'gold.v1.w1.en.objection-trust.02',
  'gold.v1.w1.hi.objection-timeline.01',
  'gold.v1.w1.hinglish.comparison.02',
  'gold.v1.w1.en.grounding-qa.01',
  'gold.v1.w1.hi.out-of-scope.02',
  'gold.v1.w1.hinglish.human-request.01',
  'gold.v1.w1.en.post-summary-qa.02',
  'gold.v1.w1.hi.complete-qa.01',
  'gold.v1.w1.hinglish.next-step.02',
];

const tally = (values: readonly (string | number)[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1;
  return counts;
};

// ---------------------------------------------------------------------------
// Shape and partition.
// ---------------------------------------------------------------------------

describe('the schedule is six batches of twelve', () => {
  it('has six batches, twelve each, seventy-two in total', () => {
    expect(RIYA_GOLD_WAVE_1_BATCHES).toHaveLength(6);
    expect(SCHEDULE).toHaveLength(6);
    for (const batch of SCHEDULE) expect(batch).toHaveLength(RIYA_GOLD_WAVE_1_BATCH_SIZE);
    expect(FLAT).toHaveLength(72);
  });

  it('covers every Wave-1 assignment exactly once — no invention, no omission', () => {
    const scheduled = FLAT.map((one) => one.assignmentId).sort();
    const official = WAVE_1.map((one) => one.assignmentId).sort();

    expect(scheduled).toStrictEqual(official);
    expect(new Set(scheduled).size).toBe(72);
  });

  it('is deterministic — a second call produces the identical schedule', () => {
    const again = riyaGoldWave1Schedule();

    expect(again.map((b) => b.map((a) => a.assignmentId))).toStrictEqual(
      SCHEDULE.map((b) => b.map((a) => a.assignmentId)),
    );
  });
});

// ---------------------------------------------------------------------------
// The assignments themselves must come through untouched.
// ---------------------------------------------------------------------------

describe('the scheduler changes order and nothing else', () => {
  it('returns each official assignment field-for-field', () => {
    const byId = new Map(WAVE_1.map((one) => [one.assignmentId, one]));

    for (const scheduled of FLAT) {
      const official = byId.get(scheduled.assignmentId);
      expect(official, scheduled.assignmentId).toBeDefined();
      // Deep equality over the whole record: id, wave, split, language, kind, ordinal, persona,
      // difficulty, risk, phase, depth, authority classes, secondary kinds and forbidden patterns.
      expect(scheduled).toStrictEqual(official);
    }
  });

  it('returns frozen batches, so a caller cannot reorder the schedule in place', () => {
    // Reference identity across calls is deliberately NOT asserted: the plan generator builds fresh
    // objects per call, so two calls are structurally equal without being the same object. What
    // matters is that a caller cannot mutate what it is handed.
    expect(Object.isFrozen(SCHEDULE)).toBe(true);
    for (const batch of SCHEDULE) expect(Object.isFrozen(batch)).toBe(true);
    for (const assignment of FLAT) expect(Object.isFrozen(assignment)).toBe(true);
  });

  it('adds no schedule-only field to an assignment', () => {
    const officialKeys = Object.keys(WAVE_1[0] ?? {}).sort();

    for (const scheduled of FLAT) {
      expect(Object.keys(scheduled).sort()).toStrictEqual(officialKeys);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-section: every batch is a miniature of the wave.
// ---------------------------------------------------------------------------

describe('every batch is a balanced cross-section', () => {
  it('carries all twelve interaction kinds exactly once', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      const kinds = batch.map((one) => one.primaryInteractionKind).sort();
      expect(kinds, `batch ${String(index + 1)}`).toStrictEqual(
        [...RIYA_DATASET_INTERACTION_KINDS].sort(),
      );
    }
  });

  it('carries four assignments per language', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      const languages = tally(batch.map((one) => one.languageMode));
      for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
        expect(languages[languageMode], `batch ${String(index + 1)} ${languageMode}`).toBe(4);
      }
    }
  });

  it('carries both ordinal styles, six and six', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      const ordinals = tally(batch.map((one) => one.ordinalWithinPair));
      expect(ordinals, `batch ${String(index + 1)}`).toStrictEqual({ '1': 6, '2': 6 });
    }
  });

  it('contains at least one HARD or EDGE assignment', () => {
    // The point of the rotation: nobody gets a batch of twelve easy conversations and concludes the
    // corpus is easy.
    for (const [index, batch] of SCHEDULE.entries()) {
      const stretching = batch.filter(
        (one) => one.difficulty === 'HARD' || one.difficulty === 'EDGE',
      );
      expect(stretching.length, `batch ${String(index + 1)}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Pair placement.
// ---------------------------------------------------------------------------

describe('the two ordinals of a pair are three batches apart', () => {
  it('places every language/kind pair as {1,2} exactly three batches apart', () => {
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        const placements = SCHEDULE.flatMap((batch, index) =>
          batch
            .filter(
              (one) => one.languageMode === languageMode && one.primaryInteractionKind === kind,
            )
            .map((one) => ({ batch: index + 1, ordinal: one.ordinalWithinPair })),
        );

        const label = `${languageMode}/${kind}`;
        expect(placements, label).toHaveLength(2);
        expect(placements.map((p) => p.ordinal).sort(), label).toStrictEqual([1, 2]);

        const [first, second] = placements.map((p) => p.batch).sort((a, b) => a - b);
        expect(Math.abs((second ?? 0) - (first ?? 0)), label).toBe(3);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The calibration anchor.
// ---------------------------------------------------------------------------

describe('Batch 1 is the pinned calibration anchor', () => {
  const anchor = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);

  it('is exactly the owner-ratified twelve, in order', () => {
    expect(anchor.map((one) => one.assignmentId)).toStrictEqual(BATCH_1_IDS);
  });

  it('mixes difficulty rather than front-loading the easy work', () => {
    expect(tally(anchor.map((one) => one.difficulty))).toStrictEqual({
      BASIC: 3,
      STANDARD: 3,
      HARD: 4,
      EDGE: 2,
    });
  });

  it('carries three high-risk cases, so reviewers calibrate on them early', () => {
    expect(tally(anchor.map((one) => one.riskClass))).toStrictEqual({
      STANDARD: 9,
      HIGH_RISK: 3,
    });
  });

  it('spans several start phases and personas', () => {
    expect(new Set(anchor.map((one) => one.startPhase)).size).toBeGreaterThan(1);
    expect(new Set(anchor.map((one) => one.persona)).size).toBeGreaterThan(1);
  });

  it('spans shallow and deep conversations', () => {
    const depths = anchor.map((one) => one.targetAssistantTurns);
    expect(Math.min(...depths)).toBeLessThan(Math.max(...depths));
  });

  it('includes a secondary interaction and an authority-bearing assignment', () => {
    expect(anchor.some((one) => one.requiredSecondaryKinds.length > 0)).toBe(true);
    expect(anchor.some((one) => one.requiredAuthorityFactClasses.length > 0)).toBe(true);
  });

  it('uses REPAIRED main: slot 8 carries PROCESS behind its GROUNDING_QA', () => {
    // The direct proof that the schedule is derived from post-repair source. Before PR #186 this
    // assignment required GROUNDING_QA with no authority class at all, and an author handed this
    // batch could not have grounded the answer.
    const slot8 = anchor[7];

    expect(slot8?.assignmentId).toBe('gold.v1.w1.hi.out-of-scope.02');
    expect(slot8?.primaryInteractionKind).toBe('OUT_OF_SCOPE');
    expect(slot8?.requiredSecondaryKinds).toContain('GROUNDING_QA');
    expect(slot8?.requiredAuthorityFactClasses).toStrictEqual(['PROCESS']);
  });
});

// ---------------------------------------------------------------------------
// Lookup.
// ---------------------------------------------------------------------------

describe('batchOf answers only for Wave 1', () => {
  it('finds the batch of every scheduled assignment', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      for (const assignment of batch) {
        expect(riyaGoldWave1BatchOf(assignment.assignmentId)).toBe(index + 1);
      }
    }
  });

  it('returns undefined for an assignment of another wave', () => {
    // A fair question with a fair answer. Only Wave 1 is scheduled.
    expect(riyaGoldWave1BatchOf('gold.v1.w3.en.discovery.01')).toBeUndefined();
  });

  it('returns undefined for nonsense', () => {
    expect(riyaGoldWave1BatchOf('')).toBeUndefined();
    expect(riyaGoldWave1BatchOf('not-an-assignment-id')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Containment: a schedule is not a corpus.
// ---------------------------------------------------------------------------

describe('the schedule carries no dialogue and no brief prose', () => {
  it('serializes to assignment metadata only', () => {
    const serialized = JSON.stringify(SCHEDULE);

    for (const forbidden of [
      'Customer:',
      'Riya:',
      '"USER"',
      '"ASSISTANT"',
      'customerSituation',
      'conversationGoal',
      'turns',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('exposes no field that could hold a sentence', () => {
    // Structural, not lexical: if no field can hold prose, no prose can arrive in one later.
    for (const assignment of FLAT) {
      for (const [key, value] of Object.entries(assignment)) {
        if (typeof value !== 'string') continue;
        // Ids, closed codes and refs only — none of them contain a space, and a sentence does.
        expect(value.includes(' '), `${assignment.assignmentId}.${key}`).toBe(false);
      }
    }
  });
});
