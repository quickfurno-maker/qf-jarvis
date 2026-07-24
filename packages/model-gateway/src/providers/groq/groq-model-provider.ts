/**
 * The Groq Cloud model provider (QFJ-P04.01B, ADR-0046) — the first real HOSTED provider behind the
 * provider-neutral `ModelProvider` contract.
 *
 * It performs EXACTLY ONE HTTP invocation per `invoke`, through the injected transport, respecting the
 * `AbortSignal`; it never retries and never sleeps (the gateway owns retry/backoff/timeout/budgets).
 * It sends a minimal non-streaming Chat Completions body (one choice, `max_completion_tokens`, no
 * deprecated/unsupported fields, NO tools/functions/MCP/reasoning). It validates the ENTIRE response
 * with a closed schema before reading, parses structured JSON locally for the gateway to validate, and
 * normalizes every HTTP/network failure into the gateway's safe result vocabulary — never surfacing a
 * raw body, header, or key. `health()` fails closed unless the config carries a positive data-controls
 * (ZDR) attestation. Groq-specific types never cross this boundary.
 */
import type { ProviderCapabilities } from '../../contracts/capabilities.js';
import type {
  ModelProvider,
  ProviderDescriptor,
  ProviderHealth,
  ProviderInvocationInput,
  ProviderInvocationResult,
} from '../../contracts/provider.js';
import type { ModelUsage } from '../../contracts/response.js';
import type { GatewayClock } from '../../reliability/clock.js';
import type { GroqProviderConfig } from './groq-config.js';
import {
  GROQ_ACCEPTED_FINISH_REASONS,
  groqChatResponseSchema,
  type GroqChatRequestBody,
} from './groq-contracts.js';
import { normalizeGroqHttpStatus } from './groq-error-normalization.js';
import { buildResponseFormat } from './groq-structured-output.js';
import { GROQ_CHAT_COMPLETIONS_ENDPOINT, type GroqTransport } from './groq-transport.js';

const HTTP_OK = 200;

/**
 * Read `signal.aborted` without TypeScript narrowing it to a constant. The signal can flip to aborted
 * during an awaited transport call, so a fresh read after the await is meaningful even though a prior
 * guard checked it.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function buildUsage(
  usage:
    | {
        prompt_tokens?: number | undefined;
        completion_tokens?: number | undefined;
        total_tokens?: number | undefined;
      }
    | undefined,
): ModelUsage {
  if (usage === undefined) {
    return {};
  }
  return {
    ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens === undefined ? {} : { outputTokens: usage.completion_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
  };
}

export class GroqModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly config: GroqProviderConfig;
  private readonly transport: GroqTransport;
  private readonly clock: GatewayClock;

  public constructor(config: GroqProviderConfig, clock: GatewayClock) {
    this.config = config;
    this.transport = config.transport;
    this.clock = clock;
    this.descriptor = Object.freeze({
      providerId: config.providerId,
      executionClass: 'HOSTED' as const,
    });
  }

  public capabilities(): ProviderCapabilities {
    return this.config.capabilities;
  }

  /** Fail closed unless a positive data-controls (ZDR) attestation was supplied at composition. */
  public health(): Promise<ProviderHealth> {
    return Promise.resolve({ available: this.config.dataControlsAttested });
  }

  public async invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult> {
    if (isAborted(input.signal)) {
      return { status: 'cancelled' };
    }

    let responseFormat: GroqChatRequestBody['response_format'];
    if (input.resultMode === 'STRUCTURED') {
      const built = buildResponseFormat(
        input.structuredJsonSchema,
        this.config.capabilities.supportsStrictJsonSchema,
      );
      if (!built.ok) {
        // An invalid strict schema fails BEFORE any transport call.
        return { status: 'failed', retryable: false };
      }
      responseFormat = built.responseFormat;
    }

    const body: GroqChatRequestBody = {
      model: this.config.modelId,
      messages: input.messages,
      stream: false,
      n: 1,
      max_completion_tokens: this.config.maxCompletionTokens,
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    };

    const httpRequest = {
      url: GROQ_CHAT_COMPLETIONS_ENDPOINT,
      headers: {
        'content-type': 'application/json',
        authorization: this.config.apiKey.authorizationHeaderValue(),
      },
      body: JSON.stringify(body),
    };

    const start = this.clock.now();
    let response;
    try {
      response = await this.transport.send(httpRequest, input.signal);
    } catch {
      if (isAborted(input.signal)) {
        return { status: 'cancelled' };
      }
      // Network/DNS/TLS/connect failure — transient, retryable.
      return { status: 'unavailable', retryable: true };
    }
    const latencyMs = Math.max(0, this.clock.now() - start);

    if (response.status !== HTTP_OK) {
      return normalizeGroqHttpStatus(response.status);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.bodyText);
    } catch {
      return { status: 'malformed', latencyMs };
    }
    const parsed = groqChatResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { status: 'malformed', latencyMs };
    }
    if (parsed.data.choices.length !== 1) {
      return { status: 'failed', retryable: false };
    }
    const choice = parsed.data.choices[0];
    if (choice === undefined) {
      return { status: 'failed', retryable: false };
    }
    const content = choice.message.content;
    if (typeof content !== 'string') {
      return { status: 'failed', retryable: false };
    }
    const finishReason = choice.finish_reason;
    if (
      finishReason !== null &&
      finishReason !== undefined &&
      !(GROQ_ACCEPTED_FINISH_REASONS as readonly string[]).includes(finishReason)
    ) {
      return { status: 'failed', retryable: false };
    }

    const usage = buildUsage(parsed.data.usage);

    if (input.resultMode === 'STRUCTURED') {
      let value: unknown;
      try {
        value = JSON.parse(content);
      } catch {
        return { status: 'malformed', latencyMs };
      }
      return { status: 'completed', output: { mode: 'STRUCTURED', value }, usage, latencyMs };
    }
    return { status: 'completed', output: { mode: 'TEXT', text: content }, usage, latencyMs };
  }
}
