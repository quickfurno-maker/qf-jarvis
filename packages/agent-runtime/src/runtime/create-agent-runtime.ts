/**
 * The agent-runtime factory (QFJ-M1, ADR-0054 §H).
 *
 * Assembles the deterministic runtime from INJECTED, provider-neutral collaborators: a routing policy,
 * an optional privacy gate, an optional model interface (a capability marker only — NEVER called in
 * M1), and an optional observability hook. The runtime performs no network, filesystem, env, clock,
 * random, provider, or database access.
 */
import type { ConversationPrivacyGate } from '../contracts/privacy-gate.js';
import type { RuntimePolicy } from '../contracts/policy.js';
import type { RuntimeObservabilityHook } from '../contracts/observability.js';
import { NOOP_RUNTIME_OBSERVABILITY } from '../contracts/observability.js';
import type { RuntimeExecutionClass } from '../contracts/vocabularies.js';

/**
 * A provider-neutral model interface the runtime MAY be given. In QFJ-M1 the runtime NEVER calls it —
 * it is a capability marker (its execution class gates data-class serviceability). Live model calls
 * belong to a later, separately authorized slice via the model gateway.
 */
export interface RuntimeModelInterface {
  readonly executionClass: RuntimeExecutionClass;
  /** MUST NOT be invoked by the runtime in this slice. */
  draftReply(request: unknown): unknown;
}

/** The immutable, deterministic agent runtime. */
export interface AgentRuntime {
  readonly policy: RuntimePolicy;
  readonly privacyGate: ConversationPrivacyGate | undefined;
  readonly modelInterface: RuntimeModelInterface | undefined;
  readonly observability: RuntimeObservabilityHook;
}

export interface CreateAgentRuntimeConfig {
  readonly policy: RuntimePolicy;
  readonly privacyGate?: ConversationPrivacyGate;
  readonly modelInterface?: RuntimeModelInterface;
  readonly observability?: RuntimeObservabilityHook;
}

/** Build a frozen agent runtime from injected collaborators. */
export function createAgentRuntime(config: CreateAgentRuntimeConfig): AgentRuntime {
  return Object.freeze({
    policy: config.policy,
    privacyGate: config.privacyGate,
    modelInterface: config.modelInterface,
    observability: config.observability ?? NOOP_RUNTIME_OBSERVABILITY,
  });
}
