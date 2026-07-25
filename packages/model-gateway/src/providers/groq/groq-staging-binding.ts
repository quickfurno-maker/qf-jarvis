/**
 * The Groq staging provider binding (QFJ-S1, ADR-0060 §A, §D, §E, §F, §N).
 *
 * A THIN release-driven factory over the EXISTING `GroqModelProvider` (ADR-0046) — it constructs, it
 * does not re-implement. Given a model-gateway-approved `ProviderReleaseRef`, an opaque credential
 * reference, an injected async resolver, and the injected transport, it fails closed (BEFORE any
 * credential resolution or transport) on a wildcard/`latest` identity, a non-`HOSTED` execution class,
 * a non-`HOSTED_ALLOWED` data class, a provider mismatch, or a missing data-controls attestation; then
 * it resolves the credential exactly once and returns a ready `GroqModelProvider`. It performs NO
 * invocation and makes NO live call. It selects no provider, activates no release, and promotes no
 * rollout — the gateway stays the only router and the sole owner of retry/timeout/circuit/failover.
 */
import type { ModelDataClass } from '../../contracts/enums.js';
import type { GatewayClock } from '../../reliability/clock.js';
import type { ProviderReleaseRef } from '../../operations/provider-release.js';
import { createGroqProviderConfig } from './groq-config.js';
import { GroqModelProvider } from './groq-model-provider.js';
import type {
  GroqCredentialReference,
  GroqCredentialResolver,
} from './groq-credential-resolver.js';
import type { GroqTransport } from './groq-transport.js';
import type {
  GroqStagingBindEvent,
  GroqStagingBindReason,
  GroqStagingEventType,
  GroqStagingObservabilityHook,
} from './groq-staging-observability.js';
import { NOOP_GROQ_STAGING_OBSERVABILITY } from './groq-staging-observability.js';

/** An approved Groq staging release: the exact release identity plus its approved bounds/refs. */
export interface GroqStagingRelease {
  readonly release: ProviderReleaseRef;
  readonly dataClass: ModelDataClass;
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsStrictJsonSchema: boolean;
  /** A positive Groq data-controls / Zero-Data-Retention attestation is REQUIRED to bind. */
  readonly dataControlsAttested: boolean;
  readonly capabilityProfileRef?: string;
  readonly evaluationRef?: string;
}

export interface GroqStagingBindingConfig {
  readonly stagingRelease: GroqStagingRelease;
  readonly credentialReference: GroqCredentialReference;
  readonly credentialResolver: GroqCredentialResolver;
  /** The injected transport; production = the fixed fetch transport, tests = a deterministic fake. */
  readonly transport: GroqTransport;
  readonly clock: GatewayClock;
  readonly observability?: GroqStagingObservabilityHook;
}

/** The closed, frozen bind result: a ready provider, or a safe fail-closed reason. */
export type GroqStagingBindResult =
  | {
      readonly ok: true;
      readonly reason: 'groq-bind-completed';
      readonly provider: GroqModelProvider;
      readonly release: ProviderReleaseRef;
    }
  | { readonly ok: false; readonly reason: GroqStagingBindReason };

const WILDCARDS: ReadonlySet<string> = new Set(['*', 'latest']);

function hasWildcardIdentity(release: ProviderReleaseRef): boolean {
  return [
    release.releaseId,
    release.providerId,
    release.modelId,
    release.modelVersion,
    release.configDigest,
  ].some((value) => WILDCARDS.has(value.toLowerCase()));
}

/**
 * Bind the existing Groq adapter to an approved staging release. Fail-closed gates run BEFORE the
 * credential is resolved; the credential is resolved at most once; no live call is made.
 */
export async function bindGroqStagingProvider(
  config: GroqStagingBindingConfig,
): Promise<GroqStagingBindResult> {
  const hook = config.observability ?? NOOP_GROQ_STAGING_OBSERVABILITY;
  const sr = config.stagingRelease;
  const release = sr.release;

  const emit = (
    type: GroqStagingEventType,
    reason: GroqStagingBindReason,
    credentialResolved: boolean,
  ): void => {
    hook.onEvent(
      Object.freeze({
        type,
        providerId: release.providerId,
        modelId: release.modelId,
        modelVersion: release.modelVersion,
        configDigest: release.configDigest,
        executionClass: release.executionClass,
        dataClass: sr.dataClass,
        capabilityProfileRef: sr.capabilityProfileRef,
        evaluationRef: sr.evaluationRef,
        reason,
        credentialResolved,
      } satisfies GroqStagingBindEvent),
    );
  };
  const refuse = (reason: GroqStagingBindReason): GroqStagingBindResult => {
    emit('groq-bind-refused', reason, false);
    return Object.freeze({ ok: false, reason });
  };

  // Exact release identity: no wildcard/latest (BEFORE any credential/transport).
  if (hasWildcardIdentity(release)) {
    return refuse('groq-bind-release-invalid');
  }
  // Groq is HOSTED execution only.
  if (release.executionClass !== 'HOSTED') {
    return refuse('groq-bind-execution-refused');
  }
  // HOSTED_ALLOWED only — LOCAL_ONLY / HUMAN_ONLY fail before credential resolution.
  if (sr.dataClass !== 'HOSTED_ALLOWED') {
    return refuse('groq-bind-data-class-refused');
  }
  // Data-controls (ZDR) attestation is required to bind.
  if (!sr.dataControlsAttested) {
    return refuse('groq-bind-attestation-missing');
  }

  // Resolve the credential exactly once; a missing/unresolvable credential fails closed before transport.
  let apiKey;
  try {
    apiKey = await config.credentialResolver.resolve(config.credentialReference);
  } catch {
    return refuse('groq-bind-credential-unavailable');
  }

  // Construct the EXISTING adapter from the approved release (no hard-coded model id).
  let providerConfig;
  try {
    providerConfig = createGroqProviderConfig({
      providerId: release.providerId,
      modelId: release.modelId,
      modelVersion: release.modelVersion,
      maxInputTokens: sr.maxInputTokens,
      maxCompletionTokens: sr.maxCompletionTokens,
      supportsStrictJsonSchema: sr.supportsStrictJsonSchema,
      apiKey,
      transport: config.transport,
      dataControlsAttested: sr.dataControlsAttested,
    });
  } catch {
    return refuse('groq-bind-release-invalid');
  }

  // The bound provider descriptor must agree with the release provider id.
  const provider = new GroqModelProvider(providerConfig, config.clock);
  if (provider.descriptor.providerId !== release.providerId) {
    return refuse('groq-bind-provider-mismatch');
  }

  emit('groq-bind-completed', 'groq-bind-completed', true);
  return Object.freeze({ ok: true, reason: 'groq-bind-completed', provider, release });
}
