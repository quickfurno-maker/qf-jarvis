/**
 * The in-memory candidate composition, with accounting and cancellation at the boundaries that
 * actually exist.
 *
 * ### Reservation lives inside the invoker
 *
 * An earlier wiring reserved a request when the per-turn dependencies were CONSTRUCTED. That is the
 * wrong moment: `HUMAN_TAKEOVER_BUT_AI_REPLIES` and `ERASED_SUBJECT_RETRIEVAL` deliberately build a
 * real Riya turn and are refused by the M4 state gate, which runs BEFORE the invoker. Reserving at
 * construction charged those two cases a provider request they never made.
 *
 * ### The PHASE is chosen by the caller, never inferred
 *
 * A single session used to carry one fixed phase, so a real run booked all 72 P10 calls as safety and
 * the advertised 1 / 10 / 72 split was not reachable. There are now three named accessors, and the
 * port that asks decides what it is: safety asks for safety deps, the quality capture asks for
 * quality deps. Nothing reads a case id to guess a phase.
 *
 * ### ONE abort signal, from `gateway.invoke` to the transport
 *
 * The cancellation case previously aborted a controller whose signal was never handed to the gateway.
 * That proved a controller had been aborted and cancelled nothing. The cancellation invoker now calls
 * `gateway.invoke(request, { signal })` with the SAME controller the instrumented transport aborts,
 * so the signal the underlying transport receives is the signal that gets cancelled — provable by
 * object identity, which is what the spec asserts.
 */
import { isModelGatewayError } from '@qf-jarvis/model-gateway';
import type { ModelGatewayErrorCode } from '@qf-jarvis/model-gateway';
import type { ModelGateway, ModelResponse } from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import type { LedgerPhase, LedgerRefusal, RequestLedger } from './accounting.js';
import type { BaseTurnDeps } from './candidate-ports.js';
import { NOT_REACHED_TRANSPORT_OBSERVATION } from './candidate-transport-observation.js';
import type {
  CandidateTransportObservation,
  CandidateTransportObservations,
} from './candidate-transport-observation.js';

/** What the operator needs from a live candidate composition. */
/**
 * The code recorded when a throw was NOT a `ModelGatewayError`.
 *
 * A member of the real closed vocabulary rather than an invented string, so every consumer can branch
 * on one enum. It means "the gateway threw something outside its own contract", which is itself the
 * finding.
 */
const UNKNOWN_GATEWAY_FAILURE: ModelGatewayErrorCode = 'internal-invariant';

export interface CandidateSession {
  /** Per-turn dependencies for a SAFETY case. Charged to the safety phase. */
  readonly safetyTurnDeps: (caseId: string) => BaseTurnDeps | undefined;
  /** Per-turn dependencies for the ONE safety case that cancels after admission. */
  readonly safetyCancellationTurnDeps: (caseId: string) => BaseTurnDeps | undefined;
  /** Per-turn dependencies for a P10 case. Charged to the p10 phase. */
  readonly qualityTurnDeps: (caseId: string) => BaseTurnDeps | undefined;
  /** How many provider attempts THIS case made. Per case, never a running total. */
  readonly invocationsFor: (caseId: string) => number;
  /**
   * The CLOSED gateway error code for this case, or `undefined` when the gateway returned a response.
   *
   * Content-free by construction: the vocabulary is fixed and provider-neutral, and the originating
   * exception's message, stack and cause are never retained.
   */
  readonly gatewayErrorFor: (caseId: string) => ModelGatewayErrorCode | undefined;
  /** Whether the abort was actually observed at the transport boundary for this case. */
  readonly cancellationObservedFor: (caseId: string) => boolean;
  /**
   * HF4-R4. The transport-boundary observation this case CLAIMED, or `NOT_REACHED`.
   *
   * Claimed rather than looked up by ordering: the invoker opens a window around the one gateway call
   * it is making, and only a crossing inside that window belongs to that case.
   */
  readonly transportObservationFor: (caseId: string) => CandidateTransportObservation;
  /** A terminal accounting refusal, if a ceiling or a usage bound stopped the run. */
  readonly accountingRefusal: () => LedgerRefusal | undefined;
}

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
  /**
   * The ONE controller whose signal is handed to `gateway.invoke` for a cancellation turn, and which
   * the instrumented transport aborts once the request boundary is crossed.
   */
  readonly cancellationController: AbortController;
  /** How many times the instrumented transport has been entered. */
  readonly transportStarts: () => number;
  /**
   * HF4-R4. The run-local transport observation recorder, shared by both gateways.
   *
   * Optional so a pre-R4 composition still builds, and PASSIVE by contract: it wraps a transport,
   * records four content-free facts, and returns the same response or rethrows the same error.
   */
  readonly transportObservations?: CandidateTransportObservations;
  readonly ledger: RequestLedger;
  readonly clock: () => string;
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

/** Build the accounted session. */
export function createAccountedSession(deps: CandidateSessionDeps): CandidateSession {
  const perCase = new Map<string, number>();
  /** HF4: the closed gateway error code per case. Never a message, stack or cause. */
  const perCaseGatewayError = new Map<string, ModelGatewayErrorCode>();
  const cancellationObserved = new Set<string>();
  let refusal: LedgerRefusal | undefined;

  const accountedInvoker = (
    gateway: ModelGateway,
    caseId: string,
    phase: LedgerPhase,
    cancelling: boolean,
  ): ModelGatewayInvoker => ({
    async invoke(request): Promise<ModelGatewayInvocation> {
      // BEFORE the call, every time. A ceiling that noticed afterwards has already been crossed.
      const reservation = deps.ledger.reserve(phase);
      if (!reservation.ok) {
        refusal = reservation.refusal;
        // A bounded failure, and the gateway is never touched.
        return Object.freeze({ ok: false as const, transient: false });
      }
      // Counted at the same moment it is charged, so the ledger total and the per-case facts can
      // never disagree.
      perCase.set(caseId, (perCase.get(caseId) ?? 0) + 1);
      const startsBefore = deps.transportStarts();
      const observe = (): void => {
        if (cancelling && deps.transportStarts() > startsBefore) {
          cancellationObserved.add(caseId);
        }
      };
      // The ONE place a signal is supplied, and only for the cancelling turn. The gateway's own
      // options argument already carries it, so the generic M4 invoker contract stays untouched.
      const invokeGateway = (): Promise<ModelResponse> =>
        cancelling
          ? gateway.invoke(request, { signal: deps.cancellationController.signal })
          : gateway.invoke(request);
      // HF4-R4. The attribution window opens HERE — around the one gateway call this case makes —
      // because this is the only place that knows both the case id and the exact extent of its
      // invocation. Anything the transport observes inside it belongs to this case and to no other.
      const invokeInWindow = (): Promise<ModelResponse> =>
        deps.transportObservations === undefined
          ? invokeGateway()
          : deps.transportObservations.duringCase(caseId, invokeGateway);
      try {
        const response = await invokeInWindow();
        deps.ledger.settle(usageOf(response), true);
        if (deps.ledger.snapshot().usageBoundViolated) {
          refusal = 'usage-bound-violated';
        }
        observe();
        return Object.freeze({ ok: true as const, response });
      } catch (error) {
        // A failed attempt still consumed a request. No usage is invented — the ledger prices it at
        // the guaranteed bound and marks it estimated.
        //
        // HF4: the CLOSED error code is retained, and nothing else. Previously the whole exception was
        // discarded, which is why RUN S2-B could show ten candidate attempts priced from the fallback
        // bound with no way to say WHY. `ModelGatewayErrorCode` is a fixed provider-neutral
        // vocabulary — `provider-failed`, `structured-output-invalid`, `timeout` and so on — so it
        // is safe to print, unlike the message, stack or cause, which are not retained here at all.
        perCaseGatewayError.set(
          caseId,
          isModelGatewayError(error) ? error.code : UNKNOWN_GATEWAY_FAILURE,
        );
        deps.ledger.settle(undefined, false);
        observe();
        return Object.freeze({ ok: false as const, transient: false });
      }
    },
  });

  const depsFor = (
    gateway: ModelGateway,
    caseId: string,
    phase: LedgerPhase,
    cancelling: boolean,
  ): BaseTurnDeps => ({
    invoker: accountedInvoker(gateway, caseId, phase, cancelling),
    clock: deps.clock,
  });

  return Object.freeze({
    safetyTurnDeps: (caseId: string) => depsFor(deps.gateway, caseId, 'safety', false),
    safetyCancellationTurnDeps: (caseId: string) =>
      depsFor(deps.cancellationGateway, caseId, 'safety', true),
    qualityTurnDeps: (caseId: string) => depsFor(deps.gateway, caseId, 'p10', false),
    invocationsFor: (caseId: string) => perCase.get(caseId) ?? 0,
    gatewayErrorFor: (caseId: string) => perCaseGatewayError.get(caseId),
    cancellationObservedFor: (caseId: string) => cancellationObserved.has(caseId),
    transportObservationFor: (caseId: string) =>
      deps.transportObservations?.observationFor(caseId) ?? NOT_REACHED_TRANSPORT_OBSERVATION,
    accountingRefusal: () => refusal,
  });
}
