/**
 * The in-memory candidate composition, with accounting at the boundary that actually exists.
 *
 * ### Why reservation lives inside the invoker
 *
 * An earlier wiring reserved a request when the per-turn dependencies were CONSTRUCTED. That is the
 * wrong moment: `HUMAN_TAKEOVER_BUT_AI_REPLIES` and `ERASED_SUBJECT_RETRIEVAL` deliberately build a
 * real Riya turn and are refused by the M4 state gate, which runs BEFORE the invoker. Reserving at
 * construction charged those two cases a provider request they never made, and the run's arithmetic
 * would have said 85 where the truth was 83.
 *
 * So the ledger sits inside `invoke`. Nothing is reserved unless the gateway is genuinely about to be
 * called, which makes "seven boundary cases cost nothing" a property of the code rather than of a
 * comment.
 *
 * ### Why the count is per case
 *
 * The safety bridge asks a per-case question — exactly one attempt for a model-facing case, exactly
 * zero for a boundary case. A cumulative counter answers a different question and would report the
 * second model case as 2. The map below is keyed by case, and incremented at the same boundary the
 * reservation happens at.
 */
import type { ModelGateway, ModelResponse } from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import type { LedgerPhase, LedgerRefusal, RequestLedger } from './accounting.js';
import type { BaseTurnDeps } from './candidate-ports.js';
import type { CandidateSession } from './operator.js';

export interface CandidateSessionDeps {
  /** The ordinary candidate gateway. */
  readonly gateway: ModelGateway;
  /**
   * A gateway whose transport is instrumented to abort at the request boundary.
   *
   * Same release, same config, same credential — only the transport differs. It is not a second
   * model, a second provider or a second credential, and a spec asserts that.
   */
  readonly cancellationGateway: ModelGateway;
  /** Arms the abort for the next cancellation turn, and reports whether generation continued. */
  readonly cancellation: {
    readonly arm: () => void;
    readonly transportStarts: () => number;
    readonly continuedAfterCancellation: () => boolean;
  };
  readonly ledger: RequestLedger;
  readonly clock: () => string;
  /**
   * Which ledger phase this session's invocations are charged to.
   *
   * The orchestrator builds one session per phase over the SAME ledger, gateways and cancellation
   * state. Safety and P10 use disjoint case ids, so their per-case maps never collide.
   */
  readonly phase: LedgerPhase;
}

/** The terminal accounting refusal, if one happened. Distinct from any candidate verdict. */
export interface AccountingRefusal {
  readonly refusal: LedgerRefusal;
}

export interface AccountedSession {
  readonly session: CandidateSession;
  /** Set once a ceiling or a bound refused a call. A safety/P10 block after this is an ACCOUNTING
   *  outcome, never a statement about the model. */
  readonly refusal: () => AccountingRefusal | undefined;
}

/** Read only the fields the ledger owns. Provider-reported `cost` is not trusted over our pricing. */
function usageOf(response: ModelResponse): {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
} {
  return {
    ...(response.usage.inputTokens === undefined
      ? {}
      : { inputTokens: response.usage.inputTokens }),
    ...(response.usage.outputTokens === undefined
      ? {}
      : { outputTokens: response.usage.outputTokens }),
  };
}

/**
 * Build the accounted session.
 *
 * `phase` is fixed per session-consumer: the safety run reserves against `safety`, the P10 capture
 * against `p10`. Smoke reserves separately, immediately before its single request.
 */
export function createAccountedSession(deps: CandidateSessionDeps): AccountedSession {
  const perCase = new Map<string, number>();
  let refusal: AccountingRefusal | undefined;

  const accountedInvoker = (
    gateway: ModelGateway,
    caseId: string,
    onDispatch?: () => void,
  ): ModelGatewayInvoker => ({
    async invoke(request): Promise<ModelGatewayInvocation> {
      // BEFORE the call, every time. A ceiling that noticed afterwards has already been crossed.
      const reservation = deps.ledger.reserve(deps.phase);
      if (!reservation.ok) {
        refusal = { refusal: reservation.refusal };
        // A bounded failure, and the gateway is never touched.
        return Object.freeze({ ok: false as const, transient: false });
      }
      // Counted at the same moment it is charged, so the ledger total and the per-case facts can
      // never disagree.
      perCase.set(caseId, (perCase.get(caseId) ?? 0) + 1);
      onDispatch?.();
      try {
        const response = await gateway.invoke(request);
        deps.ledger.settle(usageOf(response), true);
        if (deps.ledger.snapshot().usageBoundViolated) {
          refusal = { refusal: 'usage-bound-violated' };
        }
        return Object.freeze({ ok: true as const, response });
      } catch {
        // A failed attempt still consumed a request. Nothing about the error is retained, and no
        // usage is invented — the ledger prices it at the guaranteed bound and marks it estimated.
        deps.ledger.settle(undefined, false);
        return Object.freeze({ ok: false as const, transient: false });
      }
    },
  });

  return {
    session: {
      turnDeps: (caseId) => ({
        invoker: accountedInvoker(deps.gateway, caseId),
        clock: deps.clock,
      }),
      cancellationTurnDeps: (caseId): BaseTurnDeps => ({
        // The instrumented gateway. Its transport fires the abort at the real request boundary, which
        // is what makes the cancellation case a cancellation case rather than an admission test.
        invoker: accountedInvoker(deps.cancellationGateway, caseId, deps.cancellation.arm),
        clock: deps.clock,
      }),
      invocationsFor: (caseId: string): number => perCase.get(caseId) ?? 0,
      continuedAfterCancellation: deps.cancellation.continuedAfterCancellation,
      accountingRefusal: (): LedgerRefusal | undefined => refusal?.refusal,
    },
    refusal: () => refusal,
  };
}
