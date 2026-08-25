/**
 * The canonical JAO-6 proposal registry (ADR-0120).
 *
 * ### PRIVATE governance state
 *
 * Nothing in this file reaches a barrel except `describeJao6ProposalPolicies` and
 * `JAO6_PROPOSAL_POLICY_IDS`, both of which hand back detached primitives. The policy records, the
 * registry, the registry type and the parameter schemas are module-private and reachable only by
 * direct module path.
 *
 * That is the owner-review correction from PR #162. The first version exported the policy objects
 * and the registry creator, and `Object.freeze` is shallow, so a public caller could push onto
 * `allowedSubjectEntityTypes` and the canonical registry -- which returned the very same object --
 * would then honour the change. No `register`, `add` or `extend` was needed, and TypeScript's
 * `readonly` is erased at runtime and prevented none of it.
 *
 * Two independent closures now hold: the records are deeply frozen by construction, and there is no
 * public reference to them at all. Either would fix the finding; both mean a future barrel edit
 * cannot silently reopen it.
 *
 * Two definitions, parsed and frozen at module load, and no way to add a third at runtime. The
 * registry has a `lookup`; it has no `register`, `add`, `extend` or `override`, because a registry a
 * caller can write to is a policy a caller can author, and a policy a caller can author is not a
 * reviewed policy.
 *
 * ### Why the second definition is PLANNED and stays PLANNED
 *
 * `jao6.vendor-quotation-escalation` is declared but not active. It exists so that the refusal path
 * for a non-active policy is a real path over a real record rather than a synthetic fixture, and so
 * that adding a class later is visibly an act of review rather than an act of code.
 */
import type { z } from 'zod';

import {
  describeJao6Policy,
  freezeJao6Policy,
  jao6ProposalPolicySchema,
  jao6VendorFollowUpParametersSchema,
  type Jao6ProposalPolicy,
  type Jao6ProposalPolicyDescriptor,
} from './proposal-policy.js';

/**
 * The first-proof class: a vendor follow-up.
 *
 * Chosen because it proves the strongest boundary this slice has. Its execution would reach a
 * vendor, so it is `client-or-vendor-facing-communication`, which the approval matrix pairs with a
 * real human approval and which the contract refuses to pair with `none`. And a proposal to follow
 * up is exactly the artifact somebody would be tempted to read as permission to send -- so proving
 * that it is not is worth more than proving it for a class nobody would confuse.
 *
 * MODULE-PRIVATE. Not exported, from here or from any barrel.
 */
const VENDOR_FOLLOW_UP_POLICY: Jao6ProposalPolicy = freezeJao6Policy(
  jao6ProposalPolicySchema.parse({
    proposalPolicyId: 'jao6.vendor-follow-up',
    proposalPolicyVersion: 1,
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',

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

    policyReference: { policyId: 'vendor-follow-up-approval', policyVersion: 1 },

    communicationExecutionEligibilityRequired: true,

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Propose a governed vendor follow-up for human approval. Not permission to send.',
  }),
);

/**
 * A declared but INACTIVE class.
 *
 * Present so the non-active refusal is exercised against a real registry entry. It is refused
 * before any runtime is constructed or invoked. MODULE-PRIVATE.
 */
const VENDOR_QUOTATION_ESCALATION_POLICY: Jao6ProposalPolicy = freezeJao6Policy(
  jao6ProposalPolicySchema.parse({
    proposalPolicyId: 'jao6.vendor-quotation-escalation',
    proposalPolicyVersion: 1,
    availability: 'PLANNED',

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

    policyReference: { policyId: 'vendor-quotation-escalation-approval', policyVersion: 1 },

    communicationExecutionEligibilityRequired: true,

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Declared, not active. Escalating a stalled quotation needs its own review first.',
  }),
);

/** Every declared class. MODULE-PRIVATE. */
const POLICIES: readonly Jao6ProposalPolicy[] = Object.freeze([
  VENDOR_FOLLOW_UP_POLICY,
  VENDOR_QUOTATION_ESCALATION_POLICY,
]);

/**
 * The parameter schemas, keyed by policy identity. MODULE-PRIVATE.
 *
 * Kept out of the policy record on purpose. A `ZodType` is a framework object with mutable
 * internals: storing one on a governance record would make that record un-freezable in any honest
 * sense, and deep-freezing Zod's internals would break the library. A total map over the declared
 * keys, so a new class cannot silently inherit another class's parameter shape -- the map fails to
 * compile until it is given its own entry.
 */
const PARAMETER_SCHEMAS: Readonly<
  Record<'jao6.vendor-follow-up@1' | 'jao6.vendor-quotation-escalation@1', z.ZodType>
> = Object.freeze({
  'jao6.vendor-follow-up@1': jao6VendorFollowUpParametersSchema,
  'jao6.vendor-quotation-escalation@1': jao6VendorFollowUpParametersSchema,
});

function schemaKey(policy: Jao6ProposalPolicy): string {
  return `${policy.proposalPolicyId}@${String(policy.proposalPolicyVersion)}`;
}

/**
 * The parameter schema for one reviewed policy.
 *
 * Returns `null` rather than a permissive fallback: a class whose parameter shape nobody wrote is a
 * class nobody reviewed, and the caller turns that into a refusal.
 */
export function jao6ParameterSchemaFor(policy: Jao6ProposalPolicy): z.ZodType | null {
  const key = schemaKey(policy);
  return (PARAMETER_SCHEMAS as Readonly<Record<string, z.ZodType | undefined>>)[key] ?? null;
}

/** The declared policy ids, as detached primitives. Safe to export: strings copy by value. */
export const JAO6_PROPOSAL_POLICY_IDS: readonly string[] = Object.freeze(
  POLICIES.map((policy) => policy.proposalPolicyId),
);

/**
 * A DETACHED, primitive-only listing of the reviewed classes. PUBLIC.
 *
 * A fresh array of fresh descriptors on every call, sharing no reference with canonical execution.
 * Mutating what this returns changes nothing anywhere -- which is a stronger promise than asking a
 * caller not to, and the only kind worth making across a barrel.
 */
export function describeJao6ProposalPolicies(): readonly Jao6ProposalPolicyDescriptor[] {
  return Object.freeze(POLICIES.map(describeJao6Policy));
}

/** What a lookup found: the policy, the id with a different version, or nothing at all. */
export type Jao6RegistryLookup =
  | { readonly found: 'POLICY'; readonly policy: Jao6ProposalPolicy }
  | { readonly found: 'VERSION_MISMATCH' }
  | { readonly found: 'UNKNOWN' };

/**
 * Look up one policy by id AND version.
 *
 * There is deliberately no nearest match and no default: a proposal that names a policy nobody
 * reviewed must fail, not fall back to one somebody did. INTERNAL -- exported from this module and
 * from no barrel.
 */
export interface Jao6ProposalRegistry {
  lookup(proposalPolicyId: string, proposalPolicyVersion: number): Jao6RegistryLookup;
}

/** Build the canonical registry. Reads the module-private definitions and nothing else. */
export function createJao6ProposalRegistry(): Jao6ProposalRegistry {
  return Object.freeze({
    lookup(proposalPolicyId: string, proposalPolicyVersion: number): Jao6RegistryLookup {
      const byId = POLICIES.filter((policy) => policy.proposalPolicyId === proposalPolicyId);
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
