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
 * ### Communication eligibility is still somebody else's job
 *
 * For a communication action, a prior human approval is not execution-time consent. Opt-out, DNC,
 * quiet hours and attempt limits are revalidated at execution time by Core and the QF
 * Communications Runtime. This package does not implement that, does not cache it, and cannot
 * express it — which is why no consent-shaped field exists here to be misread as one.
 *
 * ### What it may safely carry
 *
 * Facts about the DISPATCH, all immutable: the parsed intent, which key verified it, when it was
 * signed, the verifier's own digest, and the replay disposition. No signature bytes, no key
 * material, no raw body, no header, no contact detail, no provider payload.
 */

/** What the replay guard concluded about a dispatch that passed every earlier check. */
export type DispatchDisposition = 'first-seen' | 'exact-replay';

/** A dispatch that passed the whole boundary. Deeply frozen. */
export interface ValidatedDispatchObservation {
  readonly ok: true;
  /**
   * `validated-dispatch-observation`, stated on the value itself.
   *
   * A consumer reading this in a log or a test should not have to infer from a bare `ok: true`
   * that it is holding an observation rather than an authorization or a result.
   */
  readonly kind: 'validated-dispatch-observation';
  /**
   * `first-seen` — this exact dispatch had not crossed the boundary before. It still does NOT mean
   * a provider effect happened.
   * `exact-replay` — the identical dispatch crossed before and is suppressed here.
   */
  readonly disposition: DispatchDisposition;
  /** The parsed, contract-valid intent exactly as Core signed it. */
  readonly intent: ExecutionIntentV1;
  /** Which execution-dispatch key verified the signature. */
  readonly keyId: string;
  /** When the dispatch was signed, as an immutable canonical ISO-8601 string. */
  readonly signedAtIso: string;
  /** The verifier-computed `hex(sha256(rawBody))`. Never the sender's claimed digest. */
  readonly bodyDigestHex: string;
}

/** A refused dispatch. A stable, countable reason and nothing else. */
export interface RefusedDispatch {
  readonly ok: false;
  readonly reason: ExecutionDispatchReason;
}

export type ExecutionDispatchResult = ValidatedDispatchObservation | RefusedDispatch;
