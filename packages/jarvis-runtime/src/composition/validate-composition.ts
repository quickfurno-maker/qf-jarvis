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
    c.capabilityProfileRef.length === 0;
  if (missing) {
    throw new JarvisRuntimeError('invalid-config');
  }
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
