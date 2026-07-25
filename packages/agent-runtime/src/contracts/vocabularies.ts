/**
 * The closed vocabularies of the authority-first agent/conversation runtime (QFJ-M1, ADR-0054).
 *
 * Every categorical value an envelope, conversation, proposal, or event may carry is one of these
 * fixed sets — no open-ended enum, no arbitrary metadata, no wildcard. The excluded vendor identifier
 * appears nowhere. There is no ENABLED/live-send value: the runtime coordinates proposals only.
 */

/** Closed actors. Riya=client, Anisha=vendor, Jarvis=coordination, plus HUMAN and SYSTEM. */
export const RUNTIME_ACTORS = ['RIYA', 'ANISHA', 'JARVIS', 'HUMAN', 'SYSTEM'] as const;
export type RuntimeActor = (typeof RUNTIME_ACTORS)[number];

/** Closed party types. */
export const RUNTIME_PARTY_TYPES = ['CLIENT', 'VENDOR', 'UNKNOWN'] as const;
export type RuntimePartyType = (typeof RUNTIME_PARTY_TYPES)[number];

/** Closed channels (initial). No real WhatsApp API is implemented in this slice. */
export const RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL'] as const;
export type RuntimeChannel = (typeof RUNTIME_CHANNELS)[number];

/** Closed message directions. */
export const RUNTIME_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type RuntimeDirection = (typeof RUNTIME_DIRECTIONS)[number];

/** Closed conversation runtime states. */
export const CONVERSATION_STATES = [
  'NEW',
  'ACTIVE_AI',
  'WAITING_EXTERNAL',
  'FOLLOW_UP_DUE',
  'ESCALATED',
  'HUMAN_TAKEOVER',
  'CLOSED',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

/** Closed data classes (mirrors the model/knowledge data-class lattice). */
export const RUNTIME_DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
export type RuntimeDataClass = (typeof RUNTIME_DATA_CLASSES)[number];

/** The execution class a candidate model interface serves (mirrors the gateway). */
export const RUNTIME_EXECUTION_CLASSES = ['HOSTED', 'LOCAL'] as const;
export type RuntimeExecutionClass = (typeof RUNTIME_EXECUTION_CLASSES)[number];

/** Closed proposal kinds. Every proposal is a proposal only — never an executed action. */
export const RUNTIME_PROPOSAL_KINDS = [
  'AGENT_ASSIGNMENT',
  'REPLY',
  'FOLLOW_UP',
  'ESCALATION',
  'TOOL_INTENT',
] as const;
export type RuntimeProposalKind = (typeof RUNTIME_PROPOSAL_KINDS)[number];

/** The ONLY authority status a runtime proposal may carry: it awaits QuickFurno Core validation. */
export const PROPOSAL_AUTHORITY_STATUS = 'PENDING_CORE_VALIDATION' as const;
export type ProposalAuthorityStatus = typeof PROPOSAL_AUTHORITY_STATUS;

/** The closed subject-privacy statuses an injected privacy gate may report. Only `clear` proceeds. */
export const RUNTIME_SUBJECT_STATUSES = [
  'clear',
  'erased',
  'anonymised',
  'tombstoned',
  'in-progress',
] as const;
export type RuntimeSubjectStatus = (typeof RUNTIME_SUBJECT_STATUSES)[number];

/** The closed set of content-free runtime reason codes. */
export const RUNTIME_REASONS = [
  'runtime-assigned',
  'runtime-envelope-invalid',
  'runtime-scope-violation',
  'runtime-privacy-gate-missing',
  'runtime-subject-blocked',
  'runtime-human-takeover',
  'runtime-ai-paused',
  'runtime-human-only',
  'runtime-data-class-unserviceable',
  'runtime-invalid-transition',
  'runtime-escalation-required',
  'runtime-invariant',
] as const;
export type RuntimeReason = (typeof RUNTIME_REASONS)[number];

/** Actors that are AI agents eligible to draft a reply (HUMAN and SYSTEM are not). */
export const AI_AGENT_ACTORS: ReadonlySet<RuntimeActor> = new Set(['RIYA', 'ANISHA', 'JARVIS']);
