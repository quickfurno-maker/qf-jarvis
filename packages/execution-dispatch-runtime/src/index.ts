/**
 * `@qf-jarvis/execution-dispatch-runtime` — the test-only B4 execution-dispatch boundary
 * (QFJ-P09.02, ADR-0090).
 *
 * ### Which edge this is
 *
 * QuickFurno Core → n8n. This package models the validation an n8n-side adapter would run before
 * acting on a Core-issued `ExecutionIntentV1`.
 *
 * It is NOT Jarvis → n8n. That edge does not exist and this package does not create it: there is no
 * transport, no endpoint, no URL, no webhook, no workflow id, no n8n client, no provider client and
 * no credential anywhere in it. Nothing in the repository imports this package yet — it is a leaf
 * with tests, deliberately.
 *
 * The wire protocol is PROPOSED. Core does not sign this way yet and the execution side does not
 * verify this way yet; the boundary exists so it can be reviewed and attacked before either end is
 * built.
 *
 * ### The public surface is small on purpose
 *
 * Seven runtime values and the types they need. The envelope parser, the nominal digest, the signing
 * input builder, the internal key record, the crypto helpers, the in-memory replay fake and the
 * test bridge fixture are all deliberately NOT exported: each of them is either an internal detail
 * whose misuse would weaken the boundary, or a test-only artefact that must never reach a caller.
 *
 * ### What the result is not
 *
 * A `first-seen` observation says a dispatch arrived authentically, intact, in time, and not as a
 * duplicate. It does not say anything may happen, and it is not an `ExecutionResultV1` — execution
 * truth belongs to Core after a real execution returns. There is no `canExecute`, `canSend`,
 * `isAuthorized`, `consentValid`, `retryAllowed`, `sent`, `delivered` or `executed` anywhere in
 * this API, because none of them would be true.
 */

export { verifyExecutionDispatch } from './verify-execution-dispatch.js';
export type {
  VerifyExecutionDispatchInput,
  VerifyExecutionDispatchOptions,
} from './verify-execution-dispatch.js';

export { ExecutionDispatchKeyRegistry } from './keys/execution-dispatch-key-registry.js';
export type { ExecutionDispatchKeyRecordInput } from './keys/execution-dispatch-key-registry.js';

export {
  EXECUTION_DISPATCH_DOMAIN_SEPARATOR,
  EXECUTION_DISPATCH_KEY_PURPOSE,
} from './protocol/limits.js';

export { EXECUTION_DISPATCH_REASONS } from './protocol/reason-codes.js';
export type { ExecutionDispatchReason } from './protocol/reason-codes.js';

export {
  ExecutionDispatchConfigError,
  ExecutionDispatchKeyRegistryError,
} from './protocol/errors.js';

export type {
  ExecutionReplayGuard,
  ReplayClaimInput,
  ReplayClaimOutcome,
} from './replay/replay-guard.js';

export type {
  DispatchDisposition,
  ExactReplayObservation,
  ExecutionDispatchResult,
  FirstSeenDispatchObservation,
  RefusedDispatch,
  ValidatedDispatchObservation,
} from './contracts/result.js';
