/**
 * The JAO-7 public request and result shapes (ADR-0121).
 *
 * ### What a caller may state, and the long list of what it may not
 *
 * A caller states a mission by NAME, a subject, bounded wording, closed evidence, closed mission
 * input, and an operation id. It does not state the risk, the approval level, the action type, the
 * contract version, the recommendation type, the producer, the plan, the steps, the budgets, the
 * autonomy ceiling, the capacity target or the rollback target -- because every one of those decides
 * something, and the request schema is strict, so naming one is a refusal rather than something
 * quietly consulted.
 *
 * ### The authority evidence is the one thing that must come from outside
 *
 * `approvalDecision` and `executionIntent` are supplied by the caller and validated by the canonical
 * runtimes. That is not a weakness of the proof; it IS the proof. JAO-7 has no constructor for either
 * artifact, no Core transport to fetch one from, and no n8n client to hand one to. The only way the
 * run can move past the authority gate is for somebody outside to produce artifacts that correlate --
 * and the posture literal records honestly that in this offline proof those artifacts are injected
 * rather than authenticated.
 */
import {
  approvalRequestV1Schema,
  evidenceItemSchema,
  recommendationV1Schema,
  TEXT_LIMITS,
  boundedText,
} from '@qf-jarvis/contracts';
import type { ApprovalRequestV1, EvidenceItem, RecommendationV1 } from '@qf-jarvis/contracts';
import type { RecommendationActionBinding } from '@qf-jarvis/recommendation-runtime';
import { z } from 'zod';

import {
  JAO7_OUTCOMES,
  JAO7_REFUSAL_REASONS,
  JAO7_RUN_STATES,
  JAO7_STATE_OUTCOMES,
  jao7AuthorityObservationRecordSchema,
  jao7DigestSchema,
  jao7EvaluationRecordSchema,
  jao7IdSchema,
  jao7PostureSchema,
  jao7RehearsalRecordSchema,
  jao7StepRecordSchema,
  type Jao7AuthorityObservationRecord,
  type Jao7EvaluationRecord,
  type Jao7Posture,
  type Jao7RehearsalRecord,
  type Jao7RunState,
  type Jao7StepRecord,
  type Jao7StepType,
  type Jao7EvaluationVerdict,
} from './contracts.js';
import { jao7CapacityObservationSchema } from './capacity.js';

/** Creating a run. The mission is NAMED; every bound it carries comes from the reviewed policy. */
export const jao7CreateRunRequestSchema = z.strictObject({
  runId: jao7IdSchema,
  operationId: jao7IdSchema,
  missionPolicyId: jao7IdSchema,
  missionPolicyVersion: z.number().int().min(1).max(1_000),
  subject: z.strictObject({
    entityType: z.string().min(1).max(64),
    entityId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/u),
  }),
  /**
   * The synthetic pool's starting concurrency, for the capacity mission's sandbox capture.
   *
   * This is the BEFORE state of a virtual integer, not a production reading, and it is captured at
   * creation so a rollback target exists before anything can apply.
   */
  initialConcurrency: z.number().int().min(1).max(32).optional(),
});

export type Jao7CreateRunRequest = z.infer<typeof jao7CreateRunRequestSchema>;

/**
 * The per-step request.
 *
 * `authority` is `z.unknown()` and is parsed by the CANONICAL runtimes rather than re-declared here:
 * re-stating `ApprovalDecisionV1` or `ExecutionIntentV1` would create a second definition of a
 * contract `@qf-jarvis/contracts` already owns, free to drift from it.
 */
export const jao7AutonomyRequestSchema = z.strictObject({
  runId: jao7IdSchema,
  operationId: jao7IdSchema,
  correlationId: z.uuid(),

  summary: boundedText(TEXT_LIMITS.summary),
  rationale: boundedText(TEXT_LIMITS.rationale),
  evidence: z.array(evidenceItemSchema).min(1).max(8),
  /** Data. Calibration only; it touches no gate at any value. */
  confidence: z.number().min(0).max(1),

  /**
   * Mission A input. CLIENT SALES SIGNALS ONLY -- the scope Riya's behaviour is governed for.
   *
   * There is deliberately no `operatorTask` beside it. The remediation's reason code, class, due
   * window and priority band used to be stated HERE, by the caller, which made the mandatory Riya
   * delegation ceremonial: her advisory was required, then discarded, and the proposal was built
   * from whatever the caller had asked for. Those four values are now DERIVED from her bounded
   * conclusion through a total reviewed mapping, and there is no request field left to state them.
   */
  clientSalesSignals: z
    .strictObject({
      hasPriorSalesContext: z.boolean(),
      requestedHumanAssistance: z.boolean(),
      requestedQuoteOrConsultation: z.boolean(),
      providedRequirementDetail: z.boolean(),
      askedAboutReadiness: z.boolean(),
      outOfSalesScope: z.boolean(),
      missingDiscoveryFieldCount: z.number().int().min(0).max(32),
    })
    .optional(),
  /** Mission B input. Closed bands and one integer -- and NO target: the optimiser computes it. */
  capacityObservation: jao7CapacityObservationSchema.optional(),
  /** Mission B evidence: an injected synthetic bundle, read through the canonical JAO-4 workbench. */
  artifactBundle: z.unknown().optional(),
  artifactCalls: z.array(z.unknown()).max(2).optional(),

  /**
   * The canonical artifacts this run produced, carried back by the caller.
   *
   * JAO-7 does NOT persist a `RecommendationV1`: a stored copy is a second copy, free to drift from
   * the one a human actually saw. What it persists is the proposal BINDING -- recommendation id,
   * action id and fingerprint -- and a caller returning with a different proposal is refused by that
   * row rather than trusted because it happened to be holding an artifact.
   *
   * That also mirrors where the artifact really lives: after submission Core holds the
   * recommendation, and Jarvis holds the identity it can check against.
   */
  proposal: z.unknown().optional(),

  /** Externally issued Core artifacts. Validated by the canonical runtimes, never constructed here. */
  authority: z
    .strictObject({
      approvalDecision: z.unknown().optional(),
      executionIntent: z.unknown().optional(),
    })
    .optional(),

  /** A cooperative pause, honoured between steps and never while the sandbox is applied-unverified. */
  pauseRequested: z.boolean().optional(),
});

/**
 * Asking for the virtual sandbox to be cleaned up. Safety cleanup, and nothing else.
 *
 * It names a run and an operation id, and that is the entire vocabulary. There is no rollback
 * target, no value, no state and no force flag -- a rollback that could be aimed somewhere new
 * would be a second apply wearing a safer word.
 */
export const jao7SafetyRollbackRequestSchema = z.strictObject({
  runId: jao7IdSchema,
  operationId: jao7IdSchema,
});

export type Jao7SafetyRollbackRequest = z.infer<typeof jao7SafetyRollbackRequestSchema>;

type ParsedRequest = z.infer<typeof jao7AutonomyRequestSchema>;

/**
 * The per-step request.
 *
 * `authority` stays `unknown` all the way to the canonical schemas. A cast here would be this slice
 * deciding an artifact is a `ApprovalDecisionV1` because a caller said so, which is the one judgement
 * it must never make about a Core artifact.
 */
export type Jao7AdvanceRequest = Omit<ParsedRequest, 'evidence'> & {
  readonly evidence: readonly EvidenceItem[];
};

/**
 * The proposal a result carries back.
 *
 * `RecommendationV1` and `ApprovalRequestV1` are the canonical contracts, declared by reference so
 * this slice owns no second definition of either. The runtime result's own `source` is deliberately
 * absent: it is exactly `{ recommendation, actionBindings }`, and a second copy of two fields that
 * are already here is two more fields that can disagree with each other. It is reconstructed from
 * these when the carried proposal is re-validated.
 */
export interface Jao7ResultProposal {
  readonly recommendation: RecommendationV1;
  readonly actionBindings: readonly [RecommendationActionBinding];
  readonly approvalRequest: ApprovalRequestV1;
}

/** The runtime half. Canonical schemas, and exactly one action bound to exactly one recommendation. */
export const jao7ResultProposalSchema = z
  .strictObject({
    recommendation: recommendationV1Schema,
    actionBindings: z
      .array(
        z.strictObject({
          recommendationId: z.string().min(1).max(128),
          proposedActionId: z.string().min(1).max(128),
          actionFingerprint: jao7DigestSchema,
        }),
      )
      .length(1),
    approvalRequest: approvalRequestV1Schema,
  })
  .refine((value) => {
    // EXACTLY ONE action, and all three artifacts describing it. A carried proposal whose parts
    // disagree with one another is not a proposal, whatever each part is individually.
    const [binding] = value.actionBindings;
    const action = value.recommendation.proposedActions[0];
    if (binding === undefined || action === undefined) {
      return false;
    }
    return (
      value.recommendation.proposedActions.length === 1 &&
      binding.recommendationId === value.recommendation.recommendationId &&
      binding.proposedActionId === action.actionId &&
      value.approvalRequest.recommendationId === value.recommendation.recommendationId &&
      value.approvalRequest.proposedActionId === binding.proposedActionId &&
      value.approvalRequest.actionFingerprint === binding.actionFingerprint
    );
  }, 'the proposal artifacts do not describe one another');

/** Content-free telemetry. Ids, codes, digests and counters; never content. */
export interface Jao7TelemetryEvent {
  readonly runId: string;
  readonly missionPolicyId: string;
  readonly missionPolicyDigest: string;
  readonly planDigest: string;
  readonly state: Jao7RunState;
  readonly stepType: Jao7StepType | null;
  readonly verdict: Jao7EvaluationVerdict | null;
  readonly stepsCompleted: number;
  readonly specialistCalls: number;
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly rehearsalApplies: number;
  readonly businessEffect: false;
  readonly productionMutation: false;
}

export interface Jao7TelemetryHook {
  record(event: Jao7TelemetryEvent): void;
}

/**
 * What every entry point returns.
 *
 * The outcome vocabulary contains no `EXECUTED`, no `SENT`, no `DEPLOYED` and no `AUTHORIZED`, and
 * the posture states what did not happen as literals rather than as prose. `authoritySourcePosture`
 * is the honest label on the whole authority chain: in this offline proof the Core artifacts are
 * injected, and correlation proves they describe this action -- not that Core authenticated them.
 */
export interface Jao7AutonomyResult {
  readonly runId: string;
  readonly missionPolicyId: string;
  readonly missionPolicyVersion: number;
  readonly missionPolicyDigest: string;
  readonly planDigest: string;
  readonly state: Jao7RunState;
  readonly outcome: (typeof JAO7_OUTCOMES)[number];
  readonly refusalReason: (typeof JAO7_REFUSAL_REASONS)[number] | null;
  readonly currentStepIndex: number;
  readonly revision: number;
  readonly stepsCompleted: number;
  readonly specialistCalls: number;
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly rehearsalApplies: number;
  readonly steps: readonly Jao7StepRecord[];
  readonly evaluations: readonly Jao7EvaluationRecord[];
  readonly authorityObservation: Jao7AuthorityObservationRecord | null;
  readonly rehearsal: Jao7RehearsalRecord | null;
  /**
   * The canonical artifacts, IN MEMORY, on the step that produced them.
   *
   * Never persisted, and null on every other step. A caller that wants to move past the authority
   * gate carries these back, and the durable binding decides whether they are this run's.
   */
  readonly proposal: Jao7ResultProposal | null;
  readonly authoritySourcePosture: 'INJECTED_OFFLINE_CORE_FIXTURE';
  readonly posture: Jao7Posture;
}

/** The runtime half of the same guarantee, so a cast cannot manufacture a contradictory result. */
export const jao7AutonomyResultSchema = z
  .strictObject({
    runId: jao7IdSchema,
    missionPolicyId: jao7IdSchema,
    missionPolicyVersion: z.number().int().min(1).max(1_000),
    missionPolicyDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    planDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    state: z.enum(JAO7_RUN_STATES),
    outcome: z.enum(JAO7_OUTCOMES),
    refusalReason: z.enum(JAO7_REFUSAL_REASONS).nullable(),
    currentStepIndex: z.number().int().min(0).max(64),
    revision: z.number().int().min(1),
    stepsCompleted: z.number().int().min(0).max(64),
    specialistCalls: z.number().int().min(0).max(4),
    toolCalls: z.number().int().min(0).max(8),
    modelCalls: z.literal(0),
    rehearsalApplies: z.number().int().min(0).max(1),
    // DECLARED, not `unknown`. These five used to be `z.unknown()`, so the schema that exists to
    // prove a result is well-formed proved nothing about the five fields carrying every durable fact
    // the result reports -- and `buildResult` never ran the parse anyway.
    steps: z.array(jao7StepRecordSchema).max(64),
    evaluations: z.array(jao7EvaluationRecordSchema).max(512),
    authorityObservation: jao7AuthorityObservationRecordSchema.nullable(),
    rehearsal: jao7RehearsalRecordSchema.nullable(),
    proposal: jao7ResultProposalSchema.nullable(),
    authoritySourcePosture: z.literal('INJECTED_OFFLINE_CORE_FIXTURE'),
    posture: jao7PostureSchema,
  })
  .superRefine((value, context) => {
    // THE OUTCOME MUST BE THE ONE THE STATE IMPLIES.
    //
    // `outcome` is derived rather than supplied, but derivation is a property of one function and
    // this is the property the reader is actually relying on: that a result cannot report
    // `COMPLETED_REHEARSAL` beside a `FAILED_SAFE` state, or a refusal beside no reason.
    if ((value.outcome === 'REFUSED') !== (value.refusalReason !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'a refused outcome and a refusal reason must accompany one another',
      });
      return;
    }
    if (value.outcome === 'REFUSED') {
      return;
    }
    const implied = JAO7_STATE_OUTCOMES[value.state];
    const permitted =
      value.state === 'COMPLETED' ? ['COMPLETED_REHEARSAL', 'ROLLED_BACK_REHEARSAL'] : [implied];
    if (!permitted.includes(value.outcome)) {
      context.addIssue({ code: 'custom', message: 'the outcome contradicts the run state' });
    }
  });
