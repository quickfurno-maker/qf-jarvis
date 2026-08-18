/**
 * The SCHEMA_DIFFERENTIAL_DIAGNOSTIC probe port (POST-PR-131).
 *
 * ### It measures the real boundary
 *
 * Each probe goes through the SAME Groq provider the candidate uses, which means the same
 * `buildResponseFormat` — and therefore the same HF4-R7/R1 projection and strict structural checker —
 * the same `strict: true`, the same `stream:false` / `n:1` envelope, the same transport observer,
 * zero retries and zero fallback. There is no hand-built request path, because a diagnostic that
 * measured a request production cannot send would be worse than no diagnostic.
 *
 * ### The completion cap is held FIXED, and that is the point
 *
 * Every probe uses the same low cap. S11 already established that the high production cap is a
 * separate sensitive axis — D1 at 512 was accepted and D2 at 65,536 was refused on an otherwise
 * identical request. Varying the cap here as well would reintroduce that confounder into a run whose
 * entire purpose is to isolate the SCHEMA, and the result would name neither dimension.
 *
 * ### Messages are held fixed too
 *
 * The same tiny synthetic pair for every probe, carrying no client or vendor content. This matrix
 * corresponds to the S11 D5 dimension — real schema, synthetic messages, low cap — and deliberately
 * not to D7, which also swapped in the production message shape.
 */
import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import { SYNTHETIC_CANARY_MESSAGES } from './diagnostic-canary-port.js';
import type { CanaryInvocationResult, CanaryMessage } from './diagnostic-canary-port.js';
import type { SchemaProbe } from './internal/riya-schema-probe-matrix.js';
import type { SchemaProbeOutcome } from './internal/schema-differential-classification.js';

/**
 * The ONE completion cap every probe uses.
 *
 * The value S11's D1 control was accepted at. Named rather than inlined so a spec can assert it and
 * so nobody can quietly widen it to the operational Riya budget or the model ceiling.
 */
export const SCHEMA_PROBE_COMPLETION_CAP = 512;

/** A provider bound at the fixed probe cap. Injected so a spec can drive it without a credential. */
export interface SchemaProbeProviderSeam {
  invoke(input: {
    readonly runId: string;
    readonly messages: readonly CanaryMessage[];
    readonly resultMode: 'STRUCTURED';
    readonly structuredJsonSchema: unknown;
    readonly timeoutMs: number;
  }): Promise<CanaryInvocationResult>;
}

export interface SchemaProbePortDeps {
  /**
   * Build the provider for a probe. Called once per probe, always at the SAME cap.
   *
   * A factory rather than one provider, purely so a spec can observe how many were built and at what
   * cap; the cap it is handed is `SCHEMA_PROBE_COMPLETION_CAP` every time.
   */
  readonly providerForCompletionCap: (maxCompletionTokens: number) => SchemaProbeProviderSeam;
  /** The SAME run-scoped observer every probe is observed through. */
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
  /** Overridable only for specs. Production uses the fixed synthetic pair. */
  readonly messages?: readonly CanaryMessage[];
}

/**
 * Build the port.
 *
 * Each probe runs inside its own attribution window on the shared observer, exactly as a safety case
 * does, so the four content-free transport facts belong to the probe that made the request. A
 * provider that throws is a failed probe, not a thrown run: the whole point is to record what the
 * boundary did and carry on to the next probe, because the analysis needs the complete set.
 */
export function createSchemaProbePort(
  deps: SchemaProbePortDeps,
): (probe: SchemaProbe) => Promise<SchemaProbeOutcome> {
  const messages = deps.messages ?? SYNTHETIC_CANARY_MESSAGES;
  return async (probe: SchemaProbe): Promise<SchemaProbeOutcome> => {
    // The FIXED cap. Not read from the probe: a probe carries a schema, never a budget.
    const provider = deps.providerForCompletionCap(SCHEMA_PROBE_COMPLETION_CAP);
    let status = 'failed';
    await deps.observations.duringCase(probe.stepId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.schema-probe.${probe.stepId}`,
          messages,
          resultMode: 'STRUCTURED',
          // The probe's own real fragment, RAW. The provider runs the production projection.
          structuredJsonSchema: probe.schema,
          timeoutMs: deps.timeoutMs,
        });
        status = result.status;
      } catch {
        // A thrown provider is a failed probe. The thrown object is never read, so nothing it
        // carries — a path, a body, a message — can reach the record below.
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
