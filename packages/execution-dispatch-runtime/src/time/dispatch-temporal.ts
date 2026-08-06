import { toEpochMillis, type ExecutionIntentV1 } from '@qf-jarvis/contracts';

import { type ExecutionDispatchReason } from '../protocol/reason-codes.js';

/**
 * Dispatch-time temporal rules (QFJ-P09.02, ADR-0090).
 *
 * P09.01 deliberately had no clock: static provenance does not depend on when you ask. This is
 * where execution-boundary "now" first matters, and the two time questions it answers are NOT the
 * same question.
 *
 * ### Signature freshness and intent expiry are different, and must never merge
 *
 * - Signature freshness asks: was this ENVELOPE produced recently enough that it is unlikely to be
 *   a captured replay? That check tolerates clock skew, because two honest machines disagree by
 *   seconds.
 * - Intent expiry asks: is the AUTHORIZATION still live? Core wrote `expiresAt` to bound what it
 *   authorised, and no amount of clock skew changes what Core authorised.
 *
 * Letting the skew tolerance widen expiry would mean an execution intent could act after the
 * moment Core said it must not — the boundary would be quietly extending an authorization it does
 * not own. So the skew window applies to `signedAt` and to nothing else, and a test asserts that a
 * generous window still cannot revive an expired intent.
 *
 * ### At the boundary instant, refuse
 *
 * `now >= expiresAt` is expired. Not "expired plus a second of grace" — a grace period is an
 * unreviewed extension of an authorization, and the whole point of a mandatory expiry is that it
 * is the last instant, not approximately the last instant.
 *
 * ### No clock is read here
 *
 * `now` arrives as a parameter, normalised once by the caller. Nothing in this module calls
 * `Date.now`, and replacing `Date.now` with a function that throws does not affect it — which is
 * what lets freshness be tested at a simulated 2030 without waiting.
 */

export type TemporalCheckResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ExecutionDispatchReason };

/**
 * Check a verified dispatch against the intent it carries.
 *
 * The schema has already proven `issuedAt < expiresAt`, so this adds the facts only the dispatch
 * knows: where `signedAt` sits relative to that window, and where `now` does.
 *
 * @param intent    The parsed, contract-valid intent.
 * @param signedAtMs The envelope's `signedAt`, already proven canonical.
 * @param nowMs     The injected execution-boundary instant, in epoch milliseconds.
 */
export function checkDispatchTemporalRules(
  intent: ExecutionIntentV1,
  signedAtMs: number,
  nowMs: number,
): TemporalCheckResult {
  const issuedAtMs = toEpochMillis(intent.issuedAt);
  const expiresAtMs = toEpochMillis(intent.expiresAt);

  // A dispatch signed BEFORE Core issued the intent describes an impossible order of events. The
  // benign reading is a badly skewed signer; the hostile reading is a signature minted against a
  // body that was assembled afterwards. Either way it is not a dispatch to act on.
  if (signedAtMs < issuedAtMs) {
    return { ok: false, reason: 'signed-before-issued' };
  }

  // Signing at or after the expiry means the signature outlives the authorization it carries. A
  // dispatch cannot be born already expired and still be actionable.
  if (signedAtMs >= expiresAtMs) {
    return { ok: false, reason: 'signed-at-or-after-expiry' };
  }

  // The expiry check itself, against the injected boundary instant. `>=` because `expiresAt` is
  // the first instant at which the authorization no longer holds.
  if (nowMs >= expiresAtMs) {
    return { ok: false, reason: 'intent-expired' };
  }

  return { ok: true };
}
