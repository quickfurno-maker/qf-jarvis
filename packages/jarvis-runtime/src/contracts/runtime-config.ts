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
import type {
  GovernedKnowledgeRegistry,
  KnowledgeObservabilityHook,
} from '@qf-jarvis/governed-knowledge';
import type {
  ModelGatewayInvoker,
  ModelReplyPromptBinding,
  ModelReplyPromptBindings,
} from '@qf-jarvis/model-reply-adapter';
import type { PromptRegistry } from '@qf-jarvis/prompt-registry';

import type { AuthoritativeConversationStatePort } from './authoritative-state.js';
import type { ClientSalesBehaviourInputPort } from './behaviour-input.js';
import type { VendorJourneyBehaviourInputPort } from './vendor-journey-behaviour-input.js';
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
  /**
   * The provenance correlation reference.
   *
   * Separate from `JarvisRuntimeConfig.correlationId`, which belongs to the M3 Core-decision adapter.
   * The two are different contracts with different bounds and different audiences, and coupling them
   * would mean a change made for Core silently rewrote the audit trail. Absent -> `envelope.messageId`.
   */
  readonly correlationId?: string;
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
  /**
   * The LEGACY single prompt identity. Required unless `promptBindings` is supplied; it can serve
   * only the one scope its definition is bound to (ADR-0073).
   */
  readonly promptFamily?: string;
  readonly promptVersion?: number;
  /**
   * Per-scope prompt bindings (ADR-0073). One runtime can serve Riya AND Anisha by configuring a
   * CLIENT and a VENDOR binding. When present, every legacy prompt/evaluation field must be absent.
   */
  readonly promptBindings?: ModelReplyPromptBindings;
  /**
   * The DEDICATED prompt binding for the Riya conversation-evolution capability (ADR-0099).
   *
   * Separate from the legacy `promptFamily`/`promptVersion` and from `promptBindings.CLIENT`, and
   * there is NO fallback to either. The RWC-P4B structured answer has different semantics from a
   * reply-only one, so silently reusing a prompt that was written, evaluated and approved to produce
   * a reply alone would mean running an un-reviewed instruction under a reviewed digest.
   *
   * It must carry BOTH `evaluationRef` and `evaluationPromptDigest`: without an evaluated prompt
   * there is no Riya-aware model call at all.
   */
  readonly riyaConversationEvolutionPromptBinding?: ModelReplyPromptBinding;

  /**
   * The RWC-P7 grounded prompt bindings (ADR-0103 §10).
   *
   * Separate again, and for the sharpest version of the same reason. A grounded turn puts governed
   * knowledge records inside the user message, and a prompt evaluated BEFORE grounded content existed
   * has never been assessed against the one question that matters here: what should Riya do when a
   * record in its own input contains an instruction? Falling back to it would answer that by omission.
   *
   * Each must carry BOTH `evaluationRef` and `evaluationPromptDigest`. There is no fallback to
   * `riyaConversationEvolutionPromptBinding`, and none to the ordinary CLIENT reply prompt.
   */
  readonly riyaGroundedConversationEvolutionPromptBinding?: ModelReplyPromptBinding;
  readonly riyaGroundedReplyPromptBinding?: ModelReplyPromptBinding;

  /**
   * The RWC-P7 grounded knowledge configuration (ADR-0103 §4).
   *
   * OPTIONAL. Absent means the pre-P7 behaviour exactly: no retrieval, no grounded prompt, and
   * INTRO..SUMMARY served by the unchanged RWC-P4B path.
   *
   * Present means every model-eligible Riya turn performs ONE exact governed retrieval over the
   * CONFIGURED topics, after M2's privacy gate and before the same one model call. The registry is
   * injected — there is no global one, and nothing here loads knowledge from a file, an environment
   * variable, an HTTP endpoint or a database.
   */
  readonly riyaGroundedKnowledge?: RiyaGroundedKnowledgeConfig;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;
  /**
   * The injected immutable prompt registry (ADR-0073). Absent -> a model-backed draft fails closed
   * in M4; no-model paths are unaffected and need no registry. There is no default registry.
   */
  readonly promptRegistry?: PromptRegistry;
  /** The exact prompt-content digest the bound evaluation covers. Pairs with `evaluationRef`. */
  readonly evaluationPromptDigest?: string;

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
   *
   * The generic-sounding name is a naming debt from S3-C-B, when Riya was the only agent. It is
   * deliberately NOT renamed here: it is externally visible TypeScript API, and a rename would be a
   * breaking change made for tidiness. ADR-0071 records the debt; S3-D-B does not repair it.
   */
  readonly behaviourInput?: ClientSalesBehaviourInputPort;

  /**
   * Optional vendor-journey behaviour inputs (ADR-0071). Additive and non-breaking. Absent -> VENDOR
   * turns take the legacy `REPLY` path unchanged and Anisha behaviour is never consulted.
   */
  readonly vendorJourneyBehaviourInput?: VendorJourneyBehaviourInputPort;

  /** Optional deployment-level provenance references; safe defaults are derived when absent. */
  readonly provenanceRefs?: JarvisProvenanceRefs;

  readonly observability?: JarvisRuntimeObservabilityHook;
}

/**
 * What a deployment injects to let Riya answer from governed knowledge (RWC-P7, ADR-0103 §4).
 *
 * ### Exact topics, configured once, never derived
 *
 * `topics` is a deployment decision — the business chooses which approved subjects Riya may ground
 * against. It is NOT derived from the client's message, not ranked, not embedded and not searched.
 * QFJ-P04.05 keeps semantic and vector RAG DISABLED, and a topic list computed from prose would be
 * free-text retrieval wearing an exact retrieval's clothes.
 *
 * The order is the caller's and is preserved: it is the order records reach the model, and the order
 * the plan's citations are cross-checked against.
 *
 * ### Injected, never discovered
 *
 * The registry is handed in. There is no global registry, no default, and no loading from a file, an
 * environment variable, an HTTP endpoint or a database anywhere in this package.
 */
export interface RiyaGroundedKnowledgeConfig {
  /** The immutable QFJ-P04.03 registry. The one knowledge authority; nothing else is consulted. */
  readonly registry: GovernedKnowledgeRegistry;
  /** 1..8 exact topics, unique, in caller order. No wildcard, no pattern, no query. */
  readonly topics: readonly string[];
  /** Optional governed-knowledge observability. Retrieval events stay inside that package's hook. */
  readonly observability?: KnowledgeObservabilityHook;
}
