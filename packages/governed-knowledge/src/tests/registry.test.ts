/**
 * QFJ-P04.03 — immutable registry and supersession (ADR-0051 §B, §G).
 *
 * Matrix items 12–21: deterministic order; duplicate and content-conflicting identities rejected;
 * exact and topic lookup; supersession existence/newer/cycle validation; a content-free snapshot.
 */
import { describe, expect, it } from 'vitest';

import { GovernedKnowledgeError } from '../contracts/errors.js';
import { createGovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';
import { digest, recordInput } from './fixtures.js';

function expectError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected a GovernedKnowledgeError');
  } catch (error) {
    expect(error).toBeInstanceOf(GovernedKnowledgeError);
    expect((error as GovernedKnowledgeError).code).toBe(code);
  }
}

describe('createGovernedKnowledgeRegistry', () => {
  it('(12) orders records deterministically by id then version', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ knowledgeId: 'kb.b', version: 2, topic: 't-b' }),
      recordInput({ knowledgeId: 'kb.a', version: 1, topic: 't-a' }),
      recordInput({ knowledgeId: 'kb.b', version: 1, topic: 't-b' }),
    ]);
    expect(registry.identityKeys()).toEqual(['kb.a@1', 'kb.b@1', 'kb.b@2']);
  });

  it('(13) rejects a duplicate id/version', () => {
    expectError(
      () => createGovernedKnowledgeRegistry([recordInput(), recordInput()]),
      'duplicate-record',
    );
  });

  it('(14) rejects the same id/version with a conflicting content digest', () => {
    expectError(
      () =>
        createGovernedKnowledgeRegistry([
          recordInput({ contentDigest: digest('a') }),
          recordInput({ contentDigest: digest('b') }),
        ]),
      'conflicting-record',
    );
  });

  it('(15,16) supports exact id/version and exact topic lookup', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ knowledgeId: 'kb.x', version: 3, topic: 'topic-x' }),
    ]);
    expect(registry.resolveExact('kb.x', 3)?.knowledgeId).toBe('kb.x');
    expect(registry.resolveExact('kb.x', 9)).toBeUndefined();
    expect(registry.listByTopic('topic-x').map((r) => r.version)).toEqual([3]);
    expect(registry.listByTopic('missing')).toEqual([]);
  });

  it('(17) rejects a supersededBy that resolves to no record', () => {
    expectError(
      () =>
        createGovernedKnowledgeRegistry([
          recordInput({
            knowledgeId: 'kb.k',
            version: 1,
            supersededBy: { knowledgeId: 'kb.k', version: 2 },
          }),
        ]),
      'supersession-missing',
    );
  });

  it('(18) rejects a supersededBy that does not point to a newer record', () => {
    expectError(
      () =>
        createGovernedKnowledgeRegistry([
          recordInput({ knowledgeId: 'kb.k', version: 1, contentDigest: digest('a') }),
          recordInput({
            knowledgeId: 'kb.k',
            version: 2,
            contentDigest: digest('b'),
            supersededBy: { knowledgeId: 'kb.k', version: 1 },
          }),
        ]),
      'supersession-not-newer',
    );
  });

  it('(19) rejects a supersession cycle', () => {
    expectError(
      () =>
        createGovernedKnowledgeRegistry([
          recordInput({
            knowledgeId: 'kb.k',
            version: 1,
            contentDigest: digest('a'),
            supersededBy: { knowledgeId: 'kb.k', version: 2 },
          }),
          recordInput({
            knowledgeId: 'kb.k',
            version: 2,
            contentDigest: digest('b'),
            supersededBy: { knowledgeId: 'kb.k', version: 1 },
          }),
        ]),
      'supersession-cycle',
    );
  });

  it('accepts a valid supersession chain (older → newer)', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        knowledgeId: 'kb.k',
        version: 1,
        contentDigest: digest('a'),
        lifecycleState: 'RETIRED',
        supersededBy: { knowledgeId: 'kb.k', version: 2 },
      }),
      recordInput({ knowledgeId: 'kb.k', version: 2, contentDigest: digest('b') }),
    ]);
    expect(registry.size).toBe(2);
  });

  it('(21) exposes a frozen snapshot with no content or subject reference', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ content: 'SECRET-BODY', subjectRef: 'subject.person.1' }),
    ]);
    const snapshot = registry.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('SECRET-BODY');
    expect(serialized).not.toContain('subject.person.1');
    expect(snapshot[0]?.subjectLinked).toBe(true);
    expect(snapshot[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    // No `content` key anywhere in the summary.
    expect(Object.keys(snapshot[0] ?? {})).not.toContain('content');
  });
});
