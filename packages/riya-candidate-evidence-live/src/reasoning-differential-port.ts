/**
 * The POST-RSP20B2 `reasoning_effort='low'` differential port (live label RLD1 — CONSUMED).
 *
 * ### One variable, and the code is what makes that true
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` over Chat Completions, at
 * the 4,096 budget, in strict mode, with **no reasoning field on the wire**, and received HTTP 400
 * with `json_validate_failed`. MD120B3 reproduced it on 120B. RSP20B2 reproduced it over the
 * Responses API. Model and endpoint are closed as axes.
 *
 * GPT-OSS reasoning tokens are drawn from the same completion budget the structured answer needs, so
 * a model reasoning at the documented default has less of that budget left for the JSON. This port
 * re-sends **the same captured request** — same case, same system bytes, same user bytes, same role
 * sequence, same raw schema, same projected schema, same 4,096 bound, same strict mode, same
 * production 20B model, same Chat Completions endpoint, same timeout, same zero-retry posture — and
 * adds exactly one body field.
 *
 * It reaches that by calling `captureNeutralClientRiyaRequest()`, the identical function NRA1's,
 * MD120B3's and RSP20B2's ports call, and by planning its probe through
 * `planReasoningDifferentialProbe`, which delegates to the neutral planner and overwrites nothing but
 * the step id and the dimension label.
 *
 * ### RLD1 ran, and its answer is recorded
 *
 * The probe returned HTTP 400 with `json_validate_failed` —
 * `REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID`. Low reasoning effort did NOT repair the exact
 * neutral path at 4,096. This port is retained unchanged as the baseline the budget differential
 * beside it is measured against, and its label is never rerun.
 *
 * ### The request is built by the SHARED primitive, which is the point
 *
 * Everything about the wire — the model, the capability ceiling, the endpoint, the config, the
 * merged diagnostic adapter, the effort — comes from
 * {@link createReasoningBudgetProviderFactory}, and the probe body from
 * {@link createReasoningBudgetProbeRunner}. The budget is the only argument this port supplies that
 * a successor supplies differently.
 *
 * That is what lets the 8192 differential prove "identical except `max_completion_tokens`" as a
 * property of the CONSTRUCTION rather than as a claim about two independently written code paths.
 * Nothing about this port's behaviour changed when the primitive was extracted; its specs are
 * unmodified and are the guard for that.
 *
 * ### Usage is PROPAGATED, which the historical seams could not do
 *
 * Every earlier one-probe seam narrows the provider result to `{ providerCompleted, structuredValue }`
 * and the operator settles `ledger.settle(undefined, …)`. That is why RSP20B2's receipt printed
 * `outputTokensTotal=65622` — a 65,536 fallback BOUND, not a measurement. This seam returns `usage`,
 * so a completion that reports real token counts settles with them.
 *
 * ### A 2xx is not the finding
 *
 * The verdict runs the FULL production projector — grounded citations, the canonical observation
 * batch, availability refs, the deterministic reducer, the prospective state, the next-question plan
 * — carried through the capture. Wire `safeParse` is its first stage and nothing more.
 */
import type {
  GroqGptOssReasoningEffort,
  GroqTransport,
  ModelUsage,
} from '@qf-jarvis/model-gateway';

import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import type {
  CapturedProductionRiyaRequest,
  ProjectStructuredResult,
} from './diagnostic-canary-materials.js';
import {
  planReasoningDifferentialProbe,
  REASONING_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  ReasoningDifferentialStepId,
} from './internal/operational-acceptance-plan.js';
import {
  createReasoningBudgetProbeRunner,
  createReasoningBudgetProviderFactory,
} from './internal/reasoning-budget-probe.js';
import type {
  ReasoningBudgetSeam,
  ReasoningBudgetSeamResult,
} from './internal/reasoning-budget-probe.js';
import type { ReasoningDifferentialOutcome } from './internal/reasoning-differential-classification.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from './operational-acceptance-port.js';
import { REASONING_DIFFERENTIAL_CANDIDATE_EFFORT } from './reasoning-differential-identity.js';

/** The probe this run sends. One, ever. */
export type ReasoningDifferentialProbe = DiagnosticProbe<ReasoningDifferentialStepId>;

/**
 * The provider output bound the probe asks for.
 *
 * Re-exported from the OAD port, which re-exports the production constant. One number, several names,
 * never a second literal.
 *
 * Holding it fixed is what made RLD1 a one-variable run: reasoning tokens are drawn from THIS budget,
 * so moving it would have changed the very quantity the effort setting competes for. Moving it is now
 * the SUCCESSOR run's job, with the effort held instead — one variable each time, never both.
 */
export const REASONING_DIFFERENTIAL_OUTPUT_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

/** The narrow seam the port invokes. Deliberately not the gateway's provider contract. */
export type ReasoningProviderSeam = ReasoningBudgetSeam;
/** What the port learned from one invocation, including the usage the ledger settles with. */
export type ReasoningProviderSeamResult = ReasoningBudgetSeamResult;

export interface ReasoningDifferentialPortDeps {
  readonly providerForCompletionBudget: (budget: number) => ReasoningProviderSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Injected rather than imported so the port cannot acquire a second opinion about what production
   * accepts: the only projector it can run is the one built for the captured request, by the same
   * function the evaluation turn uses.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
}

/** What one probe run produced: the outcome record, and the usage the ledger must settle with. */
export interface ReasoningDifferentialRunResult {
  readonly outcome: ReasoningDifferentialOutcome;
  /**
   * The provider-reported usage, when there was any.
   *
   * Absent means the provider reported nothing, and the ledger's conservative bound then applies and
   * is labelled as one.
   */
  readonly usage?: ModelUsage;
}

/** Build the runner for the ONE probe, at the 4,096 baseline budget. */
export function createReasoningDifferentialPort(
  deps: ReasoningDifferentialPortDeps,
): (probe: ReasoningDifferentialProbe) => Promise<ReasoningDifferentialRunResult> {
  return createReasoningBudgetProbeRunner({
    stepId: REASONING_DIFFERENTIAL_STEP_ID,
    // THE budget this run holds. A successor passes a different one and changes nothing else.
    completionBudget: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
    reasoningEffort: REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
    providerForCompletionBudget: deps.providerForCompletionBudget,
    observations: deps.observations,
    projectStructuredResult: deps.projectStructuredResult,
  });
}

export interface LiveReasoningDifferentialDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveReasoningDifferentialComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: ReasoningDifferentialProbe;
  readonly run: (probe: ReasoningDifferentialProbe) => Promise<ReasoningDifferentialRunResult>;
  readonly observations: CandidateTransportObservations;
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
  /** Model ids the built configs declared. Expect exactly one, and expect the production 20B. */
  readonly candidateModelsUsed: () => readonly string[];
  /** Endpoint URLs the built transport was asked for. Expect exactly Chat Completions. */
  readonly endpointsUsed: () => readonly string[];
  /** Efforts asked for. Expect exactly one, and expect it to be `'low'`. */
  readonly reasoningEffortsUsed: () => readonly GroqGptOssReasoningEffort[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveReasoningDifferentialComposition(
  deps: LiveReasoningDifferentialDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveReasoningDifferentialComposition {
  const factory = createReasoningBudgetProviderFactory({
    credential: deps.credential,
    ...(deps.openTransport === undefined ? {} : { openTransport: deps.openTransport }),
    unboundCredentialError: 'QFJ_REASONING_DIFFERENTIAL_CREDENTIAL_NOT_BOUND',
  });

  const probe = planReasoningDifferentialProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages NRA1 sent, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const run = createReasoningDifferentialPort({
    providerForCompletionBudget: factory.providerForCompletionBudget,
    observations: factory.observations,
    // The FULL projector, never `deps.captured.structuredWireSchema`. Shape is not acceptance.
    projectStructuredResult: deps.captured.projectStructuredResult,
  });

  return Object.freeze({
    probe,
    run,
    observations: factory.observations,
    requestCompletionBudgetsUsed: factory.requestCompletionBudgetsUsed,
    capabilityCeilingsUsed: factory.capabilityCeilingsUsed,
    candidateModelsUsed: factory.candidateModelsUsed,
    endpointsUsed: factory.endpointsUsed,
    reasoningEffortsUsed: factory.reasoningEffortsUsed,
  });
}

/** What the operator receives: the ONE probe, and the runner bound to the credential. */
export interface ReasoningDifferentialRunner {
  readonly probe: ReasoningDifferentialProbe;
  readonly run: (probe: ReasoningDifferentialProbe) => Promise<ReasoningDifferentialRunResult>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request NRA1 used and projects ONCE before the probe exists. A failure in
 * either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveReasoningDifferentialRunner(
  deps: LiveReasoningDifferentialDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<ReasoningDifferentialRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveReasoningDifferentialComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
