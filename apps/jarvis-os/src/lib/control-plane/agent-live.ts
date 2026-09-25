import type {
  AgentId,
  ControlPlaneReadModel,
  HealthState,
  MetricSummary,
  Section,
  SectionAvailability,
} from './types';
import { isReadable } from './types';

const WORKLOAD_ID: Readonly<Partial<Record<AgentId, string>>> = Object.freeze({
  riya: 'riya',
  anisha: 'anisha',
  aarohi: 'aarohi',
});

const AGENT_LABEL: Readonly<Record<AgentId, string>> = Object.freeze({
  jarvis: 'Jarvis',
  riya: 'Riya',
  anisha: 'Anisha',
  aarohi: 'Aarohi',
});

export interface AgentCockpitSignal {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly href: string;
}

export interface AgentCockpitDependency {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  readonly detail: string;
  readonly href: string;
  readonly scope: 'AGENT' | 'SHARED';
}

export interface AgentCockpitView {
  readonly signals: readonly AgentCockpitSignal[];
  readonly dependencies: readonly AgentCockpitDependency[];
}

function availabilityState(availability: SectionAvailability): HealthState {
  if (availability === 'AVAILABLE' || availability === 'STATIC_BASELINE') return 'AVAILABLE';
  if (availability === 'PLANNED') return 'PLANNED';
  if (availability === 'ROLLOUT_OFF') return 'ROLLOUT_OFF';
  return 'NOT_CONNECTED';
}

function normalizeAgent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

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

  const assigned = workload.items.find((item) => item.id === workloadId)?.value;
  const control = plane.conversationControl();
  const agentLabel = AGENT_LABEL[agentId];
  const metrics: MetricSummary[] = [
    {
      id: agentId + '-assigned',
      label: 'Assigned conversations',
      value: assigned === undefined ? '\u2014' : String(assigned),
      caption:
        assigned === undefined
          ? 'The workload source did not expose an attributable row for ' + agentLabel + '.'
          : 'QuickFurno Core conversations currently assigned to ' + agentLabel + '.',
    },
  ];

  if (isReadable(control.availability)) {
    const owned = control.items.filter(
      (row) => normalizeAgent(row.agent) === normalizeAgent(agentLabel),
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

export function agentCockpit(plane: ControlPlaneReadModel, agentId: AgentId): AgentCockpitView {
  const label = AGENT_LABEL[agentId];
  const normalized = normalizeAgent(label);
  const workload = plane.agentWorkload();
  const control = plane.conversationControl();
  const approvals = plane.approvalQueue();

  const ownedControl = isReadable(control.availability)
    ? control.items.filter((row) => normalizeAgent(row.agent) === normalized)
    : [];
  const assigned =
    agentId === 'jarvis'
      ? isReadable(workload.availability)
        ? workload.items.reduce((sum, item) => sum + item.value, 0)
        : undefined
      : isReadable(workload.availability)
        ? workload.items.find((item) => item.id === WORKLOAD_ID[agentId])?.value
        : undefined;
  const pendingApprovals = isReadable(approvals.availability)
    ? approvals.items.filter(
        (row) =>
          normalizeAgent(row.sourceAgent) === normalized && row.state === 'awaiting-operator',
      ).length
    : undefined;

  const signals: AgentCockpitSignal[] = [
    {
      id: agentId + '-workload',
      label: agentId === 'jarvis' ? 'Tracked workload' : 'Assigned',
      value: assigned === undefined ? '—' : String(assigned),
      detail:
        assigned === undefined
          ? workload.reason
          : agentId === 'jarvis'
            ? 'System-wide tracked agent workload; not attributed to Jarvis as conversation ownership.'
            : 'Current workload attributed by the governed workload section.',
      href: '/conversations',
    },
    {
      id: agentId + '-approvals',
      label: 'Pending approvals',
      value: pendingApprovals === undefined ? '—' : String(pendingApprovals),
      detail:
        pendingApprovals === undefined
          ? approvals.reason
          : 'Approval requests currently attributed to ' + label + ' and awaiting an operator.',
      href: '/approvals',
    },
    {
      id: agentId + '-takeovers',
      label: 'Human takeover',
      value: isReadable(control.availability)
        ? String(ownedControl.filter((row) => row.humanTakeover).length)
        : '—',
      detail: isReadable(control.availability)
        ? 'Core-observed conversations attributed to ' + label + ' and held by a human.'
        : control.reason,
      href: '/operations',
    },
    {
      id: agentId + '-paused',
      label: 'AI paused',
      value: isReadable(control.availability)
        ? String(ownedControl.filter((row) => row.aiPaused).length)
        : '—',
      detail: isReadable(control.availability)
        ? 'Core-observed conversations attributed to ' + label + ' with automation paused.'
        : control.reason,
      href: '/operations',
    },
  ];

  const knowledge = plane.knowledge();
  const namespace = isReadable(knowledge.availability)
    ? knowledge.items.find(
        (item) =>
          normalizeAgent(item.owner) === normalized ||
          normalizeAgent(item.label).includes(normalized),
      )
    : undefined;
  const modelGateway = plane
    .systemHealth()
    .components.find((component) => component.id === 'model-gateway');
  const evaluations = plane.evaluations();
  const degradedEvaluation = isReadable(evaluations.availability)
    ? evaluations.items.some((item) => item.state === 'DEGRADED' || item.state === 'OFFLINE')
    : false;

  const dependencies: AgentCockpitDependency[] = [
    {
      id: agentId + '-knowledge',
      label: 'Knowledge namespace',
      state:
        namespace?.state ??
        (isReadable(knowledge.availability)
          ? 'NOT_CONNECTED'
          : availabilityState(knowledge.availability)),
      detail:
        namespace?.detail ??
        (isReadable(knowledge.availability)
          ? 'No agent-specific knowledge namespace is exposed in the current snapshot.'
          : knowledge.reason),
      href: '/knowledge',
      scope: 'AGENT',
    },
    {
      id: agentId + '-model',
      label: 'Model gateway',
      state: modelGateway?.state ?? 'NOT_CONNECTED',
      detail:
        (modelGateway?.detail ?? 'Model gateway health is not exposed.') +
        ' This is shared infrastructure; it is not attributed to one agent.',
      href: '/models',
      scope: 'SHARED',
    },
    {
      id: agentId + '-evaluation',
      label: 'Evaluation evidence',
      state: isReadable(evaluations.availability)
        ? degradedEvaluation
          ? 'DEGRADED'
          : 'AVAILABLE'
        : availabilityState(evaluations.availability),
      detail: isReadable(evaluations.availability)
        ? String(evaluations.items.length) +
          ' shared assurance dimension' +
          (evaluations.items.length === 1 ? '' : 's') +
          ' observed. Passing evidence never activates this agent.'
        : evaluations.reason,
      href: '/evaluations',
      scope: 'SHARED',
    },
  ];

  return Object.freeze({
    signals: Object.freeze(signals),
    dependencies: Object.freeze(dependencies),
  });
}
