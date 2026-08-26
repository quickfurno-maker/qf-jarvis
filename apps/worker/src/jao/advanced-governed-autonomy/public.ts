/**
 * The JAO-7 public surface (ADR-0121).
 *
 * Coordination and recovery only, and non-authoritative throughout. There is no `approve`,
 * `authorize`, `decide`, `submit`, `execute`, `send`, `dispatch` or `remediate` on it; no way to
 * create an `ApprovalDecisionV1` or an `ExecutionIntentV1`; no way to execute one; and no way to
 * supply a planner, a mission policy or registry, a recommendation, approval or execution-intent
 * runtime, a JAO-2 registry or adapter, a JAO-4 tool implementation, an evaluator, a rehearsal or
 * rollback effect, or a raw store.
 *
 * The canonical mission policies and the registry are PRIVATE governance state, for the reason
 * JAO-6's owner review established: `Object.freeze` is shallow, and a public reference to a policy
 * record is a public ability to rewrite reviewed governance. Introspection is served by
 * `describeJao7Missions`, which returns a fresh, detached, primitive-only copy on every call.
 *
 * The internal seams -- `Jao7InternalComposition`, every `*Internal` entry point, the store port and
 * the Postgres adapter -- are exported from their own modules and from no barrel. A spec asserts
 * every one of those names is absent here, by name, by barrel key and by source scan.
 */
export {
  JAO7_AUTHORITY_OBSERVATIONS,
  JAO7_AUTHORITY_SOURCE_POSTURE,
  JAO7_EVALUATION_VERDICTS,
  JAO7_OUTCOMES,
  JAO7_POSTURE,
  JAO7_PRODUCER_VERSION,
  JAO7_PRODUCING_AGENT,
  JAO7_REFUSAL_REASONS,
  JAO7_REHEARSAL_CLASSES,
  JAO7_REHEARSAL_STATES,
  JAO7_RUN_STATES,
  JAO7_STEP_STATUSES,
  JAO7_STEP_TYPES,
  JAO7_TERMINAL_STATES,
  Jao7AutonomyError,
  jao7PostureSchema,
} from './contracts.js';
export type {
  Jao7AuthorityObservation,
  Jao7AuthorityObservationRecord,
  Jao7EvaluationRecord,
  Jao7EvaluationVerdict,
  Jao7Instant,
  Jao7Outcome,
  Jao7Posture,
  Jao7RefusalReason,
  Jao7RehearsalClass,
  Jao7RehearsalRecord,
  Jao7RehearsalState,
  Jao7RunRecord,
  Jao7RunState,
  Jao7StepRecord,
  Jao7StepStatus,
  Jao7StepType,
} from './contracts.js';

// Availability and mission classes are closed vocabularies of strings, so exporting them shares no
// reference. The policy TYPE, the policy SCHEMA and the parameter SCHEMAS stay private.
export { JAO7_MISSION_AVAILABILITIES, JAO7_MISSION_CLASSES } from './mission-policy.js';
export type {
  Jao7MissionAvailability,
  Jao7MissionClass,
  Jao7MissionDescriptor,
} from './mission-policy.js';

// Detached introspection only: primitives, fresh on every call.
export { JAO7_MISSION_POLICY_IDS, describeJao7Missions } from './mission-registry.js';

// The reviewed capacity bounds, as literals a spec can assert against.
export { JAO7_CAPACITY_BOUNDS } from './capacity.js';

export {
  jao7AutonomyRequestSchema,
  jao7AutonomyResultSchema,
  jao7CreateRunRequestSchema,
} from './public-contracts.js';
export type {
  Jao7AdvanceRequest,
  Jao7AutonomyResult,
  Jao7CreateRunRequest,
  Jao7TelemetryEvent,
  Jao7TelemetryHook,
} from './public-contracts.js';

export {
  advanceJao7AutonomyRun,
  createJao7AutonomyRun,
  killJao7AutonomyRun,
  pauseJao7AutonomyRun,
  readJao7AutonomyRun,
  resumeJao7AutonomyRun,
} from './coordinator.js';
export type { Jao7AutonomyDependencies, Jao7Clock } from './coordinator.js';
