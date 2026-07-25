/**
 * The closed M5 runtime outcome vocabulary (QFJ-M5, ADR-0059 §F).
 *
 * A composition-root outcome is exactly one of these. `CORE_ACCEPTED` means an exact QuickFurno Core
 * approval only — never sent, delivered, executed, or persisted. `MODEL_DRAFTED` is a validated draft/
 * proposal with the Core decision deliberately deferred (no Core transport wired). `NO_ACTION` is
 * reserved for a non-`REPLY` model outcome and is not produced by the current `REPLY`-only
 * orchestration (it is not fabricated here). There is no send/deliver/execute value.
 */
export const JARVIS_RUNTIME_OUTCOMES = [
  'REFUSED',
  'MODEL_DRAFTED',
  'CORE_ACCEPTED',
  'CORE_REJECTED',
  'HUMAN_REVIEW_REQUIRED',
  'RETRY_LATER',
  'STALE_REVISION',
  'CORE_UNAVAILABLE',
  'NO_ACTION',
] as const;
export type JarvisRuntimeOutcome = (typeof JARVIS_RUNTIME_OUTCOMES)[number];
