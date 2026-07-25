/**
 * The deterministic assignment router (QFJ-M1, ADR-0054 §C, §J).
 *
 * A PURE function of party type, human-takeover state, and the routing policy — no model guess, no
 * randomness, no clock. `CLIENT → RIYA`, `VENDOR → ANISHA`, `UNKNOWN → JARVIS` (or `HUMAN` per policy);
 * a human takeover overrides every AI assignment to `HUMAN`.
 */
import type { RuntimePolicy } from '../contracts/policy.js';
import type { RuntimeActor, RuntimePartyType } from '../contracts/vocabularies.js';

/** Decide the assigned actor for a party. Deterministic; `humanTakeover` overrides to `HUMAN`. */
export function assignAgent(
  partyType: RuntimePartyType,
  humanTakeover: boolean,
  policy: RuntimePolicy,
): RuntimeActor {
  if (humanTakeover) {
    return 'HUMAN';
  }
  switch (partyType) {
    case 'CLIENT':
      return 'RIYA';
    case 'VENDOR':
      return 'ANISHA';
    case 'UNKNOWN':
      return policy.unknownRouting === 'HUMAN' ? 'HUMAN' : 'JARVIS';
    default:
      return 'JARVIS';
  }
}
