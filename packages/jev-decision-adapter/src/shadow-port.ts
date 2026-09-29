import {
  createJarvisDecisionPreflight,
  interpretJarvisDecisionPreflight,
  type JarvisDecisionAdvisory,
  type JarvisDecisionShadowInput,
  type JarvisDecisionShadowPort,
} from '@qf-jarvis/decision-intelligence';
import type { JevDecisionProvider } from './jev-provider.js';

export interface JevShadowObservation {
  readonly actorRef: string;
  readonly providerId: string;
  readonly model: string;
  readonly advisory: JarvisDecisionAdvisory;
}

export interface JevDecisionShadowConfig {
  readonly provider: JevDecisionProvider;
  readonly timeoutMs?: number;
  readonly minConfidence?: number;
  readonly sink?: (observation: JevShadowObservation) => void;
}

export function createJevDecisionShadowPort(
  config: JevDecisionShadowConfig,
): JarvisDecisionShadowPort {
  const timeoutMs = config.timeoutMs ?? 1_200;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5_000) {
    throw new TypeError('jev-shadow-timeout-invalid');
  }

  return Object.freeze({
    async observe(input: JarvisDecisionShadowInput): Promise<void> {
      if (input.dataClass !== 'HOSTED_ALLOWED') return;
      const preflight = createJarvisDecisionPreflight({
        actorRef: input.actorRef,
        dataClass: input.dataClass,
        state: {
          taskClass: input.taskClass,
          normalizedText: input.normalizedText,
        },
      });
      const signal = AbortSignal.timeout(timeoutMs);
      const result = await config.provider.decide(preflight.request, signal);
      const advisory = interpretJarvisDecisionPreflight({
        preflight,
        result,
        ...(config.minConfidence === undefined ? {} : { minConfidence: config.minConfidence }),
      });
      config.sink?.(
        Object.freeze({
          actorRef: input.actorRef,
          providerId: result.providerId,
          model: result.model,
          advisory,
        }),
      );
    },
  });
}
