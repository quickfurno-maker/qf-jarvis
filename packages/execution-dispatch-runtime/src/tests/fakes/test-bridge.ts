import { type ExecutionDispatchResult } from '../../contracts/result.js';

/**
 * A TEST-ONLY simulated execution bridge.
 *
 * ### What it is not
 *
 * It does not open a socket, call n8n, call a provider, load a credential or read the environment.
 * It counts. The name of what it counts was chosen carefully: `handoffs`, never `sent`, `delivered`,
 * `executed` or `accepted`. Nothing here reaches a provider, so calling it any of those would put a
 * lie in a test name — and a test name is the first thing someone reads when deciding what the
 * system does.
 *
 * ### Why it exists at all
 *
 * The rule it proves cannot be expressed by the verifier alone: a validated dispatch must be handed
 * to execution AT MOST ONCE. First-seen hands off exactly once; an exact replay hands off zero more
 * times; every refusal hands off zero times. That is the property a real bridge would have to
 * preserve, and it is testable here without any transport existing.
 *
 * There is deliberately NO production export that takes an observation and calls a transport. That
 * belongs to a later, separately authorized slice.
 */
export class TestExecutionBridge {
  #handoffs = 0;

  /** How many times this bridge would have handed a dispatch to execution. */
  public get handoffs(): number {
    return this.#handoffs;
  }

  /**
   * Offer a boundary result to the bridge.
   *
   * Only a `first-seen` observation is handed off. `exact-replay` is suppressed — that is the whole
   * purpose of the replay claim — and any refusal is ignored.
   */
  public offer(result: ExecutionDispatchResult): void {
    if (!result.ok) {
      return;
    }
    if (result.disposition !== 'first-seen') {
      return;
    }
    this.#handoffs += 1;
  }
}
