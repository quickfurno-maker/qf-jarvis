/**
 * The actor ↔ party scope rule (QFJ-M1, ADR-0054 §C).
 *
 * Riya may act ONLY on a CLIENT party; Anisha ONLY on a VENDOR party; Aarohi ONLY on a PROSPECT
 * party. Jarvis (coordination), Human, and System may act on any party. This is the single boundary
 * that keeps each business agent to its own party across the whole runtime.
 *
 * Aarohi's exclusivity (JF-4C, ADR-0150) is the same shape as the other two and is load-bearing for
 * the same reason. Its domain admits exactly one Core status, `NOT_REGISTERED`, so letting it act on
 * a VENDOR party would put an acquisition agent on a registered relationship -- and letting Anisha
 * act on a PROSPECT would assume a relationship that does not exist yet.
 */
import { AgentRuntimeError } from './errors.js';
import type { RuntimeActor, RuntimePartyType } from './vocabularies.js';

/** True iff `actor` is permitted to act on a conversation with `partyType`. */
export function isActorPartyCompatible(actor: RuntimeActor, partyType: RuntimePartyType): boolean {
  if (actor === 'RIYA') {
    return partyType === 'CLIENT';
  }
  if (actor === 'ANISHA') {
    return partyType === 'VENDOR';
  }
  if (actor === 'AAROHI') {
    return partyType === 'PROSPECT';
  }
  // JARVIS (coordination/triage), HUMAN, and SYSTEM may act on any party.
  return true;
}

/** Throw `AgentRuntimeError('scope-violation')` if `actor` may not act on `partyType`. */
export function assertActorPartyCompatible(actor: RuntimeActor, partyType: RuntimePartyType): void {
  if (!isActorPartyCompatible(actor, partyType)) {
    throw new AgentRuntimeError('scope-violation');
  }
}
