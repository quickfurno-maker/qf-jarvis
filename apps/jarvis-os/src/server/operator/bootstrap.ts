import {
  OPERATOR_MODULES,
  operatorBootstrapSchema,
  type OperatorBootstrap,
  type OperatorCapability,
} from '@qf-jarvis/operator-api-contract';

import { loadCoreCommandConfig } from '../auth/config/loader';

function coreCommandConnected(): boolean {
  try {
    loadCoreCommandConfig();
    return true;
  } catch {
    return false;
  }
}

function quickFurnoCapability(
  action: OperatorCapability['action'],
  connected: boolean,
  label: string,
): OperatorCapability {
  return {
    action,
    state: connected ? 'AVAILABLE' : 'NOT_CONNECTED',
    reason: connected
      ? label + ' is connected through QuickFurno Core authority validation.'
      : label + ' command bridge is not connected.',
    authority: 'QUICKFURNO_CORE',
  };
}

function capabilities(): readonly OperatorCapability[] {
  const connected = coreCommandConnected();
  return Object.freeze([
    quickFurnoCapability('APPROVAL_DECIDE', connected, 'Approval decision'),
    quickFurnoCapability('CONVERSATION_TAKEOVER', connected, 'Conversation takeover'),
    quickFurnoCapability('CONVERSATION_RESUME_AI', connected, 'Resume AI'),
    quickFurnoCapability('CONVERSATION_PAUSE_AI', connected, 'Pause AI'),
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
}

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
    capabilities: capabilities(),
  });
}
