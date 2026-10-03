import type {
  AosEvidencePacket,
  AosModelRoute,
  AosPriority,
  AosRecommendationAction,
  AosRecommendationCandidate,
} from '@qf-jarvis/aos-intelligence';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import {
  DEFAULT_AOS_REASONING_REQUEST_CONFIG,
  createAosReasoningRequest,
  type AosReasoningRequestConfig,
} from './request.js';
import { aosModelRecommendationSchema } from './schema.js';

export type AosModelReasoningResult =
  | {
      readonly ok: true;
      readonly candidate: AosRecommendationCandidate;
      readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly latencyMs: number;
      readonly executionAuthority: 'NONE';
      readonly businessEffect: false;
    }
  | {
      readonly ok: false;
      readonly reason: 'MODEL_REFUSED' | 'MALFORMED_RESULT';
      readonly transient: boolean;
      readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
      readonly executionAuthority: 'NONE';
      readonly businessEffect: false;
    };

export interface AosModelReasoningRoutingSignals {
  readonly priority: AosPriority;
  readonly noveltyScore: number;
  readonly evidenceConflictCount: number;
  readonly highRisk: boolean;
}

export interface AosModelReasoner {
  reason(input: {
    readonly runId: string;
    readonly packet: AosEvidencePacket;
    readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
    readonly allowedActions: readonly AosRecommendationAction[];
    readonly routingSignals?: AosModelReasoningRoutingSignals;
  }): Promise<AosModelReasoningResult>;
}

export function createAosModelReasoner(
  invoker: ModelGatewayInvoker,
  config: AosReasoningRequestConfig = DEFAULT_AOS_REASONING_REQUEST_CONFIG,
): AosModelReasoner {
  return Object.freeze({
    async reason(input: {
      readonly runId: string;
      readonly packet: AosEvidencePacket;
      readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
      readonly allowedActions: readonly AosRecommendationAction[];
      readonly routingSignals?: AosModelReasoningRoutingSignals;
    }): Promise<AosModelReasoningResult> {
      const request = createAosReasoningRequest({
        runId: input.runId,
        packet: input.packet,
        route: input.route,
        allowedActions: input.allowedActions,
        config,
      });
      const invocation = await invoker.invoke(request);
      if (!invocation.ok) {
        return Object.freeze({
          ok: false as const,
          reason: 'MODEL_REFUSED' as const,
          transient: invocation.transient,
          route: input.route,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const parsed = aosModelRecommendationSchema.safeParse(invocation.response.structuredResult);
      const safeFallbacks: readonly AosRecommendationAction[] = [
        'NO_ACTION',
        'REVIEW_CASE',
        'REQUEST_HUMAN_REVIEW',
      ];
      if (
        !parsed.success ||
        (!input.allowedActions.includes(parsed.data.action) &&
          !safeFallbacks.includes(parsed.data.action))
      ) {
        return Object.freeze({
          ok: false as const,
          reason: 'MALFORMED_RESULT' as const,
          transient: false,
          route: input.route,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const alternatives = [...new Set(parsed.data.alternatives)].filter(
        (action) =>
          action !== parsed.data.action &&
          (input.allowedActions.includes(action) || safeFallbacks.includes(action)),
      );
      const candidate: AosRecommendationCandidate = Object.freeze({
        recommendationId: 'recommendation.' + input.runId,
        action: parsed.data.needsHumanReview ? 'REQUEST_HUMAN_REVIEW' : parsed.data.action,
        confidence: parsed.data.confidence,
        rationale: parsed.data.rootCause.trim() + ' — ' + parsed.data.rationale.trim(),
        alternatives: Object.freeze(alternatives),
        evidenceRefs: Object.freeze(input.packet.facts.map((fact) => fact.factId)),
        policyRefs: Object.freeze([...input.packet.policyRefs]),
      });

      return Object.freeze({
        ok: true as const,
        candidate,
        route: input.route,
        ...(invocation.response.usage.inputTokens === undefined
          ? {}
          : { inputTokens: invocation.response.usage.inputTokens }),
        ...(invocation.response.usage.outputTokens === undefined
          ? {}
          : { outputTokens: invocation.response.usage.outputTokens }),
        latencyMs: invocation.response.latencyMs,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      });
    },
  });
}
