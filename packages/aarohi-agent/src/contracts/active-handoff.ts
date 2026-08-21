/**
 * The ACTIVE handoff BOUNDARY (AVG-1, ADR-0085).
 *
 * ### This defines the boundary. It does not execute the handoff.
 *
 * AVG-1 may define the contract; moving ownership is later work and is not implemented here. What
 * this file settles is the ONE question that must never be got wrong: what is allowed to count as
 * "Core confirmed ACTIVE".
 *
 * ### Only Core's authoritative confirmation counts
 *
 * The overlay names the substitutes and rules every one of them out: the trigger is Core's
 * authoritative confirmation, **never a provider receipt, a model's reading of a conversation, or a
 * message claiming payment.**
 *
 * So this module makes those unrepresentable rather than merely forbidden. `HandoffAttestation`
 * accepts a Core-attributed activation attestation and nothing else — there is no field a receipt
 * id, a model verdict, a delivery status or a conversation excerpt could occupy. A caller holding
 * only a WhatsApp receipt cannot construct a value this function accepts, which is a stronger
 * guarantee than a check that reads a field and rejects it.
 *
 * The closed `ActivationAuthority` vocabulary exists for the same reason: the non-Core members are
 * present precisely so a spec can prove they are refused, and so a future reader can see that the
 * substitutes were considered and rejected rather than forgotten.
 */
import { z } from 'zod';

/**
 * Who is asserting that a party is ACTIVE.
 *
 * Exactly one member may be believed. The rest are enumerated so their refusal is provable.
 */
export const ACTIVATION_AUTHORITIES = [
  /** QuickFurno Core. The only authority for registration, payment and activation. */
  'QUICKFURNO_CORE',
  /** A provider delivery/read receipt. Proves a message moved, nothing about a business. */
  'PROVIDER_RECEIPT',
  /** A model's reading of a conversation. Never an authority for a commercial fact. */
  'MODEL_INFERENCE',
  /** The party said they paid. A claim, not a confirmation. */
  'CONVERSATION_CLAIM',
  /** Aarohi's own campaign or case state. Circular by construction. */
  'AGENT_CASE_STATE',
] as const;
export type ActivationAuthority = (typeof ACTIVATION_AUTHORITIES)[number];

/** The one authority that may trigger handoff. Named once so no branch can widen it. */
export const HANDOFF_TRUSTED_AUTHORITY: ActivationAuthority = 'QUICKFURNO_CORE';

/** Every authority that may NOT. Derived as the complement, never restated. */
export const HANDOFF_REJECTED_AUTHORITIES: readonly ActivationAuthority[] = Object.freeze(
  ACTIVATION_AUTHORITIES.filter((one) => one !== HANDOFF_TRUSTED_AUTHORITY),
);

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * An attestation that a party is ACTIVE.
 *
 * `authority` is required and explicit. There is no default and no inference: an attestation that
 * did not say who is asserting it is not an attestation.
 */
export interface ActivationAttestation {
  readonly prospectRef: string;
  /** The opaque Core attestation token. Never a vendor id, never a payment reference. */
  readonly coreAttestationRef: string;
  readonly authority: ActivationAuthority;
  /** Whether the named authority asserts ACTIVE. */
  readonly active: boolean;
}

export const activationAttestationSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    coreAttestationRef: OPAQUE_REF,
    authority: z.enum(ACTIVATION_AUTHORITIES),
    active: z.boolean(),
  })
  .strict();

/** Why a handoff may not proceed. Closed and content-free. */
export const HANDOFF_REFUSAL_REASONS = [
  /** Something other than Core asserted activation. */
  'AUTHORITY_NOT_CORE',
  /** Core did not assert ACTIVE. */
  'CORE_DID_NOT_CONFIRM_ACTIVE',
  /** The attestation did not parse, or described a different prospect. */
  'ATTESTATION_INVALID',
  /** The case is not at the point where handoff is meaningful. */
  'CASE_NOT_AWAITING_ACTIVATION',
] as const;
export type HandoffRefusalReason = (typeof HANDOFF_REFUSAL_REASONS)[number];

export type HandoffReadiness =
  { readonly ready: true } | { readonly ready: false; readonly reason: HandoffRefusalReason };

/**
 * Decide whether the ACTIVE handoff boundary has been reached.
 *
 * Fails closed on every path. Authority is checked BEFORE the activation flag, so a provider receipt
 * claiming `active: true` is refused as a wrong authority rather than evaluated as a fact — the
 * order is the point, and a spec asserts it.
 *
 * This returns readiness only. It moves nothing and notifies nobody.
 */
export function evaluateHandoffReadiness(
  prospectRef: string,
  attestation: unknown,
): HandoffReadiness {
  const parsed = activationAttestationSchema.safeParse(attestation);
  if (!parsed.success) {
    return Object.freeze({ ready: false as const, reason: 'ATTESTATION_INVALID' as const });
  }
  if (parsed.data.prospectRef !== prospectRef) {
    return Object.freeze({ ready: false as const, reason: 'ATTESTATION_INVALID' as const });
  }
  if (parsed.data.authority !== HANDOFF_TRUSTED_AUTHORITY) {
    // Checked first: a non-Core assertion is not weak evidence of activation, it is none.
    return Object.freeze({ ready: false as const, reason: 'AUTHORITY_NOT_CORE' as const });
  }
  if (!parsed.data.active) {
    return Object.freeze({
      ready: false as const,
      reason: 'CORE_DID_NOT_CONFIRM_ACTIVE' as const,
    });
  }
  return Object.freeze({ ready: true as const });
}
