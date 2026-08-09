/**
 * The injected Core Riya intake port (RWC-P6, ADR-0101 §14).
 *
 * ### A port with no implementation, on purpose — for the third time, and the most consequential
 *
 * RWC-P2C declared the continuity store and let RWC-P2B satisfy it. RWC-P5 declared the availability
 * reader and left the adapter to the handshake. This is the same move at the point where it matters
 * most: contact, consent and a business submission are QuickFurno Core's to own, the final
 * integration is a later governed stage, and an adapter invented here would have to guess an
 * endpoint, an auth scheme and a payload nobody has agreed.
 *
 * Declaring it now is what makes the requirement visible BEFORE somebody builds a surface that
 * assumes Jarvis may decide any of the three.
 *
 * ### One composed interface, not three packages
 *
 * Contact readiness, consent state and submission are one flow with one owner. Splitting them would
 * invent an ownership boundary that does not exist, and would let a composition hold two of the three
 * while believing it held the journey.
 *
 * ### Why every result is `unknown`
 *
 * A typed return would look reassuring and prove nothing: these values cross a boundary from a system
 * this repository does not compile. Typing them `unknown` makes re-proving them through the canonical
 * parsers the only way to use them, rather than a discipline a caller might skip.
 *
 * ### No retries here
 *
 * The port performs exactly what it is asked, once. Retry policy is a composition decision, and for
 * `submit` it is a decision with a cost: a retried submission is a second enquiry against a real
 * person's project. RWC-P6B owns that, and its rule is already fixed — look up before recovering,
 * never resubmit on uncertainty.
 */
import type { CoreRiyaIntakeReadInput } from './intake-state.js';
import type { CoreRiyaIntakeSubmissionRequestV1 } from './submission.js';

/** What a submission lookup is keyed on. */
export interface CoreRiyaIntakeLookupInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly idempotencyKey: string;
}

/** The injected Core boundary. Every method may perform I/O, so every method is async. */
export interface CoreRiyaIntakePort {
  /**
   * Read the CURRENT Core-owned contact and consent state for one tenant, conversation and subject.
   *
   * All three, because consent is intake-scoped: the same subject may hold `GRANTED` on one
   * conversation and `DECLINED` on another, and a subject-only read cannot tell them apart. The answer
   * echoes the scope back, and RWC-P6B must prove it matches before using anything in it.
   */
  readCurrent(input: CoreRiyaIntakeReadInput): Promise<unknown>;

  /**
   * Report what Core already recorded for an idempotency key.
   *
   * The recovery path for an indeterminate submission. It reports; it never authorizes, and it never
   * creates.
   */
  lookupSubmission(input: CoreRiyaIntakeLookupInput): Promise<unknown>;

  /**
   * Submit one canonical confirmed intake.
   *
   * The ONLY mutating method in this package, and the request it takes carries no authority: Core
   * decides contact readiness, consent validity, business eligibility and whether an intake is
   * created at all.
   */
  submit(request: CoreRiyaIntakeSubmissionRequestV1): Promise<unknown>;
}
