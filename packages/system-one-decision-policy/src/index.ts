import type {
  SystemOneDataClass,
  SystemOneDecisionQuestion,
  SystemOneDecisionRequest,
} from '@qf-jarvis/system-one-decision-runtime';

export const SYSTEM_ONE_PROFILE_PHASES = ['DISABLED', 'SHADOW', 'ADVISORY'] as const;
export type SystemOneProfilePhase = (typeof SYSTEM_ONE_PROFILE_PHASES)[number];

export const SYSTEM_ONE_QUESTION_TYPES = ['noul', 'choice', 'score'] as const;
export type SystemOneQuestionType = (typeof SYSTEM_ONE_QUESTION_TYPES)[number];

export interface SystemOneDecisionProfile {
  readonly profileRef: string;
  readonly purposeRef: string;
  readonly phase: SystemOneProfilePhase;
  readonly allowedDataClasses: readonly SystemOneDataClass[];
  readonly allowedQuestionTypes: readonly SystemOneQuestionType[];
  readonly maxQuestions: number;
  readonly maxTimeoutMs: number;
  readonly fallback: 'LEGACY_PATH';
  readonly authorityEffect: 'NONE';
}

export interface SystemOneDecisionProfileRegistry {
  readonly registryRef: string;
  readonly profiles: readonly SystemOneDecisionProfile[];
}

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const GOVERNED_ACTOR_REF = /^(?:agent|jarvis).[A-Za-z0-9._:-]{1,128}$/u;

function freezeProfile(profile: SystemOneDecisionProfile): SystemOneDecisionProfile {
  return Object.freeze({
    ...profile,
    allowedDataClasses: Object.freeze([...profile.allowedDataClasses]),
    allowedQuestionTypes: Object.freeze([...profile.allowedQuestionTypes]),
  });
}

function validateProfile(profile: SystemOneDecisionProfile): void {
  if (
    !REF.test(profile.profileRef) ||
    !REF.test(profile.purposeRef) ||
    !SYSTEM_ONE_PROFILE_PHASES.includes(profile.phase) ||
    profile.allowedDataClasses.length < 1 ||
    new Set(profile.allowedDataClasses).size !== profile.allowedDataClasses.length ||
    profile.allowedQuestionTypes.length < 1 ||
    new Set(profile.allowedQuestionTypes).size !== profile.allowedQuestionTypes.length ||
    profile.allowedQuestionTypes.some((one) => !SYSTEM_ONE_QUESTION_TYPES.includes(one)) ||
    !Number.isInteger(profile.maxQuestions) ||
    profile.maxQuestions < 1 ||
    profile.maxQuestions > 32 ||
    !Number.isInteger(profile.maxTimeoutMs) ||
    profile.maxTimeoutMs < 50 ||
    profile.maxTimeoutMs > 30_000
  ) {
    throw new TypeError('system-one-decision-profile-invalid');
  }
}

export function createSystemOneDecisionProfileRegistry(input: {
  readonly registryRef: string;
  readonly profiles: readonly SystemOneDecisionProfile[];
}): SystemOneDecisionProfileRegistry {
  if (!REF.test(input.registryRef) || input.profiles.length < 1 || input.profiles.length > 64) {
    throw new TypeError('system-one-decision-profile-registry-invalid');
  }
  const seen = new Set<string>();
  const profiles = input.profiles.map((profile) => {
    validateProfile(profile);
    if (seen.has(profile.profileRef)) {
      throw new TypeError('system-one-decision-profile-registry-duplicate');
    }
    seen.add(profile.profileRef);
    return freezeProfile(profile);
  });
  return Object.freeze({
    registryRef: input.registryRef,
    profiles: Object.freeze(profiles),
  });
}

export type SystemOneProfileAdmissionDecision =
  | {
      readonly decision: 'SHADOW_ALLOWED' | 'ADVISORY_ALLOWED';
      readonly registryRef: string;
      readonly profileRef: string;
      readonly fallback: 'LEGACY_PATH';
      readonly authorityEffect: 'NONE';
    }
  | {
      readonly decision:
        | 'PROFILE_UNKNOWN'
        | 'PROFILE_DISABLED'
        | 'MODE_DENIED'
        | 'ACTOR_REF_DENIED'
        | 'PURPOSE_MISMATCH'
        | 'DATA_CLASS_DENIED'
        | 'QUESTION_TYPE_DENIED'
        | 'QUESTION_BUDGET_EXCEEDED'
        | 'TIMEOUT_BUDGET_EXCEEDED';
      readonly registryRef: string;
      readonly profileRef: string;
    };

function questionType(question: SystemOneDecisionQuestion): SystemOneQuestionType {
  return question.type;
}

export function assessSystemOneDecisionProfile(input: {
  readonly registry: SystemOneDecisionProfileRegistry;
  readonly profileRef: string;
  readonly request: SystemOneDecisionRequest;
}): SystemOneProfileAdmissionDecision {
  const base = {
    registryRef: input.registry.registryRef,
    profileRef: input.profileRef,
  };
  const profile = input.registry.profiles.find((one) => one.profileRef === input.profileRef);
  if (profile === undefined) {
    return Object.freeze({ ...base, decision: 'PROFILE_UNKNOWN' as const });
  }
  if (profile.phase === 'DISABLED') {
    return Object.freeze({ ...base, decision: 'PROFILE_DISABLED' as const });
  }
  if (!GOVERNED_ACTOR_REF.test(input.request.actorRef)) {
    return Object.freeze({ ...base, decision: 'ACTOR_REF_DENIED' as const });
  }
  if (input.request.purposeRef !== profile.purposeRef) {
    return Object.freeze({ ...base, decision: 'PURPOSE_MISMATCH' as const });
  }
  if (!profile.allowedDataClasses.includes(input.request.dataClass)) {
    return Object.freeze({ ...base, decision: 'DATA_CLASS_DENIED' as const });
  }
  const questions = Object.values(input.request.questions);
  if (questions.length > profile.maxQuestions) {
    return Object.freeze({ ...base, decision: 'QUESTION_BUDGET_EXCEEDED' as const });
  }
  if (questions.some((one) => !profile.allowedQuestionTypes.includes(questionType(one)))) {
    return Object.freeze({ ...base, decision: 'QUESTION_TYPE_DENIED' as const });
  }
  if (input.request.timeoutMs > profile.maxTimeoutMs) {
    return Object.freeze({ ...base, decision: 'TIMEOUT_BUDGET_EXCEEDED' as const });
  }
  if (profile.phase === 'SHADOW' && input.request.mode !== 'SHADOW') {
    return Object.freeze({ ...base, decision: 'MODE_DENIED' as const });
  }
  return Object.freeze({
    ...base,
    decision:
      input.request.mode === 'ADVISORY'
        ? ('ADVISORY_ALLOWED' as const)
        : ('SHADOW_ALLOWED' as const),
    fallback: 'LEGACY_PATH' as const,
    authorityEffect: 'NONE' as const,
  });
}

function shadowProfile(
  profileRef: string,
  purposeRef: string,
  allowedQuestionTypes: readonly SystemOneQuestionType[],
  maxQuestions: number,
  maxTimeoutMs: number,
): SystemOneDecisionProfile {
  return {
    profileRef,
    purposeRef,
    phase: 'SHADOW',
    allowedDataClasses: ['PUBLIC', 'MINIMIZED_BUSINESS'],
    allowedQuestionTypes,
    maxQuestions,
    maxTimeoutMs,
    fallback: 'LEGACY_PATH',
    authorityEffect: 'NONE',
  };
}

export const JARVIS_SYSTEM_ONE_PROFILE_REGISTRY_V1 = createSystemOneDecisionProfileRegistry({
  registryRef: 'qfj.system-one-profiles.v1',
  profiles: [
    shadowProfile(
      'qfj.system-one.specialist-route.v1',
      'decision.specialist-route.v1',
      ['choice', 'noul'],
      3,
      2_000,
    ),
    shadowProfile(
      'qfj.system-one.handoff-candidate.v1',
      'decision.handoff-candidate.v1',
      ['choice', 'noul'],
      3,
      2_000,
    ),
    shadowProfile(
      'qfj.system-one.action-risk-screen.v1',
      'decision.action-risk-screen.v1',
      ['choice', 'score', 'noul'],
      4,
      2_000,
    ),
    shadowProfile(
      'qfj.system-one.answer-confidence.v1',
      'decision.answer-confidence.v1',
      ['score', 'noul'],
      4,
      2_000,
    ),
    shadowProfile(
      'qfj.system-one.retrieval-relevance.v1',
      'decision.retrieval-relevance.v1',
      ['score', 'choice'],
      8,
      2_500,
    ),
    shadowProfile(
      'qfj.system-one.proactive-priority.v1',
      'decision.proactive-priority.v1',
      ['score', 'choice', 'noul'],
      5,
      2_000,
    ),
    shadowProfile(
      'qfj.system-one.model-route.v1',
      'decision.model-route.v1',
      ['choice', 'score'],
      4,
      1_500,
    ),
    shadowProfile(
      'qfj.system-one.memory-importance.v1',
      'decision.memory-importance.v1',
      ['score', 'noul'],
      3,
      1_500,
    ),
    shadowProfile(
      'qfj.system-one.knowledge-freshness.v1',
      'decision.knowledge-freshness.v1',
      ['score', 'noul'],
      3,
      1_500,
    ),
    shadowProfile(
      'qfj.system-one.voice-intent.v1',
      'decision.voice-intent.v1',
      ['choice', 'noul'],
      4,
      1_200,
    ),
  ],
});
