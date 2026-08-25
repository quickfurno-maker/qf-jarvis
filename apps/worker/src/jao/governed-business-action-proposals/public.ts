/**
 * The JAO-6 public surface (ADR-0120).
 *
 * Proposal construction only, and non-authoritative. There is no `approve`, `authorize`, `decide`,
 * `submit`, `execute`, `send`, `dispatch` or `remediate` on it; no way to create an
 * `ApprovalDecisionV1` or an `ExecutionIntentV1`; and no way to supply a recommendation runtime, an
 * approval runtime, a policy registry, a fingerprint function or a mapper.
 *
 * ### What is deliberately NOT here, and why
 *
 * The canonical POLICY and REGISTRY are private governance state. Owner review of PR #162 found the
 * first version exporting `JAO6_VENDOR_FOLLOW_UP_POLICY`, `JAO6_PROPOSAL_POLICIES`,
 * `createJao6ProposalRegistry`, the registry types, the policy type and the parameter schema -- and
 * `Object.freeze` is SHALLOW, so a public caller could push onto a nested
 * `allowedSubjectEntityTypes` and the canonical registry, which returned that very object, would
 * honour the change. No `register`, `add` or `extend` was needed, and TypeScript's `readonly` is
 * erased at runtime and prevented none of it.
 *
 * So none of those names is exported. Introspection is served by `describeJao6ProposalPolicies`,
 * which returns a FRESH, DETACHED, primitive-only copy on every call -- nothing it hands back is
 * shared with canonical execution, so mutating it changes nothing anywhere. That is a stronger
 * promise than asking a caller not to, and the only kind worth making across a barrel.
 *
 * `proposeJao6BusinessActionInternal` and `Jao6InternalComposition` are not exported either. The
 * internal seam exists for trusted source-level and test composition, and a spec asserts every one
 * of these names is absent -- by name, by barrel key and by source scan.
 *
 * The public entry point takes ONE argument, so there is no dependency object through which a
 * hostile runtime could be smuggled. That is composition pinning: an optional dependency defaulted
 * with `??` is a pin only until somebody passes a value, and a brand can be copied as easily as a
 * descriptor. A parameter that does not exist cannot be displaced.
 */
export {
  JAO6_EXECUTION_ELIGIBILITY_NOTICE,
  JAO6_OUTCOMES,
  JAO6_POSTURE,
  JAO6_PRODUCER_VERSION,
  JAO6_PRODUCING_AGENT,
  JAO6_REFUSAL_REASONS,
  Jao6ProposalError,
  jao6PostureSchema,
  jao6ProposalRequestSchema,
  jao6ProposalResultSchema,
} from './contracts.js';
export type {
  Jao6Outcome,
  Jao6Posture,
  Jao6ProposalReadyResult,
  Jao6ProposalRefusedResult,
  Jao6ProposalRequest,
  Jao6ProposalResult,
  Jao6ProposalResultCommon,
  Jao6RefusalReason,
} from './contracts.js';

// Availability is a closed vocabulary of strings, so exporting it shares no reference. The policy
// TYPE, the policy SCHEMA and the parameter SCHEMA are not exported: the first two describe private
// governance state, and the third is a framework object with mutable internals.
export { JAO6_POLICY_AVAILABILITIES } from './proposal-policy.js';
export type { Jao6PolicyAvailability, Jao6ProposalPolicyDescriptor } from './proposal-policy.js';

// Detached introspection only. `JAO6_PROPOSAL_POLICY_IDS` is a frozen array of primitives, and
// `describeJao6ProposalPolicies` builds fresh primitive-only descriptors on every call.
export { JAO6_PROPOSAL_POLICY_IDS, describeJao6ProposalPolicies } from './proposal-registry.js';

export { proposeJao6BusinessAction } from './proposal-composition.js';
