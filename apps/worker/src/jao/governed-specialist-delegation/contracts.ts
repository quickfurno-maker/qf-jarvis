/**
 * JAO-2 governed specialist delegation contracts (QFJ-P12, ADR-0116).
 *
 * ### The one invariant this file exists to make structural
 *
 * DELEGATED AUTHORITY <= SUPERVISOR AUTHORITY, and delegation never transfers or increases it.
 *
 * The overlay states the rule in words -- "delegate bounded analysis only to independently governed
 * and active specialists/capabilities; a PLANNED/DISABLED specialist remains unavailable; delegation
 * never transfers authority". Words are not a control, so every clause below is a closed vocabulary,
 * a literal, or a runtime comparison that fails closed.
 *
 * ### Autonomy is ORDERED, and the order is enforced at runtime
 *
 * TypeScript literals alone would not do it: an envelope arrives as `unknown` from a caller, and the
 * type is erased by the time it matters. `JAO2_AUTONOMY_RANK` gives the levels a total order so
 * "delegated must not exceed parent" is an arithmetic fact checked on parsed data, not a promise.
 *
 * ### What a JAO-2 delegation may never carry
 *
 * `businessEffectAllowed` and `maxCalls` are literals rather than bounded values, because there is
 * no legitimate JAO-2 request that sets them otherwise. A caller asking for effect authority, or for
 * a second specialist call, is refused by parsing rather than by policy that could be edited later.
 *
 * The specialist input is a strict, bounded mirror of the Riya turn context. It is DATA: there is no
 * free-form instruction field, no tool payload, no callback and no arbitrary object, so nothing a
 * caller supplies can become an executable request.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage.
 */
import { z } from 'zod';

/**
 * The autonomy ladder JAO-2 reasons over.
 *
 * Shares the JAO-1 spelling deliberately: the same two levels mean the same two things across the
 * overlay, and a second vocabulary would let a future reader believe JAO-2 invented a scale.
 */
export const JAO2_AUTONOMY_LEVELS = ['L0_REASON', 'L1_READ'] as const;
export type Jao2AutonomyLevel = (typeof JAO2_AUTONOMY_LEVELS)[number];

/**
 * The ORDER, as a total map.
 *
 * A level added to the vocabulary without a rank does not compile, which is the point: an unranked
 * level would otherwise compare as `undefined` and quietly satisfy every ceiling check.
 */
export const JAO2_AUTONOMY_RANK: Readonly<Record<Jao2AutonomyLevel, number>> = Object.freeze({
  L0_REASON: 0,
  L1_READ: 1,
});

export const JAO2_OUTCOMES = ['DELEGATION_COMPLETED', 'NO_ELIGIBLE_SPECIALIST', 'REFUSED'] as const;
export type Jao2Outcome = (typeof JAO2_OUTCOMES)[number];

/** Why a delegation was refused. Closed, content-free, and never a free-text explanation. */
export const JAO2_REFUSAL_REASONS = [
  /** The delegation envelope did not parse. */
  'ENVELOPE_INVALID',
  /** No such specialist is registered. Never a nearest match, never a substitute. */
  'SPECIALIST_UNKNOWN',
  /** Registered, but the capability requested is not the one it is governed for. */
  'CAPABILITY_MISMATCH',
  /** Registered and PLANNED. Recorded as a distinct reason from DISABLED: they mean different things. */
  'SPECIALIST_PLANNED',
  /** Registered and DISABLED. */
  'SPECIALIST_DISABLED',
  /** The request asked for more authority than the supervisor holds, or for effect/model/execution. */
  'AUTHORITY_ESCALATION',
  /** The bounded specialist input did not parse. Refused before the specialist is reached. */
  'SPECIALIST_INPUT_INVALID',
  /** The specialist returned something the advisory contract refuses. */
  'SPECIALIST_OUTPUT_INVALID',
  /** The specialist threw. Normalised; nothing the error carried is read. */
  'SPECIALIST_FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'WORKFLOW_FAILED',
] as const;
export type Jao2RefusalReason = (typeof JAO2_REFUSAL_REASONS)[number];

/**
 * Whether a registered specialist may be delegated to AT ALL.
 *
 * `ACTIVE` here means AVAILABLE FOR THIS JAO-2 SHADOW DELEGATION ADAPTER. It is emphatically NOT a
 * statement that the specialist's production channel is rolled out: Riya's WhatsApp runtime posture
 * is owned elsewhere and is unaffected by anything in this file. A later reader must not mistake
 * this registry for rollout truth, which is why the distinction is written here, in the ADR, and in
 * a spec.
 */
export const JAO2_SPECIALIST_AVAILABILITY = ['ACTIVE', 'PLANNED', 'DISABLED'] as const;
export type Jao2SpecialistAvailability = (typeof JAO2_SPECIALIST_AVAILABILITY)[number];

const boundedRefSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const runIdSchema = boundedRefSchema;

/**
 * What a governed specialist is allowed to be.
 *
 * `readOnly`, `businessEffect`, `mayCallModel`, `mayCreateProposal` and `mayExecute` are LITERALS.
 * A descriptor claiming any of them otherwise cannot be constructed at all -- the schema refuses it
 * at module load, so the registry cannot hold a specialist with effect authority even briefly.
 *
 * `availability` is an enum rather than a literal on purpose: PLANNED and DISABLED descriptors have
 * to be expressible so their refusal can be proved, while the production registry ships exactly one
 * entry and it is ACTIVE.
 */
export const jao2SpecialistDescriptorSchema = z.strictObject({
  specialistId: z.literal('RIYA'),
  capabilityId: z.literal('riya.analyze-client-sales-signals'),
  /** The specialist's OWN governing decision. JAO-2 consumes that governance; it does not grant it. */
  governanceRef: boundedRefSchema,
  availability: z.enum(JAO2_SPECIALIST_AVAILABILITY),
  maxAutonomyLevel: z.literal('L0_REASON'),
  dataClass: z.literal('SYNTHETIC_CLIENT_SALES_SIGNALS'),
  readOnly: z.literal(true),
  businessEffect: z.literal(false),
  maxCallsPerRun: z.literal(1),
  timeoutMs: z.literal(1_000),
  mayCallModel: z.literal(false),
  mayCreateProposal: z.literal(false),
  mayExecute: z.literal(false),
});

export type Jao2SpecialistDescriptor = z.infer<typeof jao2SpecialistDescriptorSchema>;

/**
 * The bounded client-sales context handed to the specialist.
 *
 * A strict mirror of the fields `RiyaTurnInput` actually reads. Deliberately NOT the Riya type
 * itself: accepting `RiyaTurnInput` would let an arbitrary object cross the seam untyped at runtime,
 * and the point of a delegation envelope is that what crosses it has been parsed.
 *
 * `signals` is a STRICT MIRROR of Riya's own closed `ClientSalesSignals` struct rather than a loose
 * record, so an unknown key is refused here and the adapter can narrow with Riya's own
 * `isClientSalesSignals` guard instead of casting. Free text has no way in: six booleans and one
 * bounded count are the entire vocabulary.
 */
export const jao2ClientSalesSignalsSchema = z.strictObject({
  hasPriorSalesContext: z.boolean(),
  requestedHumanAssistance: z.boolean(),
  requestedQuoteOrConsultation: z.boolean(),
  providedRequirementDetail: z.boolean(),
  askedAboutReadiness: z.boolean(),
  outOfSalesScope: z.boolean(),
  missingDiscoveryFieldCount: z.number().int().min(0).max(32),
});

export type Jao2ClientSalesSignals = z.infer<typeof jao2ClientSalesSignalsSchema>;

export const jao2RiyaSpecialistInputSchema = z.strictObject({
  partyType: z.string().min(1).max(32),
  currentActor: z.string().min(1).max(32).optional(),
  signals: jao2ClientSalesSignalsSchema,
  promptRef: boundedRefSchema,
  humanTakeover: z.boolean(),
  aiPaused: z.boolean(),
  /**
   * Already-validated discovery completeness, when the caller genuinely has one.
   *
   * Spelled out rather than imported as a value so JAO-2's envelope schema stays a plain contract,
   * and pinned to Riya's own `DISCOVERY_COMPLETENESS_FROZEN` by a spec so the two cannot drift.
   */
  needDiscoveryCompleteness: z
    .enum(['SUFFICIENT_FOR_CORE_REVIEW', 'MORE_DISCOVERY_REQUIRED', 'HUMAN_REVIEW_REQUIRED'])
    .optional(),
});

export type Jao2RiyaSpecialistInput = z.infer<typeof jao2RiyaSpecialistInputSchema>;

/**
 * The delegation request.
 *
 * `businessEffectAllowed` and `maxCalls` are literals because no legitimate JAO-2 caller sets them
 * otherwise. `parentAutonomyLevel` is carried explicitly so the ceiling check has both sides of the
 * comparison on parsed data rather than inferring the supervisor's authority from context.
 */
export const jao2DelegationEnvelopeSchema = z.strictObject({
  delegationId: boundedRefSchema,
  runId: runIdSchema,
  specialistId: z.string().min(1).max(64),
  capabilityId: z.string().min(1).max(96),
  requestedAutonomyLevel: z.enum(JAO2_AUTONOMY_LEVELS),
  parentAutonomyLevel: z.enum(JAO2_AUTONOMY_LEVELS),
  businessEffectAllowed: z.literal(false),
  maxCalls: z.literal(1),
  input: jao2RiyaSpecialistInputSchema,
});

export type Jao2DelegationEnvelope = z.infer<typeof jao2DelegationEnvelopeSchema>;

export const jao2WorkflowInputSchema = z.strictObject({
  runId: runIdSchema,
  envelope: z.unknown(),
});

export type Jao2WorkflowInput = z.infer<typeof jao2WorkflowInputSchema>;

/**
 * What a specialist is permitted to hand back.
 *
 * `advisoryOnly`, `businessEffect`, `proposalCreated` and `executionRequested` are literals, so an
 * adapter cannot return a result that claims to have done anything.
 *
 * `modelReplyEligible` is carried through because it is genuinely part of Riya's bounded decision --
 * and it is DATA. It says the merged model-reply boundary MAY be invoked for that turn by whoever
 * owns that boundary. It is not permission for JAO-2 to invoke anything, JAO-2 makes zero model
 * calls whatever its value, and a spec proves exactly that.
 */
export const jao2AdvisoryResultSchema = z.strictObject({
  specialistId: z.literal('RIYA'),
  capabilityId: z.literal('riya.analyze-client-sales-signals'),
  behaviourVersion: z.string().min(1).max(64),
  intent: z.string().min(1).max(64),
  disposition: z.string().min(1).max(64),
  reason: z.string().min(1).max(64),
  /** DATA ONLY. Never read as authority by JAO-2. */
  modelReplyEligible: z.boolean(),
  advisoryOnly: z.literal(true),
  businessEffect: z.literal(false),
  proposalCreated: z.literal(false),
  executionRequested: z.literal(false),
  decisionRefs: z.array(z.string().min(1).max(160)).max(8),
});

export type Jao2AdvisoryResult = z.infer<typeof jao2AdvisoryResultSchema>;

export const jao2DelegationStepOutputSchema = z.strictObject({
  runId: runIdSchema,
  delegationId: boundedRefSchema.nullable(),
  outcome: z.enum(JAO2_OUTCOMES),
  refusalReason: z.enum(JAO2_REFUSAL_REASONS).nullable(),
  specialistId: z.string().min(1).max(64).nullable(),
  capabilityId: z.string().min(1).max(96).nullable(),
  advisory: jao2AdvisoryResultSchema.nullable(),
  delegatedAutonomyLevel: z.enum(JAO2_AUTONOMY_LEVELS).nullable(),
  delegationCalls: z.number().int().min(0).max(1),
  modelCalls: z.literal(0),
  businessEffect: z.literal(false),
});

export type Jao2DelegationStepOutput = z.infer<typeof jao2DelegationStepOutputSchema>;

export const jao2RunResultSchema = jao2DelegationStepOutputSchema.extend({
  taskType: z.literal('jarvis.operations.governed-specialist-delegation'),
  parentAutonomyLevel: z.literal('L1_READ'),
  specialistsInvoked: z.array(z.literal('RIYA')).max(1),
  governanceRef: boundedRefSchema.nullable(),
  durationMs: z.number().int().nonnegative().max(600_000),
});

export type Jao2RunResult = z.infer<typeof jao2RunResultSchema>;

/**
 * Bounded operational telemetry.
 *
 * Carries ids, levels, counters, a duration and closed tokens. There is no field that could hold a
 * secret, a credential, a chain of thought, a conversation transcript or unrestricted user text --
 * the signal flags a caller supplied are not echoed here either.
 */
export const jao2TelemetryEventSchema = z.strictObject({
  runId: runIdSchema,
  delegationId: boundedRefSchema.nullable(),
  triggerType: z.literal('EXPLICIT_SHADOW_PROOF'),
  taskType: z.literal('jarvis.operations.governed-specialist-delegation'),
  parentAutonomyLevel: z.literal('L1_READ'),
  delegatedAutonomyLevel: z.enum(JAO2_AUTONOMY_LEVELS).nullable(),
  specialistId: z.string().min(1).max(64).nullable(),
  capabilityId: z.string().min(1).max(96).nullable(),
  availabilityDecision: z.enum(JAO2_SPECIALIST_AVAILABILITY).nullable(),
  behaviourVersion: z.string().min(1).max(64).nullable(),
  delegationCalls: z.number().int().min(0).max(1),
  modelCalls: z.literal(0),
  durationMs: z.number().int().nonnegative().max(600_000),
  outcome: z.enum(JAO2_OUTCOMES),
  refusalReason: z.enum(JAO2_REFUSAL_REASONS).nullable(),
});

export type Jao2TelemetryEvent = z.infer<typeof jao2TelemetryEventSchema>;

export interface Jao2TelemetryHook {
  record(event: Jao2TelemetryEvent): void;
}

export interface Jao2Clock {
  nowMs(): number;
}
