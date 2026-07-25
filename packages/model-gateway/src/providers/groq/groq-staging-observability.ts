/**
 * Content-free Groq staging-bind observability (QFJ-S1, ADR-0060 §M).
 *
 * The staging binding emits only closed, content-free events carrying safe reference ids (provider /
 * model / version / config digest / capability / evaluation / data-controls attestation / prompt
 * family + version), the execution and data class, the bind reason, and a `credentialResolved` boolean.
 * It NEVER carries a message, PROMPT TEXT, prompt/output/knowledge, subject/PII, a key/token/Authorization
 * value, the credential reference value, a raw body/header/error, or chain-of-thought. The prompt is
 * identified by its FAMILY IDENTIFIER and integer VERSION only (QFJ-S1A, ADR-0061 §E, §H). The default
 * hook is a silent no-op.
 */
import type { ProviderExecutionClass, ModelDataClass } from '../../contracts/enums.js';

/** The closed set of staging-bind outcome reasons. */
export const GROQ_STAGING_BIND_REASONS = [
  'groq-bind-completed',
  'groq-bind-release-invalid',
  'groq-bind-execution-refused',
  'groq-bind-data-class-refused',
  // QFJ-S1A (ADR-0061 §E): an absent/wildcard/oversized prompt family or a non-exact prompt version.
  'groq-bind-prompt-invalid',
  // QFJ-S1A (ADR-0061 §D): a missing/invalid capability, evaluation, or data-controls attestation ref.
  'groq-bind-approval-refs-missing',
  'groq-bind-attestation-missing',
  'groq-bind-credential-unavailable',
  'groq-bind-provider-mismatch',
] as const;
export type GroqStagingBindReason = (typeof GROQ_STAGING_BIND_REASONS)[number];

/** The closed set of staging-bind (terminal) event types. */
export const GROQ_STAGING_EVENT_TYPES = ['groq-bind-completed', 'groq-bind-refused'] as const;
export type GroqStagingEventType = (typeof GROQ_STAGING_EVENT_TYPES)[number];

/** A single closed, content-free staging-bind event. */
export interface GroqStagingBindEvent {
  readonly type: GroqStagingEventType;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly executionClass: ProviderExecutionClass;
  readonly dataClass: ModelDataClass;
  readonly capabilityProfileRef: string;
  readonly evaluationRef: string;
  /** The Groq data-controls / Zero-Data-Retention attestation REFERENCE — an id, never the document. */
  readonly dataControlsAttestationRef: string;
  /** The exact prompt FAMILY identifier. Never the prompt text. */
  readonly promptFamily: string;
  /** The exact prompt VERSION. An integer, never a range and never `latest`. */
  readonly promptVersion: number;
  readonly reason: GroqStagingBindReason;
  /** Whether the injected resolver produced a credential (never the key or the reference value). */
  readonly credentialResolved: boolean;
}

/** An injected content-free observability hook. It never controls a bind outcome. */
export interface GroqStagingObservabilityHook {
  onEvent(event: GroqStagingBindEvent): void;
}

/** The default silent no-op hook. */
export const NOOP_GROQ_STAGING_OBSERVABILITY: GroqStagingObservabilityHook = Object.freeze({
  onEvent(_event: GroqStagingBindEvent): void {
    // Intentionally silent.
  },
});
