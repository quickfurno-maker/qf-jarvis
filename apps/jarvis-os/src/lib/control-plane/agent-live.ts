import type { AgentId, ControlPlaneReadModel, MetricSummary, Section } from './types';
import { isReadable } from './types';

const WORKLOAD_ID: Readonly<Partial<Record<AgentId, string>>> = Object.freeze({
  riya: 'riya',
  anisha: 'anisha',
});

export function agentOperationalMetrics(
  plane: ControlPlaneReadModel,
  agentId: AgentId,
): Section<MetricSummary> | undefined {
  if (agentId === 'jarvis') {
    return plane.headlineMetrics();
  }

  const workloadId = WORKLOAD_ID[agentId];
  if (workloadId === undefined) return undefined;

  const workload = plane.agentWorkload();
  if (!isReadable(workload.availability)) {
    return {
      availability: workload.availability,
      reason: workload.reason,
      expectedSource: workload.expectedSource,
      items: [],
    };
  }

  const assigned = workload.items.find((item) => item.id === workloadId)?.value ?? 0;
  const control = plane.conversationControl();
  const agentLabel = agentId === 'riya' ? 'Riya' : 'Anisha';
  const metrics: MetricSummary[] = [
    {
      id: agentId + '-assigned',
      label: 'Assigned conversations',
      value: String(assigned),
      caption: 'QuickFurno Core conversations currently assigned to ' + agentLabel + '.',
    },
  ];

  if (isReadable(control.availability)) {
    const owned = control.items.filter(
      (row) => row.agent.toUpperCase() === agentLabel.toUpperCase(),
    );
    metrics.push(
      {
        id: agentId + '-paused',
        label: 'AI paused',
        value: String(owned.filter((row) => row.aiPaused).length),
        caption: 'Observed assigned conversations currently paused by Core control state.',
      },
      {
        id: agentId + '-takeover',
        label: 'Human takeover',
        value: String(owned.filter((row) => row.humanTakeover).length),
        caption: 'Observed assigned conversations currently under human control.',
      },
    );
  }

  return {
    availability: workload.availability,
    reason: workload.reason,
    expectedSource: workload.expectedSource,
    items: metrics,
  };
}
