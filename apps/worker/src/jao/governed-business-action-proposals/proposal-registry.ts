/**
 * The canonical JAO-6 proposal registry (ADR-0120).
 *
 * Two definitions, parsed and frozen at module load, and no way to add a third at runtime. The
 * registry has a `lookup`; it has no `register`, no `add`, no `extend` and no `override`, because a
 * registry a caller can write to is a policy a caller can author, and a policy a caller can author
 * is not a reviewed policy.
 *
 * ### Why the second definition is PLANNED and stays PLANNED
 *
 * `jao6.vendor-quotation-escalation.v1` is declared but not active. It exists so that the refusal
 * path for a non-active policy is a real path over a real record rather than a synthetic fixture,
 * and so that adding a class later is visibly an act of review rather than an act of code.
 */
import {
  jao6ProposalPolicySchema,
  jao6VendorFollowUpParametersSchema,
  type Jao6ProposalPolicy,
} from './proposal-policy.js';

/**
 * The first-proof class: a vendor follow-up.
 *
 * Chosen because it proves the strongest boundary this slice has. Its execution would reach a
 * vendor, so it is `client-or-vendor-facing-communication`, which the approval matrix pairs with a
 * real human approval and which the contract refuses to pair with `none`. And a proposal to follow
 * up is exactly the artifact somebody would be tempted to read as permission to send -- so proving
 * that it is not is worth more than proving it for a class nobody would confuse.
 */
export const JAO6_VENDOR_FOLLOW_UP_POLICY: Jao6ProposalPolicy = Object.freeze(
  jao6ProposalPolicySchema.parse({
    proposalPolicyId: 'jao6.vendor-follow-up',
    proposalPolicyVersion: 1,
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',

    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',

    allowedSubjectEntityTypes: ['vendor'],

    recommendationType: 'vendor.follow-up',
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,

    // From the approved matrix, and from nowhere else. Not inferred from `actionType`, not derived
    // from confidence, not restated by a caller.
    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'authorized-team-human',

    // Three days. An undecided proposal expires; silence is never consent.
    maxLifetimeSeconds: 3 * 24 * 60 * 60,

    minEvidenceItems: 1,
    maxEvidenceItems: 8,
    allowedEvidenceTypes: ['canonical-event', 'derived-signal'],

    parameterSchema: jao6VendorFollowUpParametersSchema,

    policyReference: { policyId: 'vendor-follow-up-approval', policyVersion: 1 },

    communicationExecutionEligibilityRequired: true,

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Propose a governed vendor follow-up for human approval. Not permission to send.',
  }) as Jao6ProposalPolicy,
);

/**
 * A declared but INACTIVE class.
 *
 * Present so the non-active refusal is exercised against a real registry entry. It is refused
 * before any runtime is constructed or invoked.
 */
export const JAO6_VENDOR_QUOTATION_ESCALATION_POLICY: Jao6ProposalPolicy = Object.freeze(
  jao6ProposalPolicySchema.parse({
    proposalPolicyId: 'jao6.vendor-quotation-escalation',
    proposalPolicyVersion: 1,
    availability: 'PLANNED',

    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',

    allowedSubjectEntityTypes: ['vendor'],

    recommendationType: 'vendor.quotation-escalation',
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,

    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'stronger-approval',

    maxLifetimeSeconds: 2 * 24 * 60 * 60,

    minEvidenceItems: 2,
    maxEvidenceItems: 8,
    allowedEvidenceTypes: ['canonical-event'],

    parameterSchema: jao6VendorFollowUpParametersSchema,

    policyReference: { policyId: 'vendor-quotation-escalation-approval', policyVersion: 1 },

    communicationExecutionEligibilityRequired: true,

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Declared, not active. Escalating a stalled quotation needs its own review first.',
  }) as Jao6ProposalPolicy,
);

/** Every declared class, in a frozen array. */
export const JAO6_PROPOSAL_POLICIES: readonly Jao6ProposalPolicy[] = Object.freeze([
  JAO6_VENDOR_FOLLOW_UP_POLICY,
  JAO6_VENDOR_QUOTATION_ESCALATION_POLICY,
]);

/** Their ids, for a containment spec that asserts the set has not grown quietly. */
export const JAO6_PROPOSAL_POLICY_IDS: readonly string[] = Object.freeze(
  JAO6_PROPOSAL_POLICIES.map((policy) => policy.proposalPolicyId),
);

/**
 * Look up one policy by id AND version.
 *
 * Returns `null` for an unknown id and `undefined`-free results otherwise; the caller turns those
 * into the right refusal code. There is deliberately no nearest match and no default: a proposal
 * that names a policy nobody reviewed must fail, not fall back to one somebody did.
 */
export interface Jao6ProposalRegistry {
  lookup(proposalPolicyId: string, proposalPolicyVersion: number): Jao6RegistryLookup;
}

/** What a lookup found: the policy, the id with a different version, or nothing at all. */
export type Jao6RegistryLookup =
  | { readonly found: 'POLICY'; readonly policy: Jao6ProposalPolicy }
  | { readonly found: 'VERSION_MISMATCH' }
  | { readonly found: 'UNKNOWN' };

/** Build the canonical registry. Reads the frozen module-level definitions and nothing else. */
export function createJao6ProposalRegistry(): Jao6ProposalRegistry {
  return Object.freeze({
    lookup(proposalPolicyId: string, proposalPolicyVersion: number): Jao6RegistryLookup {
      const byId = JAO6_PROPOSAL_POLICIES.filter(
        (policy) => policy.proposalPolicyId === proposalPolicyId,
      );
      if (byId.length === 0) {
        return { found: 'UNKNOWN' };
      }
      const exact = byId.find((policy) => policy.proposalPolicyVersion === proposalPolicyVersion);
      if (exact === undefined) {
        return { found: 'VERSION_MISMATCH' };
      }
      return { found: 'POLICY', policy: exact };
    },
  });
}
