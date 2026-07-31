/**
 * The client-sales behaviour input port (QFJ-S3-C-B, ADR-0068).
 *
 * Riya decides what a client-sales turn should lead to, but it cannot observe one: the signals it
 * reasons over are business facts QuickFurno Core owns, and nothing in this repository may invent
 * them. This port is the seam where those already-validated facts enter the composition — and it is
 * deliberately the narrowest shape that makes `decideRiyaTurn` callable at all.
 *
 * What it does NOT carry is the point of it. No actor or party type, so a supplier cannot make Riya
 * speak as Anisha or on a vendor conversation. No takeover, pause or cancellation, because conversation
 * control has exactly one authoritative source (ADR-0059 §C) and a second would be a split brain. No
 * inbound text, normalized text or provider payload, because classifying language here would move a
 * policy decision into infrastructure. No prompt body, no catalogue, no metadata bag.
 *
 * The port is OPTIONAL. When it is absent — as it is in every deployment today — the runtime takes the
 * legacy `REPLY` path unchanged. Defining the seam is not activating it.
 */
import type { ClientSalesSignals, NeedDiscovery } from '@qf-jarvis/riya-agent';

/** What the composition asks for: one conversation, at one exact revision. */
export interface ClientSalesBehaviourInputRequest {
  readonly conversationId: string;
  /** The revision the turn is bound to, so a stale answer is detectable rather than silently used. */
  readonly revision: number;
}

/**
 * The validated behaviour inputs for one turn.
 *
 * `promptRef` is an opaque reference into a prompt registry this package neither reads nor ships
 * (S3-I owns that); it names a prompt, it never contains one.
 */
export interface ClientSalesBehaviourInput {
  readonly signals: ClientSalesSignals;
  readonly needDiscovery?: NeedDiscovery;
  /** Opaque, 1–128 identifier characters. Never prompt text. */
  readonly promptRef: string;
}

/**
 * Supplies validated client-sales behaviour inputs, or `undefined` when this turn has none.
 *
 * Awaited — a real implementation reads across a boundary (ADR-0058 §1). It is called at most once per
 * turn, and only after the complete first gate has passed, so a paused, cancelled, privacy-blocked or
 * out-of-scope conversation triggers no read at all. It has no write, send or execute method.
 */
export interface ClientSalesBehaviourInputPort {
  read(request: ClientSalesBehaviourInputRequest): Promise<ClientSalesBehaviourInput | undefined>;
}
