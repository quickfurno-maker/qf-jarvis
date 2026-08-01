/**
 * `@qf-jarvis/anisha-agent` — the Anisha vendor-journey behaviour surface (QFJ-S3-D-A, ADR-0070).
 *
 * Behaviour only. Every runtime mechanism it relies on — identity, actor↔party scope, assignment, the
 * conversation-state machine, the proposal boundary, the orchestration pipeline, the behaviour seam,
 * the ModelReplyPort, provenance, bounded identifiers — is owned by ADR-0054/0055/0057/0059/0066/
 * 0068/0069 and is REUSED here, never reimplemented. This package exports no runtime, no router, no
 * state machine, no port and no proposal helper.
 *
 * It performs no model call, holds no credential, touches no transport, writes nothing, and proposes
 * nothing directly: `modelReplyEligible` and a disposition are DECLARATIONS the merged composition
 * acts on. QuickFurno Core remains the only business authority — Anisha never verifies, activates,
 * ranks, assigns, mutates a profile, changes a package, touches money, or scores lead quality.
 *
 * Fourteen root runtime symbols. S3-D-B composes them; this package does not.
 */
export {
  ANISHA_BEHAVIOUR_VERSION,
  VENDOR_JOURNEY_INTENTS_FROZEN,
  PACKAGE_READINESS_BANDS_FROZEN,
  classifyVendorJourneyIntent,
  isVendorJourneySignals,
} from './contracts/vendor-journey-intent.js';
export type {
  AnishaBehaviourVersion,
  VendorJourneyIntent,
  VendorJourneySignals,
  PackageReadinessBand,
} from './contracts/vendor-journey-intent.js';

export {
  createVendorJourneyContext,
  VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN,
  VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN,
} from './contracts/vendor-journey-context.js';
export type {
  VendorJourneyContext,
  VendorJourneyContextInput,
  VendorJourneyContextCompleteness,
  VendorJourneyContextField,
} from './contracts/vendor-journey-context.js';

export { AnishaBehaviourError, ANISHA_ERROR_CODES } from './contracts/errors.js';
export type { AnishaErrorCode } from './contracts/errors.js';

export {
  decideAnishaTurn,
  ANISHA_ACTOR,
  ANISHA_SUPPORTED_PARTY,
  ANISHA_DISPOSITIONS_FROZEN,
} from './behaviour/decide-anisha-turn.js';
export type {
  AnishaTurnInput,
  AnishaTurnDecision,
  AnishaDisposition,
} from './behaviour/decide-anisha-turn.js';
