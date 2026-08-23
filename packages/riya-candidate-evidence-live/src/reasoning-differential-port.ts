/**
 * The POST-RSP20B2 `reasoning_effort='low'` differential port (future live label RLD1).
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
 * the step id and the dimension label. There is no second capture, no second fixture and no
 * re-derived schema.
 *
 * ### The adapter is the MERGED diagnostic one, and no new adapter exists
 *
 * `createGroqChatReasoningDiagnosticProvider` was reviewed and merged separately, with a spec
 * proving its body is the production body plus exactly `reasoning_effort` and that both adapters
 * classify an identical response identically. This port composes it and adds nothing to the wire.
 * `GroqModelProvider` is not touched, is not imported here, and production routing is unchanged.
 *
 * ### Usage is PROPAGATED, which the historical seams could not do
 *
 * Every earlier one-probe seam narrows the provider result to `{ providerCompleted, structuredValue }`
 * and the operator settles `ledger.settle(undefined, …)`. That is why RSP20B2's receipt printed
 * `outputTokensTotal=65622` — a 65,536 fallback BOUND, not a measurement.
 *
 * This seam returns `usage` as well, so a completion that reports real token counts settles with
 * them. When the provider reports nothing the ledger still bounds it, and the R2 provenance posture
 * makes the difference visible on the receipt rather than leaving a bound to read as an observation.
 *
 * Historical seams are deliberately NOT widened here. This is one lane, and a bulk change to seams
 * whose receipts are already written would be a second, unreviewed variable.
 *
 * ### A 2xx is not the finding
 *
 * The verdict runs the FULL production projector — grounded citations, the canonical observation
 * batch, availability refs, the deterministic reducer, the prospective state, the next-question plan
 * — carried through the capture and built by the same function `runRiyaEvaluationTurn` uses. Wire
 * `safeParse` is its first stage and nothing more. The projection is consumed as a presence check and
 * discarded in the same statement: two booleans survive it, and nothing about the document does.
 */
import {
  createFetchGroqTransport,
  createGroqChatReasoningDiagnosticProvider,
  createGroqProviderConfig,
  createSystemClock,
  GroqApiKey,
} from '@qf-jarvis/model-gateway';
import type {
  GroqGptOssReasoningEffort,
  GroqTransport,
  ModelUsage,
} from '@qf-jarvis/model-gateway';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_SUPPORTS_STRICT_JSON,
  CANDIDATE_CATALOG_SNAPSHOT,
} from './candidate-release.js';
import { createCandidateTransportObservations } from './candidate-transport-observation.js';
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
 * Holding it fixed matters more here than anywhere else: reasoning tokens are drawn from THIS budget,
 * so moving it would change the very quantity the effort setting competes for and make the result
 * uninterpretable.
 */
export const REASONING_DIFFERENTIAL_OUTPUT_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

/**
 * What the port learned from one invocation. Narrow, and deliberately wider than its predecessors by
 * exactly one field.
 */
export interface ReasoningProviderSeamResult {
  readonly providerCompleted: boolean;
  readonly structuredValue?: unknown;
  /** Present only when the provider REPORTED usage. Absent is absent, never zero. */
  readonly usage?: ModelUsage;
}

/** The narrow seam the port invokes. Deliberately not the gateway's provider contract. */
export interface ReasoningProviderSeam {
  readonly invoke: (input: {
    readonly messages: readonly {
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }[];
    readonly structuredJsonSchema: unknown;
    readonly maxCompletionTokens: number;
    readonly reasoningEffort: GroqGptOssReasoningEffort;
    readonly signal: AbortSignal;
  }) => Promise<ReasoningProviderSeamResult>;
}

export interface ReasoningDifferentialPortDeps {
  readonly providerForCompletionBudget: (budget: number) => ReasoningProviderSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Injected rather than imported so the port cannot acquire a second opinion about what production
   * accepts: the only projector it can run is the one built for the captured request, by the same
   * function the evaluation turn uses.
   *
   * Deliberately NOT the wire schema. A port handed `structuredWireSchema` could only ever prove
   * shape, and this gate exists to prove more than shape.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
}

/** What one probe run produced: the outcome record, and the usage the ledger must settle with. */
export interface ReasoningDifferentialRunResult {
  readonly outcome: ReasoningDifferentialOutcome;
  /**
   * The provider-reported usage, when there was any.
   *
   * Handed to the operator so it can call `ledger.settle(usage, …)` rather than
   * `ledger.settle(undefined, …)`. Absent means the provider reported nothing, and the ledger's
   * conservative bound then applies and is labelled as one.
   */
  readonly usage?: ModelUsage;
}

/** Build the runner for the ONE probe. Same observation discipline as every port beside it. */
export function createReasoningDifferentialPort(
  deps: ReasoningDifferentialPortDeps,
): (probe: ReasoningDifferentialProbe) => Promise<ReasoningDifferentialRunResult> {
  return async (probe: ReasoningDifferentialProbe): Promise<ReasoningDifferentialRunResult> => {
    const provider = deps.providerForCompletionBudget(REASONING_DIFFERENTIAL_OUTPUT_BUDGET);
    let providerCompleted = false;
    let localValidationCompleted = false;
    let localValidationPassed = false;
    let usage: ModelUsage | undefined;
    await deps.observations.duringCase(probe.stepId, async () => {
      let structuredValue: unknown;
      try {
        const result = await provider.invoke({
          messages: probe.messages,
          structuredJsonSchema: probe.schema,
          maxCompletionTokens: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
          // THE ONE VARIABLE.
          reasoningEffort: REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
          signal: new AbortController().signal,
        });
        providerCompleted = result.providerCompleted;
        structuredValue = result.structuredValue;
        // Token COUNTS only. The gateway's `ModelUsage` carries integers and nothing else — no text,
        // no ids, no headers — so propagating it cannot carry content out of the provider boundary.
        usage = result.usage;
      } catch {
        // The thrown object is never read, so nothing it carries can reach the record below.
        providerCompleted = false;
        return;
      }
      if (!providerCompleted) {
        // Nothing came back to validate. The projector is NOT run, and a check that never ran must
        // not report a verdict — `localValidationCompleted` stays false and the classifier reads it.
        return;
      }
      // The FULL production acceptance authority, run exactly as the M4 adapter runs it.
      //
      // The projection is consumed as a presence check and discarded in this statement: only the
      // boolean survives it. A projector that throws is a refusal like any other, and the thrown
      // object is never read.
      localValidationCompleted = true;
      try {
        localValidationPassed = deps.projectStructuredResult(structuredValue) !== undefined;
      } catch {
        localValidationPassed = false;
      }
    });
    const observed = deps.observations.observationFor(probe.stepId);
    const outcome: ReasoningDifferentialOutcome = Object.freeze({
      stepId: REASONING_DIFFERENTIAL_STEP_ID,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted,
      localValidationCompleted,
      localValidationPassed,
    });
    return Object.freeze({ outcome, ...(usage === undefined ? {} : { usage }) });
  };
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
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_REASONING_DIFFERENTIAL_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const endpointsUsed: string[] = [];
  // The PRODUCTION Chat Completions transport. The endpoint is the thing this run holds fixed, and
  // the Responses transport factory is deliberately not read here.
  const underlying = (deps.openTransport ?? createFetchGroqTransport)();
  const observedTransport = observations.observe(
    Object.freeze({
      send: (request: Parameters<GroqTransport['send']>[0], signal: AbortSignal) => {
        // Recorded so a spec can assert the CONTRACT on the wire rather than trusting the factory
        // name. The URL is an endpoint identifier, never request content.
        endpointsUsed.push(request.url);
        return underlying.send(request, signal);
      },
    }),
  );
  const probe = planReasoningDifferentialProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages NRA1 sent, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const requestCompletionBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];
  const candidateModelsUsed: string[] = [];
  const reasoningEffortsUsed: GroqGptOssReasoningEffort[] = [];

  const providerForCompletionBudget = (budget: number): ReasoningProviderSeam => {
    requestCompletionBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      // The PRODUCTION candidate. The model is a thing this differential holds fixed.
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_CATALOG_SNAPSHOT,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The MODEL CAPABILITY ceiling, held FIXED at the value every earlier gate used.
      maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      dataControlsAttested: true,
    });
    capabilityCeilingsUsed.push(config.maxCompletionTokens);
    candidateModelsUsed.push(config.modelId);
    // The MERGED, separately reviewed diagnostic adapter. No new adapter is created by this lane.
    const provider = createGroqChatReasoningDiagnosticProvider(config, clock);
    return {
      invoke: async (input) => {
        reasoningEffortsUsed.push(input.reasoningEffort);
        const result = await provider.invoke({ ...input, maxCompletionTokens: budget });
        if (result.status !== 'completed') {
          // A non-completion carries no usage worth settling. The transport observation already
          // recorded WHAT happened; nothing else about the result is read.
          return { providerCompleted: false };
        }
        return {
          providerCompleted: true,
          ...(result.output.mode === 'STRUCTURED' ? { structuredValue: result.output.value } : {}),
          // Propagated when the provider reported it. This is the field the historical seams dropped.
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        };
      },
    };
  };

  const run = createReasoningDifferentialPort({
    providerForCompletionBudget,
    observations,
    // The FULL projector, never `deps.captured.structuredWireSchema`. Shape is not acceptance.
    projectStructuredResult: deps.captured.projectStructuredResult,
  });

  return Object.freeze({
    probe,
    run,
    observations,
    requestCompletionBudgetsUsed: () => Object.freeze([...requestCompletionBudgetsUsed]),
    capabilityCeilingsUsed: () => Object.freeze([...capabilityCeilingsUsed]),
    candidateModelsUsed: () => Object.freeze([...candidateModelsUsed]),
    endpointsUsed: () => Object.freeze([...endpointsUsed]),
    reasoningEffortsUsed: () => Object.freeze([...reasoningEffortsUsed]),
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
