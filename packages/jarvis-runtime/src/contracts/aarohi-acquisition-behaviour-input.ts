/**
 * The Aarohi acquisition behaviour input port (JF-4C, ADR-0150).
 *
 * The third sibling of `ClientSalesBehaviourInputPort` and `VendorJourneyBehaviourInputPort`, and
 * deliberately the narrowest of the three.
 *
 * ### What it carries, and why it is only this
 *
 * Four already-certified Aarohi artifacts and an opaque prompt reference. Nothing is interpreted here
 * and nothing is composed: the artifacts are passed to `evaluateAarohiSalesTurn`, which re-parses
 * every one of them through the AVG-7 contract's own schemas, re-runs the AVG-1 Core gate, and
 * derives the strategy itself.
 *
 * They arrive as `unknown` on purpose. Typing them as the AVG-7 interfaces would invite this package
 * to believe a caller's cast, and AVG-7's whole design is that it re-proves what it is handed — the
 * conversation binding, the latest-turn binding, the causal chain and the current Core gate are all
 * re-derived rather than trusted. A pre-narrowed type here would be a second, weaker gate in front of
 * the real one.
 *
 * ### What it deliberately does NOT carry
 *
 * No actor and no party type, so a supplier cannot make Aarohi speak as Riya or on a vendor
 * conversation. No takeover, pause or cancellation: conversation control has exactly one
 * authoritative source (ADR-0059 §C), and this port is not it. No inbound or normalized text, no
 * provider payload, no data class.
 *
 * And nothing QuickFurno Core owns as truth: no vendor identity, no registration status, no payment
 * fact, no ACTIVE flag, no consent decision and no activation attestation. The Core OBSERVATION it
 * passes through is re-run through AVG-1's gate by the evaluator; it is evidence to be re-proved, not
 * a verdict to be accepted.
 *
 * ### The port is OPTIONAL, and absent in every deployment today
 *
 * When it is absent, a `PROSPECT` turn reaches no Aarohi adapter and takes the legacy default exactly
 * as an unconfigured VENDOR turn does. Defining the seam is not activating it, and this slice ships no
 * supplier of any kind — the authoritative source of these artifacts is a future QuickFurno/Core
 * adapter, after JF-7 freezes that contract.
 */

/**
 * What the composition asks for: one TENANT-SCOPED conversation, at one exact revision.
 *
 * Identical in shape to the vendor request, and for the identical reason (ADR-0076): `conversationId`
 * is not globally unique, so a supplier handed only a conversation id could return another tenant's
 * artifacts. The tenant is the already-validated one from the inbound envelope.
 */
export interface AarohiAcquisitionBehaviourInputRequest {
  readonly tenantId: string;
  readonly conversationId: string;
  /** The revision the turn is bound to, so a stale answer is detectable rather than silently used. */
  readonly revision: number;
}

/**
 * The already-certified Aarohi artifacts for one acquisition turn.
 *
 * Each is re-parsed and re-proved by `evaluateAarohiSalesTurn`. This package validates only the
 * opaque reference grammar it shares with the rest of the composition; every business rule stays in
 * the Aarohi contract that owns it.
 */
export interface AarohiAcquisitionBehaviourInput {
  /** AVG-7's own artifact identity for this plan. Opaque, 1–128 identifier characters. */
  readonly planRef: string;
  /** A canonical AVG-5 Instagram conversation snapshot. Re-parsed by AVG-7. */
  readonly conversation: unknown;
  /** An injected, model-SHAPED AVG-7 reading of the CURRENT inbound turn. Re-parsed by AVG-7. */
  readonly interpretation: unknown;
  /** A CURRENT Core observation. Re-run through the AVG-1 existing-vendor gate by AVG-7. */
  readonly coreObservation: unknown;
  /** The semantic UTC instant this plan is made at. Checked against the causal chain by AVG-7. */
  readonly plannedAt: string;
  /** Opaque, 1–128 identifier characters. Names a prompt; never contains one. */
  readonly promptRef: string;
}

/**
 * Supplies certified Aarohi acquisition artifacts, or `undefined` when this turn has none.
 *
 * Awaited — a real implementation reads across a boundary (ADR-0058 §1). It is called at most once per
 * turn, only for a `PROSPECT` turn assigned to `AAROHI`, and only after the complete first gate has
 * passed, so a paused, cancelled, privacy-blocked or out-of-scope conversation triggers no read at
 * all. It has no write, send or execute method.
 */
export interface AarohiAcquisitionBehaviourInputPort {
  read(
    request: AarohiAcquisitionBehaviourInputRequest,
  ): Promise<AarohiAcquisitionBehaviourInput | undefined>;
}
