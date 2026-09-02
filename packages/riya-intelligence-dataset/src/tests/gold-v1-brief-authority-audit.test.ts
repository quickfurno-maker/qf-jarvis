/**
 * HGV1-B pre-authoring repair — a brief may never instruct authority the assignment does not back.
 *
 * ### The defect this pins
 *
 * A Gold brief is a WRITING ASSIGNMENT, and `authorityPlan` is derived from the assignment's
 * `requiredAuthorityFactClasses`. So a brief whose prose says "answer from supplied authority" while
 * its assignment declares no fact class hands the author an instruction that **cannot be followed**:
 * the packet supplies nothing to ground the answer in.
 *
 * There are only two ways to comply with such a brief, and both are failures. Inventing a price,
 * package difference or timeline range is exactly what the volatile-truth firewall exists to stop.
 * Silently ignoring the instruction corrupts the calibration signal, because a reviewer cannot tell a
 * deliberate omission from a missed requirement.
 *
 * The PR #185 readiness audit found four of these on then-current main — one structural
 * (`OUT_OF_SCOPE` ordinal 2 demanded `GROUNDING_QA` with no authority class) and three in brief prose.
 * This file proves all four are closed and that neither class can return.
 *
 * ### Two guards, deliberately different in kind
 *
 * The structural guard is a PROPERTY over every generated assignment, not a list of known ids — a
 * fifth slot added next year is covered without anyone remembering this file exists.
 *
 * The prose guard is narrow and LEXICAL on purpose. A semantic checker over authoring instructions
 * would be a small language model with no ground truth, and the failure mode of a noisy guard is that
 * authors learn to ignore it. So it matches positive instructions only, and the benign phrasings it
 * must NOT flag are pinned below as tests in their own right.
 */
import { describe, expect, it } from 'vitest';

import { generateRiyaGoldV1Plan } from '../gold-v1/plan/generate-plan.js';
import { RIYA_GOLD_V1_WAVE_1_BRIEFS } from '../gold-v1/plan/wave-1-briefs.js';
import { validateRiyaGoldV1Briefs } from '../gold-v1/service/validate-plan.js';

const ASSIGNMENTS = generateRiyaGoldV1Plan();
const BY_ID = new Map(ASSIGNMENTS.map((assignment) => [assignment.assignmentId, assignment]));

/** Wave 1 alone — the briefs exist only for this wave, and the validator pairs them one to one. */
const WAVE_1_ASSIGNMENTS = ASSIGNMENTS.filter((assignment) => assignment.wave === 1);

/** The id segment per language mode. Short tokens, not the lowercased vocabulary name. */
const LANGUAGE_SEGMENTS = ['en', 'hi', 'hinglish'] as const;

/**
 * A POSITIVE instruction to use authority the packet supplies.
 *
 * "from supplied process context", "using supplied package authority", "only from supplied
 * authority". The verb is what makes it an instruction — a bare mention of the word "supplied" is
 * not, which is the whole reason this is anchored rather than a substring search.
 */
const POSITIVE_AUTHORITY_INSTRUCTION = /(?:from|using) supplied [a-z ]*(?:authority|context)/i;

function instructsSuppliedAuthority(brief: { readonly conversationGoal: string }): boolean {
  return POSITIVE_AUTHORITY_INSTRUCTION.test(brief.conversationGoal);
}

const OUT_OF_SCOPE_ORDINAL_2 = ASSIGNMENTS.filter(
  (a) => a.primaryInteractionKind === 'OUT_OF_SCOPE' && a.ordinalWithinPair === 2,
);
const OUT_OF_SCOPE_ORDINAL_1 = ASSIGNMENTS.filter(
  (a) => a.primaryInteractionKind === 'OUT_OF_SCOPE' && a.ordinalWithinPair === 1,
);

// ---------------------------------------------------------------------------
// The structural property.
// ---------------------------------------------------------------------------

describe('no assignment may require a grounded answer without supplying authority', () => {
  it('every assignment requiring GROUNDING_QA declares at least one authority fact class', () => {
    // The property, over the whole generated plan. A grounded question is one answered from governed
    // knowledge WITH a citation; requiring one while supplying nothing to cite is unauthorable.
    const unbacked = ASSIGNMENTS.filter(
      (a) =>
        a.requiredSecondaryKinds.includes('GROUNDING_QA') &&
        a.requiredAuthorityFactClasses.length === 0,
    ).map((a) => a.assignmentId);

    expect(unbacked).toStrictEqual([]);
  });

  it('the same holds for a GROUNDING_QA PRIMARY, not only a secondary', () => {
    const unbacked = ASSIGNMENTS.filter(
      (a) =>
        a.primaryInteractionKind === 'GROUNDING_QA' && a.requiredAuthorityFactClasses.length === 0,
    ).map((a) => a.assignmentId);

    expect(unbacked).toStrictEqual([]);
  });

  it('the guard is not vacuous — it would catch a reintroduced defect', () => {
    // Non-vacuity: prove the predicate actually fires on the shape it is meant to reject, so a future
    // refactor that makes it always-true fails here rather than passing silently.
    const reintroduced = {
      requiredSecondaryKinds: ['GROUNDING_QA'],
      requiredAuthorityFactClasses: [],
    };

    expect(
      reintroduced.requiredSecondaryKinds.includes('GROUNDING_QA') &&
        reintroduced.requiredAuthorityFactClasses.length === 0,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The repaired OUT_OF_SCOPE ordinal-2 family.
// ---------------------------------------------------------------------------

describe('OUT_OF_SCOPE ordinal 2 grounds its required GROUNDING_QA', () => {
  it('is exactly 15 assignments — 5 waves x 3 languages — and every one requires PROCESS', () => {
    expect(OUT_OF_SCOPE_ORDINAL_2).toHaveLength(15);

    for (const assignment of OUT_OF_SCOPE_ORDINAL_2) {
      expect(assignment.requiredAuthorityFactClasses).toStrictEqual(['PROCESS']);
      expect(assignment.requiredSecondaryKinds).toStrictEqual(['GROUNDING_QA']);
    }
  });

  it('keeps every other property of the slot untouched', () => {
    // The repair changed ONE field. Difficulty, risk, phase and depth are what make this the edge
    // case it was designed to be, and widening any of them would quietly change what it teaches.
    for (const assignment of OUT_OF_SCOPE_ORDINAL_2) {
      expect(assignment.difficulty).toBe('EDGE');
      expect(assignment.riskClass).toBe('STANDARD');
      expect(assignment.startPhase).toBe('INTRO');
      expect(assignment.targetAssistantTurns).toBe(5);
    }
  });

  it('leaves ordinal 1 authority-free and unchanged', () => {
    expect(OUT_OF_SCOPE_ORDINAL_1).toHaveLength(15);

    for (const assignment of OUT_OF_SCOPE_ORDINAL_1) {
      expect(assignment.requiredAuthorityFactClasses).toStrictEqual([]);
      expect(assignment.requiredSecondaryKinds).toStrictEqual([]);
      expect(assignment.difficulty).toBe('BASIC');
      expect(assignment.startPhase).toBe('NEED');
      expect(assignment.targetAssistantTurns).toBe(4);
    }
  });

  it('the three Wave-1 briefs derive a PROCESS plan and demand both halves of the behaviour', () => {
    for (const segment of LANGUAGE_SEGMENTS) {
      const id = `gold.v1.w1.${segment}.out-of-scope.02`;
      const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((b) => b.assignmentId === id);
      expect(brief, id).toBeDefined();
      if (brief === undefined) continue;

      // The authority is REAL, not decorative: the plan entry exists and is the PROCESS class.
      expect(brief.authorityPlan).toHaveLength(1);
      expect(brief.authorityPlan[0]?.factClass).toBe('PROCESS');

      // The mixed-intent design survives — refuse one half, ground the other.
      expect(brief.requiredJourneyEvents).toContain('REFUSE_OUT_OF_SCOPE');
      expect(brief.requiredJourneyEvents).toContain('CITE_AUTHORITY');
    }
  });

  it('the scenario actually asks a process question, so the authority is not decorative', () => {
    // Adding PROCESS to the assignment without making the valid half a process question would leave
    // the author citing authority nothing in the scenario called for.
    const expected: Readonly<Record<string, string>> = {
      'gold.v1.w1.en.out-of-scope.02': 'sequenced on site',
      'gold.v1.w1.hi.out-of-scope.02': 'carried out and checked',
      'gold.v1.w1.hinglish.out-of-scope.02': 'planned and installed',
    };

    for (const [id, fragment] of Object.entries(expected)) {
      const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((b) => b.assignmentId === id);
      expect(brief, id).toBeDefined();
      expect(brief?.customerSituation).toContain(fragment);
    }
  });
});

// ---------------------------------------------------------------------------
// The three deliberately authority-free briefs.
// ---------------------------------------------------------------------------

describe('the three reworded briefs stay authority-free, deliberately', () => {
  const AUTHORITY_FREE: readonly (readonly [string, string])[] = [
    ['gold.v1.w1.hinglish.comparison.01', 'a priorities-based comparison, not a package one'],
    ['gold.v1.w1.hi.post-summary-qa.01', 'answerable from the summary already on screen'],
    ['gold.v1.w1.hinglish.objection-timeline.01', 'what to do when timeline truth is NOT supplied'],
  ];

  it.each(AUTHORITY_FREE)('%s carries no authority and promises none — %s', (id) => {
    const assignment = BY_ID.get(id);
    const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((b) => b.assignmentId === id);

    expect(assignment, id).toBeDefined();
    expect(brief, id).toBeDefined();
    if (assignment === undefined || brief === undefined) return;

    expect(assignment.requiredAuthorityFactClasses).toStrictEqual([]);
    expect(brief.authorityPlan).toStrictEqual([]);
    // Nothing to cite, so citing may not be demanded.
    expect(brief.requiredJourneyEvents).not.toContain('CITE_AUTHORITY');
    expect(instructsSuppliedAuthority(brief)).toBe(false);
  });

  it('their paired ordinal-2 slots still own the grounded version', () => {
    // This is why ordinal 1 may stay authority-free: the pair already teaches both behaviours. If
    // ordinal 2 ever lost its authority, keeping ordinal 1 bare would delete the grounded lesson.
    for (const id of [
      'gold.v1.w1.hinglish.comparison.02',
      'gold.v1.w1.hi.post-summary-qa.02',
      'gold.v1.w1.hinglish.objection-timeline.02',
    ]) {
      const assignment = BY_ID.get(id);
      expect(assignment, id).toBeDefined();
      expect(assignment?.requiredAuthorityFactClasses.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The prose guard, and the false positives it must not produce.
// ---------------------------------------------------------------------------

describe('no Wave-1 brief instructs authority its assignment does not back', () => {
  it('across all 72: ZERO unbacked positive-authority instructions', () => {
    const offenders = RIYA_GOLD_V1_WAVE_1_BRIEFS.filter((brief) => {
      const assignment = BY_ID.get(brief.assignmentId);
      return (
        instructsSuppliedAuthority(brief) &&
        (assignment?.requiredAuthorityFactClasses.length ?? 0) === 0
      );
    }).map((brief) => brief.assignmentId);

    expect(offenders).toStrictEqual([]);
  });

  it('a brief that DOES instruct authority use has a plan backing it', () => {
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      if (!instructsSuppliedAuthority(brief)) continue;
      const assignment = BY_ID.get(brief.assignmentId);

      expect(assignment?.requiredAuthorityFactClasses.length ?? 0).toBeGreaterThan(0);
      expect(brief.authorityPlan.length).toBeGreaterThan(0);
    }
  });

  it('the inverse is NOT required: structured authority need not be repeated in prose', () => {
    // authorityPlan is structured data the packet supplies whether or not the goal sentence mentions
    // it. Requiring the prose to restate it would be a style rule masquerading as a safety rule, and
    // it would fail briefs that are perfectly authorable.
    const silent = RIYA_GOLD_V1_WAVE_1_BRIEFS.filter((brief) => {
      const assignment = BY_ID.get(brief.assignmentId);
      return (
        (assignment?.requiredAuthorityFactClasses.length ?? 0) > 0 &&
        !instructsSuppliedAuthority(brief)
      );
    });

    expect(silent.length).toBeGreaterThan(0);
  });
});

describe('the prose guard stays narrow: these phrasings are NOT findings', () => {
  it('"can be supplied" about an appliance is a customer request, not an instruction', () => {
    expect(
      instructsSuppliedAuthority({
        conversationGoal:
          'A customer asks whether appliances such as a refrigerator can be supplied.',
      }),
    ).toBe(false);
  });

  it('"a referral that was not supplied" is a prohibition, not an instruction', () => {
    expect(
      instructsSuppliedAuthority({
        conversationGoal: 'Decline briefly, avoid suggesting a referral that was not supplied.',
      }),
    ).toBe(false);
  });

  it('"keep the latest values as authoritative" is about customer-stated facts', () => {
    expect(
      instructsSuppliedAuthority({
        conversationGoal: 'Correct the record and keep the latest values as authoritative.',
      }),
    ).toBe(false);
  });

  it('but it does catch the four wordings the PR #185 audit found', () => {
    // Non-vacuity for the guard itself, using the exact pre-repair phrasings.
    for (const goal of [
      'Separate the two cleanly, decline one, answer the other from supplied authority.',
      'Answer using supplied package authority, keep the difference concrete.',
      'Describe the next step from supplied process context, keep it to what is known.',
      'Reward the flexibility with honesty, give ranges only from supplied authority.',
    ]) {
      expect(instructsSuppliedAuthority({ conversationGoal: goal }), goal).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The structured validator still accepts every brief.
// ---------------------------------------------------------------------------

describe('the repair did not break the structured contract', () => {
  it('all 72 Wave-1 briefs still pass the Gold brief validator', () => {
    const report = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS, WAVE_1_ASSIGNMENTS);

    expect(report.findings).toStrictEqual([]);
    expect(report.valid).toBe(true);
  });
});
