/**
 * The bounded evolution error contract (RWC-P4A, ADR-0098).
 *
 * Four codes, four fixed messages. A message is a CONSTANT chosen by the code and never built from
 * the batch, the state, a field value or anything a client said.
 *
 * What flows through this reducer is a person's requirements for their home, reduced to bounded
 * opaque references and short notes. A zod issue naming the failing field and quoting its value, or
 * a `RiyaBehaviourError` wrapped with the value that failed `createNeedDiscovery`, would each carry
 * that content one layer further out. So a failure says what KIND of thing was wrong and nothing
 * else — and the same discipline applies to the RESULT: `rejectedFields` reports a field name and a
 * closed reason, never the value that lost.
 */

const CODE_VALUES = [
  /**
   * The observation batch is not a valid batch.
   *
   * A duplicate field, an unknown field, an unknown provenance, a `SET` with no value, a `CLEAR`
   * carrying one, an oversized value, or any key the strict schema does not declare.
   */
  'invalid-observation-batch',
  /** The supplied continuity state is not a valid `RiyaConversationContinuityStateV1`. */
  'invalid-state',
  /**
   * The state is in a phase RWC-P4A does not own.
   *
   * `CONTACT`, `CONSENT` and `COMPLETE` belong to RWC-P6. Evolving one would mean this reducer
   * deciding something about contact capture, consent or a completed submission — and the safe
   * failure is to refuse, not to regress the conversation to a phase it has already left.
   */
  'phase-out-of-scope',
  /**
   * The evolution would need a revision this counter cannot express.
   *
   * `continuityRevision` is bounded by `Number.MAX_SAFE_INTEGER`. Beyond it, `+ 1` silently returns
   * the same number, and a compare-and-set built on a counter that stopped counting would report
   * success while losing every subsequent write.
   */
  'revision-exhausted',
] as const;

export type RiyaConversationEvolutionErrorCode = (typeof CODE_VALUES)[number];

export const RIYA_CONVERSATION_EVOLUTION_ERROR_CODES: readonly RiyaConversationEvolutionErrorCode[] =
  Object.freeze([...CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<RiyaConversationEvolutionErrorCode, string>> = Object.freeze({
  'invalid-observation-batch': 'A Riya conversation observation batch is invalid.',
  'invalid-state': 'A Riya conversation continuity state is invalid.',
  'phase-out-of-scope': 'A Riya conversation phase is outside conversation evolution.',
  'revision-exhausted': 'A Riya conversation continuity revision cannot advance further.',
});

/** A bounded evolution error. The code is the contract; the message is fixed per code. */
export class RiyaConversationEvolutionError extends Error {
  readonly code: RiyaConversationEvolutionErrorCode;

  constructor(code: RiyaConversationEvolutionErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaConversationEvolutionError';
    this.code = code;
  }
}
