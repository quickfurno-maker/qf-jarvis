import { type ExecutionIntentV1 } from '@qf-jarvis/contracts';

import { type ExecutionDispatchReason } from '../protocol/reason-codes.js';

/**
 * The public result of the execution-dispatch boundary (QFJ-P09.02, ADR-0090).
 *
 * ### It is an OBSERVATION, not a permission
 *
 * This is the field list that took the most care, because the tempting names are the dangerous
 * ones. There is no `canExecute`, `canSend`, `isAuthorized`, `consentValid`, `retryAllowed`,
 * `delivered`, `sent`, `executed` or `success` — not because they are forbidden by a rule, but
 * because none of them would be TRUE. This boundary establishes that a dispatch arrived
 * authentically, intact, in time, and not as a duplicate. It does not establish that anything may
 * happen, and it certainly does not establish that anything did.
 *
 * In particular, a `first-seen` observation is NOT an `ExecutionResultV1`. Execution truth is
 * recorded by QuickFurno Core after a real execution returns; a validation boundary that minted
 * results would be inventing outcomes it never witnessed.
 *
 * ### Exact-replay suppression is enforced by the TYPE, not by a convention
 *
 * The first version of this union carried `intent` on both successful branches and relied on the
 * caller reading `disposition`. That is a comment, not a guarantee — it left this available to a
 * future production adapter:
 *
 * ```ts
 * if (result.ok) {
 *   execute(result.intent); // an exact replay, executed a second time
 * }
 * ```
 *
 * Duplicate suppression is the whole reason the replay guard exists, and losing it to one plausible
 * `if` would undo that. So the executable intent now exists ONLY on the first-seen branch. A
 * consumer must narrow on `disposition === 'first-seen'` before it can reach an intent at all, and
 * the unsafe shape above does not compile.
 *
 * It is deliberately not solved with `intent?: ExecutionIntentV1`, `intent: undefined` or a helper
 * that hands the intent back: each of those keeps the property reachable and moves the check back to
 * run time, which is exactly what failed.
 *
 * ### Communication eligibility is still somebody else's job
 *
 * For a communication action, a prior human approval is not execution-time consent. Opt-out, DNC,
 * quiet hours and attempt limits are revalidated at execution time by Core and the QF
 * Communications Runtime. This package does not implement that, does not cache it, and cannot
 * express it — which is why no consent-shaped field exists here to be misread as one.
 */

/** What the replay guard concluded about a dispatch that passed every earlier check. */
export type DispatchDisposition = 'first-seen' | 'exact-replay';

/** Fields both successful branches carry. All immutable; none of them is an authority. */
interface DispatchObservationBase {
  readonly ok: true;
  /**
   * `validated-dispatch-observation`, stated on the value itself.
   *
   * A consumer reading this in a log or a test should not have to infer from a bare `ok: true` that
   * it is holding an observation rather than an authorization or a result.
   */
  readonly kind: 'validated-dispatch-observation';
  /** Which execution-dispatch key verified the signature. */
  readonly keyId: string;
  /** When the dispatch was signed, as an immutable canonical ISO-8601 string. */
  readonly signedAtIso: string;
  /** The verifier-computed `hex(sha256(rawBody))`. Never the sender's claimed digest. */
  readonly bodyDigestHex: string;
}

/**
 * A dispatch that crossed this boundary for the FIRST time. Deeply frozen.
 *
 * This is the only shape that carries an executable intent, and reaching it requires narrowing on
 * `disposition`. Even here, holding the intent still does not mean a provider effect happened — it
 * means this exact instruction arrived authentically and has not been seen before.
 */
export interface FirstSeenDispatchObservation extends DispatchObservationBase {
  readonly disposition: 'first-seen';
  /** The parsed, contract-valid intent exactly as Core signed it. */
  readonly intent: ExecutionIntentV1;
}

/**
 * A dispatch that had already crossed this boundary. Deeply frozen.
 *
 * Still `ok: true`: it was authenticated, intact, in time and internally consistent. It is an
 * authenticated REPLAY observation, not a refusal, and conflating the two would lose the difference
 * between "we already did this" and "something is wrong".
 *
 * It carries NO `intent`. There is nothing legitimate a caller can do with an executable intent on
 * this branch, and the one illegitimate thing — acting on it again — is precisely what the replay
 * claim exists to prevent. `executionIntentId` is kept for correlation, which is what an operator
 * or a log actually needs. `idempotencyKey` is deliberately omitted: nothing here needs it, and the
 * smallest safe surface is the one that cannot be misused later.
 */
export interface ExactReplayObservation extends DispatchObservationBase {
  readonly disposition: 'exact-replay';
  /** Correlation only. The intent itself is not exposed on this branch. */
  readonly executionIntentId: string;
}

/** A refused dispatch. A stable, countable reason and nothing else. */
export interface RefusedDispatch {
  readonly ok: false;
  readonly reason: ExecutionDispatchReason;
}

/**
 * The discriminated union a caller receives.
 *
 * Narrow on `ok` first, then on `disposition`. Only the `first-seen` branch has an `intent`.
 */
export type ExecutionDispatchResult =
  FirstSeenDispatchObservation | ExactReplayObservation | RefusedDispatch;

/** Either successful branch. Useful for a caller that only records observations. */
export type ValidatedDispatchObservation = FirstSeenDispatchObservation | ExactReplayObservation;
