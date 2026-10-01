import type {
  ClientNextBestAction,
  ClientNextBestActionInput,
  ClientNextBestActionType,
} from './contracts.js';
import { assertRef, assertUniqueRefs } from './validation.js';

function action(
  type: ClientNextBestActionType,
  reasonCode: string,
  requiresCoreDecision: boolean,
  extra: { readonly requiredFieldRef?: string; readonly serviceRef?: string } = {},
): ClientNextBestAction {
  assertRef(reasonCode, 'client-next-best-action-reason-invalid');
  return Object.freeze({
    action: type,
    reasonCode,
    ...(extra.requiredFieldRef === undefined ? {} : { requiredFieldRef: extra.requiredFieldRef }),
    ...(extra.serviceRef === undefined ? {} : { serviceRef: extra.serviceRef }),
    requiresCoreDecision,
    businessEffect: false as const,
    executionAuthorized: false as const,
  });
}

function validateInput(input: ClientNextBestActionInput): void {
  assertUniqueRefs(
    input.missingMandatoryFieldRefs,
    'client-next-best-action-missing-field-invalid',
  );
  for (const value of [input.vendorsReleased, input.vendorNoContactCount]) {
    if (!Number.isInteger(value) || value < 0 || value > 1000) {
      throw new TypeError('client-next-best-action-vendor-count-invalid');
    }
  }
  if (input.vendorNoContactCount > input.vendorsReleased) {
    throw new TypeError('client-next-best-action-vendor-count-invalid');
  }
  const seen = new Set<string>();
  for (const opportunity of input.opportunities) {
    assertRef(opportunity.serviceRef, 'client-next-best-action-opportunity-invalid');
    if (seen.has(opportunity.serviceRef)) {
      throw new TypeError('client-next-best-action-opportunity-duplicate');
    }
    seen.add(opportunity.serviceRef);
    const authority: string = opportunity.authority;
    const status: string = opportunity.status;
    if (
      authority !== 'ADVISORY_ONLY' ||
      status !== 'NURTURE_ELIGIBLE' ||
      !Number.isFinite(opportunity.score) ||
      opportunity.score < 0 ||
      opportunity.score > 100
    ) {
      throw new TypeError('client-next-best-action-opportunity-invalid');
    }
  }
}

export function planClientNextBestAction(input: ClientNextBestActionInput): ClientNextBestAction {
  validateInput(input);

  if (input.humanHandoffRequested) {
    return action('HUMAN_HANDOFF', 'HUMAN_HANDOFF_REQUESTED', false);
  }
  if (input.clientQuestionPending) {
    return action('ANSWER_CLIENT', 'CLIENT_QUESTION_PENDING', false);
  }
  if (input.explicitReassignmentRequested) {
    return action('REQUEST_REASSIGNMENT', 'CLIENT_REASSIGNMENT_REQUESTED', true);
  }
  if (input.extraVendorReviewRequested) {
    return action('REQUEST_EXTRA_VENDOR_REVIEW', 'CLIENT_EXTRA_VENDOR_REVIEW_REQUESTED', true);
  }
  if (input.unresolvedServiceIssue) {
    return action('SERVICE_RECOVERY', 'UNRESOLVED_SERVICE_ISSUE', false);
  }

  if (input.matchRequested) {
    const requiredFieldRef = input.missingMandatoryFieldRefs[0];
    if (requiredFieldRef !== undefined) {
      return action('ASK_MISSING_FIELD', 'MATCH_REQUIRED_FIELD_MISSING', false, {
        requiredFieldRef,
      });
    }
    if (!input.matchReady) {
      return action('CHECK_CORE_ELIGIBILITY', 'MATCH_CORE_ELIGIBILITY_REQUIRED', true);
    }
    return action('REQUEST_MATCH', 'CLIENT_MATCH_REQUEST_READY', true);
  }

  if (input.vendorNoContactCount > 0) {
    return action('CHECK_VENDOR_CONTACT', 'VENDOR_CONTACT_GAP', true);
  }
  if (input.vendorsReleased > 0 && input.allReleasedVendorsContacted && !input.satisfactionKnown) {
    return action('ASK_SATISFACTION', 'VENDOR_BATCH_FEEDBACK_MISSING', false);
  }

  const opportunity = [...input.opportunities].sort(
    (left, right) => right.score - left.score || left.serviceRef.localeCompare(right.serviceRef),
  )[0];
  if (
    opportunity !== undefined &&
    input.allReleasedVendorsContacted &&
    input.satisfactionPositive
  ) {
    return action('SURFACE_ADDITIONAL_SERVICE', 'NURTURE_OPPORTUNITY_READY', false, {
      serviceRef: opportunity.serviceRef,
    });
  }

  if (input.followUpDue) {
    return action('SCHEDULE_FOLLOWUP_PROPOSAL', 'FOLLOWUP_DUE', true);
  }

  return action('ANSWER_CLIENT', 'NO_HIGHER_PRIORITY_ACTION', false);
}
