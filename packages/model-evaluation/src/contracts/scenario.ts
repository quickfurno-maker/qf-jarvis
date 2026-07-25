/**
 * The immutable evaluation scenario (QFJ-P04.04, ADR-0052 §H).
 *
 * A scenario is a deterministic synthetic test case bound to a category, severity, agent scope, data
 * class, and task class, plus a closed {@link ExpectedBehavior} describing what a SAFE candidate must
 * do. It carries no real phone/email/address/conversation/secret/PII and no arbitrary metadata bag.
 * Raw prompt/knowledge fixture content is not stored here — only the expectation the evaluator checks.
 */
import { z } from 'zod';

import { EvaluationError } from './errors.js';
import {
  EVALUATION_AGENT_SCOPES,
  EVALUATION_CATEGORIES,
  EVALUATION_DATA_CLASSES,
  EVALUATION_SEVERITIES,
  EVALUATION_TASK_CLASSES,
  RED_TEAM_CASE_KINDS,
} from './vocabularies.js';
import type {
  EvaluationAgentScope,
  EvaluationCategory,
  EvaluationDataClass,
  EvaluationSeverity,
  EvaluationTaskClass,
  RedTeamCaseKind,
} from './vocabularies.js';

/** What a safe candidate must satisfy for a scenario. All fields are closed and optional. */
export interface ExpectedBehavior {
  readonly requiresRefusal: boolean;
  readonly requiresHumanHandover: boolean;
  readonly requiresValidStructuredOutput: boolean;
  readonly requiredStructuredFields: readonly string[];
  readonly forbiddenStructuredFields: readonly string[];
  readonly requiresCitations: boolean;
  readonly forbidsStaleKnowledge: boolean;
  readonly forbidsBusinessAction: boolean;
  readonly dataClassCeiling: EvaluationDataClass;
  readonly forbiddenSentinels: readonly string[];
  readonly allowedToolIntents: readonly string[];
}

/** One immutable evaluation scenario. */
export interface EvaluationScenario {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly category: EvaluationCategory;
  readonly severity: EvaluationSeverity;
  readonly agentScope: EvaluationAgentScope;
  readonly dataClass: EvaluationDataClass;
  readonly taskClass: EvaluationTaskClass;
  readonly redTeamKind: RedTeamCaseKind | undefined;
  readonly expected: ExpectedBehavior;
}

export interface EvaluationScenarioInput {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly category: EvaluationCategory;
  readonly severity: EvaluationSeverity;
  readonly agentScope: EvaluationAgentScope;
  readonly dataClass: EvaluationDataClass;
  readonly taskClass: EvaluationTaskClass;
  readonly expected: Partial<ExpectedBehavior>;
  readonly redTeamKind?: RedTeamCaseKind | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const FIELD = z.string().min(1).max(64);
const SENTINEL = z.string().min(1).max(128);

const expectedSchema = z
  .object({
    requiresRefusal: z.boolean().default(false),
    requiresHumanHandover: z.boolean().default(false),
    requiresValidStructuredOutput: z.boolean().default(false),
    requiredStructuredFields: z.array(FIELD).max(32).default([]),
    forbiddenStructuredFields: z.array(FIELD).max(32).default([]),
    requiresCitations: z.boolean().default(false),
    forbidsStaleKnowledge: z.boolean().default(false),
    forbidsBusinessAction: z.boolean().default(true),
    dataClassCeiling: z.enum(EVALUATION_DATA_CLASSES).default('HOSTED_ALLOWED'),
    forbiddenSentinels: z.array(SENTINEL).max(32).default([]),
    allowedToolIntents: z.array(IDENTIFIER).max(32).default([]),
  })
  .strict();

const scenarioSchema = z
  .object({
    scenarioId: IDENTIFIER,
    scenarioVersion: z.int().min(1).max(1_000_000),
    category: z.enum(EVALUATION_CATEGORIES),
    severity: z.enum(EVALUATION_SEVERITIES),
    agentScope: z.enum(EVALUATION_AGENT_SCOPES),
    dataClass: z.enum(EVALUATION_DATA_CLASSES),
    taskClass: z.enum(EVALUATION_TASK_CLASSES),
    expected: expectedSchema,
    redTeamKind: z.enum(RED_TEAM_CASE_KINDS).optional(),
  })
  .strict();

/** Validate and deep-freeze a scenario. Throws `EvaluationError('invalid-scenario')`. */
export function createEvaluationScenario(input: EvaluationScenarioInput): EvaluationScenario {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new EvaluationError('invalid-scenario');
  }
  const s = parsed.data;
  if (s.scenarioId.toLowerCase() === 'latest' || s.scenarioId.includes('*')) {
    throw new EvaluationError('invalid-scenario');
  }
  return Object.freeze({
    scenarioId: s.scenarioId,
    scenarioVersion: s.scenarioVersion,
    category: s.category,
    severity: s.severity,
    agentScope: s.agentScope,
    dataClass: s.dataClass,
    taskClass: s.taskClass,
    redTeamKind: s.redTeamKind,
    expected: Object.freeze({
      requiresRefusal: s.expected.requiresRefusal,
      requiresHumanHandover: s.expected.requiresHumanHandover,
      requiresValidStructuredOutput: s.expected.requiresValidStructuredOutput,
      requiredStructuredFields: Object.freeze([...s.expected.requiredStructuredFields]),
      forbiddenStructuredFields: Object.freeze([...s.expected.forbiddenStructuredFields]),
      requiresCitations: s.expected.requiresCitations,
      forbidsStaleKnowledge: s.expected.forbidsStaleKnowledge,
      forbidsBusinessAction: s.expected.forbidsBusinessAction,
      dataClassCeiling: s.expected.dataClassCeiling,
      forbiddenSentinels: Object.freeze([...s.expected.forbiddenSentinels]),
      allowedToolIntents: Object.freeze([...s.expected.allowedToolIntents]),
    }),
  });
}

/** The exact tuple key `scenarioId@version` identifying a scenario. */
export function scenarioKey(scenarioId: string, scenarioVersion: number): string {
  return `${scenarioId}@${String(scenarioVersion)}`;
}
