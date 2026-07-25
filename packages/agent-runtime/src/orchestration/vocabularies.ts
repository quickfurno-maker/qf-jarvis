/**
 * The closed vocabularies of the M2 Core decision and reply orchestration (QFJ-M2, ADR-0055).
 *
 * Closed proposal kinds, Core decision outcomes, and content-free reasons. There is no business-
 * mutation/tool-execution proposal and no ENABLED/send value — the orchestrator produces proposals
 * and obtains a Core decision, and sends nothing. The excluded vendor identifier appears nowhere.
 */

/** Closed orchestration proposal kinds. No business-mutation/tool-execution kind exists. */
export const ORCHESTRATION_PROPOSAL_KINDS = [
  'REPLY',
  'ESCALATE_TO_HUMAN',
  'REQUEST_CLARIFICATION',
  'NO_ACTION',
] as const;
export type OrchestrationProposalKind = (typeof ORCHESTRATION_PROPOSAL_KINDS)[number];

/** Closed QuickFurno Core decision outcomes. `ACCEPTED` means Core-approved, never sent/executed. */
export const CORE_DECISION_OUTCOMES = [
  'ACCEPTED',
  'REJECTED',
  'HUMAN_REVIEW_REQUIRED',
  'RETRY_LATER',
  'STALE_REVISION',
  'CORE_UNAVAILABLE',
] as const;
export type CoreDecisionOutcome = (typeof CORE_DECISION_OUTCOMES)[number];

/** The closed set of content-free orchestration reason codes. */
export const ORCHESTRATION_REASONS = [
  'orchestration-completed',
  'orchestration-envelope-invalid',
  'orchestration-human-takeover',
  'orchestration-ai-paused',
  'orchestration-scope-violation',
  'orchestration-human-only',
  'orchestration-data-class-unserviceable',
  'orchestration-privacy-gate-missing',
  'orchestration-subject-blocked',
  'orchestration-stale-revision',
  'orchestration-cancelled',
  'orchestration-knowledge-refused',
  'orchestration-model-unavailable',
  'orchestration-draft-invalid',
  'orchestration-evaluation-mismatch',
  'orchestration-invariant',
] as const;
export type OrchestrationReason = (typeof ORCHESTRATION_REASONS)[number];
