/**
 * The Anthropic adapter (AS3A, ADR-0143 §7).
 *
 * ### The same invariants as the OpenAI side, for the same reasons
 *
 * Stateless: the full message list is sent each turn and nothing is stored provider-side. No tools,
 * no server tools, no web search, no web fetch, no MCP connector — a model that could fetch could put
 * something real into synthetic training data, and no later scan un-does that.
 *
 * ### Thinking is neither requested nor kept
 *
 * Current Claude models think adaptively and return thinking blocks whose text is omitted by default.
 * This adapter never asks for a summary, and the transport hands back only the final structured
 * output: a thinking block is dropped at the boundary, not carried inward and dropped later. AS1 §10
 * refused a hidden reasoning field in the corpus, and a trace nobody reviews is a confidently wrong
 * explanation that looks exactly like a good one.
 *
 * ### No sampling knobs
 *
 * `temperature`, `top_p` and `top_k` were removed on the current Claude generation and are rejected
 * outright there. Depending on them would pin this package to a model family it is explicitly meant
 * to outlive. Output shape is controlled by the schema; output length by `max_tokens`.
 *
 * ### A refusal is a refusal
 *
 * The safety classifier can decline with HTTP 200 and `stop_reason: "refusal"`, so a reply is checked
 * for that before its content is read. It maps to a permanent failure and is never repaired: asking
 * again in different words until something comes back is gate-gaming, and on a decline it is the
 * worst version of it.
 */
import type {
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticModelInvoker,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import { renderRiyaSyntheticRequest } from '../prompts/role-prompts.js';
import type { RiyaSyntheticJsonSchema } from '../prompts/output-schemas.js';
import { runRiyaSyntheticProviderInvocation } from './invocation-runner.js';
import type {
  RiyaSyntheticProviderFailureObserver,
  RiyaSyntheticProviderReply,
} from './invocation-runner.js';

/**
 * The exact body this adapter sends.
 *
 * No `tools`, no `tool_choice`, no `mcp_servers`, no `container`, no `metadata`, and no `thinking` —
 * absent rather than set to a safe value, because a field that exists is a field somebody fills in.
 */
export interface AnthropicMessagesRequestBody {
  readonly model: string;
  /** The role instruction. Identical text to the OpenAI side. */
  readonly system: string;
  readonly messages: readonly {
    readonly role: 'user';
    readonly content: string;
  }[];
  readonly max_tokens: number;
  readonly output_config: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: string;
      readonly schema: RiyaSyntheticJsonSchema;
    };
  };
}

export interface AnthropicMessagesReply {
  readonly outputText: string;
  /** `stop_reason === 'refusal'`. Checked before content is read. */
  readonly refused: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface AnthropicMessagesTransport {
  /**
   * Send one request.
   *
   * MUST observe `signal` and settle afterwards, and MUST throw
   * `RiyaSyntheticProviderTransportError` with a closed kind rather than an SDK error.
   */
  create(
    body: AnthropicMessagesRequestBody,
    init: { readonly signal: AbortSignal },
  ): Promise<AnthropicMessagesReply>;
}

export interface CreateAnthropicMessagesInvokerOptions {
  readonly transport: AnthropicMessagesTransport;
  /** configRef to modelRef, from the config inventory. Never from a response. */
  readonly models: ReadonlyMap<string, string>;
  /** Told the precise failure kind, so run control can stop on an auth fault and only on one. */
  readonly onProviderFailure?: RiyaSyntheticProviderFailureObserver;
}

function schemaName(outputSchemaRef: string): string {
  return outputSchemaRef.replace(/[^A-Za-z0-9_-]/gu, '_');
}

/**
 * Build the request body for one invocation.
 *
 * Exported so a spec can assert on the exact bytes: one user message carrying the projected role
 * view, the shared instruction as `system`, the role's schema bound, and no tool or thinking field
 * anywhere.
 */
export function buildAnthropicMessagesRequest(
  request: RiyaSyntheticInvocationRequestV1,
  structuredInput: unknown,
  modelRef: string,
): AnthropicMessagesRequestBody {
  const rendered = renderRiyaSyntheticRequest(request, structuredInput, modelRef);
  return Object.freeze({
    model: rendered.modelRef,
    system: rendered.systemText,
    messages: Object.freeze([Object.freeze({ role: 'user' as const, content: rendered.userText })]),
    max_tokens: rendered.maxOutputTokens,
    output_config: {
      format: {
        type: 'json_schema' as const,
        name: schemaName(rendered.outputSchemaRef),
        schema: rendered.outputSchema,
      },
    },
  });
}

/** A real-provider invoker for the Anthropic family. Holds no credential. */
export function createAnthropicMessagesInvoker(
  options: CreateAnthropicMessagesInvokerOptions,
): RiyaSyntheticModelInvoker {
  return {
    async invoke(
      request: RiyaSyntheticInvocationRequestV1,
      structuredInput: unknown,
      invocationOptions: RiyaSyntheticInvocationOptions,
    ): Promise<RiyaSyntheticInvocationOutcome> {
      const modelRef = options.models.get(request.configRef);
      if (modelRef === undefined) {
        throw new RiyaSyntheticPilotError('preflight-rejected');
      }

      const body = buildAnthropicMessagesRequest(request, structuredInput, modelRef);

      return runRiyaSyntheticProviderInvocation(
        request,
        invocationOptions,
        async (signal): Promise<RiyaSyntheticProviderReply> => {
          const reply = await options.transport.create(body, { signal });
          return {
            outputText: reply.outputText,
            refused: reply.refused,
            usage: {
              inputTokens: reply.inputTokens,
              outputTokens: reply.outputTokens,
              cachedInputTokens: reply.cachedInputTokens,
            },
          };
        },
        options.onProviderFailure,
      );
    },
  };
}
