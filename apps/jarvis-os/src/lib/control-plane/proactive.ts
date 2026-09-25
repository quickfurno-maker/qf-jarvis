import {
  buildNowBrief,
  resolveRuntimeCapability,
  type NowBrief,
  type RuntimeCapabilityTruth,
} from '@qf-jarvis/proactive-intelligence';
import type { OperatorBootstrap, OperatorCapability } from '@qf-jarvis/operator-api-contract';

import { CAPABILITY_SNAPSHOT, type Capability, type CapabilityId } from '../capabilities/catalog';
import type { ControlPlaneReadModel, HealthState, SectionAvailability } from './types';
import { isReadable } from './types';

function availableState(state: HealthState | undefined): boolean {
  return state === 'AVAILABLE' || state === 'CONNECTED' || state === 'HEALTHY';
}

function unavailableState(state: HealthState | undefined): boolean {
  return state === 'OFFLINE' || state === 'NOT_CONNECTED';
}

function observed(
  state: HealthState | undefined,
): 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_OBSERVED' {
  if (availableState(state)) return 'HEALTHY';
  if (state === 'DEGRADED') return 'DEGRADED';
  if (unavailableState(state)) return 'UNAVAILABLE';
  return 'NOT_OBSERVED';
}

function sectionObservation(
  availability: SectionAvailability,
): 'HEALTHY' | 'UNAVAILABLE' | 'NOT_OBSERVED' {
  if (isReadable(availability)) return 'HEALTHY';
  if (availability === 'NOT_CONNECTED') return 'UNAVAILABLE';
  return 'NOT_OBSERVED';
}

function commandState(
  bootstrap: OperatorBootstrap,
  action: OperatorCapability['action'],
): 'AVAILABLE' | 'LOCKED' | 'NOT_CONNECTED' {
  return bootstrap.capabilities.find((entry) => entry.action === action)?.state ?? 'NOT_CONNECTED';
}

export function proactiveNowBrief(plane: ControlPlaneReadModel): NowBrief {
  const health = plane.systemHealth();
  const core = health.components.find((component) => component.id === 'quickfurno-core');
  const approvals = plane.approvalQueue();
  const conversations = plane.conversationControl();
  const execution = plane.coreAutomationExecution();
  const workers = plane.workers();
  const models = plane.models();
  const evaluations = plane.evaluations();
  const knowledge = plane.knowledge();

  const pendingApprovals = isReadable(approvals.availability)
    ? approvals.items.filter((row) => row.state === 'awaiting-operator').length
    : null;
  const humanTakeovers = isReadable(conversations.availability)
    ? conversations.items.filter((row) => row.humanTakeover).length
    : null;
  const pausedAi = isReadable(conversations.availability)
    ? conversations.items.filter((row) => row.aiPaused).length
    : null;
  const failedExecutions24h = isReadable(execution.availability)
    ? (execution.items.find((slice) => slice.id === 'failed-24h')?.value ?? 0)
    : null;
  const uncertainExecutions24h = isReadable(execution.availability)
    ? (execution.items.find((slice) => slice.id === 'uncertain-24h')?.value ?? 0)
    : null;

  return buildNowBrief({
    liveOperationalData: plane.provenance().liveOperationalData,
    coreAvailable: availableState(core?.state),
    pendingApprovals,
    humanTakeovers,
    pausedAi,
    failedExecutions24h,
    uncertainExecutions24h,
    degradedWorkers: isReadable(workers.availability)
      ? workers.items.filter((node) => node.state === 'DEGRADED').length
      : null,
    unavailableWorkers: workers.availability === 'NOT_CONNECTED',
    degradedModels: isReadable(models.availability)
      ? models.items.filter((model) => model.state === 'DEGRADED').length
      : null,
    unavailableModels: models.availability === 'NOT_CONNECTED',
    degradedEvaluations: isReadable(evaluations.availability)
      ? evaluations.items.filter(
          (dimension) => dimension.state === 'DEGRADED' || dimension.state === 'OFFLINE',
        ).length
      : null,
    unavailableEvaluations: evaluations.availability === 'NOT_CONNECTED',
    staleKnowledgeNamespaces: isReadable(knowledge.availability)
      ? knowledge.items.filter(
          (namespace) => namespace.state === 'DEGRADED' || namespace.state === 'OFFLINE',
        ).length
      : null,
    unavailableKnowledge: knowledge.availability === 'NOT_CONNECTED',
    // The canonical event backbone already carries correlationId end-to-end. A correlation
    // read model is being added separately; until that evidence reaches the operator snapshot,
    // coverage stays unknown instead of being inferred.
    correlationCoverage: null,
    rolloutEnabled: false,
  });
}

export interface RuntimeCapabilityView {
  readonly id: CapabilityId;
  readonly label: string;
  readonly declaration: Capability['lifecycle'];
  readonly effective: RuntimeCapabilityTruth['state'];
  readonly source: RuntimeCapabilityTruth['source'];
  readonly note: string;
}

function truthFor(
  declaration: Capability,
  plane: ControlPlaneReadModel,
  bootstrap: OperatorBootstrap,
): RuntimeCapabilityTruth {
  const system = plane.systemHealth().components;
  const systemState = (id: string): HealthState | undefined =>
    system.find((entry) => entry.id === id)?.state;

  switch (declaration.id) {
    case 'approval.queue.read':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: sectionObservation(plane.approvalQueue().availability),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'approval.submit':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: 'NOT_APPLICABLE',
        command: commandState(bootstrap, 'APPROVAL_DECIDE'),
        rolloutEnabled: false,
      });
    case 'conversation.control.read':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: sectionObservation(plane.conversationControl().availability),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'conversation.control.write': {
      const states = [
        commandState(bootstrap, 'CONVERSATION_TAKEOVER'),
        commandState(bootstrap, 'CONVERSATION_PAUSE_AI'),
        commandState(bootstrap, 'CONVERSATION_RESUME_AI'),
      ];
      const command = states.every((state) => state === 'AVAILABLE')
        ? ('AVAILABLE' as const)
        : states.some((state) => state === 'LOCKED')
          ? ('LOCKED' as const)
          : ('NOT_CONNECTED' as const);
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: 'NOT_APPLICABLE',
        command,
        rolloutEnabled: false,
      });
    }
    case 'execution.core-automation.bridge':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: observed(systemState('quickfurno-core-automation')),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'core.sync':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: observed(systemState('quickfurno-core')),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'model.gateway':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: observed(systemState('model-gateway')),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'operator.authentication':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: observed(systemState('operator-authentication')),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'worker.local-inference': {
      const workers = plane.workers();
      const local = isReadable(workers.availability)
        ? workers.items.find((entry) => entry.kind === 'local-node' || entry.kind === 'gpu-node')
        : undefined;
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: local === undefined ? 'NOT_OBSERVED' : observed(local.state),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    }
    case 'knowledge.rag':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation:
          declaration.lifecycle === 'DISABLED'
            ? 'NOT_OBSERVED'
            : sectionObservation(plane.knowledge().availability),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    case 'evaluation.run':
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation:
          declaration.lifecycle === 'SHADOW'
            ? 'NOT_OBSERVED'
            : sectionObservation(plane.evaluations().availability),
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
    default:
      return resolveRuntimeCapability({
        declaration: declaration.lifecycle,
        observation: 'NOT_OBSERVED',
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      });
  }
}

export function runtimeCapabilities(
  plane: ControlPlaneReadModel,
  bootstrap: OperatorBootstrap,
): readonly RuntimeCapabilityView[] {
  return Object.freeze(
    CAPABILITY_SNAPSHOT.map((declaration) => {
      const truth = truthFor(declaration, plane, bootstrap);
      return Object.freeze({
        id: declaration.id,
        label: declaration.label,
        declaration: declaration.lifecycle,
        effective: truth.state,
        source: truth.source,
        note: declaration.note,
      });
    }),
  );
}
