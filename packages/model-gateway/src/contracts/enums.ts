/**
 * The closed, provider-neutral vocabularies of the model gateway (QFJ-P04.01A, ADR-0045).
 *
 * Each is a frozen closed set with a runtime guard. Nothing here is provider-specific: no Groq, no
 * local-model, no OpenAI token ever appears. A `LOCAL_ONLY` request may reach only a local-capable
 * provider; a `HUMAN_ONLY` request reaches no provider at all.
 */

/** The privacy data class of a request. Enforced BEFORE availability, cost, or latency. */
export const MODEL_DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
export type ModelDataClass = (typeof MODEL_DATA_CLASSES)[number];
export function isModelDataClass(value: unknown): value is ModelDataClass {
  return typeof value === 'string' && (MODEL_DATA_CLASSES as readonly string[]).includes(value);
}

/** The agent scope a request is made on behalf of. CLIENT=Riya, VENDOR=Anisha, COORDINATION=Jarvis. */
export const MODEL_AGENT_SCOPES = ['CLIENT', 'VENDOR', 'COORDINATION', 'SYSTEM'] as const;
export type ModelAgentScope = (typeof MODEL_AGENT_SCOPES)[number];
export function isModelAgentScope(value: unknown): value is ModelAgentScope {
  return typeof value === 'string' && (MODEL_AGENT_SCOPES as readonly string[]).includes(value);
}

/** Where a provider runs. A hosted provider is a remote inference engine; a local one is on-prem. */
export const PROVIDER_EXECUTION_CLASSES = ['HOSTED', 'LOCAL'] as const;
export type ProviderExecutionClass = (typeof PROVIDER_EXECUTION_CLASSES)[number];
export function isProviderExecutionClass(value: unknown): value is ProviderExecutionClass {
  return (
    typeof value === 'string' && (PROVIDER_EXECUTION_CLASSES as readonly string[]).includes(value)
  );
}

/** The governed runtime lifecycle of the gateway. In P04.01A only OFF and ACTIVE execute. */
export const GATEWAY_MODES = ['OFF', 'SHADOW', 'CANARY', 'ACTIVE', 'FALLBACK'] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];
export function isGatewayMode(value: unknown): value is GatewayMode {
  return typeof value === 'string' && (GATEWAY_MODES as readonly string[]).includes(value);
}

/** The result mode a request asks for. Structured requires a schema; text is a bounded string. */
export const MODEL_RESULT_MODES = ['STRUCTURED', 'TEXT'] as const;
export type ModelResultMode = (typeof MODEL_RESULT_MODES)[number];
export function isModelResultMode(value: unknown): value is ModelResultMode {
  return typeof value === 'string' && (MODEL_RESULT_MODES as readonly string[]).includes(value);
}
