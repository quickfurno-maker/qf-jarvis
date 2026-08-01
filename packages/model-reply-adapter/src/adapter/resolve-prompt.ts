/**
 * Authoritative prompt resolution (QFJ-S3-I-B, ADR-0073).
 *
 * The one place the executed system prompt is chosen. Before this existed, the M4 adapter carried a
 * hard-coded `REPLY_PROMPT_CONTRACT` while reporting `promptId`/`promptVersion` from deployer config,
 * so a request could truthfully name a version whose text it was not sending. Resolution now produces
 * the definition, and the request takes BOTH its identity and its content from that single object.
 *
 * Everything here fails closed. There is no default registry, no built-in prompt, no nearest-version
 * or `latest` fallback, and no cross-scope or cross-task substitution: a miss is a refusal, because
 * quietly sending a different prompt is the failure this module exists to prevent.
 */
import { MODEL_AGENT_SCOPES, type ModelAgentScope } from '@qf-jarvis/model-gateway';
import { PROMPT_AGENT_SCOPES_FROZEN, PromptRegistryError } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition, PromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';

import type { ModelReplyAdapterReason } from '../contracts/reasons.js';

/** Either the one resolved definition, or the reason no model may be reached. */
export type PromptResolution =
  | { readonly prompt: PromptDefinition; readonly reason?: undefined }
  | { readonly prompt?: undefined; readonly reason: ModelReplyAdapterReason };

const DIGEST = /^[0-9a-f]{64}$/;

/** Map an assigned actor to the prompt/gateway agent scope. HUMAN never reaches M4. */
function scopeFor(actor: ReplyPlan['assignedActor']): ModelAgentScope | undefined {
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
      return undefined;
  }
}

/**
 * The scope vocabularies must be the same set.
 *
 * S3-I-A duplicated the four scope strings deliberately, so `prompt-registry` could stay a leaf that
 * imports nothing. This is the boundary where both are visible, so this is where the duplication is
 * held honest: if the two ever drift, a prompt could be selected under a scope the gateway does not
 * recognise, and the mismatch would surface as confusing provider behaviour rather than a refusal.
 */
function scopeVocabulariesAgree(): boolean {
  const gateway = new Set<string>(MODEL_AGENT_SCOPES);
  const registry = new Set<string>(PROMPT_AGENT_SCOPES_FROZEN);
  if (gateway.size !== registry.size) {
    return false;
  }
  for (const scope of gateway) {
    if (!registry.has(scope)) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the exact prompt for one model-backed turn.
 *
 * Order matters: registry availability, then the scope invariant, then exact resolution, then the
 * evaluation pairing. Each step refuses rather than substituting.
 */
export function resolveAuthoritativePrompt(args: {
  readonly plan: ReplyPlan;
  readonly registry: PromptRegistry | undefined;
  readonly evaluationRef: string | undefined;
  readonly evaluationPromptDigest: string | undefined;
}): PromptResolution {
  const { plan, registry, evaluationRef, evaluationPromptDigest } = args;

  // A missing registry is a wiring gap, not a reason to invent text.
  if (registry === undefined) {
    return { reason: 'model-adapter-unavailable' };
  }
  if (!scopeVocabulariesAgree()) {
    return { reason: 'model-invariant' };
  }

  const agentScope = scopeFor(plan.assignedActor);
  if (agentScope === undefined) {
    return { reason: 'model-plan-invalid' };
  }

  let resolved: PromptDefinition | undefined;
  try {
    resolved = registry.resolve({
      promptId: plan.promptFamily,
      promptVersion: plan.promptVersion,
      agentScope,
      taskClass: plan.taskClass,
      resultMode: 'STRUCTURED',
    });
  } catch (error) {
    // A malformed request is the registry's own bounded error; nothing else is swallowed.
    if (error instanceof PromptRegistryError) {
      return { reason: 'model-plan-invalid' };
    }
    throw error;
  }
  // A well-formed miss. No nearest version, no `latest`, no other scope or task.
  if (resolved === undefined) {
    return { reason: 'model-plan-invalid' };
  }

  // The evaluation pair. An evaluation reference that does not say WHICH bytes it covers is exactly
  // the gap ADR-0073 closes, so a half-supplied pair is refused rather than half-trusted.
  const hasRef = evaluationRef !== undefined;
  const hasDigest = evaluationPromptDigest !== undefined;
  if (hasRef !== hasDigest) {
    return { reason: 'model-plan-invalid' };
  }
  if (hasDigest) {
    if (!DIGEST.test(evaluationPromptDigest)) {
      return { reason: 'model-plan-invalid' };
    }
    if (evaluationPromptDigest !== resolved.contentDigest) {
      // The evaluated bytes are not the bytes about to run.
      return { reason: 'model-plan-invalid' };
    }
  }

  return { prompt: resolved };
}
