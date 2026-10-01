import {
  AOS_BEHAVIOUR_TRIGGERS,
  AOS_CONDITION_FIELDS,
  type AosBehaviourContext,
  type AosBehaviourTrigger,
} from './behavior.js';
import type { AosEvidenceFact } from './contracts.js';
import { validateAosEvidenceFact } from './evidence.js';
import { validInstant, validRef } from './validation.js';

export interface AosCaseBehaviourEvidence {
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly observedAt: string;
  readonly sourceRef: string;
}

export interface AosCaseContextMemory {
  readonly protocol: 'qfj.aos.case-context.v1';
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly facts: readonly AosEvidenceFact[];
  readonly behaviours: readonly AosCaseBehaviourEvidence[];
  readonly policyRefs: readonly string[];
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

function validateContext(context: AosBehaviourContext): void {
  for (const ref of [context.cityRef, context.localityRef, context.categoryRef]) {
    if (ref !== undefined && !validRef(ref)) {
      throw new TypeError('aos-case-context-scope-invalid');
    }
  }
  for (const [key, value] of Object.entries(context.metrics)) {
    if (
      !AOS_CONDITION_FIELDS.includes(key as (typeof AOS_CONDITION_FIELDS)[number]) ||
      !Number.isFinite(value)
    ) {
      throw new TypeError('aos-case-context-metric-invalid');
    }
  }
}

function validateBehaviour(behaviour: AosCaseBehaviourEvidence): void {
  if (
    !AOS_BEHAVIOUR_TRIGGERS.includes(behaviour.trigger) ||
    !validInstant(behaviour.observedAt) ||
    !validRef(behaviour.sourceRef)
  ) {
    throw new TypeError('aos-case-context-behaviour-invalid');
  }
  validateContext(behaviour.context);
}

function factIdentity(fact: AosEvidenceFact): string {
  return fact.factId;
}

function behaviourIdentity(behaviour: AosCaseBehaviourEvidence): string {
  return [
    behaviour.trigger,
    behaviour.context.cityRef ?? '*',
    behaviour.context.localityRef ?? '*',
    behaviour.context.categoryRef ?? '*',
  ].join('|');
}

function latestFacts(
  previous: readonly AosEvidenceFact[],
  incoming: readonly AosEvidenceFact[],
): readonly AosEvidenceFact[] {
  const map = new Map<string, AosEvidenceFact>();
  for (const fact of [...previous, ...incoming]) {
    validateAosEvidenceFact(fact);
    const existing = map.get(factIdentity(fact));
    if (existing === undefined || existing.observedAt <= fact.observedAt) {
      map.set(factIdentity(fact), Object.freeze({ ...fact }));
    }
  }
  return Object.freeze(
    [...map.values()].sort((left, right) => left.factId.localeCompare(right.factId)).slice(0, 128),
  );
}

function latestBehaviours(
  previous: readonly AosCaseBehaviourEvidence[],
  incoming: readonly AosCaseBehaviourEvidence[],
): readonly AosCaseBehaviourEvidence[] {
  const map = new Map<string, AosCaseBehaviourEvidence>();
  for (const behaviour of [...previous, ...incoming]) {
    validateBehaviour(behaviour);
    const key = behaviourIdentity(behaviour);
    const existing = map.get(key);
    if (existing === undefined || existing.observedAt <= behaviour.observedAt) {
      map.set(
        key,
        Object.freeze({
          ...behaviour,
          context: Object.freeze({
            ...(behaviour.context.cityRef === undefined
              ? {}
              : { cityRef: behaviour.context.cityRef }),
            ...(behaviour.context.localityRef === undefined
              ? {}
              : { localityRef: behaviour.context.localityRef }),
            ...(behaviour.context.categoryRef === undefined
              ? {}
              : { categoryRef: behaviour.context.categoryRef }),
            metrics: Object.freeze({ ...behaviour.context.metrics }),
          }),
        }),
      );
    }
  }
  return Object.freeze(
    [...map.values()]
      .sort(
        (left, right) =>
          left.trigger.localeCompare(right.trigger) ||
          left.observedAt.localeCompare(right.observedAt),
      )
      .slice(0, 64),
  );
}

export function createAosCaseContextMemory(input: {
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly updatedAt: string;
  readonly facts?: readonly AosEvidenceFact[];
  readonly behaviours?: readonly AosCaseBehaviourEvidence[];
  readonly policyRefs?: readonly string[];
}): AosCaseContextMemory {
  if (!validRef(input.caseKey) || !validRef(input.subjectRef) || !validInstant(input.updatedAt)) {
    throw new TypeError('aos-case-context-input-invalid');
  }
  const policyRefs = input.policyRefs ?? [];
  if (policyRefs.length > 64 || policyRefs.some((ref) => !validRef(ref))) {
    throw new TypeError('aos-case-context-policy-invalid');
  }
  return Object.freeze({
    protocol: 'qfj.aos.case-context.v1' as const,
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    revision: 1,
    updatedAt: input.updatedAt,
    facts: latestFacts([], input.facts ?? []),
    behaviours: latestBehaviours([], input.behaviours ?? []),
    policyRefs: Object.freeze([...new Set(policyRefs)].sort()),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

function hasCaseContextPosture(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const raw = value as Readonly<Record<string, unknown>>;
  return (
    raw['protocol'] === 'qfj.aos.case-context.v1' &&
    raw['executionAuthority'] === 'NONE' &&
    raw['businessEffect'] === false
  );
}

export function mergeAosCaseContextMemory(input: {
  readonly previous: AosCaseContextMemory;
  readonly updatedAt: string;
  readonly subjectRef: string;
  readonly facts?: readonly AosEvidenceFact[];
  readonly behaviours?: readonly AosCaseBehaviourEvidence[];
  readonly policyRefs?: readonly string[];
}): AosCaseContextMemory {
  if (
    !hasCaseContextPosture(input.previous) ||
    input.previous.subjectRef !== input.subjectRef ||
    !validInstant(input.updatedAt) ||
    input.updatedAt < input.previous.updatedAt
  ) {
    throw new TypeError('aos-case-context-merge-invalid');
  }
  const policyRefs = [...input.previous.policyRefs, ...(input.policyRefs ?? [])];
  if (policyRefs.length > 128 || policyRefs.some((ref) => !validRef(ref))) {
    throw new TypeError('aos-case-context-policy-invalid');
  }

  return Object.freeze({
    ...input.previous,
    revision: input.previous.revision + 1,
    updatedAt: input.updatedAt,
    facts: latestFacts(input.previous.facts, input.facts ?? []),
    behaviours: latestBehaviours(input.previous.behaviours, input.behaviours ?? []),
    policyRefs: Object.freeze([...new Set(policyRefs)].sort()),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}
