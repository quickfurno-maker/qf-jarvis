import type { AosBehaviourPolicy } from './behavior.js';
import { validInstant, validRef } from './validation.js';

export interface AosPolicyRevision {
  readonly revisionRef: string;
  readonly policyId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changedByRef: string;
  readonly changedAt: string;
  readonly reason: string;
  readonly changedFields: readonly string[];
  readonly simulationRequired: true;
  readonly digitalTwinRequired: true;
  readonly ownerActivationRequired: true;
}

const VERSIONED_FIELDS: readonly (keyof AosBehaviourPolicy)[] = Object.freeze([
  'lifecycle',
  'title',
  'trigger',
  'priority',
  'scope',
  'conditions',
  'action',
  'ownerApprovalRequired',
  'coreDecisionRequired',
  'communication',
]);

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createAosPolicyRevision(input: {
  readonly previous: AosBehaviourPolicy;
  readonly next: AosBehaviourPolicy;
  readonly changedByRef: string;
  readonly changedAt: string;
  readonly reason: string;
}): AosPolicyRevision {
  if (
    input.previous.policyId !== input.next.policyId ||
    input.next.version !== input.previous.version + 1 ||
    !validRef(input.changedByRef) ||
    !validInstant(input.changedAt) ||
    input.reason.trim().length < 3 ||
    input.reason.length > 240
  ) {
    throw new TypeError('aos-policy-revision-invalid');
  }
  const changedFields = VERSIONED_FIELDS.filter(
    (field) => !same(input.previous[field], input.next[field]),
  ).map(String);
  if (changedFields.length === 0) throw new TypeError('aos-policy-revision-empty');

  return Object.freeze({
    revisionRef:
      input.next.policyId +
      '.v' +
      String(input.previous.version) +
      '-v' +
      String(input.next.version),
    policyId: input.next.policyId,
    fromVersion: input.previous.version,
    toVersion: input.next.version,
    changedByRef: input.changedByRef,
    changedAt: input.changedAt,
    reason: input.reason.trim(),
    changedFields: Object.freeze(changedFields.sort()),
    simulationRequired: true as const,
    digitalTwinRequired: true as const,
    ownerActivationRequired: true as const,
  });
}
