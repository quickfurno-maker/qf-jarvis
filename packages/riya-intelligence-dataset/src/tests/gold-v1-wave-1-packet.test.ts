/**
 * HGV1-B — the Batch-1 packet and the schedule document may not drift from the plan.
 *
 * ### Why a docs test earns its place here
 *
 * A committed Markdown packet is a snapshot, and snapshots rot. The plan is generated code; the packet
 * is a file somebody wrote once. When the two disagree, the packet wins in practice — because it is
 * what the author actually reads — and the corpus ends up calibrated against a scenario the plan no
 * longer describes.
 *
 * PR #186 is the worked example: it reworded four Wave-1 briefs. A packet generated before that change
 * would still be telling three authors to answer from supplied authority their assignment no longer
 * promises, and nothing would have caught it.
 *
 * So this file re-derives the anchor from the plan and asserts the committed documents still say the
 * same thing. It deliberately checks **semantic anchors** — ids, closed codes, the current scenario and
 * goal sentences — rather than Markdown shape, because reformatting the packet is not a defect and a
 * test that fails on whitespace gets deleted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { riyaGoldV1WaveAssignments } from '../gold-v1/plan/generate-plan.js';
import { RIYA_GOLD_V1_WAVE_1_BRIEFS } from '../gold-v1/plan/wave-1-briefs.js';
import {
  RIYA_GOLD_WAVE_1_ANCHOR_BATCH,
  RIYA_GOLD_WAVE_1_BATCHES,
  riyaGoldWave1BatchAssignments,
} from '../gold-v1/plan/wave-1-batches.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const PACKET = read('docs/training/riya-human-gold-wave-1-batch-1-packet.md');
const SCHEDULE_DOC = read('docs/training/riya-human-gold-wave-1-batch-schedule.md');

const ANCHOR = riyaGoldWave1BatchAssignments(RIYA_GOLD_WAVE_1_ANCHOR_BATCH);
const ANCHOR_IDS = ANCHOR.map((one) => one.assignmentId);
const BRIEFS = new Map(RIYA_GOLD_V1_WAVE_1_BRIEFS.map((one) => [one.assignmentId, one]));
const WAVE_1_IDS = riyaGoldV1WaveAssignments(1).map((one) => one.assignmentId);

// ---------------------------------------------------------------------------
// The packet holds the anchor, and only the anchor.
// ---------------------------------------------------------------------------

describe('the packet presents exactly the twelve anchor slots', () => {
  it('names every anchor assignment', () => {
    for (const id of ANCHOR_IDS) {
      expect(PACKET, id).toContain(id);
    }
  });

  it('presents no Wave-1 assignment outside the anchor as a slot', () => {
    // A packet that quietly grew a thirteenth slot would be opening work the calibration gate has not
    // approved yet.
    const outside = WAVE_1_IDS.filter((id) => !ANCHOR_IDS.includes(id)).filter((id) =>
      PACKET.includes(`### Slot`) ? PACKET.includes(`\`${id}\``) : false,
    );

    expect(outside).toStrictEqual([]);
  });

  it('has twelve slot headings', () => {
    const headings = PACKET.match(/^### Slot \d+/gmu) ?? [];
    expect(headings).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// Assignment metadata synchronisation.
// ---------------------------------------------------------------------------

describe('the packet carries current assignment metadata', () => {
  it.each(ANCHOR.map((assignment) => [assignment.assignmentId, assignment] as const))(
    '%s shows its current language, kind, difficulty, risk, phase, depth and brief ref',
    (_id, a) => {
      // Scope the search to that slot's section, so a value belonging to a different slot cannot
      // accidentally satisfy the assertion.
      const start = PACKET.indexOf(`\`${a.assignmentId}\``);
      expect(start).toBeGreaterThan(-1);
      const next = PACKET.indexOf('### Slot', start);
      const section = PACKET.slice(start, next === -1 ? PACKET.length : next);

      expect(section).toContain(a.languageMode);
      expect(section).toContain(a.primaryInteractionKind);
      expect(section).toContain(a.difficulty);
      expect(section).toContain(a.riskClass);
      expect(section).toContain(a.startPhase);
      expect(section).toContain(String(a.targetAssistantTurns));
      expect(section).toContain(a.authoringBriefRef);
    },
  );
});

// ---------------------------------------------------------------------------
// Brief synchronisation — the part PR #186 proved can rot.
// ---------------------------------------------------------------------------

describe('the packet carries the CURRENT brief text', () => {
  it.each(ANCHOR_IDS)('%s shows the current situation and goal verbatim', (id) => {
    const brief = BRIEFS.get(id);
    expect(brief, id).toBeDefined();
    if (brief === undefined) return;

    expect(PACKET).toContain(brief.customerSituation);
    expect(PACKET).toContain(brief.conversationGoal);
  });
});

// ---------------------------------------------------------------------------
// Authority synchronisation.
// ---------------------------------------------------------------------------

describe('the packet states authority exactly as the assignment requires', () => {
  it.each(ANCHOR.map((assignment) => [assignment.assignmentId, assignment] as const))(
    '%s matches its required authority classes',
    (_id, a) => {
      const start = PACKET.indexOf(`\`${a.assignmentId}\``);
      const next = PACKET.indexOf('### Slot', start);
      const section = PACKET.slice(start, next === -1 ? PACKET.length : next);

      if (a.requiredAuthorityFactClasses.length === 0) {
        // "None" must mean none, and the slot must warn against inventing one.
        expect(section).toContain('Required authority fact classes:** None');
        expect(section).toContain('Do not invent authoritative context');
      } else {
        expect(section).not.toContain('Required authority fact classes:** None');
        for (const factClass of a.requiredAuthorityFactClasses) {
          expect(section, factClass).toContain(factClass);
        }
      }
    },
  );

  it('slot 8 shows PROCESS, proving the packet was built from repaired main', () => {
    // Before PR #186 this assignment required GROUNDING_QA with no authority class at all. A packet
    // generated from pre-repair source would say "None" here.
    const id = 'gold.v1.w1.hi.out-of-scope.02';
    const start = PACKET.indexOf(`\`${id}\``);
    const next = PACKET.indexOf('### Slot', start);
    const section = PACKET.slice(start, next === -1 ? PACKET.length : next);

    expect(section).toContain('PROCESS');
    expect(section).toContain('GROUNDING_QA');
    expect(section).toContain('OUT_OF_SCOPE');
    expect(section).not.toContain('Required authority fact classes:** None');
  });
});

// ---------------------------------------------------------------------------
// Review-count synchronisation.
// ---------------------------------------------------------------------------

describe('the packet states the right number of independent reviews', () => {
  it.each(ANCHOR.map((assignment) => [assignment.assignmentId, assignment] as const))(
    '%s states one review for STANDARD and two for HIGH_RISK',
    (_id, a) => {
      const start = PACKET.indexOf(`\`${a.assignmentId}\``);
      const next = PACKET.indexOf('### Slot', start);
      const section = PACKET.slice(start, next === -1 ? PACKET.length : next);

      if (a.riskClass === 'HIGH_RISK') {
        expect(section).toContain('**two** distinct independent accepted reviews');
      } else {
        expect(section).toContain('**one** independent accepted review');
      }
      expect(section).toContain('The reviewer may not be you');
    },
  );
});

// ---------------------------------------------------------------------------
// The packet is instructions, not answers.
// ---------------------------------------------------------------------------

describe('the packet contains no dialogue', () => {
  it('has no turn markers, turn arrays or trajectory JSON', () => {
    // These literals are CONTAINMENT ASSERTIONS. They are the shapes a packet must never grow, and
    // they are not corpus content.
    for (const forbidden of [
      'Customer:',
      'Riya:',
      '"type":"USER"',
      '"type": "USER"',
      '"type":"ASSISTANT"',
      '"type": "ASSISTANT"',
      '```json',
      'Example conversation',
      'Sample dialogue',
      'Suggested opener',
    ]) {
      expect(PACKET, forbidden).not.toContain(forbidden);
    }
  });

  it('says plainly that the human writes the words', () => {
    expect(PACKET).toContain('YOU WRITE THE WORDS');
    expect(PACKET).toContain('ZERO GOLD DIALOGUE');
    expect(PACKET).toContain('cannot** become Human Gold by approval');
    expect(PACKET).toContain('cannot** become Human Gold by editing');
    expect(PACKET).toContain('cannot** become Human Gold by paraphrasing');
    expect(PACKET).toContain('process-attested');
  });

  it('does not open batches 2-6', () => {
    expect(PACKET).toContain('Batch 1 is the calibration anchor');
    expect(PACKET).not.toContain('all 72');
    expect(PACKET).not.toContain('Wave 1 authoring is open');
  });
});

// ---------------------------------------------------------------------------
// The schedule document.
// ---------------------------------------------------------------------------

describe('the schedule document matches the scheduler', () => {
  it('states six batches of twelve totalling 72', () => {
    expect(SCHEDULE_DOC).toContain('Six micro-batches of twelve = 72');
    expect(RIYA_GOLD_WAVE_1_BATCHES).toHaveLength(6);
  });

  it('lists the anchor in scheduler order', () => {
    const positions = ANCHOR_IDS.map((id) => SCHEDULE_DOC.indexOf(id));
    expect(positions.every((p) => p > -1)).toBe(true);
    // Monotonically increasing means the document lists them in the same order the scheduler emits.
    expect([...positions].sort((a, b) => a - b)).toStrictEqual(positions);
  });

  it('names Batch 1 as the calibration anchor and gates the rest', () => {
    expect(SCHEDULE_DOC).toContain('calibration anchor');
    expect(SCHEDULE_DOC).toContain('read end to end before batches');
    expect(SCHEDULE_DOC).toContain('remain blocked until Batch-1 calibration is accepted');
  });

  it('says the schedule is not a planning authority', () => {
    expect(SCHEDULE_DOC).toContain('not a planning authority');
  });

  it('carries no dialogue either', () => {
    for (const forbidden of ['Customer:', 'Riya:', '"USER"', '"ASSISTANT"']) {
      expect(SCHEDULE_DOC, forbidden).not.toContain(forbidden);
    }
  });
});
