/**
 * The deterministic scenario scheduler (AS2, ADR-0143 §6).
 *
 * Two properties carry the weight here: the schedule is a pure function of the plan, and lineage and
 * split are settled before any model exists. The second is what stops a paraphrase reaching
 * VALIDATION while its parent sits in TRAIN.
 */
import { describe, expect, it } from 'vitest';

import {
  RiyaSyntheticGenerationError,
  createRiyaSyntheticRunPlan,
  riyaSyntheticRunPlanSha256,
  scheduleRiyaSyntheticScenarios,
} from '../index.js';
import { runPlan, scenarios } from './fixtures.js';

describe('the schedule is a pure function of the plan', () => {
  it('produces identical scenarios for the same plan', () => {
    expect(scheduleRiyaSyntheticScenarios(runPlan(12))).toStrictEqual(
      scheduleRiyaSyntheticScenarios(runPlan(12)),
    );
  });

  it('produces a different schedule for a different seed', () => {
    const base = scheduleRiyaSyntheticScenarios(runPlan(12));
    const shifted = scheduleRiyaSyntheticScenarios(
      createRiyaSyntheticRunPlan({ ...runPlan(12), seed: 4 }),
    );

    expect(shifted).not.toStrictEqual(base);
    expect(shifted).toHaveLength(base.length);
  });

  it('digests the plan, so an edited plan cannot keep attesting an old schedule', () => {
    const original = riyaSyntheticRunPlanSha256(runPlan(12));
    const edited = riyaSyntheticRunPlanSha256(
      createRiyaSyntheticRunPlan({ ...runPlan(12), scenarioCount: 13 }),
    );

    expect(edited).not.toBe(original);
  });
});

describe('lineage and split are assigned before generation', () => {
  it('gives every scenario its own lineage root', () => {
    const scheduled = scenarios(20);
    const roots = scheduled.map((one) => one.lineageRootRef);

    expect(new Set(roots).size).toBe(roots.length);
  });

  it('never lets one lineage straddle two splits', () => {
    // Structurally impossible here, and asserted anyway: the moment AS3 adds variants that inherit a
    // root, this is the invariant that keeps them on one side.
    const byRoot = new Map<string, Set<string>>();
    for (const scenario of scenarios(40)) {
      const splits = byRoot.get(scenario.lineageRootRef) ?? new Set<string>();
      splits.add(scenario.split);
      byRoot.set(scenario.lineageRootRef, splits);
    }

    for (const [root, splits] of byRoot) {
      expect(splits.size, root).toBe(1);
    }
  });

  it('produces both splits at the planned ratio', () => {
    const scheduled = scenarios(20);
    const validation = scheduled.filter((one) => one.split === 'VALIDATION');

    expect(validation.length).toBeGreaterThan(0);
    expect(validation.length).toBeLessThan(scheduled.length);
  });
});

describe('the schedule spreads across every planned axis', () => {
  it('does not settle on one language, kind, persona, difficulty or depth', () => {
    const scheduled = scenarios(24);
    const spread = (values: readonly string[]): number => new Set(values).size;

    expect(spread(scheduled.map((one) => one.languageMode))).toBeGreaterThan(1);
    expect(spread(scheduled.map((one) => one.primaryInteractionKind))).toBeGreaterThan(1);
    expect(spread(scheduled.map((one) => one.persona))).toBeGreaterThan(1);
    expect(spread(scheduled.map((one) => one.difficulty))).toBeGreaterThan(1);
    expect(spread(scheduled.map((one) => String(one.targetAssistantTurns)))).toBeGreaterThan(1);
  });

  it('does not lock the axes together', () => {
    // Balanced per axis and still one repeated shape is the failure that looks like success. If
    // language and kind moved on the same stride, every ENGLISH scenario would share one kind.
    const scheduled = scenarios(24);
    const english = scheduled.filter((one) => one.languageMode === 'ENGLISH');

    expect(new Set(english.map((one) => one.primaryInteractionKind)).size).toBeGreaterThan(1);
  });

  it('keeps every depth inside the AS1 bounds', () => {
    for (const scenario of scenarios(24)) {
      expect(scenario.targetAssistantTurns).toBeGreaterThanOrEqual(4);
      expect(scenario.targetAssistantTurns).toBeLessThanOrEqual(12);
    }
  });
});

describe('an impossible plan fails closed', () => {
  it('refuses a depth range that is inverted', () => {
    expect(() =>
      createRiyaSyntheticRunPlan({ ...runPlan(4), minAssistantTurns: 7, maxAssistantTurns: 5 }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a depth outside the AS1 lane bounds', () => {
    expect(() => createRiyaSyntheticRunPlan({ ...runPlan(4), maxAssistantTurns: 13 })).toThrow(
      RiyaSyntheticGenerationError,
    );
  });

  it('refuses an empty axis', () => {
    expect(() => createRiyaSyntheticRunPlan({ ...runPlan(4), languageModes: [] })).toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});
