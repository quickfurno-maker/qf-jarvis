import {
  SERVICE_RELATION_SOURCE_STATES,
  SERVICE_RELEVANCE,
  type ServiceBlueprint,
  type ServiceBlueprintRegistry,
  type ServiceRelationRule,
  type ServiceRelationTimingRule,
} from './contracts.js';
import { assertRef, assertUniqueRefs, freezeRefs } from './validation.js';

function freezeTiming(
  input: ServiceRelationTimingRule | undefined,
): ServiceRelationTimingRule | undefined {
  if (input === undefined) return undefined;
  if (
    input.sourceState !== undefined &&
    !(SERVICE_RELATION_SOURCE_STATES as readonly string[]).includes(input.sourceState)
  ) {
    throw new TypeError('service-blueprint-source-state-invalid');
  }
  if (
    input.possessionWithinDays !== undefined &&
    (!Number.isInteger(input.possessionWithinDays) ||
      input.possessionWithinDays < 0 ||
      input.possessionWithinDays > 3650)
  ) {
    throw new TypeError('service-blueprint-possession-window-invalid');
  }
  const propertyStageRefs = input.propertyStageRefs ?? [];
  assertUniqueRefs(propertyStageRefs, 'service-blueprint-property-stage-invalid');
  return Object.freeze({
    ...(input.sourceState === undefined ? {} : { sourceState: input.sourceState }),
    ...(propertyStageRefs.length === 0 ? {} : { propertyStageRefs: freezeRefs(propertyStageRefs) }),
    ...(input.possessionWithinDays === undefined
      ? {}
      : { possessionWithinDays: input.possessionWithinDays }),
  });
}

function freezeRelation(input: ServiceRelationRule): ServiceRelationRule {
  assertRef(input.targetServiceRef, 'service-blueprint-related-service-invalid');
  if (!(SERVICE_RELEVANCE as readonly string[]).includes(input.relevance)) {
    throw new TypeError('service-blueprint-relevance-invalid');
  }
  const timing = freezeTiming(input.timing);
  return Object.freeze({
    targetServiceRef: input.targetServiceRef,
    relevance: input.relevance,
    ...(timing === undefined ? {} : { timing }),
  });
}

function freezeBlueprint(input: ServiceBlueprint): ServiceBlueprint {
  const version: number = input.version;
  if (version !== 1) throw new TypeError('service-blueprint-version-invalid');
  assertRef(input.serviceRef, 'service-blueprint-service-ref-invalid');
  assertRef(input.coreCategoryRef, 'service-blueprint-core-category-ref-invalid');
  const mandatory = input.qualification.mandatoryFieldRefs;
  const optional = input.qualification.optionalFieldRefs;
  assertUniqueRefs(mandatory, 'service-blueprint-mandatory-field-invalid');
  assertUniqueRefs(optional, 'service-blueprint-optional-field-invalid');
  if (mandatory.some((field) => optional.includes(field))) {
    throw new TypeError('service-blueprint-field-overlap');
  }
  const relatedServices = input.relatedServices.map(freezeRelation);
  const targetRefs = relatedServices.map((relation) => relation.targetServiceRef);
  assertUniqueRefs(targetRefs, 'service-blueprint-related-service-duplicate');
  if (targetRefs.includes(input.serviceRef)) throw new TypeError('service-blueprint-self-relation');

  return Object.freeze({
    version: 1 as const,
    serviceRef: input.serviceRef,
    coreCategoryRef: input.coreCategoryRef,
    qualification: Object.freeze({
      mandatoryFieldRefs: freezeRefs(mandatory),
      optionalFieldRefs: freezeRefs(optional),
    }),
    relatedServices: Object.freeze(relatedServices),
  });
}

export function missingMandatoryQualificationFields(input: {
  readonly blueprint: ServiceBlueprint;
  readonly knownFieldRefs: readonly string[];
}): readonly string[] {
  const blueprint = freezeBlueprint(input.blueprint);
  assertUniqueRefs(input.knownFieldRefs, 'service-qualification-known-field-invalid');
  const known = new Set(input.knownFieldRefs);
  return Object.freeze(
    blueprint.qualification.mandatoryFieldRefs.filter((field) => !known.has(field)),
  );
}

export function createServiceBlueprintRegistry(
  inputs: readonly ServiceBlueprint[],
): ServiceBlueprintRegistry {
  if (inputs.length < 1 || inputs.length > 512) {
    throw new TypeError('service-blueprint-count-invalid');
  }
  const blueprints = inputs.map(freezeBlueprint);
  const serviceRefs = blueprints.map((blueprint) => blueprint.serviceRef);
  assertUniqueRefs(serviceRefs, 'service-blueprint-service-ref-duplicate');
  const known = new Set(serviceRefs);
  for (const blueprint of blueprints) {
    for (const relation of blueprint.relatedServices) {
      if (!known.has(relation.targetServiceRef)) {
        throw new TypeError('service-blueprint-related-service-missing');
      }
    }
  }
  const ordered = Object.freeze(
    [...blueprints].sort((left, right) => left.serviceRef.localeCompare(right.serviceRef)),
  );
  const byRef = new Map(ordered.map((blueprint) => [blueprint.serviceRef, blueprint] as const));
  return Object.freeze({
    version: 1 as const,
    blueprints: ordered,
    get(serviceRef: string): ServiceBlueprint | undefined {
      if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(serviceRef)) return undefined;
      return byRef.get(serviceRef);
    },
  });
}
