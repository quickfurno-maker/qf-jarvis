import {
  AOS_RECOMMENDATION_ACTIONS,
  type AosEvidencePacket,
  type AosModelRoute,
  type AosRecommendationAction,
} from '@qf-jarvis/aos-intelligence';
import { validateModelRequest, type ModelRequest } from '@qf-jarvis/model-gateway';

import { aosModelRecommendationSchema } from './schema.js';
import {
  AOS_REASONING_PROMPT_DIGEST,
  AOS_REASONING_PROMPT_ID,
  AOS_REASONING_PROMPT_VERSION,
  AOS_REASONING_SYSTEM_PROMPT,
} from './prompt.js';

export interface AosReasoningBudget {
  readonly tokenBudget: number;
  readonly completionBudget: number;
  readonly costBudget: number;
  readonly timeoutMs: number;
}

export interface AosReasoningRequestConfig {
  readonly routine: AosReasoningBudget;
  readonly deep: AosReasoningBudget;
}

export const DEFAULT_AOS_REASONING_REQUEST_CONFIG: AosReasoningRequestConfig = Object.freeze({
  routine: Object.freeze({
    tokenBudget: 6_000,
    completionBudget: 600,
    costBudget: 1,
    timeoutMs: 10_000,
  }),
  deep: Object.freeze({
    tokenBudget: 10_000,
    completionBudget: 900,
    costBudget: 5,
    timeoutMs: 20_000,
  }),
});

function payloadForModel(
  packet: AosEvidencePacket,
  allowedActions: readonly AosRecommendationAction[],
): object {
  return {
    facts: packet.facts.map((fact) => ({
      factId: fact.factId,
      kind: fact.kind,
      observedAt: fact.observedAt,
      value: fact.value,
    })),
    policyRefs: packet.policyRefs,
    allowedActions,
  };
}

export function createAosReasoningRequest(input: {
  readonly runId: string;
  readonly packet: AosEvidencePacket;
  readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
  readonly allowedActions: readonly AosRecommendationAction[];
  readonly config?: AosReasoningRequestConfig;
}): ModelRequest {
  const allowedActions = [...new Set(input.allowedActions)];
  if (
    allowedActions.length < 1 ||
    allowedActions.length > AOS_RECOMMENDATION_ACTIONS.length ||
    allowedActions.some((action) => !AOS_RECOMMENDATION_ACTIONS.includes(action))
  ) {
    throw new TypeError('aos-model-allowed-actions-invalid');
  }
  const config = input.config ?? DEFAULT_AOS_REASONING_REQUEST_CONFIG;
  const budget = input.route === 'DEEP' ? config.deep : config.routine;
  const candidate: ModelRequest = {
    runId: input.runId,
    purpose: 'aos-recommendation',
    agentScope: 'COORDINATION',
    dataClass: 'HOSTED_ALLOWED',
    messages: [
      { role: 'system', content: AOS_REASONING_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payloadForModel(input.packet, allowedActions)) },
    ],
    requiredCapabilities: {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: false,
      minContextTokens: 2_048,
    },
    resultMode: 'STRUCTURED',
    structuredSchema: aosModelRecommendationSchema,
    maxResultChars: 4_000,
    promptId: AOS_REASONING_PROMPT_ID,
    promptVersion: AOS_REASONING_PROMPT_VERSION,
    promptDigest: AOS_REASONING_PROMPT_DIGEST,
    tokenBudget: budget.tokenBudget,
    completionBudget: budget.completionBudget,
    costBudget: budget.costBudget,
    timeoutMs: budget.timeoutMs,
    retryBudget: 0,
    metadata: {
      aosModelRoute: input.route,
      aosEvidenceProtocol: input.packet.protocol,
      containsDirectPii: false,
    },
  };

  const validation = validateModelRequest(candidate);
  if (!validation.ok) throw new TypeError('aos-model-request-invalid');
  return validation.request;
}
