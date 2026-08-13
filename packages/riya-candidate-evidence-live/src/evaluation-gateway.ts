/**
 * The EVALUATION-ONLY model gateway, and the cancellation-aware invoker (MVP-P2A.2).
 *
 * ### Why not `createProductionModelGateway`
 *
 * That composition is deliberately mode OFF and non-activatable — it exists so nothing can quietly
 * start serving. Using it here would mean either never invoking anything, or weakening the one
 * composition whose whole value is that it cannot be weakened. So this leaf constructs the FOUNDATION
 * gateway directly, with the narrowest posture the executable path allows.
 *
 * ### `ACTIVE` here is an execution mode, not a rollout
 *
 * The foundation gateway's OFF mode does not execute; ACTIVE is what "run this request" means at that
 * layer. This instance lives inside one short-lived CLI process, holds ONE provider, has no
 * `rolloutController`, writes no configuration, registers no release and disappears when the process
 * exits. Nothing about it is persisted or exported as serving state, and specs assert that no rollout
 * symbol is imported, constructed or mutated anywhere in this package. A production rollout is a
 * governed transition with an approval attestation behind it; this is a function call.
 *
 * ### One provider, no fallback, no retry
 *
 * `allowFallback: false` and a zero retry budget on every request. That is not caution, it is
 * measurement hygiene: a retried case is a different case, and a case answered by a second provider
 * is evidence about a model nobody is evaluating. A failure stays a failure.
 */
import {
  createEstimatedBudgetPolicy,
  createFetchGroqTransport,
  createGroqProviderConfig,
  createModelGateway,
  createSystemClock,
  GroqModelProvider,
} from '@qf-jarvis/model-gateway';
import type { GroqApiKey, GroqTransport, ModelGateway } from '@qf-jarvis/model-gateway';
import { createLiveModelGatewayInvoker } from '@qf-jarvis/model-gateway-composition';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_RELEASE,
  CANDIDATE_SUPPORTS_STRICT_JSON,
} from './candidate-release.js';

/** Bounded, and one at a time. Concurrency is not what is being measured, and order aids diagnosis. */
const EVALUATION_CONCURRENCY = Object.freeze({ maxConcurrent: 1, maxQueue: 4 });

/**
 * The circuit stays effectively out of the way.
 *
 * A circuit that opened mid-suite would turn a model failure into a measurement gap for every case
 * after it, and the operator already stops on the first failure it cannot record honestly.
 */
const EVALUATION_CIRCUIT = Object.freeze({ failureThreshold: 1_000, cooldownMs: 1 });

export interface CandidateGatewayDeps {
  /** The one-shot masked credential, already resolved into memory. Never logged or persisted. */
  readonly apiKey: GroqApiKey;
  /** Production: `createFetchGroqTransport()`. Tests: a deterministic fake. Never both. */
  readonly transport?: GroqTransport;
}

/**
 * Compose the candidate gateway from EXISTING public seams.
 *
 * Every step is a reuse: the config validator, the fetch transport, the provider that speaks Groq's
 * wire format and normalizes its errors, and the gateway that routes. This package writes no HTTP,
 * builds no Authorization header and knows no endpoint.
 *
 * Deliberately NOT `bindGroqStagingProvider`: its `GroqStagingRelease` requires an exact
 * `evaluationRef` before the credential is resolved, and candidate evidence does not exist yet.
 * Supplying the smoke's ref, a placeholder, or the ref this very run is about to produce would be a
 * fabricated governance identity — the circularity this composition exists to avoid.
 */
export function createCandidateGateway(deps: CandidateGatewayDeps): ModelGateway {
  const clock = createSystemClock();
  const config = createGroqProviderConfig({
    providerId: CANDIDATE_PROVIDER_ID,
    modelId: CANDIDATE_MODEL_ID,
    modelVersion: CANDIDATE_RELEASE.modelVersion,
    executionClass: 'HOSTED',
    maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
    apiKey: deps.apiKey,
    transport: deps.transport ?? createFetchGroqTransport(),
    // Proven by preflight from the governed attestation, never inferred from public documentation.
    dataControlsAttested: true,
  });

  return createModelGateway({
    mode: 'ACTIVE',
    providers: [new GroqModelProvider(config, clock)],
    clock,
    budgetPolicy: createEstimatedBudgetPolicy({}),
    killSwitch: { active: () => false },
    concurrency: EVALUATION_CONCURRENCY,
    circuit: EVALUATION_CIRCUIT,
    allowFallback: false,
    // No rolloutController, no routingProfile, no capabilityRegistry, no evidenceVerifier. One
    // provider needs no routing, and an evaluation run has no rollout to be governed by.
  });
}

/** The ordinary invoker: the existing adapter, one `gateway.invoke`, no signal. */
export function createCandidateInvoker(gateway: ModelGateway): ModelGatewayInvoker {
  return createLiveModelGatewayInvoker(gateway);
}
