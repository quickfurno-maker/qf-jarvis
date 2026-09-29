import { describe, expect, it } from 'vitest';
import {
  createJarvisDecisionPreflight,
  interpretJarvisDecisionPreflight,
  type DecisionResult,
} from '../index.js';

describe('decision intelligence', () => {
  it('builds a hosted-only advisory preflight without changing actor authority', () => {
    const preflight = createJarvisDecisionPreflight({
      actorRef: 'RIYA',
      dataClass: 'HOSTED_ALLOWED',
      state: { message: 'Please check the order status.' },
      actionCandidates: [
        { actionId: 'request_human_takeover', description: 'Request reviewed human takeover.' },
      ],
    });
    expect(Object.keys(preflight.request.questions)).toStrictEqual([
      'task_shape',
      'ambiguity',
      'human_review',
      'candidate_action',
    ]);
    expect(preflight.candidateActionIds).toStrictEqual(['request_human_takeover']);
  });

  it('refuses LOCAL_ONLY and HUMAN_ONLY before a hosted provider can be called', () => {
    for (const dataClass of ['LOCAL_ONLY', 'HUMAN_ONLY'] as const) {
      expect(() =>
        createJarvisDecisionPreflight({
          actorRef: 'ANISHA',
          dataClass,
          state: 'sensitive',
        }),
      ).toThrow('decision-hosted-data-class-required');
    }
  });

  it('returns a bounded action advisory that can never authorize or execute', () => {
    const preflight = createJarvisDecisionPreflight({
      actorRef: 'AAROHI',
      dataClass: 'HOSTED_ALLOWED',
      state: { message: 'Please have somebody call me.' },
      actionCandidates: [
        { actionId: 'request_human_takeover', description: 'Request human takeover.' },
      ],
    });
    const result: DecisionResult = {
      providerId: 'typesafe-jev',
      model: 'jev-latest',
      usage: { inputTokens: 40, outputTokens: 4 },
      answers: {
        task_shape: {
          type: 'CHOICE',
          choice: 'ACTION_REVIEW',
          confidence: 0.91,
          probabilities: { ACTION_REVIEW: 0.91, DIRECT_RESPONSE: 0.09 },
        },
        ambiguity: {
          type: 'SCORE',
          score: 0.4,
          confidence: 0.88,
          probabilities: { '0': 0.7, '1': 0.2, '2': 0.07, '3': 0.03 },
        },
        human_review: { type: 'BOOLEAN', probability: 0.12 },
        candidate_action: {
          type: 'CHOICE',
          choice: 'request_human_takeover',
          confidence: 0.9,
          probabilities: { request_human_takeover: 0.9, NO_ACTION: 0.1 },
        },
      },
    };
    expect(interpretJarvisDecisionPreflight({ preflight, result })).toStrictEqual({
      status: 'ADVISORY_READY',
      taskShape: 'ACTION_REVIEW',
      ambiguityScore: 0.4,
      candidateActionId: 'request_human_takeover',
      actorAssignmentMutable: false,
      actionProposalAuthorized: false,
      executionAuthorized: false,
    });
  });

  it('fails closed when a provider returns an action outside the reviewed candidate set', () => {
    const preflight = createJarvisDecisionPreflight({
      actorRef: 'JARVIS',
      dataClass: 'HOSTED_ALLOWED',
      state: 'state',
      actionCandidates: [{ actionId: 'known_action', description: 'Known reviewed action.' }],
    });
    const result: DecisionResult = {
      providerId: 'typesafe-jev',
      model: 'jev-latest',
      usage: { inputTokens: 1, outputTokens: 1 },
      answers: {
        task_shape: {
          type: 'CHOICE',
          choice: 'ACTION_REVIEW',
          confidence: 0.9,
          probabilities: { ACTION_REVIEW: 1 },
        },
        ambiguity: { type: 'SCORE', score: 0, confidence: 0.9, probabilities: { '0': 1 } },
        human_review: { type: 'BOOLEAN', probability: 0 },
        candidate_action: {
          type: 'CHOICE',
          choice: 'invented_action',
          confidence: 0.99,
          probabilities: { invented_action: 1 },
        },
      },
    };
    expect(interpretJarvisDecisionPreflight({ preflight, result }).status).toBe('MALFORMED');
  });
});
