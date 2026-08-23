/**
 * The POST-RBD1 best-effort `json_schema` (strict=false) differential port (future live label SFD1).
 *
 * ### One variable, and the code is what makes that true
 *
 * RLD1 sent the neutral production request at `reasoning_effort='low'` and 4,096 under
 * `json_schema.strict: true` and met `json_validate_failed`. RBD1 sent it at 8,192 and met the same.
 * The open axis is the CONSTRAINED DECODING posture itself.
 *
 * This port re-sends the same captured request on the same production model, over the same
 * production endpoint, at the same 8,192 budget, at the same `reasoning_effort='low'`, with the same
 * projected schema under the same schema name — and turns `strict` off.
 *
 * ### The one-variable claim is a property of the CONSTRUCTION, twice over
 *
 * First, this port and the RBD1 port are two callers of ONE shared primitive
 * ({@link createReasoningBudgetProviderFactory}), which decides the model, capability ceiling,
 * endpoint, transport and config. Neither port constructs any of those for itself.
 *
 * Second, and more specifically: the best-effort adapter builds its request body by DERIVING it from
 * the reasoning adapter's body and flipping one leaf. The messages, the budget, `stream`, `n`,
 * `reasoning_effort`, `response_format.type`, `json_schema.name` and `json_schema.schema` are not
 * rebuilt — they are whatever the baseline builder produced, including the projection the strict path
 * applies. Both adapters then run through the SAME shared Chat Completions exchange in the gateway,
 * so one response cannot classify two ways between them.
 *
 * The recorded-wire recursive leaf diff confirms this; it does not carry it.
 *
 * ### What it deliberately does NOT send
 *
 * Not `{ type: 'json_object' }`. That is what production's `buildResponseFormat(schema, false)`
 * returns, and using it would change the response-format type, the schema name, the strict flag and
 * the schema body all at once — answering "what happens with no schema at all", which is a different
 * and much weaker question whose result could not be compared with RBD1's.
 *
 * The schema is never simplified, re-projected under a different policy, or sent raw. This is a
 * strict-DECODING experiment, not a schema redesign.
 *
 * ### A 2xx is not the finding, and on this run that matters most of all
 *
 * Turning constrained decoding off is exactly the change most likely to produce a syntactically
 * plausible document production would refuse. The verdict therefore runs the FULL production
 * projector — grounded citations, the canonical observation batch, availability refs, the
 * deterministic reducer, the prospective state, the next-question plan. The projection is consumed as
 * a presence check and discarded in the same statement: two booleans survive it, and nothing about
 * the document does. There is no repair loop of any kind.
 */
import { createGroqChatBestEffortDiagnosticProvider } from '@qf-jarvis/model-gateway';
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
  planStrictFalseDifferentialProbe,
  STRICT_FALSE_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  StrictFalseDifferentialStepId,
} from './internal/operational-acceptance-plan.js';
import {
  createReasoningBudgetProbeRunner,
  createReasoningBudgetProviderFactory,
} from './internal/reasoning-budget-probe.js';
import type { ReasoningBudgetSeam } from './internal/reasoning-budget-probe.js';
import type { StrictFalseOutcome } from './internal/strict-false-differential-classification.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import {
  STRICT_FALSE_COMPLETION_BUDGET,
  STRICT_FALSE_REASONING_EFFORT,
} from './strict-false-differential-identity.js';

/** The probe this run sends. One, ever. */
export type StrictFalseDifferentialProbe = DiagnosticProbe<StrictFalseDifferentialStepId>;

/**
 * The completion budget, HELD at RBD1's 8,192.
 *
 * Read from the identity, which reads it from RBD1's own constant. Moving it would add a second
 * variable to a one-variable differential.
 */
export const STRICT_FALSE_OUTPUT_BUDGET = STRICT_FALSE_COMPLETION_BUDGET;

export interface StrictFalseDifferentialPortDeps {
  readonly providerForCompletionBudget: (budget: number) => ReasoningBudgetSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Deliberately NOT the wire schema. On this run above all, a port that could only prove shape would
   * report a repair that production would refuse.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
}

/** What one probe run produced: the outcome record, and the usage the ledger must settle with. */
export interface StrictFalseDifferentialRunResult {
  readonly outcome: StrictFalseOutcome;
  /** Present only when the provider REPORTED usage. Absent means the ledger's bound applies. */
  readonly usage?: ModelUsage;
}

/** Build the runner for the ONE probe, at the held 8,192 budget with strict decoding off. */
export function createStrictFalseDifferentialPort(
  deps: StrictFalseDifferentialPortDeps,
): (probe: StrictFalseDifferentialProbe) => Promise<StrictFalseDifferentialRunResult> {
  return createReasoningBudgetProbeRunner({
    stepId: STRICT_FALSE_DIFFERENTIAL_STEP_ID,
    // HELD, both of them. The strict posture is the variable, and it lives in the adapter.
    completionBudget: STRICT_FALSE_OUTPUT_BUDGET,
    reasoningEffort: STRICT_FALSE_REASONING_EFFORT,
    providerForCompletionBudget: deps.providerForCompletionBudget,
    observations: deps.observations,
    projectStructuredResult: deps.projectStructuredResult,
  });
}

export interface LiveStrictFalseDifferentialDeps {
  readonly credential: unknown;
  /** Production: the shared factory's `createFetchGroqTransport()`. Specs: a deterministic fake. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveStrictFalseDifferentialComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: StrictFalseDifferentialProbe;
  readonly run: (probe: StrictFalseDifferentialProbe) => Promise<StrictFalseDifferentialRunResult>;
  readonly observations: CandidateTransportObservations;
  /** Request budgets asked for. Expect exactly one, and expect it to be RBD1's 8,192. */
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  /** Capability ceilings the built configs declared. Expect 65,536, unchanged from every gate. */
  readonly capabilityCeilingsUsed: () => readonly number[];
  readonly candidateModelsUsed: () => readonly string[];
  readonly endpointsUsed: () => readonly string[];
  /** Efforts asked for. Expect exactly one, and expect `'low'` — the held posture. */
  readonly reasoningEffortsUsed: () => readonly GroqGptOssReasoningEffort[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveStrictFalseDifferentialComposition(
  deps: LiveStrictFalseDifferentialDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveStrictFalseDifferentialComposition {
  const factory = createReasoningBudgetProviderFactory({
    credential: deps.credential,
    ...(deps.openTransport === undefined ? {} : { openTransport: deps.openTransport }),
    unboundCredentialError: 'QFJ_STRICT_FALSE_DIFFERENTIAL_CREDENTIAL_NOT_BOUND',
    // THE ONE VARIABLE, and the only thing this composition supplies that RBD1's does not. The
    // adapter derives its body from the reasoning adapter's and flips `json_schema.strict`.
    createProvider: createGroqChatBestEffortDiagnosticProvider,
  });

  const probe = planStrictFalseDifferentialProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages every gate since NRA1 has sent.
    neutralMessages: deps.captured.messages,
  });

  const run = createStrictFalseDifferentialPort({
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
export interface StrictFalseDifferentialRunner {
  readonly probe: StrictFalseDifferentialProbe;
  readonly run: (probe: StrictFalseDifferentialProbe) => Promise<StrictFalseDifferentialRunResult>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request RBD1 used and projects ONCE before the probe exists. A failure in
 * either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveStrictFalseDifferentialRunner(
  deps: LiveStrictFalseDifferentialDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<StrictFalseDifferentialRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveStrictFalseDifferentialComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
