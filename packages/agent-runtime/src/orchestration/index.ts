/**
 * The M2 Core decision and reply orchestration surface (QFJ-M2, ADR-0055).
 *
 * Re-exported from the package root. Exposes only stable ports, factories, result/proposal/decision
 * types, and safe events — no transport or persistence API, and no test fakes (those live under
 * `./testing`).
 */
export {
  ORCHESTRATION_PROPOSAL_KINDS,
  CORE_DECISION_OUTCOMES,
  ORCHESTRATION_REASONS,
} from './vocabularies.js';
export type {
  OrchestrationProposalKind,
  CoreDecisionOutcome,
  OrchestrationReason,
} from './vocabularies.js';

export {
  createOrchestrationContext,
  createOrchestrationProposal,
  coreDecision,
} from './contracts.js';
export type {
  OrchestrationContext,
  OrchestrationContextInput,
  OrchestrationProposal,
  OrchestrationProposalInput,
  ModelReleaseRef,
  KnowledgeCitation,
  ReplyPlan,
  ModelReplyDraft,
  CoreDecision,
  OrchestrationResult,
} from './contracts.js';

export type {
  ConversationContextPort,
  ModelReplyPort,
  KnowledgePort,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from './model-reply-port.js';
export type {
  CoreDecisionPort,
  CoreDecisionRequest,
  CoreDecisionResponse,
} from './core-decision-port.js';

export { createReplyPlan } from './create-reply-plan.js';
export { validateReplyDraft } from './validate-reply-draft.js';
export type { ReplyDraftValidation } from './validate-reply-draft.js';

export { createOrchestrator, orchestrateInbound } from './orchestrate-inbound.js';
export type { Orchestrator, OrchestratorConfig } from './orchestrate-inbound.js';

// The generic behaviour seam (ADR-0068). Types only — no runtime symbol reaches the root.
export type {
  BehaviourDecision,
  BehaviourDecisionPort,
  BehaviourDecisionRequest,
} from './behaviour-port.js';

export { NOOP_ORCHESTRATION_OBSERVABILITY, ORCHESTRATION_EVENT_TYPES } from './observability.js';
export type {
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationObservabilityHook,
} from './observability.js';
