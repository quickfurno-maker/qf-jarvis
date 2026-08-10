/**
 * HGV1-B — brief prose vs declared authority, audited (owner finding on the micro-batch-1 packet).
 *
 * ### The gap this covers
 *
 * `validateRiyaGoldV1Briefs` checks authority in the STRUCTURED direction: every class the assignment
 * requires must appear in the brief's `authorityPlan`, and the plan may not name a class the
 * assignment does not require. Both hold across all 72.
 *
 * What no validator reads is the brief's PROSE. So a `conversationGoal` can instruct an author to
 * "answer from supplied authority" while the assignment declares no `requiredAuthorityFactClasses`,
 * the `authorityPlan` is empty, and `CITE_AUTHORITY` is not among the required journey events. The
 * structured checks pass; the instruction is impossible to follow as written.
 *
 * It matters because of where the two paths lead. An author who follows the PROSE invents an
 * authoritative context turn the plan never asked for, and the corpus gains a business fact nobody
 * planned. An author who follows the ASSIGNMENT answers from nowhere — which is the unsupported-claim
 * habit the whole business-fact firewall exists to keep out of the weights. Two conscientious people
 * reading the same brief produce opposite conversations.
 *
 * ### This spec does not fix anything
 *
 * The owner's instruction on the packet is explicit: do not invent authority to resolve it, and do not
 * silently modify the frozen plan. So the four are PINNED here instead. If calibration resolves one —
 * ADR-0108 §18 lists "a brief two authors read two different ways" as exactly what Wave 1 may change —
 * this spec fails and forces the list to be updated rather than the finding quietly disappearing.
 */
import { describe, expect, it } from 'vitest';

import { riyaGoldV1WaveAssignments } from '../gold-v1/plan/generate-plan.js';
import { RIYA_GOLD_V1_WAVE_1_BRIEFS } from '../gold-v1/plan/wave-1-briefs.js';
import { riyaGoldWave1BatchOf } from '../gold-v1/plan/wave-1-batches.js';
import { validateRiyaGoldV1Briefs } from '../gold-v1/service/validate-plan.js';

const WAVE_1 = riyaGoldV1WaveAssignments(1);
const BY_ID = new Map(WAVE_1.map((one) => [one.assignmentId, one]));

/**
 * The four briefs whose prose promises supplied authority the assignment does not require.
 *
 * Each entry is the phrase, so a reworded brief fails loudly rather than silently leaving the list.
 */
const KNOWN_PROSE_AUTHORITY_MISMATCHES: readonly (readonly [string, string])[] = Object.freeze([
  ['gold.v1.w1.hinglish.comparison.01', 'supplied package authority'],
  ['gold.v1.w1.hi.post-summary-qa.01', 'supplied process context'],
  ['gold.v1.w1.hinglish.objection-timeline.01', 'only from supplied authority'],
  ['gold.v1.w1.en.out-of-scope.02', 'from supplied authority'],
]);

describe('the structured authority checks still hold across all 72 briefs', () => {
  it('every brief passes the Gold brief validator', () => {
    const report = validateRiyaGoldV1Briefs(RIYA_GOLD_V1_WAVE_1_BRIEFS, WAVE_1);
    expect(report.findings).toStrictEqual([]);
    expect(report.valid).toBe(true);
  });

  it('an authority plan exists exactly where the assignment requires one', () => {
    for (const brief of RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      const assignment = BY_ID.get(brief.assignmentId);
      expect(assignment, brief.assignmentId).toBeDefined();
      const required = assignment?.requiredAuthorityFactClasses ?? [];
      expect(brief.authorityPlan.length > 0, brief.briefRef).toBe(required.length > 0);
    }
  });
});

describe('KNOWN FINDING: four briefs instruct authority use the assignment does not declare', () => {
  it.each(KNOWN_PROSE_AUTHORITY_MISMATCHES)('%s still says "%s"', (assignmentId, phrase) => {
    const brief = RIYA_GOLD_V1_WAVE_1_BRIEFS.find((one) => one.assignmentId === assignmentId);
    const assignment = BY_ID.get(assignmentId);
    expect(brief, assignmentId).toBeDefined();
    expect(assignment, assignmentId).toBeDefined();

    // The prose says supplied authority...
    expect(brief?.conversationGoal).toContain(phrase);
    // ...and every structured signal says there is none.
    expect(assignment?.requiredAuthorityFactClasses).toStrictEqual([]);
    expect(brief?.authorityPlan).toStrictEqual([]);
    expect(brief?.requiredJourneyEvents).not.toContain('CITE_AUTHORITY');
  });

  it('is exactly four, and no more have appeared', () => {
    // A prose scan, deliberately narrow: the positive instruction "from|using supplied ... authority
    // or context". Negative constraints ("avoid a referral that was not supplied") are consistent
    // with declaring nothing and are not findings, and "can be supplied" is about a refrigerator.
    const POSITIVE = /(?:from|using) supplied [a-z ]*(?:authority|context)/u;
    const found = RIYA_GOLD_V1_WAVE_1_BRIEFS.filter((brief) => {
      const assignment = BY_ID.get(brief.assignmentId);
      return (
        POSITIVE.test(brief.conversationGoal) &&
        (assignment?.requiredAuthorityFactClasses.length ?? 0) === 0
      );
    }).map((brief) => brief.assignmentId);

    expect([...found].sort()).toStrictEqual(
      KNOWN_PROSE_AUTHORITY_MISMATCHES.map(([id]) => id).sort(),
    );
  });

  it('lands in micro-batches 1, 2 and 6 — one of them in the calibration anchor', () => {
    // The anchor carries one, so Wave-1 calibration meets this before the other sixty are written.
    const batches = KNOWN_PROSE_AUTHORITY_MISMATCHES.map(([id]) => riyaGoldWave1BatchOf(id));
    expect([...new Set(batches)].sort()).toStrictEqual([1, 2, 6]);
    expect(riyaGoldWave1BatchOf('gold.v1.w1.hinglish.comparison.01')).toBe(1);
  });

  it('the paired ordinal-02 slot DOES declare the authority the 01 prose borrowed', () => {
    // Which is the likely origin: comparison.02 requires PACKAGE, and the .01 goal was written in the
    // same voice without the declaration following it across.
    const pair = BY_ID.get('gold.v1.w1.hinglish.comparison.02');
    expect(pair?.requiredAuthorityFactClasses).toStrictEqual(['PACKAGE']);
    expect(
      BY_ID.get('gold.v1.w1.hinglish.comparison.01')?.requiredAuthorityFactClasses,
    ).toStrictEqual([]);
  });
});
