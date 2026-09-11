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
    // JF-4C (ADR-0150). A net-new unregistered prospect is Aarohi's, and deliberately not Anisha's:
    // the vendor journey assumes a registered relationship that does not exist yet, and Aarohi's own
    // gate admits exactly one Core status. Extending this switch rather than adding a sibling router
    // keeps assignment in one place -- two routers is how two answers to "whose turn is this" begin.
    case 'PROSPECT':
      return 'AAROHI';
    case 'UNKNOWN':
      return policy.unknownRouting === 'HUMAN' ? 'HUMAN' : 'JARVIS';
    default:
      return 'JARVIS';
  }
}
