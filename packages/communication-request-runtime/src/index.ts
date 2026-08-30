/**
 * `@qf-jarvis/communication-request-runtime` — the `CommunicationRequestV1` producer (QFJ-P08,
 * ADR-0133).
 *
 * `CommunicationRequestV1` has existed in `@qf-jarvis/contracts` since Phase 2, and
 * `@qf-jarvis/communication-authorization-runtime` has consumed one since ADR-0083. What did not
 * exist was a PRODUCER: nothing in the repository built one, so a merged consumer had nothing to
 * consume and a canonical QFJ-P08 outstanding item had no owner. This package is it — slice S1 of
 * the real-execution-integration plan adopted by ADR-0132.
 *
 * One method: `createCommunicationRequestRuntime(...).createRequest(input)` validates an
 * already-governed recommendation and its action bindings against RECOMPUTED fingerprints, selects
 * ONE exact proposed action, derives every governance field from that source, generates the two
 * identities, assembles the artifact, validates it against `communicationRequestV1Schema`, and
 * returns it deeply frozen and detached.
 *
 * **A request is an ASK.** A successful call means only that Jarvis has constructed a valid request
 * asking QuickFurno Core whether a communication may proceed. It does not mean approved, authorized,
 * eligible, consent-valid, can-send, can-execute, ready-to-dispatch, scheduled-for-execution or
 * delivered.
 *
 * **It is not a consent system, and it must never grow into one.** QuickFurno Core remains the sole
 * consent, preference, suppression, STOP/START, do-not-contact and eligibility authority; Core and
 * the QF Communications Runtime revalidate at EXECUTION time. This package stores no consent flag,
 * no opt-out record, no STOP state, no suppression list, no eligibility cache and no expiry of an
 * authorization. Founder approval does not override an opt-out, and a prior communication
 * authorization is not a future permission slip.
 *
 * **It cannot reach a person.** `recipient` is an opaque Core entity reference whose character set
 * excludes the two characters an email address and an E.164 number require; there is no phone
 * number, email address, provider, webhook or destination anywhere in the input or the output.
 * `content` is a versioned reference to an approved template or script — there is no message body,
 * and the governed variables refuse one by key and by value shape. No template is resolved, no
 * message is rendered and no provider payload is built.
 *
 * **`proposedChannel` is proposed.** Core may refuse it, may lawfully authorize a different one, or
 * may refuse the whole request. Nothing here requires Core to answer with the channel Jarvis named.
 *
 * **It does not claim a request-to-approved-action identity.** No `approvalRequestId`,
 * `proposedActionId` or `actionFingerprint` reaches the artifact, no side mapping is created, and
 * nothing is inferred from `actionType`, `parameters`, `summary`, the purpose code or the template.
 * That semantic binding is Core's, and ADR-0083 section 11 keeps it there.
 *
 * It asks Core nothing, sends nothing, executes nothing, persists nothing, queues nothing, emits no
 * event, creates no approval, no communication authorization and no execution intent, holds no
 * pending or authorized state, reads no clock, and can reach no Core endpoint, no n8n workflow and
 * no provider. No package and no application imports it.
 *
 * Three root runtime symbols. Every schema, validator, identity helper and freezer stays internal.
 */
export {
  COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES,
  CommunicationRequestRuntimeError,
} from './contracts/errors.js';
export type { CommunicationRequestRuntimeErrorCode } from './contracts/errors.js';

export { createCommunicationRequestRuntime } from './create-communication-request-runtime.js';

export type { CommunicationRequestRuntimeInput } from './contracts/input.js';
export type {
  CommunicationRequestRuntime,
  CommunicationRequestRuntimeIdentityPort,
} from './contracts/result.js';
