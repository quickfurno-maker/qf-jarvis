/**
 * The LIVE composition of the request-contract diagnostic (MVP-P2A.2 HF4-R8-R1).
 *
 * ### The defect this closes
 *
 * R8 shipped every piece of the diagnostic and wired none of them into the executable. The CLI
 * accepted `--run-goal REQUEST_CONTRACT_DIAGNOSTIC`, `ledgerForRunGoal` selected the nine-request
 * ledger, the operator had a canary seam and failed closed when it was absent — and `bin.ts` never
 * passed one. So the real command was guaranteed to run preflight, open the credential ingress, spend
 * the text smoke request, resolve the candidate credential, reach the diagnostic branch, find no
 * port, and return `INTERNAL_CLOSED_FAILURE` having run zero canaries.
 *
 * That is worse than a missing feature. A future owner-authorized run is CONSUMED at process launch,
 * so it would have burned its one authorization after the smoke and learned nothing — the exact
 * failure mode the harness was built to prevent. The composition tested is now the composition the
 * executable uses, and a spec drives it end to end with fake transports so the wire cannot be missing
 * again without a test failing.
 *
 * ### One credential, one observer, two caps
 *
 * The runner is bound to the credential the operator ALREADY resolved. It opens no second ingress,
 * constructs no second holder, reads no environment and takes no key from argv, stdin or a file: the
 * `GroqApiKey` object handed in is the object every cap provider receives, provable by identity.
 *
 * One `CandidateTransportObservations` recorder and one observed transport serve all eight canaries,
 * so a per-canary observation is a fact about that canary's own attribution window rather than about
 * a recorder that only saw part of the run.
 *
 * The completion cap is the axis under test and `ProviderInvocationInput` carries no per-request
 * bound, so a cap is expressed the only way the provider allows: a config built at that cap. That
 * awkwardness is the audit finding R8 pinned, and R8-R1 still does not change it — it measures it.
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
import {
  captureProductionRiyaCanaryRequest,
  createDiagnosticCanaryMaterials,
} from './diagnostic-canary-materials.js';
import type { CapturedProductionRiyaRequest } from './diagnostic-canary-materials.js';
import type { DiagnosticCanary } from './diagnostic-canaries.js';
import { createDiagnosticCanaryPort } from './diagnostic-canary-port.js';
import type { CanaryInvocationResult, DiagnosticProviderSeam } from './diagnostic-canary-port.js';
import type { CanaryOutcome } from './internal/diagnostic-classification.js';

/** What the live runner needs. Everything except the credential has a production default. */
export interface LiveDiagnosticCanaryDeps {
  /**
   * The candidate credential the operator already resolved.
   *
   * `unknown` because the operator's seam is provider-neutral. It is narrowed HERE, once, and a value
   * that is not a real `GroqApiKey` is refused rather than coerced — a diagnostic that ran against a
   * credential nobody resolved would be measuring the wrong account.
   */
  readonly credential: unknown;
  /** Production: `createFetchGroqTransport()`. Specs: a deterministic fake. Never both. */
  readonly openTransport?: () => GroqTransport;
  /** The production request, already captured. Specs inject one; production captures it here. */
  readonly captured?: CapturedProductionRiyaRequest;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveDiagnosticCanaryComposition {
  readonly run: (canary: DiagnosticCanary) => Promise<CanaryOutcome>;
  /** The ONE recorder every canary is observed through. */
  readonly observations: CandidateTransportObservations;
  /** The exact completion caps handed to `createGroqProviderConfig`, in call order. */
  readonly completionCapsUsed: () => readonly number[];
  /** How many provider configurations were built. One per canary invocation. */
  readonly providerBuilds: () => number;
  readonly captured: CapturedProductionRiyaRequest;
}

/**
 * Build the composition.
 *
 * Exported separately from {@link openLiveDiagnosticCanaryRunner} so a spec can reach the recorder and
 * the cap sequence without a second wiring existing — the runner below is this function plus the one
 * narrowing every production caller needs.
 */
export function createLiveDiagnosticCanaryComposition(
  deps: LiveDiagnosticCanaryDeps & { readonly captured: CapturedProductionRiyaRequest },
): LiveDiagnosticCanaryComposition {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before any canary. Nothing about the value is read, printed or retained.
    throw new Error('QFJ_DIAGNOSTIC_CREDENTIAL_NOT_BOUND');
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  // ONE transport, observed ONCE. Every cap provider receives this exact object, so there is no
  // per-canary observer and no unobserved path to the wire.
  const observedTransport = observations.observe(
    (deps.openTransport ?? createFetchGroqTransport)(),
  );
  const materials = createDiagnosticCanaryMaterials(deps.captured);

  const capsUsed: number[] = [];

  const providerForCompletionCap = (maxCompletionTokens: number): DiagnosticProviderSeam => {
    capsUsed.push(maxCompletionTokens);
    // The candidate's own identity at every field except the cap under test. Same provider, same
    // model, same declared input ceiling, same strict-schema support, same credential, same
    // transport — so a difference between two canaries is the cap and nothing else.
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_RELEASE.modelVersion,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      maxCompletionTokens,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      // Proven by preflight from the governed attestation, exactly as the candidate gateway proves
      // it. Never inferred from public documentation.
      dataControlsAttested: true,
    });
    const provider = new GroqModelProvider(config, clock);
    return {
      invoke: (input): Promise<CanaryInvocationResult> =>
        // The ONE thing this wrapper adds: a FRESH controller per invocation, so every canary
        // carries a live non-aborted signal. `ProviderInvocationInput` requires one and the port's
        // seam deliberately does not carry it — a shared or pre-aborted signal would turn a canary
        // into a cancellation and measure nothing about the request contract.
        provider.invoke({ ...input, signal: new AbortController().signal }),
    };
  };

  const run = createDiagnosticCanaryPort({
    providerForCompletionCap,
    rawSchemaFor: materials.rawSchemaFor,
    messagesFor: materials.messagesFor,
    observations,
    // The production timeout, read off the captured request rather than restated here.
    timeoutMs: deps.captured.timeoutMs,
  });

  return Object.freeze({
    run,
    observations,
    completionCapsUsed: () => Object.freeze([...capsUsed]),
    providerBuilds: () => capsUsed.length,
    captured: deps.captured,
  });
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Credential-bound by construction: the operator calls it AFTER the candidate credential is resolved
 * and hands that credential in, so there is no window in which a diagnostic runner exists holding a
 * credential nobody read. It captures the production request first — a failure there throws, which
 * the operator turns into a closed bind failure before D1 rather than eight canaries built from a
 * request that could not be assembled.
 */
export async function openLiveDiagnosticCanaryRunner(
  deps: LiveDiagnosticCanaryDeps,
): Promise<(canary: DiagnosticCanary) => Promise<CanaryOutcome>> {
  const captured = deps.captured ?? (await captureProductionRiyaCanaryRequest());
  return createLiveDiagnosticCanaryComposition({ ...deps, captured }).run;
}
