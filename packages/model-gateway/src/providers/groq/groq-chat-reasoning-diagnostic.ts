/**
 * The DIAGNOSTIC-ONLY Groq Chat Completions reasoning-effort adapter (POST-RSP20B2 forensics).
 *
 * ### The one variable it exists to move
 *
 * NRA1, MD120B3 and RSP20B2 all returned HTTP 400 `json_validate_failed` on the exact neutral
 * production Riya request. The Lane R forensics established what is NOT the difference: the schema,
 * the model, the output budget, the retry posture and the role sequence are all held constant
 * against OAD3's accepted `O2`. The measured difference is message content volume.
 *
 * They also surfaced a mechanism. ADR-0065's SHADOW V2/V3 pair shows a candidate consuming its ENTIRE
 * `max_completion_tokens` and failing `json_validate_failed` over a **trivial** `{status:"ok"}`
 * schema, while the stable leg closed the same document in 48-69 tokens. `reasoning_effort` was
 * ABSENT on that wire, as it is on Riya's today — and GPT-OSS reasoning tokens are charged against
 * the completion budget.
 *
 * So the narrowest available causal test is not a bigger budget. It is the SAME budget with the
 * reasoning effort named explicitly:
 *
 * - historical: `reasoning_effort` **absent**, provider applies its documented GPT-OSS default;
 * - candidate: `reasoning_effort: 'low'`.
 *
 * ### Why a separate adapter rather than an option on the production one
 *
 * `GroqModelProvider` carries no reasoning field and `GroqChatRequestBody` has no member for one.
 * That absence was pinned deliberately, and `groq-adapter.test.ts` asserts it. Adding an optional
 * parameter to the production adapter would put a reasoning control one argument away from every
 * production invocation, which is exactly the change that is NOT authorized.
 *
 * This mirrors `groq-responses-diagnostic.ts`: a diagnostic instrument beside the production adapter,
 * composed by nobody in production, with no descriptor, capabilities, health or routing identity, so
 * it cannot be selected to serve a turn. `GroqModelProvider` is untouched.
 *
 * ### The body is the production body plus exactly one key
 *
 * Every other field is built the same way the production adapter builds it — same `model`, same
 * `messages`, `stream:false`, `n:1`, the same `max_completion_tokens` clamp, and the same
 * `buildResponseFormat` strict projection. A spec asserts the two bodies are key-for-key identical
 * except `reasoning_effort`, so "one variable" is a property of the code rather than a claim.
 *
 * ### Effort only. Never content.
 *
 * There is no `include_reasoning`, no `reasoning_format`, and nothing that captures, stores or
 * returns a reasoning trace. This controls how much the model thinks, and never what it thought.
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';
import type { GatewayClock } from '../../reliability/clock.js';
import { executeGroqChatDiagnosticExchange } from './groq-chat-diagnostic-exchange.js';
import type { GroqProviderConfig } from './groq-config.js';
import type { GroqChatRequestBody } from './groq-contracts.js';
import { buildResponseFormat } from './groq-structured-output.js';

/**
 * The reasoning efforts Groq documents for GPT-OSS.
 *
 * Recorded as a closed vocabulary so a diagnostic cannot send an unlisted value, and so the
 * documented default is stated where the code that depends on it lives.
 */
export const GROQ_GPT_OSS_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export type GroqGptOssReasoningEffort = (typeof GROQ_GPT_OSS_REASONING_EFFORTS)[number];

/**
 * What Groq applies when the field is OMITTED.
 *
 * Stated carefully, because the distinction matters for reading historical evidence: the historical
 * Riya request **omitted** `reasoning_effort` entirely. It did not carry `'medium'`. Current Groq
 * documentation defines the omitted GPT-OSS default as medium, and that is a fact about the provider
 * today rather than a field that was ever on the wire.
 */
export const GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT: GroqGptOssReasoningEffort = 'medium';

/** The production Chat body plus the one diagnostic field. Nothing else differs. */
export interface GroqChatReasoningDiagnosticRequestBody extends GroqChatRequestBody {
  readonly reasoning_effort: GroqGptOssReasoningEffort;
}

/** What one diagnostic invocation asks for. No sampling, no tools, no reasoning capture. */
export interface GroqChatReasoningDiagnosticInput {
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  /** The already-projected strict JSON Schema document. Sent verbatim; never re-derived here. */
  readonly structuredJsonSchema: unknown;
  /** The completion bound. The SAME production value; this diagnostic does not move it. */
  readonly maxCompletionTokens: number;
  /** THE variable. */
  readonly reasoningEffort: GroqGptOssReasoningEffort;
  readonly signal: AbortSignal;
}

export interface GroqChatReasoningDiagnosticProvider {
  invoke(input: GroqChatReasoningDiagnosticInput): Promise<ProviderInvocationResult>;
}

/**
 * Build the diagnostic request body, or refuse before any transport call.
 *
 * Exported so a spec can compare it against the production body field-for-field without a network.
 * The clamp against the configured ceiling is the same one the production adapter applies: a
 * diagnostic may narrow the budget, never widen it past what the configuration declares.
 */
export function buildGroqChatReasoningDiagnosticBody(
  config: GroqProviderConfig,
  input: GroqChatReasoningDiagnosticInput,
): GroqChatReasoningDiagnosticRequestBody | undefined {
  const built = buildResponseFormat(
    input.structuredJsonSchema,
    config.capabilities.supportsStrictJsonSchema,
  );
  if (!built.ok) {
    return undefined;
  }
  const requested = input.maxCompletionTokens;
  const bounded =
    Number.isInteger(requested) && requested >= 1
      ? Math.min(requested, config.maxCompletionTokens)
      : config.maxCompletionTokens;
  return {
    model: config.modelId,
    messages: input.messages,
    stream: false,
    n: 1,
    max_completion_tokens: bounded,
    response_format: built.responseFormat,
    // THE one field production does not send.
    reasoning_effort: input.reasoningEffort,
  };
}

/**
 * Build the diagnostic adapter over an ALREADY-VALIDATED Groq config.
 *
 * Takes the same `GroqProviderConfig` the production adapter takes, so the diagnostic and production
 * cannot disagree about what the candidate IS. It performs exactly one HTTP request per invoke,
 * never retries and never sleeps, and returns the gateway's own provider-neutral result — including
 * `usage` when the provider reported it, which is what makes this path able to answer a question the
 * historical diagnostics could not.
 */
export function createGroqChatReasoningDiagnosticProvider(
  config: GroqProviderConfig,
  clock: GatewayClock,
): GroqChatReasoningDiagnosticProvider {
  return Object.freeze({
    async invoke(input: GroqChatReasoningDiagnosticInput): Promise<ProviderInvocationResult> {
      const body = buildGroqChatReasoningDiagnosticBody(config, input);
      if (body === undefined) {
        // An invalid strict schema fails BEFORE any transport call, exactly as production does.
        return { status: 'failed', retryable: false };
      }
      // The SHARED exchange: one request, no retry, no sleep, the governed error normalization and
      // production's classification branch for branch. This adapter decides only what body to send,
      // so a second diagnostic cannot classify the same response differently.
      return executeGroqChatDiagnosticExchange(config, clock, body, input.signal);
    },
  });
}
