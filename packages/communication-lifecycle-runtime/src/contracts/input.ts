/**
 * What a caller supplies (QFJ-P09.05, ADR-0110).
 *
 * Two records, both treated as untrusted structural input. The runtime obtains neither: they were
 * built elsewhere, may have been serialized, stored and read back by something that is not this
 * runtime, and are re-parsed with the canonical schema every time regardless of what the TypeScript
 * type here claims. A cast is not evidence.
 *
 * ### `current: null` is how a lifecycle starts
 *
 * There is no `start`, `initial`, `none` or `pending` member of `COMMUNICATION_STATES`, and this
 * package does not add one. The absence of a current record IS the start condition, expressed as an
 * explicit `null` rather than an omitted field so that a caller has to say which case they mean.
 * Forgetting to pass a current record and starting a lifecycle by accident is exactly the mistake a
 * required-but-nullable field prevents: `evaluate({ next })` does not compile.
 *
 * **And it does not run, either.** The type alone would be a paper guarantee — a cast, a JavaScript
 * caller or a value read back from storage all reach the runtime with the field missing. So the
 * runtime enforces the same thing structurally: only a literal `null` declares a start, while an
 * absent `current`, an explicit `undefined` and non-object input are all refused as
 * `current-record-invalid`. A start is DECLARED here; it is never inferred from a gap.
 */
import type { CommunicationStateRecordV1 } from '@qf-jarvis/contracts';

/** Where the lifecycle stands, and what it is being asked to become. */
export interface CommunicationLifecycleTransitionInput {
  /**
   * The record the governed communication currently stands at, or `null` for lifecycle START.
   *
   * Re-validated, never trusted, never repaired and never mutated.
   */
  readonly current: CommunicationStateRecordV1 | null;
  /**
   * The candidate record.
   *
   * The runtime does not build it, does not fill anything in that is missing -- notably not
   * `previousState`, which the caller must have recorded honestly -- and hands nothing back but a
   * verdict.
   */
  readonly next: CommunicationStateRecordV1;
}
