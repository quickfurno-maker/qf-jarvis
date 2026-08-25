/**
 * JAO-3 operational investigation memory contracts (QFJ-P12, ADR-0117).
 *
 * ### The one invariant this file exists to make structural
 *
 * A REMEMBERED AUTHORIZATION IS NOT CURRENT PERMISSION.
 *
 * JAO-3 stores what an investigation has found so it can be resumed. It stores nothing that could
 * be read as permission to act, and the way that is guaranteed is not a review convention: there is
 * no field anywhere below that could carry one. `isAuthorized`, `canExecute`, `canSend`,
 * `approvalGranted`, `authorizationValid`, `authorizedAction`, `executionAllowed` do not exist here,
 * every object is `strict`, and a spec asserts the absence by name over the parsed surface.
 *
 * An evidence reference may POINT AT a historical approval record. That is a pointer to something
 * that was true once. QuickFurno Core remains the only thing that can say what is true now.
 *
 * ### Memory is not a transcript
 *
 * Nothing here can hold chain-of-thought, a scratchpad, a model transcript, a user transcript, a
 * provider body, a credential or an arbitrary blob. There is no JSON column and no open-ended
 * string: every text field is short and bounded, every array is capped, and evidence is a REFERENCE
 * rather than a payload. An unbounded field would eventually carry exactly the thing this slice
 * promises not to keep -- not through malice, but because someone would have somewhere to put it.
 *
 * ### Bounds are stated once, and persisted
 *
 * `JAO3_BUDGET_LIMITS` is the ceiling. It is written into the investigation row at creation, so a
 * restart cannot reset it and a resuming caller cannot widen it: the persisted budget is compared
 * against the ceiling on every read, and a row claiming more than the ceiling is refused as
 * corrupt rather than honoured.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage.
 */
import { z } from 'zod';

/**
 * A canonical UTC instant: `2026-08-25T12:00:00.000Z` and nothing else.
 *
 * The repository's established pattern (`canonicalInstantSchema`, ADR-0086): the regex fixes the
 * shape, then the round-trip through `Date` rejects the impossible calendar dates the regex would
 * happily accept -- `2026-02-31` normalises to March 3 in JavaScript, so a shape check alone would
 * store an instant nobody wrote. Spelled out locally rather than imported, because the
 * control-plane package exports the TYPE but not the schema value.
 */
export const jao3InstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  });

export type Jao3Instant = z.infer<typeof jao3InstantSchema>;

/** A bounded identifier. The same grammar the rest of the JAO slices use. */
const boundedIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * The canonical investigation identifier, exported so every entry point parses the SAME grammar.
 *
 * The two read methods take an id rather than a request object, so without this they would reach
 * SQL with whatever a caller passed. Parameterized statements make that safe from injection, which
 * is not the same as the adapter having checked its own domain boundary -- an unbounded or
 * malformed id should be refused by JAO-3, not merely survived by PostgreSQL.
 */
export const jao3InvestigationIdSchema = boundedIdSchema;

/** A short auditable statement. Bounded because this is a note, never a transcript. */
const shortStatementSchema = z.string().min(1).max(240);

/** A checkpoint summary. Longer than a statement, still nowhere near a transcript. */
const summarySchema = z.string().min(1).max(480);

/**
 * The lifecycle. There is deliberately no `RUNNING`.
 *
 * `RUNNING` would imply something is executing on its own, and JAO-3 owns no scheduler, no timer
 * and no background resume -- ambient operation is JAO-5's to design and govern. An investigation
 * is `OPEN` or `PAUSED` between explicit operations; nothing advances it while nobody is looking.
 */
export const JAO3_INVESTIGATION_STATUSES = [
  'OPEN',
  'PAUSED',
  'COMPLETED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type Jao3InvestigationStatus = (typeof JAO3_INVESTIGATION_STATUSES)[number];

/**
 * Which statuses may be resumed or written to, as a TOTAL map.
 *
 * A status added to the vocabulary without an entry does not compile. That is the point: an
 * unlisted status would read as `undefined`, and `undefined` is falsy, which means a new terminal
 * state would silently become unresumable -- or, with the comparison written the other way round,
 * silently resumable. Neither should be decided by an omission.
 */
export const JAO3_STATUS_ACCEPTS_WRITES: Readonly<Record<Jao3InvestigationStatus, boolean>> =
  Object.freeze({
    OPEN: true,
    PAUSED: true,
    COMPLETED: false,
    EXPIRED: false,
    SUPERSEDED: false,
  });

/**
 * The bounded workflow states an investigation can be parked in.
 *
 * Descriptive, not executable: no state names a tool, a queue, a channel or an action, and nothing
 * consumes these to decide what to do next. They exist so a resumed investigation can say where it
 * had got to.
 */
export const JAO3_WORKFLOW_STATES = [
  'DISCOVERY',
  'ANALYSIS',
  'AWAITING_OWNER_INPUT',
  'SUMMARY',
] as const;
export type Jao3WorkflowState = (typeof JAO3_WORKFLOW_STATES)[number];

/**
 * Where a piece of evidence came from. Closed, and deliberately authority-free.
 *
 * There is no `APPROVAL_GRANT`, no `AUTHORIZATION`, no `EXECUTION_RECEIPT` -- not because those
 * records do not exist, but because naming one here would invite a later reader to treat the
 * reference as the permission. A control-plane snapshot and a specialist advisory are observations;
 * an operator note is a note; a repository proof is a commit. None of them authorise anything.
 */
export const JAO3_EVIDENCE_SOURCE_CLASSES = [
  'CONTROL_PLANE_SNAPSHOT',
  'SPECIALIST_ADVISORY',
  'REPOSITORY_PROOF',
  'OPERATOR_NOTE',
  'TEST_FIXTURE',
] as const;
export type Jao3EvidenceSourceClass = (typeof JAO3_EVIDENCE_SOURCE_CLASSES)[number];

/**
 * What JAO-3 claims to know, and how strongly.
 *
 * `HYPOTHESIS`, `OBSERVED`, `DISPROVED` -- and no `CONFIRMED`, `AUTHORIZED` or `APPROVED`. The
 * strongest thing an investigation may record is that it observed something. Whether an observation
 * is business truth is not JAO-3's to say.
 */
export const JAO3_EPISTEMIC_STATUSES = ['HYPOTHESIS', 'OBSERVED', 'DISPROVED'] as const;
export type Jao3EpistemicStatus = (typeof JAO3_EPISTEMIC_STATUSES)[number];

/** What an owner correction is aimed at. */
export const JAO3_CORRECTION_TARGET_TYPES = ['INVESTIGATION', 'CHECKPOINT', 'HYPOTHESIS'] as const;
export type Jao3CorrectionTargetType = (typeof JAO3_CORRECTION_TARGET_TYPES)[number];

/**
 * The closed public error vocabulary.
 *
 * Every failure is one of these. No message is built from an input, a row, a driver error or a
 * connection target -- ADR-0091's rule, for the same reason: a `pg` error carries the failing SQL,
 * the constraint, the column, the bound parameters, the host and often the user, and reflecting one
 * upward turns a transient outage into a schema disclosure.
 *
 * `DATABASE_UNAVAILABLE` is never substituted for a real answer. An adapter that cannot reach the
 * database does not report `INVESTIGATION_NOT_FOUND`, because "I could not look" and "it is not
 * there" are different facts and only one of them is safe to act on.
 */
export const JAO3_ERROR_CODES = [
  'INVESTIGATION_NOT_FOUND',
  'INVESTIGATION_ALREADY_EXISTS',
  'RUN_ID_MISMATCH',
  'REVISION_CONFLICT',
  'STATUS_NOT_RESUMABLE',
  'INVESTIGATION_EXPIRED',
  'INVESTIGATION_SUPERSEDED',
  'BUDGET_EXHAUSTED',
  'CHECKPOINT_CONFLICT',
  'CORRECTION_CONFLICT',
  /**
   * The correction names a target that does not belong to this investigation.
   *
   * Deliberately ONE code for "there is no such target" and "it belongs to a different
   * investigation". Separating them would answer a question the caller has no business asking: a
   * caller able to distinguish the two could enumerate which checkpoint and hypothesis ids exist
   * elsewhere, one refusal at a time.
   */
  'CORRECTION_TARGET_NOT_FOUND',
  'SUPERSESSION_INVALID',
  'INPUT_INVALID',
  'PERSISTED_STATE_INVALID',
  'STORE_SCHEMA_INCOMPATIBLE',
  'DATABASE_UNAVAILABLE',
] as const;
export type Jao3ErrorCode = (typeof JAO3_ERROR_CODES)[number];

/**
 * The fixed message per code. Chosen BY the code, never built FROM the input.
 *
 * A total map, so a code added without a message does not compile.
 */
const JAO3_ERROR_MESSAGES: Readonly<Record<Jao3ErrorCode, string>> = Object.freeze({
  INVESTIGATION_NOT_FOUND: 'No such investigation is recorded.',
  INVESTIGATION_ALREADY_EXISTS: 'An investigation with that identity is already recorded.',
  RUN_ID_MISMATCH: 'The operation named a different run than the investigation it addresses.',
  REVISION_CONFLICT: 'The investigation was written by someone else first.',
  STATUS_NOT_RESUMABLE: 'The investigation is in a status that accepts no further work.',
  INVESTIGATION_EXPIRED: 'The investigation has expired.',
  INVESTIGATION_SUPERSEDED: 'The investigation has been superseded.',
  BUDGET_EXHAUSTED: 'The investigation has reached a persisted budget.',
  CHECKPOINT_CONFLICT: 'That operation id was already used for a different checkpoint.',
  CORRECTION_CONFLICT: 'That operation id was already used for a different owner correction.',
  CORRECTION_TARGET_NOT_FOUND: 'The correction target does not belong to this investigation.',
  SUPERSESSION_INVALID: 'The supersession target is not a valid replacement.',
  INPUT_INVALID: 'The operation input is invalid.',
  PERSISTED_STATE_INVALID: 'A stored investigation record is inconsistent.',
  STORE_SCHEMA_INCOMPATIBLE: 'The operational memory schema is incompatible.',
  DATABASE_UNAVAILABLE: 'The operational memory store is unavailable.',
});

/** A bounded JAO-3 failure. The code is the contract; the message is fixed per code. */
export class Jao3MemoryError extends Error {
  readonly code: Jao3ErrorCode;

  constructor(code: Jao3ErrorCode) {
    super(JAO3_ERROR_MESSAGES[code]);
    this.name = 'Jao3MemoryError';
    this.code = code;
  }
}

/**
 * The ceiling. Conservative, and locked by ADR-0117 and a spec.
 *
 * These are first-proof numbers for an offline slice, not capacity planning. They are small on
 * purpose: a bound that is never reached proves nothing, and a bound chosen generously enough to
 * be comfortable is a bound nobody notices being wrong.
 */
export const JAO3_BUDGET_LIMITS = Object.freeze({
  maxCheckpoints: 32,
  maxEvidenceRefsPerCheckpoint: 8,
  maxHypothesesPerCheckpoint: 4,
  maxOwnerCorrections: 16,
  maxResumeCount: 16,
  /** Seven days. Expiry is semantic -- see `policy.ts` -- and no sweeper enforces it. */
  maxLifetimeMs: 7 * 24 * 60 * 60 * 1_000,
});

/**
 * The persisted budget.
 *
 * Stored per investigation rather than read from the constant at use time, because the whole point
 * is that a restart cannot reset it: a process reading today's constant would silently re-grant
 * whatever the code happens to allow now. Each field is bounded ABOVE by the ceiling in the schema
 * itself, so a persisted row claiming more than JAO-3 ever grants cannot parse.
 */
export const jao3BudgetSchema = z.strictObject({
  maxCheckpoints: z.number().int().min(1).max(JAO3_BUDGET_LIMITS.maxCheckpoints),
  maxEvidenceRefsPerCheckpoint: z
    .number()
    .int()
    .min(1)
    .max(JAO3_BUDGET_LIMITS.maxEvidenceRefsPerCheckpoint),
  maxHypothesesPerCheckpoint: z
    .number()
    .int()
    .min(1)
    .max(JAO3_BUDGET_LIMITS.maxHypothesesPerCheckpoint),
  maxOwnerCorrections: z.number().int().min(1).max(JAO3_BUDGET_LIMITS.maxOwnerCorrections),
  maxResumeCount: z.number().int().min(0).max(JAO3_BUDGET_LIMITS.maxResumeCount),
  maxLifetimeMs: z.number().int().min(1_000).max(JAO3_BUDGET_LIMITS.maxLifetimeMs),
});

export type Jao3Budget = z.infer<typeof jao3BudgetSchema>;

/** The default budget: the ceiling itself. */
export const JAO3_DEFAULT_BUDGET: Jao3Budget = Object.freeze(
  jao3BudgetSchema.parse({ ...JAO3_BUDGET_LIMITS }),
);

/**
 * An evidence REFERENCE. A pointer, never a payload.
 *
 * `evidenceRef` is an identifier in the bounded grammar -- a snapshot id, a commit sha, an advisory
 * id. There is no `body`, no `content`, no `payload`, no `response` and no `raw` field, and a spec
 * asserts those names are absent, because the moment one existed a caller would use it and JAO-3
 * would be storing the thing it promised not to.
 */
export const jao3EvidenceRefSchema = z.strictObject({
  evidenceRef: boundedIdSchema,
  kind: z.string().min(1).max(48),
  sourceClass: z.enum(JAO3_EVIDENCE_SOURCE_CLASSES),
  observedAt: jao3InstantSchema,
});

export type Jao3EvidenceRef = z.infer<typeof jao3EvidenceRefSchema>;

/**
 * A bounded, explicitly non-authoritative hypothesis.
 *
 * `authority` is `z.literal('NONE')`. Not a default, not a convention -- a literal, so a hypothesis
 * claiming any other authority cannot be constructed, cannot be persisted, and cannot be read back.
 */
export const jao3HypothesisSchema = z.strictObject({
  /**
   * A bounded identity, so an owner correction can name exactly one hypothesis.
   *
   * Added by owner-review correction. Without it a hypothesis was addressable only as
   * (checkpoint, ordinal), so a correction targeting one could not be checked against the
   * investigation that owns it -- and an unverifiable target is an integrity gap, not a
   * convenience gap.
   */
  hypothesisId: boundedIdSchema,
  statement: shortStatementSchema,
  epistemicStatus: z.enum(JAO3_EPISTEMIC_STATUSES),
  authority: z.literal('NONE'),
});

export type Jao3Hypothesis = z.infer<typeof jao3HypothesisSchema>;

/**
 * An immutable checkpoint.
 *
 * Written once, never rewritten. `revision` is the revision this checkpoint CREATED, and the
 * database holds `UNIQUE (investigation_id, revision)` so two writers cannot both claim one.
 */
export const jao3CheckpointSchema = z.strictObject({
  checkpointId: boundedIdSchema,
  investigationId: boundedIdSchema,
  revision: z.number().int().min(1),
  runId: boundedIdSchema,
  workflowState: z.enum(JAO3_WORKFLOW_STATES),
  summary: summarySchema,
  evidenceRefs: z.array(jao3EvidenceRefSchema).max(JAO3_BUDGET_LIMITS.maxEvidenceRefsPerCheckpoint),
  hypotheses: z.array(jao3HypothesisSchema).max(JAO3_BUDGET_LIMITS.maxHypothesesPerCheckpoint),
  nextObjective: shortStatementSchema.nullable(),
  createdAt: jao3InstantSchema,
});

export type Jao3Checkpoint = z.infer<typeof jao3CheckpointSchema>;

/**
 * An owner correction. Append-only, and powerless.
 *
 * `actor` is the literal `FOUNDER` and `supersedesTarget` the literal `true`. Both are labels in an
 * offline proof: **this is not authentication.** The actor is injected by the caller, JAO-3 verifies
 * no identity, and nothing about a correction grants authority -- it changes what the investigation
 * remembers and nothing else. There is no field here that could approve, authorise or dispatch.
 */
export const jao3OwnerCorrectionSchema = z.strictObject({
  correctionId: boundedIdSchema,
  investigationId: boundedIdSchema,
  revision: z.number().int().min(1),
  targetType: z.enum(JAO3_CORRECTION_TARGET_TYPES),
  targetId: boundedIdSchema,
  correctionStatement: shortStatementSchema,
  actor: z.literal('FOUNDER'),
  supersedesTarget: z.literal(true),
  createdAt: jao3InstantSchema,
});

export type Jao3OwnerCorrection = z.infer<typeof jao3OwnerCorrectionSchema>;

/**
 * The investigation header -- the durable record JAO-3 exists to keep.
 *
 * `rootRunId` is the run that opened it and never changes. `currentRunId` is the run working on it
 * now, and changes only through an explicit resume. `revision` is the compare-and-set token.
 *
 * Note what is NOT here: no authorization, no permission, no approval, no effect, no execution, no
 * channel, no recipient, no contact, no consent, no credential, no transcript.
 */
export const jao3InvestigationSchema = z.strictObject({
  investigationId: boundedIdSchema,
  rootRunId: boundedIdSchema,
  currentRunId: boundedIdSchema,
  revision: z.number().int().min(1),
  status: z.enum(JAO3_INVESTIGATION_STATUSES),
  objective: shortStatementSchema,
  workflowState: z.enum(JAO3_WORKFLOW_STATES),
  createdAt: jao3InstantSchema,
  updatedAt: jao3InstantSchema,
  expiresAt: jao3InstantSchema,
  supersededByInvestigationId: boundedIdSchema.nullable(),
  latestCheckpointId: boundedIdSchema.nullable(),
  checkpointCount: z.number().int().min(0).max(JAO3_BUDGET_LIMITS.maxCheckpoints),
  ownerCorrectionCount: z.number().int().min(0).max(JAO3_BUDGET_LIMITS.maxOwnerCorrections),
  resumeCount: z.number().int().min(0).max(JAO3_BUDGET_LIMITS.maxResumeCount),
  budget: jao3BudgetSchema,
  /**
   * The memory class, as a literal on every record that leaves this slice.
   *
   * A reader holding one of these records cannot mistake it for business truth without deleting a
   * field that will not parse as anything else.
   */
  memoryClass: z.literal('OPERATIONAL_NON_AUTHORITATIVE'),
});

export type Jao3Investigation = z.infer<typeof jao3InvestigationSchema>;

/** An investigation together with its checkpoint history, oldest first. */
export const jao3InvestigationViewSchema = z.strictObject({
  investigation: jao3InvestigationSchema,
  checkpoints: z.array(jao3CheckpointSchema).max(JAO3_BUDGET_LIMITS.maxCheckpoints),
  ownerCorrections: z.array(jao3OwnerCorrectionSchema).max(JAO3_BUDGET_LIMITS.maxOwnerCorrections),
});

export type Jao3InvestigationView = z.infer<typeof jao3InvestigationViewSchema>;

// ---------------------------------------------------------------------------
// Operation inputs.
// ---------------------------------------------------------------------------

export const jao3CreateInvestigationInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  rootRunId: boundedIdSchema,
  objective: shortStatementSchema,
  workflowState: z.enum(JAO3_WORKFLOW_STATES),
  /** How long this investigation may live, bounded by the ceiling. */
  lifetimeMs: z.number().int().min(1_000).max(JAO3_BUDGET_LIMITS.maxLifetimeMs),
});

export type Jao3CreateInvestigationInput = z.infer<typeof jao3CreateInvestigationInputSchema>;

/** A checkpoint as a caller supplies it: the durable fields are the store's to assign. */
export const jao3AppendCheckpointInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  /** The run performing this write. Must be the investigation's CURRENT run. */
  runId: boundedIdSchema,
  expectedRevision: z.number().int().min(1),
  /** Bounded and required, so a retried write is recognisable as the same write. */
  operationId: boundedIdSchema,
  checkpointId: boundedIdSchema,
  workflowState: z.enum(JAO3_WORKFLOW_STATES),
  summary: summarySchema,
  evidenceRefs: z.array(jao3EvidenceRefSchema).max(JAO3_BUDGET_LIMITS.maxEvidenceRefsPerCheckpoint),
  hypotheses: z.array(jao3HypothesisSchema).max(JAO3_BUDGET_LIMITS.maxHypothesesPerCheckpoint),
  nextObjective: shortStatementSchema.nullable(),
});

export type Jao3AppendCheckpointInput = z.infer<typeof jao3AppendCheckpointInputSchema>;

export const jao3AppendOwnerCorrectionInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  runId: boundedIdSchema,
  expectedRevision: z.number().int().min(1),
  operationId: boundedIdSchema,
  correctionId: boundedIdSchema,
  targetType: z.enum(JAO3_CORRECTION_TARGET_TYPES),
  targetId: boundedIdSchema,
  correctionStatement: shortStatementSchema,
  actor: z.literal('FOUNDER'),
});

export type Jao3AppendOwnerCorrectionInput = z.infer<typeof jao3AppendOwnerCorrectionInputSchema>;

/**
 * Resume. Explicit, and the only way `currentRunId` ever changes.
 *
 * There is no auto-resume anywhere in this slice: no timer, no queue, no sweeper. A resume happens
 * because something called this with an investigation id, the revision it believes it saw, and the
 * run that intends to continue.
 */
export const jao3ResumeInvestigationInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  expectedRevision: z.number().int().min(1),
  /** The NEW run taking over. `rootRunId` is untouched by this or anything else. */
  nextRunId: boundedIdSchema,
});

export type Jao3ResumeInvestigationInput = z.infer<typeof jao3ResumeInvestigationInputSchema>;

export const jao3TransitionInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  runId: boundedIdSchema,
  expectedRevision: z.number().int().min(1),
});

export type Jao3TransitionInput = z.infer<typeof jao3TransitionInputSchema>;

export const jao3SupersedeInvestigationInputSchema = z.strictObject({
  investigationId: boundedIdSchema,
  runId: boundedIdSchema,
  expectedRevision: z.number().int().min(1),
  /** The replacement. Must differ from the investigation being superseded. */
  supersededByInvestigationId: boundedIdSchema,
});

export type Jao3SupersedeInvestigationInput = z.infer<typeof jao3SupersedeInvestigationInputSchema>;

// ---------------------------------------------------------------------------
// Telemetry.
// ---------------------------------------------------------------------------

export const JAO3_OPERATIONS = [
  'CREATE',
  'READ',
  'APPEND_CHECKPOINT',
  'APPEND_OWNER_CORRECTION',
  'RESUME',
  'PAUSE',
  'COMPLETE',
  'SUPERSEDE',
] as const;
export type Jao3Operation = (typeof JAO3_OPERATIONS)[number];

/**
 * Bounded operational telemetry.
 *
 * Ids, counters, a status, a duration and a closed outcome. There is no field for a summary, a
 * hypothesis, a correction statement, an evidence payload, a credential, a chain of thought or a
 * database message -- telemetry is not a second memory store, and a telemetry pipeline is exactly
 * where content that was carefully kept out of the database tends to reappear.
 */
export const jao3TelemetryEventSchema = z.strictObject({
  investigationId: boundedIdSchema,
  runId: boundedIdSchema,
  operation: z.enum(JAO3_OPERATIONS),
  revision: z.number().int().min(0),
  status: z.enum(JAO3_INVESTIGATION_STATUSES).nullable(),
  checkpointCount: z.number().int().min(0),
  ownerCorrectionCount: z.number().int().min(0),
  resumeCount: z.number().int().min(0),
  durationMs: z.number().int().nonnegative().max(600_000),
  outcome: z.enum(['COMPLETED', 'REFUSED']),
  errorCode: z.enum(JAO3_ERROR_CODES).nullable(),
  memoryClass: z.literal('OPERATIONAL_NON_AUTHORITATIVE'),
  modelCalls: z.literal(0),
  specialistCalls: z.literal(0),
  businessEffect: z.literal(false),
});

export type Jao3TelemetryEvent = z.infer<typeof jao3TelemetryEventSchema>;

export interface Jao3TelemetryHook {
  record(event: Jao3TelemetryEvent): void;
}

/** Injected, like JAO-1 and JAO-2. Nothing in this slice reads a clock of its own. */
export interface Jao3Clock {
  nowMs(): number;
}
