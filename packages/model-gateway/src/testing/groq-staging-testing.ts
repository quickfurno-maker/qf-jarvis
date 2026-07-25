/**
 * Deterministic Groq staging-binding fakes (QFJ-S1, ADR-0060).
 *
 * Shipped ONLY under `./testing` so they can never become a production default. All synthetic — an
 * OBVIOUS fake sentinel credential (never a real key), an injected async resolver, a deterministic HTTP
 * transport that returns a canned Groq response WITHOUT any network, and a synthetic approved staging
 * release. No `process.env`, no secret store, no live Groq call.
 */
import { createProviderReleaseRef } from '../operations/provider-release.js';
import { createGroqApiKey, type GroqApiKey } from '../providers/groq/groq-secret.js';
import type {
  GroqCredentialReference,
  GroqCredentialResolver,
} from '../providers/groq/groq-credential-resolver.js';
import type {
  GroqHttpRequest,
  GroqHttpResponse,
  GroqTransport,
} from '../providers/groq/groq-transport.js';
import type { GroqStagingRelease } from '../providers/groq/groq-staging-binding.js';

/** An OBVIOUS fake sentinel — never a real Groq key. Used only to prove redaction and wiring. */
export const FAKE_GROQ_SENTINEL_KEY = 'sk-FAKE-GROQ-STAGING-SENTINEL-DO-NOT-USE';

/** A synthetic opaque credential reference (never a key). */
export const SYNTHETIC_GROQ_CREDENTIAL_REFERENCE: GroqCredentialReference = Object.freeze({
  ref: 'groq.staging.secret.v1',
});

/** A resolver that resolves to the fake sentinel key; records how many times it was consulted. */
export interface RecordingGroqCredentialResolver extends GroqCredentialResolver {
  readonly resolved: () => number;
}
export function fakeGroqCredentialResolver(
  sentinel = FAKE_GROQ_SENTINEL_KEY,
): RecordingGroqCredentialResolver {
  const counter = { n: 0 };
  return Object.freeze({
    resolve(_reference: GroqCredentialReference): Promise<GroqApiKey> {
      counter.n += 1;
      return Promise.resolve(createGroqApiKey(sentinel));
    },
    resolved: () => counter.n,
  });
}

/** A resolver that rejects (a missing/unresolvable credential); records consultations. */
export function missingGroqCredentialResolver(): RecordingGroqCredentialResolver {
  const counter = { n: 0 };
  return Object.freeze({
    resolve(_reference: GroqCredentialReference): Promise<GroqApiKey> {
      counter.n += 1;
      return Promise.reject(new Error('SYNTHETIC-CREDENTIAL-UNAVAILABLE'));
    },
    resolved: () => counter.n,
  });
}

/** A deterministic HTTP transport returning a canned response; records the request. NO network. */
export interface RecordingGroqTransport extends GroqTransport {
  readonly calls: () => number;
  readonly lastRequest: () => GroqHttpRequest | undefined;
}
export function fakeGroqTransport(bodyText: string, status = 200): RecordingGroqTransport {
  const state: { n: number; last: GroqHttpRequest | undefined } = { n: 0, last: undefined };
  return Object.freeze({
    send(request: GroqHttpRequest, _signal: AbortSignal): Promise<GroqHttpResponse> {
      state.n += 1;
      state.last = request;
      return Promise.resolve({ status, retryAfterSeconds: null, bodyText });
    },
    calls: () => state.n,
    lastRequest: () => state.last,
  });
}

/** Build a valid Groq Chat Completions response body carrying a structured JSON value. */
export function groqStructuredResponseBody(
  value: unknown,
  model = 'llama-3.1-8b-instant',
): string {
  return JSON.stringify({
    id: 'chatcmpl-fake-staging',
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

/** A synthetic approved Groq staging release (HOSTED, HOSTED_ALLOWED, attested). Override any field. */
export function syntheticGroqStagingRelease(
  over: Partial<GroqStagingRelease> = {},
): GroqStagingRelease {
  return {
    release: createProviderReleaseRef({
      releaseId: 'rel.groq.staging.1',
      providerId: 'groq.staging',
      modelId: 'llama-3.1-8b-instant',
      modelVersion: '2025-07',
      executionClass: 'HOSTED',
      configDigest: 'cfg-groq-0001',
    }),
    dataClass: 'HOSTED_ALLOWED',
    maxInputTokens: 8192,
    maxCompletionTokens: 1024,
    supportsStrictJsonSchema: true,
    dataControlsAttested: true,
    capabilityProfileRef: 'cap.groq.reply.v1',
    evaluationRef: 'evref-groq-0001',
    ...over,
  };
}
