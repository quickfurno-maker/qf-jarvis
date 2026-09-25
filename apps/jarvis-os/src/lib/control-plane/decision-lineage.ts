import type { ControlPlaneReadModel, HealthState, SectionAvailability } from './types';
import { isReadable } from './types';

export interface DecisionLineageStage {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  readonly detail: string;
  readonly href: string;
}

function availabilityState(availability: SectionAvailability): HealthState {
  if (availability === 'AVAILABLE' || availability === 'STATIC_BASELINE') return 'AVAILABLE';
  if (availability === 'PLANNED') return 'PLANNED';
  if (availability === 'ROLLOUT_OFF') return 'ROLLOUT_OFF';
  return 'NOT_CONNECTED';
}

export function decisionLineage(plane: ControlPlaneReadModel): readonly DecisionLineageStage[] {
  const conversations = plane.conversationControl();
  const approvals = plane.approvalQueue();
  const execution = plane.coreAutomationExecution();
  const system = plane.systemHealth();
  const core = system.components.find((component) => component.id === 'quickfurno-core');
  const rollout = system.components.find((component) => component.id === 'production-rollout');

  const pending = isReadable(approvals.availability)
    ? approvals.items.filter((row) => row.state !== 'answered').length
    : undefined;
  const executionAttention = isReadable(execution.availability)
    ? execution.items
        .filter((slice) => slice.id === 'failed-24h' || slice.id === 'uncertain-24h')
        .reduce((sum, slice) => sum + slice.value, 0)
    : undefined;

  return Object.freeze([
    {
      id: 'conversation',
      label: '1 · Conversation context',
      state: availabilityState(conversations.availability),
      detail: isReadable(conversations.availability)
        ? String(conversations.items.length) +
          ' controlled conversation' +
          (conversations.items.length === 1 ? '' : 's') +
          ' observable.'
        : conversations.reason,
      href: '/conversations',
    },
    {
      id: 'recommendation',
      label: '2 · Agent recommendation',
      state: 'NOT_CONNECTED',
      detail:
        'Per-event recommendation and retrieval correlation is not exposed by the current operator snapshot. No trace is inferred.',
      href: '/agents/jarvis',
    },
    {
      id: 'authority',
      label: '3 · Approval / Core authority',
      state: isReadable(approvals.availability)
        ? (core?.state ?? 'NOT_CONNECTED')
        : availabilityState(approvals.availability),
      detail:
        pending === undefined
          ? approvals.reason
          : String(pending) +
            ' unresolved approval' +
            (pending === 1 ? '' : 's') +
            '. QuickFurno Core remains the authorization boundary.',
      href: '/approvals',
    },
    {
      id: 'execution',
      label: '4 · Execution',
      state: availabilityState(execution.availability),
      detail:
        executionAttention === undefined
          ? execution.reason
          : executionAttention === 0
            ? 'No failed or uncertain execution outcome is reported in the bounded 24h aggregate.'
            : String(executionAttention) + ' failed or uncertain execution outcomes need review.',
      href: '/execution',
    },
    {
      id: 'delivery',
      label: '5 · Delivery / rollout',
      state: rollout?.state ?? 'NOT_CONNECTED',
      detail:
        rollout?.detail ??
        'Delivery posture is unavailable. Jarvis OS never treats execution as proof of delivery.',
      href: '/integrations',
    },
  ]);
}
