import type {
  AosPriority,
  AosRecommendation,
  AosRecommendationAction,
} from '@qf-jarvis/aos-intelligence';
import type { EntityReference } from '@qf-jarvis/contracts';
import type {
  ProposedActionDraft,
  RecommendationRuntime,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';

export interface AosRecommendationSubmissionInput {
  readonly recommendation: AosRecommendation;
  readonly casePriority: AosPriority;
  readonly subject: EntityReference;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
}

export interface AosRecommendationAdapter {
  create(input: AosRecommendationSubmissionInput): RecommendationRuntimeResult;
}

interface ActionGovernance {
  readonly recommendationType: string;
  readonly actionType?: string;
  readonly summary: string;
  readonly risk: 'informational' | 'client-or-vendor-facing-communication' | 'high-risk-or-novel';
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

const GOVERNANCE: Readonly<Record<AosRecommendationAction, ActionGovernance>> = Object.freeze({
  NO_ACTION: Object.freeze({
    recommendationType: 'aos.no-action',
    summary: 'No action is recommended.',
    risk: 'informational',
  }),
  REVIEW_CASE: Object.freeze({
    recommendationType: 'aos.case-review',
    summary: 'Review the AOS case.',
    risk: 'informational',
  }),
  REQUEST_VENDOR_REMINDER: Object.freeze({
    recommendationType: 'aos.vendor-follow-up',
    actionType: 'request-vendor-follow-up',
    summary: 'Request a governed vendor follow-up.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_REPLACEMENT_BATCH: Object.freeze({
    recommendationType: 'aos.replacement-vendor',
    actionType: 'request-replacement-vendor',
    summary: 'Request review of one additional eligible vendor.',
    risk: 'high-risk-or-novel',
    parameters: Object.freeze({ additionalVendorCount: 1 }),
  }),
  REQUEST_CLIENT_FOLLOW_UP: Object.freeze({
    recommendationType: 'aos.client-follow-up',
    actionType: 'request-client-follow-up',
    summary: 'Request a governed client follow-up.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_SATISFACTION_CHECK: Object.freeze({
    recommendationType: 'aos.satisfaction-check',
    actionType: 'request-satisfaction-check',
    summary: 'Request a client satisfaction check.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_RELATED_SERVICE_SUGGESTION: Object.freeze({
    recommendationType: 'aos.related-service',
    actionType: 'request-related-service-suggestion',
    summary: 'Request a relevant related-service suggestion.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_LOW_BALANCE_ALERT: Object.freeze({
    recommendationType: 'aos.vendor-readiness-alert',
    actionType: 'request-vendor-readiness-alert',
    summary: 'Request a governed vendor readiness alert.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_RECHARGE_NUDGE: Object.freeze({
    recommendationType: 'aos.recharge-nudge',
    actionType: 'request-recharge-nudge',
    summary: 'Request a governed recharge conversation.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_VENDOR_REACTIVATION: Object.freeze({
    recommendationType: 'aos.vendor-reactivation',
    actionType: 'request-vendor-reactivation',
    summary: 'Request a governed vendor reactivation conversation.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({ maskedOpportunityOnly: true }),
  }),
  REQUEST_VENDOR_SUCCESS_FOLLOW_UP: Object.freeze({
    recommendationType: 'aos.vendor-success',
    actionType: 'request-vendor-success-follow-up',
    summary: 'Request a vendor success follow-up.',
    risk: 'client-or-vendor-facing-communication',
    parameters: Object.freeze({}),
  }),
  REQUEST_HUMAN_REVIEW: Object.freeze({
    recommendationType: 'aos.human-review',
    summary: 'Human review is recommended.',
    risk: 'informational',
  }),
  REQUEST_SUPPLY_REVIEW: Object.freeze({
    recommendationType: 'aos.supply-review',
    summary: 'Marketplace supply should be reviewed.',
    risk: 'informational',
  }),
  REQUEST_VENDOR_ACQUISITION_REVIEW: Object.freeze({
    recommendationType: 'aos.acquisition-review',
    summary: 'Vendor acquisition coverage should be reviewed.',
    risk: 'informational',
  }),
  REQUEST_INCIDENT_INVESTIGATION: Object.freeze({
    recommendationType: 'aos.incident-review',
    summary: 'A marketplace incident should be investigated.',
    risk: 'informational',
  }),
  REQUEST_MODEL_FALLBACK_REVIEW: Object.freeze({
    recommendationType: 'aos.model-review',
    summary: 'Model fallback posture should be reviewed.',
    risk: 'informational',
  }),
});

function priority(input: AosPriority): 'low' | 'medium' | 'high' | 'critical' {
  switch (input) {
    case 'P0':
      return 'critical';
    case 'P1':
      return 'high';
    case 'P2':
      return 'medium';
    case 'P3':
      return 'low';
  }
}

function actionDraft(governance: ActionGovernance): ProposedActionDraft[] {
  if (governance.actionType === undefined) return [];
  return [
    {
      actionType: governance.actionType,
      actionContractVersion: 1,
      summary: governance.summary,
      parameters: { ...(governance.parameters ?? {}) },
    },
  ];
}

function approval(
  governance: ActionGovernance,
  recommendation: AosRecommendation,
): 'none' | 'authorized-team-human' | 'founder' {
  if (governance.risk === 'informational') return 'none';
  if (recommendation.action === 'REQUEST_REPLACEMENT_BATCH' || recommendation.requiresOwnerReview) {
    return 'founder';
  }
  return 'authorized-team-human';
}

export function createAosRecommendationAdapter(
  runtime: RecommendationRuntime,
): AosRecommendationAdapter {
  return Object.freeze({
    create(input: AosRecommendationSubmissionInput): RecommendationRuntimeResult {
      const rawRecommendation = input.recommendation as unknown as Readonly<
        Record<string, unknown>
      >;
      if (
        rawRecommendation['executionAuthorized'] !== false ||
        rawRecommendation['businessEffect'] !== false
      ) {
        throw new TypeError('aos-recommendation-authority-invalid');
      }

      const governance = GOVERNANCE[input.recommendation.action];
      const proposedActions = actionDraft(governance);

      return runtime.create({
        recommendationType: governance.recommendationType,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        producingAgent: 'jarvis',
        producingAgentVersion: 'aos-v2',
        subject: input.subject,
        priority: priority(input.casePriority),
        confidence: input.recommendation.confidence,
        risk: governance.risk,
        requiredApproval: approval(governance, input.recommendation),
        summary: governance.summary,
        rationale: input.recommendation.rationale,
        evidence: [
          {
            evidenceType: 'derived-signal',
            signalCode: 'aos.evidence-bound',
            description:
              'AOS recommendation passed its evidence-binding and critic checks before submission.',
            value: { evidenceCount: input.recommendation.evidenceRefs.length },
          },
        ],
        proposedActions,
        composite: false,
        correlationId: input.correlationId,
      });
    },
  });
}
