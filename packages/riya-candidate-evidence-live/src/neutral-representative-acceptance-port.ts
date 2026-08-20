/**
 * The POST-RA1 neutral client acceptance port (future live label NRA1).
 *
 * ### The one thing this changes from RA1
 *
 * RA1 sent the capture selected from the SAFETY fixture manifest —
 * `CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY`, whose synthetic turn tells Riya it is the shadow
 * candidate and should treat its own answer as the final decision — and received HTTP 400 with
 * `JSON_VALIDATE_FAILED`. That receipt stands and is not reinterpreted here.
 *
 * This port sends the SAME projected production schema, at the SAME governed budget, through the SAME
 * production request builder, carrying an ORDINARY client turn instead. Provider, model, prompt bytes,
 * strict mode, capability ceiling, timeout, retry posture and fallback posture are all unchanged.
 *
 * So the client turn is the only authored difference — which is what makes NRA1 worth one request. It
 * is still not a controlled experiment, for the reason recorded in the OAD plan: the production body
 * carries no `temperature`, `top_p` or `seed`, so two calls are two independent draws. NRA1 answers
 * "does an ordinary request get through", not "was the adversarial turn the cause".
 *
 * ### One capture, one projection, one probe
 *
 * No matrix. OAD3 already settled the control and the exact synthetic schema at this budget, so there
 * is nothing left to compare against inside this run.
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
  CANDIDATE_MODEL_ID,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_RELEASE,
  CANDIDATE_SUPPORTS_STRICT_JSON,
} from './candidate-release.js';
import { createCandidateTransportObservations } from './candidate-transport-observation.js';
import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import type { CapturedProductionRiyaRequest } from './diagnostic-canary-materials.js';
import {
  NEUTRAL_CLIENT_STEP_ID,
  planNeutralClientProbe,
} from './internal/operational-acceptance-plan.js';
import type { NeutralClientProbe } from './internal/operational-acceptance-plan.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from './operational-acceptance-port.js';
import type { OperationalProviderSeam } from './operational-acceptance-port.js';
import type { RepresentativeAcceptanceOutcome } from './internal/representative-acceptance-classification.js';

/**
 * The budget the probe asks for.
 *
 * Re-exported from the OAD port, which re-exports the production constant. One number, several names,
 * never a second literal.
 */
export const NEUTRAL_REPRESENTATIVE_COMPLETION_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

export interface NeutralRepresentativePortDeps {
  readonly providerForCompletionBudget: (budget: number) => OperationalProviderSeam;
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
}

/** Build the runner for the ONE probe. Same observation discipline as every port beside it. */
export function createNeutralRepresentativePort(
  deps: NeutralRepresentativePortDeps,
): (probe: NeutralClientProbe) => Promise<RepresentativeAcceptanceOutcome> {
  return async (probe: NeutralClientProbe): Promise<RepresentativeAcceptanceOutcome> => {
    const provider = deps.providerForCompletionBudget(NEUTRAL_REPRESENTATIVE_COMPLETION_BUDGET);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.neutral-representative.${probe.stepId}`,
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
      stepId: NEUTRAL_CLIENT_STEP_ID,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted: status === 'completed',
    });
  };
}

export interface LiveNeutralRepresentativeDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveNeutralRepresentativeComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: NeutralClientProbe;
  readonly run: (probe: NeutralClientProbe) => Promise<RepresentativeAcceptanceOutcome>;
  readonly observations: CandidateTransportObservations;
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
}

/** Build the composition over an already-captured, already-projected NEUTRAL request. */
export function createLiveNeutralRepresentativeComposition(
  deps: LiveNeutralRepresentativeDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveNeutralRepresentativeComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_NEUTRAL_REPRESENTATIVE_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probe = planNeutralClientProbe({
    projectedSchema: deps.projectedSchema,
    // The CAPTURED neutral production messages, never reconstructed.
    neutralMessages: deps.captured.messages,
  });

  const requestBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];

  const providerForCompletionBudget = (budget: number): OperationalProviderSeam => {
    requestBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_RELEASE.modelVersion,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The MODEL CAPABILITY ceiling. Never the request budget.
      maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      dataControlsAttested: true,
    });
    capabilityCeilingsUsed.push(config.maxCompletionTokens);
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

  const run = createNeutralRepresentativePort({
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
  });
}

/** What the operator receives: the ONE probe, and the runner bound to the credential. */
export interface NeutralRepresentativeRunner {
  readonly probe: NeutralClientProbe;
  readonly run: (probe: NeutralClientProbe) => Promise<RepresentativeAcceptanceOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the NEUTRAL request and projects ONCE before the probe exists. A failure in either throws,
 * which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveNeutralRepresentativeRunner(
  deps: LiveNeutralRepresentativeDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<NeutralRepresentativeRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveNeutralRepresentativeComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
