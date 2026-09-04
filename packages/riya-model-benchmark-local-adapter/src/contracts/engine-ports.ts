/**
 * The two ports the local adapter runs against (AS4-PREP-A).
 *
 * ### Why the transport is a BYTE transport
 *
 * The obvious shape for this port is "send a chat request, get a result". It was rejected: it would
 * put the protocol -- server-sent-event framing, first-token detection, usage validation, model
 * identity checking -- inside whatever object a caller injects, which is exactly the code that must be
 * the same for every engine and must be tested without a network.
 *
 * So the transport does one thing: open a request to a path the adapter names, and hand back a status
 * and a stream of decoded text. It owns the socket and the loopback rule; it owns no meaning. The
 * adapter owns every byte of interpretation, and a fake transport in a spec exercises the identical
 * parser the real one feeds.
 *
 * ### The transport does NOT take a URL
 *
 * It takes one of a closed set of PATHS, and it was constructed with the endpoint. That is the whole
 * containment argument in one sentence: the layer that decides what to send cannot say where, and the
 * layer that decides where cannot be pointed off the loopback interface.
 *
 * ### There is no credential parameter, anywhere
 *
 * No `apiKey`, no `authorization`, no `headers` input. Not "unused" -- absent. A header input would be
 * the one field a future slice could fill with a bearer token without changing a signature, and this
 * adapter benchmarks a process on the same machine, which needs no credential to be asked politely.
 *
 * ### The tokenizer exists because character counts are not token counts
 *
 * RMB-B requires the prepared input token count to equal the workload's declaration EXACTLY, and only
 * the engine's own tokenizer knows what a chat-templated prompt costs. Estimating it from string
 * length would produce a number that looks exact, sits in evidence, and is wrong by whatever the chat
 * template happens to add.
 */

/** One chat message. Role and content, and deliberately nothing else. */
export interface RiyaLocalChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export type RiyaLocalEngineMethod = 'GET' | 'POST';

/** One request the adapter asks the transport to make. */
export interface RiyaLocalEngineHttpRequest {
  readonly method: RiyaLocalEngineMethod;
  /** One of the adapter-owned paths. Joined onto the transport's own endpoint; never a URL. */
  readonly path: string;
  /** Serialized JSON, for `POST`. Absent for `GET`. */
  readonly body?: string;
  /** Composed by the adapter from the suite signal and the per-request deadline. */
  readonly signal: AbortSignal;
}

/**
 * What the transport hands back.
 *
 * `body` is an async iterable of DECODED text chunks, in arrival order, whose boundaries mean nothing
 * -- a server-sent event may straddle two of them, and the adapter's decoder is written for that. The
 * iterable must stop promptly once the request's signal aborts, and closing it must close the
 * underlying stream: the adapter closes it in a `finally`, and that is what makes "no benchmark
 * request outlives its invocation" true rather than hoped for.
 */
export interface RiyaLocalEngineHttpResponse {
  readonly status: number;
  readonly body: AsyncIterable<string>;
}

export interface RiyaLocalEngineTransportPort {
  request: (request: RiyaLocalEngineHttpRequest) => Promise<RiyaLocalEngineHttpResponse>;
}

/**
 * Exact token counting, by the engine that will run the benchmark.
 *
 * `countPromptTokens` is REQUIRED: without it there is no honest way to satisfy RMB-B's exact
 * input-count parity.
 *
 * `countOutputTokens` is OPTIONAL, and its absence is a real constraint rather than an oversight. An
 * OpenAI-compatible surface exposes no uniform way to tokenize arbitrary assistant text, so the only
 * implementation this package ships cannot provide it -- and a configuration asking for local output
 * counting without a tokenizer that can do it is REFUSED at construction rather than quietly falling
 * back to the server's number under a label saying otherwise.
 */
export interface RiyaLocalTokenizerPort {
  countPromptTokens: (input: {
    readonly messages: readonly RiyaLocalChatMessage[];
    readonly signal?: AbortSignal;
  }) => Promise<number>;
  countOutputTokens?: (input: {
    readonly text: string;
    readonly signal?: AbortSignal;
  }) => Promise<number>;
}
