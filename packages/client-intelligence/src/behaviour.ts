import {
  CLIENT_BEHAVIOUR_SIGNAL_TYPES,
  CLIENT_BEHAVIOUR_VALUES,
  type ClientBehaviourSignal,
  type ClientBehaviourSignalType,
  type ClientBehaviourState,
} from './contracts.js';
import { assertInstant, assertRef, assertUnit } from './validation.js';

function validSignalValue(type: ClientBehaviourSignalType, value: string): boolean {
  return (CLIENT_BEHAVIOUR_VALUES[type] as readonly string[]).includes(value);
}

export function createClientBehaviourSignal(
  input: Omit<ClientBehaviourSignal, 'authority'>,
): ClientBehaviourSignal {
  if (!(CLIENT_BEHAVIOUR_SIGNAL_TYPES as readonly string[]).includes(input.signalType)) {
    throw new TypeError('client-behaviour-signal-type-invalid');
  }
  if (!validSignalValue(input.signalType, input.value)) {
    throw new TypeError('client-behaviour-signal-value-invalid');
  }
  assertUnit(input.confidence, 'client-behaviour-confidence-invalid');
  assertRef(input.evidenceRef, 'client-behaviour-evidence-ref-invalid');
  const observedAt = assertInstant(input.observedAt, 'client-behaviour-observed-at-invalid');
  if (input.expiresAt !== undefined) {
    const expiresAt = assertInstant(input.expiresAt, 'client-behaviour-expires-at-invalid');
    if (expiresAt <= observedAt) throw new TypeError('client-behaviour-expiry-order-invalid');
  }
  return Object.freeze({
    signalType: input.signalType,
    value: input.value,
    confidence: input.confidence,
    evidenceRef: input.evidenceRef,
    observedAt: input.observedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    authority: 'ADVISORY_ONLY' as const,
  });
}

export function buildClientBehaviourState(
  signals: readonly ClientBehaviourSignal[],
  asOf: string,
): ClientBehaviourState {
  const asOfMillis = assertInstant(asOf, 'client-behaviour-as-of-invalid');
  const latest = new Map<ClientBehaviourSignalType, ClientBehaviourSignal>();

  for (const raw of signals) {
    const signal = createClientBehaviourSignal(raw);
    const observedAt = Date.parse(signal.observedAt);
    if (observedAt > asOfMillis) continue;
    if (signal.expiresAt !== undefined && Date.parse(signal.expiresAt) <= asOfMillis) continue;
    const current = latest.get(signal.signalType);
    if (
      current === undefined ||
      Date.parse(current.observedAt) < observedAt ||
      (current.observedAt === signal.observedAt &&
        current.evidenceRef.localeCompare(signal.evidenceRef) < 0)
    ) {
      latest.set(signal.signalType, signal);
    }
  }

  const result: Partial<Record<ClientBehaviourSignalType, ClientBehaviourSignal>> = {};
  for (const type of CLIENT_BEHAVIOUR_SIGNAL_TYPES) {
    const signal = latest.get(type);
    if (signal !== undefined) result[type] = signal;
  }
  return Object.freeze(result);
}
