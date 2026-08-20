/**
 * The POST-OAD3 representative acceptance port (future live label RA1).
 *
 * ### One probe, and it is the SAME probe OAD3 planned
 *
 * This module builds nothing of its own. It calls `planOperationalAcceptance` — the exact plan OAD3
 * used — and SELECTS `O3_EXACT_REPRESENTATIVE_OPERATIONAL` out of it. A second copy of the capture,
 * the projection or the probe construction would be a second thing to keep in step with production,
 * and the whole value of RA1 is that it re-asks OAD3's unanswered question with nothing else changed.
 *
 * The other three probes are planned and then deliberately NOT sent. That costs nothing — planning is
 * pure — and it means the selected probe is byte-identical to the one OAD3 put on the wire rather
 * than a lookalike rebuilt from the same inputs.
 *
 * ### Why only O3
 *
 * OAD3 settled the rest at this budget: `O0` (minimal control) returned HTTP 200, and `O2` (the exact
 * current production Riya schema with synthetic messages) returned HTTP 200. Re-sending them would
 * spend live authorization re-proving settled facts. `O3` returned HTTP 429 — a rate limit, which is
 * the provider declining to process rather than judging the request — so it is the one question left.
 *
 * ### No retry, no pacing, no sampling
 *
 * RA1 is ONE attempt. The 429 is handled by the owner waiting before launching, which is an
 * operational decision recorded in the authorization; it is deliberately not a sleep compiled into
 * this file. Adding retry here would change the request posture production uses, and would also make
 * the receipt unable to say how many attempts a result took.
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
import { captureProductionRiyaCanaryRequest } from './diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from './diagnostic-canary-materials.js';
import { SYNTHETIC_CANARY_MESSAGES } from './diagnostic-canary-port.js';
import { planOperationalAcceptance } from './internal/operational-acceptance-plan.js';
import type { OperationalAcceptanceProbe } from './internal/operational-acceptance-plan.js';
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from './operational-acceptance-port.js';
import type { OperationalProviderSeam } from './operational-acceptance-port.js';
import type { RepresentativeAcceptanceOutcome } from './internal/representative-acceptance-classification.js';

/** The ONE step this run sends. Reused from OAD3's plan rather than redeclared. */
export const REPRESENTATIVE_ACCEPTANCE_STEP_ID = 'O3_EXACT_REPRESENTATIVE_OPERATIONAL' as const;

/**
 * The budget the probe asks for.
 *
 * Re-exported from the OAD port, which re-exports the production constant. Three names, ONE number:
 * a second literal is exactly how a diagnostic comes to measure an envelope production does not use.
 */
export const REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET = OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET;

/** Select the representative probe out of the production plan. Throws if the plan cannot supply it. */
export function selectRepresentativeProbe(input: {
  readonly projectedSchema: unknown;
  readonly representativeMessages: CapturedProductionRiyaRequest['messages'];
}): OperationalAcceptanceProbe {
  const probes = planOperationalAcceptance({
    projectedSchema: input.projectedSchema,
    syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
    representativeMessages: input.representativeMessages,
  });
  const probe = probes.find((one) => one.stepId === REPRESENTATIVE_ACCEPTANCE_STEP_ID);
  if (probe === undefined) {
    // Fails CLOSED. A run that silently sent some other probe would answer the wrong question with
    // the one authorized request.
    throw new Error('QFJ_REPRESENTATIVE_ACCEPTANCE_PROBE_NOT_PLANNED');
  }
  return probe;
}

export interface RepresentativeAcceptancePortDeps {
  readonly providerForCompletionBudget: (budget: number) => OperationalProviderSeam;
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
}

/** Build the runner for the ONE probe. Same observation discipline as every port beside it. */
export function createRepresentativeAcceptancePort(
  deps: RepresentativeAcceptancePortDeps,
): (probe: OperationalAcceptanceProbe) => Promise<RepresentativeAcceptanceOutcome> {
  return async (probe: OperationalAcceptanceProbe): Promise<RepresentativeAcceptanceOutcome> => {
    const provider = deps.providerForCompletionBudget(REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.representative-acceptance.${probe.stepId}`,
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
      stepId: REPRESENTATIVE_ACCEPTANCE_STEP_ID,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted: status === 'completed',
    });
  };
}

export interface LiveRepresentativeAcceptanceDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveRepresentativeAcceptanceComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: OperationalAcceptanceProbe;
  readonly run: (probe: OperationalAcceptanceProbe) => Promise<RepresentativeAcceptanceOutcome>;
  readonly observations: CandidateTransportObservations;
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
}

/** Build the composition over an already-captured, already-projected production request. */
export function createLiveRepresentativeAcceptanceComposition(
  deps: LiveRepresentativeAcceptanceDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveRepresentativeAcceptanceComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_REPRESENTATIVE_ACCEPTANCE_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probe = selectRepresentativeProbe({
    projectedSchema: deps.projectedSchema,
    representativeMessages: deps.captured.messages,
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
          // The per-request BUDGET; the provider clamps it against the ceiling above.
          maxCompletionTokens: budget,
          signal: new AbortController().signal,
        }),
    };
  };

  const run = createRepresentativeAcceptancePort({
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
export interface RepresentativeAcceptanceRunner {
  readonly probe: OperationalAcceptanceProbe;
  readonly run: (probe: OperationalAcceptanceProbe) => Promise<RepresentativeAcceptanceOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Credential-bound by construction, and it captures and projects ONCE before the probe exists — a
 * failure there throws, which the operator turns into a closed bind failure before any request.
 */
export async function openLiveRepresentativeAcceptanceRunner(
  deps: LiveRepresentativeAcceptanceDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<RepresentativeAcceptanceRunner> {
  const captured = deps.captured ?? (await captureProductionRiyaCanaryRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveRepresentativeAcceptanceComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
