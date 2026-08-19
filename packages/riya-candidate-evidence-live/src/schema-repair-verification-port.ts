/**
 * The POST-SDH4 schema-repair verification port and its live composition.
 *
 * Deliberately separate from the historical schema-differential port rather than generalised over
 * both. SDH4's evidence describes the pre-repair schema, and keeping the two provenances apart in the
 * type system is what stops a verification outcome ever being read as an SDH4 outcome.
 *
 * Everything else is the same discipline: the SAME Groq provider the candidate uses, the same
 * `buildResponseFormat` and therefore the same strict projection and checker, `strict: true`, zero
 * retries, zero fallback, one shared transport observer, and the completion cap held FIXED at the low
 * control value so the only thing varying is the schema.
 *
 * CAPABILITY and BUDGET stay separate here as they do everywhere else: the provider is configured at
 * the model's real ceiling and asks for the probe budget per request, so the wire carries
 * `min(512, 65_536)` with neither number misrepresented.
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
import type { CanaryMessage } from './diagnostic-canary-port.js';
import { planRiyaSchemaRepairVerification } from './internal/riya-schema-repair-verification-plan.js';
import type { SchemaRepairVerificationProbe } from './internal/riya-schema-repair-verification-plan.js';
import type { SchemaRepairProbeOutcome } from './internal/schema-repair-verification-classification.js';
import { SCHEMA_PROBE_COMPLETION_CAP } from './schema-probe-port.js';

/** What a verification provider must offer. Injected so a spec can drive it with no credential. */
export interface SchemaRepairProviderSeam {
  invoke(input: {
    readonly runId: string;
    readonly messages: readonly CanaryMessage[];
    readonly resultMode: 'STRUCTURED';
    readonly structuredJsonSchema: unknown;
    readonly timeoutMs: number;
  }): Promise<{ readonly status: string }>;
}

export interface SchemaRepairVerificationPortDeps {
  /** Build the provider for one probe, bound to the per-request completion BUDGET. */
  readonly providerForCompletionBudget: (budget: number) => SchemaRepairProviderSeam;
  /** The SAME run-scoped observer every probe is observed through. */
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
  readonly messages?: readonly CanaryMessage[];
}

/**
 * Build the port.
 *
 * Each probe runs inside its own attribution window on the shared observer. A provider that throws is
 * a failed probe, not a thrown run — the analysis needs the complete set.
 */
export function createSchemaRepairVerificationPort(
  deps: SchemaRepairVerificationPortDeps,
): (probe: SchemaRepairVerificationProbe) => Promise<SchemaRepairProbeOutcome> {
  const messages = deps.messages ?? SYNTHETIC_CANARY_MESSAGES;
  return async (probe: SchemaRepairVerificationProbe): Promise<SchemaRepairProbeOutcome> => {
    const provider = deps.providerForCompletionBudget(SCHEMA_PROBE_COMPLETION_CAP);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.schema-repair.${probe.stepId}`,
          messages,
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

/** What the live verification runner needs. Everything except the credential has a default. */
export interface LiveSchemaRepairVerificationDeps {
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveSchemaRepairVerificationComposition {
  readonly probes: readonly SchemaRepairVerificationProbe[];
  readonly run: (probe: SchemaRepairVerificationProbe) => Promise<SchemaRepairProbeOutcome>;
  readonly observations: CandidateTransportObservations;
  /** Per-request budgets asked for, in call order. Expect 512 each. */
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  /** MODEL CAPABILITY ceilings the built configs declared. Expect 65,536 each. */
  readonly capabilityCeilingsUsed: () => readonly number[];
}

/** Build the composition over an already-projected repaired schema. */
export function createLiveSchemaRepairVerificationComposition(
  deps: LiveSchemaRepairVerificationDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveSchemaRepairVerificationComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before any probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_SCHEMA_REPAIR_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probes = planRiyaSchemaRepairVerification(deps.projectedSchema);

  const requestBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];

  const providerForCompletionBudget = (budget: number): SchemaRepairProviderSeam => {
    requestBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_RELEASE.modelVersion,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The MODEL CAPABILITY ceiling. Never the probe budget.
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

  const run = createSchemaRepairVerificationPort({
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
export interface SchemaRepairVerificationRunner {
  readonly probes: readonly SchemaRepairVerificationProbe[];
  readonly run: (probe: SchemaRepairVerificationProbe) => Promise<SchemaRepairProbeOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Credential-bound by construction, and it captures and projects the production schema first — a
 * failure there throws, which the operator turns into a closed bind failure before V0.
 */
export async function openLiveSchemaRepairVerificationRunner(
  deps: LiveSchemaRepairVerificationDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<SchemaRepairVerificationRunner> {
  const captured = deps.captured ?? (await captureProductionRiyaCanaryRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveSchemaRepairVerificationComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probes: composition.probes, run: composition.run });
}
