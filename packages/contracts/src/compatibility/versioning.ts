export const CONTRACT_CHANGE_KINDS = [
  'additive-optional-field',
  'additive-response-header',
  'required-field-addition',
  'field-removal',
  'field-rename',
  'field-meaning-change',
  'enum-expansion',
  'idempotency-semantics-change',
] as const;

export type ContractChangeKind = (typeof CONTRACT_CHANGE_KINDS)[number];

export interface CompatibilityClassification {
  readonly breaking: boolean;
  readonly sameVersionAllowed: boolean;
  readonly requiresConsumerReview: boolean;
}

export function classifyContractChange(kind: ContractChangeKind): CompatibilityClassification {
  switch (kind) {
    case 'additive-optional-field':
    case 'additive-response-header':
      return { breaking: false, sameVersionAllowed: true, requiresConsumerReview: false };
    case 'enum-expansion':
      return { breaking: false, sameVersionAllowed: false, requiresConsumerReview: true };
    case 'required-field-addition':
    case 'field-removal':
    case 'field-rename':
    case 'field-meaning-change':
    case 'idempotency-semantics-change':
      return { breaking: true, sameVersionAllowed: false, requiresConsumerReview: true };
  }
}

export function requiredEventVersion(currentVersion: number, kind: ContractChangeKind): number {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    throw new TypeError('invalid-current-event-version');
  }
  return classifyContractChange(kind).sameVersionAllowed ? currentVersion : currentVersion + 1;
}

export function acceptedEventVersions(input: {
  readonly currentVersion: number;
  readonly previousVersionHasLiveTraffic: boolean;
}): readonly number[] {
  if (!Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1) {
    throw new TypeError('invalid-current-event-version');
  }
  if (!input.previousVersionHasLiveTraffic || input.currentVersion === 1) {
    return Object.freeze([input.currentVersion]);
  }
  return Object.freeze([input.currentVersion - 1, input.currentVersion]);
}

export const PHASE23_EVENT_VERSION_POLICY = Object.freeze({
  contractIdentity: 'eventType + eventVersion',
  unknownTypeFailsClosed: true,
  unknownVersionFailsClosed: true,
  permissiveFallbackForbidden: true,
  automaticUpgradeForbidden: true,
  eventIdIsIdempotencyIdentity: true,
  minimumDeprecationDays: 90,
  minimumZeroUsageDaysBeforeRemoval: 30,
});
