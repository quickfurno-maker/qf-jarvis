/**
 * The DIAGNOSTIC-ONLY Groq Responses API adapter (POST-MD120B3).
 *
 * ### What this is for, and what it is not
 *
 * MD120B3 established that the same neutral, full production-built Riya request under Groq **Chat
 * Completions** strict structured output is refused with HTTP 400 / `json_validate_failed` on BOTH
 * `openai/gpt-oss-20b` and `openai/gpt-oss-120b`. Changing the model did not repair the path.
 *
 * Groq documents a second output contract for the same models — the Responses API, at
 * `/openai/v1/responses` — and documents structured outputs on it. So the next question is whether the
 * SAME request traverses THAT contract, and answering it needs an adapter that speaks that envelope.
 *
 * This is that adapter, and nothing more. It is a DIAGNOSTIC instrument:
 *
 * - no production composition in this repository builds it, and a spec asserts that;
 * - it is not registered with the gateway, has no provider descriptor, no capability record, no
 *   health check and no routing identity, so it cannot be selected to serve a turn;
 * - the Responses API is currently BETA, which is a reason to measure it and not a reason to adopt it.
 *
 * `GroqModelProvider` — the production Chat Completions adapter — is untouched.
 *
 * ### The envelope difference is the ONLY intended difference
 *
 * Chat Completions carries `messages`, `max_completion_tokens` and
 * `response_format.json_schema.schema`. Responses carries `input`, `max_output_tokens` and
 * `text.format.schema`. Those three renamings ARE the experiment. Everything else is held: the same
 * role sequence, the same content bytes, the same projected JSON Schema document, the same strict
 * flag, the same single non-streaming request, and no sampling, reasoning, tool, state or background
 * field anywhere.
 *
 * `store` is sent as `false` explicitly. The Responses API is stateful by design, and a diagnostic
 * that silently left a copy of a production prompt on a provider would be a privacy decision nobody
 * made.
 *
 * ### Content discipline
 *
 * The result carries a boolean, a bounded usage triple, and — only on a 2xx that parsed — the decoded
 * structured VALUE, which exists so the caller can run the local canonical validator against it. That
 * value is consumed by a validator and never emitted: no field of this module's output is a message,
 * a prompt, a raw body, an error envelope, a reasoning trace or a credential.
 *
 * Reasoning items are a real part of a GPT-OSS Responses payload and are deliberately skipped rather
 * than read: only `output_text` inside an assistant `message` item is decoded.
 */
import { z } from 'zod';

import type { ModelUsage } from '../../contracts/response.js';
import type { GatewayClock } from '../../reliability/clock.js';
import type { GroqProviderConfig } from './groq-config.js';
import { GROQ_RESPONSES_ENDPOINT } from './groq-transport.js';

const HTTP_OK = 200;

/** The one `status` a Responses payload may carry for its output to be read. */
const RESPONSES_COMPLETED_STATUS = 'completed';

/** The minimal Groq Responses request body this adapter builds. Non-streaming, stateless, no tools. */
export interface GroqResponsesDiagnosticRequestBody {
  readonly model: string;
  readonly input: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly max_output_tokens: number;
  readonly stream: false;
  /** Stateless on purpose: no server-side copy of a production prompt. */
  readonly store: false;
  readonly text: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: string;
      readonly strict: boolean;
      readonly schema: unknown;
    };
  };
}

/**
 * The closed schema for a Groq Responses payload.
 *
 * Loose at the object level so an unknown provider key does not make a real response "malformed",
 * exactly as the Chat Completions schema is — but every key this adapter READS is declared here, and
 * nothing outside this schema is ever consulted.
 */
export const groqResponsesResponseSchema = z
  .object({
    id: z.string().max(256).optional(),
    status: z.string().max(64).nullable().optional(),
    output: z
      .array(
        z
          .object({
            type: z.string().max(64).optional(),
            role: z.string().max(64).optional(),
            content: z
              .array(
                z
                  .object({
                    type: z.string().max(64).optional(),
                    text: z.string().max(2_000_000).nullable().optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
    usage: z
      .object({
        input_tokens: z.number().int().min(0).optional(),
        output_tokens: z.number().int().min(0).optional(),
        total_tokens: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .loose();

export type GroqResponsesResponse = z.infer<typeof groqResponsesResponseSchema>;

/**
 * What ONE diagnostic Responses invocation produced.
 *
 * `providerCompleted` means the provider returned 2xx AND the payload decoded into a structured
 * value. It deliberately says nothing about whether that value satisfies Riya's canonical contract —
 * that is the caller's local validator's job, and collapsing the two would let a 2xx stand in for an
 * answer the provider never gave.
 */
export interface GroqResponsesDiagnosticResult {
  readonly providerCompleted: boolean;
  /** The decoded structured value, present ONLY when `providerCompleted`. Never emitted. */
  readonly structuredValue?: unknown;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
}

/** What one diagnostic invocation asks for. No sampling, no reasoning, no tools, no prior state. */
export interface GroqResponsesDiagnosticInput {
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  /** The already-projected strict JSON Schema document. Sent verbatim; never re-derived here. */
  readonly structuredJsonSchema: unknown;
  /** The schema NAME the envelope requires. An identifier, never derived from content. */
  readonly schemaName: string;
  /** The provider output bound — the Responses field for what Chat Completions calls its completion cap. */
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
}

/** The adapter's one method. Deliberately NOT the gateway's provider contract: this cannot be routed to. */
export interface GroqResponsesDiagnosticProvider {
  invoke(input: GroqResponsesDiagnosticInput): Promise<GroqResponsesDiagnosticResult>;
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function buildUsage(usage: GroqResponsesResponse['usage']): ModelUsage {
  if (usage === undefined) {
    return {};
  }
  return {
    ...(usage.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
    ...(usage.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
  };
}

/**
 * Build the request body. Exported so a spec can assert the WIRE shape without a transport.
 *
 * The output bound is clamped by the configured capability ceiling exactly as the Chat Completions
 * adapter clamps its completion cap, so a diagnostic cannot ask a model for more than its
 * configuration declares. It can only ever narrow.
 */
export function buildGroqResponsesDiagnosticBody(
  config: GroqProviderConfig,
  input: GroqResponsesDiagnosticInput,
): GroqResponsesDiagnosticRequestBody {
  const requested = input.maxOutputTokens;
  const bounded =
    Number.isInteger(requested) && requested >= 1
      ? Math.min(requested, config.maxCompletionTokens)
      : config.maxCompletionTokens;
  return {
    model: config.modelId,
    // The SAME role-based sequence Chat Completions carries as `messages`.
    input: input.messages,
    max_output_tokens: bounded,
    stream: false,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: input.schemaName,
        strict: true,
        schema: input.structuredJsonSchema,
      },
    },
  };
}

/** A successful decode: the structured value and the usage that came with it. */
export type GroqResponsesDecode =
  | { readonly ok: true; readonly value: unknown; readonly usage: ModelUsage }
  | { readonly ok: false };

/**
 * Decode the ONE structured value out of a Responses payload, or report that there is not one.
 *
 * Walks `output` for the assistant `message` item and concatenates its `output_text` parts, which is
 * how the Responses envelope represents a single textual result. Reasoning items carry a different
 * `type` and are skipped without being read.
 *
 * Exported so a spec can pin the decode against real payload shapes without a transport.
 */
export function decodeGroqResponsesStructuredValue(bodyText: string): GroqResponsesDecode {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    return { ok: false };
  }
  const parsed = groqResponsesResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false };
  }
  const payload = parsed.data;
  if (payload.status !== RESPONSES_COMPLETED_STATUS) {
    // `incomplete` (a truncated document) and `failed` are both "no result", and neither is read
    // further: `incomplete_details` and any error envelope stay unconsulted.
    return { ok: false };
  }
  const items = payload.output ?? [];
  const messages = items.filter((item) => item.type === 'message');
  if (messages.length !== 1) {
    // Zero means no assistant turn came back; more than one means an envelope this adapter has never
    // been shown, and guessing which one is the answer is not a thing a diagnostic may do.
    return { ok: false };
  }
  const message = messages[0];
  if (message === undefined) {
    return { ok: false };
  }
  const parts = (message.content ?? []).filter((part) => part.type === 'output_text');
  if (parts.length === 0) {
    return { ok: false };
  }
  let text = '';
  for (const part of parts) {
    if (typeof part.text !== 'string') {
      return { ok: false };
    }
    text += part.text;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // A 2xx whose body is not the JSON document the schema demanded. Reported as "no result" rather
    // than repaired — there is no model-based JSON repair anywhere in this package.
    return { ok: false };
  }
  return { ok: true, value, usage: buildUsage(payload.usage) };
}

/**
 * Build the diagnostic adapter over an ALREADY-VALIDATED Groq config.
 *
 * Takes the same `GroqProviderConfig` the production adapter takes — same validated model identity,
 * same injected key holder, same injected transport, same capability ceiling — so the diagnostic and
 * the production path cannot disagree about what the candidate IS. The transport it is handed must be
 * a Responses transport; the endpoint is named here and the transport's own SSRF guard enforces it.
 */
export function createGroqResponsesDiagnosticProvider(
  config: GroqProviderConfig,
  clock: GatewayClock,
): GroqResponsesDiagnosticProvider {
  return Object.freeze({
    async invoke(input: GroqResponsesDiagnosticInput): Promise<GroqResponsesDiagnosticResult> {
      if (isAborted(input.signal)) {
        return { providerCompleted: false, usage: {}, latencyMs: 0 };
      }
      const httpRequest = {
        url: GROQ_RESPONSES_ENDPOINT,
        headers: {
          'content-type': 'application/json',
          authorization: config.apiKey.authorizationHeaderValue(),
        },
        body: JSON.stringify(buildGroqResponsesDiagnosticBody(config, input)),
      };

      const start = clock.now();
      let response;
      try {
        response = await config.transport.send(httpRequest, input.signal);
      } catch {
        // The thrown object is never read. The transport observer already recorded the crossing.
        return { providerCompleted: false, usage: {}, latencyMs: Math.max(0, clock.now() - start) };
      }
      const latencyMs = Math.max(0, clock.now() - start);
      if (response.status !== HTTP_OK) {
        // The body is NOT consulted here. Classifying a non-2xx belongs to the caller's transport
        // observation layer, which reads two allowlisted keys and discards the rest.
        return { providerCompleted: false, usage: {}, latencyMs };
      }
      const decoded = decodeGroqResponsesStructuredValue(response.bodyText);
      if (!decoded.ok) {
        return { providerCompleted: false, usage: {}, latencyMs };
      }
      return {
        providerCompleted: true,
        structuredValue: decoded.value,
        usage: decoded.usage,
        latencyMs,
      };
    },
  });
}
