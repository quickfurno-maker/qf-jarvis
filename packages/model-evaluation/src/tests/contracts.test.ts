/**
 * QFJ-P04.04 — contracts and binding (ADR-0052 §C, §H).
 *
 * Matrix items 1–8: scenario/suite frozen; instant/version validation; invalid/oversized/wildcard/
 * `latest` ids rejected; exact release/prompt/capability/knowledge binding; duplicates rejected;
 * deterministic order/digest; no metadata/secret/provider object; the excluded vendor is absent.
 */
import { describe, expect, it } from 'vitest';

import { EvaluationError } from '../contracts/errors.js';
import { bindingsMatch, releaseKey } from '../contracts/binding.js';
import { createEvaluationScenario } from '../contracts/scenario.js';
import { createEvaluationSuite } from '../contracts/suite.js';
import { createSuiteThresholds } from '../contracts/thresholds.js';
import { contentDigest } from '../contracts/digest.js';
import { EVALUATION_CATEGORIES, RED_TEAM_CASE_KINDS } from '../contracts/vocabularies.js';
import {
  createSyntheticBinding,
  createSyntheticThresholds,
  buildFoundationScenarios,
} from '../testing/fixtures.js';

function expectError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected EvaluationError');
  } catch (error) {
    expect(error).toBeInstanceOf(EvaluationError);
    expect((error as EvaluationError).code).toBe(code);
  }
}

describe('contracts and binding', () => {
  it('(1) freezes a scenario and a suite', () => {
    const scenario = createEvaluationScenario({
      scenarioId: 'scn.a',
      scenarioVersion: 1,
      category: 'BUSINESS_AUTHORITY',
      severity: 'CRITICAL',
      agentScope: 'COORDINATION',
      dataClass: 'HOSTED_ALLOWED',
      taskClass: 'RESPONSE_GENERATION',
      expected: {},
    });
    expect(Object.isFrozen(scenario)).toBe(true);
    expect(Object.isFrozen(scenario.expected)).toBe(true);
    const suite = createEvaluationSuite({
      binding: createSyntheticBinding(),
      scenarios: [scenario],
      thresholds: createSyntheticThresholds(),
    });
    expect(Object.isFrozen(suite)).toBe(true);
    expect(Object.isFrozen(suite.scenarios)).toBe(true);
  });

  it('(2) validates canonical instants and positive versions', () => {
    expectError(() => createSyntheticBinding({ createdAt: '2026-07-25' }), 'invalid-binding');
    expectError(() => createSyntheticBinding({ evaluationSuiteVersion: 0 }), 'invalid-binding');
    expectError(() => createSyntheticBinding({ promptVersion: -1 }), 'invalid-binding');
  });

  it('(3) rejects invalid, oversized, wildcard, and `latest` identities', () => {
    expectError(
      () => createSyntheticBinding({ evaluationSuiteId: 'has space' }),
      'invalid-binding',
    );
    expectError(
      () => createSyntheticBinding({ evaluationSuiteId: 'a'.repeat(129) }),
      'invalid-binding',
    );
    expectError(
      () =>
        createSyntheticBinding({
          release: {
            releaseId: 'latest',
            providerId: 'p',
            modelId: 'm',
            modelVersion: 'v1',
            configDigest: 'abcdef01',
            executionClass: 'HOSTED',
          },
        }),
      'invalid-binding',
    );
    expectError(() => createSyntheticBinding({ promptFamily: 'fam*' }), 'invalid-binding');
  });

  it('(4,5) binds and compares exact release/prompt/capability/knowledge identities', () => {
    const a = createSyntheticBinding();
    const b = createSyntheticBinding();
    expect(bindingsMatch(a, b)).toBe(true);
    expect(releaseKey(a.release)).toBe(releaseKey(b.release));
    // Any single identity difference breaks the match.
    expect(bindingsMatch(a, createSyntheticBinding({ promptVersion: 2 }))).toBe(false);
    expect(
      bindingsMatch(a, createSyntheticBinding({ capabilityProfileRef: 'cap.profile.b' })),
    ).toBe(false);
    expect(bindingsMatch(a, createSyntheticBinding({ knowledgeRevision: 'know.rev.2' }))).toBe(
      false,
    );
    expect(
      bindingsMatch(
        a,
        createSyntheticBinding({
          release: {
            releaseId: 'rel.fake.2',
            providerId: 'fake',
            modelId: 'fake-model',
            modelVersion: 'v1',
            configDigest: 'abcdef01',
            executionClass: 'HOSTED',
          },
        }),
      ),
    ).toBe(false);
  });

  it('(6) rejects a duplicate scenario id/version in a suite', () => {
    const scenario = createEvaluationScenario({
      scenarioId: 'scn.dup',
      scenarioVersion: 1,
      category: 'TASK_QUALITY',
      severity: 'LOW',
      agentScope: 'COORDINATION',
      dataClass: 'HOSTED_ALLOWED',
      taskClass: 'RESPONSE_GENERATION',
      expected: {},
    });
    expectError(
      () =>
        createEvaluationSuite({
          binding: createSyntheticBinding(),
          scenarios: [scenario, scenario],
          thresholds: createSyntheticThresholds(),
        }),
      'duplicate-scenario',
    );
  });

  it('(7) orders scenarios deterministically and digests deterministically', () => {
    const suite = createEvaluationSuite({
      binding: createSyntheticBinding(),
      scenarios: buildFoundationScenarios(),
      thresholds: createSyntheticThresholds(),
    });
    const ids = suite.scenarios.map((s) => s.scenarioId);
    expect(ids).toEqual([...ids].sort());
    expect(contentDigest({ a: 1, b: 2 })).toBe(contentDigest({ b: 2, a: 1 }));
    expect(contentDigest([1, 2, 3])).toBe(contentDigest([1, 2, 3]));
    expect(contentDigest([1, 2, 3])).not.toBe(contentDigest([3, 2, 1]));
  });

  it('(8) rejects an arbitrary metadata bag / unknown field, and excludes the vendor', () => {
    expectError(
      () =>
        createEvaluationScenario({
          scenarioId: 'scn.x',
          scenarioVersion: 1,
          category: 'TASK_QUALITY',
          severity: 'LOW',
          agentScope: 'COORDINATION',
          dataClass: 'HOSTED_ALLOWED',
          taskClass: 'RESPONSE_GENERATION',
          expected: {},
          apiKey: 'sk-000',
        } as unknown as Parameters<typeof createEvaluationScenario>[0]),
      'invalid-scenario',
    );
    const vocab = [...EVALUATION_CATEGORIES, ...RED_TEAM_CASE_KINDS].join(' ').toLowerCase();
    expect(vocab).not.toContain('kimi');
  });

  it('rejects invalid thresholds', () => {
    expectError(
      () => createSuiteThresholds({ thresholdsId: 'bad id', thresholdsVersion: 1 }),
      'invalid-thresholds',
    );
  });
});
