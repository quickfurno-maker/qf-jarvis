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
