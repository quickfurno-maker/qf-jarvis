/**
 * The M5 composition-root configuration (QFJ-M5, ADR-0059 §G).
 *
 * All collaborators are INJECTED — no environment reads, service locator, or global registry. Mandatory
 * dependencies (authoritative state, model identity, policy, clock) fail closed at construction; a
 * missing optional integration dependency (gateway invoker, Core transport, knowledge port) fails
 * closed at RUNTIME through the lower adapter. The root duplicates no business rule: assignment,
 * privacy, model routing/fallback, reply validation, and Core validation stay in the lower packages.
 */
import type { KnowledgePort, ModelReleaseRef, RuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionProtocol, CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import type { AuthoritativeConversationStatePort } from './authoritative-state.js';
import type { ClientSalesBehaviourInputPort } from './behaviour-input.js';
import type { JarvisRuntimeObservabilityHook } from './observability.js';

/**
 * Deployment-level provenance references (QFJ-S3-C-B, ADR-0068).
 *
 * All opaque and identifier-safe: `[A-Za-z0-9._:-]{1,128}`, enforced by `createRuntimeProvenance`.
 * `modelRef`/`providerRef` are optional and must be supplied explicitly when wanted — they are NOT
 * derived from `release.modelId` or `release.providerId`, because a real catalogue identifier such as
 * `openai/gpt-oss-20b` contains `/` and would violate the grammar. A provenance record that quietly
 * rewrote its own references would be worse than one that declines to make a claim.
 */
export interface JarvisProvenanceRefs {
  readonly runtimeRef?: string;
  readonly policyRef?: string;
  /** A deployment-level opaque prompt reference. Never prompt text. */
  readonly promptRef?: string;
  readonly modelRef?: string;
  readonly providerRef?: string;
  readonly releaseRef?: string;
  readonly configRef?: string;
}

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

  /**
   * Optional client-sales behaviour inputs (ADR-0068). Absent -> the runtime takes the legacy `REPLY`
   * path unchanged and Riya behaviour is never consulted. Defining the seam does not activate it.
   */
  readonly behaviourInput?: ClientSalesBehaviourInputPort;

  /** Optional deployment-level provenance references; safe defaults are derived when absent. */
  readonly provenanceRefs?: JarvisProvenanceRefs;

  readonly observability?: JarvisRuntimeObservabilityHook;
}
