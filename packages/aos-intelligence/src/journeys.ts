import type { AosBehaviourAction } from './behavior.js';

export const AOS_CLIENT_NEXT_BEST_ACTIONS = [
  'NO_CONTACT',
  'WAIT_FOR_HANDOFF',
  'CHECK_SATISFACTION',
  'SUGGEST_RELATED_SERVICE',
  'HUMAN_REVIEW',
] as const;
export type AosClientNextBestAction = (typeof AOS_CLIENT_NEXT_BEST_ACTIONS)[number];

export interface AosClientJourneyInput {
  readonly handoffComplete: boolean;
  readonly successfulVendorContacts: number;
  readonly satisfactionKnown: boolean;
  readonly satisfied: boolean;
  readonly unresolvedIssue: boolean;
  readonly relatedServiceEligible: boolean;
  readonly communicationCooldownActive: boolean;
}

export function planAosClientNextBestAction(input: AosClientJourneyInput): AosClientNextBestAction {
  if (input.unresolvedIssue) return 'HUMAN_REVIEW';
  if (!input.handoffComplete || input.successfulVendorContacts < 3) return 'WAIT_FOR_HANDOFF';
  if (input.communicationCooldownActive) return 'NO_CONTACT';
  if (!input.satisfactionKnown) return 'CHECK_SATISFACTION';
  if (!input.satisfied) return 'NO_CONTACT';
  if (input.relatedServiceEligible) return 'SUGGEST_RELATED_SERVICE';
  return 'NO_CONTACT';
}
export const AOS_VENDOR_NEXT_BEST_ACTIONS = [
  'NO_CONTACT',
  'ASK_FIRST_CONTACT_STATUS',
  'VENDOR_SUCCESS_CHECK',
  'LOW_BALANCE_ALERT',
  'RECHARGE_NUDGE',
  'REACTIVATE_WITH_MASKED_DEMAND',
  'HUMAN_REVIEW',
] as const;
export type AosVendorNextBestAction = (typeof AOS_VENDOR_NEXT_BEST_ACTIONS)[number];

export interface AosVendorJourneyInput {
  readonly assignedLeadAwaitingFirstContact: boolean;
  readonly firstContactSlaBreached: boolean;
  readonly vendorInactiveDays: number;
  readonly matchingDemandAvailable: boolean;
  readonly lowBalance: boolean;
  readonly depletionPredicted: boolean;
  readonly rechargeOpportunity?: boolean;
  readonly retentionRisk?: boolean;
  readonly winbackCandidate?: boolean;
  readonly communicationCooldownActive: boolean;
  readonly unresolvedSupportIssue: boolean;
}

export function planAosVendorNextBestAction(input: AosVendorJourneyInput): AosVendorNextBestAction {
  if (input.unresolvedSupportIssue) return 'HUMAN_REVIEW';
  if (input.communicationCooldownActive) return 'NO_CONTACT';
  if (input.assignedLeadAwaitingFirstContact && input.firstContactSlaBreached) {
    return 'ASK_FIRST_CONTACT_STATUS';
  }
  if (input.retentionRisk === true) return 'VENDOR_SUCCESS_CHECK';
  if (input.lowBalance) return 'LOW_BALANCE_ALERT';
  if (input.rechargeOpportunity === true || input.depletionPredicted) return 'RECHARGE_NUDGE';
  if (
    input.matchingDemandAvailable &&
    (input.winbackCandidate === true || input.vendorInactiveDays >= 30)
  ) {
    return 'REACTIVATE_WITH_MASKED_DEMAND';
  }
  return 'NO_CONTACT';
}

export function behaviourActionForClient(action: AosClientNextBestAction): AosBehaviourAction {
  switch (action) {
    case 'CHECK_SATISFACTION':
      return 'RECOMMEND_RIYA_SATISFACTION_CHECK';
    case 'SUGGEST_RELATED_SERVICE':
      return 'RECOMMEND_RIYA_RELATED_SERVICE';
    case 'HUMAN_REVIEW':
      return 'RECOMMEND_OWNER_REVIEW';
    default:
      return 'NO_CONTACT';
  }
}
export function behaviourActionForVendor(action: AosVendorNextBestAction): AosBehaviourAction {
  switch (action) {
    case 'ASK_FIRST_CONTACT_STATUS':
      return 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP';
    case 'VENDOR_SUCCESS_CHECK':
      return 'RECOMMEND_ANISHA_VENDOR_SUCCESS_CHECK';
    case 'LOW_BALANCE_ALERT':
      return 'RECOMMEND_ANISHA_LOW_BALANCE_ALERT';
    case 'RECHARGE_NUDGE':
      return 'RECOMMEND_ANISHA_RECHARGE_NUDGE';
    case 'REACTIVATE_WITH_MASKED_DEMAND':
      return 'RECOMMEND_ANISHA_VENDOR_REACTIVATION';
    case 'HUMAN_REVIEW':
      return 'RECOMMEND_OWNER_REVIEW';
    default:
      return 'NO_CONTACT';
  }
}
