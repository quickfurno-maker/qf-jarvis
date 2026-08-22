/**
 * `@qf-jarvis/aarohi-agent` — the AVG-1 prospect identity and acquisition-case DOMAIN.
 *
 * ### What this is
 *
 * The Jarvis-side domain contract for Aarohi, the Vendor Growth and Acquisition agent (ADR-0085,
 * QVGE overlay stage AVG-1). Aarohi owns genuinely net-new, UNREGISTERED vendor acquisition through
 * to authoritative paid/active conversion; Anisha owns the registered/existing vendor relationship
 * from Core-confirmed ACTIVE onward.
 *
 * ### What this is NOT
 *
 * Not a runtime. Aarohi's runtime status is PLANNED / DISABLED and this slice does not change that:
 * there is no outreach, no channel, no credential, no provider, no n8n, no Instagram, no WhatsApp
 * and no persistence here. This package is pure contracts and pure functions over frozen values.
 *
 * Not a second source of vendor truth. A prospect is explicitly NOT a vendor. QuickFurno Core
 * remains authoritative for registration, active/inactive/dormant/former status, previous-contact
 * truth, duplicate truth, do-not-contact truth, vendor identity, registration, paid/ACTIVE
 * conversion, and package/payment business truth. None of those may be inferred here from model
 * output, conversation text, a provider receipt, a delivery, memory, RAG or campaign state.
 *
 * ### The two invariants worth reading the code for
 *
 * The existing-vendor gate is an ALLOWLIST with exactly one permitted status, and absent or
 * ambiguous Core truth is a STOP rather than a gap.
 *
 * The ACTIVE handoff trusts exactly one authority, and `completeCoreActiveHandoff` is the ONLY
 * public route into `HANDED_OFF_TO_ANISHA` — the ordinary transition table has no entry for it, so a
 * caller cannot end Aarohi ownership without Core's attestation in hand. Substitute authority tokens
 * are enumerated so their refusal is provable; substitute EVIDENCE has no field to occupy at all.
 */

export {
  AAROHI_AGENT_ID,
  AAROHI_PROSPECT_CONTRACT_VERSION,
  createProspectIdentity,
  PROSPECT_DISCOVERY_SOURCES,
  prospectIdentitySchema,
} from './contracts/prospect-identity.js';
export type {
  AarohiProspectContractVersion,
  ProspectDiscoverySource,
  ProspectIdentity,
} from './contracts/prospect-identity.js';

export {
  ACQUISITION_REFUSAL_REASONS,
  BLOCKED_CORE_STATUSES,
  CORE_PARTY_STATUSES,
  CORE_STATUS_ROLE,
  CORE_STATUS_ROLES,
  coreEligibilityObservationSchema,
  ELIGIBLE_CORE_STATUSES,
  evaluateAcquisitionEligibility,
} from './contracts/existing-vendor-gate.js';
export type {
  AcquisitionEligibility,
  AcquisitionRefusalReason,
  CoreEligibilityObservation,
  CorePartyStatus,
  CoreStatusRole,
} from './contracts/existing-vendor-gate.js';

export {
  ACQUISITION_CASE_STATES,
  ACQUISITION_CASE_TRANSITIONS,
  acquisitionCaseSchema,
  canTransition,
  CASE_TRANSITION_REFUSALS,
  isTerminalAcquisitionCaseState,
  openAcquisitionCase,
  TERMINAL_ACQUISITION_CASE_STATES,
  transitionAcquisitionCase,
} from './contracts/acquisition-case.js';
export type {
  AcquisitionCase,
  AcquisitionCaseState,
  CaseTransitionRefusal,
  CaseTransitionResult,
} from './contracts/acquisition-case.js';

export {
  ACTIVATION_AUTHORITIES,
  activationAttestationSchema,
  completeCoreActiveHandoff,
  HANDOFF_REFUSAL_REASONS,
  HANDOFF_REJECTED_AUTHORITIES,
  HANDOFF_TRUSTED_AUTHORITY,
} from './contracts/active-handoff.js';
export type {
  ActivationAttestation,
  ActivationAuthority,
  CoreActiveHandoffResult,
  HandoffRefusalReason,
} from './contracts/active-handoff.js';
