/**
 * The M5 composition-root configuration (QFJ-M5, ADR-0059 §G).
 *
 * All collaborators are INJECTED — no `process.env`, service locator, or global registry. Mandatory
 * dependencies (authoritative state, model identity, policy, clock) fail closed at construction; a
 * missing optional integration dependency (gateway invoker, Core transport, knowledge port) fails
 * closed at RUNTIME through the lower adapter. The root duplicates no business rule: assignment,
 * privacy, model routing/fallback, reply validation, and Core validation stay in the lower packages.
 */
import type { KnowledgePort, ModelReleaseRef, RuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionProtocol, CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import type { AuthoritativeConversationStatePort } from './authoritative-state.js';
import type { JarvisRuntimeObservabilityHook } from './observability.js';

export interface JarvisRuntimeConfig {
  /** MANDATORY. The ONE authoritative content-free conversation-state source all readers delegate to. */
  readonly authoritativeState: AuthoritativeConversationStatePort;
  /** MANDATORY. The routing policy (assignment is a pure function of party/takeover + this policy). */
  readonly policy: RuntimePolicy;
  /** MANDATORY. An injected canonical-instant clock (no wall-clock read inside the runtime). */
  readonly clock: () => string;

  // MANDATORY exact model identity (threaded into the M4 adapter and the M2 plan).
  readonly release: ModelReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;

  /** Optional M4 gateway invoker; absent -> the model adapter fails closed (unavailable) at runtime. */
  readonly gatewayInvoker?: ModelGatewayInvoker;

  /** Optional M3 Core transport; absent -> the Core decision is deferred (MODEL_DRAFTED), never faked. */
  readonly coreTransport?: CoreDecisionTransport;
  readonly coreProtocol?: CoreDecisionProtocol;
  readonly correlationId?: string;

  /** Optional exact governed-knowledge port (bounded exact retrieval only; no RAG). */
  readonly knowledgePort?: KnowledgePort;
  readonly knowledgeTopics?: readonly string[];

  readonly taskClass?: string;
  /** When true, a model identity without an evaluation reference is refused. */
  readonly requireEvaluationRef?: boolean;

  readonly observability?: JarvisRuntimeObservabilityHook;
}
