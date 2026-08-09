/**
 * Fail-closed configuration validation (QFJ-M5, ADR-0059 §G).
 *
 * A missing MANDATORY dependency (authoritative state, model identity, policy, clock) is a wiring
 * error: the composition root refuses to construct, throwing `JarvisRuntimeError('invalid-config')`.
 * Optional integration dependencies (gateway invoker, Core transport, knowledge port) are NOT checked
 * here — their absence fails closed at runtime through the lower adapter.
 */
import { JarvisRuntimeError } from '../contracts/errors.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';

/** Assert the mandatory dependencies are present, or throw a safe fail-closed wiring error. */
export function assertMandatoryDependencies(config: JarvisRuntimeConfig): void {
  // Guard against untyped callers that bypass the compile-time contract: view the config through a
  // partial lens so a genuinely-absent mandatory dependency is caught at runtime and fails closed.
  const c: Partial<JarvisRuntimeConfig> = config;
  const missing =
    c.authoritativeState === undefined ||
    c.policy === undefined ||
    typeof c.clock !== 'function' ||
    c.release === undefined ||
    !promptIdentityConfigured(c) ||
    typeof c.capabilityProfileRef !== 'string' ||
    c.capabilityProfileRef.length === 0 ||
    !groundedKnowledgeConfigured(c);
  if (missing) {
    throw new JarvisRuntimeError('invalid-config');
  }
}

/**
 * The RWC-P7 grounded wiring is either ABSENT or COMPLETE (ADR-0103 §4, §10).
 *
 * Absent is a valid, unchanged deployment: no retrieval, no grounded prompt, INTRO..SUMMARY served by
 * the RWC-P4B path exactly as before.
 *
 * Present means a deployer has decided Riya may answer from governed knowledge, and a half-wired
 * version of that decision is the dangerous one. A registry with no evaluated grounded prompts would
 * refuse every turn at runtime, which looks like an outage; a topic list containing a duplicate would
 * silently retrieve one record twice and cross-check against a citation list that no longer lines up.
 * Both are deployment mistakes rather than business outcomes, so they fail at CONSTRUCTION — before a
 * single client is waiting on the answer.
 */
function groundedKnowledgeConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const grounded = c.riyaGroundedKnowledge;
  if (grounded === undefined) {
    return true;
  }
  if (typeof grounded !== 'object' || Array.isArray(grounded)) {
    return false;
  }
  // A real registry, not a shape that happens to have the right name. The lookup capability is what
  // retrieval actually uses, so it is what construction checks for.
  const registry: unknown = grounded.registry;
  if (
    typeof registry !== 'object' ||
    registry === null ||
    typeof (registry as { readonly listByTopic?: unknown }).listByTopic !== 'function'
  ) {
    return false;
  }
  const topics = grounded.topics;
  if (
    !Array.isArray(topics) ||
    topics.length < 1 ||
    topics.length > MAX_GROUNDED_TOPICS ||
    !topics.every((topic) => typeof topic === 'string' && topic.length > 0) ||
    new Set(topics).size !== topics.length
  ) {
    return false;
  }
  // BOTH grounded bindings, BOTH evaluated. A grounded deployment serves pre-summary and
  // post-summary turns from the same configuration, and there is no fallback for either.
  return (
    evaluatedBinding(c.riyaGroundedConversationEvolutionPromptBinding) &&
    evaluatedBinding(c.riyaGroundedReplyPromptBinding)
  );
}

/** The RWC-P7 topic ceiling. Retrieval is exact, so one topic resolves to at most one record. */
const MAX_GROUNDED_TOPICS = 8;

function evaluatedBinding(binding: JarvisRuntimeConfig['riyaGroundedReplyPromptBinding']): boolean {
  return (
    binding !== undefined &&
    typeof binding.evaluationRef === 'string' &&
    binding.evaluationRef.length > 0 &&
    typeof binding.evaluationPromptDigest === 'string' &&
    binding.evaluationPromptDigest.length > 0
  );
}

/**
 * A prompt identity is configured in EXACTLY ONE of the two shapes (QFJ-S3-I-B, ADR-0073).
 *
 * The legacy shape is a single `promptFamily`/`promptVersion`, which — because a definition is
 * scope-bound — can serve only one agent. The per-scope shape names a binding per agent scope, so one
 * runtime serves Riya and Anisha without a second composition.
 *
 * Supplying both is refused rather than merged. A merge would have to decide which one wins for a
 * scope named in both, and every possible answer silently sends some agent a prompt its deployer did
 * not choose — the exact failure this ADR exists to remove. M4 enforces the same rule at its own
 * boundary; this check is here so a mixed config fails at composition rather than mid-turn.
 */
function promptIdentityConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const legacyPresent =
    c.promptFamily !== undefined ||
    c.promptVersion !== undefined ||
    c.evaluationRef !== undefined ||
    c.evaluationPromptDigest !== undefined;
  if (c.promptBindings !== undefined) {
    return !legacyPresent && hasAtLeastOneBinding(c.promptBindings);
  }
  return (
    typeof c.promptFamily === 'string' &&
    c.promptFamily.length > 0 &&
    typeof c.promptVersion === 'number'
  );
}

/** An empty bindings object configures no agent at all, which is a wiring error, not a policy. */
function hasAtLeastOneBinding(
  bindings: NonNullable<JarvisRuntimeConfig['promptBindings']>,
): boolean {
  return (
    bindings.CLIENT !== undefined ||
    bindings.VENDOR !== undefined ||
    bindings.COORDINATION !== undefined ||
    bindings.SYSTEM !== undefined
  );
}
