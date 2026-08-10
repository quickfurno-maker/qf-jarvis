/**
 * HGV1-B — brief prose must not promise authority the assignment does not require.
 *
 * ### The gap this guards
 *
 * `validateRiyaGoldV1Briefs` checks authority in the STRUCTURED direction: every class the assignment
 * requires appears in the brief's `authorityPlan`, and the plan names no class the assignment does
 * not. Both hold across all 72, and that remains the machine authority.
 *
 * What no validator reads is the brief's PROSE. A `conversationGoal` could instruct an author to
 * "answer from supplied authority" while the assignment declares nothing, the `authorityPlan` is
 * empty and `CITE_AUTHORITY` is absent — every structured check passing on an instruction impossible
 * to follow.
 *
 * Four briefs did exactly that, found in the pre-authoring audit. It matters because the two readings
 * diverge: follow the prose and the author invents an authoritative context turn the plan never asked
 * for; follow the assignment and the author answers from nowhere, which is the unsupported-claim habit
 * the business-fact firewall exists to keep out of the weights. Two conscientious people, one brief,
 * opposite conversations.
 *
 * Three were reworded to stay authority-free. The fourth was a deeper plan defect — `OUT_OF_SCOPE`
 * ordinal 2 required `GROUNDING_QA` with no authority class at all — and was fixed at the slot shape.
 *
 * ### What this spec is, and is not
 *
 * A narrow lexical regression guard: it recognises the positive instruction "from|using supplied …
 * authority|context" and requires a backing authority plan. It does **not** prove semantic consistency
 * of arbitrary prose, and it is not a substitute for a reviewer reading the brief. It exists so this
 * particular defect cannot come back unnoticed.
 */
import { describe, expect, it } from 'vitest';

import {
  generateRiyaGoldV1Plan,
  riyaGoldV1WaveAssignments,
} from '../gold-v1/plan/generate-plan.js';
import { RIYA_GOLD_V1_WAVE_1_BRIEFS } from '../gold-v1/plan/wave-1-briefs.js';
import { validateRiyaGoldV1Briefs } from '../gold-v1/service/validate-plan.js';

const WAVE_1 = riyaGoldV1WaveAssignments(1);
const BY_ID = new Map(WAVE_1.map((one) => [one.assignmentId, one]));

/** The positive instruction: "answer it FROM / USING supplied … authority|context". */
const POSITIVE_AUTHORITY_INSTRUCTION = /(?:from|using) supplied [a-z ]*(?:authority|context)/u;

describe('no brief instructs authority use the assignment does not back', () => {
  it('unbacked positive-authority instructions across all 72: ZERO', () => {
    const unbacked = RIYA_GOLD_V1_WAVE_1_BRIEFS.filter((brief) => {
      const instructs =
        POSITIVE_AUTHORITY_INSTRUCTION.test(brief.conversationGoal) ||
        POSITIVE_AUTHORITY_INSTRUCTION.test(brief.customerSituation);
      return instructs && brief.authorityPlan.length === 0;
    }).map((brief) => brief.assignmentId);

    expect(unbacked).toStrictEqual([]);
  });

  it('a brief that instructs authority use also declares it three ways', () => {
    // Plan, assignment and journey event have to agree, or an author is following one of three
    // partial stories.
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      if (!POSITIVE_AUTHORITY_INSTRUCTION.test(brief.conversationGoal)) continue;
      const assignment = BY_ID.get(brief.assignmentId);
      expect(brief.authorityPlan.length, brief.assignmentId).toBeGreaterThan(0);
      expect(assignment?.requiredAuthorityFactClasses.length, brief.assignmentId).toBeGreaterThan(
        0,
      );
      expect(brief.requiredJourneyEvents, brief.assignmentId).toContain('CITE_AUTHORITY');
    }
  });

  it('an authority plan exists exactly where the assignment requires one, and matches it', () => {
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      const assignment = BY_ID.get(brief.assignmentId);
      expect(assignment, brief.assignmentId).toBeDefined();
      const required = assignment?.requiredAuthorityFactClasses ?? [];
      expect(brief.authorityPlan.length > 0, brief.briefRef).toBe(required.length > 0);
      for (const factClass of required) {
        expect(
          brief.authorityPlan.some((entry) => entry.factClass === factClass),
          `${brief.briefRef}/${factClass}`,
        ).toBe(true);
      }
    }
  });

  it('every brief still passes the structured Gold brief validator', () => {
    const report = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS, WAVE_1);
    expect(report.findings).toStrictEqual([]);
    expect(report.valid).toBe(true);
  });
});

describe('the scan stays narrow: these phrasings are NOT findings', () => {
  const goalOf = (assignmentId: string): string =>
    RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === assignmentId)?.conversationGoal ??
    '';
  const situationOf = (assignmentId: string): string =>
    RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === assignmentId)
      ?.customerSituation ?? '';

  it('"can be supplied" about an appliance is a request, not an instruction', () => {
    const situation = situationOf('gold.v1.w1.hi.out-of-scope.01');
    expect(situation).toContain('can be supplied');
    expect(POSITIVE_AUTHORITY_INSTRUCTION.test(situation)).toBe(false);
    expect(BY_ID.get('gold.v1.w1.hi.out-of-scope.01')?.requiredAuthorityFactClasses).toStrictEqual(
      [],
    );
  });

  it('"a referral that was not supplied" is a prohibition, not an instruction', () => {
    const goal = goalOf('gold.v1.w1.hinglish.out-of-scope.01');
    expect(goal).toContain('was not supplied');
    expect(POSITIVE_AUTHORITY_INSTRUCTION.test(goal)).toBe(false);
  });

  it('"keep the latest values as authoritative" is about customer-stated facts', () => {
    const goal = goalOf('gold.v1.w1.en.correction.02');
    expect(goal).toContain('authoritative');
    expect(POSITIVE_AUTHORITY_INSTRUCTION.test(goal)).toBe(false);
    expect(BY_ID.get('gold.v1.w1.en.correction.02')?.requiredAuthorityFactClasses).toStrictEqual(
      [],
    );
  });
});

describe('the three reworded briefs stay authority-free, deliberately', () => {
  it.each([
    ['gold.v1.w1.hinglish.comparison.01', 'the priorities-based comparison, not the package one'],
    ['gold.v1.w1.hi.post-summary-qa.01', 'answerable from the summary already on screen'],
    ['gold.v1.w1.hinglish.objection-timeline.01', 'what to do when timeline truth is NOT supplied'],
  ])('%s — %s', (assignmentId) => {
    const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === assignmentId);
    expect(brief, assignmentId).toBeDefined();
    expect(BY_ID.get(assignmentId)?.requiredAuthorityFactClasses).toStrictEqual([]);
    expect(brief?.authorityPlan).toStrictEqual([]);
    expect(brief?.requiredJourneyEvents).not.toContain('CITE_AUTHORITY');
    expect(POSITIVE_AUTHORITY_INSTRUCTION.test(brief?.conversationGoal ?? '')).toBe(false);
  });

  it('their paired ordinal-02 slots DO own the grounded version', () => {
    // Both behaviours belong in Gold. The pair is where the grounded take lives.
    expect(
      BY_ID.get('gold.v1.w1.hinglish.comparison.02')?.requiredAuthorityFactClasses,
    ).toStrictEqual(['PACKAGE']);
    expect(
      (BY_ID.get('gold.v1.w1.hi.post-summary-qa.02')?.requiredAuthorityFactClasses ?? []).length,
    ).toBeGreaterThan(0);
    expect(
      (BY_ID.get('gold.v1.w1.hinglish.objection-timeline.02')?.requiredAuthorityFactClasses ?? [])
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('OUT_OF_SCOPE ordinal 2 grounds its required GROUNDING_QA', () => {
  it('the slot shape now requires PROCESS, in every language and every wave', () => {
    // GROUNDING_QA means a factual question answered from governed knowledge WITH a citation. An
    // assignment demanding it while requiring no authority class was under-specified.
    const affected = generateRiyaGoldV1Plan().filter(
      (one) => one.primaryInteractionKind === 'OUT_OF_SCOPE' && one.ordinalWithinPair === 2,
    );
    expect(affected).toHaveLength(15); // 5 waves × 3 languages
    for (const assignment of affected) {
      expect(assignment.requiredAuthorityFactClasses, assignment.assignmentId).toStrictEqual([
        'PROCESS',
      ]);
      expect(assignment.requiredSecondaryKinds, assignment.assignmentId).toStrictEqual([
        'GROUNDING_QA',
      ]);
      // Everything else about the slot is unchanged.
      expect(assignment.difficulty).toBe('EDGE');
      expect(assignment.riskClass).toBe('STANDARD');
      expect(assignment.startPhase).toBe('INTRO');
      expect(assignment.targetAssistantTurns).toBe(5);
    }
  });

  it('ordinal 1 is untouched and stays authority-free', () => {
    const firsts = generateRiyaGoldV1Plan().filter(
      (one) => one.primaryInteractionKind === 'OUT_OF_SCOPE' && one.ordinalWithinPair === 1,
    );
    expect(firsts).toHaveLength(15);
    for (const assignment of firsts) {
      expect(assignment.requiredAuthorityFactClasses, assignment.assignmentId).toStrictEqual([]);
      expect(assignment.requiredSecondaryKinds, assignment.assignmentId).toStrictEqual([]);
    }
  });

  it('all three Wave-1 briefs derive a PROCESS plan and require the citation', () => {
    for (const languageMode of ['en', 'hi', 'hinglish'] as const) {
      const id = `gold.v1.w1.${languageMode}.out-of-scope.02`;
      const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === id);
      expect(brief, id).toBeDefined();
      expect(
        brief?.authorityPlan.map((entry) => entry.factClass),
        id,
      ).toStrictEqual(['PROCESS']);
      expect(brief?.requiredJourneyEvents, id).toContain('CITE_AUTHORITY');
      // And the scenario now actually contains a process question to ground.
      expect(brief?.conversationGoal.toLowerCase(), id).toContain('process authority');
    }
  });

  it('the mixed-intent design survives: decline one half, answer the other', () => {
    for (const languageMode of ['en', 'hi', 'hinglish'] as const) {
      const id = `gold.v1.w1.${languageMode}.out-of-scope.02`;
      const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === id);
      expect(brief?.requiredJourneyEvents, id).toContain('REFUSE_OUT_OF_SCOPE');
      expect(brief?.conversationGoal.toLowerCase(), id).toMatch(/declin|refuse/u);
    }
  });
});
