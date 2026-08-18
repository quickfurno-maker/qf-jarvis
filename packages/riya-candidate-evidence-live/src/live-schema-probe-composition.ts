/**
 * The LIVE composition of the schema differential diagnostic (POST-PR-131).
 *
 * ### Wired, because a reviewed seam nobody binds is worthless
 *
 * HF4-R8 shipped a complete canary port and `bin.ts` never passed it, so the compiled command was
 * guaranteed to spend preflight, the smoke request and both credential steps and then return
 * `INTERNAL_CLOSED_FAILURE` having run nothing. That defect cost a whole review round. This
 * composition is bound by the executable from the day it exists, and a spec drives the same
 * composition end to end with a fake transport.
 *
 * ### One credential, one observer, ONE cap
 *
 * The runner is bound to the credential the operator ALREADY resolved: it opens no second ingress,
 * constructs no second holder, reads no environment and takes no key from argv, stdin or a file.
 *
 * One `CandidateTransportObservations` recorder and one observed transport serve all nine probes, so
 * a per-probe observation is a fact about that probe's own attribution window.
 *
 * Every probe is built at `SCHEMA_PROBE_COMPLETION_CAP`. The cap is a constant here, not a per-probe
 * field — S11 proved the high cap is its own sensitive axis, and a schema-isolation run that also
 * varied it would isolate nothing.
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
import type { SchemaProbe } from './internal/riya-schema-probe-matrix.js';
import { planRiyaSchemaProbeMatrix } from './internal/riya-schema-probe-matrix.js';
import type { SchemaProbeOutcome } from './internal/schema-differential-classification.js';
import { createSchemaProbePort, SCHEMA_PROBE_COMPLETION_CAP } from './schema-probe-port.js';
import type { SchemaProbeProviderSeam } from './schema-probe-port.js';

/** What the live schema probe runner needs. Everything except the credential has a default. */
export interface LiveSchemaProbeDeps {
  /**
   * The candidate credential the operator already resolved.
   *
   * `unknown` because the operator's seam is provider-neutral. It is narrowed HERE, once, and a value
   * that is not a real `GroqApiKey` is refused rather than coerced.
   */
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  /** The projected schema and production timeout, already captured. Specs may inject one. */
  readonly captured?: CapturedProductionRiyaRequest;
  /** The projected document to probe. Specs may inject one; production projects the captured schema. */
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveSchemaProbeComposition {
  readonly probes: readonly SchemaProbe[];
  readonly run: (probe: SchemaProbe) => Promise<SchemaProbeOutcome>;
  /** The ONE recorder every probe is observed through. */
  readonly observations: CandidateTransportObservations;
  /** The exact completion caps handed to `createGroqProviderConfig`, in call order. */
  readonly completionCapsUsed: () => readonly number[];
}

/** Build the composition over an already-projected schema. */
export function createLiveSchemaProbeComposition(
  deps: LiveSchemaProbeDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveSchemaProbeComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before any probe. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_SCHEMA_PROBE_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  // ONE transport, observed ONCE. Every provider receives this exact object, so there is no per-probe
  // observer and no unobserved path to the wire.
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const probes = planRiyaSchemaProbeMatrix(deps.projectedSchema);

  const capsUsed: number[] = [];
  const providerForCompletionCap = (maxCompletionTokens: number): SchemaProbeProviderSeam => {
    capsUsed.push(maxCompletionTokens);
    // The candidate's own identity at every field. Only the completion budget differs from a serving
    // request, and it differs to the fixed low probe cap rather than to anything a probe chose.
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_RELEASE.modelVersion,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The provider clamps a request budget against this ceiling, so the config ceiling IS the probe
      // cap here — a probe cannot inherit the model maximum even by accident.
      maxCompletionTokens,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      // Proven by preflight from the governed attestation, exactly as the candidate gateway proves it.
      dataControlsAttested: true,
    });
    const provider = new GroqModelProvider(config, clock);
    return {
      invoke: (input) =>
        // The ONE thing this wrapper adds: a FRESH controller per invocation, so every probe carries a
        // live non-aborted signal and no probe can cancel another.
        provider.invoke({
          ...input,
          maxCompletionTokens: SCHEMA_PROBE_COMPLETION_CAP,
          signal: new AbortController().signal,
        }),
    };
  };

  const run = createSchemaProbePort({
    providerForCompletionCap,
    observations,
    // The production timeout, read off the captured request rather than restated here.
    timeoutMs: deps.captured.timeoutMs,
  });

  return Object.freeze({
    probes,
    run,
    observations,
    completionCapsUsed: () => Object.freeze([...capsUsed]),
  });
}

/** What the operator receives: the planned matrix, and the runner bound to the credential. */
export interface SchemaProbeRunner {
  readonly probes: readonly SchemaProbe[];
  readonly run: (probe: SchemaProbe) => Promise<SchemaProbeOutcome>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Credential-bound by construction: the operator calls it AFTER the candidate credential is resolved
 * and hands that credential in, so there is no window in which a probe runner exists holding a
 * credential nobody read. It captures and projects the production schema first — a failure there
 * throws, which the operator turns into a closed bind failure before R0 rather than nine probes built
 * from a document that could not be assembled.
 */
export async function openLiveSchemaProbeRunner(
  deps: LiveSchemaProbeDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<SchemaProbeRunner> {
  const captured = deps.captured ?? (await captureProductionRiyaCanaryRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveSchemaProbeComposition({ ...deps, captured, projectedSchema });
  return Object.freeze({ probes: composition.probes, run: composition.run });
}
