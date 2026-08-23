/**
 * `@qf-jarvis/communication-lifecycle-runtime` — the communication lifecycle transition policy
 * (QFJ-P09.05, ADR-0110).
 *
 * The canonical state record already proves that a state carrying Core's authority carries the
 * artifact behind it. What no contract in this repository could prove is that the lifecycle MOVED
 * legally, because that is a question about two records and a schema sees one at a time --
 * `communication-state-record.ts` says so in as many words and defers it to a coordination layer.
 * This package is that layer, and it holds one pure function.
 *
 * Given where a governed communication stands (or `null`, for a start) and a candidate next record,
 * it re-parses both with the canonical schema, proves they describe the same communication, proves
 * the candidate evidences the departure it claims, proves time did not run backwards, and proves the
 * movement is an edge of the eighteen-state graph in docs/architecture/communication-model.md.
 *
 * **A consistent transition is not permission.** There is no `canSend`, `canExecute`,
 * `isAuthorized`, `consentValid`, `eligible`, `sent`, `delivered`, `providerSucceeded` or
 * `permissionGranted` in the result, and no `setState`, `advanceTo`, `markDelivered`, `authorize`,
 * `send` or `execute` in the API. Describing a movement correctly is not the same as being allowed
 * to make it, and QuickFurno Core remains authoritative over every fact the records contain.
 *
 * It creates no record, mutates no input, reads no clock, persists nothing, emits nothing, owns no
 * table, adds no migration, and cannot reach Core, n8n, WhatsApp, Meta or any provider.
 *
 * Two root runtime symbols. The transition table, the start state and the verdict constructors stay
 * internal: a caller who could read the table would start branching on it instead of asking, and a
 * caller who could build a verdict could manufacture the answer this package exists to compute.
 */
export { COMMUNICATION_LIFECYCLE_REFUSAL_REASONS } from './contracts/reasons.js';
export { evaluateCommunicationLifecycleTransition } from './evaluate-communication-lifecycle-transition.js';

export type { CommunicationLifecycleRefusalReason } from './contracts/reasons.js';
export type { CommunicationLifecycleTransitionInput } from './contracts/input.js';
export type {
  CommunicationLifecycleConsistent,
  CommunicationLifecycleRefused,
  CommunicationLifecycleTransitionResult,
} from './contracts/result.js';
