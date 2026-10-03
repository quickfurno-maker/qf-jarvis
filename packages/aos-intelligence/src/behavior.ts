import type { AosPriority, AosRecommendationAction } from './contracts.js';
import { validNonNegativeInt, validRef } from './validation.js';

export const AOS_BEHAVIOUR_LIFECYCLES = ['DRAFT', 'SHADOW', 'SUGGESTING', 'RETIRED'] as const;
export type AosBehaviourLifecycle = (typeof AOS_BEHAVIOUR_LIFECYCLES)[number];

export const AOS_BEHAVIOUR_TRIGGERS = [
  'LEAD_ASSIGNED',
  'LEAD_FIRST_CONTACT_GAP',
  'VENDOR_FIRST_CONTACT_MISSING',
  'LEAD_HANDOFF_COMPLETE',
  'CLIENT_FOLLOW_UP_DUE',
  'CLIENT_SATISFACTION_POSITIVE',
  'CLIENT_SATISFACTION_NEGATIVE',
  'CLIENT_RELATED_SERVICE_ELIGIBLE',
  'VENDOR_LOW_BALANCE',
  'VENDOR_CREDIT_DEPLETION_PREDICTED',
  'VENDOR_RECHARGE_OPPORTUNITY',
  'VENDOR_PACKAGE_READINESS_LOW',
  'VENDOR_COMPLAINT_RECORDED',
  'VENDOR_INACTIVE',
  'VENDOR_RETENTION_RISK',
  'VENDOR_WINBACK_CANDIDATE',
  'MATCHING_DEMAND_DETECTED',
  'VENDOR_RESPONSE_DEGRADED',
  'SUPPLY_SHORTAGE',
] as const;
export type AosBehaviourTrigger = (typeof AOS_BEHAVIOUR_TRIGGERS)[number];

export const AOS_BEHAVIOUR_ACTIONS = [
  'NO_CONTACT',
  'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP',
  'RECOMMEND_REPLACEMENT_VENDOR',
  'RECOMMEND_RIYA_CLIENT_FOLLOW_UP',
  'RECOMMEND_RIYA_SATISFACTION_CHECK',
  'RECOMMEND_RIYA_RELATED_SERVICE',
  'RECOMMEND_ANISHA_LOW_BALANCE_ALERT',
  'RECOMMEND_ANISHA_RECHARGE_NUDGE',
  'RECOMMEND_ANISHA_VENDOR_REACTIVATION',
  'RECOMMEND_ANISHA_VENDOR_SUCCESS_CHECK',
  'RECOMMEND_AAROHI_SUPPLY_ACQUISITION',
  'RECOMMEND_OWNER_REVIEW',
] as const;
export type AosBehaviourAction = (typeof AOS_BEHAVIOUR_ACTIONS)[number];
export const AOS_CONDITION_FIELDS = [
  'elapsedMinutes',
  'successfulVendorContacts',
  'vendorExposureCount',
  'vendorInactiveDays',
  'matchingDemandCount',
  'vendorResponseRate',
  'clientSatisfactionScore',
  'relatedServiceScore',
  'daysSinceHandoff',
] as const;
export type AosConditionField = (typeof AOS_CONDITION_FIELDS)[number];

export const AOS_CONDITION_OPERATORS = ['LT', 'LTE', 'EQ', 'GTE', 'GT'] as const;
export type AosConditionOperator = (typeof AOS_CONDITION_OPERATORS)[number];

export interface AosNumericCondition {
  readonly field: AosConditionField;
  readonly operator: AosConditionOperator;
  readonly value: number;
}

export interface AosBehaviourScope {
  readonly cityRefs: readonly string[];
  readonly localityRefs: readonly string[];
  readonly categoryRefs: readonly string[];
}

export interface AosCommunicationGuardrails {
  readonly cooldownMinutes: number;
  readonly maxMessagesPer30Days: number;
  readonly quietHoursLocal?: {
    readonly startHour: number;
    readonly endHour: number;
  };
  readonly directPhoneAllowed: false;
  readonly maskedOpportunityOnly: boolean;
}
export interface AosBehaviourPolicy {
  readonly policyId: string;
  readonly version: number;
  readonly lifecycle: AosBehaviourLifecycle;
  readonly title: string;
  readonly trigger: AosBehaviourTrigger;
  readonly priority: AosPriority;
  readonly scope: AosBehaviourScope;
  readonly conditions: readonly AosNumericCondition[];
  readonly action: AosBehaviourAction;
  readonly ownerApprovalRequired: boolean;
  readonly coreDecisionRequired: boolean;
  readonly maximumVendorExposureWithoutOwnerApproval: 3;
  readonly communication: AosCommunicationGuardrails;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

function validateScope(scope: AosBehaviourScope): void {
  for (const refs of [scope.cityRefs, scope.localityRefs, scope.categoryRefs]) {
    if (refs.length > 64 || refs.some((ref) => !validRef(ref))) {
      throw new TypeError('aos-behaviour-scope-invalid');
    }
  }
}

function validateCondition(condition: AosNumericCondition): void {
  if (
    !AOS_CONDITION_FIELDS.includes(condition.field) ||
    !AOS_CONDITION_OPERATORS.includes(condition.operator) ||
    !Number.isFinite(condition.value)
  ) {
    throw new TypeError('aos-behaviour-condition-invalid');
  }
}
function validateCommunication(input: AosCommunicationGuardrails): void {
  const raw = input as unknown as Readonly<Record<string, unknown>>;
  if (
    !validNonNegativeInt(input.cooldownMinutes, 525_600) ||
    !validNonNegativeInt(input.maxMessagesPer30Days, 100) ||
    raw['directPhoneAllowed'] !== false
  ) {
    throw new TypeError('aos-behaviour-communication-invalid');
  }
  if (
    input.quietHoursLocal !== undefined &&
    (!Number.isInteger(input.quietHoursLocal.startHour) ||
      !Number.isInteger(input.quietHoursLocal.endHour) ||
      input.quietHoursLocal.startHour < 0 ||
      input.quietHoursLocal.startHour > 23 ||
      input.quietHoursLocal.endHour < 0 ||
      input.quietHoursLocal.endHour > 23 ||
      input.quietHoursLocal.startHour === input.quietHoursLocal.endHour)
  ) {
    throw new TypeError('aos-behaviour-communication-invalid');
  }
}

export function createAosBehaviourPolicy(
  input: Omit<AosBehaviourPolicy, 'executionAuthority' | 'businessEffect'>,
): AosBehaviourPolicy {
  const raw = input as unknown as Readonly<Record<string, unknown>>;
  if (
    !validRef(input.policyId) ||
    !validNonNegativeInt(input.version, 1_000_000) ||
    input.version < 1 ||
    !AOS_BEHAVIOUR_LIFECYCLES.includes(input.lifecycle) ||
    input.title.trim().length < 1 ||
    input.title.length > 120 ||
    !AOS_BEHAVIOUR_TRIGGERS.includes(input.trigger) ||
    !AOS_BEHAVIOUR_ACTIONS.includes(input.action) ||
    raw['maximumVendorExposureWithoutOwnerApproval'] !== 3 ||
    input.conditions.length > 12
  ) {
    throw new TypeError('aos-behaviour-policy-invalid');
  }
  validateScope(input.scope);
  input.conditions.forEach(validateCondition);
  validateCommunication(input.communication);

  if (input.action === 'RECOMMEND_REPLACEMENT_VENDOR' && !input.ownerApprovalRequired) {
    throw new TypeError('aos-replacement-owner-approval-required');
  }

  return Object.freeze({
    ...input,
    title: input.title.trim(),
    scope: Object.freeze({
      cityRefs: Object.freeze([...new Set(input.scope.cityRefs)].sort()),
      localityRefs: Object.freeze([...new Set(input.scope.localityRefs)].sort()),
      categoryRefs: Object.freeze([...new Set(input.scope.categoryRefs)].sort()),
    }),
    conditions: Object.freeze(input.conditions.map((condition) => Object.freeze({ ...condition }))),
    communication: Object.freeze({
      ...input.communication,
      ...(input.communication.quietHoursLocal === undefined
        ? {}
        : { quietHoursLocal: Object.freeze({ ...input.communication.quietHoursLocal }) }),
    }),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export interface AosBehaviourContext {
  readonly cityRef?: string;
  readonly localityRef?: string;
  readonly categoryRef?: string;
  readonly metrics: Readonly<Partial<Record<AosConditionField, number>>>;
}
function appliesToScope(policy: AosBehaviourPolicy, context: AosBehaviourContext): boolean {
  const checks: readonly [readonly string[], string | undefined][] = [
    [policy.scope.cityRefs, context.cityRef],
    [policy.scope.localityRefs, context.localityRef],
    [policy.scope.categoryRefs, context.categoryRef],
  ];
  return checks.every(
    ([allowed, actual]) =>
      allowed.length === 0 || (actual !== undefined && allowed.includes(actual)),
  );
}

function compare(actual: number, condition: AosNumericCondition): boolean {
  switch (condition.operator) {
    case 'LT':
      return actual < condition.value;
    case 'LTE':
      return actual <= condition.value;
    case 'EQ':
      return actual === condition.value;
    case 'GTE':
      return actual >= condition.value;
    case 'GT':
      return actual > condition.value;
  }
}

export function evaluateAosBehaviourPolicy(
  policy: AosBehaviourPolicy,
  trigger: AosBehaviourTrigger,
  context: AosBehaviourContext,
): { readonly matched: boolean; readonly action: AosBehaviourAction | 'NONE' } {
  if (policy.lifecycle === 'DRAFT' || policy.lifecycle === 'RETIRED') {
    return Object.freeze({ matched: false, action: 'NONE' as const });
  }
  if (policy.trigger !== trigger || !appliesToScope(policy, context)) {
    return Object.freeze({ matched: false, action: 'NONE' as const });
  }
  for (const condition of policy.conditions) {
    const actual = context.metrics[condition.field];
    if (actual === undefined || !Number.isFinite(actual) || !compare(actual, condition)) {
      return Object.freeze({ matched: false, action: 'NONE' as const });
    }
  }
  return Object.freeze({ matched: true, action: policy.action });
}

export function recommendationActionForBehaviour(
  action: AosBehaviourAction,
): AosRecommendationAction {
  switch (action) {
    case 'NO_CONTACT':
      return 'NO_ACTION';
    case 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP':
      return 'REQUEST_VENDOR_REMINDER';
    case 'RECOMMEND_REPLACEMENT_VENDOR':
      return 'REQUEST_REPLACEMENT_BATCH';
    case 'RECOMMEND_RIYA_CLIENT_FOLLOW_UP':
      return 'REQUEST_CLIENT_FOLLOW_UP';
    case 'RECOMMEND_RIYA_SATISFACTION_CHECK':
      return 'REQUEST_SATISFACTION_CHECK';
    case 'RECOMMEND_RIYA_RELATED_SERVICE':
      return 'REQUEST_RELATED_SERVICE_SUGGESTION';
    case 'RECOMMEND_ANISHA_LOW_BALANCE_ALERT':
      return 'REQUEST_LOW_BALANCE_ALERT';
    case 'RECOMMEND_ANISHA_RECHARGE_NUDGE':
      return 'REQUEST_RECHARGE_NUDGE';
    case 'RECOMMEND_ANISHA_VENDOR_REACTIVATION':
      return 'REQUEST_VENDOR_REACTIVATION';
    case 'RECOMMEND_ANISHA_VENDOR_SUCCESS_CHECK':
      return 'REQUEST_VENDOR_SUCCESS_FOLLOW_UP';
    case 'RECOMMEND_AAROHI_SUPPLY_ACQUISITION':
      return 'REQUEST_VENDOR_ACQUISITION_REVIEW';
    case 'RECOMMEND_OWNER_REVIEW':
      return 'REQUEST_HUMAN_REVIEW';
  }
}
