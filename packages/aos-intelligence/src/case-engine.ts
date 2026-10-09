import { AOS_CASE_STATES, type AosCase, type AosCaseState, type AosSignal } from './contracts.js';
import { PRIORITY_ORDER, validRef } from './validation.js';

const TERMINAL_STATES = new Set<AosCaseState>(['RESOLVED', 'DISMISSED']);

const TRANSITIONS: Readonly<Record<AosCaseState, readonly AosCaseState[]>> = Object.freeze({
  DETECTED: Object.freeze<AosCaseState[]>(['ANALYZING', 'DISMISSED']),
  ANALYZING: Object.freeze<AosCaseState[]>(['RECOMMENDED', 'DISMISSED']),
  RECOMMENDED: Object.freeze<AosCaseState[]>(['ACKNOWLEDGED', 'DISMISSED']),
  ACKNOWLEDGED: Object.freeze<AosCaseState[]>(['ACTIONED', 'RESOLVED', 'DISMISSED']),
  ACTIONED: Object.freeze<AosCaseState[]>(['RESOLVED']),
  RESOLVED: Object.freeze<AosCaseState[]>([]),
  DISMISSED: Object.freeze<AosCaseState[]>([]),
});

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function validateSignals(signals: readonly AosSignal[]): void {
  if (signals.length < 1 || signals.length > 256) {
    throw new TypeError('aos-case-signals-invalid');
  }
  const first = signals[0];
  if (first === undefined) throw new TypeError('aos-case-signals-invalid');
  if (
    signals.some(
      (signal) => signal.caseKey !== first.caseKey || signal.subjectRef !== first.subjectRef,
    )
  ) {
    throw new TypeError('aos-case-correlation-invalid');
  }
}

function materializeCase(
  caseId: string,
  state: AosCaseState,
  signals: readonly AosSignal[],
): AosCase {
  validateSignals(signals);
  if (!validRef(caseId) || !AOS_CASE_STATES.includes(state)) {
    throw new TypeError('aos-case-reference-invalid');
  }
  const first = signals[0];
  if (first === undefined) throw new TypeError('aos-case-signals-invalid');
  const priority = [...signals].sort(
    (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
  )[0]?.priority;
  if (priority === undefined) throw new TypeError('aos-case-priority-invalid');

  const orderedTimes = signals.map((signal) => signal.observedAt).sort();
  return Object.freeze({
    caseId,
    caseKey: first.caseKey,
    subjectRef: first.subjectRef,
    state,
    priority,
    firstObservedAt: orderedTimes[0] ?? first.observedAt,
    lastObservedAt: orderedTimes.at(-1) ?? first.observedAt,
    signalIds: uniqueSorted(signals.map((signal) => signal.signalId)),
    evidenceRefs: uniqueSorted(signals.flatMap((signal) => signal.evidenceRefs)),
    detectorTypes: Object.freeze([...new Set(signals.map((signal) => signal.detectorType))].sort()),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function createAosCase(caseId: string, signals: readonly AosSignal[]): AosCase {
  return materializeCase(caseId, 'DETECTED', signals);
}

export function mergeAosCase(
  current: AosCase,
  existingSignals: readonly AosSignal[],
  newSignals: readonly AosSignal[],
): AosCase {
  if (TERMINAL_STATES.has(current.state)) {
    throw new TypeError('aos-case-terminal');
  }
  const all = [...existingSignals, ...newSignals];
  validateSignals(all);
  const first = all[0];
  if (first === undefined) throw new TypeError('aos-case-signals-invalid');
  if (
    current.caseKey !== first.caseKey ||
    current.subjectRef !== first.subjectRef ||
    current.signalIds.some((id) => !existingSignals.some((signal) => signal.signalId === id))
  ) {
    throw new TypeError('aos-case-merge-invalid');
  }
  return materializeCase(current.caseId, current.state, all);
}
export function transitionAosCase(current: AosCase, nextState: AosCaseState): AosCase {
  if (!AOS_CASE_STATES.includes(nextState) || !TRANSITIONS[current.state].includes(nextState)) {
    throw new TypeError('aos-case-transition-invalid');
  }
  return Object.freeze({
    ...current,
    state: nextState,
  });
}
