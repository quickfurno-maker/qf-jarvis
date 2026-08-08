/**
 * The model-gateway reply adapter (QFJ-M4, ADR-0057 §A, §C, §I, §J, §M).
 *
 * A concrete M2 `ModelReplyPort`: it validates that a plan belongs to this port's exact model identity,
 * applies the pre-gateway state gate, builds an exact gateway request, invokes the injected gateway
 * invoker AT MOST ONCE, strictly validates the result's provenance, structured shape, and citations,
 * applies the post-gateway state gate, and returns a bounded structured reply draft. The EXISTING
 * gateway remains the only routing authority — the adapter selects no provider, invents no fallback,
 * activates nothing, and mutates no rollout. A missing invoker fails closed; an exception/refusal is
 * normalized with no raw error. Model output is a draft/proposal input only — never a Core `ACCEPTED`,
 * never sent, delivered, or executed.
 */
import type {
  ModelReleaseRef,
  ModelReplyDraft,
  ModelReplyPort,
  ReplyPlan,
} from '@qf-jarvis/agent-runtime';

import type { ModelReplyAdapterResult, SafeReplyProvenance } from '../contracts/adapter-result.js';
import type { ModelReplyStructuredOutputProfile } from '../contracts/structured-output-profile.js';
import type { ModelReplyAdapterReason } from '../contracts/reasons.js';
import type { ReplyStateReader } from '../contracts/state.js';
import type { StructuredReply, StructuredReplyKind } from '../contracts/reply-schema.js';
import type {
  ModelReplyAdapterEvent,
  ModelReplyAdapterEventType,
  ModelReplyAdapterObservabilityHook,
} from '../contracts/observability.js';
import { NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY } from '../contracts/observability.js';
import type { ModelPromptIdentity } from '@qf-jarvis/agent-runtime';
import type { PromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';
import {
  buildGatewayRequest,
  DEFAULT_GATEWAY_REQUEST_BUDGETS,
  type GatewayRequestBudgets,
} from './build-gateway-request.js';
import { provenanceMatches } from './validate-provenance.js';
import {
  validateProfileStructuredResult,
  validateStructuredResult,
} from './validate-gateway-result.js';
import { citationsAuthorized } from './validate-citations.js';
import { resolveAuthoritativePrompt } from './resolve-prompt.js';
import { postGatewayBlockReason, stateBlockReason } from './state-gates.js';

/** A model reply adapter: an M2 `ModelReplyPort` plus a detailed drafting method. */
export interface ModelReplyAdapter extends ModelReplyPort {
  draftReplyDetailed(plan: ReplyPlan): Promise<ModelReplyAdapterResult>;
}

/** One agent scope's configured prompt identity and its evaluated content digest (ADR-0073). */
export interface ModelReplyPromptBinding {
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly evaluationRef?: string;
  readonly evaluationPromptDigest?: string;
}

/**
 * Per-scope prompt configuration (ADR-0073).
 *
 * A prompt definition is scope-bound, so one runtime serving both Riya and Anisha configures one
 * binding per scope. There is no HUMAN entry: a human turn never reaches a model.
 */
export interface ModelReplyPromptBindings {
  readonly CLIENT?: ModelReplyPromptBinding;
  readonly VENDOR?: ModelReplyPromptBinding;
  readonly COORDINATION?: ModelReplyPromptBinding;
  readonly SYSTEM?: ModelReplyPromptBinding;
}

export interface ModelReplyAdapterConfig {
  /** The exact model identity this port represents; a plan must bind the same identity. */
  readonly release: ModelReleaseRef;
  /**
   * The LEGACY single prompt identity. Valid only when `promptBindings` is absent, and then it can
   * serve only the one scope its definition is bound to. Mixing the two shapes is rejected.
   */
  readonly promptFamily?: string;
  readonly promptVersion?: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;
  /** Per-scope bindings. When present, every legacy prompt/evaluation field must be absent. */
  readonly promptBindings?: ModelReplyPromptBindings;
  /**
   * An OPTIONAL structured-output profile (ADR-0099).
   *
   * Absent by default, and absence is the untouched path: same schema, same user message, same
   * validation, same result keys. Present, it may replace only the structured schema and the user
   * content, and its validated detail is surfaced on a fully accepted result.
   */
  readonly structuredOutputProfile?: ModelReplyStructuredOutputProfile;
  /**
   * The injected immutable prompt registry (ADR-0073). Optional so a runtime that never drafts a
   * reply can still be constructed; a model-backed draft without it fails closed at
   * `model-adapter-unavailable` rather than falling back to any built-in text. There is no default
   * registry and no built-in prompt anywhere in this package.
   */
  readonly promptRegistry?: PromptRegistry;
  /**
   * The exact prompt-content digest the bound evaluation was produced against (ADR-0073). It pairs
   * with `evaluationRef`: both absent is fine, both present must agree with the resolved prompt, and
   * one without the other is a wiring error rather than a partial claim.
   */
  readonly evaluationPromptDigest?: string;
  readonly stateReader: ReplyStateReader;
  /** Injected canonical-instant clock (no wall-clock read inside the adapter). */
  readonly clock: () => string;
  /** The injected gateway invoker (a thin facade over the existing gateway). Missing → fail closed. */
  readonly invoker?: ModelGatewayInvoker;
  readonly budgets?: Partial<GatewayRequestBudgets>;
  readonly observability?: ModelReplyAdapterObservabilityHook;
}

function releaseEqual(a: ModelReleaseRef, b: ModelReleaseRef): boolean {
  return (
    a.releaseId === b.releaseId &&
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.modelVersion === b.modelVersion &&
    a.configDigest === b.configDigest &&
    a.executionClass === b.executionClass
  );
}

/** Map an assigned actor to its prompt scope. HUMAN never reaches a model, so it has no binding. */
function scopeKeyFor(
  actor: ReplyPlan['assignedActor'],
): keyof ModelReplyPromptBindings | undefined {
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
 * The one binding configured for an actor, or `undefined` to fail closed.
 *
 * In per-scope mode a missing scope is a refusal: there is deliberately no search for "a binding that
 * would work", because the only ones available belong to other agents.
 */
function bindingFor(
  config: ModelReplyAdapterConfig,
  actor: ReplyPlan['assignedActor'],
): ModelReplyPromptBinding | undefined {
  if (config.promptBindings !== undefined) {
    const key = scopeKeyFor(actor);
    return key === undefined ? undefined : config.promptBindings[key];
  }
  if (config.promptFamily === undefined || config.promptVersion === undefined) {
    return undefined;
  }
  return {
    promptFamily: config.promptFamily,
    promptVersion: config.promptVersion,
    ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
    ...(config.evaluationPromptDigest === undefined
      ? {}
      : { evaluationPromptDigest: config.evaluationPromptDigest }),
  };
}

/** True iff the config declares exactly one prompt shape. A mixed config is a wiring error. */
function promptConfigModeValid(config: ModelReplyAdapterConfig): boolean {
  const legacyPresent =
    config.promptFamily !== undefined ||
    config.promptVersion !== undefined ||
    config.evaluationRef !== undefined ||
    config.evaluationPromptDigest !== undefined;
  if (config.promptBindings !== undefined) {
    return !legacyPresent;
  }
  return config.promptFamily !== undefined && config.promptVersion !== undefined;
}

/** Build a model reply adapter from injected collaborators. */
export function createModelReplyAdapter(config: ModelReplyAdapterConfig): ModelReplyAdapter {
  const hook = config.observability ?? NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY;
  const budgets: GatewayRequestBudgets = { ...DEFAULT_GATEWAY_REQUEST_BUDGETS, ...config.budgets };

  async function draftReplyDetailed(plan: ReplyPlan): Promise<ModelReplyAdapterResult> {
    // Set once the prompt is resolved; observability before that point reports it as undefined. The
    // DIGEST is emitted, never the template -- an event carrying the prompt body would make the log
    // the one place system instructions leak.
    const resolved: { promptDigest?: string } = {};

    const emit = (
      type: ModelReplyAdapterEventType,
      reason: ModelReplyAdapterReason,
      resultKind: StructuredReplyKind | undefined,
      outputTokens: number | undefined,
      latencyMs: number | undefined,
    ): void => {
      hook.onEvent(
        Object.freeze({
          type,
          runId: plan.runId,
          conversationId: plan.conversationId,
          assignedActor: plan.assignedActor,
          partyType: plan.partyType,
          dataClass: plan.dataClass,
          taskClass: plan.taskClass,
          releaseId: plan.release.releaseId,
          providerId: plan.release.providerId,
          modelId: plan.release.modelId,
          promptId: plan.promptFamily,
          promptVersion: String(plan.promptVersion),
          promptDigest: resolved.promptDigest,
          capabilityProfileRef: plan.capabilityProfileRef,
          evaluationRef: plan.evaluationRef,
          resultKind,
          reason,
          outputTokens,
          latencyMs,
        } satisfies ModelReplyAdapterEvent),
      );
    };

    const result = (
      ok: boolean,
      kind: StructuredReplyKind | undefined,
      reason: ModelReplyAdapterReason,
      gatewayInvoked: boolean,
      draft: ModelReplyDraft | undefined,
      structuredReply: StructuredReply | undefined,
      provenance: SafeReplyProvenance | undefined,
      outputTokens: number | undefined,
      latencyMs: number | undefined,
      profileDetail?: unknown,
    ): ModelReplyAdapterResult =>
      Object.freeze({
        ok,
        kind,
        reason,
        draft,
        structuredReply,
        gatewayInvoked,
        provenance,
        outputTokens,
        latencyMs,
        // ABSENT, not `undefined`, when no profile produced anything: the default result shape is
        // unchanged, which existing exact-own-key assertions depend on.
        ...(profileDetail === undefined ? {} : { profileDetail }),
      });

    const refuse = (
      reason: ModelReplyAdapterReason,
      gatewayInvoked: boolean,
    ): ModelReplyAdapterResult => {
      emit('model-result-refused', reason, undefined, undefined, undefined);
      return result(
        false,
        undefined,
        reason,
        gatewayInvoked,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    };

    // Exactly one prompt configuration shape; a mixed config is a wiring error, not a preference.
    if (!promptConfigModeValid(config)) {
      return refuse('model-plan-invalid', false);
    }
    // The binding configured for THIS actor -- per-scope or legacy. Missing means fail closed.
    const binding = bindingFor(config, plan.assignedActor);
    if (binding === undefined) {
      return refuse('model-plan-invalid', false);
    }
    // Plan must bind THIS port's exact model identity (no wildcard/latest; exact release/prompt/etc.).
    if (
      !releaseEqual(plan.release, config.release) ||
      plan.promptFamily !== binding.promptFamily ||
      plan.promptVersion !== binding.promptVersion ||
      plan.capabilityProfileRef !== config.capabilityProfileRef ||
      plan.evaluationRef !== binding.evaluationRef
    ) {
      return refuse('model-plan-invalid', false);
    }
    // HUMAN_ONLY reaches no model; LOCAL_ONLY must not use a hosted release.
    if (plan.dataClass === 'HUMAN_ONLY') {
      return refuse('model-state-blocked', false);
    }
    if (plan.dataClass === 'LOCAL_ONLY' && plan.release.executionClass !== 'LOCAL') {
      return refuse('model-plan-invalid', false);
    }

    // Pre-gateway state gate — a blocking/mismatched state stops before any gateway call.
    const before = await config.stateReader.read();
    const block1 = stateBlockReason(before, plan);
    if (block1 !== null) {
      return refuse(block1, false);
    }
    emit(
      'model-adapter-plan-validated',
      'model-adapter-completed',
      undefined,
      undefined,
      undefined,
    );

    // Resolve the authoritative prompt -- ONCE, and only after the first state gate has passed, so a
    // blocked conversation costs no resolution and a missing registry can never mask a state block.
    const resolution = resolveAuthoritativePrompt({
      plan,
      registry: config.promptRegistry,
      evaluationRef: binding.evaluationRef,
      evaluationPromptDigest: binding.evaluationPromptDigest,
    });
    if (resolution.prompt === undefined) {
      return refuse(resolution.reason, false);
    }
    const prompt = resolution.prompt;
    resolved.promptDigest = prompt.contentDigest;

    // Build the exact gateway request from that one definition.
    let request;
    try {
      request = buildGatewayRequest({
        plan,
        prompt,
        requestedAt: config.clock(),
        budgets,
        ...(config.structuredOutputProfile === undefined
          ? {}
          : { profile: config.structuredOutputProfile }),
      });
    } catch {
      return refuse('model-plan-invalid', false);
    }

    // Missing invoker → fail closed.
    if (config.invoker === undefined) {
      return refuse('model-adapter-unavailable', false);
    }

    // Gateway at most once. An exception is normalized; no raw error escapes.
    emit('model-gateway-requested', 'model-adapter-completed', undefined, undefined, undefined);
    let invocation;
    try {
      invocation = await config.invoker.invoke(request);
    } catch {
      return refuse('model-gateway-transient', true);
    }
    if (!invocation.ok) {
      return refuse(
        invocation.transient ? 'model-gateway-transient' : 'model-gateway-refused',
        true,
      );
    }
    const response = invocation.response;
    const outputTokens = response.usage.outputTokens;
    emit(
      'model-gateway-result-received',
      'model-adapter-completed',
      undefined,
      outputTokens,
      response.latencyMs,
    );

    // Exact provenance.
    if (!provenanceMatches(response, plan, request)) {
      return refuse('model-provenance-mismatch', true);
    }
    // Strict structured output. With a profile the answer is projected to a reply and RE-PROVED
    // against the base schema; without one this is byte-for-byte the path it always was.
    const structured =
      config.structuredOutputProfile === undefined
        ? validateStructuredResult(response)
        : validateProfileStructuredResult(response, config.structuredOutputProfile);
    if (!structured.ok) {
      return refuse('model-structured-output-invalid', true);
    }
    const reply = structured.reply;
    // Held until the very end. Every gate below can still refuse, and detail beside a refusal would
    // be material extracted from an answer the adapter had already decided not to trust.
    const profileDetail = structured.detail;
    // Exact citation authorization (no silent drop).
    if (!citationsAuthorized(reply, plan)) {
      return refuse('model-citation-mismatch', true);
    }
    // Post-gateway state gate — a change during the round-trip prevents a draft.
    const after = await config.stateReader.read();
    const block2 = postGatewayBlockReason(before, after, plan);
    if (block2 !== null) {
      return refuse(block2, true);
    }

    const provenance: SafeReplyProvenance = Object.freeze({
      releaseId: plan.release.releaseId,
      providerId: response.provenance.providerId,
      modelId: response.provenance.modelId,
      modelVersion: response.provenance.modelVersion,
      promptId: response.provenance.promptId,
      promptVersion: response.provenance.promptVersion,
      promptDigest: response.provenance.promptDigest,
      usedFallback: response.provenance.usedFallback,
      attempts: response.provenance.attempts,
    });

    // Only a REPLY carries an M2 draft; other kinds validate but produce no reply body.
    let draft: ModelReplyDraft | undefined;
    if (reply.kind === 'REPLY' && reply.replyBody !== undefined) {
      draft = Object.freeze({
        structured: true,
        replyBody: reply.replyBody,
        citations: Object.freeze(
          reply.citations.map((c) =>
            Object.freeze({ knowledgeId: c.knowledgeId, version: c.version }),
          ),
        ),
        usageTraceId: response.runId,
      });
    }
    emit(
      'model-adapter-completed',
      'model-adapter-completed',
      reply.kind,
      outputTokens,
      response.latencyMs,
    );
    return result(
      true,
      reply.kind,
      'model-adapter-completed',
      true,
      draft,
      reply,
      provenance,
      outputTokens,
      response.latencyMs,
      profileDetail,
    );
  }

  async function draftReply(plan: ReplyPlan): Promise<unknown> {
    return (await draftReplyDetailed(plan)).draft;
  }

  /**
   * Per-scope mode exposes the M2 selector; legacy mode keeps the flat fields it always had.
   *
   * The selector answers from the configured binding for the actor M1 already assigned. It performs
   * no routing and no I/O, and a missing scope returns `undefined` so the turn fails closed rather
   * than borrowing another agent's prompt.
   */
  const port: ModelReplyAdapter =
    config.promptBindings === undefined
      ? {
          release: config.release,
          capabilityProfileRef: config.capabilityProfileRef,
          ...(config.promptFamily === undefined ? {} : { promptFamily: config.promptFamily }),
          ...(config.promptVersion === undefined ? {} : { promptVersion: config.promptVersion }),
          ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
          draftReply,
          draftReplyDetailed,
        }
      : {
          release: config.release,
          capabilityProfileRef: config.capabilityProfileRef,
          selectPromptIdentity: ({ assignedActor }): ModelPromptIdentity | undefined => {
            const binding = bindingFor(config, assignedActor);
            if (binding === undefined) {
              return undefined;
            }
            return {
              promptFamily: binding.promptFamily,
              promptVersion: binding.promptVersion,
              ...(binding.evaluationRef === undefined
                ? {}
                : { evaluationRef: binding.evaluationRef }),
            };
          },
          draftReply,
          draftReplyDetailed,
        };
  return Object.freeze(port);
}
