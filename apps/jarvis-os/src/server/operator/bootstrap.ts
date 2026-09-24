import {
  OPERATOR_MODULES,
  operatorBootstrapSchema,
  type OperatorBootstrap,
  type OperatorCapability,
} from '@qf-jarvis/operator-api-contract';

const capabilities: readonly OperatorCapability[] = Object.freeze([
  {
    action: 'APPROVAL_DECIDE',
    state: 'NOT_CONNECTED',
    reason: 'Approval authority command bridge is not connected.',
    authority: 'QUICKFURNO_CORE',
  },
  {
    action: 'CONVERSATION_TAKEOVER',
    state: 'NOT_CONNECTED',
    reason: 'Conversation control command bridge is not connected.',
    authority: 'QUICKFURNO_CORE',
  },
  {
    action: 'CONVERSATION_RESUME_AI',
    state: 'NOT_CONNECTED',
    reason: 'Conversation control command bridge is not connected.',
    authority: 'QUICKFURNO_CORE',
  },
  {
    action: 'CONVERSATION_PAUSE_AI',
    state: 'NOT_CONNECTED',
    reason: 'Conversation control command bridge is not connected.',
    authority: 'QUICKFURNO_CORE',
  },
  {
    action: 'AGENT_SET_ENABLED',
    state: 'LOCKED',
    reason: 'Agent enablement requires a reviewed governed configuration command.',
    authority: 'JARVIS_GOVERNANCE',
  },
  {
    action: 'KNOWLEDGE_SET_MODE',
    state: 'LOCKED',
    reason: 'Knowledge mode changes create a new certification lineage.',
    authority: 'JARVIS_GOVERNANCE',
  },
  {
    action: 'ROLLOUT_REQUEST_CHANGE',
    state: 'LOCKED',
    reason: 'Production rollout changes require owner authorization and certified state.',
    authority: 'JARVIS_GOVERNANCE',
  },
]);

export function operatorBootstrap(now = new Date()): OperatorBootstrap {
  return operatorBootstrapSchema.parse({
    apiVersion: '1',
    generatedAt: now.toISOString(),
    client: {
      minimumSnapshotVersion: 2,
      webSession: true,
      mobileDeviceSession: false,
    },
    modules: OPERATOR_MODULES,
    capabilities,
  });
}
