/**
 * The Anthropic SDK binding (AS3A, ADR-0143 §7).
 *
 * ### The only file in this repository that talks to Anthropic
 *
 * The mirror of the OpenAI binding, and deliberately the same shape: hand over the body, read the
 * final text and three integers, convert an SDK error into a closed kind through the SAME pure
 * classifier. Two bindings with two error philosophies would put a provider difference into the
 * corpus that no one intended to record.
 *
 * ### Thinking blocks are read past, not stored
 *
 * A reply's content is a list of blocks. Only `text` blocks are taken. A `thinking` block — summarized
 * or empty — is skipped here, at the boundary, so no part of this package ever holds one. `redacted`
 * variants are skipped by the same rule, because the rule is an allowlist rather than a list of
 * things to remove.
 *
 * ### The refusal check happens before the content is read
 *
 * A safety decline arrives as HTTP 200 with `stop_reason: "refusal"`. Reading content first would
 * find an empty or partial reply and classify it as malformed — which is repairable, and a refusal
 * must never be repaired.
 */
import Anthropic from '@anthropic-ai/sdk';

import {
  RiyaSyntheticProviderTransportError,
  classifyRiyaSyntheticProviderFailure,
} from '../contracts/provider-errors.js';
import type {
  AnthropicMessagesRequestBody,
  AnthropicMessagesTransport,
} from './anthropic-messages-invoker.js';

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

/** One field of an untrusted object, as `unknown`. */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * The final text, and only the final text.
 *
 * An ALLOWLIST on `type === 'text'`, not a denylist of block kinds to skip. A denylist would silently
 * start including whatever block type ships next.
 */
function finalTextOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as readonly unknown[]) {
    if (typeof block !== 'object' || block === null) continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text);
  }
  return parts.join('');
}

function transportErrorFrom(error: unknown): RiyaSyntheticProviderTransportError {
  const aborted = error instanceof Anthropic.APIUserAbortError;
  // The status is read through the same narrowing used for everything else that crosses this
  // boundary. The SDK types it loosely, and a status is the ONE thing from an error that is allowed
  // inward -- so it is proved to be a number here rather than trusted to be one.
  const raw = error instanceof Anthropic.APIError ? readField(error, 'status') : undefined;
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
 * The mirror of the OpenAI binding's seam, and for the same reason: taking the SDK's own response
 * type would assert at compile time that a provider's payload has the shape its types claim.
 * Everything read out of the result below is narrowed at runtime instead.
 */
interface AnthropicMessagesApi {
  readonly messages: {
    create(body: unknown, init: { readonly signal: AbortSignal }): Promise<unknown>;
  };
}

/** Bind a constructed Anthropic client to the transport seam. The client is built at the edge. */
export function createAnthropicSdkTransport(client: Anthropic): AnthropicMessagesTransport {
  const api = client as unknown as AnthropicMessagesApi;

  return {
    async create(body: AnthropicMessagesRequestBody, init) {
      try {
        const message = await api.messages.create(body, { signal: init.signal });
        // BEFORE the content is read. A decline arrives as HTTP 200 with a refusal stop reason, and
        // reading content first would find an empty reply and call it malformed -- which is
        // repairable, and a refusal must never be repaired.
        const refused = readField(message, 'stop_reason') === 'refusal';
        const usage = readField(message, 'usage');

        return {
          outputText: refused ? '' : finalTextOf(readField(message, 'content')),
          refused,
          inputTokens: readCounter(usage, 'input_tokens'),
          outputTokens: readCounter(usage, 'output_tokens'),
          cachedInputTokens: readCounter(usage, 'cache_read_input_tokens'),
        };
      } catch (error) {
        throw transportErrorFrom(error);
      }
    },
  };
}
