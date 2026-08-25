/**
 * The JAO-6 static proposal policy (ADR-0120).
 *
 * ### Why the policy is a closed, versioned, reviewed record rather than a caller argument
 *
 * A proposal policy decides the class of thing being proposed, the class of action it would become,
 * how risky that is, and therefore WHO has to say yes. That last step is the whole reason the
 * approval matrix exists. A policy a caller could supply -- or extend, or edit -- would be a caller
 * choosing its own oversight, and it would not matter how carefully the rest of the pipeline was
 * validated afterwards, because the thing being validated would already be the caller's answer.
 *
 * So a policy is not passed in. It is NAMED by id and version, looked up in a private registry
 * built at module load, and refused if it is unknown, if the version does not match, or if it is
 * not active for this proof. A caller may choose WHICH reviewed policy applies. It may not author
 * one, and it may not reach one.
 *
 * ### Why the record is JSON-like, and deeply frozen by CONSTRUCTION
 *
 * Owner review of PR #162 found the first version publicly mutable. The records were built with
 * `Object.freeze(...)`, and `Object.freeze` is SHALLOW: `allowedSubjectEntityTypes`,
 * `allowedEvidenceTypes` and `policyReference` were live references on a frozen object, and the
 * registry handed back that same object. So this was enough to rewrite reviewed governance without
 * any `register`, `add` or `extend` ever existing:
 *
 *     (JAO6_VENDOR_FOLLOW_UP_POLICY.allowedSubjectEntityTypes as string[]).push('client');
 *
 * TypeScript's `readonly` is erased at runtime and stopped none of it.
 *
 * Two things changed. The canonical policy is now PRIVATE -- no barrel exports a policy object, a
 * registry, a registry type or a parameter schema -- and `freezeJao6Policy` rebuilds every nested
 * array and object as a fresh frozen value, so the record is immutable by construction rather than
 * by convention. Either alone would close the finding; both together mean a future barrel edit
 * cannot silently reopen it.
 *
 * ### Why Zod schemas are NOT stored on the policy record
 *
 * A `ZodType` is a framework object with mutable internals. Putting one on a governance record
 * makes that record un-freezable in any honest sense, and deep-freezing Zod's internals would break
 * the library. Parameter schemas therefore live in a separate PRIVATE lookup keyed by policy id and
 * version, and the governance record stays JSON-like.
 *
 * ### What availability means here
 *
 * `ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY` is the strongest state that exists in this slice. It does
 * not mean production-enabled: JAO-6 is imported by nothing in any production entry, creates no
 * approval decision and no execution intent, and reaches no Core, n8n, provider or channel.
 * `PLANNED` policies are declared so the shape of a second class is visible and so refusal on a
 * non-active policy can be proved -- they are refused before any runtime is invoked.
 */
import {
  machineTokenSchema,
  TEXT_LIMITS,
  boundedText,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import { z } from 'zod';

/** Availability. `PLANNED` is refused; there is no state that means "production". */
export const JAO6_POLICY_AVAILABILITIES = [
  'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
  'PLANNED',
] as const;

export type Jao6PolicyAvailability = (typeof JAO6_POLICY_AVAILABILITIES)[number];

/**
 * The exact parameter schema for the vendor follow-up action.
 *
 * Strict, closed, and every field is a CLOSED STRUCTURED VALUE. There is no channel, no template
 * body, no recipient, no phone number, no address and no provider: this proposal says a follow-up
 * is warranted, about what, and within which window. WHO is contacted and HOW is Core's to resolve
 * from its own records, against consent it owns, at execution time.
 *
 * ### Why there is no `approverNote`
 *
 * There was one, and owner review of PR #162 was right to remove it. The parsed parameter object
 * becomes `proposedActions[0].parameters` verbatim, so it is part of the final action bytes and
 * therefore part of the canonical fingerprint and of the exact action a human is later asked to
 * approve. A bounded free-text field there meant caller prose WAS in the executable action, which
 * contradicted the boundary this slice claims. A note for the approver belongs on the
 * recommendation's own `summary`, `rationale` and `evidence`, which a human reads and nothing
 * parses.
 *
 * A closed schema rather than a governed free-form object is the other half. The canonical
 * `actionParametersSchema` scans for credentials, contact details, raw payloads and model internals
 * at any depth and would catch the obvious smuggling -- but it permits keys it has never heard of,
 * and `canExecute`, `executor`, `n8n` and `webhookUrl` are keys it has never heard of. Here they
 * are simply not fields.
 */
export const jao6VendorFollowUpParametersSchema = z.strictObject({
  /** Why a follow-up is warranted, as a stable code an auditor can count. */
  followUpReasonCode: z.enum([
    'quotation-response-overdue',
    'sample-dispatch-unconfirmed',
    'catalogue-update-pending',
    'purchase-order-acknowledgement-missing',
  ]),
  /** What it is about. A closed taxonomy, not free text compiled into an action. */
  topicCode: z.enum(['quotation', 'sample-dispatch', 'catalogue', 'purchase-order']),
  /** The window within which the follow-up would be appropriate. Both bounds required. */
  earliestFollowUpAt: utcTimestampSchema,
  latestFollowUpAt: utcTimestampSchema,
});

/** The exact key set of the reviewed action parameters. Asserted by spec, not merely documented. */
export const JAO6_VENDOR_FOLLOW_UP_PARAMETER_KEYS: readonly string[] = Object.freeze([
  'earliestFollowUpAt',
  'followUpReasonCode',
  'latestFollowUpAt',
  'topicCode',
]);

/**
 * One reviewed proposal class.
 *
 * JSON-like on purpose: primitives, arrays of primitives, and one nested object of primitives.
 * Nothing here is a framework object, so `freezeJao6Policy` can make the whole record genuinely
 * immutable.
 *
 * ### Why there is no `producingAgent` on a policy
 *
 * There was, and it said `anisha`. Owner review of PR #162 called that provenance laundering, and
 * it was: this slice proves `specialistCalls = 0`. There is no Anisha invocation, no JAO-2
 * delegation result and no bound specialist output anywhere in it, so a recommendation stamped
 * `anisha` claimed a specialist produced something Jarvis assembled.
 *
 * Producer identity is PROVENANCE, not per-policy business semantics, so it is not a policy field
 * at all. The canonical composition stamps `jarvis` and its own reviewed producer version. That
 * removes the shape of the mistake rather than the instance of it: a future policy cannot name
 * `riya`, `anisha`, `kabir` or `jitin`, because there is nowhere to write it. Specialist
 * attribution requires a separately reviewed binding to exact governed specialist output.
 */
export interface Jao6ProposalPolicy {
  readonly proposalPolicyId: string;
  readonly proposalPolicyVersion: number;
  readonly availability: Jao6PolicyAvailability;

  /** Subject entity types this class may be about. A closed list, checked before assembly. */
  readonly allowedSubjectEntityTypes: readonly string[];

  readonly recommendationType: string;
  readonly actionType: string;
  readonly actionContractVersion: number;

  /** From the approved approval matrix. Never inferred, never caller-stated, never confidence-led. */
  readonly risk:
    | 'informational'
    | 'low-risk-reversible'
    | 'client-or-vendor-facing-communication'
    | 'outbound-voice-call'
    | 'money-related'
    | 'high-risk-or-novel';
  readonly requiredApproval:
    'none' | 'delegated-approver' | 'authorized-team-human' | 'stronger-approval' | 'founder';

  /** The ceiling on `expiresAt - createdAt`. An undecided recommendation expires; it never ripens. */
  readonly maxLifetimeSeconds: number;

  /** How many evidence items this class requires, and at most how many it will carry. */
  readonly minEvidenceItems: number;
  readonly maxEvidenceItems: number;
  /** The evidence discriminators this class accepts. */
  readonly allowedEvidenceTypes: readonly ('canonical-event' | 'derived-signal')[];

  /** The citation recorded on the approval request. A reference, never the policy's contents. */
  readonly policyReference: { readonly policyId: string; readonly policyVersion: number };

  /** True when execution would reach a client or a vendor, so a second yes is mandatory later. */
  readonly communicationExecutionEligibilityRequired: boolean;

  readonly rolloutPosture: 'OFFLINE_SHADOW_PROOF';
  readonly businessEffect: false;
  readonly productionMutation: false;

  readonly summary: string;
}

/**
 * The policy schema.
 *
 * The registry's own definitions are parsed through this at module load, so a definition that
 * violates the shape fails at import rather than at the first proposal. Every field is a literal, a
 * closed enum, a bounded number or a bounded string -- there is no `z.custom` and no framework
 * object anywhere in it.
 */
export const jao6ProposalPolicySchema = z.strictObject({
  proposalPolicyId: machineTokenSchema,
  proposalPolicyVersion: z.number().int().min(1).max(1_000),
  availability: z.enum(JAO6_POLICY_AVAILABILITIES),

  allowedSubjectEntityTypes: z.array(machineTokenSchema).min(1).max(8),

  recommendationType: machineTokenSchema,
  actionType: machineTokenSchema,
  actionContractVersion: z.number().int().min(1).max(1_000),

  risk: z.enum([
    'informational',
    'low-risk-reversible',
    'client-or-vendor-facing-communication',
    'outbound-voice-call',
    'money-related',
    'high-risk-or-novel',
  ]),
  requiredApproval: z.enum([
    'none',
    'delegated-approver',
    'authorized-team-human',
    'stronger-approval',
    'founder',
  ]),

  maxLifetimeSeconds: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 60 * 60),

  minEvidenceItems: z.number().int().min(1).max(50),
  maxEvidenceItems: z.number().int().min(1).max(50),
  allowedEvidenceTypes: z
    .array(z.enum(['canonical-event', 'derived-signal']))
    .min(1)
    .max(2),

  policyReference: z.strictObject({
    policyId: machineTokenSchema,
    policyVersion: z.number().int().min(1).max(1_000),
  }),

  communicationExecutionEligibilityRequired: z.boolean(),

  rolloutPosture: z.literal('OFFLINE_SHADOW_PROOF'),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),

  summary: boundedText(TEXT_LIMITS.summary),
});

/**
 * Freeze a parsed policy DEEPLY, by rebuilding every nested value.
 *
 * `Object.freeze` alone is shallow, which is exactly the defect owner review found. Each nested
 * array and object is copied into a fresh frozen value first, so nothing the parser produced -- and
 * nothing any earlier holder of an intermediate reference retained -- remains writable through this
 * record.
 *
 * The types are all JSON-like, so this terminates and needs no cycle guard: there is no framework
 * object, no function and no self-reference to walk into.
 */
export function freezeJao6Policy(policy: Jao6ProposalPolicy): Jao6ProposalPolicy {
  return Object.freeze({
    ...policy,
    allowedSubjectEntityTypes: Object.freeze([...policy.allowedSubjectEntityTypes]),
    allowedEvidenceTypes: Object.freeze([...policy.allowedEvidenceTypes]),
    policyReference: Object.freeze({ ...policy.policyReference }),
  });
}

/**
 * A DETACHED, primitive-only view of a reviewed policy.
 *
 * What an operator surface may see. Every call returns a fresh copy that canonical execution does
 * not share by reference, so mutating one changes nothing anywhere -- which is a stronger promise
 * than "please do not mutate this", and the only kind of promise worth making across a barrel.
 */
export interface Jao6ProposalPolicyDescriptor {
  readonly proposalPolicyId: string;
  readonly proposalPolicyVersion: number;
  readonly availability: Jao6PolicyAvailability;
  readonly recommendationType: string;
  readonly actionType: string;
  readonly actionContractVersion: number;
  readonly risk: string;
  readonly requiredApproval: string;
  readonly maxLifetimeSeconds: number;
  readonly communicationExecutionEligibilityRequired: boolean;
  readonly rolloutPosture: string;
  readonly summary: string;
}

/** Build the detached view. Primitives only: no array, no nested object, nothing shared. */
export function describeJao6Policy(policy: Jao6ProposalPolicy): Jao6ProposalPolicyDescriptor {
  return Object.freeze({
    proposalPolicyId: policy.proposalPolicyId,
    proposalPolicyVersion: policy.proposalPolicyVersion,
    availability: policy.availability,
    recommendationType: policy.recommendationType,
    actionType: policy.actionType,
    actionContractVersion: policy.actionContractVersion,
    risk: policy.risk,
    requiredApproval: policy.requiredApproval,
    maxLifetimeSeconds: policy.maxLifetimeSeconds,
    communicationExecutionEligibilityRequired: policy.communicationExecutionEligibilityRequired,
    rolloutPosture: policy.rolloutPosture,
    summary: policy.summary,
  });
}
