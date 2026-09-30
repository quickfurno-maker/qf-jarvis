import {
  CLIENT_BEHAVIOUR_SIGNAL_TYPES,
  CLIENT_BEHAVIOUR_VALUES,
  CLIENT_LIFECYCLE_STATES,
  CLIENT_NEXT_BEST_ACTION_TYPES,
  CLIENT_REASSIGNMENT_STATES,
  CLIENT_SATISFACTION_STATES,
  SERVICE_RELEVANCE,
  type ClientBehaviourSignalType,
  type ClientBehaviourValue,
  type ClientIntelligenceSnapshotV1,
  type ClientNextBestAction,
} from './contracts.js';
import { assertRef, assertUnit } from './validation.js';

const MAX_OPPORTUNITIES = 5;

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(code);
  return value as Record<string, unknown>;
}

function bool(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(code);
  return value;
}
function boundedCount(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new TypeError(code);
  }
  return value;
}

function unit(value: unknown, code: string): number {
  if (typeof value !== 'number') throw new TypeError(code);
  assertUnit(value, code);
  return value;
}

function score(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError(code);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError(code);
  return value as T;
}
function parseBehaviour(value: unknown): ClientIntelligenceSnapshotV1['behaviour'] {
  if (!Array.isArray(value) || value.length > CLIENT_BEHAVIOUR_SIGNAL_TYPES.length) {
    throw new TypeError('client-intelligence-behaviour-invalid');
  }
  const seen = new Set<string>();
  const parsed = value.map((entry) => {
    const row = record(entry, 'client-intelligence-behaviour-invalid');
    const signalType = enumValue(
      row['signalType'],
      CLIENT_BEHAVIOUR_SIGNAL_TYPES,
      'client-intelligence-behaviour-invalid',
    );
    if (seen.has(signalType)) throw new TypeError('client-intelligence-behaviour-invalid');
    seen.add(signalType);
    const signalValue = enumValue(
      row['value'],
      CLIENT_BEHAVIOUR_VALUES[signalType],
      'client-intelligence-behaviour-invalid',
    );
    return Object.freeze({
      signalType,
      value: signalValue as ClientBehaviourValue,
      confidence: unit(row['confidence'], 'client-intelligence-behaviour-invalid'),
    });
  });
  parsed.sort(
    (left, right) =>
      CLIENT_BEHAVIOUR_SIGNAL_TYPES.indexOf(left.signalType as ClientBehaviourSignalType) -
      CLIENT_BEHAVIOUR_SIGNAL_TYPES.indexOf(right.signalType as ClientBehaviourSignalType),
  );
  return Object.freeze(parsed);
}

function parseOpportunities(value: unknown): ClientIntelligenceSnapshotV1['opportunities'] {
  if (!Array.isArray(value) || value.length > MAX_OPPORTUNITIES) {
    throw new TypeError('client-intelligence-opportunities-invalid');
  }
  const seen = new Set<string>();
  const parsed = value.map((entry) => {
    const row = record(entry, 'client-intelligence-opportunities-invalid');
    const serviceRef = row['serviceRef'];
    if (typeof serviceRef !== 'string') throw new TypeError('client-intelligence-opportunities-invalid');
    assertRef(serviceRef, 'client-intelligence-opportunities-invalid');
    if (seen.has(serviceRef)) throw new TypeError('client-intelligence-opportunity-duplicate');
    seen.add(serviceRef);
    return Object.freeze({
      serviceRef,
      score: score(row['score'], 'client-intelligence-opportunities-invalid'),
      relevance: enumValue(row['relevance'], SERVICE_RELEVANCE, 'client-intelligence-opportunities-invalid'),
      explicitInterest: bool(row['explicitInterest'], 'client-intelligence-opportunities-invalid'),
    });
  });
  parsed.sort(
    (left, right) => right.score - left.score || left.serviceRef.localeCompare(right.serviceRef),
  );
  return Object.freeze(parsed);
}

function parseNextBestAction(value: unknown): ClientNextBestAction {
  const row = record(value, 'client-intelligence-next-best-action-invalid');
  const action = enumValue(
    row['action'],
    CLIENT_NEXT_BEST_ACTION_TYPES,
    'client-intelligence-next-best-action-invalid',
  );
  const reasonCode = row['reasonCode'];
  if (typeof reasonCode !== 'string') throw new TypeError('client-intelligence-next-best-action-invalid');
  assertRef(reasonCode, 'client-intelligence-next-best-action-invalid');

  const requiredFieldRef = row['requiredFieldRef'];
  if (requiredFieldRef !== undefined) {
    if (typeof requiredFieldRef !== 'string') throw new TypeError('client-intelligence-next-best-action-invalid');
    assertRef(requiredFieldRef, 'client-intelligence-next-best-action-invalid');
  }
  const serviceRef = row['serviceRef'];
  if (serviceRef !== undefined) {
    if (typeof serviceRef !== 'string') throw new TypeError('client-intelligence-next-best-action-invalid');
    assertRef(serviceRef, 'client-intelligence-next-best-action-invalid');
  }
  if (row['businessEffect'] !== false || row['executionAuthorized'] !== false) {
    throw new TypeError('client-intelligence-next-best-action-authority-invalid');
  }
  return Object.freeze({
    action,
    reasonCode,
    ...(requiredFieldRef === undefined ? {} : { requiredFieldRef }),
    ...(serviceRef === undefined ? {} : { serviceRef }),
    requiresCoreDecision: bool(
      row['requiresCoreDecision'],
      'client-intelligence-next-best-action-invalid',
    ),
    businessEffect: false as const,
    executionAuthorized: false as const,
  });
}

function parseJourney(value: unknown): ClientIntelligenceSnapshotV1['journey'] {
  const row = record(value, 'client-intelligence-journey-invalid');
  const vendorsReleased = boundedCount(row['vendorsReleased'], 'client-intelligence-journey-invalid');
  const vendorNoContactCount = boundedCount(
    row['vendorNoContactCount'],
    'client-intelligence-journey-invalid',
  );
  if (vendorNoContactCount > vendorsReleased) throw new TypeError('client-intelligence-journey-invalid');
  const allReleasedVendorsContacted = bool(
    row['allReleasedVendorsContacted'],
    'client-intelligence-journey-invalid',
  );
  if (allReleasedVendorsContacted && vendorNoContactCount > 0) {
    throw new TypeError('client-intelligence-journey-invalid');
  }
  return Object.freeze({
    followUpDue: bool(row['followUpDue'], 'client-intelligence-journey-invalid'),
    satisfactionState: enumValue(
      row['satisfactionState'],
      CLIENT_SATISFACTION_STATES,
      'client-intelligence-journey-invalid',
    ),
    serviceRecoveryNeeded: bool(
      row['serviceRecoveryNeeded'],
      'client-intelligence-journey-invalid',
    ),
    reassignmentState: enumValue(
      row['reassignmentState'],
      CLIENT_REASSIGNMENT_STATES,
      'client-intelligence-journey-invalid',
    ),
    lifecycleState: enumValue(
      row['lifecycleState'],
      CLIENT_LIFECYCLE_STATES,
      'client-intelligence-journey-invalid',
    ),
    vendorsReleased,
    vendorNoContactCount,
    allReleasedVendorsContacted,
  });
}

export function parseClientIntelligenceSnapshotV1(value: unknown): ClientIntelligenceSnapshotV1 {
  const row = record(value, 'client-intelligence-snapshot-invalid');
  if (row['version'] !== 1) throw new TypeError('client-intelligence-snapshot-version-invalid');

  return Object.freeze({
    version: 1 as const,
    behaviour: parseBehaviour(row['behaviour']),
    journey: parseJourney(row['journey']),
    opportunities: parseOpportunities(row['opportunities']),
    nextBestAction: parseNextBestAction(row['nextBestAction']),
  });
}

export function createClientIntelligenceSnapshotV1(
  input: ClientIntelligenceSnapshotV1,
): ClientIntelligenceSnapshotV1 {
  return parseClientIntelligenceSnapshotV1(input);
}
