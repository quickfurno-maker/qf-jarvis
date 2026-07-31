/**
 * `@qf-jarvis/riya-agent` — the Riya client-sales behaviour surface (QFJ-S3-C, ADR-0067).
 *
 * Behaviour only. Every runtime mechanism it relies on — identity, actor↔party scope, assignment,
 * the conversation-state machine, the proposal boundary, the orchestration pipeline, the
 * ModelReplyPort, provenance — is owned by ADR-0054/0055/0057/0059/0066 and is REUSED here, never
 * reimplemented. This package exports no runtime, no router, no state machine and no port.
 *
 * It performs no model call, holds no credential, touches no transport, writes nothing, and returns
 * proposal REQUESTS that the merged boundary stamps `PENDING_CORE_VALIDATION`. QuickFurno Core
 * remains the only authority.
 */
export {
  RIYA_BEHAVIOUR_VERSION,
  CLIENT_SALES_INTENTS_FROZEN,
  classifyClientSalesIntent,
  isClientSalesSignals,
} from './contracts/sales-intent.js';
export type {
  ClientSalesIntent,
  ClientSalesSignals,
  RiyaBehaviourVersion,
} from './contracts/sales-intent.js';

export {
  createNeedDiscovery,
  DISCOVERY_COMPLETENESS_FROZEN,
  DISCOVERY_FIELDS_FROZEN,
} from './contracts/need-discovery.js';
export type {
  NeedDiscovery,
  NeedDiscoveryInput,
  DiscoveryCompleteness,
  DiscoveryField,
} from './contracts/need-discovery.js';

export { RiyaBehaviourError, RIYA_ERROR_CODES } from './contracts/errors.js';
export type { RiyaErrorCode } from './contracts/errors.js';

export {
  decideRiyaTurn,
  RIYA_ACTOR,
  RIYA_SUPPORTED_PARTY,
  RIYA_DISPOSITIONS_FROZEN,
} from './behaviour/decide-riya-turn.js';
export type {
  RiyaTurnInput,
  RiyaTurnDecision,
  RiyaDisposition,
} from './behaviour/decide-riya-turn.js';

export {
  createRiyaProposal,
  proposalKindFor,
  RIYA_PROPOSAL_INTENTS_FROZEN,
} from './behaviour/riya-proposals.js';
export type { RiyaProposalRequest, RiyaProposalIntent } from './behaviour/riya-proposals.js';
