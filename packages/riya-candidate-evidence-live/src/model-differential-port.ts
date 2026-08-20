/**
 * The POST-NRA1 GPT-OSS-120B strict model-differential port (future live label MD120B1).
 *
 * ### One variable, and the code is what makes that true
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` and received HTTP 400 with
 * `JSON_VALIDATE_FAILED`. This port re-sends **the same captured request** — same case, same user
 * turn, same prompt bytes, same raw schema, same projected schema, same 4,096 budget, same strict
 * mode, same timeout and retry posture — and changes only the model id in the provider config.
 *
 * It reaches that by calling `captureNeutralClientRiyaRequest()`, the identical function NRA1's port
 * calls, and by planning its probe through `planModelDifferentialProbe`, which delegates to the
 * neutral planner and overwrites nothing but the step id. There is no second capture, no second
 * fixture and no re-derived schema, so "identical except the model" is a consequence of construction.
 *
 * ### The production candidate is NOT touched
 *
 * `CANDIDATE_MODEL_ID` stays `openai/gpt-oss-20b`. The differential model is a diagnostic-only
 * constant that no production path imports, and a spec asserts both halves of that.
 *
 * The capability ceiling is deliberately held at `CANDIDATE_MAX_COMPLETION_TOKENS`. Groq documents
 * both GPT-OSS models with the same 65,536-token output maximum, so holding it fixed keeps the
 * differential to one variable rather than two.
 *
 * ### The smoke does not prove entitlement
 *
 * The governed staging smoke runs against the 20B configuration. A passing smoke says the credential
 * works; it does not say the account may call 120B. That is why a 401, 403 or 404 here is
 * INCONCLUSIVE rather than a model verdict — see the classifier.
 */
import {
  createFetchGroqTransport,
  createGroqProviderConfig,
  createSystemClock,
  GroqApiKey,
  GroqModelProvider,
} from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_SUPPORTS_STRICT_JSON,
} from './candidate-release.js';
import { createCandidateTransportObservations } from './candidate-transport-observation.js';
import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import type { CapturedProductionRiyaRequest } from './diagnostic-canary-materials.js';
import {
  MODEL_DIFFERENTIAL_STEP_ID,
  planModelDifferentialProbe,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  ModelDifferentialStepId,
} from './internal/operational-acceptance-plan.js';
import {
  MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
  MODEL_DIFFERENTIAL_CATALOG_SNAPSHOT,
} from './model-differential-identity.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from './operational-acceptance-port.js';
import type { OperationalProviderSeam } from './operational-acceptance-port.js';
import type { ModelDifferentialOutcome } from './internal/model-differential-classification.js';

/** The probe this run sends. One, ever. */
export type ModelDifferentialProbe = DiagnosticProbe<ModelDifferentialStepId>;

/**
 * The budget the probe asks for.
 *
 * Re-exported from the OAD port, which re-exports the production constant. One number, several names,
 * never a second literal — and the differential would be meaningless at any other budget.
 */
export const MODEL_DIFFERENTIAL_COMPLETION_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

export interface ModelDifferentialPortDeps {
  readonly providerForCompletionBudget: (budget: number) => OperationalProviderSeam;
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
}

/** Build the runner for the ONE probe. Same observation discipline as every port beside it. */
export function createModelDifferentialPort(
  deps: ModelDifferentialPortDeps,
): (probe: ModelDifferentialProbe) => Promise<ModelDifferentialOutcome> {
  return async (probe: ModelDifferentialProbe): Promise<ModelDifferentialOutcome> => {
    const provider = deps.providerForCompletionBudget(MODEL_DIFFERENTIAL_COMPLETION_BUDGET);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.model-differential.${probe.stepId}`,
          messages: probe.messages,
          resultMode: 'STRUCTURED',
          structuredJsonSchema: probe.schema,
          timeoutMs: deps.timeoutMs,
        });
        status = result.status;
      } catch {
        // The thrown object is never read, so nothing it carries can reach the record below.
        status = 'failed';
      }
    });
    const observed = deps.observations.observationFor(probe.stepId);
    return Object.freeze({
      stepId: MODEL_DIFFERENTIAL_STEP_ID,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted: status === 'completed',
    });
  };
}

export interface LiveModelDifferentialDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveModelDifferentialComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: ModelDifferentialProbe;
  readonly run: (probe: ModelDifferentialProbe) => Promise<ModelDifferentialOutcome>;
  readonly observations: CandidateTransportObservations;
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
  /** Model ids the built configs declared. Expect exactly one, and expect it to be 120B. */
  readonly candidateModelsUsed: () => readonly string[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveModelDifferentialComposition(
  deps: LiveModelDifferentialDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveModelDifferentialComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_MODEL_DIFFERENTIAL_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probe = planModelDifferentialProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages NRA1 sent, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const requestBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];
  const candidateModelsUsed: string[] = [];

  const providerForCompletionBudget = (budget: number): OperationalProviderSeam => {
    requestBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      // THE ONE VARIABLE. Production's `CANDIDATE_MODEL_ID` is deliberately not read here.
      modelId: MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
      modelVersion: MODEL_DIFFERENTIAL_CATALOG_SNAPSHOT,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The MODEL CAPABILITY ceiling, held FIXED: Groq documents both GPT-OSS models at 65,536, so
      // moving it would add a second variable to a one-variable differential.
      maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      dataControlsAttested: true,
    });
    capabilityCeilingsUsed.push(config.maxCompletionTokens);
    candidateModelsUsed.push(config.modelId);
    const provider = new GroqModelProvider(config, clock);
    return {
      invoke: (input) =>
        provider.invoke({
          ...input,
          maxCompletionTokens: budget,
          signal: new AbortController().signal,
        }),
    };
  };

  const run = createModelDifferentialPort({
    providerForCompletionBudget,
    observations,
    timeoutMs: deps.captured.timeoutMs,
  });

  return Object.freeze({
    probe,
    run,
    observations,
    requestCompletionBudgetsUsed: () => Object.freeze([...requestBudgetsUsed]),
    capabilityCeilingsUsed: () => Object.freeze([...capabilityCeilingsUsed]),
    candidateModelsUsed: () => Object.freeze([...candidateModelsUsed]),
  });
}

/** What the operator receives: the ONE probe, and the runner bound to the credential. */
export interface ModelDifferentialRunner {
  readonly probe: ModelDifferentialProbe;
  readonly run: (probe: ModelDifferentialProbe) => Promise<ModelDifferentialOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request NRA1 used and projects ONCE before the probe exists. A failure in
 * either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveModelDifferentialRunner(
  deps: LiveModelDifferentialDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<ModelDifferentialRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveModelDifferentialComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
