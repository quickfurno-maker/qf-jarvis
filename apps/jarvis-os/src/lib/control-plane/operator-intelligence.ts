import {
  answerOperatorQuestion,
  type OperatorIntelligenceAnswer,
  type OperatorIntelligenceContext,
} from '@qf-jarvis/proactive-intelligence';
import type { OperatorBootstrap } from '@qf-jarvis/operator-api-contract';

import { agentCockpit } from './agent-live';
import { proactiveNowBrief, runtimeCapabilities } from './proactive';
import type { AgentId, ControlPlaneReadModel, HealthState, SectionAvailability } from './types';
import { isReadable } from './types';

function sectionState(availability: SectionAvailability): HealthState {
  if (availability === 'AVAILABLE' || availability === 'STATIC_BASELINE') return 'AVAILABLE';
  if (availability === 'PLANNED') return 'PLANNED';
  if (availability === 'ROLLOUT_OFF') return 'ROLLOUT_OFF';
  return 'NOT_CONNECTED';
}

function routeForCapability(id: string): string {
  if (id === 'memory.governed') return '/memory';
  if (id === 'simulation.digital-twin') return '/simulation';
  if (id === 'release.certification' || id === 'evaluation.continuous') return '/release';
  if (id === 'context.semantic-cache') return '/analytics';
  if (id === 'recovery.certified-fallback') return '/models';
  if (id === 'interface.voice') return '/governance';
  return '/governance';
}

function routeForSystem(id: string): string {
  if (id.includes('model')) return '/models';
  if (id.includes('worker')) return '/workers';
  if (id.includes('core-automation') || id.includes('execution')) return '/execution';
  if (id.includes('core')) return '/core-sync';
  if (id.includes('rollout')) return '/governance';
  if (id.includes('auth')) return '/settings';
  return '/';
}

function agentFacts(plane: ControlPlaneReadModel, agentId: AgentId): readonly string[] {
  const cockpit = agentCockpit(plane, agentId);
  return Object.freeze([
    ...cockpit.signals.map((signal) => signal.label + ': ' + signal.value + ' — ' + signal.detail),
    ...cockpit.dependencies.map(
      (dependency) =>
        dependency.label +
        ': ' +
        dependency.state +
        ' · ' +
        dependency.scope.toLowerCase() +
        ' — ' +
        dependency.detail,
    ),
  ]);
}

export function buildOperatorIntelligenceContext(
  plane: ControlPlaneReadModel,
  bootstrap: OperatorBootstrap,
): OperatorIntelligenceContext {
  const knowledge = plane.knowledge();
  const evaluations = plane.evaluations();
  const execution = plane.coreAutomationExecution();

  const systems = [
    ...plane.systemHealth().components.map((component) =>
      Object.freeze({
        id: component.id,
        label: component.label,
        state: component.state,
        detail: component.detail,
        route: routeForSystem(component.id),
      }),
    ),
    Object.freeze({
      id: 'knowledge',
      label: 'Governed knowledge',
      state: sectionState(knowledge.availability),
      detail: isReadable(knowledge.availability)
        ? String(knowledge.items.length) + ' governed namespace(s) are exposed.'
        : knowledge.reason,
      route: '/knowledge',
    }),
    Object.freeze({
      id: 'evaluations',
      label: 'Continuous evaluation evidence',
      state: sectionState(evaluations.availability),
      detail: isReadable(evaluations.availability)
        ? String(evaluations.items.length) + ' evaluation dimension(s) are exposed.'
        : evaluations.reason,
      route: '/evaluations',
    }),
    Object.freeze({
      id: 'execution-dispatch',
      label: 'Execution outcomes',
      state: sectionState(execution.availability),
      detail: isReadable(execution.availability)
        ? String(execution.items.length) + ' bounded execution aggregate(s) are exposed.'
        : execution.reason,
      route: '/execution',
    }),
  ];

  return Object.freeze({
    now: proactiveNowBrief(plane),
    agents: Object.freeze(
      plane.agents().map((agent) =>
        Object.freeze({
          id: agent.id,
          label: agent.name,
          state: agent.state,
          lifecycle: agent.lifecycle,
          facts: agentFacts(plane, agent.id),
          route: '/agents/' + agent.id,
        }),
      ),
    ),
    systems: Object.freeze(systems),
    capabilities: Object.freeze(
      runtimeCapabilities(plane, bootstrap).map((capability) =>
        Object.freeze({
          id: capability.id,
          label: capability.label,
          state: capability.effective,
          source: capability.source,
          route: routeForCapability(capability.id),
        }),
      ),
    ),
  });
}

export function answerFromControlPlane(
  query: string,
  plane: ControlPlaneReadModel,
  bootstrap: OperatorBootstrap,
): OperatorIntelligenceAnswer {
  return answerOperatorQuestion(query, buildOperatorIntelligenceContext(plane, bootstrap));
}
