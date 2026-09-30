import type {
  ClientOpportunityContext,
  ClientServiceOpportunity,
  ServiceBlueprintRegistry,
  ServiceRelationRule,
} from './contracts.js';
import { assertRef, assertUniqueRefs } from './validation.js';

const RELEVANCE_SCORE = Object.freeze({ LOW: 30, MEDIUM: 50, HIGH: 70 } as const);

function validateContext(input: ClientOpportunityContext): void {
  for (const refs of [
    input.sourceServiceRefs,
    input.activeServiceRefs,
    input.completedServiceRefs,
    input.declinedServiceRefs,
    input.recentNurtureServiceRefs,
    input.explicitInterestServiceRefs,
  ]) {
    assertUniqueRefs(refs, 'client-opportunity-service-ref-invalid');
  }
  if (input.propertyStageRef !== undefined) {
    assertRef(input.propertyStageRef, 'client-opportunity-property-stage-invalid');
  }
  if (
    input.daysToPossession !== undefined &&
    (!Number.isInteger(input.daysToPossession) ||
      input.daysToPossession < 0 ||
      input.daysToPossession > 3650)
  ) {
    throw new TypeError('client-opportunity-possession-days-invalid');
  }
}
function timingMatches(
  relation: ServiceRelationRule,
  sourceIsActive: boolean,
  sourceIsCompleted: boolean,
  context: ClientOpportunityContext,
): boolean {
  const timing = relation.timing;
  if (timing === undefined) return true;
  if (timing.sourceState === 'ACTIVE' && !sourceIsActive) return false;
  if (timing.sourceState === 'COMPLETED' && !sourceIsCompleted) return false;
  if (timing.sourceState === 'EITHER' && !sourceIsActive && !sourceIsCompleted) return false;

  if (
    timing.propertyStageRefs !== undefined &&
    (context.propertyStageRef === undefined ||
      !timing.propertyStageRefs.includes(context.propertyStageRef))
  ) {
    return false;
  }
  if (
    timing.possessionWithinDays !== undefined &&
    (context.daysToPossession === undefined ||
      context.daysToPossession > timing.possessionWithinDays)
  ) {
    return false;
  }
  return true;
}

function suppressed(
  serviceRef: string,
  explicitInterest: boolean,
  context: ClientOpportunityContext,
): boolean {
  if (context.activeServiceRefs.includes(serviceRef)) return true;
  if (context.completedServiceRefs.includes(serviceRef)) return true;
  if (explicitInterest) return false;
  if (context.hasUnresolvedServiceIssue) return true;
  if (context.declinedServiceRefs.includes(serviceRef)) return true;
  return context.recentNurtureServiceRefs.includes(serviceRef);
}

function opportunity(
  sourceServiceRef: string,
  relation: ServiceRelationRule,
  explicitInterest: boolean,
): ClientServiceOpportunity {
  const score = Math.min(
    100,
    RELEVANCE_SCORE[relation.relevance] + (explicitInterest ? 25 : 0) + (relation.timing ? 5 : 0),
  );
  return Object.freeze({
    serviceRef: relation.targetServiceRef,
    sourceServiceRef,
    score,
    relevance: relation.relevance,
    status: 'NURTURE_ELIGIBLE' as const,
    explicitInterest,
    reasonCodes: Object.freeze([
      'RELATED_TO:' + sourceServiceRef,
      'RELEVANCE:' + relation.relevance,
      ...(explicitInterest ? ['CLIENT_EXPLICIT_INTEREST'] : []),
      ...(relation.timing === undefined ? [] : ['TIMING_MATCHED']),
    ]),
    authority: 'ADVISORY_ONLY' as const,
  });
}
export function evaluateClientServiceOpportunities(input: {
  readonly registry: ServiceBlueprintRegistry;
  readonly context: ClientOpportunityContext;
}): readonly ClientServiceOpportunity[] {
  validateContext(input.context);
  const best = new Map<string, ClientServiceOpportunity>();

  for (const sourceServiceRef of input.context.sourceServiceRefs) {
    const blueprint = input.registry.get(sourceServiceRef);
    if (blueprint === undefined) continue;
    const sourceIsActive = input.context.activeServiceRefs.includes(sourceServiceRef);
    const sourceIsCompleted = input.context.completedServiceRefs.includes(sourceServiceRef);

    for (const relation of blueprint.relatedServices) {
      const explicitInterest = input.context.explicitInterestServiceRefs.includes(
        relation.targetServiceRef,
      );
      if (suppressed(relation.targetServiceRef, explicitInterest, input.context)) continue;
      if (
        !explicitInterest &&
        !timingMatches(relation, sourceIsActive, sourceIsCompleted, input.context)
      ) {
        continue;
      }

      const candidate = opportunity(sourceServiceRef, relation, explicitInterest);
      const existing = best.get(candidate.serviceRef);
      if (
        existing === undefined ||
        candidate.score > existing.score ||
        (candidate.score === existing.score &&
          candidate.sourceServiceRef.localeCompare(existing.sourceServiceRef) < 0)
      ) {
        best.set(candidate.serviceRef, candidate);
      }
    }
  }

  return Object.freeze(
    [...best.values()].sort(
      (left, right) => right.score - left.score || left.serviceRef.localeCompare(right.serviceRef),
    ),
  );
}
