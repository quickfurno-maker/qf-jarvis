/**
 * The JAO-6 public surface (ADR-0120).
 *
 * Proposal construction only, and non-authoritative. There is no `approve`, `authorize`, `decide`,
 * `submit`, `execute`, `send`, `dispatch` or `remediate` on it; no way to create an
 * `ApprovalDecisionV1` or an `ExecutionIntentV1`; and no way to supply a recommendation runtime, an
 * approval runtime, a policy registry, a fingerprint function or a mapper.
 *
 * `proposeJao6BusinessActionInternal` and `Jao6InternalComposition` are deliberately NOT exported.
 * The internal seam exists for trusted source-level and test composition, and a spec asserts both
 * names are absent from this barrel -- by name, by barrel key and by source scan.
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
  JAO6_REFUSAL_REASONS,
  Jao6ProposalError,
  jao6PostureSchema,
  jao6ProposalRequestSchema,
} from './contracts.js';
export type {
  Jao6Outcome,
  Jao6Posture,
  Jao6ProposalRequest,
  Jao6ProposalResult,
  Jao6RefusalReason,
} from './contracts.js';

export {
  JAO6_POLICY_AVAILABILITIES,
  jao6ProposalPolicySchema,
  jao6VendorFollowUpParametersSchema,
} from './proposal-policy.js';
export type { Jao6PolicyAvailability, Jao6ProposalPolicy } from './proposal-policy.js';

export {
  JAO6_PROPOSAL_POLICIES,
  JAO6_PROPOSAL_POLICY_IDS,
  JAO6_VENDOR_FOLLOW_UP_POLICY,
  JAO6_VENDOR_QUOTATION_ESCALATION_POLICY,
  createJao6ProposalRegistry,
} from './proposal-registry.js';
export type { Jao6ProposalRegistry, Jao6RegistryLookup } from './proposal-registry.js';

export { proposeJao6BusinessAction } from './proposal-composition.js';
