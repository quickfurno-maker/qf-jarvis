/**
 * Build the exact model-gateway request from a reply plan (QFJ-M4, ADR-0057 §D, §E, §F).
 *
 * Translates the M2 `ReplyPlan` plus an already-RESOLVED `PromptDefinition` into the gateway's own
 * validated `ModelRequest`: a STRUCTURED request carrying the exact system prompt, its content
 * digest, the minimized normalized input, the strict reply schema, and a closed scalar metadata bag
 * binding every exact reference (release/provider/model/version/config/
 * execution/prompt/capability/evaluation/policy/task, the citation-reference digest, and a canonical
 * requested-at instant). No wildcard/`latest`, no arbitrary metadata, no raw provider object. Throws
 * `ModelReplyAdapterError('invalid-request')` when the derived request is not gateway-valid.
 *
 * The builder does NOT resolve a prompt. Resolution happens once, upstream, after the first state
 * gate; this file only re-asserts that the definition it was handed is the one the plan asked for,
 * and then sources identity AND content from that single object. A builder that could pick a prompt
 * would be a second prompt source, which is the defect ADR-0073 closes.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';
import {
  validateModelRequest,
  type ModelRequest,
  type ModelAgentScope,
} from '@qf-jarvis/model-gateway';

import { ModelReplyAdapterError } from '../contracts/errors.js';
import { structuredReplySchema } from '../contracts/reply-schema.js';
import type { ModelReplyStructuredOutputProfile } from '../contracts/structured-output-profile.js';
import { contentDigest, isCanonicalInstant } from '../contracts/digest.js';

/** The bounded per-request budgets/timeout the adapter passes through to the gateway. */
export interface GatewayRequestBudgets {
  readonly tokenBudget: number;
  readonly costBudget: number;
  readonly timeoutMs: number;
  readonly retryBudget: number;
  readonly maxResultChars: number;
  readonly minContextTokens: number;
}

export const DEFAULT_GATEWAY_REQUEST_BUDGETS: GatewayRequestBudgets = Object.freeze({
  tokenBudget: 4096,
  costBudget: 1,
  timeoutMs: 30_000,
  retryBudget: 0,
  maxResultChars: 8192,
  minContextTokens: 1,
});

/** Map an assigned actor to the gateway agent scope. HUMAN never reaches the gateway. */
function agentScopeFor(actor: ReplyPlan['assignedActor']): ModelAgentScope {
  switch (actor) {
    case 'RIYA':
      return 'CLIENT';
    case 'ANISHA':
      return 'VENDOR';
    case 'JARVIS':
      return 'COORDINATION';
    case 'SYSTEM':
      return 'SYSTEM';
    default:
      throw new ModelReplyAdapterError('invalid-request');
  }
}

/** Build and validate the gateway request. Throws `ModelReplyAdapterError('invalid-request')`. */
export function buildGatewayRequest(args: {
  readonly plan: ReplyPlan;
  /** The already-resolved definition. Its content and identity are the only ones used. */
  readonly prompt: PromptDefinition;
  readonly requestedAt: string;
  readonly budgets: GatewayRequestBudgets;
  /**
   * The optional structured-output profile (ADR-0099).
   *
   * When absent, every byte of this request is what it always was. When present it may replace ONLY
   * the user-message content and the structured schema.
   */
  readonly profile?: ModelReplyStructuredOutputProfile;
}): ModelRequest {
  const { plan, prompt, requestedAt, budgets, profile } = args;
  if (!isCanonicalInstant(requestedAt)) {
    throw new ModelReplyAdapterError('invalid-request');
  }
  // Defensive: the caller resolved this, but a definition that does not match the plan would mean the
  // request reported one prompt while carrying another -- exactly the drift being closed.
  if (
    prompt.promptId !== plan.promptFamily ||
    prompt.promptVersion !== plan.promptVersion ||
    prompt.agentScope !== agentScopeFor(plan.assignedActor) ||
    prompt.taskClass !== plan.taskClass ||
    prompt.resultMode !== 'STRUCTURED' ||
    !/^[0-9a-f]{64}$/.test(prompt.contentDigest)
  ) {
    throw new ModelReplyAdapterError('invalid-request');
  }
  const r = plan.release;
  // Exact identity only — no wildcard and no `latest` sentinel may bind a request.
  const identityFields = [
    r.releaseId,
    r.providerId,
    r.modelId,
    r.modelVersion,
    r.configDigest,
    plan.capabilityProfileRef,
    plan.promptFamily,
  ];
  for (const value of identityFields) {
    if (value === '*' || value.toLowerCase() === 'latest') {
      throw new ModelReplyAdapterError('invalid-request');
    }
  }
  const promptVersion = String(prompt.promptVersion);
  const citationsDigest = contentDigest(
    plan.citations.map((c) => ({ knowledgeId: c.knowledgeId, version: c.version })),
  );

  const metadata: Record<string, string | number | boolean> = {
    conversationId: plan.conversationId,
    assignedActor: plan.assignedActor,
    partyType: plan.partyType,
    taskClass: plan.taskClass,
    releaseId: r.releaseId,
    providerId: r.providerId,
    modelId: r.modelId,
    modelVersion: r.modelVersion,
    configDigest: r.configDigest,
    executionClass: r.executionClass,
    capabilityProfileRef: plan.capabilityProfileRef,
    policyRevision: plan.policyRevision,
    promptFamily: prompt.promptId,
    promptVersion,
    promptDigest: prompt.contentDigest,
    citationsDigest,
    citationCount: plan.citations.length,
    requestedAt,
  };
  if (plan.evaluationRef !== undefined) {
    metadata['evaluationRef'] = plan.evaluationRef;
  }

  let userContent = '';
  if (profile !== undefined) {
    try {
      userContent = profile.buildUserContent(plan);
    } catch {
      throw new ModelReplyAdapterError('invalid-request');
    }
  }

  const candidate = {
    runId: plan.runId,
    purpose: 'agent.reply',
    agentScope: agentScopeFor(plan.assignedActor),
    dataClass: plan.dataClass,
    messages: [
      // The system message IS the resolved definition's bytes -- no prefix, no suffix, no appended
      // policy, no interpolation. The user message stays separate, as it always has.
      { role: 'system', content: prompt.systemTemplate },
      // A profile may supply the user content; with none, this is exactly what it always was. A
      // profile that throws while building becomes an invalid request rather than a half-built one.
      { role: 'user', content: profile === undefined ? (plan.normalizedText ?? '') : userContent },
    ],
    requiredCapabilities: {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: false,
      minContextTokens: budgets.minContextTokens,
    },
    resultMode: 'STRUCTURED',
    structuredSchema: profile === undefined ? structuredReplySchema : profile.structuredSchema,
    maxResultChars: budgets.maxResultChars,
    promptId: prompt.promptId,
    promptVersion,
    promptDigest: prompt.contentDigest,
    tokenBudget: budgets.tokenBudget,
    costBudget: budgets.costBudget,
    timeoutMs: budgets.timeoutMs,
    retryBudget: budgets.retryBudget,
    metadata,
  };

  const validated = validateModelRequest(candidate);
  if (!validated.ok) {
    throw new ModelReplyAdapterError('invalid-request');
  }
  return validated.request;
}
