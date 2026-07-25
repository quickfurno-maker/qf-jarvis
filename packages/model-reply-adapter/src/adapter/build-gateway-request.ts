/**
 * Build the exact model-gateway request from a reply plan (QFJ-M4, ADR-0057 §D, §E, §F).
 *
 * Translates the M2 `ReplyPlan` into the gateway's own validated `ModelRequest`: a STRUCTURED request
 * carrying the versioned prompt contract, the minimized normalized input, the strict reply schema, and
 * a closed scalar metadata bag binding every exact reference (release/provider/model/version/config/
 * execution/prompt/capability/evaluation/policy/task, the citation-reference digest, and a canonical
 * requested-at instant). No wildcard/`latest`, no arbitrary metadata, no raw provider object. Throws
 * `ModelReplyAdapterError('invalid-request')` when the derived request is not gateway-valid.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';
import {
  validateModelRequest,
  type ModelRequest,
  type ModelAgentScope,
} from '@qf-jarvis/model-gateway';

import { ModelReplyAdapterError } from '../contracts/errors.js';
import { structuredReplySchema } from '../contracts/reply-schema.js';
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

/**
 * The exact versioned prompt contract. It preserves the authority boundary (Riya client-only, Anisha
 * vendor-only, Jarvis coordinator, QuickFurno Core final authority), demands reply/proposal only with
 * exact citations, and forbids execution/n8n/business mutation and chain-of-thought. It carries no
 * provider-specific construction and no conversation content.
 */
const REPLY_PROMPT_CONTRACT =
  'You are a QuickFurno assistant drafting a PROPOSED reply only. Riya serves clients only; ' +
  'Anisha serves vendors only; Jarvis coordinates. QuickFurno Core is the final business authority ' +
  'and decides whether any reply is permitted. Return ONLY the required structured reply. Do not ' +
  'execute actions, call tools, trigger n8n, send messages, or mutate business state. Cite only the ' +
  'exact provided knowledge. Do not include chain-of-thought or private reasoning.';

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
  readonly requestedAt: string;
  readonly budgets: GatewayRequestBudgets;
}): ModelRequest {
  const { plan, requestedAt, budgets } = args;
  if (!isCanonicalInstant(requestedAt)) {
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
  const promptVersion = String(plan.promptVersion);
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
    promptFamily: plan.promptFamily,
    promptVersion,
    citationsDigest,
    citationCount: plan.citations.length,
    requestedAt,
  };
  if (plan.evaluationRef !== undefined) {
    metadata['evaluationRef'] = plan.evaluationRef;
  }

  const candidate = {
    runId: plan.runId,
    purpose: 'agent.reply',
    agentScope: agentScopeFor(plan.assignedActor),
    dataClass: plan.dataClass,
    messages: [
      { role: 'system', content: REPLY_PROMPT_CONTRACT },
      { role: 'user', content: plan.normalizedText ?? '' },
    ],
    requiredCapabilities: {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: false,
      minContextTokens: budgets.minContextTokens,
    },
    resultMode: 'STRUCTURED',
    structuredSchema: structuredReplySchema,
    maxResultChars: budgets.maxResultChars,
    promptId: plan.promptFamily,
    promptVersion,
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
