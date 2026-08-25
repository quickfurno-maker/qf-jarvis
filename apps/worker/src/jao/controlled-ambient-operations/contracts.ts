/**
 * JAO-5 controlled ambient operations contracts (QFJ-P12, ADR-0119).
 *
 * ### The sentence this file exists to make structural
 *
 * "Every monitor has a named owner, cadence/trigger, scope, budget, deduplication rule, expiry,
 * quieting rule, and kill switch. Observation may create attention; it does not create business
 * authority."
 *
 * Each clause below is a required field, a closed vocabulary or a literal. A monitor missing any
 * one of them cannot be constructed, so "every monitor has an owner" is enforced by parsing rather
 * than by whoever reviews the next monitor somebody adds.
 *
 * ### Attention is not authority
 *
 * The only outcome JAO-5 can produce is `SHADOW_OPERATIONAL_ATTENTION` -- JAO-1's own inert kind.
 * There is no `APPROVED_ACTION`, `EXECUTION`, `REMEDIATION` or `AUTHORIZATION` in the vocabulary,
 * `businessEffect` and `productionMutation` are `z.literal(false)` everywhere they appear, and a
 * spec asserts no authority-shaped field exists on any record. Observation creates a reason for a
 * human to look. It does not create permission.
 *
 * ### Ambient does not mean running
 *
 * There is no scheduler here. `runJao5AmbientCycle` is a function somebody calls; the schedule and
 * event semantics it proves are decided deterministically from persisted state and an injected
 * instant. Nothing in this slice starts itself, and a production scheduler or event ingress is a
 * separate activation review.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no process.
 */
import { z } from 'zod';

/** A bounded identifier. The grammar every JAO slice uses. */
const boundedIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * A canonical UTC instant: `2026-08-25T12:00:00.000Z` and nothing else.
 *
 * The repository's established pattern (ADR-0086): the regex fixes the shape, then the round-trip
 * through `Date` rejects the impossible calendar dates the regex would accept -- `2026-02-31`
 * normalises to March 3 in JavaScript, so a shape check alone would store an instant nobody wrote.
 */
export const jao5InstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  });

export type Jao5Instant = z.infer<typeof jao5InstantSchema>;

export const jao5MonitorInstanceIdSchema = boundedIdSchema;

// ---------------------------------------------------------------------------
// Closed vocabularies.
// ---------------------------------------------------------------------------

/**
 * The two trigger classes the first proof governs.
 *
 * No `CONTINUOUS`, no `IMMEDIATE`, no `ON_DEMAND_UNBOUNDED`. A trigger class that implied something
 * runs on its own would be a scheduler by another name, and JAO-5 does not own one.
 */
export const JAO5_TRIGGER_TYPES = ['SCHEDULED_INTERVAL', 'APPROVED_EVENT'] as const;
export type Jao5TriggerType = (typeof JAO5_TRIGGER_TYPES)[number];

/**
 * What a monitor may observe. Exactly one scope in the first proof.
 *
 * Deliberately absent: vendor, client, lead, payment, package, consent, activation and WhatsApp.
 * A scope named here is a scope somebody will monitor, and every one of those is business truth
 * that JAO-5 has no business watching before its own governance is reviewed.
 */
export const JAO5_SCOPES = ['CONTROL_PLANE_SYSTEM_HEALTH'] as const;
export type Jao5Scope = (typeof JAO5_SCOPES)[number];

/**
 * Monitor instance lifecycle.
 *
 * `KILLED` is TERMINAL and there is no `unkill` anywhere in this slice. A kill switch a stale
 * process can clear is not a kill switch; reactivation requires enrolling a NEW monitor instance,
 * which is an explicit, auditable act rather than a state transition somebody can race.
 */
export const JAO5_MONITOR_STATUSES = ['ACTIVE', 'QUIETED', 'KILLED', 'EXPIRED'] as const;
export type Jao5MonitorStatus = (typeof JAO5_MONITOR_STATUSES)[number];

/**
 * Which statuses may still claim, as a TOTAL map.
 *
 * A status added without an entry does not compile -- an unlisted status would read as `undefined`
 * and quietly become claimable or unclaimable depending on which way the comparison was written,
 * and neither should be decided by an omission.
 */
export const JAO5_STATUS_MAY_CLAIM: Readonly<Record<Jao5MonitorStatus, boolean>> = Object.freeze({
  ACTIVE: true,
  QUIETED: true,
  KILLED: false,
  EXPIRED: false,
});

export const JAO5_AMBIENT_OUTCOMES = ['NO_ANOMALY', 'ATTENTION_CREATED', 'REFUSED'] as const;
export type Jao5AmbientOutcome = (typeof JAO5_AMBIENT_OUTCOMES)[number];

export const JAO5_RUN_STATUSES = ['CLAIMED', 'FINALIZED'] as const;
export type Jao5RunStatus = (typeof JAO5_RUN_STATUSES)[number];

/**
 * Why a monitor did not start an investigation. Closed, content-free, and never free text.
 *
 * There is deliberately no code meaning "executed", "approved" or "remediated": the vocabulary
 * cannot express an outcome JAO-5 has no authority to produce.
 */
export const JAO5_REFUSAL_REASONS = [
  'REQUEST_INVALID',
  'MONITOR_UNKNOWN',
  'MONITOR_VERSION_MISMATCH',
  'MONITOR_NOT_ENROLLED',
  'MONITOR_NOT_ACTIVE',
  'MONITOR_KILLED',
  'MONITOR_EXPIRED',
  'MONITOR_QUIETED',
  'TRIGGER_NOT_DUE',
  'EVENT_TYPE_MISMATCH',
  'EVENT_SCOPE_MISMATCH',
  'EVENT_INVALID',
  'DUPLICATE_TRIGGER',
  'BUDGET_EXHAUSTED',
  'REVISION_CONFLICT',
  'OPERATION_CONFLICT',
  'CLAIM_CONFLICT',
  'CLAIM_NOT_FOUND',
  'CLAIM_ALREADY_FINALIZED',
  'INVESTIGATION_REFUSED',
  'CANCELLED',
  'STORE_FAILED',
  'WORKFLOW_FAILED',
] as const;
export type Jao5RefusalReason = (typeof JAO5_REFUSAL_REASONS)[number];

/** The fixed message per code, chosen BY the code and never built FROM an input. A total map. */
const JAO5_MESSAGES: Readonly<Record<Jao5RefusalReason, string>> = Object.freeze({
  REQUEST_INVALID: 'The ambient cycle request is invalid.',
  MONITOR_UNKNOWN: 'No such monitor is registered.',
  MONITOR_VERSION_MISMATCH: 'That monitor version is not the registered one.',
  MONITOR_NOT_ENROLLED: 'No such monitor instance is enrolled.',
  MONITOR_NOT_ACTIVE: 'The monitor instance is not in a claimable status.',
  MONITOR_KILLED: 'The monitor instance has been killed.',
  MONITOR_EXPIRED: 'The monitor instance enrollment has expired.',
  MONITOR_QUIETED: 'The monitor instance is quieted.',
  TRIGGER_NOT_DUE: 'The monitor is not due.',
  EVENT_TYPE_MISMATCH: 'The event type is not the one this monitor observes.',
  EVENT_SCOPE_MISMATCH: 'The event scope is not the one this monitor observes.',
  EVENT_INVALID: 'The event envelope is invalid.',
  DUPLICATE_TRIGGER: 'That trigger has already been claimed.',
  BUDGET_EXHAUSTED: 'The monitor has reached its budget for this window.',
  REVISION_CONFLICT: 'The monitor instance was written by someone else first.',
  OPERATION_CONFLICT: 'That operation id was already used for a different operation.',
  CLAIM_CONFLICT: 'The claim could not be established.',
  CLAIM_NOT_FOUND: 'No such claimed ambient run is recorded.',
  CLAIM_ALREADY_FINALIZED: 'That ambient run has already been finalized.',
  INVESTIGATION_REFUSED: 'The investigation refused.',
  CANCELLED: 'The ambient cycle was cancelled.',
  STORE_FAILED: 'The ambient monitor store is unavailable.',
  WORKFLOW_FAILED: 'The ambient cycle failed.',
});

/** A bounded JAO-5 failure. The code is the contract; the message is fixed per code. */
export class Jao5AmbientError extends Error {
  readonly code: Jao5RefusalReason;

  constructor(code: Jao5RefusalReason) {
    super(JAO5_MESSAGES[code]);
    this.name = 'Jao5AmbientError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Bounds.
// ---------------------------------------------------------------------------

export const JAO5_LIMITS = Object.freeze({
  /** Claims one ambient cycle may make in total, across every monitor. */
  maxClaimsPerCycle: 4,
  /** Monitors one cycle request may name. */
  maxMonitorsPerCycle: 8,
  /**
   * The longest enrollment horizon. An enrollment that never expires is a monitor nobody has to
   * think about again, which is how ambient operation stops being reviewed.
   */
  maxEnrollmentSeconds: 30 * 24 * 60 * 60,
  minCadenceSeconds: 60,
  maxCadenceSeconds: 24 * 60 * 60,
  maxBudgetWindowSeconds: 24 * 60 * 60,
  maxInvestigationsPerWindow: 16,
  maxQuietSeconds: 24 * 60 * 60,
});

// ---------------------------------------------------------------------------
// Monitor definition. Every clause of the canonical sentence, as a required field.
// ---------------------------------------------------------------------------

export const jao5BudgetPolicySchema = z.strictObject({
  maxInvestigationsPerWindow: z.number().int().min(1).max(JAO5_LIMITS.maxInvestigationsPerWindow),
  budgetWindowSeconds: z.number().int().min(60).max(JAO5_LIMITS.maxBudgetWindowSeconds),
});
export type Jao5BudgetPolicy = z.infer<typeof jao5BudgetPolicySchema>;

/**
 * How a duplicate trigger is recognised.
 *
 * `SCHEDULED_SLOT` derives identity from the cadence slot, so the same slot cannot be claimed twice
 * however many cycles run. `EVENT_ID` derives it from the event's own id, so replaying an event --
 * including after a restart -- claims nothing new. Neither uses a process id, a timestamp or an
 * invocation counter, because all three are different on the far side of a restart, and a dedupe
 * rule that resets when the process does is not a dedupe rule.
 */
export const JAO5_DEDUPE_STRATEGIES = ['SCHEDULED_SLOT', 'EVENT_ID'] as const;
export type Jao5DedupeStrategy = (typeof JAO5_DEDUPE_STRATEGIES)[number];

export const jao5DedupePolicySchema = z.strictObject({
  strategy: z.enum(JAO5_DEDUPE_STRATEGIES),
  durable: z.literal(true),
});
export type Jao5DedupePolicy = z.infer<typeof jao5DedupePolicySchema>;

export const jao5ExpiryPolicySchema = z.strictObject({
  maxEnrollmentSeconds: z.number().int().min(60).max(JAO5_LIMITS.maxEnrollmentSeconds),
  /** Expiry is semantic: the row stays for audit and no sweeper is required. */
  enforcedWithoutSweeper: z.literal(true),
});
export type Jao5ExpiryPolicy = z.infer<typeof jao5ExpiryPolicySchema>;

export const jao5QuietingPolicySchema = z.strictObject({
  quietAfterAttentionSeconds: z.number().int().min(0).max(JAO5_LIMITS.maxQuietSeconds),
  quietAfterFailureSeconds: z.number().int().min(0).max(JAO5_LIMITS.maxQuietSeconds),
  /** `NO_ANOMALY` adds no quiet beyond cadence and dedupe -- those already bound the rate. */
  quietAfterNoAnomalySeconds: z.literal(0),
});
export type Jao5QuietingPolicy = z.infer<typeof jao5QuietingPolicySchema>;

export const jao5KillSwitchPolicySchema = z.strictObject({
  terminal: z.literal(true),
  /** There is no unkill. Reactivation means enrolling a new instance, which is auditable. */
  reversible: z.literal(false),
  requiresExpectedRevision: z.literal(true),
});
export type Jao5KillSwitchPolicy = z.infer<typeof jao5KillSwitchPolicySchema>;

/**
 * A governed monitor definition.
 *
 * Note what cannot be here: no `handler`, `callback`, `fn`, `script`, `command`, `url`, `query` or
 * `webhook` field. A monitor says WHEN an investigation may start and under what bounds. It does
 * not carry the thing that runs, because a definition that carried executable behaviour would make
 * the registry a loader and the governance decorative.
 */
export const jao5MonitorDefinitionSchema = z
  .strictObject({
    monitorId: boundedIdSchema,
    monitorVersion: z.literal('1'),
    /** A stable accountable ROLE id. Not personal PII, and not an individual's name. */
    ownerId: boundedIdSchema,
    governanceRef: boundedIdSchema,
    /** ACTIVE for this offline shadow proof only. Emphatically not a production rollout state. */
    availability: z.literal('ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY'),
    triggerType: z.enum(JAO5_TRIGGER_TYPES),
    scope: z.enum(JAO5_SCOPES),
    investigationType: z.literal('jarvis.operations.shadow-health-investigation'),
    maxAutonomyLevel: z.literal('L1_READ'),
    attentionClass: z.literal('SHADOW_OPERATIONAL_ATTENTION'),
    modelAuthority: z.literal('QF_MODEL_GATEWAY_ONLY'),

    cadenceSeconds: z
      .number()
      .int()
      .min(JAO5_LIMITS.minCadenceSeconds)
      .max(JAO5_LIMITS.maxCadenceSeconds)
      .nullable(),
    eventType: z.literal('control-plane.system-health.changed.v1').nullable(),

    budgetPolicy: jao5BudgetPolicySchema,
    dedupePolicy: jao5DedupePolicySchema,
    expiryPolicy: jao5ExpiryPolicySchema,
    quietingPolicy: jao5QuietingPolicySchema,
    killSwitchPolicy: jao5KillSwitchPolicySchema,

    readOnly: z.literal(true),
    businessEffect: z.literal(false),
    productionMutation: z.literal(false),
  })
  .superRefine((definition, ctx) => {
    // The trigger and its parameter are one fact, so they cannot disagree: a scheduled monitor
    // without a cadence has no schedule, and an event monitor without an event type observes
    // nothing. Either would be a monitor that can never be evaluated deterministically.
    if (definition.triggerType === 'SCHEDULED_INTERVAL') {
      if (definition.cadenceSeconds === null || definition.eventType !== null) {
        ctx.addIssue({ code: 'custom', message: 'scheduled monitor needs a cadence and no event' });
      }
      if (definition.dedupePolicy.strategy !== 'SCHEDULED_SLOT') {
        ctx.addIssue({ code: 'custom', message: 'scheduled monitor dedupes by slot' });
      }
    } else {
      if (definition.eventType === null || definition.cadenceSeconds !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'event monitor needs an event type and no cadence',
        });
      }
      if (definition.dedupePolicy.strategy !== 'EVENT_ID') {
        ctx.addIssue({ code: 'custom', message: 'event monitor dedupes by event id' });
      }
    }
  });

export type Jao5MonitorDefinition = z.infer<typeof jao5MonitorDefinitionSchema>;

// ---------------------------------------------------------------------------
// Monitor instance -- enrollment, which is what makes a definition operable.
// ---------------------------------------------------------------------------

/**
 * The durable monitor instance.
 *
 * A static definition is not activation. Enrollment is the explicit, bounded, expiring act that
 * makes one operable in SHADOW mode, and `definitionDigest` binds it to the exact definition it was
 * enrolled against -- so a definition edited later cannot silently change what an existing
 * enrollment governs.
 */
export const jao5MonitorInstanceSchema = z.strictObject({
  monitorInstanceId: jao5MonitorInstanceIdSchema,
  monitorId: boundedIdSchema,
  monitorVersion: z.literal('1'),
  definitionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  ownerId: boundedIdSchema,
  /** One mode, as a literal. There is no production mode to select. */
  mode: z.literal('SHADOW'),
  status: z.enum(JAO5_MONITOR_STATUSES),
  enrolledAt: jao5InstantSchema,
  expiresAt: jao5InstantSchema,
  quietUntil: jao5InstantSchema.nullable(),
  killedAt: jao5InstantSchema.nullable(),
  /** The last cadence slot claimed, so a restart cannot re-open a slot already used. */
  lastClaimedSlot: z.number().int().min(0).nullable(),
  revision: z.number().int().min(1),
  createdAt: jao5InstantSchema,
  updatedAt: jao5InstantSchema,
});

export type Jao5MonitorInstance = z.infer<typeof jao5MonitorInstanceSchema>;

// ---------------------------------------------------------------------------
// The approved operational signal.
// ---------------------------------------------------------------------------

/**
 * An injected, approved operational signal.
 *
 * `sourcePosture` is a CLOSED FIRST-PROOF POSTURE and **not production authentication**. A caller
 * supplying this literal has not been authenticated by anything; the literal exists so that the
 * only signals this proof accepts are ones a caller has declared synthetic or already approved. A
 * production event ingress needs source authentication, authorization, replay control, redaction
 * and its own rollout review, and this literal is what stops one being bolted on by setting a flag.
 *
 * `snapshot` is `unknown` here and parsed by the canonical control-plane read contract downstream:
 * JAO-5 does not re-implement JAO-1's validation, it just refuses to spend a durable claim on a
 * snapshot that will obviously fail.
 */
export const jao5ApprovedEventSchema = z.strictObject({
  eventId: boundedIdSchema,
  eventType: z.literal('control-plane.system-health.changed.v1'),
  occurredAt: jao5InstantSchema,
  sourcePosture: z.literal('INJECTED_APPROVED_SHADOW_SIGNAL'),
  scope: z.enum(JAO5_SCOPES),
  snapshot: z.unknown(),
});

export type Jao5ApprovedEvent = z.infer<typeof jao5ApprovedEventSchema>;

// ---------------------------------------------------------------------------
// Ambient cycle request and result.
// ---------------------------------------------------------------------------

/**
 * One explicit ambient cycle.
 *
 * There is no `handler`, `investigator`, `callback`, `policy` function, `cron` expression or
 * `interval` field. A caller says which enrolled monitors to evaluate and supplies the snapshot or
 * the event; every gate and every bound comes from persisted state and the static registry.
 */
export const jao5AmbientCycleRequestSchema = z.strictObject({
  cycleId: boundedIdSchema,
  /** The run performing this cycle. Bound to each claim it creates. */
  runId: boundedIdSchema,
  mode: z.literal('SHADOW'),
  monitorInstanceIds: z
    .array(jao5MonitorInstanceIdSchema)
    .min(1)
    .max(JAO5_LIMITS.maxMonitorsPerCycle),
  /**
   * The snapshot a SCHEDULED monitor investigates. Injected, because JAO-5 reaches no control plane
   * of its own -- it governs when JAO-1 may look, not where the data comes from.
   */
  snapshot: z.unknown().optional(),
  /** The signal an EVENT monitor investigates. */
  event: jao5ApprovedEventSchema.optional(),
});

export type Jao5AmbientCycleRequest = z.infer<typeof jao5AmbientCycleRequestSchema>;

/**
 * One monitor's outcome for one cycle.
 *
 * Bounded, content-free apart from JAO-1's own attention object, and carrying no authority: there
 * is no `approved`, `authorized`, `canExecute`, `executed` or `remediated` field, and
 * `businessEffect` and `productionMutation` are literals.
 */
export const jao5AmbientRunResultSchema = z.strictObject({
  ambientRunId: boundedIdSchema.nullable(),
  monitorInstanceId: jao5MonitorInstanceIdSchema,
  monitorId: boundedIdSchema,
  monitorVersion: z.literal('1'),
  triggerKind: z.enum(JAO5_TRIGGER_TYPES),
  triggerRef: z.string().min(1).max(160).nullable(),
  dedupeKey: z.string().min(1).max(200).nullable(),
  jao1RunId: boundedIdSchema.nullable(),
  outcome: z.enum(JAO5_AMBIENT_OUTCOMES),
  refusalReason: z.enum(JAO5_REFUSAL_REASONS).nullable(),
  /** JAO-1's own inert attention, passed through unchanged. Never persisted. */
  attentionPresent: z.boolean(),
  capabilityCalls: z.number().int().min(0).max(1),
  modelCalls: z.number().int().min(0).max(1),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),
});

export type Jao5AmbientRunResult = z.infer<typeof jao5AmbientRunResultSchema>;

export const jao5AmbientCycleResultSchema = z.strictObject({
  cycleId: boundedIdSchema,
  runId: boundedIdSchema,
  monitorsEvaluated: z.number().int().min(0).max(JAO5_LIMITS.maxMonitorsPerCycle),
  claimsMade: z.number().int().min(0).max(JAO5_LIMITS.maxClaimsPerCycle),
  investigationsStarted: z.number().int().min(0).max(JAO5_LIMITS.maxClaimsPerCycle),
  attentionCreated: z.number().int().min(0).max(JAO5_LIMITS.maxClaimsPerCycle),
  runs: z.array(jao5AmbientRunResultSchema).max(JAO5_LIMITS.maxMonitorsPerCycle),
  durationMs: z.number().int().nonnegative().max(600_000),

  // Restated as literals rather than described, so a cycle that somehow did have effect could not
  // report itself as one that had not.
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),
  coreMutations: z.literal(0),
  executionIntentsCreated: z.literal(0),
  channelSends: z.literal(0),
  n8nExecutions: z.literal(0),
  specialistCalls: z.literal(0),
  memoryWrites: z.literal(0),
  toolCalls: z.literal(0),
});

export type Jao5AmbientCycleResult = z.infer<typeof jao5AmbientCycleResultSchema>;

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

export const jao5EnrollMonitorInputSchema = z.strictObject({
  operationId: boundedIdSchema,
  monitorInstanceId: jao5MonitorInstanceIdSchema,
  monitorId: boundedIdSchema,
  monitorVersion: z.literal('1'),
  enrollmentSeconds: z.number().int().min(60).max(JAO5_LIMITS.maxEnrollmentSeconds),
});
export type Jao5EnrollMonitorInput = z.infer<typeof jao5EnrollMonitorInputSchema>;

export const jao5KillMonitorInputSchema = z.strictObject({
  operationId: boundedIdSchema,
  monitorInstanceId: jao5MonitorInstanceIdSchema,
  expectedRevision: z.number().int().min(1),
});
export type Jao5KillMonitorInput = z.infer<typeof jao5KillMonitorInputSchema>;

/**
 * What a retryable operation returns.
 *
 * The JAO-3 lesson: a durable replay result carries only IMMUTABLE committed identity. Returning a
 * mutable current header beside an immutable one made "the same operation returns the prior result
 * unchanged" true of half the result and false of the other half. `committedRevision` is the
 * revision the operation actually committed at, and `replayed` is call metadata rather than part of
 * the durable result.
 */
export const jao5OperationResultSchema = z.strictObject({
  monitorInstanceId: jao5MonitorInstanceIdSchema,
  committedRevision: z.number().int().min(1),
  committedStatus: z.enum(JAO5_MONITOR_STATUSES),
  committedAt: jao5InstantSchema,
  replayed: z.boolean(),
});
export type Jao5OperationResult = z.infer<typeof jao5OperationResultSchema>;

// ---------------------------------------------------------------------------
// Telemetry.
// ---------------------------------------------------------------------------

/**
 * Content-free ambient telemetry.
 *
 * Ids, counters, closed tokens and a duration. There is no field for an attention body, a
 * diagnosis, a recommendation, a snapshot, a model result or a raw error -- telemetry is exactly
 * where content kept out of the database tends to reappear.
 */
export const jao5TelemetryEventSchema = z.strictObject({
  cycleId: boundedIdSchema,
  runId: boundedIdSchema,
  triggerType: z.literal('EXPLICIT_AMBIENT_CYCLE'),
  monitorsEvaluated: z.number().int().min(0),
  claimsMade: z.number().int().min(0),
  investigationsStarted: z.number().int().min(0),
  attentionCreated: z.number().int().min(0),
  durationMs: z.number().int().nonnegative().max(600_000),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),
  coreMutations: z.literal(0),
  executionIntentsCreated: z.literal(0),
  channelSends: z.literal(0),
});

export type Jao5TelemetryEvent = z.infer<typeof jao5TelemetryEventSchema>;

export interface Jao5TelemetryHook {
  record(event: Jao5TelemetryEvent): void;
}

/** Injected, like every other JAO slice. Nothing here reads a clock of its own. */
export interface Jao5Clock {
  nowMs(): number;
}
