/**
 * The JF-5B-ONLY wire observer, and the malformed-stage vocabulary it feeds (JF-5B-R8).
 *
 * ### Why this exists
 *
 * Run-10 completed all ninety phase-3 executions and produced seven Groq/RIYA rows that were all
 * `provider-terminal:malformed-provider-output`. That token is the truth and it is not a diagnosis.
 * `GroqModelProvider` returns `{ status: 'malformed' }` from three different places — the HTTP body is
 * not JSON, the response envelope fails its schema, or the structured `message.content` is not parseable
 * JSON — and `ProviderInvocationResult` carries no field to say which. The gateway then collapses all
 * three to one code. Seven identical rows, three possible causes, and nothing to choose between them.
 *
 * So this watches the wire instead of guessing, and it watches it the only place where the distinction
 * is still visible: the transport, which is already an injected seam on both providers.
 *
 * ### What it may see, and what it may keep
 *
 * It sees the whole HTTP response, because it wraps the transport. It keeps STRUCTURE and NUMBERS:
 * status, whether bodies and contents parse, how many choices, how long the content was, the finish
 * reason, token counts, and whether a `reasoning` field was present.
 *
 * It never keeps text. Not the body, not the content, not the reasoning, not a header, not the request.
 * `reasoningFieldPresent` is a boolean precisely because GPT-OSS's reasoning is model-authored prose
 * about a synthetic customer conversation, and the one question worth asking of it — was it there — is
 * answerable without reading a word of it. A spec asserts every field of the captured facts is a number,
 * a boolean, or a member of a closed string vocabulary.
 *
 * ### What it is not
 *
 * Not observability. Not a metrics pipeline, not a tracing seam, not a platform capability. It is an
 * evaluation-only wrapper built for one lane, applied by one runner, and a spec pins the exact set of
 * files permitted to name it. It delegates exactly once and returns the transport's own response object
 * unchanged, so a provider cannot tell it is there.
 */
import type { GroqTransport, NaraTransport } from '@qf-jarvis/model-gateway';

/**
 * The HTTP shapes, DERIVED from the transport interfaces rather than imported.
 *
 * `GroqHttpRequest` and friends are internal to the gateway package and are not on its public surface.
 * Exporting them so an evaluation-only observer could name them would widen a production contract for a
 * diagnostic's convenience, which is the wrong direction. Deriving them costs four lines, adds nothing
 * to any package's API, and cannot drift: if the transport signature changes, these change with it.
 */
type GroqHttpRequest = Parameters<GroqTransport['send']>[0];
type GroqHttpResponse = Awaited<ReturnType<GroqTransport['send']>>;
type NaraHttpRequest = Parameters<NaraTransport['send']>[0];
type NaraHttpResponse = Awaited<ReturnType<NaraTransport['send']>>;

/** How the provider's `message.content` arrived. A closed vocabulary; never the content itself. */
export type MessageContentKind = 'STRING' | 'NULL' | 'ABSENT' | 'OTHER';

/** Bound on the finish reason we are willing to carry, matching the provider schema's own bound. */
const FINISH_REASON_MAX_CHARS = 64;

/** The SHAPE a `failed_generation` arrived in. Closed; never the value. */
export type FailedGenerationKind = 'STRING' | 'OBJECT' | 'ARRAY' | 'OTHER';

/**
 * Structural facts about a Groq `json_validate_failed` `failed_generation` (JF-5B-R9).
 *
 * ### Why this exists
 *
 * Run-11's eight Groq/RIYA inconclusives were all HTTP 400 with the closed code
 * `json_validate_failed`, reported as the generic `RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE`. True — the
 * body IS an error envelope with no `choices` — and useless: `json_validate_failed` means the model
 * generated something the strict schema refused, and the something is in `error.failed_generation`.
 *
 * Anisha and Aarohi pass every row on the same provider and model, and some Riya rows pass too, so
 * whatever this is, it is neither the account nor the model nor a universally invalid schema. Run-12
 * has to name it, and it cannot be named from a boolean.
 *
 * ### What may be kept
 *
 * `failed_generation` is RAW MODEL OUTPUT and is treated as such: booleans, a length, a closed kind
 * token, and — when it parses — the presence of two expected root keys and a closed schema-document
 * signature. Not one character of it is retained, rendered, written or logged.
 *
 * The four candidate shapes this is designed to tell apart, without asserting which: a schema-document
 * ECHO (the model returning the schema instead of an instance), valid JSON with the wrong fields, an
 * incomplete or truncated document, and anything else.
 */
export interface FailedGenerationFacts {
  readonly failedGenerationPresent: boolean;
  readonly failedGenerationKind: FailedGenerationKind | undefined;
  /** Length in characters, for a STRING. Never the string. */
  readonly failedGenerationChars: number | undefined;
  readonly failedGenerationJsonValid: boolean | undefined;
  /** First non-space character is `{`. Distinguishes an object attempt from prose. */
  readonly failedGenerationStartsObject: boolean | undefined;
  /** Last non-space character is `}`. A `yes/no` pair here is the signature of TRUNCATION. */
  readonly failedGenerationEndsObject: boolean | undefined;
  /** At least three of `type`, `properties`, `required`, `additionalProperties`, `$schema`. */
  readonly schemaDocumentLike: boolean;
  /** Riya's two structured root keys. Booleans only; no other key name is ever read out. */
  readonly expectedRiyaRootKeysPresent: { readonly reply: boolean; readonly evolution: boolean };
}

/** Structural facts about ONE Groq HTTP exchange. Every field is a number, a boolean or a closed token. */
export interface GroqWireFacts {
  readonly httpStatus: number;
  readonly responseBodyJsonValid: boolean;
  readonly choiceCount: number | undefined;
  readonly messageContentKind: MessageContentKind | undefined;
  readonly messageContentChars: number | undefined;
  readonly finishReason: string | undefined;
  readonly promptTokens: number | undefined;
  readonly completionTokens: number | undefined;
  readonly totalTokens: number | undefined;
  readonly structuredContentJsonValid: boolean | undefined;
  readonly reasoningFieldPresent: boolean;
  /** The closed Groq error code, when it is the ONE code this lane recognises (JF-5B-R9). */
  readonly closedErrorCode: string | undefined;
  /** Present only for a `json_validate_failed` response. */
  readonly failedGeneration: FailedGenerationFacts | undefined;
}

/** The same, for Nara. No reasoning field: NaraRouter does not emit one, so nothing pretends to look. */
export interface NaraWireFacts {
  readonly httpStatus: number;
  readonly bodyJsonValid: boolean;
  readonly contentKind: MessageContentKind | undefined;
  readonly contentChars: number | undefined;
  readonly contentJsonValid: boolean | undefined;
  readonly promptTokens: number | undefined;
  readonly completionTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

/**
 * WHERE a `malformed-provider-output` was decided.
 *
 * `MESSAGE_CONTENT_NOT_STRING` is in this vocabulary for completeness and is expected never to appear
 * beside a malformed code: the Groq provider answers `{ status: 'failed' }` for a non-string content,
 * which the gateway reports as `provider-failed`. It is named here so the observer can still say what
 * it saw, and so a future provider change that made it malformed would already have a word for it.
 *
 * `MALFORMED_STAGE_UNRESOLVED` is the honest answer whenever the observed facts do not single out one
 * stage — for example an envelope that parses as JSON and looks structurally complete but is rejected
 * by a bound this observer deliberately does not re-implement.
 */
export type MalformedStage =
  /**
   * Groq accepted the request, generated, and its own strict validator refused the result
   * (JF-5B-R9). An OUTPUT failure, not a rejected request: the key, project, model permission and
   * request were all accepted and the tokens were billed.
   */
  | 'GROQ_JSON_VALIDATE_FAILED'
  | 'HTTP_BODY_JSON_INVALID'
  | 'RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE'
  | 'MESSAGE_CONTENT_NOT_STRING'
  | 'STRUCTURED_CONTENT_JSON_INVALID'
  | 'MALFORMED_STAGE_UNRESOLVED';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The content's SHAPE. `OTHER` covers an object, an array, a number — anything that is not the rest. */
function contentKindOf(
  message: Record<string, unknown> | undefined,
): MessageContentKind | undefined {
  if (message === undefined) {
    return undefined;
  }
  if (!('content' in message)) {
    return 'ABSENT';
  }
  const content = message['content'];
  if (typeof content === 'string') {
    return 'STRING';
  }
  return content === null ? 'NULL' : 'OTHER';
}

/** Does this string parse as JSON? The parsed value is discarded on the spot. */
function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The usage triple, if the provider reported one and the numbers are real numbers. */
function usageOf(body: Record<string, unknown> | undefined): {
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalTokens: number | undefined;
} {
  const usage = body === undefined ? undefined : body['usage'];
  if (!isRecord(usage)) {
    return { promptTokens: undefined, completionTokens: undefined, totalTokens: undefined };
  }
  return {
    promptTokens: finiteOrUndefined(usage['prompt_tokens']),
    completionTokens: finiteOrUndefined(usage['completion_tokens']),
    totalTokens: finiteOrUndefined(usage['total_tokens']),
  };
}

/** The first choice's message, if the envelope is shaped the way a chat completion is shaped. */
function firstMessage(body: Record<string, unknown> | undefined): {
  choiceCount: number | undefined;
  message: Record<string, unknown> | undefined;
  finishReason: string | undefined;
} {
  const choices = body === undefined ? undefined : body['choices'];
  if (!Array.isArray(choices)) {
    return { choiceCount: undefined, message: undefined, finishReason: undefined };
  }
  const first: unknown = choices[0];
  const choice = isRecord(first) ? first : undefined;
  const message =
    choice !== undefined && isRecord(choice['message']) ? choice['message'] : undefined;
  const rawFinish = choice?.['finish_reason'];
  return {
    choiceCount: choices.length,
    message,
    finishReason:
      typeof rawFinish === 'string' ? rawFinish.slice(0, FINISH_REASON_MAX_CHARS) : undefined,
  };
}

/**
 * The ONE closed Groq error code this lane recognises (JF-5B-R9).
 *
 * A JF-5B-LOCAL literal, not a reuse. `closedErrorCode` in `groq-error-normalization.ts` is module
 * private, and exporting it so an evaluation diagnostic could borrow it would widen a production
 * surface for a diagnostic's convenience. A spec locks this literal against that file's, so the two
 * cannot drift apart silently.
 */
export const GROQ_JSON_VALIDATE_FAILED_CODE = 'json_validate_failed';

/** The keys whose presence, three or more together, marks a JSON Schema DOCUMENT rather than an instance. */
const SCHEMA_DOCUMENT_KEYS = ['type', 'properties', 'required', 'additionalProperties', '$schema'];
const SCHEMA_DOCUMENT_MINIMUM = 3;

/** Riya's two structured root keys. Asked about by name, and no other key name is ever reported. */
const RIYA_ROOT_KEYS = { reply: 'reply', evolution: 'evolution' } as const;

/** The error object of a Groq error envelope, if the body is one. */
function errorEnvelope(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }
  const error: unknown = parsed['error'];
  return isRecord(error) ? error : undefined;
}

/** The kind of a `failed_generation` value. Never its content. */
function failedGenerationKindOf(value: unknown): FailedGenerationKind {
  if (typeof value === 'string') {
    return 'STRING';
  }
  if (Array.isArray(value)) {
    return 'ARRAY';
  }
  return isRecord(value) ? 'OBJECT' : 'OTHER';
}

/**
 * Read the structure of a `failed_generation`, and nothing else.
 *
 * The proven location is `error.failed_generation`, beside `error.code` — the shape two independently
 * recorded live 400 fixtures agree on. No other location is guessed at: an absent value reports
 * `present=false`, which is a true statement, rather than a hunt that might find something else.
 */
function failedGenerationFactsFrom(
  error: Record<string, unknown> | undefined,
): FailedGenerationFacts {
  const absent: FailedGenerationFacts = {
    failedGenerationPresent: false,
    failedGenerationKind: undefined,
    failedGenerationChars: undefined,
    failedGenerationJsonValid: undefined,
    failedGenerationStartsObject: undefined,
    failedGenerationEndsObject: undefined,
    schemaDocumentLike: false,
    expectedRiyaRootKeysPresent: { reply: false, evolution: false },
  };
  if (error === undefined || !('failed_generation' in error)) {
    return Object.freeze(absent);
  }
  const raw: unknown = error['failed_generation'];
  const kind = failedGenerationKindOf(raw);
  const text = typeof raw === 'string' ? raw.trim() : undefined;
  let parsed: unknown;
  let jsonValid: boolean | undefined;
  if (text !== undefined) {
    try {
      parsed = JSON.parse(text);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
  } else if (kind === 'OBJECT' || kind === 'ARRAY') {
    // Already structured on the wire. There is nothing to parse and nothing to be invalid.
    parsed = raw;
  }
  const document = isRecord(parsed) ? parsed : undefined;
  const schemaKeys = SCHEMA_DOCUMENT_KEYS.filter(
    (key) => document !== undefined && key in document,
  );
  return Object.freeze({
    failedGenerationPresent: true,
    failedGenerationKind: kind,
    failedGenerationChars: typeof raw === 'string' ? raw.length : undefined,
    failedGenerationJsonValid: jsonValid,
    // The TRUNCATION signature is `starts=yes ends=no`: a document that began as an object and never
    // closed. Computed on the trimmed text so trailing whitespace cannot mask it.
    failedGenerationStartsObject: text === undefined ? undefined : text.startsWith('{'),
    failedGenerationEndsObject: text === undefined ? undefined : text.endsWith('}'),
    schemaDocumentLike: schemaKeys.length >= SCHEMA_DOCUMENT_MINIMUM,
    expectedRiyaRootKeysPresent: Object.freeze({
      reply: document !== undefined && RIYA_ROOT_KEYS.reply in document,
      evolution: document !== undefined && RIYA_ROOT_KEYS.evolution in document,
    }),
  });
}

/**
 * The structured reply the provider sent, parsed, for the schema diagnostic alone.
 *
 * `undefined` unless the envelope is readable, the content is a string, and that string is JSON. Each of
 * those failures is a DIFFERENT diagnosis, already named by the malformed-stage vocabulary, and none of
 * them is a question for the schema.
 */
function structuredValueOf(bodyText: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  // JF-5B-R9. A `json_validate_failed` 400 carries the refused generation instead of a choice, and it
  // is the SAME question: which fields of the governed schema did this value violate? Asking it of the
  // thing Groq's own validator refused is the point of the diagnostic.
  const error = errorEnvelope(parsed);
  if (error?.['code'] === GROQ_JSON_VALIDATE_FAILED_CODE) {
    const raw: unknown = error['failed_generation'];
    if (isRecord(raw)) {
      return raw;
    }
    if (typeof raw !== 'string') {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      // Not parseable. `failedGenerationJsonValid=no` already says so, and there is nothing coherent to
      // ask a schema about.
      return undefined;
    }
  }
  const { message } = firstMessage(isRecord(parsed) ? parsed : undefined);
  const content = message?.['content'];
  if (typeof content !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Read one Groq response into facts. Structure and numbers only; the body text is never retained. */
export function groqFactsFrom(response: GroqHttpResponse): GroqWireFacts {
  let parsed: unknown;
  let bodyValid = true;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    bodyValid = false;
  }
  const body = isRecord(parsed) ? parsed : undefined;
  const { choiceCount, message, finishReason } = firstMessage(body);
  const kind = contentKindOf(message);
  const content = message?.['content'];
  const usage = usageOf(body);
  // JF-5B-R9. Only for the ONE closed code, and only from the proven location.
  const error = errorEnvelope(parsed);
  const closed =
    error?.['code'] === GROQ_JSON_VALIDATE_FAILED_CODE ? GROQ_JSON_VALIDATE_FAILED_CODE : undefined;
  return Object.freeze({
    httpStatus: response.status,
    responseBodyJsonValid: bodyValid,
    choiceCount,
    messageContentKind: kind,
    messageContentChars: typeof content === 'string' ? content.length : undefined,
    finishReason,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    structuredContentJsonValid: typeof content === 'string' ? parsesAsJson(content) : undefined,
    // A BOOLEAN, and deliberately nothing more. See the header.
    reasoningFieldPresent: message !== undefined && 'reasoning' in message,
    closedErrorCode: closed,
    failedGeneration: closed === undefined ? undefined : failedGenerationFactsFrom(error),
  });
}

/** Read one Nara response into facts. Same rules, same silence about text. */
export function naraFactsFrom(response: NaraHttpResponse): NaraWireFacts {
  let parsed: unknown;
  let bodyValid = true;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    bodyValid = false;
  }
  const body = isRecord(parsed) ? parsed : undefined;
  const { message } = firstMessage(body);
  const kind = contentKindOf(message);
  const content = message?.['content'];
  const usage = usageOf(body);
  return Object.freeze({
    httpStatus: response.status,
    bodyJsonValid: bodyValid,
    contentKind: kind,
    contentChars: typeof content === 'string' ? content.length : undefined,
    contentJsonValid: typeof content === 'string' ? parsesAsJson(content) : undefined,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  });
}

/**
 * WHERE the malformed decision was taken, from the observed facts alone.
 *
 * Deliberately does NOT re-validate the response against the provider's schema. Duplicating that schema
 * would create a second definition of "valid Groq response" that drifts from the first, and the drift
 * would show up as a diagnostic confidently naming the wrong stage. Where the facts do not decide,
 * the answer is `MALFORMED_STAGE_UNRESOLVED`, which is a true statement about what we know.
 */
export function groqMalformedStage(facts: GroqWireFacts | undefined): MalformedStage {
  if (facts === undefined) {
    return 'MALFORMED_STAGE_UNRESOLVED';
  }
  // FIRST, because it is the most specific thing we can know: Groq told us, in its own closed
  // vocabulary, that generation completed and its validator refused the result. Falling through to the
  // envelope check would report "the body had no choices", which is a true fact about an error body and
  // no help at all.
  if (facts.closedErrorCode === GROQ_JSON_VALIDATE_FAILED_CODE) {
    return 'GROQ_JSON_VALIDATE_FAILED';
  }
  if (!facts.responseBodyJsonValid) {
    return 'HTTP_BODY_JSON_INVALID';
  }
  if (
    facts.choiceCount === undefined ||
    facts.choiceCount === 0 ||
    facts.messageContentKind === undefined
  ) {
    return 'RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE';
  }
  if (facts.messageContentKind !== 'STRING') {
    return 'MESSAGE_CONTENT_NOT_STRING';
  }
  if (facts.structuredContentJsonValid === false) {
    return 'STRUCTURED_CONTENT_JSON_INVALID';
  }
  return 'MALFORMED_STAGE_UNRESOLVED';
}

/** The Nara equivalent, over the Nara field names. */
export function naraMalformedStage(facts: NaraWireFacts | undefined): MalformedStage {
  if (facts === undefined) {
    return 'MALFORMED_STAGE_UNRESOLVED';
  }
  if (!facts.bodyJsonValid) {
    return 'HTTP_BODY_JSON_INVALID';
  }
  if (facts.contentKind === undefined) {
    return 'RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE';
  }
  if (facts.contentKind !== 'STRING') {
    return 'MESSAGE_CONTENT_NOT_STRING';
  }
  if (facts.contentJsonValid === false) {
    return 'STRUCTURED_CONTENT_JSON_INVALID';
  }
  return 'MALFORMED_STAGE_UNRESOLVED';
}

/**
 * The sanitized diagnostic suffix an operator reads, e.g.
 * `diagnostic=STRUCTURED_CONTENT_JSON_INVALID finishReason=length completionTokens=4096`.
 *
 * Only defined keys are rendered, so a line never claims to know a number it does not.
 */
export function renderWireDiagnostic(
  stage: MalformedStage,
  facts: GroqWireFacts | NaraWireFacts | undefined,
): string {
  const parts = [`diagnostic=${stage}`];
  if (facts === undefined) {
    return parts.join(' ');
  }
  const failed = 'failedGeneration' in facts ? facts.failedGeneration : undefined;
  const pairs: readonly (readonly [string, string | number | boolean | undefined])[] = [
    ['httpStatus', facts.httpStatus],
    ['contentKind', 'messageContentKind' in facts ? facts.messageContentKind : facts.contentKind],
    [
      'contentChars',
      'messageContentChars' in facts ? facts.messageContentChars : facts.contentChars,
    ],
    ['finishReason', 'finishReason' in facts ? facts.finishReason : undefined],
    ['promptTokens', facts.promptTokens],
    ['completionTokens', facts.completionTokens],
    ['totalTokens', facts.totalTokens],
    ['reasoning', 'reasoningFieldPresent' in facts ? facts.reasoningFieldPresent : undefined],
    // JF-5B-R9. Booleans, a length and one closed kind token. Nothing derived from the CONTENT of a
    // `failed_generation` beyond whether it parses and what shape it is.
    ['failedGenerationPresent', failed?.failedGenerationPresent],
    ['failedGenerationKind', failed?.failedGenerationKind],
    ['failedGenerationChars', failed?.failedGenerationChars],
    ['failedGenerationJsonValid', failed?.failedGenerationJsonValid],
    ['failedGenerationStartsObject', failed?.failedGenerationStartsObject],
    ['failedGenerationEndsObject', failed?.failedGenerationEndsObject],
    ['schemaDocumentLike', failed?.schemaDocumentLike],
    ['expectedReplyKey', failed?.expectedRiyaRootKeysPresent.reply],
    ['expectedEvolutionKey', failed?.expectedRiyaRootKeysPresent.evolution],
  ];
  for (const [key, value] of pairs) {
    if (value !== undefined) {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join(' ');
}

/** Holds the facts of the most recent exchange, and forgets them on demand. */
export interface WireObserver<Facts> {
  /** The facts of the last observed exchange since the last `reset`, or `undefined` if there was none. */
  facts(): Facts | undefined;
  /**
   * The last exchange's structured content, PARSED, held in memory and nowhere else.
   *
   * This is the ONE thing an observer holds that is model content rather than a measurement of it, and
   * it exists for exactly one caller: `schemaIssueTokens`, which re-runs the governed schema over it to
   * recover the issue PATHS and CODES the gateway discarded, and returns only those.
   *
   * It is never written to a record, a receipt, a manifest, a bundle, a review file or a terminal line,
   * and a containment spec asserts that no such consumer exists. It is cleared by `reset()` before every
   * case, so it lives for the length of one evaluation of one case and is then unreachable.
   *
   * `undefined` when there was no exchange, when the content was not a string, or when it did not parse
   * — in which case the failure was not a schema failure and there is nothing to ask the schema about.
   */
  structuredValueInMemory(): unknown;
  /** Forget everything, including the in-memory value above. */
  reset(): void;
  /** How many exchanges have been observed since the last `reset`. Expected to be 0 or 1. */
  exchanges(): number;
}

export interface ObservedGroqTransport {
  readonly transport: GroqTransport;
  readonly observer: WireObserver<GroqWireFacts>;
}

export interface ObservedNaraTransport {
  readonly transport: NaraTransport;
  readonly observer: WireObserver<NaraWireFacts>;
}

/**
 * Wrap a Groq transport. Delegates EXACTLY once and returns the inner response object itself.
 *
 * A rejection propagates untouched and records nothing: there is no HTTP exchange to describe, and
 * inventing facts for one would be worse than having none.
 */
export function observeGroqTransport(inner: GroqTransport): ObservedGroqTransport {
  let latest: GroqWireFacts | undefined;
  let value: unknown;
  let count = 0;
  return Object.freeze({
    transport: Object.freeze({
      async send(request: GroqHttpRequest, signal: AbortSignal): Promise<GroqHttpResponse> {
        const response = await inner.send(request, signal);
        latest = groqFactsFrom(response);
        value = structuredValueOf(response.bodyText);
        count += 1;
        // The inner object, not a copy: an observer that rebuilt the response could change it.
        return response;
      },
    }),
    observer: Object.freeze({
      facts: (): GroqWireFacts | undefined => latest,
      structuredValueInMemory: (): unknown => value,
      reset: (): void => {
        latest = undefined;
        value = undefined;
        count = 0;
      },
      exchanges: (): number => count,
    }),
  });
}

/** The Nara equivalent, with the same one-delegation and same-object guarantees. */
export function observeNaraTransport(inner: NaraTransport): ObservedNaraTransport {
  let latest: NaraWireFacts | undefined;
  let value: unknown;
  let count = 0;
  return Object.freeze({
    transport: Object.freeze({
      async send(request: NaraHttpRequest, signal: AbortSignal): Promise<NaraHttpResponse> {
        const response = await inner.send(request, signal);
        latest = naraFactsFrom(response);
        value = structuredValueOf(response.bodyText);
        count += 1;
        return response;
      },
    }),
    observer: Object.freeze({
      facts: (): NaraWireFacts | undefined => latest,
      structuredValueInMemory: (): unknown => value,
      reset: (): void => {
        latest = undefined;
        value = undefined;
        count = 0;
      },
      exchanges: (): number => count,
    }),
  });
}
