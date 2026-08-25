/**
 * The JAO-5 public surface (ADR-0119).
 *
 * Observation only, and non-authoritative. There is no `approve`, `authorize`, `execute`, `send`,
 * `dispatch`, `remediate`, `unkill`, `unquiet`, `start`, `schedule` or `subscribe` on it; no raw
 * SQL or row type; and no way to supply an investigator, a registry or a policy callback.
 *
 * `runJao5AmbientCycleInternal`, `Jao5InternalAmbientDependencies` and `Jao5Investigator` are
 * deliberately NOT exported. The internal seam exists for trusted source-level and test
 * composition, and a spec asserts every one of those names is absent from this barrel -- by name,
 * by barrel key and by source scan.
 */
export {
  JAO5_AMBIENT_OUTCOMES,
  JAO5_DEDUPE_STRATEGIES,
  JAO5_LIMITS,
  JAO5_MONITOR_STATUSES,
  JAO5_REFUSAL_REASONS,
  JAO5_RUN_STATUSES,
  JAO5_SCOPES,
  JAO5_STATUS_MAY_CLAIM,
  JAO5_TRIGGER_TYPES,
  Jao5AmbientError,
  jao5AmbientCycleRequestSchema,
  jao5AmbientCycleResultSchema,
  jao5AmbientRunResultSchema,
  jao5ApprovedEventSchema,
  jao5BudgetPolicySchema,
  jao5DedupePolicySchema,
  jao5EnrollMonitorInputSchema,
  jao5ExpiryPolicySchema,
  jao5InstantSchema,
  jao5KillMonitorInputSchema,
  jao5KillSwitchPolicySchema,
  jao5MonitorDefinitionSchema,
  jao5MonitorInstanceIdSchema,
  jao5MonitorInstanceSchema,
  jao5OperationResultSchema,
  jao5QuietingPolicySchema,
  jao5TelemetryEventSchema,
} from './contracts.js';
export type {
  Jao5AmbientCycleRequest,
  Jao5AmbientCycleResult,
  Jao5AmbientOutcome,
  Jao5AmbientRunResult,
  Jao5ApprovedEvent,
  Jao5BudgetPolicy,
  Jao5Clock,
  Jao5DedupePolicy,
  Jao5DedupeStrategy,
  Jao5EnrollMonitorInput,
  Jao5ExpiryPolicy,
  Jao5Instant,
  Jao5KillMonitorInput,
  Jao5KillSwitchPolicy,
  Jao5MonitorDefinition,
  Jao5MonitorInstance,
  Jao5MonitorStatus,
  Jao5OperationResult,
  Jao5QuietingPolicy,
  Jao5RefusalReason,
  Jao5RunStatus,
  Jao5Scope,
  Jao5TelemetryEvent,
  Jao5TelemetryHook,
  Jao5TriggerType,
} from './contracts.js';

export {
  JAO5_EVENT_HEALTH_MONITOR,
  JAO5_MONITOR_DEFINITIONS,
  JAO5_MONITOR_IDS,
  JAO5_SCHEDULED_HEALTH_MONITOR,
  createJao5MonitorRegistry,
  jao5DefinitionDigest,
} from './monitor-registry.js';
export type { Jao5MonitorRegistry } from './monitor-registry.js';

export {
  assertJao5Budget,
  assertJao5Claimable,
  assertJao5DefinitionBinding,
  assertJao5EventMatches,
  assertJao5ExpectedRevision,
  assertJao5NotCancelled,
  jao5BudgetWindowStart,
  jao5CadenceSlot,
  jao5DueScheduledSlot,
  jao5EventDedupeKey,
  jao5HasExpired,
  jao5InstantFromMs,
  jao5IsQuieted,
  jao5QuietUntilMs,
  jao5ScheduledDedupeKey,
  jao5SemanticDigest,
} from './policy.js';

export type {
  Jao5AmbientRunRecord,
  Jao5AmbientStore,
  Jao5Claim,
  Jao5ClaimRequest,
  Jao5FinalizeRequest,
} from './store-port.js';

export { classifyJao5DatabaseError, createJao5PostgresStore } from './postgres-store.js';

export {
  enrollJao5Monitor,
  jao5DefinitionForInstance,
  killJao5Monitor,
  readJao5MonitorInstance,
} from './operations.js';
export type { Jao5MonitorOperationDependencies } from './operations.js';

export { JAO5_AMBIENT_BOUNDS, runJao5AmbientCycle } from './ambient-cycle.js';
export type { Jao5AmbientDependencies } from './ambient-cycle.js';
