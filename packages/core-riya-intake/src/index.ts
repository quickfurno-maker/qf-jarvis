/**
 * `@qf-jarvis/core-riya-intake` — the Core-owned boundary for Riya's post-summary intake
 * (RWC-P6, ADR-0101).
 *
 * ### The three questions this package asks, and never answers
 *
 * Has Core captured contact? What did the client decide about consent? May this confirmed enquiry
 * become a business intake? Every one belongs to QuickFurno Core. Jarvis reads the answers and moves
 * a conversation; it computes none of them, stores none of them, and has no field in which it could.
 *
 * The authority matrix states the sharpest of the three directly — *Consent: READ for every agent,
 * Core final authority, PROHIBITED to change for all agents* — and this package is what makes that
 * operational. There is no `grantConsent`, no `captureContact`, and no writable field anywhere.
 *
 * ### Data in, nothing out
 *
 * No HTTP, fetch, URL, API key, environment read, database, cache, clock, randomness, n8n, provider
 * or model — and **no QuickFurno adapter**. It also knows nothing about a conversation: no phase, no
 * continuity, no observation, no reducer. Both directions are enforced by its containment spec.
 *
 * ### What it deliberately does not reuse
 *
 * `ClientConfirmationV1` is assignment-domain evidence — reassignment and additional-category — and
 * its `statementCode` is an open machine token, so reinterpretation would be easy and silent.
 * `CommunicationAuthorizationV1` answers whether an outbound message may be SENT to a recipient, and
 * says so while explicitly refusing to carry a consent snapshot. Neither is lead-intake consent. P6
 * defines its own narrow evidence rather than borrowing a name that already means something else.
 *
 * ### The public surface is seven runtime values
 *
 * A version, the error vocabulary, the error class, and four parsers/constructors. The schemas stay
 * internal: a caller able to compose sub-schemas would build its own half-validated request, and the
 * guarantee that everything in use went through a canonical parser would quietly stop being true.
 * The port is TYPE-only, and the deterministic fake lives under `./testing` so it can never become a
 * production default.
 */

export { CORE_RIYA_INTAKE_ERROR_CODES, CoreRiyaIntakeError } from './errors.js';
export type { CoreRiyaIntakeErrorCode } from './errors.js';

export { parseCoreRiyaIntakeStateV1 } from './contract/intake-state.js';
export type {
  CoreRiyaConsentState,
  CoreRiyaContactState,
  CoreRiyaIntakeConsentV1,
  CoreRiyaIntakeContactV1,
  CoreRiyaIntakeReadInput,
  CoreRiyaIntakeStateV1,
} from './contract/intake-state.js';

export {
  CORE_RIYA_INTAKE_CONTRACT_VERSION,
  createCoreRiyaIntakeSubmissionRequestV1,
  parseCoreRiyaIntakeSubmissionLookupV1,
  parseCoreRiyaIntakeSubmissionResultV1,
} from './contract/submission.js';
export type {
  CoreRiyaIntakeLookupStatus,
  CoreRiyaIntakeOutcome,
  CoreRiyaIntakeSubmissionLookupV1,
  CoreRiyaIntakeSubmissionRequestV1,
  CoreRiyaIntakeSubmissionResultV1,
} from './contract/submission.js';

export type { CoreRiyaIntakeLookupInput, CoreRiyaIntakePort } from './contract/port.js';
