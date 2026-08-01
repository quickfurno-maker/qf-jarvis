/**
 * `@qf-jarvis/agent-runtime` — the QFJ-M1 Agent and Conversation Runtime Foundation (ADR-0054).
 *
 * The smallest stable composition surface: the closed vocabularies, the envelope/context/proposal/
 * policy factories and types, the conversation-state machine and deterministic router, the runtime
 * factory and the authority-first `processInbound`, the injected privacy-gate/model-interface/
 * observability types, and the documented operations-center projection contract. It does NOT export
 * mutable internals or the test fixtures/gate (those live under `./testing`). The runtime coordinates
 * PROPOSALS ONLY — it authorizes, sends, and executes nothing; QuickFurno Core remains final authority.
 */

// Closed vocabularies.
export {
  RUNTIME_ACTORS,
  RUNTIME_PARTY_TYPES,
  RUNTIME_CHANNELS,
  RUNTIME_DIRECTIONS,
  CONVERSATION_STATES,
  RUNTIME_DATA_CLASSES,
  RUNTIME_EXECUTION_CLASSES,
  RUNTIME_PROPOSAL_KINDS,
  PROPOSAL_AUTHORITY_STATUS,
  RUNTIME_SUBJECT_STATUSES,
  RUNTIME_REASONS,
  AI_AGENT_ACTORS,
} from './contracts/vocabularies.js';
export type {
  RuntimeActor,
  RuntimePartyType,
  RuntimeChannel,
  RuntimeDirection,
  ConversationState,
  RuntimeDataClass,
  RuntimeExecutionClass,
  RuntimeProposalKind,
  ProposalAuthorityStatus,
  RuntimeSubjectStatus,
  RuntimeReason,
} from './contracts/vocabularies.js';

// Errors + scope.
export { AgentRuntimeError, RUNTIME_ERROR_CODES } from './contracts/errors.js';
export type { RuntimeErrorCode } from './contracts/errors.js';
export { isActorPartyCompatible, assertActorPartyCompatible } from './contracts/scope.js';

// Envelope / context / proposals / policy.
export { createInboundEnvelope } from './contracts/inbound-envelope.js';
export type { InboundEnvelope, InboundEnvelopeInput } from './contracts/inbound-envelope.js';
export { createConversationContext } from './contracts/conversation-context.js';
export type {
  ConversationContext,
  ConversationContextInput,
} from './contracts/conversation-context.js';
export { createProposal } from './contracts/proposals.js';
export type { RuntimeProposal } from './contracts/proposals.js';
export { createRuntimePolicy } from './contracts/policy.js';
export type { RuntimePolicy, RuntimePolicyInput, UnknownRouting } from './contracts/policy.js';

// Conversation-state machine + router.
export { isValidConversationTransition } from './contracts/conversation-state.js';
export type { TransitionOptions } from './contracts/conversation-state.js';
export { assignAgent } from './router/assign-agent.js';

// Privacy gate + observability + operations-center contract.
export type { ConversationPrivacyGate } from './contracts/privacy-gate.js';
export { NOOP_RUNTIME_OBSERVABILITY, RUNTIME_EVENT_TYPES } from './contracts/observability.js';
export type {
  RuntimeEvent,
  RuntimeEventType,
  RuntimeObservabilityHook,
} from './contracts/observability.js';
// QFJ-P08-A (ADR-0075): the snapshot gains `revision` and its first constructor. The constructor is
// the ONE new root runtime symbol in that phase; the operations center still has no dashboard, no
// persistence and no producer other than an injected authoritative projection.
export {
  CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS,
  createConversationOperationsSnapshot,
} from './contracts/operations-center.js';
export type {
  ConversationOperationsSnapshot,
  ConversationOperationsSnapshotField,
  ConversationOperationsSnapshotInput,
} from './contracts/operations-center.js';

// Runtime.
// QFJ-S3-B (ADR-0066): the provenance envelope and the shared agent-turn entry point.
export {
  createRuntimeProvenance,
  RUNTIME_PROVENANCE_VERSION,
  RUNTIME_PROVENANCE_AUTHORITY,
  RUNTIME_MODEL_OUTPUT_RETENTION,
} from './contracts/provenance.js';
export type {
  RuntimeProvenance,
  RuntimeProvenanceInput,
  RuntimeProvenanceVersion,
  RuntimeProvenanceAuthority,
  RuntimeModelOutputRetention,
} from './contracts/provenance.js';
export { runAgentTurn, SHARED_RUNTIME_VERSION } from './runtime/run-agent-turn.js';
export type {
  AgentTurnInput,
  AgentTurnResult,
  AgentTurnProvenanceRefs,
  SharedRuntimeVersion,
} from './runtime/run-agent-turn.js';

export { createAgentRuntime } from './runtime/create-agent-runtime.js';
export type {
  AgentRuntime,
  CreateAgentRuntimeConfig,
  RuntimeModelInterface,
} from './runtime/create-agent-runtime.js';
export { processInbound } from './runtime/process-inbound.js';
export type { RuntimeDecision } from './runtime/process-inbound.js';

// M2 — Core decision and reply orchestration (ADR-0055).
export * from './orchestration/index.js';
