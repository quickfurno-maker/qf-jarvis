/**
 * The vendor-journey behaviour input port (QFJ-S3-D-B, ADR-0071).
 *
 * Anisha decides what a vendor-journey turn should lead to, but she cannot observe one: the signals
 * she reasons over are business facts QuickFurno Core owns, and nothing in this repository may invent
 * them. This port is the seam where those already-validated facts enter the composition — the vendor
 * twin of `ClientSalesBehaviourInputPort`, and deliberately just as narrow.
 *
 * What it does NOT carry is the point of it. No actor or party type, so a supplier cannot make Anisha
 * speak as Riya or on a client conversation. No takeover, pause or cancellation, because conversation
 * control has exactly one authoritative source (ADR-0059 §C) and a second would be a split brain. No
 * inbound or normalized text, no provider payload — classifying language here would move a policy
 * decision into infrastructure. And nothing Core owns: no vendor identity, profile, document,
 * portfolio, verification body, lead, package catalogue, price, balance, credits, payment,
 * subscription, ranking, assignment or campaign data. Money reaches Anisha as a band inside the
 * signals, never as an amount (ADR-0070 §4).
 *
 * The port is OPTIONAL. When it is absent — as it is in every deployment today — VENDOR turns take
 * the legacy `REPLY` path unchanged. Defining the seam is not activating it, and this PR ships no
 * supplier of any kind.
 */
import type { VendorJourneyContext, VendorJourneySignals } from '@qf-jarvis/anisha-agent';

/**
 * What the composition asks for: one TENANT-SCOPED conversation, at one exact revision.
 *
 * `tenantId` is required since QFJ-P08-B1 (ADR-0076), which ratified that `conversationId` is NOT
 * globally unique. A supplier handed only a conversation id has nothing with which to select the
 * right tenant's business facts, so two tenants sharing one conversation id could receive each
 * other's signals. The tenant is the already-validated one from the inbound envelope -- this seam
 * never derives it from the supplied facts, and never from what the state source returned.
 *
 * Scoping this request does NOT merge business facts into authoritative control state: the two seams
 * stay separate by design, and this one still supplies Core-owned facts only.
 */
export interface VendorJourneyBehaviourInputRequest {
  readonly tenantId: string;
  readonly conversationId: string;
  /** The revision the turn is bound to, so a stale answer is detectable rather than silently used. */
  readonly revision: number;
}

/**
 * The validated behaviour inputs for one vendor turn.
 *
 * `promptRef` is an opaque reference into a prompt registry this package neither reads nor ships
 * (S3-I owns that); it names a prompt, it never contains one.
 */
export interface VendorJourneyBehaviourInput {
  readonly signals: VendorJourneySignals;
  readonly context?: VendorJourneyContext;
  /** Opaque, 1–128 identifier characters. Never prompt text. */
  readonly promptRef: string;
}

/**
 * Supplies validated vendor-journey behaviour inputs, or `undefined` when this turn has none.
 *
 * Awaited — a real implementation reads across a boundary (ADR-0058 §1). It is called at most once
 * per turn, only for a VENDOR turn assigned to ANISHA, and only after the complete first gate has
 * passed, so a paused, cancelled, privacy-blocked or out-of-scope conversation triggers no read at
 * all. It has no write, send or execute method.
 */
export interface VendorJourneyBehaviourInputPort {
  read(
    request: VendorJourneyBehaviourInputRequest,
  ): Promise<VendorJourneyBehaviourInput | undefined>;
}
