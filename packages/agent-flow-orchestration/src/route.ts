import type {
  AgentFlowConditionDefinition,
  AgentFlowRouteDecision,
  AgentFlowSignalValue,
  AgentFlowSoftOrchestrationProfile,
} from './contracts.js';

function equal(left: AgentFlowSignalValue, right: AgentFlowSignalValue): boolean {
  return typeof left === typeof right && left === right;
}

function evaluate(
  condition: AgentFlowConditionDefinition,
  present: boolean,
  signal: AgentFlowSignalValue | undefined,
): boolean | undefined {
  if (condition.operator === 'PRESENT') return present;
  if (!present || signal === undefined) return undefined;
  if (condition.operator === 'TRUTHY') return Boolean(signal);
  if (condition.operator === 'EQUALS') {
    return condition.value === undefined ? false : equal(signal, condition.value);
  }
  if (condition.operator === 'NOT_EQUALS') {
    return condition.value === undefined ? false : !equal(signal, condition.value);
  }
  return (condition.values ?? []).some((candidate) => equal(signal, candidate));
}

export function evaluateAgentFlowRoute(input: {
  readonly profile: AgentFlowSoftOrchestrationProfile;
  readonly routeId: string;
  readonly signals: Readonly<Record<string, AgentFlowSignalValue>>;
}): AgentFlowRouteDecision {
  const route = input.profile.routes.find((candidate) => candidate.routeId === input.routeId);
  if (route === undefined) {
    return Object.freeze({ decision: 'ROUTE_UNKNOWN' as const, routeId: input.routeId });
  }
  const condition = input.profile.conditions.find(
    (candidate) => candidate.conditionId === route.conditionRef,
  );
  if (condition === undefined) {
    return Object.freeze({ decision: 'ROUTE_UNKNOWN' as const, routeId: input.routeId });
  }

  const present = Object.prototype.hasOwnProperty.call(input.signals, condition.signalRef);
  const result = evaluate(condition, present, input.signals[condition.signalRef]);
  if (result === undefined) {
    return Object.freeze({ decision: 'SIGNAL_MISSING' as const, routeId: input.routeId });
  }
  return Object.freeze({
    decision: 'ROUTE' as const,
    routeId: route.routeId,
    conditionRef: route.conditionRef,
    matched: result,
    nextNodeId: result ? route.whenTrueNodeId : route.whenFalseNodeId,
  });
}
