/**
 * The actor ↔ party scope rule (QFJ-M1, ADR-0054 §C).
 *
 * Riya may act ONLY on a CLIENT party; Anisha ONLY on a VENDOR party. Jarvis (coordination), Human,
 * and System may act on any party. This is the single boundary that keeps Riya client-only and Anisha
 * vendor-only across the whole runtime.
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
  // JARVIS (coordination/triage), HUMAN, and SYSTEM may act on any party.
  return true;
}

/** Throw `AgentRuntimeError('scope-violation')` if `actor` may not act on `partyType`. */
export function assertActorPartyCompatible(actor: RuntimeActor, partyType: RuntimePartyType): void {
  if (!isActorPartyCompatible(actor, partyType)) {
    throw new AgentRuntimeError('scope-violation');
  }
}
