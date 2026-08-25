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
 *
 * ### AVG-2 adds discovery evidence, and adds no authority at all (ADR-0111)
 *
 * An enrichment claim is an untrusted, provenance-bound observation about a candidate business. It
 * never establishes consent, never proves identity and never grants eligibility to contact. The
 * attribute vocabulary is closed, presence attributes cannot hold a destination, labels are screened
 * for contact shapes, and every evidence-quality level is spelled `UNVERIFIED_`.
 *
 * Conflicting claims are REPORTED, never resolved: sources do not vote, confidence does not win, and
 * array order changes nothing. Identity resolution belongs to AVG-6.
 *
 * There is ONE canonical public schema per shape. `enrichmentClaimSchema` and
 * `enrichmentProfileSchema` describe BUILT values and certify exactly what the builders produce, so
 * the contract cannot say two things depending on which half a reader consults. Profile
 * construction re-parses and REBUILDS every claim rather than trusting a declared type, so a plain
 * object that merely looks like a claim is refused and a caller keeps no reference into the result.
 *
 * `evaluateEnrichmentReviewReadiness` parses the canonical profile BEFORE consulting Core, then
 * reuses the AVG-1 gate and reads nothing else — not claim
 * count, not evidence quality, not consistency. `ENRICHMENT_REVIEWABLE` means a human may look at
 * the profile. It is not contact authorization, not execution eligibility, not consent, not Core
 * ACTIVE and not a verified vendor.
 *
 * ### AVG-3 adds priority scoring and Core-gated contact eligibility (ADR-0112)
 *
 * Priority is deterministic evidence readiness over the canonical AVG-2 profile. It is not truth,
 * predicted conversion or permission. Contact eligibility accepts no priority input at all: it
 * reuses the existing AVG-1 Core allowlist, so high priority cannot bypass suppression and low
 * priority cannot manufacture a Core refusal. Both remain pure offline-domain decisions.
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

export {
  AAROHI_ENRICHMENT_CONTRACT_VERSION,
  createEnrichmentClaim,
  ENRICHMENT_ATTRIBUTE_VALUE_KIND,
  ENRICHMENT_ATTRIBUTES,
  ENRICHMENT_CLAIM_REFUSALS,
  ENRICHMENT_EVIDENCE_QUALITIES,
  ENRICHMENT_SOURCE_KINDS,
  ENRICHMENT_VALUE_KINDS,
  enrichmentClaimIdentity,
  enrichmentClaimSchema,
  enrichmentSourceSchema,
  MAX_ENRICHMENT_LABEL_LENGTH,
  parseEnrichmentClaim,
  PRESENCE_SIGNALS,
} from './contracts/enrichment-claim.js';
export type {
  AarohiEnrichmentContractVersion,
  EnrichmentAttribute,
  EnrichmentClaim,
  EnrichmentClaimRefusal,
  EnrichmentClaimResult,
  EnrichmentEvidenceQuality,
  EnrichmentSource,
  EnrichmentSourceKind,
  EnrichmentValueKind,
  PresenceSignal,
} from './contracts/enrichment-claim.js';

export {
  createEnrichmentProfile,
  ENRICHMENT_CONSISTENCY_VERDICTS,
  ENRICHMENT_PROFILE_REFUSALS,
  enrichmentProfileSchema,
  MAX_ENRICHMENT_PROFILE_CLAIMS,
  parseEnrichmentProfile,
  summariseEnrichmentConsistency,
} from './contracts/enrichment-profile.js';
export type {
  EnrichmentAttributeSummary,
  EnrichmentConsistencySummary,
  EnrichmentConsistencyVerdict,
  EnrichmentProfile,
  EnrichmentProfileRefusal,
  EnrichmentProfileResult,
} from './contracts/enrichment-profile.js';

export {
  ENRICHMENT_REVIEW_OUTCOME,
  ENRICHMENT_REVIEW_REFUSALS,
  evaluateEnrichmentReviewReadiness,
} from './contracts/enrichment-review.js';
export type {
  EnrichmentReviewOutcome,
  EnrichmentReviewRefusal,
  EnrichmentReviewVerdict,
} from './contracts/enrichment-review.js';
export {
  AAROHI_AVG3_CONTRACT_VERSION,
  CONTACT_ELIGIBILITY_OUTCOME,
  CONTACT_ELIGIBILITY_REFUSALS,
  evaluateAcquisitionContactEligibility,
  evaluateProspectPriority,
  PROSPECT_PRIORITY_MAX_POINTS,
  PROSPECT_PRIORITY_REFUSALS,
} from './contracts/avg3-scoring-eligibility.js';
export type {
  AarohiAvg3ContractVersion,
  AcquisitionContactEligibilityVerdict,
  ContactEligibilityOutcome,
  ContactEligibilityRefusal,
  ProspectPriorityAssessment,
  ProspectPriorityRefusal,
  ProspectPriorityResult,
} from './contracts/avg3-scoring-eligibility.js';
