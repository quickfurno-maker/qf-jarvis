/**
 * `@qf-jarvis/communication-authorization-runtime` — the correlation control (QFJ-P08, ADR-0083).
 *
 * The repository already asks for approval, correlates Core's decision, stores it durably, and lets
 * an authenticated human submit an intent about it. This is the last Jarvis-side P08 control before
 * bounded P09 execution work can begin, and it answers a different question from all of those:
 * **may this specific recipient be contacted at all?**
 *
 * That question is QuickFurno Core's, and it stays Core's. This package holds one pure function:
 * given a `CommunicationRequestV1`, the `CommunicationAuthorizationV1` Core returned, and — when
 * Core said yes — the approval evidence behind it, prove the artifacts describe each other and
 * return a frozen OBSERVATION.
 *
 * **It is not a consent system, and it must never grow into one.** It stores no consent evidence, no
 * preference, no suppression list, no STOP/START state, no do-not-contact flag and no eligibility
 * cache — not as a field, not as a list, and not as a "courtesy" copy a later feature would start
 * trusting (communication-model.md). Unknown or stale consent is not permission; a missing answer is
 * a no.
 *
 * **Founder approval does not override an opt-out.** A human may approve a message to a client who
 * has withdrawn consent, Core will refuse it, and that refusal is an ordinary successful observation
 * here — never retried, reinterpreted or downgraded. An `authorized` outcome, conversely, requires
 * approval evidence re-proved through the public approval runtime whose **per-action** verdict is
 * `approved`.
 *
 * And the result confers nothing. There is no `canSend`, `canExecute`, `isAuthorized`,
 * `consentValid`, `eligible` or `validUntil`: Core's artifact records what Core decided *when it
 * decided*, and eligibility is revalidated at execution time by Core and the communications runtime.
 * A prior authorization is not a future permission slip.
 *
 * It asks Core nothing, sends nothing, persists nothing, emits no event, creates no execution
 * intent, reads no clock, and cannot reach Meta, n8n or any provider.
 *
 * Three root runtime symbols. Every schema, comparator and classifier stays internal.
 */
export {
  COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES,
  CommunicationAuthorizationRuntimeError,
} from './contracts/errors.js';
export type { CommunicationAuthorizationRuntimeErrorCode } from './contracts/errors.js';

export { createCommunicationAuthorizationRuntime } from './create-communication-authorization-runtime.js';

export type {
  CommunicationAuthorizationEvidence,
  CommunicationAuthorizationValidationInput,
} from './contracts/input.js';
export type {
  CommunicationAuthorizationObservation,
  CommunicationAuthorizationRuntime,
} from './contracts/result.js';
