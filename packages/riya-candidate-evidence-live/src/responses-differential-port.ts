/**
 * The POST-MD120B3 Groq Responses API strict endpoint-differential port (future live label RSP20B1).
 *
 * ### One variable, and the code is what makes that true
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` over Chat Completions and
 * received HTTP 400 with `JSON_VALIDATE_FAILED`. MD120B3 sent the same request to
 * `openai/gpt-oss-120b` and received the same 400 with the same code. The model is not the axis.
 *
 * This port re-sends **the same captured request** — same case, same system bytes, same user bytes,
 * same role sequence, same raw schema, same projected schema, same 4,096 output bound, same strict
 * mode, same timeout, same zero-retry posture, same production 20B model — and changes only the
 * provider ENDPOINT and the envelope that endpoint requires.
 *
 * It reaches that by calling `captureNeutralClientRiyaRequest()`, the identical function NRA1's and
 * MD120B3's ports call, and by planning its probe through `planResponsesDifferentialProbe`, which
 * delegates to the neutral planner and overwrites nothing but the step id and the dimension label.
 * There is no second capture, no second fixture and no re-derived schema, so "identical except the
 * endpoint" is a consequence of construction rather than a claim in a comment.
 *
 * ### The model is the PRODUCTION candidate, deliberately
 *
 * `MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID` is not read here and 120B never reaches this wire. The
 * config is built with `CANDIDATE_MODEL_ID` itself — the same constant production routing uses — so a
 * regression that moved the model would have to move production with it.
 *
 * The capability ceiling stays `CANDIDATE_MAX_COMPLETION_TOKENS`. Every earlier gate held it there
 * and moving it would add a second variable to a one-variable differential.
 *
 * ### §8: the output bound is asserted, not inferred from a name
 *
 * Chat Completions bounds output with `max_completion_tokens`; the Responses API bounds it with
 * `max_output_tokens`. Those are two names and the equivalence is a claim, so this port does not rest
 * on it: {@link RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET} is the SAME constant every earlier gate used —
 * re-exported, never a second literal — and a spec reads the emitted request body and asserts the
 * integer 4,096 landed in the Responses field.
 *
 * ### A 2xx is not the finding — and neither is a wire-shaped document
 *
 * Every earlier gate stopped at the provider boundary because every earlier gate asked whether the
 * provider would ACCEPT the request. This one asks whether a different output contract yields a
 * usable Riya reply.
 *
 * A first revision answered that with `structuredSchema.safeParse`. That was wrong, and wrong in the
 * expensive direction. `safeParse` is the FIRST STAGE of production acceptance — it establishes the
 * document has the shape the provider was asked for. Production then still requires the profile's
 * `projectStructuredResult` to succeed, which additionally checks grounded citations, rebuilds the
 * observation batch through its canonical constructor (combined duplicate, conflict and limit
 * invariants), validates every asserted service and location ref against the availability snapshot,
 * runs the deterministic reducer, checks the PROSPECTIVE state, and requires the model's claimed
 * next-question plan to agree with the reducer's exactly — phase and field order included.
 *
 * A document can pass the wire schema and fail every one of those. Reporting such a document as
 * `RESPONSES_20B_STRICT_ACCEPTED` would be a FALSE-POSITIVE endpoint verdict: it would tell an owner
 * the Responses API repairs the path when production would refuse the very answer it returned.
 *
 * So the verdict runs the FULL production projector, carried through the capture and built by the
 * same function `runRiyaEvaluationTurn` builds its profile with. The projection is consumed as a
 * presence check and discarded in the same statement. Nothing about the document or the projection —
 * not its shape, its length, its keys or its reply text — reaches the outcome record: two booleans do.
 *
 * ### The smoke does not prove entitlement
 *
 * The governed staging smoke runs against the 20B Chat Completions configuration. A passing smoke
 * says the credential works there; it does not say the project may call `/openai/v1/responses`, which
 * Groq currently ships as beta. That is why a 401, 403 or 404 here is INCONCLUSIVE rather than an
 * endpoint verdict — see the classifier.
 */
import {
  createFetchGroqResponsesTransport,
  createGroqProviderConfig,
  createGroqResponsesDiagnosticProvider,
  createSystemClock,
  GroqApiKey,
} from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';

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
  planResponsesDifferentialProbe,
  RESPONSES_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  ResponsesDifferentialStepId,
} from './internal/operational-acceptance-plan.js';
import type { ResponsesDifferentialOutcome } from './internal/responses-differential-classification.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from './operational-acceptance-port.js';
import { RESPONSES_DIFFERENTIAL_SCHEMA_NAME } from './responses-differential-identity.js';

/** The probe this run sends. One, ever. */
export type ResponsesDifferentialProbe = DiagnosticProbe<ResponsesDifferentialStepId>;

/**
 * The provider output bound the probe asks for.
 *
 * Re-exported from the OAD port, which re-exports the production constant. One number, several names,
 * never a second literal — and the differential would be meaningless at any other bound.
 *
 * It reaches the wire as the Responses API's `max_output_tokens` rather than Chat Completions'
 * `max_completion_tokens`. That renaming is the endpoint's, not this run's, and the VALUE is asserted
 * on the emitted body rather than assumed from the name.
 */
export const RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

/** The narrow seam the port invokes. Deliberately not the gateway's provider contract. */
export interface ResponsesProviderSeam {
  readonly invoke: (input: {
    readonly messages: readonly {
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }[];
    readonly structuredJsonSchema: unknown;
    readonly schemaName: string;
    readonly maxOutputTokens: number;
    readonly signal: AbortSignal;
  }) => Promise<{ readonly providerCompleted: boolean; readonly structuredValue?: unknown }>;
}

export interface ResponsesDifferentialPortDeps {
  readonly providerForOutputBudget: (budget: number) => ResponsesProviderSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Injected rather than imported so the port cannot acquire a second opinion about what production
   * accepts: the only projector it can run is the one built for the captured request, by the same
   * function the evaluation turn uses.
   *
   * Deliberately NOT the wire schema. A port handed `structuredSchema` could only ever prove shape,
   * and this gate exists to prove more than shape.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
}

/** Build the runner for the ONE probe. Same observation discipline as every port beside it. */
export function createResponsesDifferentialPort(
  deps: ResponsesDifferentialPortDeps,
): (probe: ResponsesDifferentialProbe) => Promise<ResponsesDifferentialOutcome> {
  return async (probe: ResponsesDifferentialProbe): Promise<ResponsesDifferentialOutcome> => {
    const provider = deps.providerForOutputBudget(RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET);
    let providerCompleted = false;
    let localValidationCompleted = false;
    let localValidationPassed = false;
    await deps.observations.duringCase(probe.stepId, async () => {
      let structuredValue: unknown;
      try {
        const result = await provider.invoke({
          messages: probe.messages,
          structuredJsonSchema: probe.schema,
          schemaName: RESPONSES_DIFFERENTIAL_SCHEMA_NAME,
          maxOutputTokens: RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET,
          signal: new AbortController().signal,
        });
        providerCompleted = result.providerCompleted;
        structuredValue = result.structuredValue;
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
      // The FULL production acceptance authority, run exactly as the M4 adapter runs it. Wire-shape
      // parsing is its first stage and emphatically not its last.
      //
      // The projection is consumed as a presence check and discarded in this statement: only the
      // boolean survives it. A projector that throws is a refusal like any other — the adapter
      // documents `undefined` or a throw as the same outcome — and the thrown object is never read.
      localValidationCompleted = true;
      try {
        localValidationPassed = deps.projectStructuredResult(structuredValue) !== undefined;
      } catch {
        localValidationPassed = false;
      }
    });
    const observed = deps.observations.observationFor(probe.stepId);
    return Object.freeze({
      stepId: RESPONSES_DIFFERENTIAL_STEP_ID,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted,
      localValidationCompleted,
      localValidationPassed,
    });
  };
}

export interface LiveResponsesDifferentialDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqResponsesTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveResponsesDifferentialComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: ResponsesDifferentialProbe;
  readonly run: (probe: ResponsesDifferentialProbe) => Promise<ResponsesDifferentialOutcome>;
  readonly observations: CandidateTransportObservations;
  readonly requestOutputBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
  /** Model ids the built configs declared. Expect exactly one, and expect it to be the production 20B. */
  readonly candidateModelsUsed: () => readonly string[];
  /** Endpoint URLs the built transports were asked for. Expect exactly the Responses endpoint. */
  readonly endpointsUsed: () => readonly string[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveResponsesDifferentialComposition(
  deps: LiveResponsesDifferentialDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveResponsesDifferentialComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_RESPONSES_DIFFERENTIAL_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const endpointsUsed: string[] = [];
  // THE ONE VARIABLE. The Chat Completions transport factory is deliberately not read here, and its
  // SSRF guard would refuse this endpoint anyway — the two transports cannot reach each other's URL.
  const underlying = (deps.openTransport ?? createFetchGroqResponsesTransport)();
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
  const probe = planResponsesDifferentialProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages NRA1 sent, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const requestOutputBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];
  const candidateModelsUsed: string[] = [];

  const providerForOutputBudget = (budget: number): ResponsesProviderSeam => {
    requestOutputBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      // The PRODUCTION candidate. The model is the thing this differential holds fixed.
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
    const provider = createGroqResponsesDiagnosticProvider(config, clock);
    return {
      invoke: (input) => provider.invoke({ ...input, maxOutputTokens: budget }),
    };
  };

  const run = createResponsesDifferentialPort({
    providerForOutputBudget,
    observations,
    // The FULL projector, never `deps.captured.structuredWireSchema`. Shape is not acceptance.
    projectStructuredResult: deps.captured.projectStructuredResult,
  });

  return Object.freeze({
    probe,
    run,
    observations,
    requestOutputBudgetsUsed: () => Object.freeze([...requestOutputBudgetsUsed]),
    capabilityCeilingsUsed: () => Object.freeze([...capabilityCeilingsUsed]),
    candidateModelsUsed: () => Object.freeze([...candidateModelsUsed]),
    endpointsUsed: () => Object.freeze([...endpointsUsed]),
  });
}

/** What the operator receives: the ONE probe, and the runner bound to the credential. */
export interface ResponsesDifferentialRunner {
  readonly probe: ResponsesDifferentialProbe;
  readonly run: (probe: ResponsesDifferentialProbe) => Promise<ResponsesDifferentialOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request NRA1 used and projects ONCE before the probe exists. A failure in
 * either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveResponsesDifferentialRunner(
  deps: LiveResponsesDifferentialDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<ResponsesDifferentialRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveResponsesDifferentialComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
