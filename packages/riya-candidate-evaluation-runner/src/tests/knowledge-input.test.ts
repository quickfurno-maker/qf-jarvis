/**
 * The synthetic grounded knowledge INPUT contract (MVP-P2A.2 live-evidence inputs).
 *
 * ### What this file is defending
 *
 * A corpus is data, and data that reaches a candidate unchecked is data that can exceed the bound a
 * real grounded turn enforces, carry a governance field the model must never see, or arrive with a
 * lifecycle state nobody defined. The constructor refuses all three, and these specs are the reason it
 * is a constructor rather than a cast.
 *
 * ### And what it is NOT
 *
 * `state` is evaluation execution metadata. It is not a freshness policy, not an admission decision and
 * not a business authority — a spec at the bottom proves no production package can even name the type.
 * Whether a `SUPERSEDED` record is allowed to reach a model is a runtime question this package does not
 * answer and must not appear to.
 */
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_KNOWLEDGE_INPUT_STATES,
  MAX_CANDIDATE_GROUNDED_RECORDS,
  createCandidateGroundedKnowledgeInput,
} from '../contracts/candidate-port.js';
import type {
  CandidateGroundedKnowledgeInput,
  CandidateGroundedKnowledgeRecordInput,
} from '../contracts/candidate-port.js';
import { RiyaCandidateRunnerError } from '../contracts/errors.js';

const RECORD: CandidateGroundedKnowledgeRecordInput = Object.freeze({
  knowledgeId: 'knowledge.spec.alpha',
  version: 1,
  topic: 'synthetic.spec',
  contentFormat: 'text/plain',
  content: 'For this synthetic evaluation only: an invented fact about service.alpha.',
});

const input = (
  overrides: Partial<CandidateGroundedKnowledgeInput> = {},
): CandidateGroundedKnowledgeInput => ({ state: 'CURRENT', records: [RECORD], ...overrides });

const withRecord = (
  overrides: Partial<CandidateGroundedKnowledgeRecordInput>,
): CandidateGroundedKnowledgeInput => input({ records: [{ ...RECORD, ...overrides }] });

const refuses = (value: CandidateGroundedKnowledgeInput): void => {
  expect(() => createCandidateGroundedKnowledgeInput(value)).toThrow(RiyaCandidateRunnerError);
  try {
    createCandidateGroundedKnowledgeInput(value);
  } catch (error) {
    expect(error instanceof RiyaCandidateRunnerError ? error.code : undefined).toBe(
      'KNOWLEDGE_INPUT_INVALID',
    );
  }
};

describe('the input vocabulary is closed and exactly three states wide', () => {
  it('names CURRENT, STALE and SUPERSEDED, and nothing else', () => {
    expect([...CANDIDATE_KNOWLEDGE_INPUT_STATES]).toStrictEqual(['CURRENT', 'STALE', 'SUPERSEDED']);
  });

  it('has NO benign default — a state must be stated', () => {
    // The whole point of the field. An input that could omit its state would be an input every adapter
    // read as CURRENT, which is the guess this exists to prevent.
    refuses({ records: [RECORD] } as unknown as CandidateGroundedKnowledgeInput);
    refuses({ state: 'FRESH', records: [RECORD] } as unknown as CandidateGroundedKnowledgeInput);
  });

  it('accepts each declared state and returns a frozen minimized value', () => {
    for (const state of CANDIDATE_KNOWLEDGE_INPUT_STATES) {
      const proven = createCandidateGroundedKnowledgeInput(input({ state }));
      expect(proven.state).toBe(state);
      expect(Object.isFrozen(proven)).toBe(true);
      expect(Object.isFrozen(proven.records)).toBe(true);
      expect(Object.isFrozen(proven.records[0])).toBe(true);
      expect(Object.keys(proven).sort()).toStrictEqual(['records', 'state']);
    }
  });
});

describe('a malformed record is refused, never repaired', () => {
  it('refuses an empty record set', () => {
    refuses(input({ records: [] }));
  });

  it('refuses more records than a real grounded turn allows', () => {
    expect(MAX_CANDIDATE_GROUNDED_RECORDS).toBe(8);
    const many = Array.from({ length: MAX_CANDIDATE_GROUNDED_RECORDS + 1 }, (_unused, index) => ({
      ...RECORD,
      knowledgeId: `knowledge.spec.${String(index)}`,
    }));
    refuses(input({ records: many }));
    // The ceiling itself is accepted, so the bound is a bound and not an off-by-one.
    expect(
      createCandidateGroundedKnowledgeInput(input({ records: many.slice(0, 8) })).records,
    ).toHaveLength(8);
  });

  it.each([
    ['an empty id', { knowledgeId: '' }],
    ['an id with a space', { knowledgeId: 'knowledge alpha' }],
    ['an over-long id', { knowledgeId: `k.${'a'.repeat(200)}` }],
    ['a zero version', { version: 0 }],
    ['a negative version', { version: -1 }],
    ['a fractional version', { version: 1.5 }],
    ['an empty topic', { topic: '' }],
    ['an untrimmed topic', { topic: ' synthetic.spec ' }],
    ['an empty content format', { contentFormat: '' }],
    ['empty content', { content: '' }],
    ['content beyond the bound', { content: 'x'.repeat(8193) }],
  ])('refuses %s', (_name, overrides) => {
    refuses(withRecord(overrides));
  });

  it('REFUSES AN EXTRA KEY RATHER THAN DROPPING IT', () => {
    // A governance field silently dropped would work today and stop working the day somebody
    // serialized the input a different way. `subjectRef` is the exact field a real grounded context
    // refuses, and it is the one that would eventually carry a customer reference.
    refuses(
      input({
        records: [
          { ...RECORD, subjectRef: 'subject.gamma' } as CandidateGroundedKnowledgeRecordInput,
        ],
      }),
    );
    refuses(
      input({
        records: [{ ...RECORD, permissions: ['read'] } as CandidateGroundedKnowledgeRecordInput],
      }),
    );
  });

  it('refuses a record missing one of the five fields', () => {
    const { content: _dropped, ...withoutContent } = RECORD;
    refuses(input({ records: [withoutContent as CandidateGroundedKnowledgeRecordInput] }));
  });

  it('CANNOT CARRY AN EXPECTATION EVEN IF SOMEBODY TRIES', () => {
    // The answer key has no way in. There is no field for it and an extra one is a refusal.
    for (const key of ['requiresCitation', 'expectedCitation', 'passes', 'severity']) {
      refuses(input({ records: [{ ...RECORD, [key]: true }] }));
    }
  });
});
