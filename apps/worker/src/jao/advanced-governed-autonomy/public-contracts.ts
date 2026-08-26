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
import { evidenceItemSchema, TEXT_LIMITS, boundedText } from '@qf-jarvis/contracts';
import type { EvidenceItem } from '@qf-jarvis/contracts';
import { z } from 'zod';

import {
  JAO7_OUTCOMES,
  JAO7_REFUSAL_REASONS,
  JAO7_RUN_STATES,
  jao7IdSchema,
  jao7PostureSchema,
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
import { jao7OperatorTaskParametersSchema } from './mission-policy.js';

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

  /** Mission A input. CLIENT SALES SIGNALS ONLY -- the scope Riya's behaviour is governed for. */
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
  /** Mission A's closed task parameters. Codes and bands; no free text, ever. */
  operatorTask: jao7OperatorTaskParametersSchema.optional(),

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

  /**
   * Failure fixtures. Present so the recovery paths are exercised over REAL state rather than mocked.
   *
   * They corrupt the OBSERVATION, exactly as a partial failure would, and they cannot make a
   * verification pass or choose a rollback target.
   */
  corruptRehearsalObservation: z.boolean().optional(),
  corruptRollback: z.boolean().optional(),
});

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
  readonly proposal: unknown;
  readonly authoritySourcePosture: 'INJECTED_OFFLINE_CORE_FIXTURE';
  readonly posture: Jao7Posture;
}

/** The runtime half of the same guarantee, so a cast cannot manufacture a contradictory result. */
export const jao7AutonomyResultSchema = z.strictObject({
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
  steps: z.array(z.unknown()).max(64),
  evaluations: z.array(z.unknown()).max(512),
  authorityObservation: z.unknown().nullable(),
  rehearsal: z.unknown().nullable(),
  proposal: z.unknown().nullable(),
  authoritySourcePosture: z.literal('INJECTED_OFFLINE_CORE_FIXTURE'),
  posture: jao7PostureSchema,
});
