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
  const missing =
    config.authoritativeState === undefined ||
    config.policy === undefined ||
    typeof config.clock !== 'function' ||
    config.release === undefined ||
    typeof config.promptFamily !== 'string' ||
    config.promptFamily.length === 0 ||
    typeof config.promptVersion !== 'number' ||
    typeof config.capabilityProfileRef !== 'string' ||
    config.capabilityProfileRef.length === 0;
  if (missing) {
    throw new JarvisRuntimeError('invalid-config');
  }
}
