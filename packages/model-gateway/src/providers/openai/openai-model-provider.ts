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
import type { OpenAIProviderConfig } from './openai-config.js';
import {
  extractOpenAIOutputText,
  openAIResponsesEnvelopeSchema,
  type OpenAIResponsesRequestBody,
} from './openai-contracts.js';
import { normalizeOpenAIHttpStatus } from './openai-error-normalization.js';
import { OPENAI_RESPONSES_ENDPOINT, type OpenAITransport } from './openai-transport.js';

const HTTP_OK = 200;

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function buildUsage(
  usage:
    | {
        input_tokens?: number | undefined;
        output_tokens?: number | undefined;
        total_tokens?: number | undefined;
      }
    | undefined,
): ModelUsage {
  if (usage === undefined) {
    return {};
  }
  return {
    ...(usage.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
    ...(usage.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
  };
}

export class OpenAIModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly config: OpenAIProviderConfig;
  private readonly transport: OpenAITransport;
  private readonly clock: GatewayClock;

  public constructor(config: OpenAIProviderConfig, clock: GatewayClock) {
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

  public health(): Promise<ProviderHealth> {
    return Promise.resolve({ available: this.config.dataControlsAttested });
  }

  private completionTokensFor(input: ProviderInvocationInput): number {
    const requested = input.maxCompletionTokens;
    if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
      return this.config.maxCompletionTokens;
    }
    return Math.min(requested, this.config.maxCompletionTokens);
  }

  public async invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult> {
    if (isAborted(input.signal)) {
      return { status: 'cancelled' };
    }
    if (input.resultMode === 'STRUCTURED' && input.structuredJsonSchema === undefined) {
      return { status: 'failed', retryable: false };
    }

    const body: OpenAIResponsesRequestBody = {
      model: this.config.modelId,
      input: input.messages,
      max_output_tokens: this.completionTokensFor(input),
      store: false,
      ...(input.resultMode === 'STRUCTURED'
        ? {
            text: {
              format: {
                type: 'json_schema' as const,
                name: 'qf_jarvis_response' as const,
                strict: true as const,
                schema: input.structuredJsonSchema,
              },
            },
          }
        : {}),
    };

    const request = {
      url: OPENAI_RESPONSES_ENDPOINT,
      headers: {
        'content-type': 'application/json',
        authorization: this.config.apiKey.authorizationHeaderValue(),
      },
      body: JSON.stringify(body),
    };

    const start = this.clock.now();
    let response;
    try {
      response = await this.transport.send(request, input.signal);
    } catch {
      return isAborted(input.signal)
        ? { status: 'cancelled' }
        : { status: 'unavailable', retryable: true };
    }
    const latencyMs = Math.max(0, this.clock.now() - start);

    if (response.status !== HTTP_OK) {
      return normalizeOpenAIHttpStatus(response.status);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.bodyText);
    } catch {
      return { status: 'malformed', latencyMs };
    }
    const parsed = openAIResponsesEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      return { status: 'malformed', latencyMs };
    }
    if (parsed.data.status !== 'completed') {
      return parsed.data.status === 'incomplete'
        ? { status: 'malformed', latencyMs }
        : { status: 'failed', retryable: false };
    }

    const extracted = extractOpenAIOutputText(parsed.data.output);
    if (!extracted.ok) {
      return extracted.kind === 'refusal'
        ? { status: 'failed', retryable: false }
        : { status: 'malformed', latencyMs };
    }

    const usage = buildUsage(parsed.data.usage);
    if (input.resultMode === 'STRUCTURED') {
      let value: unknown;
      try {
        value = JSON.parse(extracted.text);
      } catch {
        return { status: 'malformed', latencyMs };
      }
      return { status: 'completed', output: { mode: 'STRUCTURED', value }, usage, latencyMs };
    }
    return {
      status: 'completed',
      output: { mode: 'TEXT', text: extracted.text },
      usage,
      latencyMs,
    };
  }
}
