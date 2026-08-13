/**
 * Synthetic knowledge admission goes through the REAL production authority.
 *
 * ### The defect these specs exist for
 *
 * An earlier pass proposed `if (state === 'SUPERSEDED') refuse`, written inside this operator. It
 * would have passed every behavioural test and proved nothing: the operator would have been marking
 * its own homework, and the day production changed its freshness rule the evaluation would have kept
 * asserting the old one.
 *
 * So the situation is materialized into a governed registry and `retrieveGovernedKnowledge` — the
 * production retrieval authority, imported from the package ROOT — decides. The decisive spec is the
 * mutation-shaped one at the bottom: remove the supersession edge and the refusal disappears, which
 * is only true if the authority is really the one refusing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { CandidateGroundedKnowledgeInput } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { describe, expect, it } from 'vitest';

import { admitGroundedInput } from '../governed-grounded-input.js';
import { toGroundedContext } from '../riya-turn.js';

const CURRENT_INPUT: CandidateGroundedKnowledgeInput = Object.freeze({
  state: 'CURRENT',
  records: Object.freeze([
    Object.freeze({
      knowledgeId: 'knowledge.spec.current.alpha',
      version: 1,
      topic: 'synthetic.spec',
      contentFormat: 'text/plain',
      content: 'For this synthetic evaluation only: an invented fact about service.alpha.',
    }),
  ]),
});

const fixtureKnowledge = (kind: string): CandidateGroundedKnowledgeInput => {
  const found = RIYA_SAFETY_FIXTURES.find((one) => one.redTeamKind === kind);
  const knowledge = found?.request.groundedKnowledge;
  if (knowledge === undefined) {
    throw new Error(`no grounded knowledge on ${kind}`);
  }
  return knowledge;
};

describe('a CURRENT record is admitted by the production authority, not by this operator', () => {
  it('returns the records RETRIEVAL produced', () => {
    const admission = admitGroundedInput(CURRENT_INPUT, 'case.spec.current');
    expect(admission.ok).toBe(true);
    if (!admission.ok) {
      return;
    }
    expect(admission.records).toHaveLength(1);
    expect(admission.records[0]?.knowledgeId).toBe('knowledge.spec.current.alpha');
    expect(admission.records[0]?.version).toBe(1);
    // Proof it came through the governed constructor rather than being passed through: a governed
    // record carries lifecycle, permissions and a content digest the candidate input never had.
    expect(admission.records[0]?.lifecycleState).toBe('ACTIVE');
    expect(admission.records[0]?.classification).toBe('HOSTED_ALLOWED');
    expect(admission.records[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('the model-visible context is projected from the RETRIEVED record, and carries five fields', () => {
    const admission = admitGroundedInput(CURRENT_INPUT, 'case.spec.current');
    const context = toGroundedContext(admission.ok ? admission.records : []);
    expect(context?.records).toHaveLength(1);
    expect(Object.keys(context?.records[0] ?? {}).sort()).toStrictEqual([
      'content',
      'contentFormat',
      'knowledgeId',
      'topic',
      'version',
    ]);
    expect(context?.records[0]?.content).toBe(CURRENT_INPUT.records[0]?.content);
    // No governance metadata crosses into what a model can read.
    const serialized = JSON.stringify(context).toLowerCase();
    for (const leak of [
      'lifecycle',
      'permission',
      'approvedby',
      'owner',
      'supersededby',
      'state',
    ]) {
      expect(serialized, `must not carry ${leak}`).not.toContain(leak);
    }
  });

  it('admits the injection fixture, so the malicious record really reaches the model', () => {
    // The whole point of KNOWLEDGE_PROMPT_INJECTION: the attack must arrive as governed DATA. If
    // admission refused it, the case would silently become a boundary test again.
    const admission = admitGroundedInput(
      fixtureKnowledge('KNOWLEDGE_PROMPT_INJECTION'),
      'case.spec.injection',
    );
    expect(admission.ok).toBe(true);
    const context = toGroundedContext(admission.ok ? admission.records : []);
    expect(context?.records[0]?.content).toContain('SENTINEL-SYSTEM-LINE-NEVER-REAL');
  });

  it('admits the fabricated-citation fixture as exactly one known source', () => {
    const admission = admitGroundedInput(
      fixtureKnowledge('FABRICATED_OR_VERSIONLESS_CITATION'),
      'case.spec.citation',
    );
    expect(admission.ok).toBe(true);
    if (!admission.ok) {
      return;
    }
    expect(admission.records).toHaveLength(1);
    expect(admission.records[0]?.knowledgeId).toBe('knowledge.safety.citation.alpha');
  });
});

describe('a SUPERSEDED record is REFUSED by the production authority', () => {
  const supersededInput = (): CandidateGroundedKnowledgeInput =>
    fixtureKnowledge('STALE_OR_SUPERSEDED_FACT');

  it('THE REFUSAL REASON IS THE AUTHORITY’S OWN `knowledge-superseded`', () => {
    const input = supersededInput();
    expect(input.state).toBe('SUPERSEDED');
    const admission = admitGroundedInput(input, 'case.spec.superseded');
    expect(admission.ok).toBe(false);
    if (admission.ok) {
      return;
    }
    expect(admission.refusal).toBe('retrieval-refused');
    // Not an operator string. This is the closed reason `retrieveGovernedKnowledge` returned.
    expect(admission.reason).toBe('knowledge-superseded');
  });

  it('THE SUPERSEDED CONTENT CANNOT REACH A MODEL', () => {
    const admission = admitGroundedInput(supersededInput(), 'case.spec.superseded');
    // Nothing to project — the context builder is never handed a record at all.
    const context = toGroundedContext(admission.ok ? admission.records : []);
    expect(context).toBeUndefined();
    expect(JSON.stringify(context ?? null)).not.toContain('OLD-FIGURE-ALPHA');
  });

  it('the successor exists only to make the edge valid, and is never retrieved', () => {
    const admission = admitGroundedInput(supersededInput(), 'case.spec.superseded');
    expect(admission.ok).toBe(false);
    // v2 is ACTIVE and newer, so a registry containing it is legitimate — but the request selects v1
    // exactly, so the operator never quietly substitutes the replacement.
    expect(JSON.stringify(admission)).not.toContain('superseding revision');
  });

  it('REMOVING THE SUPERSESSION EDGE REMOVES THE REFUSAL', () => {
    // The spec that makes the others mean something. If the refusal came from an operator-local
    // `state === SUPERSEDED` rule, an otherwise identical CURRENT input would still be refused. It is
    // not — so the edge, and the authority reading it, are what did the work.
    const asCurrent: CandidateGroundedKnowledgeInput = {
      state: 'CURRENT',
      records: supersededInput().records,
    };
    const admission = admitGroundedInput(asCurrent, 'case.spec.superseded-as-current');
    expect(admission.ok).toBe(true);
  });
});

describe('a STALE record is refused for expiry, by the same authority', () => {
  it('returns `knowledge-expired` rather than mapping STALE to a pass', () => {
    const stale: CandidateGroundedKnowledgeInput = {
      state: 'STALE',
      records: CURRENT_INPUT.records,
    };
    const admission = admitGroundedInput(stale, 'case.spec.stale');
    expect(admission.ok).toBe(false);
    if (admission.ok) {
      return;
    }
    expect(admission.reason).toBe('knowledge-expired');
  });
});

describe('the seam is the public one', () => {
  it('IMPORTS THE PACKAGE ROOT, NEVER AN INTERNAL PATH', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../governed-grounded-input.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain("from '@qf-jarvis/governed-knowledge'");
    // No deep import, and no reaching past the package's own public surface.
    expect(source).not.toMatch(/@qf-jarvis\/governed-knowledge\//u);
    expect(source).not.toContain('recordEligibility');
    expect(source).not.toContain('../governed-knowledge/src');
  });

  it('CONTAINS NO OPERATOR-LOCAL FRESHNESS VERDICT', () => {
    // Comments stripped: the module documents at length why such a rule would be wrong.
    const code = readFileSync(
      fileURLToPath(new URL('../governed-grounded-input.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');
    // The only permitted mentions of the states are the ones that CONSTRUCT a situation. There is no
    // comparison that yields an admission decision.
    expect(code).not.toMatch(/state\s*===\s*'SUPERSEDED'\s*\)\s*\{?\s*return\s*\{\s*ok:\s*false/u);
    expect(code).not.toContain('knowledge-superseded');
    expect(code).not.toContain('knowledge-expired');
  });
});
