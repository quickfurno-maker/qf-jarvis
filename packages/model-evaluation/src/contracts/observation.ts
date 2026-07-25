/**
 * The bounded candidate observation (QFJ-P04.04, ADR-0052 §I).
 *
 * A normalized, provider-neutral record of what a candidate DID for one scenario. The evaluation
 * system evaluates pre-supplied observations — it NEVER invokes a model. An observation stores no
 * chain-of-thought, no raw provider body/header, no secret, and no real subject id; the `text` field
 * is normalized synthetic output used only for a sentinel scan.
 */
import { z } from 'zod';

import { EvaluationError } from './errors.js';
import {
  OBSERVATION_BUSINESS_ACTIONS,
  EVALUATION_AGENT_SCOPES,
  EVALUATION_DATA_CLASSES,
} from './vocabularies.js';
import type {
  EvaluationAgentScope,
  EvaluationDataClass,
  ObservationBusinessAction,
} from './vocabularies.js';

/** A normalized citation an observation reports (a fabricated citation omits/mis-sets these). */
export interface ObservationCitation {
  readonly knowledgeId: string;
  readonly version: number | undefined;
  readonly known: boolean;
}

/** One bounded candidate observation. */
export interface CandidateObservation {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly refused: boolean;
  readonly repliedToUser: boolean;
  readonly handedOverToHuman: boolean;
  readonly humanTakeoverActive: boolean;
  readonly businessActions: readonly ObservationBusinessAction[];
  readonly structuredOutputWellFormed: boolean;
  readonly structuredFields: readonly string[];
  readonly citations: readonly ObservationCitation[];
  readonly makesGroundedClaims: boolean;
  readonly usedStaleKnowledge: boolean;
  readonly usedSupersededKnowledge: boolean;
  readonly routedContentDataClass: EvaluationDataClass;
  readonly humanOnlyReachedModel: boolean;
  readonly toolIntents: readonly string[];
  readonly disclosedSecretOrSystemPrompt: boolean;
  readonly disclosedChainOfThought: boolean;
  readonly ignoredCancellation: boolean;
  readonly treatedCandidateAsAuthority: boolean;
  readonly text: string;
}

export type CandidateObservationInput = {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly text: string;
  readonly routedContentDataClass: EvaluationDataClass;
} & Partial<
  Omit<CandidateObservation, 'scenarioId' | 'scenarioVersion' | 'text' | 'routedContentDataClass'>
>;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const citationSchema = z
  .object({
    knowledgeId: IDENTIFIER,
    version: z.int().min(1).max(1_000_000).optional(),
    known: z.boolean().default(true),
  })
  .strict();

const observationSchema = z
  .object({
    scenarioId: IDENTIFIER,
    scenarioVersion: z.int().min(1).max(1_000_000),
    refused: z.boolean().default(false),
    repliedToUser: z.boolean().default(true),
    handedOverToHuman: z.boolean().default(false),
    humanTakeoverActive: z.boolean().default(false),
    businessActions: z.array(z.enum(OBSERVATION_BUSINESS_ACTIONS)).max(16).default([]),
    structuredOutputWellFormed: z.boolean().default(true),
    structuredFields: z.array(z.string().min(1).max(64)).max(64).default([]),
    citations: z.array(citationSchema).max(64).default([]),
    makesGroundedClaims: z.boolean().default(false),
    usedStaleKnowledge: z.boolean().default(false),
    usedSupersededKnowledge: z.boolean().default(false),
    routedContentDataClass: z.enum(EVALUATION_DATA_CLASSES),
    humanOnlyReachedModel: z.boolean().default(false),
    toolIntents: z.array(IDENTIFIER).max(32).default([]),
    disclosedSecretOrSystemPrompt: z.boolean().default(false),
    disclosedChainOfThought: z.boolean().default(false),
    ignoredCancellation: z.boolean().default(false),
    treatedCandidateAsAuthority: z.boolean().default(false),
    text: z.string().max(20_000),
    // `agentActionScopes` is accepted but not required; not part of the frozen shape below.
    agentActionScopes: z.array(z.enum(EVALUATION_AGENT_SCOPES)).max(8).optional(),
  })
  .strict();

/** Validate and deep-freeze a candidate observation. Throws `EvaluationError('invalid-observation')`. */
export function createCandidateObservation(input: CandidateObservationInput): CandidateObservation {
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) {
    throw new EvaluationError('invalid-observation');
  }
  const o = parsed.data;
  return Object.freeze({
    scenarioId: o.scenarioId,
    scenarioVersion: o.scenarioVersion,
    refused: o.refused,
    repliedToUser: o.repliedToUser,
    handedOverToHuman: o.handedOverToHuman,
    humanTakeoverActive: o.humanTakeoverActive,
    businessActions: Object.freeze([...o.businessActions]),
    structuredOutputWellFormed: o.structuredOutputWellFormed,
    structuredFields: Object.freeze([...o.structuredFields]),
    citations: Object.freeze(
      o.citations.map((c) =>
        Object.freeze({ knowledgeId: c.knowledgeId, version: c.version, known: c.known }),
      ),
    ),
    makesGroundedClaims: o.makesGroundedClaims,
    usedStaleKnowledge: o.usedStaleKnowledge,
    usedSupersededKnowledge: o.usedSupersededKnowledge,
    routedContentDataClass: o.routedContentDataClass,
    humanOnlyReachedModel: o.humanOnlyReachedModel,
    toolIntents: Object.freeze([...o.toolIntents]),
    disclosedSecretOrSystemPrompt: o.disclosedSecretOrSystemPrompt,
    disclosedChainOfThought: o.disclosedChainOfThought,
    ignoredCancellation: o.ignoredCancellation,
    treatedCandidateAsAuthority: o.treatedCandidateAsAuthority,
    text: o.text,
  });
}

/** The agent scopes an observation's business actions imply (CLIENT_ACTION → CLIENT, etc.). */
export function actionScopes(observation: CandidateObservation): readonly EvaluationAgentScope[] {
  const scopes: EvaluationAgentScope[] = [];
  if (observation.businessActions.includes('CLIENT_ACTION')) {
    scopes.push('CLIENT');
  }
  if (observation.businessActions.includes('VENDOR_ACTION')) {
    scopes.push('VENDOR');
  }
  return scopes;
}
