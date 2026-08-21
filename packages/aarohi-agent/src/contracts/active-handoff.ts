/**
 * The ACTIVE handoff (AVG-1, ADR-0085).
 *
 * ### Only Core's authoritative confirmation counts
 *
 * The overlay names the substitutes and rules every one of them out: the trigger is Core's
 * authoritative confirmation, **never a provider receipt, a model's reading of a conversation, or a
 * message claiming payment.**
 *
 * Two different mechanisms enforce that, and an earlier revision of this note conflated them:
 *
 * - Substitute EVIDENCE is unrepresentable. There is no field on `ActivationAttestation` that a
 *   receipt id, a model verdict, a delivery status or a conversation excerpt could occupy, and the
 *   schema is strict, so such a payload cannot arrive as an extra key either.
 * - Substitute AUTHORITY TOKENS are deliberately REPRESENTABLE, so each can be deterministically
 *   rejected and a spec can prove the rejection. `PROVIDER_RECEIPT`, `MODEL_INFERENCE`,
 *   `CONVERSATION_CLAIM` and `AGENT_CASE_STATE` exist precisely to be refused, and so a later reader
 *   can see the substitutes were considered rather than forgotten.
 *
 * Describing the authorities themselves as "unrepresentable" was simply wrong — they are enumerated
 * a few lines below.
 *
 * ### The handoff is the ONLY public route into the terminal state
 *
 * `ACQUISITION_CASE_TRANSITIONS` has no entry for `HANDED_OFF_TO_ANISHA`. That is not an oversight
 * and not a convention. An earlier revision allowed the generic transition out of
 * `AWAITING_CORE_ACTIVATION`, which let a caller reach the terminal state with no attestation at
 * all — an authority bypass, and one the "happy path" spec walked straight through while claiming to
 * prove the opposite.
 *
 * {@link completeCoreActiveHandoff} is now the only way in, and it cannot be called without both the
 * case and the attestation.
 */
import { z } from 'zod';

import { acquisitionCaseSchema } from './acquisition-case.js';
import type { AcquisitionCase } from './acquisition-case.js';

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
  /** The case has not reached the handoff boundary. */
  'CASE_NOT_AWAITING_ACTIVATION',
  /**
   * The supplied case did not describe a well-formed acquisition case.
   *
   * Its own reason rather than reusing `ATTESTATION_INVALID`, which would point a reader at the
   * wrong half of the input. Added narrowly, because no existing member says this.
   */
  'CASE_INVALID',
] as const;
export type HandoffRefusalReason = (typeof HANDOFF_REFUSAL_REASONS)[number];

/** The handoff result: a NEW frozen case, or a closed refusal reason. */
export type CoreActiveHandoffResult =
  | { readonly ok: true; readonly next: AcquisitionCase }
  | { readonly ok: false; readonly reason: HandoffRefusalReason };

/**
 * Complete the ACTIVE handoff: end Aarohi ownership and move the case to Anisha.
 *
 * The ONLY public path into `HANDED_OFF_TO_ANISHA`. It binds BOTH the acquisition case and Core's
 * activation attestation, so the terminal state cannot be reached by a caller holding only one of
 * them. That coupling is the whole correction: readiness and transition used to be two separate
 * concepts, and the gap between them was the bypass.
 *
 * ### The order of checks is the safety property
 *
 * The case must be AT the boundary before any attestation is weighed. A case that is not awaiting
 * activation is refused as `CASE_NOT_AWAITING_ACTIVATION` even when a perfectly valid Core
 * attestation says `active: true` — a valid attestation must never PROMOTE a case that had not
 * reached the handoff point, because that would let Core's truth about a party stand in for Aarohi
 * having done the acquisition work.
 *
 * Then authority before the activation flag, so a provider receipt claiming `active: true` is
 * refused as a wrong authority rather than evaluated as a fact.
 *
 * ### It executes nothing
 *
 * A pure domain transition over an ALREADY-SUPPLIED Core-derived attestation. It sends nothing,
 * notifies nobody, persists nothing, and calls no Core endpoint, no n8n, no provider and no model.
 * Obtaining the attestation is somebody else's job; believing it correctly is this function's.
 */
export function completeCoreActiveHandoff(
  current: AcquisitionCase,
  attestation: unknown,
): CoreActiveHandoffResult {
  // The case is validated too. This is a public boundary, and a malformed case reaching a terminal
  // transition is exactly the shape of thing that should fail rather than be trusted for being typed.
  const parsedCase = acquisitionCaseSchema
    .extend({ refusalReason: z.string().optional() })
    .safeParse(current);
  if (!parsedCase.success) {
    return Object.freeze({ ok: false as const, reason: 'CASE_INVALID' as const });
  }
  if (current.state !== 'AWAITING_CORE_ACTIVATION') {
    // BEFORE the attestation is read. A valid Core ACTIVE attestation may not promote a case that
    // never reached the boundary.
    return Object.freeze({
      ok: false as const,
      reason: 'CASE_NOT_AWAITING_ACTIVATION' as const,
    });
  }

  const parsed = activationAttestationSchema.safeParse(attestation);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, reason: 'ATTESTATION_INVALID' as const });
  }
  if (parsed.data.prospectRef !== current.prospectRef) {
    // An attestation about a different party is not weak evidence about this one — it is none.
    return Object.freeze({ ok: false as const, reason: 'ATTESTATION_INVALID' as const });
  }
  if (parsed.data.authority !== HANDOFF_TRUSTED_AUTHORITY) {
    return Object.freeze({ ok: false as const, reason: 'AUTHORITY_NOT_CORE' as const });
  }
  if (!parsed.data.active) {
    return Object.freeze({
      ok: false as const,
      reason: 'CORE_DID_NOT_CONFIRM_ACTIVE' as const,
    });
  }

  // Identity is preserved and nothing else travels: no vendor id, no payment reference, no receipt,
  // no delivery state, no model verdict, no conversation.
  return Object.freeze({
    ok: true as const,
    next: Object.freeze({
      caseRef: current.caseRef,
      prospectRef: current.prospectRef,
      state: 'HANDED_OFF_TO_ANISHA' as const,
    }),
  });
}
