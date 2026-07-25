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
import type { ModelReplyAdapterReason } from '../contracts/reasons.js';
import type { ReplyStateReader } from '../contracts/state.js';
import type { StructuredReply, StructuredReplyKind } from '../contracts/reply-schema.js';
import type {
  ModelReplyAdapterEvent,
  ModelReplyAdapterEventType,
  ModelReplyAdapterObservabilityHook,
} from '../contracts/observability.js';
import { NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY } from '../contracts/observability.js';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';
import {
  buildGatewayRequest,
  DEFAULT_GATEWAY_REQUEST_BUDGETS,
  type GatewayRequestBudgets,
} from './build-gateway-request.js';
import { provenanceMatches } from './validate-provenance.js';
import { validateStructuredResult } from './validate-gateway-result.js';
import { citationsAuthorized } from './validate-citations.js';
import { postGatewayBlockReason, stateBlockReason } from './state-gates.js';

/** A model reply adapter: an M2 `ModelReplyPort` plus a detailed drafting method. */
export interface ModelReplyAdapter extends ModelReplyPort {
  draftReplyDetailed(plan: ReplyPlan): ModelReplyAdapterResult;
}

export interface ModelReplyAdapterConfig {
  /** The exact model identity this port represents; a plan must bind the same identity. */
  readonly release: ModelReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;
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

/** Build a model reply adapter from injected collaborators. */
export function createModelReplyAdapter(config: ModelReplyAdapterConfig): ModelReplyAdapter {
  const hook = config.observability ?? NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY;
  const budgets: GatewayRequestBudgets = { ...DEFAULT_GATEWAY_REQUEST_BUDGETS, ...config.budgets };

  function draftReplyDetailed(plan: ReplyPlan): ModelReplyAdapterResult {
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

    // Plan must bind THIS port's exact model identity (no wildcard/latest; exact release/prompt/etc.).
    if (
      !releaseEqual(plan.release, config.release) ||
      plan.promptFamily !== config.promptFamily ||
      plan.promptVersion !== config.promptVersion ||
      plan.capabilityProfileRef !== config.capabilityProfileRef ||
      plan.evaluationRef !== config.evaluationRef
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
    const before = config.stateReader.read();
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

    // Build the exact gateway request.
    let request;
    try {
      request = buildGatewayRequest({ plan, requestedAt: config.clock(), budgets });
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
      invocation = config.invoker.invoke(request);
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
    // Strict structured output.
    const structured = validateStructuredResult(response);
    if (!structured.ok) {
      return refuse('model-structured-output-invalid', true);
    }
    const reply = structured.reply;
    // Exact citation authorization (no silent drop).
    if (!citationsAuthorized(reply, plan)) {
      return refuse('model-citation-mismatch', true);
    }
    // Post-gateway state gate — a change during the round-trip prevents a draft.
    const after = config.stateReader.read();
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
    );
  }

  function draftReply(plan: ReplyPlan): unknown {
    return draftReplyDetailed(plan).draft;
  }

  const base = {
    release: config.release,
    promptFamily: config.promptFamily,
    promptVersion: config.promptVersion,
    capabilityProfileRef: config.capabilityProfileRef,
    draftReply,
    draftReplyDetailed,
  };
  const port: ModelReplyAdapter =
    config.evaluationRef === undefined ? base : { ...base, evaluationRef: config.evaluationRef };
  return Object.freeze(port);
}
