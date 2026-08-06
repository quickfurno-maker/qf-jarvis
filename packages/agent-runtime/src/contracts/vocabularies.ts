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

/**
 * Closed channels. No real WhatsApp API and no web transport is implemented in this repository.
 *
 * ### A channel is a CONTEXT, not an authority and not a provider
 *
 * This value says where a turn arrived from. It says nothing about what may be done with it: the
 * gates that decide that — `humanTakeover`, `aiPaused`, `cancelled`, `dataClass`, `partyType`,
 * subject status — live on the conversation, not the channel. `INTERNAL` has always proved the
 * point: it names a context with no provider behind it at all.
 *
 * ### This is NOT `COMMUNICATION_CHANNELS`, and the separation is load-bearing
 *
 * `@qf-jarvis/contracts` owns a DIFFERENT vocabulary — `['whatsapp','sms','email','voice']` — naming
 * the channels a governed OUTBOUND communication request may be delivered on, by
 * n8n → QF Communications Runtime → provider → recipient. Its members are things a provider can
 * deliver TO.
 *
 * `WEB` must never appear there. A browser is not a delivery destination: nobody can push an
 * outbound message to a closed tab. Adding it would let `CommunicationRequestV1` request a delivery
 * through a chain that does not exist, and would drag a web turn into the eighteen-state
 * communication lifecycle's `provider-accepted` and `delivered` states — states that could then only
 * be asserted by inventing them. A test in `@qf-jarvis/contracts` asserts that refusal directly.
 *
 * ### WEB (JRW-0B, ADR-0092)
 *
 * `WEB` is the QuickFurno web concierge surface: the SAME governed Riya, reached through a different
 * interface. It adds no transport, no endpoint, no client and no credential — this repository holds
 * no HTTP conversation service, and the browser never reaches Jarvis directly. It exists so that an
 * inbound envelope can state truthfully where a turn came from.
 *
 * Nothing in production branches on this value, and a containment test keeps it that way. Riya's
 * behaviour kernel, prompt identity, model policy and knowledge path are identical across every
 * member of this set — which is what makes "the same Riya on another surface" a fact about the code
 * rather than an aspiration.
 */
export const RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL', 'WEB'] as const;
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
