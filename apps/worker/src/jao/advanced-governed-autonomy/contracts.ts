/**
 * The JAO-7 advanced governed autonomy contracts (ADR-0121).
 *
 * JAO-7 is the final canonical JAO overlay stage, owned by QFJ-P12. It renumbers nothing,
 * `QFJ-P00`..`QFJ-P12` are unchanged, there is no `QFJ-P13`, and JOS remains Jarvis OS.
 *
 * ### What "advanced autonomy" means here, and what it does not
 *
 * The overlay sentence is load-bearing:
 *
 * > Advanced autonomy does not relax the permanent authority ceiling. Irreversible, financial,
 * > identity, consent, entitlement, destructive, or externally binding actions remain behind their
 * > governed authority class.
 *
 * So this slice buys COORDINATION AND RECOVERY, not authority. It runs a finite reviewed plan over
 * durable state, pauses for authority it cannot grant itself, correlates externally supplied Core
 * artifacts, and then rehearses a reversible effect in a purely virtual sandbox that it can verify
 * and roll back. Every one of those is a control. None of them is a new permission.
 *
 * ### The one thing this file exists to make structurally impossible
 *
 * There is no vocabulary member anywhere below that means "authorized", "executed" or "sent". Not
 * as a run state, not as an outcome, not as a posture field. A system that can express a state
 * eventually reaches it, and the honest position is that Jarvis cannot reach those: only QuickFurno
 * Core issues an `ApprovalDecisionV1` and an `ExecutionIntentV1`, and only n8n executes one.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Instants and identity.
// ---------------------------------------------------------------------------

/** A UTC instant at millisecond precision, and exactly that shape. */
export const jao7InstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  });

export type Jao7Instant = z.infer<typeof jao7InstantSchema>;

/** A bounded opaque identifier. No path, no URL, no contact detail can take this shape. */
export const jao7IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** A SHA-256 hex digest. Digests are what JAO-7 persists instead of artifacts. */
export const jao7DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

// ---------------------------------------------------------------------------
// Closed vocabularies.
// ---------------------------------------------------------------------------

/**
 * The run state machine. Closed, and deliberately missing three words.
 *
 * There is no `AUTHORIZED`, no `CAN_EXECUTE` and no `SEND_ALLOWED`. A durable state named
 * `AUTHORIZED` would be a remembered permission, and a remembered permission is the failure mode the
 * whole architecture is built to prevent: authority is a fact about a Core artifact at a moment, not
 * a property a Jarvis row can hold.
 *
 * `AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL` is deliberately that long. It says exactly what
 * happened -- evidence correlated, and correlated only far enough to justify a REHEARSAL -- and it
 * is hard to misread as a grant.
 */
export const JAO7_RUN_STATES = Object.freeze([
  'PLANNED',
  'IN_PROGRESS',
  'AWAITING_AUTHORITY',
  'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL',
  'REHEARSAL_APPLIED',
  'VERIFYING',
  'ROLLING_BACK',
  'COMPLETED',
  'PAUSED',
  'KILLED',
  'EXPIRED',
  'FAILED_SAFE',
] as const);

export type Jao7RunState = (typeof JAO7_RUN_STATES)[number];

/** States from which no forward step may ever be claimed again. */
export const JAO7_TERMINAL_STATES: readonly Jao7RunState[] = Object.freeze([
  'COMPLETED',
  'KILLED',
  'EXPIRED',
  'FAILED_SAFE',
]);

/**
 * The closed step vocabulary.
 *
 * A plan is a sequence drawn from THIS list and nothing else. There is no `CALL_TOOL(name)`, no
 * `RUN(code)` and no step that takes a callback -- which is what makes "policy-bounded planning"
 * a structural claim rather than a description of current behaviour.
 */
export const JAO7_STEP_TYPES = Object.freeze([
  'VALIDATE_INPUT',
  'GATHER_VIRTUAL_EVIDENCE',
  'DELEGATE_RIYA_ANALYSIS',
  'ANALYZE_CAPACITY',
  'BUILD_REMEDIATION_PROPOSAL',
  'AWAIT_AUTHORITY',
  'VALIDATE_AUTHORITY_EVIDENCE',
  'REHEARSE_REVERSIBLE_EFFECT',
  'VERIFY_REHEARSAL',
  'ROLLBACK_REHEARSAL',
  'COMPLETE',
] as const);

export type Jao7StepType = (typeof JAO7_STEP_TYPES)[number];

/** A step's lifecycle. `CLAIMED` exists so a crash between claim and finalize is visible. */
export const JAO7_STEP_STATUSES = Object.freeze([
  'CLAIMED',
  'COMPLETED',
  'REFUSED',
  'CANCELLED',
] as const);
export type Jao7StepStatus = (typeof JAO7_STEP_STATUSES)[number];

/**
 * What the deterministic evaluator may conclude after a step.
 *
 * "Continuous evaluation" in this first proof means a deterministic evaluation after EVERY
 * significant step, durably recorded. It does not mean an always-on background model loop, and the
 * evaluator has no model call to make.
 */
export const JAO7_EVALUATION_VERDICTS = Object.freeze([
  'CONTINUE',
  'PAUSE',
  'REQUIRE_AUTHORITY',
  'VERIFY',
  'ROLLBACK',
  'COMPLETE',
  'FAIL_SAFE',
] as const);

export type Jao7EvaluationVerdict = (typeof JAO7_EVALUATION_VERDICTS)[number];

/**
 * What a finalised step does to the run's position in the reviewed plan.
 *
 * It used to be an unconditional `advanceStepIndex: true` on every completed step, and that is how
 * the authority gate came to be walked past: a VALIDATE_AUTHORITY_EVIDENCE step that correlated
 * NOTHING still counted as progress, so a run reported as `AWAITING_AUTHORITY` was already pointing
 * at `REHEARSE_REVERSIBLE_EFFECT`. Only the run STATE stood between that position and a rehearsal.
 *
 * Progress is now a decision with a name, derived from the verdict by a total function, so a new
 * verdict cannot inherit "advance" by being added.
 */
export const JAO7_PLAN_PROGRESSIONS = Object.freeze(['ADVANCE', 'RETAIN'] as const);

export type Jao7PlanProgression = (typeof JAO7_PLAN_PROGRESSIONS)[number];

/** The terminal shapes a run can be reported as. None of them says the effect happened. */
export const JAO7_OUTCOMES = Object.freeze([
  'COMPLETED_REHEARSAL',
  'ROLLED_BACK_REHEARSAL',
  'AWAITING_AUTHORITY',
  'PAUSED',
  'KILLED',
  'EXPIRED',
  'FAILED_SAFE',
  'REFUSED',
  'IN_PROGRESS',
] as const);

export type Jao7Outcome = (typeof JAO7_OUTCOMES)[number];

/**
 * The outcome each run state implies.
 *
 * A TOTAL map, so a new run state cannot inherit another's reported outcome: the map fails to
 * compile until somebody says what the new state means to a reader. `COMPLETED` is the one entry a
 * reader must refine further -- a completed run whose sandbox was rolled back reports
 * `ROLLED_BACK_REHEARSAL`, and the result schema permits exactly those two for that state.
 */
export const JAO7_STATE_OUTCOMES: Readonly<Record<Jao7RunState, Jao7Outcome>> = Object.freeze({
  PLANNED: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_AUTHORITY: 'AWAITING_AUTHORITY',
  AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL: 'IN_PROGRESS',
  REHEARSAL_APPLIED: 'IN_PROGRESS',
  VERIFYING: 'IN_PROGRESS',
  ROLLING_BACK: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED_REHEARSAL',
  PAUSED: 'PAUSED',
  KILLED: 'KILLED',
  EXPIRED: 'EXPIRED',
  FAILED_SAFE: 'FAILED_SAFE',
});

/**
 * The authority source posture.
 *
 * A LITERAL, and a deliberately unflattering one. In this offline proof the Core artifacts arrive
 * from a caller or a fixture, so what correlation proves is that the artifacts are structurally
 * valid and describe exactly this recommendation, action and fingerprint. It does NOT prove that
 * QuickFurno Core authenticated anything, because there is no production Core transport here to
 * authenticate against.
 */
export const JAO7_AUTHORITY_SOURCE_POSTURE = 'INJECTED_OFFLINE_CORE_FIXTURE' as const;

/** What a completed authority correlation observed. History, never permission. */
export const JAO7_AUTHORITY_OBSERVATIONS = Object.freeze([
  'CORRELATED_APPROVED_ACTION_AND_INTENT',
  'CORRELATED_APPROVED_ACTION_WITHOUT_INTENT',
  'DECISION_NOT_APPROVING_THIS_ACTION',
] as const);

export type Jao7AuthorityObservation = (typeof JAO7_AUTHORITY_OBSERVATIONS)[number];

/** The two virtual sandboxes. Both are local synthetic integers and nothing else. */
export const JAO7_REHEARSAL_CLASSES = Object.freeze([
  'VIRTUAL_OPERATOR_TASK_LEDGER',
  'VIRTUAL_CAPACITY_POOL',
] as const);

export type Jao7RehearsalClass = (typeof JAO7_REHEARSAL_CLASSES)[number];

/** The rehearsal lifecycle. `ROLLBACK_REQUIRED` is what makes safety cleanup survive a kill. */
export const JAO7_REHEARSAL_STATES = Object.freeze([
  'CAPTURED',
  'APPLIED',
  'VERIFIED',
  'ROLLBACK_REQUIRED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
] as const);

export type Jao7RehearsalState = (typeof JAO7_REHEARSAL_STATES)[number];

/** Which durable mutation an operation id is idempotent over. */
export const JAO7_OPERATION_KINDS = Object.freeze([
  'CREATE_RUN',
  'CLAIM_STEP',
  'FINALIZE_STEP',
  // Its OWN kind. Recording an authority correlation used to replay under `FINALIZE_STEP`, which
  // meant the audit trail named the wrong mutation -- and an audit trail that misnames what happened
  // is worse than one that says nothing, because a reader trusts it.
  'RECORD_AUTHORITY',
  'PAUSE_RUN',
  'RESUME_RUN',
  'KILL_RUN',
  'APPLY_REHEARSAL',
  'VERIFY_REHEARSAL',
  'ROLLBACK_REHEARSAL',
] as const);

export type Jao7OperationKind = (typeof JAO7_OPERATION_KINDS)[number];

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/** Every way JAO-7 can refuse. Closed, with a total message map, and no free text anywhere. */
export const JAO7_REFUSAL_REASONS = Object.freeze([
  'REQUEST_INVALID',
  'MISSION_UNKNOWN',
  'MISSION_VERSION_MISMATCH',
  'MISSION_NOT_ACTIVE',
  'SUBJECT_NOT_ALLOWED',
  'RUN_NOT_FOUND',
  'RUN_ALREADY_EXISTS',
  'PLAN_MISMATCH',
  'STATE_CONFLICT',
  'REVISION_CONFLICT',
  'OPERATION_CONFLICT',
  'RUN_PAUSED',
  'RUN_KILLED',
  'RUN_EXPIRED',
  'STEP_NOT_ELIGIBLE',
  'STEP_ALREADY_CLAIMED',
  'BUDGET_EXHAUSTED',
  'SPECIALIST_REFUSED',
  'SPECIALIST_ADVISORY_UNREVIEWED',
  'SPECIALIST_ADVISORY_WITHOUT_REMEDIATION',
  'SPECIALIST_OBSERVATION_MISSING',
  'TOOL_REFUSED',
  'PROPOSAL_REFUSED',
  'APPROVAL_DECISION_INVALID',
  'APPROVAL_NOT_APPROVED',
  'EXECUTION_INTENT_INVALID',
  'AUTHORITY_BINDING_MISMATCH',
  'REHEARSAL_NOT_ELIGIBLE',
  'REHEARSAL_APPLY_FAILED',
  'REHEARSAL_VERIFY_FAILED',
  'ROLLBACK_FAILED',
  'ROLLBACK_NOT_ELIGIBLE',
  'CANCELLED',
  'STORE_FAILED',
  'PERSISTED_STATE_INVALID',
  'RESULT_INVALID',
] as const);

export type Jao7RefusalReason = (typeof JAO7_REFUSAL_REASONS)[number];

/**
 * The fixed sentence per code, chosen BY the code and never built FROM an input.
 *
 * A total `Record`, so a new refusal cannot inherit an existing sentence: the map fails to compile
 * until somebody writes what the new code actually means.
 */
const JAO7_MESSAGES: Readonly<Record<Jao7RefusalReason, string>> = Object.freeze({
  REQUEST_INVALID: 'The autonomy request is invalid.',
  MISSION_UNKNOWN: 'No such mission policy is registered.',
  MISSION_VERSION_MISMATCH: 'That mission policy version is not the registered one.',
  MISSION_NOT_ACTIVE: 'That mission policy is not active for this proof.',
  SUBJECT_NOT_ALLOWED: 'The subject entity type is not allowed by the mission policy.',
  RUN_NOT_FOUND: 'No such autonomy run exists.',
  RUN_ALREADY_EXISTS: 'An autonomy run with that identity already exists.',
  PLAN_MISMATCH: 'The persisted plan digest is not the canonical plan for that mission.',
  STATE_CONFLICT: 'The run is not in a state that permits this operation.',
  REVISION_CONFLICT: 'The run has moved on since the expected revision.',
  OPERATION_CONFLICT: 'That operation id was already used to mean something else.',
  RUN_PAUSED: 'The run is paused and resumes only explicitly.',
  RUN_KILLED: 'The run has been killed.',
  RUN_EXPIRED: 'The run has expired.',
  STEP_NOT_ELIGIBLE: 'That step is not the next step of the canonical plan.',
  STEP_ALREADY_CLAIMED: 'That step has already been claimed.',
  BUDGET_EXHAUSTED: 'A mission policy budget is exhausted.',
  SPECIALIST_REFUSED: 'The governed specialist delegation refused.',
  SPECIALIST_ADVISORY_UNREVIEWED: 'The advisory conclusion is outside the reviewed JAO-7 mapping.',
  SPECIALIST_ADVISORY_WITHOUT_REMEDIATION:
    'The reviewed mapping concluded that advisory warrants no governed remediation.',
  SPECIALIST_OBSERVATION_MISSING: 'No durable specialist observation exists for this run.',
  TOOL_REFUSED: 'The virtual workbench refused.',
  PROPOSAL_REFUSED: 'The canonical proposal runtimes refused the assembled input.',
  APPROVAL_DECISION_INVALID: 'The supplied approval decision did not correlate.',
  APPROVAL_NOT_APPROVED: 'The supplied decision does not approve this exact action.',
  EXECUTION_INTENT_INVALID: 'The supplied execution intent did not correlate.',
  AUTHORITY_BINDING_MISMATCH: 'The authority evidence does not describe this run.',
  REHEARSAL_NOT_ELIGIBLE: 'No just-proven exact authority chain permits a rehearsal here.',
  REHEARSAL_APPLY_FAILED: 'The virtual rehearsal could not be applied.',
  REHEARSAL_VERIFY_FAILED: 'The virtual rehearsal did not verify.',
  ROLLBACK_FAILED: 'The virtual rollback did not restore the captured state.',
  ROLLBACK_NOT_ELIGIBLE: 'There is no applied virtual state for a rollback to restore.',
  CANCELLED: 'The operation was cancelled before it committed.',
  STORE_FAILED: 'The durable store could not be reached or answered unusably.',
  PERSISTED_STATE_INVALID: 'A persisted row no longer satisfies its contract.',
  RESULT_INVALID: 'The assembled result did not satisfy its own contract.',
});

/** The refusal, carrying a code and nothing else. A thrown object is never read for its message. */
export class Jao7AutonomyError extends Error {
  readonly code: Jao7RefusalReason;

  constructor(code: Jao7RefusalReason) {
    super(JAO7_MESSAGES[code]);
    this.name = 'Jao7AutonomyError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Posture.
// ---------------------------------------------------------------------------

/**
 * The posture every JAO-7 result carries, whatever happened.
 *
 * Literals, so a drifted value is a parse error rather than a differently-worded report. The
 * authority label is the longest field name in the slice on purpose: `OBSERVE_RECOMMEND_REHEARSE_ONLY`
 * is a sentence, and it is much harder to skim past than `SHADOW`.
 *
 * `executionIntentExecuted: false` is the field that matters most. A validated `ExecutionIntentV1`
 * names `quickfurno-core` as issuer and `n8n` as executor. JAO-7 correlates it and stops; it does
 * not become n8n because it happens to be holding the intent.
 */
export const jao7PostureSchema = z.strictObject({
  mode: z.literal('SHADOW'),
  authority: z.literal('OBSERVE_RECOMMEND_REHEARSE_ONLY'),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),
  approvalDecisionCreated: z.literal(false),
  executionIntentCreated: z.literal(false),
  executionIntentExecuted: z.literal(false),
  coreCalls: z.literal(0),
  n8nExecutions: z.literal(0),
  providerCalls: z.literal(0),
  channelSends: z.literal(0),
  managedMigrationAdopted: z.literal(false),
  productionSchemaApplied: z.literal(false),
  rehearsalOnly: z.literal(true),
});

export type Jao7Posture = z.infer<typeof jao7PostureSchema>;

/** The frozen posture value. One object, reused, never rebuilt from anything a caller supplied. */
export const JAO7_POSTURE: Jao7Posture = Object.freeze(
  jao7PostureSchema.parse({
    mode: 'SHADOW',
    authority: 'OBSERVE_RECOMMEND_REHEARSE_ONLY',
    businessEffect: false,
    productionMutation: false,
    approvalDecisionCreated: false,
    executionIntentCreated: false,
    executionIntentExecuted: false,
    coreCalls: 0,
    n8nExecutions: 0,
    providerCalls: 0,
    channelSends: 0,
    managedMigrationAdopted: false,
    productionSchemaApplied: false,
    rehearsalOnly: true,
  }),
);

/**
 * The producer stamped on every JAO-7 recommendation.
 *
 * `jarvis`, because Jarvis is what assembled it. JAO-6's owner review established the rule and
 * JAO-7 inherits it: the business domain of a proposal is not evidence about who concluded it, and
 * a specialist id may only be stamped where exact governed specialist output is bound to the
 * artifact. Mission A DOES call Riya -- and still stamps `jarvis`, because Riya advised and Jarvis
 * concluded.
 */
export const JAO7_PRODUCING_AGENT = 'jarvis' as const;
export const JAO7_PRODUCER_VERSION = 'jarvis.jao7.v1' as const;

// ---------------------------------------------------------------------------
// Durable views.
// ---------------------------------------------------------------------------

/** One recorded evaluation. Codes and indices only; no free text ever reaches a row. */
export const jao7EvaluationRecordSchema = z.strictObject({
  evaluationIndex: z.number().int().min(0).max(512),
  stepIndex: z.number().int().min(0).max(64),
  evaluatorCode: z.string().min(1).max(64),
  verdict: z.enum(JAO7_EVALUATION_VERDICTS),
  observedAt: jao7InstantSchema,
});

export type Jao7EvaluationRecord = z.infer<typeof jao7EvaluationRecordSchema>;

/** One recorded step. */
export const jao7StepRecordSchema = z.strictObject({
  stepIndex: z.number().int().min(0).max(64),
  /** Which attempt at that plan position this row is. Retained positions are attempted again. */
  attemptIndex: z.number().int().min(0).max(63),
  stepType: z.enum(JAO7_STEP_TYPES),
  stepStatus: z.enum(JAO7_STEP_STATUSES),
  startedAt: jao7InstantSchema,
  completedAt: jao7InstantSchema.nullable(),
  outcomeCode: z.string().min(1).max(64).nullable(),
});

export type Jao7StepRecord = z.infer<typeof jao7StepRecordSchema>;

/**
 * What was observed about authority, and NOT what it permits.
 *
 * Digests and identities. There is no raw `ApprovalDecisionV1`, no raw `ExecutionIntentV1`, no
 * `approved` boolean, no token and no header. A row that could be read as a grant is a row somebody
 * will eventually read as a grant, months later, with the artifact long expired.
 */
export const jao7AuthorityObservationRecordSchema = z.strictObject({
  /**
   * Which correlation attempt this row records.
   *
   * The table used to be keyed by `run_id` alone with `ON CONFLICT DO NOTHING`, so the FIRST
   * incomplete or rejected attempt consumed the only slot -- and a run still legitimately awaiting
   * authority could never record the exact chain when it finally arrived. A failed attempt must not
   * poison later valid evidence. At most one SUCCESSFUL chain per run is still enforced, by a
   * partial unique index rather than by whichever guard ran first.
   */
  attemptIndex: z.number().int().min(0).max(64),
  approvalDecisionDigest: jao7DigestSchema,
  executionIntentDigest: jao7DigestSchema.nullable(),
  recommendationId: z.string().min(1).max(128),
  proposedActionId: z.string().min(1).max(128),
  actionFingerprint: jao7DigestSchema,
  observationCode: z.enum(JAO7_AUTHORITY_OBSERVATIONS),
  observedAt: jao7InstantSchema,
});

export type Jao7AuthorityObservationRecord = z.infer<typeof jao7AuthorityObservationRecordSchema>;

/** The virtual sandbox, as durable integers. Two slots is all either rehearsal needs. */
export const jao7RehearsalRecordSchema = z.strictObject({
  rehearsalClass: z.enum(JAO7_REHEARSAL_CLASSES),
  beforeIntegerA: z.number().int().min(0).max(1_000_000),
  beforeIntegerB: z.number().int().min(0).max(1_000_000).nullable(),
  afterIntegerA: z.number().int().min(0).max(1_000_000).nullable(),
  afterIntegerB: z.number().int().min(0).max(1_000_000).nullable(),
  rollbackIntegerA: z.number().int().min(0).max(1_000_000).nullable(),
  rollbackIntegerB: z.number().int().min(0).max(1_000_000).nullable(),
  state: z.enum(JAO7_REHEARSAL_STATES),
  appliedAt: jao7InstantSchema.nullable(),
  verifiedAt: jao7InstantSchema.nullable(),
  /**
   * When a rollback was ATTEMPTED, and separately when one SUCCEEDED.
   *
   * They used to be one column, and the SQL check then read `state = ROLLED_BACK` if and only if a
   * rollback instant existed -- so a `ROLLBACK_FAILED` row carrying its attempted values violated
   * its own constraint and could not be written at all. A failure state that cannot be persisted is
   * a failure state that does not exist, which is the opposite of failing safe.
   */
  rollbackAttemptedAt: jao7InstantSchema.nullable(),
  rolledBackAt: jao7InstantSchema.nullable(),
  /** Bounded by the reviewed policy, and by a database CHECK. There is no retry storm. */
  rollbackAttempts: z.number().int().min(0).max(1),
  revision: z.number().int().min(1),
});

export type Jao7RehearsalRecord = z.infer<typeof jao7RehearsalRecordSchema>;

/** The durable run header, strictly decoded on every read. */
export const jao7RunRecordSchema = z.strictObject({
  runId: jao7IdSchema,
  missionPolicyId: jao7IdSchema,
  missionPolicyVersion: z.number().int().min(1).max(1_000),
  missionPolicyDigest: jao7DigestSchema,
  planDigest: jao7DigestSchema,
  subjectType: z.string().min(1).max(64),
  subjectId: z.string().min(1).max(128),
  state: z.enum(JAO7_RUN_STATES),
  currentStepIndex: z.number().int().min(0).max(64),
  revision: z.number().int().min(1),
  enrolledAt: jao7InstantSchema,
  expiresAt: jao7InstantSchema,
  killedAt: jao7InstantSchema.nullable(),
  pausedAt: jao7InstantSchema.nullable(),
  resumeCount: z.number().int().min(0).max(64),
  stepsCompleted: z.number().int().min(0).max(64),
  specialistCalls: z.number().int().min(0).max(8),
  toolCalls: z.number().int().min(0).max(16),
  modelCalls: z.literal(0),
  rehearsalApplies: z.number().int().min(0).max(4),
  /** The identity a later authority correlation must match. Written once, never the artifact. */
  proposalRecommendationId: z.string().min(1).max(128).nullable(),
  proposalActionId: z.string().min(1).max(128).nullable(),
  proposalActionFingerprint: jao7DigestSchema.nullable(),
  /**
   * THE DERIVED SPECIALIST OBSERVATION, written when the Riya step commits.
   *
   * Closed codes only -- the mapped remediation decision and a digest of the bounded advisory it
   * came from. No conversation, no prose, no reasoning: what is durable is WHAT WAS CONCLUDED and
   * WHICH advisory concluded it, which is what a restart needs and all a reader is owed.
   *
   * It exists because the proposal must be derived from the specialist's conclusion rather than
   * from anything a caller supplies, and a derivation that vanished on restart would be no
   * derivation at all.
   */
  specialistTaskReasonCode: z.string().min(1).max(64).nullable(),
  specialistTaskClass: z.string().min(1).max(64).nullable(),
  specialistDueWindowCode: z.string().min(1).max(64).nullable(),
  specialistPriorityBand: z.string().min(1).max(64).nullable(),
  specialistAdvisoryDigest: jao7DigestSchema.nullable(),
  createdAt: jao7InstantSchema,
  updatedAt: jao7InstantSchema,
});

export type Jao7RunRecord = z.infer<typeof jao7RunRecordSchema>;
