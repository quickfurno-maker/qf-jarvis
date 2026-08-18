/**
 * The provider-neutral `ModelProvider` interface (QFJ-P04.01A, ADR-0045).
 *
 * A provider is an INFERENCE ENGINE ONLY. It declares capabilities, reports health, and performs one
 * bounded non-streaming invocation. It has NO business-authority method, executes NO tool, holds NO n8n
 * access, and touches NO database. A provider SDK type NEVER crosses this boundary — a real adapter
 * (Groq in QFJ-P04.01B, a local workstation later) wraps its SDK/HTTP internally and returns only the
 * bounded shapes below. A provider signals a normal failure by RETURNING a normalized status, not by
 * throwing; the gateway defensively treats an unexpected throw as `provider-failed`.
 */
import type { ProviderExecutionClass } from './enums.js';
import type { ProviderCapabilities } from './capabilities.js';
import type { ModelUsage } from './response.js';

/** The immutable identity of a provider. */
export interface ProviderDescriptor {
  readonly providerId: string;
  readonly executionClass: ProviderExecutionClass;
}

/** A provider's health/readiness. */
export interface ProviderHealth {
  readonly available: boolean;
}

/** The bounded, sanitized invocation input the gateway hands a provider. No secrets, no raw objects. */
export interface ProviderInvocationInput {
  readonly runId: string;
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly resultMode: 'STRUCTURED' | 'TEXT';
  /**
   * For a STRUCTURED request, the request schema rendered to JSON Schema, so a real provider (e.g. Groq)
   * can request `response_format.json_schema`. Absent for TEXT requests. The gateway still validates the
   * provider's returned value against the original schema — this is a hint, never the authority.
   */
  readonly structuredJsonSchema?: unknown;
  readonly timeoutMs: number;
  /**
   * The APPLICATION's per-request completion bound, in tokens (POST-S11 REQUEST-CONTRACT REPAIR).
   *
   * Absent means "the caller expressed no bound", and a provider then falls back to its configured
   * model ceiling — which is exactly what every invocation used to do unconditionally. S11's D1/D2
   * pair returned HTTP 200 at 512 and HTTP 413 at 65,536 against an otherwise identical request, so
   * a path with no way to ask for less than the model maximum could not stop asking for it.
   *
   * A provider MUST treat this as an upper bound to be clamped, never as permission to exceed its
   * own configured ceiling: this is an application budget, and it cannot raise a model capability.
   */
  readonly maxCompletionTokens?: number;
  /** Cooperative cancellation. A provider that supports cancellation must honour this. */
  readonly signal: AbortSignal;
}

/** The bounded output a provider returns for a completed invocation. */
export type ProviderOutput =
  | { readonly mode: 'STRUCTURED'; readonly value: unknown }
  | { readonly mode: 'TEXT'; readonly text: string };

/**
 * The normalized result of a provider invocation. A provider never leaks a raw SDK error, header, or
 * body; it maps every outcome to one of these bounded statuses. `latencyMs` is the provider's own
 * reported inference latency (an injected/deterministic value in tests — never a wall-clock sleep).
 */
export type ProviderInvocationResult =
  | {
      readonly status: 'completed';
      readonly output: ProviderOutput;
      readonly usage?: ModelUsage;
      readonly latencyMs: number;
    }
  | { readonly status: 'timeout'; readonly latencyMs: number }
  | { readonly status: 'cancelled' }
  /**
   * QFJ-S2-B: the provider refused because a RATE or QUOTA limit was reached — a different condition
   * from `unavailable`, which means the provider itself is down.
   *
   * It carries NO `retryable` flag on purpose. A rate limit is transient in principle, but the gateway
   * has no backoff, so an immediate in-loop retry would deepen the limit rather than clear it. The
   * gateway therefore treats it as non-retryable for its own attempt loop, and the transient nature is
   * reported to the caller through the invoker's `transient` flag instead. It carries no `Retry-After`
   * value, no header, and no body — the whole input to normalization is an HTTP status number.
   */
  | { readonly status: 'rate-limited' }
  | { readonly status: 'unavailable'; readonly retryable?: boolean }
  | { readonly status: 'failed'; readonly retryable?: boolean }
  | { readonly status: 'malformed'; readonly latencyMs: number };

/** A provider-neutral inference engine. */
export interface ModelProvider {
  readonly descriptor: ProviderDescriptor;
  capabilities(): ProviderCapabilities;
  health(): Promise<ProviderHealth>;
  invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult>;
}
