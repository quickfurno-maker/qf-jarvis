import {
  createJarvisDecisionPreflight,
  interpretJarvisDecisionPreflight,
  type DecisionProvider,
} from '@qf-jarvis/decision-intelligence';
import type {
  AosPriority,
  AosRecommendation,
  AosRecommendationAction,
} from '@qf-jarvis/aos-intelligence';

const ACTION_TOKEN: Readonly<Record<AosRecommendationAction, string>> = Object.freeze({
  NO_ACTION: 'aos.action.no-action',
  REVIEW_CASE: 'aos.action.review-case',
  REQUEST_VENDOR_REMINDER: 'aos.action.vendor-reminder',
  REQUEST_REPLACEMENT_BATCH: 'aos.action.replacement-batch',
  REQUEST_CLIENT_FOLLOW_UP: 'aos.action.client-follow-up',
  REQUEST_SATISFACTION_CHECK: 'aos.action.satisfaction-check',
  REQUEST_RELATED_SERVICE_SUGGESTION: 'aos.action.related-service',
  REQUEST_LOW_BALANCE_ALERT: 'aos.action.low-balance-alert',
  REQUEST_RECHARGE_NUDGE: 'aos.action.recharge-nudge',
  REQUEST_VENDOR_REACTIVATION: 'aos.action.vendor-reactivation',
  REQUEST_VENDOR_SUCCESS_FOLLOW_UP: 'aos.action.vendor-success',
  REQUEST_HUMAN_REVIEW: 'aos.action.human-review',
  REQUEST_SUPPLY_REVIEW: 'aos.action.supply-review',
  REQUEST_VENDOR_ACQUISITION_REVIEW: 'aos.action.vendor-acquisition',
  REQUEST_INCIDENT_INVESTIGATION: 'aos.action.incident-investigation',
  REQUEST_MODEL_FALLBACK_REVIEW: 'aos.action.model-fallback-review',
});

const TOKEN_ACTION = new Map(
  Object.entries(ACTION_TOKEN).map(([action, token]) => [token, action as AosRecommendationAction]),
);

export interface AosAdjudicationSignals {
  readonly priority: AosPriority;
  readonly noveltyScore: number;
  readonly evidenceConflictCount: number;
  readonly recommendationConfidence: number;
  readonly ownerReviewAlreadyRequired: boolean;
}

export type AosAdjudicationDecision =
  | {
      readonly outcome: 'SKIPPED';
      readonly reason: 'ROUTINE_CASE';
      readonly executionAuthority: 'NONE';
      readonly businessEffect: false;
    }
  | {
      readonly outcome: 'ADVISORY_AGREES';
      readonly providerId: string;
      readonly model: string;
      readonly recommendedAction: AosRecommendationAction;
      readonly executionAuthority: 'NONE';
      readonly businessEffect: false;
    }
  | {
      readonly outcome: 'HOLD_FOR_HUMAN_REVIEW';
      readonly reason:
        | 'PROVIDER_FAILED'
        | 'ADVISORY_HUMAN_REVIEW'
        | 'ADVISORY_UNCERTAIN'
        | 'ADVISORY_DISAGREES'
        | 'ADVISORY_MALFORMED';
      readonly providerId?: string;
      readonly model?: string;
      readonly alternativeAction?: AosRecommendationAction;
      readonly executionAuthority: 'NONE';
      readonly businessEffect: false;
    };

export interface AosDecisionAdjudicator {
  adjudicate(input: {
    readonly caseRef: string;
    readonly recommendation: AosRecommendation;
    readonly signals: AosAdjudicationSignals;
  }): Promise<AosAdjudicationDecision>;
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function shouldAdjudicateAosRecommendation(input: AosAdjudicationSignals): boolean {
  if (
    !unit(input.noveltyScore) ||
    !unit(input.recommendationConfidence) ||
    !Number.isInteger(input.evidenceConflictCount) ||
    input.evidenceConflictCount < 0 ||
    input.evidenceConflictCount > 64
  ) {
    throw new TypeError('aos-adjudication-signals-invalid');
  }
  return (
    input.priority === 'P0' ||
    input.evidenceConflictCount > 0 ||
    input.noveltyScore >= 0.8 ||
    input.recommendationConfidence < 0.75 ||
    input.ownerReviewAlreadyRequired
  );
}

function description(action: AosRecommendationAction): string {
  return (
    'Review whether this bounded AOS candidate is the best advisory next step: ' +
    action.toLowerCase().replaceAll('_', ' ') +
    '.'
  );
}

export function createAosDecisionAdjudicator(input: {
  readonly provider: DecisionProvider;
  readonly timeoutMs?: number;
  readonly minConfidence?: number;
}): AosDecisionAdjudicator {
  const timeoutMs = input.timeoutMs ?? 1_500;
  const minConfidence = input.minConfidence ?? 0.75;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5_000 || !unit(minConfidence)) {
    throw new TypeError('aos-adjudicator-config-invalid');
  }

  return Object.freeze({
    async adjudicate(
      request: Parameters<AosDecisionAdjudicator['adjudicate']>[0],
    ): Promise<AosAdjudicationDecision> {
      if (!shouldAdjudicateAosRecommendation(request.signals)) {
        return Object.freeze({
          outcome: 'SKIPPED' as const,
          reason: 'ROUTINE_CASE' as const,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const candidates = [
        request.recommendation.action,
        ...request.recommendation.alternatives,
        'REQUEST_HUMAN_REVIEW' as const,
      ];
      const unique = [...new Set(candidates)].slice(0, 16);
      const preflight = createJarvisDecisionPreflight({
        actorRef: 'aos.adjudicator',
        dataClass: 'HOSTED_ALLOWED',
        state: {
          caseRef: request.caseRef,
          priority: request.signals.priority,
          noveltyScore: request.signals.noveltyScore,
          evidenceConflictCount: request.signals.evidenceConflictCount,
          recommendationConfidence: request.signals.recommendationConfidence,
          evidenceCount: request.recommendation.evidenceRefs.length,
          policyCount: request.recommendation.policyRefs.length,
          currentAction: ACTION_TOKEN[request.recommendation.action],
        },
        actionCandidates: unique.map((action) => ({
          actionId: ACTION_TOKEN[action],
          description: description(action),
        })),
      });

      let result;
      try {
        result = await input.provider.decide(preflight.request, AbortSignal.timeout(timeoutMs));
      } catch {
        return Object.freeze({
          outcome: 'HOLD_FOR_HUMAN_REVIEW' as const,
          reason: 'PROVIDER_FAILED' as const,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const advisory = interpretJarvisDecisionPreflight({
        preflight,
        result,
        minConfidence,
      });
      if (advisory.status === 'HUMAN_REVIEW') {
        return Object.freeze({
          outcome: 'HOLD_FOR_HUMAN_REVIEW' as const,
          reason: 'ADVISORY_HUMAN_REVIEW' as const,
          providerId: result.providerId,
          model: result.model,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }
      if (advisory.status === 'UNCERTAIN') {
        return Object.freeze({
          outcome: 'HOLD_FOR_HUMAN_REVIEW' as const,
          reason: 'ADVISORY_UNCERTAIN' as const,
          providerId: result.providerId,
          model: result.model,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }
      if (advisory.status === 'MALFORMED') {
        return Object.freeze({
          outcome: 'HOLD_FOR_HUMAN_REVIEW' as const,
          reason: 'ADVISORY_MALFORMED' as const,
          providerId: result.providerId,
          model: result.model,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const selected =
        advisory.candidateActionId === undefined
          ? undefined
          : TOKEN_ACTION.get(advisory.candidateActionId);
      if (
        selected === undefined ||
        selected === 'REQUEST_HUMAN_REVIEW' ||
        selected !== request.recommendation.action
      ) {
        return Object.freeze({
          outcome: 'HOLD_FOR_HUMAN_REVIEW' as const,
          reason: 'ADVISORY_DISAGREES' as const,
          providerId: result.providerId,
          model: result.model,
          ...(selected === undefined ? {} : { alternativeAction: selected }),
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      return Object.freeze({
        outcome: 'ADVISORY_AGREES' as const,
        providerId: result.providerId,
        model: result.model,
        recommendedAction: selected,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      });
    },
  });
}
