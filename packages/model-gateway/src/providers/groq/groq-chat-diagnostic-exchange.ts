/**
 * The ONE Chat Completions exchange every governed Groq diagnostic adapter performs.
 *
 * INTERNAL. Not exported from the package root, and deliberately not from the provider barrel: it
 * takes an already-built request body, so a caller holding it could send any body at all. What may
 * be sent is decided by each diagnostic's own body builder, which is where it can be reviewed.
 *
 * ### Why this was extracted rather than copied
 *
 * The reasoning-effort adapter's invoke was the whole of it: one HTTP request, no retry, no sleep,
 * the governed error normalization, and then production's classification branch for branch. A second
 * diagnostic adapter that copied it would be a second place for that classification to drift — and
 * drift there is the specific failure that already had to be corrected once. A response that
 * normalizes differently between two adapters turns a one-variable differential into a
 * two-variable one, silently, and the receipt would still claim one.
 *
 * So the exchange lives here, once. Each adapter decides only WHAT BODY to send.
 *
 * ### The classification is production's, branch for branch
 *
 * A body that does not parse is `malformed`. A parsed body carrying anything other than exactly one
 * choice is `failed`/non-retryable, as is an absent first choice, a non-string content, and an
 * unaccepted finish reason. These are separate branches because production separates them: collapsing
 * any pair would let the SAME provider response normalize differently here than in production.
 *
 * Provider-reported usage travels onward. That is what lets these paths answer a question the
 * historical diagnostics could not — they settled their ledgers with `undefined` and could never say
 * what was generated.
 *
 * Nothing here reads a message, a header, a request id or a `failed_generation`: the normalization
 * consults the error body for exactly one closed code and reads nothing else.
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';
import type { ModelUsage } from '../../contracts/response.js';
import type { GatewayClock } from '../../reliability/clock.js';
import type { GroqProviderConfig } from './groq-config.js';
import { GROQ_ACCEPTED_FINISH_REASONS, groqChatResponseSchema } from './groq-contracts.js';
import type { GroqChatRequestBody } from './groq-contracts.js';
import { normalizeGroqHttpFailure } from './groq-error-normalization.js';
import { GROQ_CHAT_COMPLETIONS_ENDPOINT } from './groq-transport.js';

const HTTP_OK = 200;

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Map Groq's reported usage onto the gateway's provider-neutral shape. Integers only. */
export function buildDiagnosticUsage(
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

/**
 * Perform exactly one Chat Completions request with an already-built body.
 *
 * Never retries, never sleeps, never repairs. The endpoint is the production Chat Completions one and
 * is not a parameter: a diagnostic that could choose its endpoint would be a different experiment.
 */
export async function executeGroqChatDiagnosticExchange(
  config: GroqProviderConfig,
  clock: GatewayClock,
  body: GroqChatRequestBody,
  signal: AbortSignal,
): Promise<ProviderInvocationResult> {
  // This check is NOT the only one, and must not be treated as such.
  //
  // Each adapter checks the signal BEFORE building its body, because cancellation outranks a body
  // refusal and this function only ever runs once a body exists. What this check adds is the window
  // the adapter's cannot cover: cancellation between body construction and the transport call.
  // Both are needed, and neither is redundant.
  if (isAborted(signal)) {
    return { status: 'cancelled' };
  }

  const httpRequest = {
    url: GROQ_CHAT_COMPLETIONS_ENDPOINT,
    headers: {
      'content-type': 'application/json',
      authorization: config.apiKey.authorizationHeaderValue(),
    },
    body: JSON.stringify(body),
  };

  const start = clock.now();
  let response;
  try {
    response = await config.transport.send(httpRequest, signal);
  } catch {
    if (isAborted(signal)) {
      return { status: 'cancelled' };
    }
    return { status: 'unavailable', retryable: true };
  }
  const latencyMs = Math.max(0, clock.now() - start);

  if (response.status !== HTTP_OK) {
    // The SAME governed normalization production uses. It consults the body for exactly one closed
    // code and reads nothing else — no message, no failed_generation, no request id.
    return normalizeGroqHttpFailure(response.status, response.bodyText, latencyMs);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.bodyText);
  } catch {
    return { status: 'malformed', latencyMs };
  }
  // Production's classification, branch for branch. Each of these is separate because production
  // keeps it separate; collapsing any pair would let one provider response normalize two ways.
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

  const usage = buildDiagnosticUsage(parsed.data.usage);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { status: 'malformed', latencyMs };
  }
  return { status: 'completed', output: { mode: 'STRUCTURED', value }, usage, latencyMs };
}
