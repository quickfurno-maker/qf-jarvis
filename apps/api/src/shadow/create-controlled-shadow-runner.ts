/**
 * The controlled one-shot SHADOW runner (QFJ-S2-E-B, ADR-0065).
 *
 * A process-local composition. It calls `createModelGateway` directly and owns a rollout controller that
 * is never returned, so `createProductionModelGateway` stays OFF-only and untouched — making the
 * production composition activatable would discard the guarantee three merged slices established.
 *
 * Two facts about the gateway shape everything here:
 *
 *   1. SHADOW returns the STABLE response and discards the candidate's. A runner that trusted the
 *      return value would report PASS for a run in which the candidate never worked, so the candidate's
 *      outcome is observed through a counting wrapper and a PASS requires BOTH legs.
 *   2. The shadow call is absent from `provenance.attempts`, so every count is the runner's own.
 *
 * Nothing is exposed: no gateway, controller, verifier, registry, provider, transport, credential,
 * request or response leaves this function. It returns one closed result.
 */
import { createFileGroqCredentialBinding } from '../secrets/file-groq-credential-binding.js';
import type { CredentialFileReader } from '../secrets/credential-file-reader.js';
import type { createGroqApiKey } from '@qf-jarvis/model-gateway';
import {
  createEstimatedBudgetPolicy,
  createFetchGroqTransport,
  createGroqProviderConfig,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createModelGateway,
  createProviderReleaseRef,
  createProviderRolloutController,
  createProviderRolloutPolicy,
  createRolloutApprovalAttestation,
  createSystemClock,
  GroqModelProvider,
  isModelGatewayError,
  offRolloutPolicy,
  type GroqTransport,
  type ModelGatewayErrorCode,
  type ModelProvider,
  type ProviderReleaseRef,
  type RolloutEvent,
} from '@qf-jarvis/model-gateway';
import { createEvaluationEvidenceRegistry } from '@qf-jarvis/model-gateway-composition/internal/evidence-registry';
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';

import { createShadowCounters, type ShadowCounters } from './shadow-counters.js';
import { countTransport, observeProvider } from './shadow-provider-metrics.js';
import { createShadowRequest, SHADOW_PROMPT_ID } from './shadow-request.js';
import { hardDeadlineMs, type ShadowRunConfig } from './shadow-run-config.js';
import type { ShadowReason, ShadowRunResult } from './shadow-result.js';

/** Internal seams for offline specs. Not root-exported, and not reachable from the CLI. */
export interface ShadowRunnerSeams {
  readonly credentialFileReader?: CredentialFileReader;
  /** Builds the transport for one provider. Production omits it and gets the fixed fetch transport. */
  readonly transportFactory?: () => GroqTransport;
  /** Replaces the two real Groq providers. Tests only; a fake never enters the production graph. */
  readonly providerFactory?: (args: {
    readonly release: ProviderReleaseRef;
    readonly leg: 'stable' | 'candidate';
    readonly transport: GroqTransport;
  }) => ModelProvider;
  readonly nowMs?: () => number;
  readonly setDeadline?: (ms: number, onFire: () => void) => () => void;
}

export interface ShadowRunnerInput {
  readonly config: ShadowRunConfig;
  readonly evidence: ApprovalEvidence;
  readonly credentialFilePath: string;
  readonly seams?: ShadowRunnerSeams;
}

/** Map a gateway error code to the coarse CLI reason. Finer internal detail stays internal. */
function reasonForGatewayCode(code: ModelGatewayErrorCode): ShadowReason {
  switch (code) {
    case 'rate-limited':
      return 'rate-limited';
    case 'timeout':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    case 'malformed-provider-output':
    case 'structured-output-invalid':
      return 'provider-output-invalid';
    case 'provider-unavailable':
    case 'provider-failed':
    case 'circuit-open':
    case 'retry-budget-exhausted':
      return 'provider-unavailable';
    case 'gateway-off':
    case 'no-eligible-provider':
    case 'local-provider-required':
    case 'capability-mismatch':
    case 'human-only':
    case 'kill-switch-active':
      return 'policy-refused';
    default:
      return 'internal-invariant';
  }
}

/** Build a Groq provider for one leg. One credential, two configs, two instances. */
function buildProvider(args: {
  readonly config: ShadowRunConfig;
  readonly release: ProviderReleaseRef;
  readonly leg: 'stable' | 'candidate';
  readonly apiKey: ReturnType<typeof createGroqApiKey>;
  readonly counters: ShadowCounters;
  readonly seams: ShadowRunnerSeams;
}): ModelProvider {
  const transport = countTransport(
    args.seams.transportFactory?.() ?? createFetchGroqTransport(),
    args.counters,
  ) as GroqTransport;

  if (args.seams.providerFactory !== undefined) {
    return args.seams.providerFactory({ release: args.release, leg: args.leg, transport });
  }
  return new GroqModelProvider(
    createGroqProviderConfig({
      providerId: args.release.providerId,
      modelId: args.config.modelId,
      modelVersion: args.config.modelVersion,
      maxInputTokens: args.config.maxInputTokens,
      maxCompletionTokens: args.config.maxCompletionTokens,
      supportsStrictJsonSchema: true,
      apiKey: args.apiKey,
      transport,
      dataControlsAttested: true,
    }),
    createSystemClock(),
  );
}

/**
 * Execute one controlled SHADOW run.
 *
 * Ordering is load-bearing: every configuration and evidence check happens before the credential is
 * read, and the `finally` block always attempts to return the policy to OFF.
 */
export async function runControlledShadowOnce(input: ShadowRunnerInput): Promise<ShadowRunResult> {
  const seams = input.seams ?? {};
  const counters = createShadowCounters();
  const nowMs = seams.nowMs ?? ((): number => Date.now());
  const startedAt = nowMs();
  const { config } = input;

  const events: RolloutEvent[] = [];
  let policyRevision = 0;
  let finalPolicyRevision = 0;
  let finalMode: 'OFF' | 'UNKNOWN' = 'UNKNOWN';
  let reason: ShadowReason = 'internal-invariant';
  let outcome: 'PASS' | 'FAIL' = 'FAIL';
  let stableLatencyMs = 0;
  let stableInputTokens = 0;
  let stableOutputTokens = 0;
  let candidateObservation = {
    status: 'not-invoked',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  let controller: ReturnType<typeof createProviderRolloutController> | undefined;
  let clearDeadline: (() => void) | undefined;

  const finish = (): ShadowRunResult =>
    Object.freeze({
      timestamp: new Date(startedAt).toISOString(),
      outcome,
      reason,
      mode: 'SHADOW' as const,
      finalMode,
      policyRevision,
      finalPolicyRevision,
      stableProviderId: config.stable.providerId,
      stableReleaseId: config.stable.releaseId,
      candidateProviderId: config.candidate.providerId,
      candidateReleaseId: config.candidate.releaseId,
      credentialBackend: 'file' as const,
      credentialResolveAttempts: counters.get('credentialResolveAttempts'),
      credentialResolveSuccesses: counters.get('credentialResolveSuccesses'),
      credentialReads: counters.get('credentialReads'),
      providerConstructions: counters.get('providerConstructions'),
      healthChecks: counters.get('healthChecks'),
      stableInvocations: counters.get('stableInvocations'),
      candidateInvocations: counters.get('candidateInvocations'),
      transportRequests: counters.get('transportRequests'),
      stableLatencyMs,
      candidateLatencyMs: candidateObservation.latencyMs,
      totalElapsedMs: nowMs() - startedAt,
      stableInputTokens,
      stableOutputTokens,
      candidateInputTokens: candidateObservation.inputTokens,
      candidateOutputTokens: candidateObservation.outputTokens,
      timeouts: counters.get('timeouts'),
      cancellations: counters.get('cancellations'),
      retries: 0 as const,
      fallbacks: 0 as const,
      refreshes: 0 as const,
      transitions: counters.get('transitions'),
      timersArmed: counters.get('timersArmed'),
      timersCleared: counters.get('timersCleared'),
      modelOutput: 'DISCARDED' as const,
      authority: 'QUICKFURNO_CORE' as const,
    });

  /**
   * The run body. It SETS outer state and returns void — it must never build the result,
   * because `finish()` would then be evaluated before the `finally` block records the final OFF
   * state, and the emitted line would report `UNKNOWN` for every run.
   */
  const body = async (): Promise<void> => {
    // 1. Evidence must authorise SHADOW for the candidate, at LEAST authority (ADR-0065 §3).
    if (config.promptId !== SHADOW_PROMPT_ID) {
      reason = 'config-invalid';
      return;
    }
    if (input.evidence.target !== 'SHADOW_ELIGIBILITY') {
      // A broader target could permit SHADOW; this runner refuses it anyway.
      reason = 'evidence-refused';
      return;
    }
    const registryResult = createEvaluationEvidenceRegistry([input.evidence]);
    if (!registryResult.ok) {
      reason = 'evidence-refused';
      return;
    }
    if (input.evidence.evaluationRef !== config.evidenceRef) {
      reason = 'evidence-refused';
      return;
    }

    // 2. Releases. Built through the gateway factory so the grammar is the gateway's, not ours.
    const stableRelease = createProviderReleaseRef({
      releaseId: config.stable.releaseId,
      providerId: config.stable.providerId,
      modelId: config.modelId,
      modelVersion: config.modelVersion,
      executionClass: 'HOSTED',
      configDigest: config.stable.configDigest,
    });
    const candidateRelease = createProviderReleaseRef({
      releaseId: config.candidate.releaseId,
      providerId: config.candidate.providerId,
      modelId: config.modelId,
      modelVersion: config.modelVersion,
      executionClass: 'HOSTED',
      configDigest: config.candidate.configDigest,
    });

    // 3. ONE credential resolution, shared by both legs (ADR-0065 §5).
    const binding = createFileGroqCredentialBinding({
      credentialReference: { ref: config.credentialReference },
      absoluteFilePath: input.credentialFilePath,
      ...(seams.credentialFileReader === undefined
        ? {}
        : { fileReader: seams.credentialFileReader }),
    });
    if (!counters.claim('credentialResolveAttempts') || !counters.claim('credentialReads')) {
      reason = 'call-budget-exceeded';
      return;
    }
    let apiKey;
    try {
      apiKey = await binding.resolver.resolve({ ref: config.credentialReference });
    } catch {
      // The credential error's closed code is deliberately collapsed at this boundary.
      reason = 'credential-unavailable';
      return;
    }
    counters.claim('credentialResolveSuccesses');

    // 4. Two provider instances.
    if (!counters.claim('providerConstructions') || !counters.claim('providerConstructions')) {
      reason = 'call-budget-exceeded';
      return;
    }
    const stableObserved = observeProvider(
      buildProvider({ config, release: stableRelease, leg: 'stable', apiKey, counters, seams }),
      counters,
      'stableInvocations',
    );
    const candidateObserved = observeProvider(
      buildProvider({
        config,
        release: candidateRelease,
        leg: 'candidate',
        apiKey,
        counters,
        seams,
      }),
      counters,
      'candidateInvocations',
    );

    // 5. Capability profiles for both releases.
    const profileFor = (release: ProviderReleaseRef) =>
      createModelCapabilityProfile({
        release,
        taskClasses: ['RESPONSE_GENERATION'],
        resultModes: ['STRUCTURED'],
        structuredOutputMode: 'strict-json-schema',
        maxInputTokens: config.maxInputTokens,
        maxCompletionTokens: config.maxCompletionTokens,
        supportsTimeout: true,
        supportsCancellation: true,
      });
    const capabilityRegistry = createModelCapabilityRegistry([
      profileFor(stableRelease),
      profileFor(candidateRelease),
    ]);

    // 6. Process-local controller, born OFF at revision 0.
    controller = createProviderRolloutController(
      offRolloutPolicy(config.rolloutId, stableRelease),
      {
        record: (event) => {
          events.push(event);
        },
      },
      registryResult.registry.verifier,
    );

    const request = createShadowRequest({
      runId: config.runId,
      timeoutMs: config.timeoutMs,
      minContextTokens: 1,
    });

    const abort = new AbortController();
    if (!counters.claim('timersArmed')) {
      reason = 'call-budget-exceeded';
      return;
    }
    const armDeadline =
      seams.setDeadline ??
      ((ms: number, onFire: () => void): (() => void) => {
        const handle = setTimeout(onFire, ms);
        return () => {
          clearTimeout(handle);
        };
      });
    clearDeadline = armDeadline(hardDeadlineMs(config.timeoutMs), () => {
      counters.claim('timeouts');
      abort.abort();
    });

    const gateway = createModelGateway({
      mode: 'ACTIVE',
      providers: [stableObserved.provider, candidateObserved.provider],
      clock: createSystemClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: (): boolean => false },
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 8, cooldownMs: 1_000 },
      allowFallback: false,
      capabilityRegistry,
      rolloutController: controller,
      rolloutObservability: {
        record: (event) => {
          events.push(event);
        },
      },
      evidenceVerifier: registryResult.registry.verifier,
    });

    // 7. Exactly one OFF→SHADOW transition, authorised by verified evidence.
    const approval = createRolloutApprovalAttestation({
      evaluationRef: input.evidence.evaluationRef,
      releaseId: candidateRelease.releaseId,
      configDigest: candidateRelease.configDigest,
      privacyRefs: [config.dataControlsAttestationRef],
      approvedModeCeiling: 'SHADOW',
      approvedCanaryBasisPoints: 0,
      revision: 1,
      evidenceDigest: config.evidenceDigest,
      approvalTarget: 'SHADOW_ELIGIBILITY',
      capabilityProfileRef: config.capabilityProfileRef,
    });
    let shadowPolicy;
    try {
      shadowPolicy = createProviderRolloutPolicy({
        rolloutId: config.rolloutId,
        revision: 1,
        mode: 'SHADOW',
        stable: stableRelease,
        candidate: candidateRelease,
        shadow: true,
        maxServingAttempts: 1,
        maxShadowAttempts: 1,
        operatorReason: 'initial-enable',
        approval,
      });
    } catch {
      reason = 'policy-refused';
      return;
    }
    if (!counters.claim('transitions')) {
      reason = 'call-budget-exceeded';
      return;
    }
    const transition = controller.transition(shadowPolicy, 0);
    if (!transition.ok) {
      reason =
        transition.reason.startsWith('evidence-') || transition.reason.startsWith('synthetic-')
          ? 'evidence-refused'
          : 'policy-refused';
      return;
    }
    policyRevision = controller.snapshot().revision;

    // 8. Exactly one invocation of the fixed synthetic request.
    let stableAccepted = false;
    try {
      const response = await gateway.invoke(request, { signal: abort.signal });
      // 9. Keep ONLY usage and latency; the body reference is never stored.
      stableLatencyMs = response.latencyMs;
      stableInputTokens = response.usage.inputTokens ?? 0;
      stableOutputTokens = response.usage.outputTokens ?? 0;
      stableAccepted = true;
    } catch (error: unknown) {
      if (isModelGatewayError(error)) {
        reason = reasonForGatewayCode(error.code);
      } else {
        reason = 'internal-invariant';
      }
    }

    candidateObservation = candidateObserved.observation();

    if (counters.exceeded()) {
      reason = 'call-budget-exceeded';
      return;
    }
    if (!stableAccepted) {
      return;
    }

    // 10. The candidate must have completed. Stable success alone is NOT a PASS (ADR-0065 §1).
    const started = events.filter((e) => e.type === 'shadow-started').length;
    const completed = events.filter((e) => e.type === 'shadow-completed').length;
    const failed = events.filter((e) => e.type === 'shadow-failed').length;
    if (started !== 1 || completed !== 1 || failed !== 0) {
      reason =
        candidateObservation.status === 'timeout'
          ? 'timeout'
          : candidateObservation.status === 'rate-limited'
            ? 'rate-limited'
            : candidateObservation.status === 'cancelled'
              ? 'cancelled'
              : candidateObservation.status === 'malformed'
                ? 'provider-output-invalid'
                : 'provider-unavailable';
      return;
    }
    if (counters.get('candidateInvocations') !== 1 || counters.get('stableInvocations') !== 1) {
      reason = 'call-budget-exceeded';
      return;
    }

    outcome = 'PASS';
    reason = 'shadow-completed';
  };

  try {
    await body();
  } catch {
    reason = 'internal-invariant';
  } finally {
    if (clearDeadline !== undefined) {
      counters.claim('timersCleared');
      clearDeadline();
    }
    // 11. Always return the policy to OFF and PROVE it.
    if (controller !== undefined) {
      try {
        if (counters.claim('transitions')) {
          controller.emergencyDisable(controller.snapshot().revision, 'emergency-disable');
        }
      } catch {
        // A disable failure must not mask the run's own reason; it is reported through finalMode.
      }
      const snapshot = controller.snapshot();
      finalPolicyRevision = snapshot.revision;
      finalMode = snapshot.mode === 'OFF' ? 'OFF' : 'UNKNOWN';
      if (finalMode !== 'OFF') {
        outcome = 'FAIL';
        reason = 'final-off-not-proven';
      }
    }
  }

  // Built LAST, so it reflects the proven final OFF state and the cleared timer.
  return finish();
}
