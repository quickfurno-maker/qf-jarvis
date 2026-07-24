/**
 * The local OpenAI-compatible model provider (QFJ-P04.01C, ADR-0047) — the first LOCAL-execution provider
 * behind the provider-neutral `ModelProvider` contract, alongside the hosted Groq adapter.
 *
 * It performs EXACTLY ONE HTTP invocation per `invoke`, through the injected transport, to the pre-
 * validated private endpoint, respecting the `AbortSignal`; it never retries and never sleeps (the
 * gateway owns retry/backoff/timeout/budgets). It sends a minimal non-streaming Chat Completions body
 * (one choice, `max_tokens`, no tools/functions/MCP/reasoning, no model discovery). It validates the
 * response content-type and the ENTIRE body with a closed schema before reading, parses structured JSON
 * locally for the gateway to validate, and normalizes every HTTP/network failure into the gateway's safe
 * result vocabulary — never surfacing a raw body, header, or token. `health()` fails closed unless the
 * config carries all three activation attestations. Local-specific types never cross this boundary.
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
import {
  LOCAL_ACCEPTED_FINISH_REASONS,
  localChatResponseSchema,
  type LocalChatRequestBody,
} from './local-contracts.js';
import { normalizeLocalHttpStatus } from './local-error-normalization.js';
import type { LocalProviderConfig } from './local-provider-config.js';
import { buildResponseFormat } from './local-structured-output.js';
import type { LocalTransport } from './local-transport.js';

const HTTP_OK = 200;

/**
 * Read `signal.aborted` without TypeScript narrowing it to a constant. The signal can flip to aborted
 * during an awaited transport call, so a fresh read after the await is meaningful even though a prior
 * guard checked it.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** True iff a content-type header names JSON (bounded, case-insensitive, ignores parameters). */
function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType.trim());
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

export class LocalOpenAICompatibleModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly config: LocalProviderConfig;
  private readonly transport: LocalTransport;
  private readonly clock: GatewayClock;

  public constructor(config: LocalProviderConfig, clock: GatewayClock) {
    this.config = config;
    this.transport = config.transport;
    this.clock = clock;
    this.descriptor = Object.freeze({
      providerId: config.providerId,
      executionClass: 'LOCAL' as const,
    });
  }

  public capabilities(): ProviderCapabilities {
    return this.config.capabilities;
  }

  /** Fail closed unless the endpoint, model, and auth/TLS posture were all attested at composition. */
  public health(): Promise<ProviderHealth> {
    const available =
      this.config.endpointAttested && this.config.modelAttested && this.config.authPostureAttested;
    return Promise.resolve({ available });
  }

  public async invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult> {
    if (isAborted(input.signal)) {
      return { status: 'cancelled' };
    }

    let responseFormat: LocalChatRequestBody['response_format'];
    if (input.resultMode === 'STRUCTURED') {
      const built = buildResponseFormat(input.structuredJsonSchema, this.config.structuredOutput);
      if (!built.ok) {
        // An unsupported or invalid strict schema fails BEFORE any transport call.
        return { status: 'failed', retryable: false };
      }
      responseFormat = built.responseFormat;
    }

    const body: LocalChatRequestBody = {
      model: this.config.modelId,
      messages: input.messages,
      stream: false,
      n: 1,
      max_tokens: this.config.maxCompletionTokens,
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.authToken !== undefined) {
      headers['authorization'] = this.config.authToken.authorizationHeaderValue();
    }

    const httpRequest = {
      url: this.config.endpoint.chatCompletionsUrl,
      headers,
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
      return normalizeLocalHttpStatus(response.status);
    }
    if (!isJsonContentType(response.contentType)) {
      // A 200 that is not JSON (e.g. an HTML captive-portal / proxy page) is malformed, not a model reply.
      return { status: 'malformed', latencyMs };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.bodyText);
    } catch {
      return { status: 'malformed', latencyMs };
    }
    const parsed = localChatResponseSchema.safeParse(parsedJson);
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
      !(LOCAL_ACCEPTED_FINISH_REASONS as readonly string[]).includes(finishReason)
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
