import {
  AGENT_FLOW_ACTION_CATALOG_V1,
  RIYA_WHATSAPP_CLIENT_FLOW_V1,
} from '@qf-jarvis/agent-flow-registry';
import {
  JARVIS_V1_OPENAI_PROVIDER_MODE,
  JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
  JARVIS_V1_PRODUCTION_PROVIDER_MODE,
} from '@qf-jarvis/jarvis-v1-production-profile';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';

import type { AgentFlowProfileDefinition, AgentFlowProfileSet } from './contracts.js';

const riyaContextRefs = RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes
  .filter((node) => node.kind === 'CONTEXT' || node.kind === 'MEMORY')
  .map((node) => node.implementationRef);
const riyaActionRefs = AGENT_FLOW_ACTION_CATALOG_V1.filter((action) => action.actor === 'RIYA').map(
  (action) => action.implementationRef,
);

export const RIYA_CONTEXT_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.context.standard.v1',
  version: 1,
  kind: 'CONTEXT',
  actor: 'RIYA',
  label: 'Riya standard governed context',
  implementationRefs: Object.freeze(riyaContextRefs),
  configurableFields: Object.freeze(['approvedContextModules']),
  lockedFields: Object.freeze(['rawDatabaseQueries', 'vendorPrivateData', 'paymentDataByDefault']),
  productionEligible: true,
  description:
    'Selects only code-backed context and memory projections already present in the Riya flow.',
});
export const RIYA_PROMPT_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.prompt.client-sales.v1',
  version: 1,
  kind: 'PROMPT',
  actor: 'RIYA',
  label: 'Riya reviewed client-sales prompt',
  implementationRefs: Object.freeze([
    `${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptId}@v${String(
      RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.promptVersion,
    )}`,
    `sha256:${RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.contentDigest}`,
  ]),
  configurableFields: Object.freeze(['approvedPromptModuleVersion']),
  lockedFields: Object.freeze(['systemTemplateBytes', 'authorityBoundaryText']),
  productionEligible: true,
  description: 'Binds the canvas profile to the existing content-digested Riya prompt definition.',
});

export const RIYA_MODEL_ROUTING_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.model.production-sealed.v1',
  version: 1,
  kind: 'MODEL_ROUTING',
  actor: 'RIYA',
  label: 'Riya certified production routing',
  implementationRefs: Object.freeze([
    `provider-mode:${JARVIS_V1_PRODUCTION_PROVIDER_MODE}`,
    `alternate-mode:${JARVIS_V1_OPENAI_PROVIDER_MODE}`,
    `capability:${JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF}`,
  ]),
  configurableFields: Object.freeze(['approvedRoutingPolicyRef']),
  lockedFields: Object.freeze([
    'providerCredentials',
    'uncertifiedModelRelease',
    'directProviderCalls',
  ]),
  productionEligible: true,
  description:
    'References existing certified provider/profile controls without exposing credentials or arbitrary model IDs.',
});
export const RIYA_TOOL_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.tools.governed-actions.v1',
  version: 1,
  kind: 'TOOLS',
  actor: 'RIYA',
  label: 'Riya governed action set',
  implementationRefs: Object.freeze(riyaActionRefs),
  configurableFields: Object.freeze(['enabledApprovedActionIds']),
  lockedFields: Object.freeze([
    'arbitraryHttp',
    'directSql',
    'arbitraryJavascript',
    'coreAuthority',
  ]),
  productionEligible: true,
  description:
    'Tool availability is limited to the approved Riya action catalog and cannot create new capabilities.',
});

export const RIYA_WAIT_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.wait.phase2.v1',
  version: 1,
  kind: 'WAIT',
  actor: 'RIYA',
  label: 'Riya bounded wait policy',
  implementationRefs: Object.freeze(['packages/durable-orchestration-contracts/src']),
  configurableFields: Object.freeze(['durationPolicyRef', 'expiryFallbackRef']),
  lockedFields: Object.freeze(['unboundedWait', 'providerTimerImplementation']),
  productionEligible: false,
  description:
    'A validated configuration surface reserved for controlled orchestration activation in Phase 3.',
});

export const RIYA_RETRY_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.retry.phase2.v1',
  version: 1,
  kind: 'RETRY',
  actor: 'RIYA',
  label: 'Riya bounded retry policy',
  implementationRefs: Object.freeze(['packages/durable-orchestration-contracts/src']),
  configurableFields: Object.freeze(['retryPolicyRef', 'fallbackNodeId']),
  lockedFields: Object.freeze(['effectfulBlindRetry', 'idempotencyImplementation']),
  productionEligible: false,
  description:
    'Defines safe retry configuration metadata; effectful retry execution stays code-controlled.',
});
export const RIYA_HANDOFF_PROFILE_V1: AgentFlowProfileDefinition = Object.freeze({
  profileId: 'riya.handoff.phase2.v1',
  version: 1,
  kind: 'HANDOFF',
  actor: 'RIYA',
  label: 'Riya human handoff policy',
  implementationRefs: Object.freeze(['packages/governed-agent-handoff/src']),
  configurableFields: Object.freeze(['handoffPolicyRef']),
  lockedFields: Object.freeze(['humanIdentity', 'businessAuthority', 'directStateMutation']),
  productionEligible: false,
  description:
    'Declares the handoff configuration boundary before Phase 3 flow-controlled activation.',
});

export const RIYA_AGENT_FLOW_PROFILES_V1: readonly AgentFlowProfileDefinition[] = Object.freeze([
  RIYA_CONTEXT_PROFILE_V1,
  RIYA_PROMPT_PROFILE_V1,
  RIYA_MODEL_ROUTING_PROFILE_V1,
  RIYA_TOOL_PROFILE_V1,
  RIYA_WAIT_PROFILE_V1,
  RIYA_RETRY_PROFILE_V1,
  RIYA_HANDOFF_PROFILE_V1,
]);

export const RIYA_PHASE2_PROFILE_SET_V1: AgentFlowProfileSet = Object.freeze({
  contextProfileRef: RIYA_CONTEXT_PROFILE_V1.profileId,
  promptProfileRef: RIYA_PROMPT_PROFILE_V1.profileId,
  modelRoutingProfileRef: RIYA_MODEL_ROUTING_PROFILE_V1.profileId,
  toolProfileRef: RIYA_TOOL_PROFILE_V1.profileId,
  waitPolicyRef: RIYA_WAIT_PROFILE_V1.profileId,
  retryPolicyRef: RIYA_RETRY_PROFILE_V1.profileId,
  handoffPolicyRef: RIYA_HANDOFF_PROFILE_V1.profileId,
});

export function findAgentFlowProfile(profileRef: string): AgentFlowProfileDefinition | undefined {
  return RIYA_AGENT_FLOW_PROFILES_V1.find((profile) => profile.profileId === profileRef);
}
