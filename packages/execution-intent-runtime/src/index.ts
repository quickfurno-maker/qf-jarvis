/**
 * `@qf-jarvis/execution-intent-runtime` — the P09 correlation foundation (QFJ-P09.01, ADR-0084).
 *
 * ADR-0083 §12 left P09 an explicit instruction: exact execution binding **must** begin from a
 * Core-issued `ExecutionIntentV1`, and must never be inferred from a communication authorization,
 * which names an approval decision and carries no `approvedActionId`. This package is that
 * instruction implemented, and it is the first thing P09 builds because everything after it depends
 * on knowing *which approved action* an intent actually runs.
 *
 * One pure synchronous method. Given Core's execution intent and raw approval evidence the PUBLIC
 * approval runtime can independently re-prove, it proves the intent names and exactly reproduces the
 * approved proposed action — same recommendation, same Core decision, same action id, same action
 * type, same contract version, structurally identical governed parameters — and returns a deeply
 * frozen OBSERVATION.
 *
 * **Only QuickFurno Core issues execution intents; only n8n executes them.** Nothing here creates an
 * intent, dispatches, sends, executes, retries, persists, emits, resolves a recipient or a phone
 * number, chooses a provider, holds a credential, generates or consumes an idempotency key, or
 * reaches n8n, Meta or any provider. It reads no clock and no environment.
 *
 * **It is static provenance, not permission.** The result carries no `canExecute`, `canSend`,
 * `isAuthorized`, `isFresh`, `currentlyValid`, `consentValid` or `retryAllowed`. Every temporal rule
 * is a relationship between artifacts, so the observation is true whenever it is evaluated —
 * dispatch-time freshness and authenticity belong to a later execution-side check against a trusted
 * execution-side clock. And a communication action still needs its second yes: consent, opt-out,
 * suppression and STOP are revalidated at execution time by Core and the communications runtime, and
 * this package neither asks nor answers that question.
 *
 * Three root runtime symbols. The schemas, the structural comparator and the freezer stay internal.
 */
export {
  EXECUTION_INTENT_RUNTIME_ERROR_CODES,
  ExecutionIntentRuntimeError,
} from './contracts/errors.js';
export type { ExecutionIntentRuntimeErrorCode } from './contracts/errors.js';

export { createExecutionIntentRuntime } from './create-execution-intent-runtime.js';

export type {
  ExecutionApprovalEvidence,
  ExecutionIntentValidationInput,
} from './contracts/input.js';
export type { ExecutionIntentObservation, ExecutionIntentRuntime } from './contracts/result.js';
