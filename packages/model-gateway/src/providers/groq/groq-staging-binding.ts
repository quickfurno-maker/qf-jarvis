/**
 * The Groq staging provider binding (QFJ-S1, ADR-0060 §A, §D, §E, §F, §N).
 *
 * A THIN release-driven factory over the EXISTING `GroqModelProvider` (ADR-0046) — it constructs, it
 * does not re-implement. Given a model-gateway-approved `ProviderReleaseRef`, an opaque credential
 * reference, an injected async resolver, and the injected transport, it fails closed (BEFORE any
 * credential resolution or transport) on a wildcard/`latest` identity, a non-`HOSTED` execution class,
 * a non-`HOSTED_ALLOWED` data class, an invalid prompt identity, a missing approval reference, a
 * provider mismatch, or a missing data-controls attestation; then it resolves the credential exactly
 * once and returns a ready `GroqModelProvider`. It performs NO invocation and makes NO live call. It
 * selects no provider, activates no release, and promotes no rollout — the gateway stays the only
 * router and the sole owner of retry/timeout/circuit/failover.
 *
 * QFJ-S1A (ADR-0061 §D, §E) makes the approval references EXACT and REQUIRED — the capability profile,
 * the evaluation record, the data-controls (ZDR) attestation, and the prompt family + integer version —
 * so a staging run can always be traced to the exact approved prompt and approval evidence. Only
 * IDENTIFIERS are bound and emitted; prompt text never enters this module or its events.
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
  /** The exact approved capability-profile reference (ADR-0050). REQUIRED since QFJ-S1A. */
  readonly capabilityProfileRef: string;
  /** The exact approved evaluation reference (ADR-0052). REQUIRED since QFJ-S1A. */
  readonly evaluationRef: string;
  /** The exact data-controls / ZDR attestation reference. REQUIRED since QFJ-S1A. An id, not a document. */
  readonly dataControlsAttestationRef: string;
  /** The exact prompt FAMILY identifier. REQUIRED since QFJ-S1A. Never the prompt text. */
  readonly promptFamily: string;
  /** The exact prompt VERSION — a positive integer. REQUIRED since QFJ-S1A. Never `latest`. */
  readonly promptVersion: number;
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

/** The bounded shape every exact reference identifier must satisfy. No wildcard, no free text. */
const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_REFERENCE_LENGTH = 128;
/** A prompt version is an exact positive integer, never a range and never `latest`. */
const MAX_PROMPT_VERSION = 1_000_000;

function isExactReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_REFERENCE_LENGTH &&
    REFERENCE_PATTERN.test(value) &&
    !WILDCARDS.has(value.toLowerCase())
  );
}

function isExactPromptVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PROMPT_VERSION
  );
}

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
        dataControlsAttestationRef: sr.dataControlsAttestationRef,
        promptFamily: sr.promptFamily,
        promptVersion: sr.promptVersion,
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
  // QFJ-S1A: an EXACT prompt identity is required — no wildcard/`latest`, no empty/oversized family,
  // no non-integer version. A staging run that cannot name its prompt cannot be traced.
  if (!isExactReference(sr.promptFamily) || !isExactPromptVersion(sr.promptVersion)) {
    return refuse('groq-bind-prompt-invalid');
  }
  // QFJ-S1A: the exact approval references (capability profile, evaluation, ZDR attestation) are
  // required. They are identifiers only — the binding does not fabricate or resolve their contents.
  if (
    !isExactReference(sr.capabilityProfileRef) ||
    !isExactReference(sr.evaluationRef) ||
    !isExactReference(sr.dataControlsAttestationRef)
  ) {
    return refuse('groq-bind-approval-refs-missing');
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
