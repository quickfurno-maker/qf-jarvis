/**
 * Deterministic fixtures for the AS3A specs. TEST-ONLY, and it never reaches `dist/`.
 *
 * ### The transports are SCRIPTED, and that is the whole point
 *
 * Every spec in this package runs against a fake transport that returns canned bytes. No spec holds a
 * credential, opens a socket or costs anything, and CI's provider call count is zero as a structural
 * fact rather than as a policy somebody remembered to follow.
 *
 * `openai` and `anthropic` appear here as configuration VALUES a plan supplies. The adapters learn
 * family from the inventory, never from a response.
 */
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import { createRiyaSyntheticInvocationRequest } from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticModelConfigInput,
  RiyaSyntheticRole,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import {
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_QUALITY_DIMENSIONS,
  RIYA_DATASET_RISK_CLASSES,
} from '@qf-jarvis/riya-intelligence-dataset';

import { RIYA_DATASET_QUALITY_DIMENSIONS as DIMENSIONS_FOR_POLICY } from '@qf-jarvis/riya-intelligence-dataset';
import {
  releasePolicyFor,
  syntheticProtectedIndex,
} from '@qf-jarvis/riya-intelligence-dataset/testing';

import type {
  AnthropicMessagesRequestBody,
  AnthropicMessagesTransport,
} from '../adapters/anthropic-messages-invoker.js';
import type {
  OpenAiResponsesRequestBody,
  OpenAiResponsesTransport,
} from '../adapters/openai-responses-invoker.js';
import { RiyaSyntheticProviderTransportError } from '../contracts/provider-errors.js';
import type { RiyaSyntheticProviderFailureKind } from '../contracts/provider-errors.js';
import { riyaSyntheticInstructionFor } from '../prompts/instruction-inventory.js';
import { sha256Hex } from '../internal/digest.js';

export const OPENAI_FAMILY = 'openai';
export const ANTHROPIC_FAMILY = 'anthropic';

/**
 * Every vocabulary member is READ from its canonical list rather than typed as a literal.
 *
 * A hand-copied enum member is a second definition that drifts, and the day it does the fixture
 * fails for a reason that looks like a bug in the code under test.
 */
function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`empty vocabulary: ${label}`);
  return value;
}

const PHASE = first(RIYA_CONVERSATION_PHASES, 'phases');
const LANGUAGE_MODE = first(RIYA_DATASET_LANGUAGE_MODES, 'language modes');
const INTERACTION_KIND = first(RIYA_DATASET_INTERACTION_KINDS, 'interaction kinds');
const PERSONA = first(RIYA_DATASET_PERSONAS, 'personas');
const DIFFICULTY = first(RIYA_DATASET_DIFFICULTIES, 'difficulties');
const RISK_CLASS = first(RIYA_DATASET_RISK_CLASSES, 'risk classes');
const DISCOVERY_FIELD = first(RIYA_DATASET_DISCOVERY_FIELDS, 'discovery fields');
const FACT_CLASS = first(RIYA_DATASET_FACT_CLASSES, 'fact classes');

/**
 * A config bound to THIS package's instruction identity for the role it serves.
 *
 * `extraRoles` exists for one structural reason. AS2's allocation names a `scenarioPlannerConfigRef`
 * and resolution insists that config serves `SCENARIO_PLANNER` — even though the scheduler is
 * deterministic and no model ever plans a scenario, so this package holds no planner instruction and
 * no planner schema. A simulator config that also DECLARES the planner role satisfies the structural
 * requirement without inventing a prompt for a call that never happens.
 */
export function configFor(
  configRef: string,
  providerFamilyRef: string,
  modelFamilyRef: string,
  modelRef: string,
  role: RiyaSyntheticRole,
  extraRoles: readonly RiyaSyntheticRole[] = [],
): RiyaSyntheticModelConfigInput {
  const instruction = riyaSyntheticInstructionFor(role);
  return {
    configRef,
    providerFamilyRef,
    modelFamilyRef,
    modelRef,
    adapterRef: `adapter.${modelFamilyRef}`,
    allowedRoles: [role, ...extraRoles],
    instructionRef: instruction.identity.instructionRef,
    instructionSha256: instruction.identity.instructionSha256,
    outputSchemaVersion: 1,
    maxOutputTokens: 2_048,
    samplingPolicyRef: 'sampling.default.v1',
    retryPolicyRef: 'retry.default.v1',
    activeForGeneration: true,
  };
}

/** The eleven configs a two-family cross-critique plan needs. */
export function inventoryInput(): {
  readonly inventoryRef: string;
  readonly configs: readonly RiyaSyntheticModelConfigInput[];
} {
  return {
    inventoryRef: 'inventory.as3a.test.v1',
    configs: [
      configFor('cfg.sim.gpt', OPENAI_FAMILY, 'gpt', 'gpt-5.6-sol', 'CUSTOMER_SIMULATOR', [
        'SCENARIO_PLANNER',
      ]),
      configFor(
        'cfg.sim.claude',
        ANTHROPIC_FAMILY,
        'claude',
        'claude-sonnet-5',
        'CUSTOMER_SIMULATOR',
        ['SCENARIO_PLANNER'],
      ),
      configFor('cfg.teacher.gpt', OPENAI_FAMILY, 'gpt', 'gpt-5.6-sol', 'RIYA_TEACHER'),
      configFor(
        'cfg.teacher.claude',
        ANTHROPIC_FAMILY,
        'claude',
        'claude-sonnet-5',
        'RIYA_TEACHER',
      ),
      configFor('cfg.verify.gpt', OPENAI_FAMILY, 'gpt', 'gpt-5.6-sol', 'ANNOTATION_VERIFIER'),
      configFor(
        'cfg.verify.claude',
        ANTHROPIC_FAMILY,
        'claude',
        'claude-sonnet-5',
        'ANNOTATION_VERIFIER',
      ),
      configFor('cfg.critic.gpt', OPENAI_FAMILY, 'gpt', 'gpt-5.6-sol', 'CRITIC'),
      configFor('cfg.critic.claude', ANTHROPIC_FAMILY, 'claude', 'claude-sonnet-5', 'CRITIC'),
    ],
  };
}

export function policyInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyRef: 'generation.policy.as3a.v1',
    policyVersion: 1,
    maxStructuralRepairAttempts: 1,
    maxTransientRetries: 0,
    perInvocationTimeoutMs: 5_000,
    candidateTimeoutMs: 60_000,
    maxConcurrentInvocations: 2,
    maxConcurrentCandidates: 1,
    requireCrossFamilyCritique: true,
    minCriticsPerCandidate: 2,
    ...overrides,
  };
}

export function budgetInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    budgetRef: 'budget.as3a.pilot.v1',
    maxCandidates: 2,
    maxProviderRequests: 200,
    maxInputTokens: 500_000,
    maxOutputTokens: 200_000,
    maxTotalTokens: 700_000,
    maxWallClockMs: 900_000,
    maxConcurrentCandidates: 1,
    maxConcurrentInvocations: 2,
    stopOnProviderAuthFailure: true,
    stopOnBudgetExhaustion: true,
    ...overrides,
  };
}

export function runPlanInput(scenarioCount = 2): Record<string, unknown> {
  return {
    planRef: 'plan.as3a.test.v1',
    seed: 5,
    scenarioCount,
    languageModes: [...RIYA_DATASET_LANGUAGE_MODES],
    interactionKinds: [INTERACTION_KIND],
    personas: [PERSONA],
    difficulties: [DIFFICULTY],
    riskClasses: [RISK_CLASS],
    startPhases: [PHASE],
    minAssistantTurns: 4,
    maxAssistantTurns: 5,
    validationEveryNth: 4,
  };
}

/** GPT teaches, Claude verifies and critiques alongside a GPT critic. */
export const GPT_TAUGHT_ALLOCATION = {
  generationRef: 'gen.as3a.gpt',
  scenarioPlannerConfigRef: 'cfg.sim.gpt',
  customerSimulatorConfigRef: 'cfg.sim.claude',
  riyaTeacherConfigRef: 'cfg.teacher.gpt',
  annotationVerifierConfigRef: 'cfg.verify.claude',
  criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.gpt'],
};

/** The mirror: Claude teaches, GPT verifies and critiques alongside a Claude critic. */
export const CLAUDE_TAUGHT_ALLOCATION = {
  generationRef: 'gen.as3a.claude',
  scenarioPlannerConfigRef: 'cfg.sim.claude',
  customerSimulatorConfigRef: 'cfg.sim.gpt',
  riyaTeacherConfigRef: 'cfg.teacher.claude',
  annotationVerifierConfigRef: 'cfg.verify.gpt',
  criticConfigRefs: ['cfg.critic.gpt', 'cfg.critic.claude'],
};

/**
 * AS1's acceptance policy, with every diversity bar wide open.
 *
 * A scripted transport writes deliberately repetitive conversations, so a realistic diversity policy
 * would reject every candidate for a property of the FIXTURE rather than of the code under test. The
 * bars are not the subject here; the path is. What acceptance actually looks like is an AS3B
 * question, answered with real model output.
 */
export function acceptancePolicyInput(): Record<string, unknown> {
  return {
    policyId: 'riya-as3a-pilot-acceptance',
    policyVersion: 1,
    baseReleasePolicy: releasePolicyFor(syntheticProtectedIndex(), {
      minimumTotalTrajectories: 1,
    }),
    criticPolicy: {
      minAcceptedCritics: 2,
      requiredQualityDimensions: [...DIMENSIONS_FOR_POLICY],
      requireCriticConfigDistinctFromGeneration: true,
      requireDistinctCriticConfigs: true,
      requireDistinctCriticModelFamilies: true,
    },
    diversityPolicy: {
      minFingerprintUniquenessBp: 0,
      maxOpenerRecurrenceBp: 10_000,
      maxCloserRecurrenceBp: 10_000,
      maxQuestionSequenceRecurrenceBp: 10_000,
      maxPhaseSequenceRecurrenceBp: 10_000,
      maxVariantsPerLineage: 16,
      maxSameLineageNearDuplicateBp: 10_000,
      minDepthBandsCovered: 1,
      minDecisionsCovered: 1,
      minObjectivesCovered: 1,
    },
    assistantTurnTolerance: 4,
  };
}

export interface PilotPlanMutations {
  /** Point every config at a provider family this package holds no adapter for. */
  readonly familyOverride?: string;
  /** Break the instruction digest binding, so preflight must refuse. */
  readonly instructionShaOverride?: boolean;
}

/** A complete pilot plan, as a plain object — exactly what a file deserialises into. */
export function pilotPlanInput(
  overrides: Record<string, unknown> = {},
  mutations: PilotPlanMutations = {},
): Record<string, unknown> {
  const inventory = inventoryInput();
  const configs = inventory.configs.map((config) => ({
    ...config,
    ...(mutations.familyOverride === undefined
      ? {}
      : { providerFamilyRef: mutations.familyOverride }),
    ...(mutations.instructionShaOverride === true
      ? { instructionSha256: sha256Hex('not-the-instruction-this-package-holds') }
      : {}),
  }));

  return {
    planRef: 'pilot.as3a.test.v1',
    runPlan: runPlanInput(),
    inventory: { inventoryRef: inventory.inventoryRef, configs },
    policy: policyInput(),
    budget: budgetInput(),
    acceptancePolicy: acceptancePolicyInput(),
    allocations: [GPT_TAUGHT_ALLOCATION],
    criticQualityDimensions: [...RIYA_DATASET_QUALITY_DIMENSIONS],
    ...overrides,
  };
}

/** A request envelope for one role, as AS2 would build it. */
export function requestFor(
  role: RiyaSyntheticRole,
  configRef: string,
  overrides: Partial<Record<string, unknown>> = {},
): RiyaSyntheticInvocationRequestV1 {
  return createRiyaSyntheticInvocationRequest({
    requestRef: `req.${role}.a1`,
    generationRef: 'gen.as3a.gpt',
    scenarioRef: 'scenario.as3a.one',
    role,
    configRef,
    inputDigest: sha256Hex('input'),
    outputSchemaRef: `${role}.v1`,
    attempt: 1,
    maxOutputTokens: 2_048,
    ...overrides,
  });
}

/** A customer-simulator input carrying every field that role legitimately holds. */
export function customerInput(): unknown {
  return {
    scenario: {
      languageMode: LANGUAGE_MODE,
      persona: PERSONA,
      difficulty: DIFFICULTY,
      plannedDiscoveryFields: [DISCOVERY_FIELD],
      plannedCustomerFacts: [{ field: DISCOVERY_FIELD, value: 'about two lakh' }],
      customerBehaviorCodes: ['DELAYED_DISCLOSURE'],
      requiredConversationEvents: ['OBJECTION_RAISED'],
      forbiddenBehaviors: ['INVENTED_PRICE'],
    },
    visibleHistory: [{ speaker: 'ASSISTANT', text: 'Namaste! How can I help?' }],
    turnIndex: 1,
    mayConclude: false,
  };
}

/** A teacher input: the projection, plus governed authority with values. */
export function teacherInput(): unknown {
  return {
    scenario: {
      languageMode: LANGUAGE_MODE,
      riskClass: RISK_CLASS,
      startPhase: PHASE,
      plannedDiscoveryFields: [DISCOVERY_FIELD],
      forbiddenBehaviors: ['INVENTED_PRICE'],
    },
    visibleHistory: [{ speaker: 'USER', text: 'Do you deliver to Pune?' }],
    turnIndex: 1,
    availableAuthorityFacts: [
      { factRef: 'fact.delivery.pune', factClass: FACT_CLASS, value: 'Pune delivery in 12 days' },
    ],
  };
}

/** Valid role output, as bytes a provider would return. */
export function validPayloadFor(role: RiyaSyntheticRole, salt: string): string {
  switch (role) {
    case 'CUSTOMER_SIMULATOR':
      return JSON.stringify({
        userText: `Customer says something specific ${salt}`,
        revealedFields: [],
        behaviorEvents: [],
        wantsHuman: false,
        endsConversation: false,
      });
    case 'RIYA_TEACHER':
      return JSON.stringify({
        assistantText: `Riya replies helpfully about ${salt}`,
        annotation: {
          decision: 'ASK_DISCOVERY',
          responseObjective: 'DISCOVER',
          askedDiscoveryFields: [],
          supportedFactRefs: [],
          expectedPhaseAfter: PHASE,
        },
      });
    case 'ANNOTATION_VERIFIER':
      return JSON.stringify({ decision: 'VERIFIED', failedChecks: [] });
    case 'CRITIC':
      return JSON.stringify({
        decision: 'ACCEPTED',
        satisfiedQualityDimensions: [...RIYA_DATASET_QUALITY_DIMENSIONS],
        failedQualityDimensions: [],
      });
    case 'SCENARIO_PLANNER':
      return '{}';
  }
}

/** Which role a request body is for, read back from the bound schema name. */
export function roleOfSchemaName(name: string): RiyaSyntheticRole {
  const role = name.replace(/_v\d+$/u, '') as RiyaSyntheticRole;
  return role;
}

export interface ScriptedTransportLog {
  readonly openaiBodies: OpenAiResponsesRequestBody[];
  readonly anthropicBodies: AnthropicMessagesRequestBody[];
}

export function createTransportLog(): ScriptedTransportLog {
  return { openaiBodies: [], anthropicBodies: [] };
}

/** An OpenAI transport that returns valid role output and records every body it was handed. */
export function scriptedOpenAiTransport(log: ScriptedTransportLog): OpenAiResponsesTransport {
  return {
    async create(body) {
      log.openaiBodies.push(body);
      const role = roleOfSchemaName(body.text.format.name);
      return Promise.resolve({
        outputText: validPayloadFor(role, `gpt-${String(log.openaiBodies.length)}`),
        refused: false,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
      });
    },
  };
}

export function scriptedAnthropicTransport(log: ScriptedTransportLog): AnthropicMessagesTransport {
  return {
    async create(body) {
      log.anthropicBodies.push(body);
      const role = roleOfSchemaName(body.output_config.format.name);
      return Promise.resolve({
        outputText: validPayloadFor(role, `claude-${String(log.anthropicBodies.length)}`),
        refused: false,
        inputTokens: 120,
        outputTokens: 60,
        cachedInputTokens: 10,
      });
    },
  };
}

/** A transport that always fails with one closed kind. */
export function failingOpenAiTransport(
  kind: RiyaSyntheticProviderFailureKind,
): OpenAiResponsesTransport {
  return {
    create() {
      return Promise.reject(new RiyaSyntheticProviderTransportError(kind));
    },
  };
}

export function failingAnthropicTransport(
  kind: RiyaSyntheticProviderFailureKind,
): AnthropicMessagesTransport {
  return {
    create() {
      return Promise.reject(new RiyaSyntheticProviderTransportError(kind));
    },
  };
}
