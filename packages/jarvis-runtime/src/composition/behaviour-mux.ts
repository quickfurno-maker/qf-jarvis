/**
 * The deterministic behaviour multiplexer (QFJ-S3-D-B, ADR-0071).
 *
 * The orchestrator accepts exactly ONE `BehaviourDecisionPort` (ADR-0068), and there are now two
 * business agents. This is the whole of the reconciliation: a pure selector that picks at most one
 * adapter from the actor-and-party pair the merged router already decided, and calls only that one.
 *
 * It is deliberately NOT a registry, and deliberately not a loop. "Ask each adapter until one
 * answers" would mean a client turn could cost a vendor-input read, and a vendor adapter's refusal
 * could be quietly answered by Riya — two failures that are invisible in a passing test suite and
 * catastrophic in a real conversation. So selection is exact-pair matching, and a selected adapter's
 * `undefined` or rejection is the turn's answer. The other adapter is never consulted, on any path.
 *
 * The pair comes from `BehaviourDecisionRequest`, which the orchestrator fills from `assignAgent`.
 * That keeps the M1 router the single assignment authority: the mux reads the routing decision, it
 * never makes one.
 */
import type {
  BehaviourDecision,
  BehaviourDecisionPort,
  BehaviourDecisionRequest,
} from '@qf-jarvis/agent-runtime';

/** The already-built agent adapters, each present only when its input port was configured. */
export interface BehaviourMuxPorts {
  readonly riya?: BehaviourDecisionPort;
  readonly anisha?: BehaviourDecisionPort;
}

/**
 * Build the single behaviour port the orchestrator receives, or `undefined` when no business agent
 * is configured at all — in which case the composition is byte-for-byte the pre-S3-C pipeline.
 */
export function behaviourMux(ports: BehaviourMuxPorts): BehaviourDecisionPort | undefined {
  if (ports.riya === undefined && ports.anisha === undefined) {
    return undefined;
  }
  return Object.freeze({
    decide(request: BehaviourDecisionRequest): Promise<BehaviourDecision | undefined> {
      // Exact pair matching. Anything else — UNKNOWN/JARVIS, a human-owned turn, a mismatched
      // pairing the scope rule would reject anyway — reaches no adapter and takes the legacy default.
      const selected =
        request.partyType === 'CLIENT' && request.assignedActor === 'RIYA'
          ? ports.riya
          : request.partyType === 'VENDOR' && request.assignedActor === 'ANISHA'
            ? ports.anisha
            : undefined;

      if (selected === undefined) {
        return Promise.resolve(undefined);
      }
      // Exactly one call. A rejection propagates unchanged so the orchestrator fails closed; it is
      // never caught here and never turned into a second attempt against the other adapter.
      return selected.decide(request);
    },
  });
}
