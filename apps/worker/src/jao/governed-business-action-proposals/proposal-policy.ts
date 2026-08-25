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
 * So a policy is not passed in. It is NAMED by id and version, looked up in a frozen registry built
 * at module load, and refused if it is unknown, if the version does not match, or if it is not
 * active for this proof. A caller may choose WHICH reviewed policy applies. It may not author one.
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
  boundedText,
  machineTokenSchema,
  TEXT_LIMITS,
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
 * Strict and closed, and every field is deliberately NON-TRANSPORT. There is no channel, no
 * template body, no recipient, no phone number, no address and no provider: this proposal says a
 * follow-up is warranted, about what, and within which window. WHO is contacted and HOW is Core's
 * to resolve from its own records, against consent it owns, at execution time.
 *
 * A closed schema rather than a governed free-form object is the point. The canonical
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
  /** A short human-readable note for the approver. Bounded, and read by a person, not parsed. */
  approverNote: boundedText(TEXT_LIMITS.description),
});

/**
 * One reviewed proposal class.
 *
 * Every governance-bearing field lives here and nowhere else. `risk` and `requiredApproval` in
 * particular are read from this record and passed straight to the canonical recommendation runtime,
 * which then enforces the contract's own relationship between them.
 */
export interface Jao6ProposalPolicy {
  readonly proposalPolicyId: string;
  readonly proposalPolicyVersion: number;
  readonly availability: Jao6PolicyAvailability;

  /** The only agent identity permitted to produce this class, and its build. */
  readonly producingAgent: 'jarvis' | 'kabir' | 'riya' | 'anisha' | 'jitin';
  readonly producingAgentVersion: string;

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

  /** The exact, closed parameter schema. Not extensible by a caller. */
  readonly parameterSchema: z.ZodType;

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
 * violates the shape fails at import rather than at the first proposal. `parameterSchema` is a
 * `z.custom` because a Zod schema is not itself JSON-describable; everything governance-bearing
 * around it is a literal or a closed enum.
 */
export const jao6ProposalPolicySchema = z.strictObject({
  proposalPolicyId: machineTokenSchema,
  proposalPolicyVersion: z.number().int().min(1).max(1_000),
  availability: z.enum(JAO6_POLICY_AVAILABILITIES),

  producingAgent: z.enum(['jarvis', 'kabir', 'riya', 'anisha', 'jitin']),
  producingAgentVersion: machineTokenSchema,

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

  parameterSchema: z.custom<z.ZodType>((value) => value instanceof z.ZodType),

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
