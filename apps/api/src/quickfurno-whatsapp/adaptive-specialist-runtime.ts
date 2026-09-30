import {
  classifyAdaptiveComplexity,
  type AdaptiveComplexity,
  type AdaptiveComplexitySignals,
} from '@qf-jarvis/model-intelligence-control';

import type {
  QuickFurnoWhatsAppConversationContextV1,
  QuickFurnoWhatsAppWorkerMaterial,
} from './contracts.js';
import type {
  QuickFurnoWhatsAppSpecialistObserver,
  QuickFurnoWhatsAppSpecialistRuntime,
} from './specialist-runtime.js';

const RELEASE_REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface AdaptiveSpecialistRuntimeRoute {
  readonly releaseId: string;
  readonly runtime: QuickFurnoWhatsAppSpecialistRuntime;
}

export interface AdaptiveQuickFurnoWhatsAppSpecialistRuntimeConfig {
  readonly activeReleaseIds: readonly string[];
  readonly routes: Readonly<Record<AdaptiveComplexity, AdaptiveSpecialistRuntimeRoute>>;
  readonly signals: (material: QuickFurnoWhatsAppWorkerMaterial) => AdaptiveComplexitySignals;
}

export function createAdaptiveQuickFurnoWhatsAppSpecialistRuntime(
  config: AdaptiveQuickFurnoWhatsAppSpecialistRuntimeConfig,
): QuickFurnoWhatsAppSpecialistRuntime {
  if (
    config.activeReleaseIds.length < 1 ||
    config.activeReleaseIds.length > 16 ||
    config.activeReleaseIds.some((releaseId) => !RELEASE_REF.test(releaseId)) ||
    new Set(config.activeReleaseIds).size !== config.activeReleaseIds.length
  ) {
    throw new TypeError('adaptive-specialist-active-releases-invalid');
  }

  const active = new Set(config.activeReleaseIds);
  for (const complexity of ['SIMPLE', 'STANDARD', 'COMPLEX'] as const) {
    const route = config.routes[complexity];
    if (
      !RELEASE_REF.test(route.releaseId) ||
      !active.has(route.releaseId) ||
      typeof route.runtime.process !== 'function'
    ) {
      throw new TypeError('adaptive-specialist-route-invalid');
    }
  }

  return Object.freeze({
    async process(
      material: QuickFurnoWhatsAppWorkerMaterial,
      conversationContext?: QuickFurnoWhatsAppConversationContextV1,
      observer?: QuickFurnoWhatsAppSpecialistObserver,
    ) {
      let complexity: AdaptiveComplexity;
      try {
        const baseSignals = config.signals(material);
        complexity = classifyAdaptiveComplexity({
          ...baseSignals,
          conversationContextChars:
            conversationContext?.text.length ?? baseSignals.conversationContextChars,
        });
      } catch {
        return null;
      }
      const route = config.routes[complexity];
      try {
        observer?.(
          Object.freeze({
            kind: 'MODEL_ROUTE_SELECTED',
            complexity,
            releaseId: route.releaseId,
          }),
        );
      } catch {
        // Observability is powerless. An observer cannot change model routing or the turn result.
      }
      return route.runtime.process(material, conversationContext, observer);
    },
  });
}
