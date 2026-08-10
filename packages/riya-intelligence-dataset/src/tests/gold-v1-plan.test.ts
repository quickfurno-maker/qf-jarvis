/**
 * HGV1-A — the 360-slot plan and the 72 Wave-1 briefs (ADR-0108).
 *
 * The plan is checked as a TABLE, before anybody writes against it. A defect here costs an afternoon;
 * the same defect found after Wave 3 costs two hundred conversations.
 *
 * The brief specs are mostly about what a brief is NOT. Briefs and trajectories live in the same
 * repository and the shortest path from "we need 360 conversations" to "we have 360 conversations" is
 * to promote the instructions into the corpus — so a brief must be structurally incapable of being
 * one.
 */
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import { describe, expect, it } from 'vitest';

import { RiyaDatasetError } from '../contracts/errors.js';
import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
} from '../contracts/vocabularies.js';
import { createProtectedTextIndex } from '../internal/leakage.js';
import { createRiyaGoldV1Assignment } from '../gold-v1/contracts/assignment.js';
import { createRiyaGoldV1Brief } from '../gold-v1/contracts/brief.js';
import {
  RIYA_GOLD_V1_HOLDOUT_TOTAL,
  RIYA_GOLD_V1_PER_WAVE,
  RIYA_GOLD_V1_TOTAL,
  RIYA_GOLD_V1_TRAIN_TOTAL,
  RIYA_GOLD_V1_VALIDATION_TOTAL,
  RIYA_GOLD_WAVES,
  RIYA_GOLD_WAVE_SPLITS,
} from '../gold-v1/contracts/vocabularies.js';
import {
  generateRiyaGoldV1Plan,
  riyaGoldV1WaveAssignments,
} from '../gold-v1/plan/generate-plan.js';
import { RIYA_GOLD_V1_WAVE_1_BRIEFS } from '../gold-v1/plan/wave-1-briefs.js';
import {
  validateRiyaGoldV1Briefs,
  validateRiyaGoldV1Plan,
} from '../gold-v1/service/validate-plan.js';
import { parseRiyaTrajectoryJsonlLine } from '../service/jsonl.js';

const PLAN = generateRiyaGoldV1Plan();
const WAVE_1 = riyaGoldV1WaveAssignments(1);

/** The REAL protected corpus, loaded from P10's public testing subpath. Never transcribed. */
const PROTECTED_INDEX = createProtectedTextIndex(
  RIYA_QUALITY_GOLDEN_FIXTURES.map((fixture) => ({
    protectedRef: fixture.fixtureId,
    text: fixture.syntheticUserText,
  })),
);

/**
 * Narrow one indexed access.
 *
 * `noUncheckedIndexedAccess` is on and the lint bans both `!` and a widening `as`, so a spec that
 * needs a definite element says so once, here, and fails loudly rather than silently passing
 * `undefined` into a constructor.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaDatasetError ? error.code : 'not-a-dataset-error';
  }
  return 'no-error';
};

const tally = (xs: readonly string[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }), {});

// ---------------------------------------------------------------------------
// 1. The plan.
// ---------------------------------------------------------------------------

describe('the Gold V1 plan is exactly 3 x 12 x 10, in five balanced waves', () => {
  it('is 360 assignments across five waves of 72', () => {
    expect(PLAN).toHaveLength(RIYA_GOLD_V1_TOTAL);
    for (const wave of RIYA_GOLD_WAVES) {
      expect(
        PLAN.filter((one) => one.wave === wave),
        `wave ${String(wave)}`,
      ).toHaveLength(RIYA_GOLD_V1_PER_WAVE);
    }
  });

  it('gives every wave, language and interaction exactly two assignments', () => {
    for (const wave of RIYA_GOLD_WAVES) {
      for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
        for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
          expect(
            PLAN.filter(
              (one) =>
                one.wave === wave &&
                one.languageMode === languageMode &&
                one.primaryInteractionKind === kind,
            ),
            `${String(wave)}/${languageMode}/${kind}`,
          ).toHaveLength(2);
        }
      }
    }
  });

  it('is 120 per language and 30 per interaction overall', () => {
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      expect(PLAN.filter((one) => one.languageMode === languageMode)).toHaveLength(120);
    }
    for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
      expect(PLAN.filter((one) => one.primaryInteractionKind === kind)).toHaveLength(30);
    }
  });

  it('puts waves 1–4 in TRAIN and wave 5 in VALIDATION, with NO holdout', () => {
    // A corpus committed to Git is visible to everyone authoring against the repository. Calling part
    // of it hidden would be a comforting label on something untrue, so Gold V1 populates no holdout
    // and a genuinely sealed one is deferred.
    for (const assignment of PLAN) {
      expect(assignment.split, assignment.assignmentId).toBe(
        RIYA_GOLD_WAVE_SPLITS[assignment.wave],
      );
    }
    const splits = tally(PLAN.map((one) => one.split));
    expect(splits['TRAIN']).toBe(RIYA_GOLD_V1_TRAIN_TOTAL);
    expect(splits['VALIDATION']).toBe(RIYA_GOLD_V1_VALIDATION_TOTAL);
    expect(splits['HOLDOUT'] ?? RIYA_GOLD_V1_HOLDOUT_TOTAL).toBe(0);
  });

  it('has stable, unique ids in its OWN namespace', () => {
    const ids = PLAN.map((one) => one.assignmentId);
    expect(new Set(ids).size).toBe(RIYA_GOLD_V1_TOTAL);
    expect(ids).toContain('gold.v1.w1.en.discovery.01');
    expect(ids).toContain('gold.v1.w1.hi.objection-price.02');
    expect(ids).toContain('gold.v1.w5.hinglish.next-step.02');
    for (const id of ids) {
      expect(id).toMatch(/^gold\.v1\.w[1-5]\.(?:en|hi|hinglish)\.[a-z-]+\.0[12]$/u);
      // Never the exam's namespace, and never anything that would collide with a fixture id.
      expect(id.startsWith('riya.p10.')).toBe(false);
    }
    // Deterministic: generating twice produces the identical plan.
    expect(generateRiyaGoldV1Plan()).toStrictEqual(PLAN);
  });

  it('passes its own validator against the REAL protected corpus', () => {
    const report = validateRiyaGoldV1Plan(PLAN, { protectedIndex: PROTECTED_INDEX });
    expect(report.findings).toStrictEqual([]);
    expect(report.valid).toBe(true);
    expect(report.totalAssignments).toBe(360);
  });

  it.each([
    ['a wrong wave split', (a: (typeof PLAN)[number]) => ({ ...a, split: 'HOLDOUT' as const })],
    [
      'an id outside the Gold namespace',
      (a: (typeof PLAN)[number]) => ({ ...a, assignmentId: 'riya.p10.en.discovery.01' }),
    ],
  ])('the validator catches %s', (_name, mutate) => {
    const first = PLAN[0];
    expect(first).toBeDefined();
    const broken = [mutate(must(first, 'the first assignment')), ...PLAN.slice(1)];
    const report = validateRiyaGoldV1Plan(broken, { protectedIndex: PROTECTED_INDEX });
    expect(report.valid).toBe(false);
  });

  it('refuses an assignment whose split contradicts its wave', () => {
    expect(
      codeOf(() =>
        createRiyaGoldV1Assignment({
          ...must(PLAN[0], 'the first assignment'),
          split: 'VALIDATION',
        }),
      ),
    ).toBe('invalid-gold-assignment');
  });
});

// ---------------------------------------------------------------------------
// 2. Wave-1 diversity.
// ---------------------------------------------------------------------------

describe('Wave 1 is diverse enough to calibrate against', () => {
  it('is 24 per language and 6 per interaction', () => {
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      expect(WAVE_1.filter((one) => one.languageMode === languageMode)).toHaveLength(24);
    }
    for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
      expect(WAVE_1.filter((one) => one.primaryInteractionKind === kind)).toHaveLength(6);
    }
  });

  it('uses all eight personas, none dominating, at least six per language', () => {
    const counts = tally(WAVE_1.map((one) => one.persona));
    for (const persona of RIYA_DATASET_PERSONAS) {
      expect(counts[persona] ?? 0, persona).toBeGreaterThan(0);
      expect(counts[persona] ?? 0, persona).toBeLessThanOrEqual(16);
    }
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      const distinct = new Set(
        WAVE_1.filter((one) => one.languageMode === languageMode).map((one) => one.persona),
      );
      expect(distinct.size, languageMode).toBeGreaterThanOrEqual(6);
    }
  });

  it('the two assignments of a cell always differ in persona', () => {
    // Otherwise the pair is one situation written twice, which is the degeneration this plan exists
    // to avoid.
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        const pair = WAVE_1.filter(
          (one) => one.languageMode === languageMode && one.primaryInteractionKind === kind,
        );
        expect(pair[0]?.persona, `${languageMode}/${kind}`).not.toBe(pair[1]?.persona);
      }
    }
  });

  it('meets the difficulty floors, and not every objection is HARD', () => {
    const counts = tally(WAVE_1.map((one) => one.difficulty));
    expect(counts['BASIC'] ?? 0).toBeGreaterThanOrEqual(8);
    expect(counts['STANDARD'] ?? 0).toBeGreaterThanOrEqual(30);
    expect(counts['HARD'] ?? 0).toBeGreaterThanOrEqual(20);
    expect(counts['EDGE'] ?? 0).toBeGreaterThanOrEqual(6);

    const objections = WAVE_1.filter((one) => one.primaryInteractionKind.startsWith('OBJECTION_'));
    expect(objections.some((one) => one.difficulty === 'STANDARD')).toBe(true);
  });

  it('carries enough HIGH_RISK to exercise the two-reviewer workflow', () => {
    const highRisk = WAVE_1.filter((one) => one.riskClass === 'HIGH_RISK');
    expect(highRisk.length).toBeGreaterThanOrEqual(18);
    // And not everything: a corpus where every slot needs two reviewers stalls.
    expect(highRisk.length).toBeLessThan(WAVE_1.length);
  });

  it('starts from every conversation phase somewhere', () => {
    const phases = new Set(WAVE_1.map((one) => one.startPhase));
    for (const phase of [
      'INTRO',
      'NEED',
      'LOCATION',
      'PROJECT_DETAILS',
      'BUDGET_TIMELINE',
      'SUMMARY',
      'CONTACT',
      'CONSENT',
      'COMPLETE',
    ]) {
      expect(phases.has(phase as never), phase).toBe(true);
    }
  });

  it('spreads depth across shallow, mid and deep', () => {
    const band = (n: number) => (n <= 5 ? 'shallow' : n <= 8 ? 'mid' : 'deep');
    const counts = tally(WAVE_1.map((one) => band(one.targetAssistantTurns)));
    expect(counts['shallow'] ?? 0).toBeGreaterThanOrEqual(12);
    expect(counts['mid'] ?? 0).toBeGreaterThanOrEqual(36);
    expect(counts['deep'] ?? 0).toBeGreaterThanOrEqual(12);
    for (const assignment of WAVE_1) {
      expect(assignment.targetAssistantTurns).toBeGreaterThanOrEqual(4);
      expect(assignment.targetAssistantTurns).toBeLessThanOrEqual(12);
    }
  });

  it('meets the FINAL diversity floors across all 360', () => {
    const personas = tally(PLAN.map((one) => one.persona));
    for (const persona of RIYA_DATASET_PERSONAS) {
      expect(personas[persona] ?? 0, persona).toBeGreaterThanOrEqual(30);
    }
    const difficulties = tally(PLAN.map((one) => one.difficulty));
    expect(difficulties['BASIC'] ?? 0).toBeGreaterThanOrEqual(50);
    expect(difficulties['STANDARD'] ?? 0).toBeGreaterThanOrEqual(150);
    expect(difficulties['HARD'] ?? 0).toBeGreaterThanOrEqual(100);
    expect(difficulties['EDGE'] ?? 0).toBeGreaterThanOrEqual(30);
    const risks = tally(PLAN.map((one) => one.riskClass));
    expect(risks['HIGH_RISK'] ?? 0).toBeGreaterThanOrEqual(90);
    expect(risks['STANDARD'] ?? 0).toBeGreaterThanOrEqual(180);
  });
});

// ---------------------------------------------------------------------------
// 3. The Wave-1 briefs.
// ---------------------------------------------------------------------------

describe('the 72 Wave-1 briefs are writing assignments, not conversations', () => {
  it('is exactly 72, one per Wave-1 assignment', () => {
    expect(RIYA_GOLD_V1_WAVE_1_BRIEFS).toHaveLength(72);
    const refs = RIYA_GOLD_V1_WAVE_1_BRIEFS.map((one) => one.briefRef);
    expect(new Set(refs).size).toBe(72);
    for (const assignment of WAVE_1) {
      const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find(
        (one) => one.assignmentId === assignment.assignmentId,
      );
      expect(brief, assignment.assignmentId).toBeDefined();
      expect(brief?.briefRef).toBe(assignment.authoringBriefRef);
    }
  });

  it('is exactly 2 per language and interaction pair', () => {
    const byAssignment = new Map(WAVE_1.map((one) => [one.assignmentId, one]));
    for (const languageMode of RIYA_DATASET_LANGUAGE_MODES) {
      for (const kind of RIYA_DATASET_INTERACTION_KINDS) {
        const matching = RIYA_GOLD_V1_WAVE_1_BRIEFS.filter((brief) => {
          const assignment = byAssignment.get(brief.assignmentId);
          return (
            assignment?.languageMode === languageMode && assignment.primaryInteractionKind === kind
          );
        });
        expect(matching, `${languageMode}/${kind}`).toHaveLength(2);
      }
    }
  });

  it('passes its own validator against the REAL protected corpus', () => {
    const report = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS, WAVE_1, {
      protectedIndex: PROTECTED_INDEX,
    });
    expect(report.findings).toStrictEqual([]);
    expect(report.valid).toBe(true);
    expect(report.totalBriefs).toBe(72);
  });

  it('every situation and goal is UNIQUE across all 72', () => {
    // Independently authored, not one scenario translated three times. Cross-language clones would
    // make the corpus look three times as large and teach roughly a third as much.
    const situations = RIYA_GOLD_V1_WAVE_1_BRIEFS.map((one) => one.customerSituation);
    const goals = RIYA_GOLD_V1_WAVE_1_BRIEFS.map((one) => one.conversationGoal);
    expect(new Set(situations).size).toBe(72);
    expect(new Set(goals).size).toBe(72);
  });

  it('contains NO finished dialogue and refuses any', () => {
    const base = RIYA_GOLD_V1_WAVE_1_BRIEFS[0];
    expect(base).toBeDefined();
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      expect(brief.customerSituation).not.toMatch(/["“”]/u);
      expect(brief.conversationGoal).not.toMatch(/["“”]/u);
      expect(Object.keys(brief).sort()).toStrictEqual([
        'assignmentId',
        'authorityPlan',
        'briefRef',
        'conversationGoal',
        'customerSituation',
        'forbiddenShortcuts',
        'requiredJourneyEvents',
        'reviewFocus',
        'stylePlan',
        'version',
      ]);
    }
    // And the constructor refuses a quoted line or a speaker prefix outright.
    for (const prose of [
      'The customer says "the price feels too high" and waits for a reply from Riya today.',
      'Customer: the price feels too high, and the assistant should respond with empathy first.',
      'Riya: acknowledge the concern and then ask one question about the intended scope.',
    ]) {
      expect(
        codeOf(() =>
          createRiyaGoldV1Brief({
            ...must(base, 'the first brief'),
            briefRef: 'brief.check.one',
            customerSituation: prose,
          }),
        ),
        prose.slice(0, 30),
      ).toBe('invalid-gold-brief');
    }
  });

  it('a brief cannot be parsed as a trajectory', () => {
    // Structurally, not by convention. There is no field a turn could live in.
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS.slice(0, 5)) {
      expect(codeOf(() => parseRiyaTrajectoryJsonlLine(JSON.stringify(brief)))).toBe(
        'invalid-trajectory',
      );
    }
  });

  it('names no brand, model or provider, and carries no privacy violation', () => {
    const joined = JSON.stringify(RIYA_GOLD_V1_WAVE_1_BRIEFS).toLowerCase();
    for (const forbidden of [
      'quickfurno',
      'onedecore',
      'groq',
      'openai',
      'anthropic',
      'claude',
      'qwen',
      'llama',
      'http',
      '@gmail',
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
    expect(joined).not.toMatch(/\d{7,}/u);
  });

  it('carries an authority plan exactly where mutable business truth is in play', () => {
    const byAssignment = new Map(WAVE_1.map((one) => [one.assignmentId, one]));
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      const assignment = byAssignment.get(brief.assignmentId);
      expect(assignment).toBeDefined();
      const needed = assignment?.requiredAuthorityFactClasses ?? [];
      expect(brief.authorityPlan.length > 0, brief.briefRef).toBe(needed.length > 0);
      for (const factClass of needed) {
        expect(
          brief.authorityPlan.some((entry) => entry.factClass === factClass),
          `${brief.briefRef}/${factClass}`,
        ).toBe(true);
      }
      // Every suggested ref is an obvious placeholder.
      for (const entry of brief.authorityPlan) {
        expect(entry.suggestedFactRef).toMatch(/^fact\./u);
      }
    }
  });

  it('every brief forbids the universal shortcuts and names a review focus', () => {
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      for (const forbidden of [
        'CANNED_OPENER',
        'CANNED_CTA',
        'FALSE_URGENCY',
        'INVENTED_PRICE',
        'MULTIPLE_DISCOVERY_QUESTIONS',
        'CHAIN_OF_THOUGHT',
      ]) {
        expect(brief.forbiddenShortcuts, brief.briefRef).toContain(forbidden);
      }
      expect(brief.requiredJourneyEvents.length).toBeGreaterThan(0);
      expect(brief.reviewFocus.length).toBeGreaterThan(0);
      expect(brief.stylePlan.length).toBeGreaterThan(0);
    }
  });

  it('gives Hindi and Hinglish their own register codes', () => {
    const byAssignment = new Map(WAVE_1.map((one) => [one.assignmentId, one]));
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      const language = byAssignment.get(brief.assignmentId)?.languageMode;
      if (language === 'HINDI') {
        expect(brief.stylePlan, brief.briefRef).toContain('NATURAL_DEVANAGARI');
      }
      if (language === 'HINGLISH') {
        expect(brief.stylePlan, brief.briefRef).toContain('NATURAL_CODE_SWITCHING');
      }
    }
  });

  it('the validator catches a brief with no assignment, and an assignment with no brief', () => {
    const orphan = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS, WAVE_1.slice(0, 71));
    expect(orphan.valid).toBe(false);
    const missing = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS.slice(0, 71), WAVE_1);
    expect(missing.valid).toBe(false);
    expect(missing.findings.some((one) => one.reason === 'BRIEF_MISSING')).toBe(true);
  });
});
