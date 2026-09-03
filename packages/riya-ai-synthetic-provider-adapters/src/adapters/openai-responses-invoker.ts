/**
 * The OpenAI adapter (AS3A, ADR-0143 §6).
 *
 * ### A stateless, tool-less, store-less request — every one of those on purpose
 *
 * `store: false` because a corpus build must not leave conversation state on a provider's side; a
 * stored response is a copy of generated dialogue in a place this repository cannot audit or delete.
 * No tools, no web search, no file search: a model that could fetch is a model that could put
 * something real into synthetic training data, which is the one contamination no later scan can
 * undo. No conversation id and no previous-response id: turn-by-turn state is the harness's, and a
 * provider-side thread would make "what did the teacher see" unanswerable from the artifacts.
 *
 * ### Structured output is requested, and is still not authority
 *
 * The role's JSON Schema goes on the request with `strict: true`, which makes a well-formed reply far
 * more likely. It changes nothing about trust: the bytes come back untrusted and go through AS2's
 * bounded parse, strict schema and canonical constructors exactly as a fake adapter's would.
 *
 * ### The transport seam
 *
 * The adapter builds a request and interprets a reply; a BINDING talks to the SDK. That split is what
 * lets every rule above be tested — store disabled, no tools, the schema actually bound, the
 * projected input and nothing else — with zero network, zero credential and zero spend.
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
 * Snake-cased to mirror the wire, so a reviewer comparing it against the provider's documentation is
 * comparing like with like. There is deliberately no `tools`, no `tool_choice`, no `conversation`, no
 * `previous_response_id`, no `metadata` and no `user` field — absent, not set to a safe value,
 * because a field that exists is a field somebody can fill in later.
 */
export interface OpenAiResponsesRequestBody {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly max_output_tokens: number;
  /** Always false. No provider-side conversation state, ever. */
  readonly store: false;
  readonly text: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: string;
      readonly strict: true;
      readonly schema: RiyaSyntheticJsonSchema;
    };
  };
}

/** Everything the adapter is willing to learn from a reply. */
export interface OpenAiResponsesReply {
  readonly outputText: string;
  readonly refused: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface OpenAiResponsesTransport {
  /**
   * Send one request.
   *
   * MUST observe `signal` and settle afterwards. MUST throw `RiyaSyntheticProviderTransportError`
   * with a closed kind rather than an SDK error — a raw provider error carries a request id, an
   * account hint or a truncated prompt, and this is the boundary where that stops.
   */
  create(
    body: OpenAiResponsesRequestBody,
    init: { readonly signal: AbortSignal },
  ): Promise<OpenAiResponsesReply>;
}

export interface CreateOpenAiResponsesInvokerOptions {
  readonly transport: OpenAiResponsesTransport;
  /** configRef to modelRef. Built from the config inventory at composition, never from a response. */
  readonly models: ReadonlyMap<string, string>;
  /** Told the precise failure kind, so run control can stop on an auth fault and only on one. */
  readonly onProviderFailure?: RiyaSyntheticProviderFailureObserver;
}

/** The schema name a provider sees. The ref itself, so a captured request says which contract it used. */
function schemaName(outputSchemaRef: string): string {
  return outputSchemaRef.replace(/[^A-Za-z0-9_-]/gu, '_');
}

/**
 * Build the request body for one invocation.
 *
 * Exported so a spec can assert on the exact bytes rather than on the adapter's intentions: that
 * `store` is false, that no tool field exists, that the schema is the role's, and that `input`
 * carries the projected role view and nothing the role may not see.
 */
export function buildOpenAiResponsesRequest(
  request: RiyaSyntheticInvocationRequestV1,
  structuredInput: unknown,
  modelRef: string,
): OpenAiResponsesRequestBody {
  const rendered = renderRiyaSyntheticRequest(request, structuredInput, modelRef);
  return Object.freeze({
    model: rendered.modelRef,
    instructions: rendered.systemText,
    input: rendered.userText,
    max_output_tokens: rendered.maxOutputTokens,
    store: false as const,
    text: {
      format: {
        type: 'json_schema' as const,
        name: schemaName(rendered.outputSchemaRef),
        strict: true as const,
        schema: rendered.outputSchema,
      },
    },
  });
}

/**
 * A real-provider invoker for the OpenAI family.
 *
 * Holds no credential: the transport it is given already knows how to reach a provider, and this
 * object could not leak a key because it never sees one.
 */
export function createOpenAiResponsesInvoker(
  options: CreateOpenAiResponsesInvokerOptions,
): RiyaSyntheticModelInvoker {
  return {
    async invoke(
      request: RiyaSyntheticInvocationRequestV1,
      structuredInput: unknown,
      invocationOptions: RiyaSyntheticInvocationOptions,
    ): Promise<RiyaSyntheticInvocationOutcome> {
      const modelRef = options.models.get(request.configRef);
      if (modelRef === undefined) {
        // A config this adapter was never wired for. Preflight should have caught it; failing here
        // rather than guessing a model keeps "which model wrote this row" answerable.
        throw new RiyaSyntheticPilotError('preflight-rejected');
      }

      // Rendering and projection happen BEFORE the transport exists, so a role-input violation costs
      // zero provider calls.
      const body = buildOpenAiResponsesRequest(request, structuredInput, modelRef);

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
