/**
 * The NaraRouter model provider (JF-2A, ADR-0146) — the second real HOSTED provider behind the
 * provider-neutral `ModelProvider` contract.
 *
 * It performs EXACTLY ONE HTTP invocation per `invoke`, through the injected transport, respecting the
 * `AbortSignal`; it never retries and never sleeps (the gateway owns retry/backoff/timeout/budgets).
 * It sends a minimal non-streaming Chat Completions body (one choice, `max_tokens`, NO tools, NO
 * functions, NO MCP, NO reasoning fields, NO provider-side agent). It validates the ENTIRE response
 * with a closed schema before reading, parses structured JSON locally for the gateway to validate, and
 * normalizes every HTTP/network failure into the gateway's safe result vocabulary — never surfacing a
 * raw body, header, or key. `health()` fails closed unless the config carries a positive data-controls
 * attestation. Nara-specific types never cross this boundary.
 *
 * ### It decides nothing about providers
 *
 * This adapter normalizes an outcome. Whether a normalized failure earns the single bounded fallback is
 * `decideFallover`'s decision, made from the policy — not this file's, and not per-request. There is no
 * reference to Groq here, no second attempt, and no path that could call another provider.
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
import type { NaraProviderConfig } from './nara-config.js';
import {
  NARA_ACCEPTED_FINISH_REASONS,
  naraChatResponseSchema,
  type NaraChatRequestBody,
} from './nara-contracts.js';
import { normalizeNaraHttpStatus } from './nara-error-normalization.js';
import { buildNaraSchemaGuidance, withSchemaGuidance } from './nara-schema-guidance.js';
import { NARA_CHAT_COMPLETIONS_ENDPOINT, type NaraTransport } from './nara-transport.js';

const HTTP_OK = 200;

/**
 * Read `signal.aborted` without TypeScript narrowing it to a constant. The signal can flip to aborted
 * during an awaited transport call, so a fresh read after the await is meaningful even though a prior
 * guard checked it.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Project the provider's reported usage onto the gateway's neutral shape.
 *
 * Absent fields stay ABSENT. A missing token count is not zero — zero is a measurement and absence is
 * the lack of one, and a fabricated zero would flow into cost accounting as a free request. `cost` is
 * deliberately never populated here: this repository has no versioned pricing registry, so the honest
 * output is the token facts, and money is computed later by something that owns a price.
 */
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

export class NaraModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly config: NaraProviderConfig;
  private readonly transport: NaraTransport;
  private readonly clock: GatewayClock;

  public constructor(config: NaraProviderConfig, clock: GatewayClock) {
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

  /** Fail closed unless a positive data-controls attestation was supplied at composition. */
  public health(): Promise<ProviderHealth> {
    return Promise.resolve({ available: this.config.dataControlsAttested });
  }

  /**
   * The completion bound this invocation puts on the wire.
   *
   * The request's own budget wins when it is smaller, and it can only ever narrow: the configured model
   * ceiling is still applied with `Math.min`, so an application cannot use this to ask for more than the
   * model was configured to give. A request naming no budget gets the ceiling.
   */
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

    // STRUCTURED goes out as `json_object`. Nara declares no strict JSON-Schema support (see
    // NARA_SUPPORTS_STRICT_JSON_SCHEMA), and the gateway validates the returned value against the real
    // schema regardless — the wire hint was never the authority.
    const responseFormat: NaraChatRequestBody['response_format'] =
      input.resultMode === 'STRUCTURED' ? { type: 'json_object' } : undefined;

    // JF-5B-R4. `json_object` asks for "some JSON" and says nothing about WHICH JSON, and two
    // authenticated live runs failed every hard gate for exactly that reason: the model was asked for an
    // object and never shown the object. The schema was never missing -- the gateway renders it into
    // `structuredJsonSchema` and the Groq provider already consumes it -- so this provider consumes the
    // SAME document and, lacking a strict mode to be handed it in, puts it in a message instead.
    //
    // Fails CLOSED before the network on a missing, unserializable or oversized schema. A structured
    // request we cannot describe is a request we should not spend on.
    let messages = input.messages;
    if (input.resultMode === 'STRUCTURED') {
      const guidance = buildNaraSchemaGuidance(input.structuredJsonSchema);
      if (!guidance.ok) {
        return { status: 'failed', retryable: false };
      }
      messages = withSchemaGuidance(input.messages, {
        role: 'system',
        content: guidance.content,
      });
    }

    const body: NaraChatRequestBody = {
      model: this.config.modelId,
      messages,
      stream: false,
      n: 1,
      max_tokens: this.completionTokensFor(input),
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    };

    const httpRequest = {
      url: NARA_CHAT_COMPLETIONS_ENDPOINT,
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
      // The status number is the ENTIRE input to normalization. No body, message or header is read.
      return normalizeNaraHttpStatus(response.status);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.bodyText);
    } catch {
      return { status: 'malformed', latencyMs };
    }
    const parsed = naraChatResponseSchema.safeParse(parsedJson);
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
      !(NARA_ACCEPTED_FINISH_REASONS as readonly string[]).includes(finishReason)
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
