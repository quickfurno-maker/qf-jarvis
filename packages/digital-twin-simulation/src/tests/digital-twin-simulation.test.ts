import { describe, expect, it } from 'vitest';

import { compareDigitalTwinSuites, runDigitalTwinSuite } from '../index.js';

const zero = {
  providerCalls: 0,
  coreMutations: 0,
  channelSends: 0,
  workflowStarts: 0,
  databaseWrites: 0,
} as const;

describe('digital twin simulation', () => {
  it('passes deterministic no-effect scenarios', async () => {
    const result = await runDigitalTwinSuite({
      scenarios: [
        { scenarioId: 'routing.simple', input: { value: 1 }, expectedDecision: 'ANSWER' },
        {
          scenarioId: 'handoff.vendor',
          input: { value: 2 },
          expectedDecision: 'HANDOFF_PROPOSAL_READY',
          expectedArtifact: { target: 'ANISHA' },
        },
      ],
      candidate: {
        run(input: unknown) {
          const value = (input as { value: number }).value;
          return Promise.resolve(
            value === 1
              ? { decision: 'ANSWER', effects: zero }
              : {
                  decision: 'HANDOFF_PROPOSAL_READY',
                  artifact: { target: 'ANISHA' },
                  effects: zero,
                },
          );
        },
      },
    });
    expect(result).toMatchObject({ scenarioCount: 2, passed: 2, failed: 0 });
  });

  it('fails a simulation that tries to create any real effect', async () => {
    const result = await runDigitalTwinSuite({
      scenarios: [{ scenarioId: 'unsafe.send', input: {}, expectedDecision: 'ANSWER' }],
      candidate: {
        run() {
          return Promise.resolve({
            decision: 'ANSWER',
            effects: { ...zero, channelSends: 1 },
          });
        },
      },
    });
    expect(result.results[0]).toMatchObject({ pass: false, reason: 'EFFECT_OCCURRED' });
  });

  it('reports a candidate exception as a failed scenario without leaking the error', async () => {
    const result = await runDigitalTwinSuite({
      scenarios: [{ scenarioId: 'candidate.crash', input: {}, expectedDecision: 'ANSWER' }],
      candidate: {
        run() {
          return Promise.reject(new Error('secret raw provider body'));
        },
      },
    });
    expect(result.results[0]).toEqual({
      scenarioId: 'candidate.crash',
      pass: false,
      decision: 'CANDIDATE_FAILED',
      reason: 'CANDIDATE_FAILED',
    });
    expect(JSON.stringify(result)).not.toContain('secret raw provider body');
  });

  it('compares baseline and candidate suites into regressions and improvements', () => {
    const baseline = {
      protocol: 'qfj.digital-twin-suite.v1' as const,
      scenarioCount: 3,
      passed: 2,
      failed: 1,
      results: [
        { scenarioId: 'a', pass: true, decision: 'A', reason: 'MATCH' as const },
        { scenarioId: 'b', pass: false, decision: 'B', reason: 'DECISION_MISMATCH' as const },
        { scenarioId: 'c', pass: true, decision: 'C', reason: 'MATCH' as const },
      ],
    };
    const candidate = {
      protocol: 'qfj.digital-twin-suite.v1' as const,
      scenarioCount: 3,
      passed: 2,
      failed: 1,
      results: [
        { scenarioId: 'a', pass: false, decision: 'X', reason: 'DECISION_MISMATCH' as const },
        { scenarioId: 'b', pass: true, decision: 'B', reason: 'MATCH' as const },
        { scenarioId: 'c', pass: true, decision: 'C', reason: 'MATCH' as const },
      ],
    };
    expect(compareDigitalTwinSuites(baseline, candidate)).toEqual({
      regressions: ['a'],
      improvements: ['b'],
      unchanged: ['c'],
    });
  });
});
