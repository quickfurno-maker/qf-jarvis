/**
 * The POST-RLD1 low-reasoning 8,192 output-budget differential port (future live label RBD1).
 *
 * ### One variable, and the code is what makes that true
 *
 * RLD1 sent the neutral production request on `openai/gpt-oss-20b`, over Chat Completions, at
 * `max_completion_tokens=4096`, with `reasoning_effort='low'`, and received HTTP 400 with
 * `json_validate_failed`. Low reasoning effort did not repair the exact neutral path at that budget.
 *
 * That closes the explicit-low-at-4096 REPAIR ATTEMPT and nothing wider: other reasoning-effort
 * values remain untested, and reasoning effort is not claimed to be generally irrelevant. The effort
 * is HELD here — along with the model and the endpoint — so that one variable moves at a time.
 *
 * What moves is the per-request completion bound: 4,096 to 8,192.
 *
 * ### The one-variable claim is a property of the CONSTRUCTION
 *
 * This port and the RLD1 port are two callers of ONE shared primitive. The model, the capability
 * ceiling, the endpoint, the transport, the config and the merged diagnostic adapter are decided
 * inside {@link createReasoningBudgetProviderFactory}; the probe body inside
 * {@link createReasoningBudgetProbeRunner}. Neither port constructs any of those for itself.
 *
 * Stated precisely, because the primitive is parameterised rather than rigid: it still accepts a
 * budget and an effort. For the two CURRENTLY GOVERNED callers, what pins the one-variable claim is
 * the combination of shared references — this port reads RLD1's own effort constant, and both read
 * one neutral capture — with a spec that diffs the two RECORDED WIRE BODIES and requires exactly one
 * changed key. The primitive removes the ways they could drift apart silently; the references and
 * that test are what fix the values.
 *
 * The messages and the schema come from `captureNeutralClientRiyaRequest()`, the identical function
 * NRA1's, MD120B3's, RSP20B2's and RLD1's ports call. There is no second capture, no second fixture
 * and no re-derived schema.
 *
 * ### The 8,192 is a REQUEST bound and reaches nothing else
 *
 * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096 and is not read here. The model capability ceiling
 * stays `CANDIDATE_MAX_COMPLETION_TOKENS` (65,536) and is set by the shared factory, so 8,192 is
 * well inside it and the adapter's clamp is never engaged — a diagnostic may narrow the request,
 * never widen the ceiling.
 *
 * ### A 2xx is not the finding, and on this run that matters most
 *
 * The verdict runs the FULL production projector. A wire-shaped document accepted on shape alone
 * would report that a bigger budget repairs the path when production would refuse the answer it
 * returned — and this is precisely the run whose ACCEPTED an owner would read as license to move the
 * production budget. The projection is consumed as a presence check and discarded in the same
 * statement: two booleans survive it, and nothing about the document does.
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
  planReasoningBudget8192Probe,
  REASONING_BUDGET_8192_STEP_ID,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  ReasoningBudget8192StepId,
} from './internal/operational-acceptance-plan.js';
import {
  createReasoningBudgetProbeRunner,
  createReasoningBudgetProviderFactory,
} from './internal/reasoning-budget-probe.js';
import type { ReasoningBudgetSeam } from './internal/reasoning-budget-probe.js';
import type { ReasoningBudget8192Outcome } from './internal/reasoning-budget-8192-classification.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import {
  REASONING_BUDGET_8192_CANDIDATE_BUDGET,
  REASONING_BUDGET_8192_REASONING_EFFORT,
} from './reasoning-budget-8192-identity.js';

/** The probe this run sends. One, ever. */
export type ReasoningBudget8192Probe = DiagnosticProbe<ReasoningBudget8192StepId>;

/**
 * The provider output bound the probe asks for. THE variable.
 *
 * Read from the diagnostic identity, never written twice. It is the ONLY value this port supplies
 * that the RLD1 port supplies differently.
 */
export const REASONING_BUDGET_8192_OUTPUT_BUDGET = REASONING_BUDGET_8192_CANDIDATE_BUDGET;

export interface ReasoningBudget8192PortDeps {
  readonly providerForCompletionBudget: (budget: number) => ReasoningBudgetSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Injected rather than imported so the port cannot acquire a second opinion about what production
   * accepts. Deliberately NOT the wire schema: shape is not acceptance.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
}

/** What one probe run produced: the outcome record, and the usage the ledger must settle with. */
export interface ReasoningBudget8192RunResult {
  readonly outcome: ReasoningBudget8192Outcome;
  /** Present only when the provider REPORTED usage. Absent means the ledger's bound applies. */
  readonly usage?: ModelUsage;
}

/** Build the runner for the ONE probe, at the 8,192 candidate budget. */
export function createReasoningBudget8192Port(
  deps: ReasoningBudget8192PortDeps,
): (probe: ReasoningBudget8192Probe) => Promise<ReasoningBudget8192RunResult> {
  return createReasoningBudgetProbeRunner({
    stepId: REASONING_BUDGET_8192_STEP_ID,
    // THE ONE VARIABLE. Everything else this runner uses is fixed by the shared primitive.
    completionBudget: REASONING_BUDGET_8192_OUTPUT_BUDGET,
    // HELD, read from RLD1's own constant so the two runs cannot disagree about the posture.
    reasoningEffort: REASONING_BUDGET_8192_REASONING_EFFORT,
    providerForCompletionBudget: deps.providerForCompletionBudget,
    observations: deps.observations,
    projectStructuredResult: deps.projectStructuredResult,
  });
}

export interface LiveReasoningBudget8192Deps {
  readonly credential: unknown;
  /** Production: the shared factory's `createFetchGroqTransport()`. Specs: a deterministic fake. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveReasoningBudget8192Composition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: ReasoningBudget8192Probe;
  readonly run: (probe: ReasoningBudget8192Probe) => Promise<ReasoningBudget8192RunResult>;
  readonly observations: CandidateTransportObservations;
  /** Request budgets asked for. Expect exactly one, and expect it to be 8,192. */
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  /** Capability ceilings the built configs declared. Expect 65,536, unchanged from every gate. */
  readonly capabilityCeilingsUsed: () => readonly number[];
  readonly candidateModelsUsed: () => readonly string[];
  readonly endpointsUsed: () => readonly string[];
  /** Efforts asked for. Expect exactly one, and expect it to be `'low'` — the held posture. */
  readonly reasoningEffortsUsed: () => readonly GroqGptOssReasoningEffort[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveReasoningBudget8192Composition(
  deps: LiveReasoningBudget8192Deps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveReasoningBudget8192Composition {
  const factory = createReasoningBudgetProviderFactory({
    credential: deps.credential,
    ...(deps.openTransport === undefined ? {} : { openTransport: deps.openTransport }),
    unboundCredentialError: 'QFJ_REASONING_BUDGET_8192_CREDENTIAL_NOT_BOUND',
  });

  const probe = planReasoningBudget8192Probe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages NRA1 sent and RLD1 re-sent, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const run = createReasoningBudget8192Port({
    providerForCompletionBudget: factory.providerForCompletionBudget,
    observations: factory.observations,
    // The FULL projector, never `deps.captured.structuredWireSchema`.
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
export interface ReasoningBudget8192Runner {
  readonly probe: ReasoningBudget8192Probe;
  readonly run: (probe: ReasoningBudget8192Probe) => Promise<ReasoningBudget8192RunResult>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request RLD1 used and projects ONCE before the probe exists. A failure in
 * either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveReasoningBudget8192Runner(
  deps: LiveReasoningBudget8192Deps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<ReasoningBudget8192Runner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveReasoningBudget8192Composition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
