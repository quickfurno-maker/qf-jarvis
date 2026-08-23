/**
 * Frozen verdict construction (QFJ-P09.05, ADR-0110).
 *
 * INTERNAL. The results are flat by design, so a shallow freeze IS a deep freeze here -- there is no
 * nested object to leave mutable, because nothing about the communication itself is carried out of
 * this package.
 *
 * The success verdict is a single shared, frozen instance rather than a fresh object per call.
 * That is deliberate: it is a value with no fields, so two successes cannot meaningfully differ, and
 * a caller who somehow mutated one would otherwise corrupt only their own copy and be confused
 * later. Frozen and shared, the attempt fails loudly under strict mode and silently otherwise, and
 * either way every reader still sees `ok: true`.
 */
import type { CommunicationLifecycleTransitionResult } from '../contracts/result.js';
import type { CommunicationLifecycleRefusalReason } from '../contracts/reasons.js';

/** The one consistent verdict. */
export const LIFECYCLE_CONSISTENT: CommunicationLifecycleTransitionResult = Object.freeze({
  ok: true as const,
});

/** A refusal carrying one closed reason and nothing that arrived from the caller. */
export function refuse(
  reason: CommunicationLifecycleRefusalReason,
): CommunicationLifecycleTransitionResult {
  return Object.freeze({ ok: false as const, reason });
}
