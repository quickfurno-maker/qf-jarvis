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
    typeof c.promptFamily !== 'string' ||
    c.promptFamily.length === 0 ||
    typeof c.promptVersion !== 'number' ||
    typeof c.capabilityProfileRef !== 'string' ||
    c.capabilityProfileRef.length === 0;
  if (missing) {
    throw new JarvisRuntimeError('invalid-config');
  }
}
