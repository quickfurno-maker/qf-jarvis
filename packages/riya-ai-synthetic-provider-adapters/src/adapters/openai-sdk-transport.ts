/**
 * The OpenAI SDK binding (AS3A, ADR-0143 §6).
 *
 * ### The only file in this repository that talks to OpenAI
 *
 * Everything else in the package works against `OpenAiResponsesTransport`, which is why every rule
 * the adapter enforces is testable with no network and no credential. This file is the thin, boring
 * part: hand the body to the SDK, read three integers and some text back, and convert an SDK error
 * into a closed kind.
 *
 * ### The error boundary is here, and it is one-way
 *
 * An SDK error carries a message, a request id, response headers and often a fragment of the request.
 * None of that is allowed inward. Only the HTTP STATUS and whether the call was aborted cross this
 * line; the classification itself is a pure function shared with the Anthropic binding, so the two
 * families cannot come to disagree about what a 429 means.
 *
 * ### Only the final output crosses
 *
 * `output_text` and the usage counters. Reasoning items, response ids, headers and provider metadata
 * are read past, not carried — a field that reaches an artifact is a field somebody has to justify
 * keeping.
 */
import OpenAI from 'openai';

import {
  RiyaSyntheticProviderTransportError,
  classifyRiyaSyntheticProviderFailure,
} from '../contracts/provider-errors.js';
import type {
  OpenAiResponsesRequestBody,
  OpenAiResponsesTransport,
} from './openai-responses-invoker.js';

/**
 * Read a non-negative integer counter out of an untrusted object.
 *
 * `unknown` all the way down, on purpose. An SDK's usage shape is a provider's business and may gain,
 * lose or rename a field between releases; reading it through a narrowing helper means a change there
 * shows up as a zero rather than as a crash or, worse, as a typed lie in a usage report.
 */
function readCounter(source: unknown, key: string): number {
  if (typeof source !== 'object' || source === null) return 0;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** The same, one level in. */
function readNestedCounter(source: unknown, outer: string, key: string): number {
  if (typeof source !== 'object' || source === null) return 0;
  return readCounter((source as Record<string, unknown>)[outer], key);
}

/** One field of an untrusted object, as `unknown`. */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** A string field, or empty. An absent output is a failure the adapter classifies, not a crash. */
function readText(source: unknown, key: string): string {
  const value = readField(source, key);
  return typeof value === 'string' ? value : '';
}

/**
 * Did the model decline?
 *
 * Walked defensively rather than asserted: a refusal arrives as a content part inside the output
 * items, and reading it wrongly in the permissive direction would turn a decline into an empty
 * payload and then into a structural repair — the one thing a refusal must never trigger.
 */
function detectRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  for (const item of output as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content as readonly unknown[]) {
      if (typeof part !== 'object' || part === null) continue;
      if ((part as { type?: unknown }).type === 'refusal') return true;
    }
  }
  return false;
}

/** Turn an SDK throw into a closed kind. Status and abort only; never a message. */
function transportErrorFrom(error: unknown): RiyaSyntheticProviderTransportError {
  const aborted = error instanceof OpenAI.APIUserAbortError;
  // The status is read through the same narrowing used for everything else that crosses this
  // boundary. The SDK types it loosely, and a status is the ONE thing from an error that is allowed
  // inward -- so it is proved to be a number here rather than trusted to be one.
  const raw = error instanceof OpenAI.APIError ? readField(error, 'status') : undefined;
  const status = typeof raw === 'number' ? raw : undefined;
  return new RiyaSyntheticProviderTransportError(
    classifyRiyaSyntheticProviderFailure({
      aborted,
      ...(typeof status === 'number' ? { status } : {}),
    }),
  );
}

/**
 * The one method this binding uses, with its result typed as UNTRUSTED.
 *
 * A single, documented narrowing of the SDK surface. The alternative — taking the SDK's own response
 * type — would assert at compile time that a provider's payload has the shape its types claim, which
 * is exactly the assertion this package refuses to make anywhere else. Everything read out of the
 * result below is narrowed at runtime, so the two agree.
 */
interface OpenAiResponsesApi {
  readonly responses: {
    create(body: unknown, init: { readonly signal: AbortSignal }): Promise<unknown>;
  };
}

/**
 * Bind a constructed OpenAI client to the transport seam.
 *
 * The client is passed in rather than built here: constructing it is where a credential is read, and
 * that belongs at the composition edge where a run has already proved it is authorized to spend.
 */
export function createOpenAiSdkTransport(client: OpenAI): OpenAiResponsesTransport {
  const api = client as unknown as OpenAiResponsesApi;

  return {
    async create(body: OpenAiResponsesRequestBody, init) {
      try {
        // The body is already the wire shape, so it is sent as the reviewed object rather than
        // reshaped into an SDK type on the way out.
        const response = await api.responses.create(body, { signal: init.signal });
        const usage = readField(response, 'usage');

        return {
          outputText: readText(response, 'output_text'),
          refused: detectRefusal(readField(response, 'output')),
          inputTokens: readCounter(usage, 'input_tokens'),
          outputTokens: readCounter(usage, 'output_tokens'),
          cachedInputTokens: readNestedCounter(usage, 'input_tokens_details', 'cached_tokens'),
        };
      } catch (error) {
        throw transportErrorFrom(error);
      }
    },
  };
}
