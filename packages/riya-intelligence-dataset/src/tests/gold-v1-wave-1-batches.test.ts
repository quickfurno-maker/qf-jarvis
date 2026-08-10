/**
 * HGV1-B — the six-micro-batch Wave-1 authoring schedule.
 *
 * The schedule is operational, so the thing worth proving is that it is operational and nothing more:
 * it partitions the frozen 72 exactly, it hands back the identical assignment objects, and it changes
 * no plan.
 *
 * The anchor-batch properties get their own specs because the anchor is load-bearing. Twelve
 * conversations decide whether the other sixty get written, and an anchor that was accidentally
 * twelve English discovery cases would answer a question nobody asked.
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

  it('spreads each language/kind pair across two batches, ordinal 01 first', () => {
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
        expect(first?.ordinal).toBe(1);
        expect(second?.ordinal).toBe(2);
        // Three batches apart: the pair is never written back to back by the same hand.
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

describe('the anchor batch is a miniature of the wave, not a corner of it', () => {
  const ANCHOR = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);

  it('is batch 1, and every slot in it is a first take', () => {
    expect(RIYA_GOLD_WAVE_1_ANCHOR_BATCH).toBe(1);
    for (const assignment of ANCHOR) {
      expect(assignment.ordinalWithinPair, assignment.assignmentId).toBe(1);
    }
  });

  it('carries a real spread of language, persona, start phase and depth', () => {
    expect(new Set(ANCHOR.map((one) => one.languageMode)).size).toBe(3);
    expect(new Set(ANCHOR.map((one) => one.persona)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(ANCHOR.map((one) => one.startPhase)).size).toBeGreaterThanOrEqual(4);
    const depths = ANCHOR.map((one) => one.targetAssistantTurns);
    expect(Math.min(...depths)).toBeLessThanOrEqual(5);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(8);
  });

  it('exercises the two-reviewer path and the business-fact path', () => {
    expect(ANCHOR.filter((one) => one.riskClass === 'HIGH_RISK').length).toBeGreaterThanOrEqual(2);
    expect(ANCHOR.some((one) => one.riskClass === 'STANDARD')).toBe(true);
    expect(ANCHOR.some((one) => one.requiredAuthorityFactClasses.length > 0)).toBe(true);
  });

  it('KNOWN LIMITATION: batches 1–3 carry no HARD and no EDGE slot', () => {
    // Not a defect in the schedule — a consequence of the two rules meeting. HGV1-A makes difficulty
    // a property of the ORDINAL (slot shape 1 is the gentler take, shape 2 the harder one), and the
    // HGV1-B allocation gives batches 1–3 every ordinal 01 and batches 4–6 every ordinal 02.
    //
    // So the calibration anchor sees BASIC and STANDARD only, and the first HARD or EDGE conversation
    // is written in batch 4 — after sixty others. If Wave 1 has a systemic problem specific to hard
    // scenarios, this anchor cannot surface it, which is worth knowing before relying on it.
    //
    // This spec exists so the limitation is visible rather than discovered. Changing it is an owner
    // decision: alternating the ordinal by kind index would mix difficulty into every batch and keeps
    // every property proved above.
    for (const batch of [1, 2, 3] as const) {
      const difficulties = new Set(
        riyaGoldWave1BatchAssignments(batch).map((one) => one.difficulty),
      );
      expect([...difficulties].sort(), `batch ${String(batch)}`).toStrictEqual([
        'BASIC',
        'STANDARD',
      ]);
    }
    for (const batch of [4, 5, 6] as const) {
      const difficulties = new Set(
        riyaGoldWave1BatchAssignments(batch).map((one) => one.difficulty),
      );
      expect(difficulties.has('HARD'), `batch ${String(batch)}`).toBe(true);
      expect(difficulties.has('EDGE'), `batch ${String(batch)}`).toBe(true);
    }
    // Across the whole wave the plan's own floors still hold; it is the ORDER that is uneven.
    const waveDifficulties = new Set(WAVE_1.map((one) => one.difficulty));
    expect(waveDifficulties.size).toBe(4);
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
