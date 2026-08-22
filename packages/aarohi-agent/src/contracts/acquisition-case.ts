/**
 * The ACQUISITION CASE domain (AVG-1, ADR-0085).
 *
 * ### A case tracks AAROHI'S WORK, never the party's business state
 *
 * This is the distinction the whole file is built around. `CONTACT_APPROVED` says a human or Core
 * authorized outreach; it does not say a message was sent. `AWAITING_CORE_ACTIVATION` says Aarohi
 * has finished what it can do and is waiting; it does not say a payment happened.
 *
 * So there is deliberately no `VERIFIED_VENDOR`, no `PAYMENT_CONFIRMED` and no `ACTIVE_VENDOR` state
 * in this vocabulary. Those are QuickFurno Core's facts about a party, and a case state carrying one
 * would make this package a second source of vendor truth — the exact thing AVG-1 exists to prevent.
 * The one place Core's activation appears is as an OBSERVED external fact at the handoff boundary,
 * with authority explicitly attributed to Core.
 *
 * ### Terminal states are terminal
 *
 * A case that handed off, was refused or was closed does not reopen. Re-approaching a party after
 * Core said no is precisely the failure the existing-vendor gate exists to prevent, and a lifecycle
 * that allowed a terminal case to walk backwards would reintroduce it one transition at a time.
 *
 * ### No persistence
 *
 * AVG-1 defines the domain contract. Durable acquisition-case storage is not governed at
 * implementation level yet, so this package holds no store, no repository and no migration — only
 * pure transitions over frozen values.
 */
import { z } from 'zod';

import type { AcquisitionRefusalReason } from './existing-vendor-gate.js';

/**
 * Where Aarohi's work on this case has reached.
 *
 * Every value describes something AAROHI or an authorizing human did. None describes a commercial
 * or identity fact about the party — those belong to Core.
 */
export const ACQUISITION_CASE_STATES = [
  /** A candidate exists. Nothing has been checked and nothing may be sent. */
  'DISCOVERED',
  /** A Core existing-vendor lookup has been requested and has not resolved. */
  'ELIGIBILITY_PENDING',
  /** Core confirmed genuinely net-new. Aarohi may work the case; it still may not send anything. */
  'ELIGIBLE_NET_NEW',
  /** Core or a human authorized outreach. Authorization is not delivery. */
  'CONTACT_APPROVED',
  /** Aarohi's acquisition work is done and the case waits on Core's authoritative activation. */
  'AWAITING_CORE_ACTIVATION',
  /** Core confirmed ACTIVE and ownership moved to Anisha. Terminal. */
  'HANDED_OFF_TO_ANISHA',
  /** The gate refused, or Core suppressed contact. Terminal. */
  'REFUSED',
  /** Closed without conversion for any other governed reason. Terminal. */
  'CLOSED',
] as const;
export type AcquisitionCaseState = (typeof ACQUISITION_CASE_STATES)[number];

/** The states from which no transition is permitted. Named once, derived everywhere. */
export const TERMINAL_ACQUISITION_CASE_STATES: readonly AcquisitionCaseState[] = Object.freeze([
  'HANDED_OFF_TO_ANISHA',
  'REFUSED',
  'CLOSED',
]);

export function isTerminalAcquisitionCaseState(state: AcquisitionCaseState): boolean {
  return TERMINAL_ACQUISITION_CASE_STATES.includes(state);
}

/**
 * The permitted transitions.
 *
 * An ALLOWLIST, and total over the vocabulary: a state added without a transition entry does not
 * compile. Terminal states map to the empty list, so "terminal" is a property of this table rather
 * than a rule applied beside it.
 *
 * Note what is absent: nothing returns to `DISCOVERED`, and nothing leaves a terminal state. There
 * is no path that re-approaches a party the gate already refused.
 *
 * ### `HANDED_OFF_TO_ANISHA` is UNREACHABLE from this table, deliberately
 *
 * An earlier revision listed it as an ordinary transition out of `AWAITING_CORE_ACTIVATION`. That
 * was an authority bypass: a caller could reach the terminal handoff state through
 * `transitionAcquisitionCase` alone, supplying no Core activation attestation at all, and the
 * "happy path" spec did exactly that while claiming to prove the opposite.
 *
 * Only QuickFurno Core authoritatively confirming ACTIVE may end Aarohi ownership. A case-state
 * transition can never substitute for that truth, so the generic route is GONE rather than
 * discouraged: `completeCoreActiveHandoff` in `active-handoff.ts` is the only public path into this
 * state, and it requires the attestation. A comment asking callers to use it would have left the
 * bypass one call away.
 */
export const ACQUISITION_CASE_TRANSITIONS: Readonly<
  Record<AcquisitionCaseState, readonly AcquisitionCaseState[]>
> = Object.freeze({
  DISCOVERED: Object.freeze(['ELIGIBILITY_PENDING', 'REFUSED', 'CLOSED'] as const),
  ELIGIBILITY_PENDING: Object.freeze(['ELIGIBLE_NET_NEW', 'REFUSED', 'CLOSED'] as const),
  ELIGIBLE_NET_NEW: Object.freeze(['CONTACT_APPROVED', 'REFUSED', 'CLOSED'] as const),
  CONTACT_APPROVED: Object.freeze(['AWAITING_CORE_ACTIVATION', 'REFUSED', 'CLOSED'] as const),
  // NO handoff entry. Reaching `HANDED_OFF_TO_ANISHA` requires a Core ACTIVE attestation, which this
  // table cannot carry — so the only ordinary exits from the boundary are refusal and closure.
  AWAITING_CORE_ACTIVATION: Object.freeze(['REFUSED', 'CLOSED'] as const),
  HANDED_OFF_TO_ANISHA: Object.freeze([] as const),
  REFUSED: Object.freeze([] as const),
  CLOSED: Object.freeze([] as const),
});

/** Whether one transition is permitted. Pure lookup; invents nothing. */
export function canTransition(from: AcquisitionCaseState, to: AcquisitionCaseState): boolean {
  return ACQUISITION_CASE_TRANSITIONS[from].includes(to);
}

/** A frozen acquisition case. Aarohi's work record, never a vendor record. */
export interface AcquisitionCase {
  readonly caseRef: string;
  readonly prospectRef: string;
  readonly state: AcquisitionCaseState;
  /** Present only on `REFUSED`, and always closed. */
  readonly refusalReason?: AcquisitionRefusalReason | undefined;
}

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const acquisitionCaseSchema = z
  .object({
    caseRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    state: z.enum(ACQUISITION_CASE_STATES),
  })
  .strict();

/** Open a case. A new case always starts at `DISCOVERED` — nothing may be created mid-lifecycle. */
export function openAcquisitionCase(value: unknown): AcquisitionCase | undefined {
  const parsed = acquisitionCaseSchema.omit({ state: true }).safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return Object.freeze({
    caseRef: parsed.data.caseRef,
    prospectRef: parsed.data.prospectRef,
    state: 'DISCOVERED' as const,
  });
}

/** Why a transition was refused. Closed and content-free. */
export const CASE_TRANSITION_REFUSALS = [
  'TRANSITION_NOT_PERMITTED',
  'CASE_ALREADY_TERMINAL',
  'REFUSAL_REASON_REQUIRED',
  'REFUSAL_REASON_NOT_PERMITTED',
] as const;
export type CaseTransitionRefusal = (typeof CASE_TRANSITION_REFUSALS)[number];

export type CaseTransitionResult =
  | { readonly ok: true; readonly next: AcquisitionCase }
  | { readonly ok: false; readonly refusal: CaseTransitionRefusal };

/**
 * Advance a case through an ORDINARY lifecycle transition, or refuse.
 *
 * Returns a NEW frozen case rather than mutating: a case that could be edited in place would make
 * "terminal" advisory. A `REFUSED` transition must carry a reason, and no other transition may.
 *
 * This function CANNOT reach `HANDED_OFF_TO_ANISHA` from any state — the transition table has no
 * entry for it. Handing off requires Core's ACTIVE attestation and lives in
 * `completeCoreActiveHandoff`.
 */
export function transitionAcquisitionCase(
  current: AcquisitionCase,
  to: AcquisitionCaseState,
  refusalReason?: AcquisitionRefusalReason,
): CaseTransitionResult {
  if (isTerminalAcquisitionCaseState(current.state)) {
    // Checked before the table, so the message names the real problem rather than the symptom.
    return Object.freeze({ ok: false as const, refusal: 'CASE_ALREADY_TERMINAL' as const });
  }
  if (!canTransition(current.state, to)) {
    return Object.freeze({ ok: false as const, refusal: 'TRANSITION_NOT_PERMITTED' as const });
  }
  if (to === 'REFUSED' && refusalReason === undefined) {
    // A refusal nobody can explain is one nobody can audit.
    return Object.freeze({ ok: false as const, refusal: 'REFUSAL_REASON_REQUIRED' as const });
  }
  if (to !== 'REFUSED' && refusalReason !== undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REFUSAL_REASON_NOT_PERMITTED' as const,
    });
  }
  return Object.freeze({
    ok: true as const,
    next: Object.freeze({
      caseRef: current.caseRef,
      prospectRef: current.prospectRef,
      state: to,
      ...(refusalReason === undefined ? {} : { refusalReason }),
    }),
  });
}
