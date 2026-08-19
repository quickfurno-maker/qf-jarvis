/**
 * The POST-SRV1 operational acceptance port and its live composition.
 *
 * ### The budget is the production one, imported not retyped
 *
 * Every probe runs at `RIYA_COMPLETION_BUDGET_TOKENS` — the governed operational budget the serving
 * path uses. It is imported from the package that derives it rather than restated here, so a second
 * literal cannot drift away from production. A spec pins its current value so an owner-visible
 * movement is loud.
 *
 * CAPABILITY and BUDGET stay separate, as everywhere else: the provider is configured at the model's
 * real ceiling and asks for the operational budget per request, so the wire carries the smaller of
 * the two with neither number misrepresented. Neither is written as a literal here — a spec asserts
 * that this file contains no second spelling of the budget at all.
 *
 * ### One capture, one projection
 *
 * The production request is captured ONCE and its schema projected ONCE. O1, O2 and O3 are all
 * derived from that single projected object, so O2 and O3 share a schema by construction rather than
 * by comparison — which is what makes their disagreement attributable to the messages alone.
 */
import {
  createFetchGroqTransport,
  createGroqProviderConfig,
  createSystemClock,
  GroqApiKey,
  GroqModelProvider,
} from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';

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
import type { CanaryMessage } from './diagnostic-canary-port.js';
import { planOperationalAcceptance } from './internal/operational-acceptance-plan.js';
import type { OperationalAcceptanceProbe } from './internal/operational-acceptance-plan.js';
import type { OperationalAcceptanceOutcome } from './internal/operational-acceptance-classification.js';

/**
 * The completion budget every O0-O3 probe asks for.
 *
 * Re-exported rather than redefined: this IS the production constant, and a diagnostic that measured
 * a different number would not be measuring the operational envelope.
 */
export const OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET = RIYA_COMPLETION_BUDGET_TOKENS;

/** What an operational provider must offer. Injected so a spec can drive it with no credential. */
export interface OperationalProviderSeam {
  invoke(input: {
    readonly runId: string;
    readonly messages: readonly CanaryMessage[];
    readonly resultMode: 'STRUCTURED';
    readonly structuredJsonSchema: unknown;
    readonly timeoutMs: number;
  }): Promise<{ readonly status: string }>;
}

export interface OperationalAcceptancePortDeps {
  /** Build the provider for one probe, bound to the per-request completion BUDGET. */
  readonly providerForCompletionBudget: (budget: number) => OperationalProviderSeam;
  /** The SAME run-scoped observer every probe is observed through. */
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
}

/**
 * Build the port.
 *
 * Each probe carries its OWN messages — that is the axis O2 and O3 vary — and runs inside its own
 * attribution window on the shared observer. A provider that throws is a failed probe, not a thrown
 * run.
 */
export function createOperationalAcceptancePort(
  deps: OperationalAcceptancePortDeps,
): (probe: OperationalAcceptanceProbe) => Promise<OperationalAcceptanceOutcome> {
  return async (probe: OperationalAcceptanceProbe): Promise<OperationalAcceptanceOutcome> => {
    const provider = deps.providerForCompletionBudget(OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.operational-acceptance.${probe.stepId}`,
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
      stepId: probe.stepId,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted: status === 'completed',
    });
  };
}

/** What the live runner needs. Everything except the credential has a production default. */
export interface LiveOperationalAcceptanceDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveOperationalAcceptanceComposition {
  readonly probes: readonly OperationalAcceptanceProbe[];
  readonly run: (probe: OperationalAcceptanceProbe) => Promise<OperationalAcceptanceOutcome>;
  readonly observations: CandidateTransportObservations;
  /** Per-request budgets asked for, in call order. Expect the operational budget each time. */
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  /** MODEL CAPABILITY ceilings the built configs declared. Expect 65,536 each. */
  readonly capabilityCeilingsUsed: () => readonly number[];
}

/** Build the composition over an already-captured, already-projected production request. */
export function createLiveOperationalAcceptanceComposition(
  deps: LiveOperationalAcceptanceDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveOperationalAcceptanceComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before any probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_OPERATIONAL_ACCEPTANCE_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probes = planOperationalAcceptance({
    projectedSchema: deps.projectedSchema,
    syntheticMessages: SYNTHETIC_CANARY_MESSAGES,
    // The CAPTURED production messages, never reconstructed.
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
          // A FRESH controller per invocation, so no probe can cancel another.
          signal: new AbortController().signal,
        }),
    };
  };

  const run = createOperationalAcceptancePort({
    providerForCompletionBudget,
    observations,
    timeoutMs: deps.captured.timeoutMs,
  });

  return Object.freeze({
    probes,
    run,
    observations,
    requestCompletionBudgetsUsed: () => Object.freeze([...requestBudgetsUsed]),
    capabilityCeilingsUsed: () => Object.freeze([...capabilityCeilingsUsed]),
  });
}

/** What the operator receives: the planned matrix, and the runner bound to the credential. */
export interface OperationalAcceptanceRunner {
  readonly probes: readonly OperationalAcceptanceProbe[];
  readonly run: (probe: OperationalAcceptanceProbe) => Promise<OperationalAcceptanceOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Credential-bound by construction, and it captures and projects ONCE before any probe exists — a
 * failure there throws, which the operator turns into a closed bind failure before O0.
 */
export async function openLiveOperationalAcceptanceRunner(
  deps: LiveOperationalAcceptanceDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<OperationalAcceptanceRunner> {
  const captured = deps.captured ?? (await captureProductionRiyaCanaryRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveOperationalAcceptanceComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probes: composition.probes, run: composition.run });
}
