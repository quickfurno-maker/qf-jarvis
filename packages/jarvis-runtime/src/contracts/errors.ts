/**
 * The closed M5 composition-root error taxonomy (QFJ-M5, ADR-0059 §G).
 *
 * The ONLY error the composition root throws is a construction-time wiring error for a missing
 * mandatory dependency (authoritative state, model identity, policy, clock). Runtime paths never throw
 * a raw error — a missing optional integration dependency, a gate block, or a rejected Promise is
 * normalized to a fail-closed `JarvisRuntimeResult`.
 */
export const JARVIS_RUNTIME_ERROR_CODES = ['invalid-config'] as const;
export type JarvisRuntimeErrorCode = (typeof JARVIS_RUNTIME_ERROR_CODES)[number];

/** A fail-closed composition wiring error. Carries a safe code only — no message/subject/secret. */
export class JarvisRuntimeError extends Error {
  public readonly code: JarvisRuntimeErrorCode;
  public constructor(code: JarvisRuntimeErrorCode) {
    super(code);
    this.name = 'JarvisRuntimeError';
    this.code = code;
  }
}
