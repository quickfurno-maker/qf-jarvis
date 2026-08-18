/**
 * The REQUEST_CONTRACT_DIAGNOSTIC canary port (MVP-P2A.2 HF4-R8).
 *
 * ### It measures the real boundary
 *
 * Each canary is sent through the SAME Groq provider the candidate uses, which means the same
 * `buildResponseFormat` — and therefore the same HF4-R7 projection and the same strict structural
 * checker — the same `strict: true`, the same `stream:false` / `n:1` envelope, the same transport
 * observer, zero retries and zero fallback. There is no hand-built request path here, because a
 * diagnostic that measured a request production cannot send would be worse than no diagnostic.
 *
 * ### The completion cap has to be varied by rebuilding the provider, and that IS the finding
 *
 * `ProviderInvocationInput` carries no per-request completion bound. `GroqModelProvider` puts
 * `this.config.maxCompletionTokens` on the wire for every invocation, and the candidate release sets
 * that to `CANDIDATE_MAX_COMPLETION_TOKENS` = 65,536 — the MODEL ceiling — even though the release's
 * own comments say the operator sends far smaller requests.
 *
 * So this port cannot ask for a 512-token cap on one request and 65,536 on the next; it has to ask for
 * a provider built at each cap. That awkwardness is not incidental — it is the audit finding, made
 * concrete. R8 deliberately does NOT change it: S10 gives a recurring 400 but not the causal
 * dimension, and the D1/D2, D5/D6 and D7/D8 pairs exist to establish whether the cap is that
 * dimension before anything in production moves.
 */
import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import type { DiagnosticCanary } from './diagnostic-canaries.js';
import {
  CANARY_SYNTHETIC_SYSTEM_MESSAGE,
  CANARY_SYNTHETIC_USER_MESSAGE,
} from './diagnostic-canaries.js';
import type { CanaryOutcome } from './internal/diagnostic-classification.js';

/**
 * One message, in the provider-neutral shape the gateway and the provider both speak.
 *
 * The role union is the PROVIDER's, not a narrower one of this module's choosing (HF4-R8-R1). D7/D8
 * carry the request production actually assembles, captured rather than reconstructed, and a union
 * that could not express one of its roles would force a filter — which would make the exact
 * production shape into an approximation of it.
 */
export interface CanaryMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** What a provider invocation reported. The narrow slice this port reads, and nothing more. */
export interface CanaryInvocationResult {
  readonly status: string;
}

/**
 * A provider bound at ONE completion cap.
 *
 * Deliberately a factory keyed by cap rather than a per-request parameter: see the module note. The
 * seam is injected so a spec can drive every canary without a credential, a network or a provider.
 */
export interface DiagnosticProviderSeam {
  invoke(input: {
    readonly runId: string;
    readonly messages: readonly CanaryMessage[];
    readonly resultMode: 'STRUCTURED';
    readonly structuredJsonSchema: unknown;
    readonly timeoutMs: number;
  }): Promise<CanaryInvocationResult>;
}

export interface DiagnosticCanaryPortDeps {
  /** Build a provider bound at exactly this `max_completion_tokens`. Called once per canary. */
  readonly providerForCompletionCap: (maxCompletionTokens: number) => DiagnosticProviderSeam;
  /**
   * The RAW provider-neutral JSON Schema for a canary, before projection.
   *
   * Raw, not projected: the provider must run the production projection itself, so the diagnostic
   * exercises that code rather than pre-empting it. A canary whose schema arrived already projected
   * would silently skip the very step HF4-R7/R1 added.
   */
  readonly rawSchemaFor: (canary: DiagnosticCanary) => unknown;
  /** The messages for a canary. Synthetic for D1-D6; the real production builder for D7/D8. */
  readonly messagesFor: (canary: DiagnosticCanary) => readonly CanaryMessage[];
  /** The SAME run-scoped observer the candidate uses, so a canary is observed identically. */
  readonly observations: CandidateTransportObservations;
  readonly timeoutMs: number;
}

/** The fixed synthetic messages D1-D6 carry. Named so a spec can assert D7/D8 do NOT use them. */
export const SYNTHETIC_CANARY_MESSAGES: readonly CanaryMessage[] = Object.freeze([
  Object.freeze({ role: 'system' as const, content: CANARY_SYNTHETIC_SYSTEM_MESSAGE }),
  Object.freeze({ role: 'user' as const, content: CANARY_SYNTHETIC_USER_MESSAGE }),
]);

/**
 * Build the port.
 *
 * Each canary runs inside its own attribution window on the shared observer, exactly as a safety case
 * does, so the four content-free transport facts belong to the canary that made the request. A
 * provider that throws is a failed canary, not a thrown run: the whole point is to record what the
 * boundary did and carry on to the next axis.
 */
export function createDiagnosticCanaryPort(
  deps: DiagnosticCanaryPortDeps,
): (canary: DiagnosticCanary) => Promise<CanaryOutcome> {
  return async (canary: DiagnosticCanary): Promise<CanaryOutcome> => {
    const provider = deps.providerForCompletionCap(canary.maxCompletionTokens);
    let status = 'failed';
    await deps.observations.duringCase(canary.canaryId, async () => {
      try {
        const result = await provider.invoke({
          runId: `qfj.diagnostic.${canary.canaryId}`,
          messages: deps.messagesFor(canary),
          resultMode: 'STRUCTURED',
          structuredJsonSchema: deps.rawSchemaFor(canary),
          timeoutMs: deps.timeoutMs,
        });
        status = result.status;
      } catch {
        // A thrown provider is a failed canary. The thrown object is never read, so nothing it
        // carries — a path, a body, a message — can reach the record below.
        status = 'failed';
      }
    });

    const observed = deps.observations.observationFor(canary.canaryId);
    return Object.freeze({
      canaryId: canary.canaryId,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted: status === 'completed',
    });
  };
}
