import {
  createAosModelReasoner,
  type AosModelReasoner,
  type AosReasoningRequestConfig,
} from '@qf-jarvis/aos-model-reasoning';
import type { EvaluationEvidenceVerifier, ModelCapabilityProfile } from '@qf-jarvis/model-gateway';
import type { AdaptiveModelRoutingPolicy } from '@qf-jarvis/model-intelligence-control';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import { selectAosCertifiedModelRelease } from './model-control.js';

export interface AosCertifiedModelSelectionEvent {
  readonly runId: string;
  readonly decision:
    | 'CERTIFIED_RELEASE_SELECTED'
    | 'NO_CERTIFIED_RELEASE'
    | 'NO_CAPABLE_RELEASE'
    | 'POLICY_RELEASE_MISSING';
  readonly complexity: 'SIMPLE' | 'STANDARD' | 'COMPLEX';
  readonly releaseId?: string;
  readonly policyRef: string;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export function createCertifiedAosModelReasoner(input: {
  readonly profiles: readonly ModelCapabilityProfile[];
  readonly policy: AdaptiveModelRoutingPolicy;
  readonly evidenceVerifier: EvaluationEvidenceVerifier;
  readonly invokersByReleaseId: Readonly<Record<string, ModelGatewayInvoker>>;
  readonly requestConfig?: AosReasoningRequestConfig;
  readonly onSelection?: (event: AosCertifiedModelSelectionEvent) => void;
}): AosModelReasoner {
  const reasoners = new Map<string, AosModelReasoner>();

  return Object.freeze({
    async reason(request: Parameters<AosModelReasoner['reason']>[0]) {
      const signals = request.routingSignals;
      if (signals === undefined) {
        return Object.freeze({
          ok: false as const,
          reason: 'MODEL_REFUSED' as const,
          transient: false,
          route: request.route,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const selection = selectAosCertifiedModelRelease({
        signals: {
          route: request.route,
          factCount: request.packet.facts.length,
          policyCount: request.packet.policyRefs.length,
          noveltyScore: signals.noveltyScore,
          evidenceConflictCount: signals.evidenceConflictCount,
          highRisk: signals.highRisk,
        },
        profiles: input.profiles,
        policy: input.policy,
        evidenceVerifier: input.evidenceVerifier,
      });

      const event: AosCertifiedModelSelectionEvent = Object.freeze({
        runId: request.runId,
        decision: selection.decision,
        complexity: selection.complexity,
        ...(selection.release === undefined ? {} : { releaseId: selection.release.releaseId }),
        policyRef: selection.policyRef,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      });
      try {
        input.onSelection?.(event);
      } catch {
        // Observability has no routing authority.
      }

      if (selection.decision !== 'CERTIFIED_RELEASE_SELECTED' || selection.release === undefined) {
        return Object.freeze({
          ok: false as const,
          reason: 'MODEL_REFUSED' as const,
          transient: false,
          route: request.route,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      const releaseId = selection.release.releaseId;
      const invoker = input.invokersByReleaseId[releaseId];
      if (invoker === undefined) {
        return Object.freeze({
          ok: false as const,
          reason: 'MODEL_REFUSED' as const,
          transient: false,
          route: request.route,
          executionAuthority: 'NONE' as const,
          businessEffect: false as const,
        });
      }

      let reasoner = reasoners.get(releaseId);
      if (reasoner === undefined) {
        reasoner = createAosModelReasoner(invoker, input.requestConfig);
        reasoners.set(releaseId, reasoner);
      }
      return reasoner.reason(request);
    },
  });
}
