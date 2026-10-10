import { describe, expect, it } from 'vitest';

import { createSystemOneDecisionRequest } from '@qf-jarvis/system-one-decision-runtime';

import { JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1, assessSystemOneDecisionProfile } from '../index.js';

function specialistRouteRequest(input?: {
  actorRef?: string;
  purposeRef?: string;
  mode?: 'SHADOW' | 'ADVISORY';
  timeoutMs?: number;
  includeScore?: boolean;
}) {
  return createSystemOneDecisionRequest({
    runId: 'run.policy.1',
    actorRef: input?.actorRef ?? 'agent.future-specialist',
    purposeRef: input?.purposeRef ?? 'decision.specialist-route.v1',
    dataClass: 'MINIMIZED_BUSINESS',
    mode: input?.mode ?? 'SHADOW',
    state: { signal: 'vendor intent' },
    questions: {
      route: {
        type: 'choice',
        criteria: { RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' },
      },
      review: { type: 'noul' },
      ...(input?.includeScore === true
        ? { score: { type: 'score' as const, criteria: ['low', 'high'] } }
        : {}),
    },
    timeoutMs: input?.timeoutMs ?? 1_000,
  });
}

describe('Jarvis System-One policy registry', () => {
  it('ships every initial decision profile shadow-only with legacy fallback and zero authority', () => {
    expect(JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1.profiles).toHaveLength(10);
    for (const profile of JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1.profiles) {
      expect(profile.phase).toBe('SHADOW');
      expect(profile.fallback).toBe('LEGACY_PATH');
      expect(profile.authorityEffect).toBe('NONE');
      expect(Object.isFrozen(profile)).toBe(true);
    }
  });

  it('allows future governed agent identities without hardcoding agent names', () => {
    expect(
      assessSystemOneDecisionProfile({
        registry: JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1,
        profileRef: 'qfj.system-one.specialist-route.v1',
        request: specialistRouteRequest({ actorRef: 'agent.future-specialist' }),
      }),
    ).toEqual({
      decision: 'SHADOW_ALLOWED',
      registryRef: 'qfj.system-one-profiles.v1',
      profileRef: 'qfj.system-one.specialist-route.v1',
      fallback: 'LEGACY_PATH',
      authorityEffect: 'NONE',
    });
  });

  it('refuses advisory mode until a separately reviewed profile is promoted', () => {
    expect(
      assessSystemOneDecisionProfile({
        registry: JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1,
        profileRef: 'qfj.system-one.specialist-route.v1',
        request: specialistRouteRequest({ mode: 'ADVISORY' }),
      }).decision,
    ).toBe('MODE_DENIED');
  });

  it('rejects purpose, actor namespace, question type and timeout drift', () => {
    const cases = [
      [specialistRouteRequest({ purposeRef: 'decision.other.v1' }), 'PURPOSE_MISMATCH'],
      [specialistRouteRequest({ actorRef: 'operator.owner' }), 'ACTOR_REF_DENIED'],
      [specialistRouteRequest({ includeScore: true }), 'QUESTION_TYPE_DENIED'],
      [specialistRouteRequest({ timeoutMs: 2_001 }), 'TIMEOUT_BUDGET_EXCEEDED'],
    ] as const;

    for (const [request, expected] of cases) {
      expect(
        assessSystemOneDecisionProfile({
          registry: JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1,
          profileRef: 'qfj.system-one.specialist-route.v1',
          request,
        }).decision,
      ).toBe(expected);
    }
  });

  it('refuses unknown profiles and can never return an authority-granting field', () => {
    const result = assessSystemOneDecisionProfile({
      registry: JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1,
      profileRef: 'qfj.system-one.unknown.v1',
      request: specialistRouteRequest(),
    });
    expect(result.decision).toBe('PROFILE_UNKNOWN');
    expect(JSON.stringify(result)).not.toMatch(/approve|execute|authorize/i);
  });
});
