/**
 * Classifying a refusal against the reasons the architecture NAMES (QFJ-P08, ADR-0083).
 *
 * INTERNAL, and deliberately the smallest thing that could work: an exact membership test against
 * `COMMUNICATION_REFUSAL_REASONS`, and nothing else.
 *
 * ### What this is NOT
 *
 * It is **not** a validation of Core's reason. `reasonCode` is open because QuickFurno Core owns its
 * own refusal taxonomy, and the exported list is "the ones the architecture names ... not an
 * exhaustive list of everything Core may refuse for" (communication-authorization.ts). Turning it
 * into a closed enum here would make Jarvis the arbiter of which of Core's refusals are real.
 *
 * So an unrecognised reason yields `undefined`, and that means one thing only: this repository has
 * no constant for it. It does not mean the refusal is weaker, provisional, retryable or ignorable.
 * There is no `other` bucket, no fuzzy match, no prefix match and no rewrite — a near-miss silently
 * reclassified as a known refusal would be worse than an unknown one, because it would be wrong
 * with confidence.
 *
 * The result is for observability, display and evaluation. Nothing in this package branches on it.
 */
import { COMMUNICATION_REFUSAL_REASONS } from '@qf-jarvis/contracts';
import type { CommunicationRefusalReason } from '@qf-jarvis/contracts';

/** The named refusal this reason code IS, or `undefined` when it is one this repository has not named. */
export function knownRefusalReason(reasonCode: string): CommunicationRefusalReason | undefined {
  return COMMUNICATION_REFUSAL_REASONS.find((reason) => reason === reasonCode);
}
