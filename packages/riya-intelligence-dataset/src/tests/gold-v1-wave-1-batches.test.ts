/**
 * HGV1-B — the six-micro-batch Wave-1 authoring schedule.
 *
 * The schedule is operational, so the thing worth proving is that it is operational and nothing more:
 * it partitions the frozen 72 exactly, it hands the assignments back unedited, and it changes no plan.
 *
 * The anchor batch gets its own block because it is load-bearing. Twelve conversations decide whether
 * the other sixty get written, so an anchor that under-samples the hard cases answers a question
 * nobody asked — which is exactly what the first schedule did, and why the ordinal now alternates.
 */
import { describe, expect, it } from 'vitest';

import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../contracts/vocabularies.js';
import {
  generateRiyaGoldV1Plan,
  riyaGoldV1WaveAssignments,
} from '../gold-v1/plan/generate-plan.js';
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

const tally = (xs: readonly string[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }), {});

describe('the Wave-1 schedule partitions the frozen 72 and invents nothing', () => {
  it('is six batches of twelve', () => {
    expect(RIYA_GOLD_WAVE_1_BATCHES).toHaveLength(6);
    expect(SCHEDULE).toHaveLength(6);
    for (const batch of SCHEDULE) {
      expect(batch).toHaveLength(RIYA_GOLD_WAVE_1_BATCH_SIZE);
    }
    expect(SCHEDULE.flat()).toHaveLength(72);
  });

  it('covers every official Wave-1 assignment EXACTLY once', () => {
    const scheduled = SCHEDULE.flat().map((one) => one.assignmentId);
    expect(new Set(scheduled).size).toBe(72);
    expect([...scheduled].sort()).toStrictEqual(WAVE_1.map((one) => one.assignmentId).sort());
  });

  it('hands back the frozen assignments unchanged — no edit, no mutation', () => {
    // Field for field, against the plan. A schedule that adjusted anything on its way past would be
    // a second planning authority, and the two would drift.
    const byId = new Map(WAVE_1.map((one) => [one.assignmentId, one]));
    for (const assignment of SCHEDULE.flat()) {
      expect(byId.get(assignment.assignmentId), assignment.assignmentId).toStrictEqual(assignment);
      expect(Object.isFrozen(assignment)).toBe(true);
    }
    // And the plan itself is untouched by having been scheduled.
    expect(generateRiyaGoldV1Plan()).toHaveLength(360);
    expect(riyaGoldV1WaveAssignments(1)).toStrictEqual(WAVE_1);
  });

  it('gives every batch all twelve interaction kinds, once each', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      const kinds = batch.map((one) => one.primaryInteractionKind);
      expect(new Set(kinds).size, `batch ${String(index + 1)}`).toBe(12);
      expect([...kinds].sort()).toStrictEqual([...RIYA_DATASET_INTERACTION_KINDS].sort());
    }
  });

  it('gives every batch four of each language', () => {
    for (const [index, batch] of SCHEDULE.entries()) {
      const counts = tally(batch.map((one) => one.languageMode));
      for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
        expect(counts[languageMode] ?? 0, `batch ${String(index + 1)}/${languageMode}`).toBe(4);
      }
    }
  });

  it('places each language/kind pair in two batches, three apart, one 01 and one 02', () => {
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        const placements = SCHEDULE.flatMap((batch, index) =>
          batch
            .filter(
              (one) => one.languageMode === languageMode && one.primaryInteractionKind === kind,
            )
            .map((one) => ({ batch: index + 1, ordinal: one.ordinalWithinPair })),
        );
        expect(placements, `${languageMode}/${kind}`).toHaveLength(2);
        const [first, second] = placements;
        // Both takes exist exactly once. Which one comes first is now a property of the kind's
        // parity rather than of the batch, which is what mixes difficulty into every batch.
        expect(
          [first?.ordinal, second?.ordinal].sort(),
          `${languageMode}/${kind} ordinals`,
        ).toStrictEqual([1, 2]);
        expect((second?.batch ?? 0) - (first?.batch ?? 0)).toBe(3);
      }
    }
  });

  it('is deterministic', () => {
    expect(riyaGoldWave1Schedule()).toStrictEqual(SCHEDULE);
    expect(riyaGoldWave1BatchAssignments(1)).toStrictEqual(SCHEDULE[0]);
  });

  it('reports which batch a slot belongs to, and nothing for a slot outside Wave 1', () => {
    const first = SCHEDULE[0]?.[0];
    expect(first).toBeDefined();
    expect(riyaGoldWave1BatchOf(first?.assignmentId ?? '')).toBe(1);
    expect(riyaGoldWave1BatchOf('gold.v1.w3.hi.comparison.01')).toBeUndefined();
    expect(riyaGoldWave1BatchOf('nonsense')).toBeUndefined();
  });
});

describe('the anchor batch samples the hard work too', () => {
  const ANCHOR = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);

  it('is exactly the twelve slots the owner fixed', () => {
    expect(RIYA_GOLD_WAVE_1_ANCHOR_BATCH).toBe(1);
    expect(ANCHOR.map((one) => one.assignmentId)).toStrictEqual([
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
    ]);
  });

  it('carries the intended calibration difficulty mix: 3 BASIC, 3 STANDARD, 4 HARD, 2 EDGE', () => {
    // The whole reason the ordinal alternates. Under the previous schedule this batch was 4 BASIC and
    // 8 STANDARD, and the first HARD conversation was written in batch 4 — too late for an anchor.
    expect(tally(ANCHOR.map((one) => one.difficulty))).toStrictEqual({
      BASIC: 3,
      STANDARD: 3,
      HARD: 4,
      EDGE: 2,
    });
  });

  it('carries 9 STANDARD-risk and 3 HIGH_RISK slots', () => {
    expect(tally(ANCHOR.map((one) => one.riskClass))).toStrictEqual({
      STANDARD: 9,
      HIGH_RISK: 3,
    });
  });

  it('mixes both takes rather than being all first drafts', () => {
    const ordinals = tally(ANCHOR.map((one) => String(one.ordinalWithinPair)));
    expect(ordinals['1']).toBe(6);
    expect(ordinals['2']).toBe(6);
  });

  it('spreads language, persona, start phase and depth', () => {
    expect(new Set(ANCHOR.map((one) => one.languageMode)).size).toBe(3);
    expect(new Set(ANCHOR.map((one) => one.persona)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(ANCHOR.map((one) => one.startPhase)).size).toBeGreaterThanOrEqual(4);
    const depths = ANCHOR.map((one) => one.targetAssistantTurns);
    expect(Math.min(...depths)).toBeLessThanOrEqual(5);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(8);
  });

  it('exercises the two-reviewer path, secondary interactions and business-fact authority', () => {
    expect(ANCHOR.filter((one) => one.riskClass === 'HIGH_RISK').length).toBe(3);
    expect(ANCHOR.some((one) => one.requiredSecondaryKinds.length > 0)).toBe(true);
    expect(ANCHOR.some((one) => one.requiredAuthorityFactClasses.length > 0)).toBe(true);
  });

  it('every batch now carries at least one HARD or EDGE slot', () => {
    // Not just the anchor. Whoever picks up batch 3 gets hard work too.
    for (const batch of RIYA_GOLD_WAVE_1_BATCHES) {
      const difficulties = new Set(
        riyaGoldWave1BatchAssignments(batch).map((one) => one.difficulty),
      );
      expect(difficulties.has('HARD') || difficulties.has('EDGE'), `batch ${String(batch)}`).toBe(
        true,
      );
    }
  });
});

describe('the schedule is content-free', () => {
  it('exposes assignments only — no brief prose and no dialogue', () => {
    const serialized = JSON.stringify(SCHEDULE);
    for (const shape of ['"type":"USER"', '"type":"ASSISTANT"', 'turnRef', 'customerSituation']) {
      expect(serialized, shape).not.toContain(shape);
    }
    for (const assignment of SCHEDULE.flat()) {
      expect(Object.keys(assignment)).not.toContain('customerSituation');
      expect(Object.keys(assignment)).not.toContain('text');
    }
  });
});
