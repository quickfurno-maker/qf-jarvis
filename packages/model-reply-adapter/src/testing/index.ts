/**
 * `@qf-jarvis/model-reply-adapter/testing` — deterministic test support (QFJ-M4, ADR-0057).
 *
 * A SEPARATE subpath so the gateway/state fakes and synthetic fixtures can never become production
 * defaults. No real gateway, provider, network, key, or token.
 */
export {
  scriptedGatewayInvoker,
  rawStructuredGatewayInvoker,
  textModeGatewayInvoker,
  mismatchedProvenanceGatewayInvoker,
  refusingGatewayInvoker,
  throwingGatewayInvoker,
  clearReplyState,
  scriptedReplyStateReader,
  fixedClock,
  type ProvenanceOverride,
  type RecordingReplyStateReader,
} from './deterministic-model-gateway.js';
export { syntheticRelease, syntheticCitation, replyPlan, structuredReply } from './fixtures.js';
