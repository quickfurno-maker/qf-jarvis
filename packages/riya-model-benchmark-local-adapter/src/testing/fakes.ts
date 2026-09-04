/**
 * Deterministic fakes for the local adapter specs. TESTING SUBPATH ONLY.
 *
 * ### No model, no download, no network -- in CI or anywhere else
 *
 * Every transport here is a scripted object. It answers with bytes a spec chose, in chunk boundaries a
 * spec chose, at moments a spec controls. Nothing in this file resolves a hostname, opens a socket or
 * knows what a model is.
 *
 * ### Chunk boundaries are a first-class knob
 *
 * A real engine splits its stream wherever the socket happens to flush, and the parser bug that
 * survives every naive test is the one where a JSON object arrives in two pieces. So a script says
 * exactly which strings arrive, and a spec can hand over half an event.
 *
 * ### Some fakes are deliberately broken, and some deliberately hang
 *
 * A transport that always answers correctly cannot prove that a redirect is refused, that a served
 * model mismatch is caught, or that a request which never finishes is aborted by its deadline rather
 * than waited on forever. Each of those needs a transport that misbehaves in exactly one way.
 */
import type {
  RiyaLocalChatMessage,
  RiyaLocalEngineHttpRequest,
  RiyaLocalEngineHttpResponse,
  RiyaLocalEngineTransportPort,
  RiyaLocalTokenizerPort,
} from '../contracts/engine-ports.js';

/** A canonical instant for evidence built in a spec. Fixed, so digests are reproducible. */
export const SYNTHETIC_LOCAL_BENCHMARK_INSTANT = '2026-01-01T00:00:00Z';

/** How one faked engine response behaves. */
export interface FakeEngineScript {
  readonly status?: number;
  /** The exact text chunks the body yields, in order. Boundaries are meaningful. */
  readonly chunks?: readonly string[];
  /** Never yield and never end, until the request's signal aborts. */
  readonly hangUntilAborted?: boolean;
  /** Throw from `request` rather than answering. */
  readonly throwOnRequest?: Error;
  /** Throw partway through the body, after `chunks` have been yielded. */
  readonly throwAfterChunks?: Error;
}

export interface FakeEngineTransportOptions {
  /** Per chat-completions call, by ordinal. Ordinals past the end reuse the last entry. */
  readonly script?: readonly FakeEngineScript[];
  /** The body a `/models` listing answers with. */
  readonly modelsBody?: string;
  readonly modelsStatus?: number;
  /** The body a NON-streamed counting call answers with. Used by the engine usage tokenizer. */
  readonly countingBody?: string;
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

/** Resolves when the signal aborts. The cooperative half of a hanging fake. */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * A scripted OpenAI-compatible engine.
 *
 * Records what it was asked, so a spec can prove the request body carried the exact model, the exact
 * cap and the exact sampling -- and, just as importantly, that it carried no credential.
 */
export class FakeEngineTransport implements RiyaLocalEngineTransportPort {
  public readonly requests: RiyaLocalEngineHttpRequest[] = [];
  /** Bodies of chat-completion calls, so a spec can inspect what was actually sent. */
  public readonly sentBodies: string[] = [];
  /** Streams entered but not yet closed. Must be zero once an invocation has settled. */
  public openStreams = 0;
  /** Streams closed by the consumer rather than exhausted. The drain, observably. */
  public closedStreams = 0;

  private completionCalls = 0;

  public constructor(private readonly options: FakeEngineTransportOptions = {}) {}

  public request = async (
    engineRequest: RiyaLocalEngineHttpRequest,
  ): Promise<RiyaLocalEngineHttpResponse> => {
    this.requests.push(engineRequest);
    await Promise.resolve();

    if (engineRequest.path === '/models') {
      return {
        status: this.options.modelsStatus ?? 200,
        body: this.staticBody(this.options.modelsBody ?? '{"data":[]}'),
      };
    }

    // A counting call is the non-streamed one. The tokenizer sends `stream: false`.
    if (engineRequest.body?.includes('"stream":false') === true) {
      return {
        status: 200,
        body: this.staticBody(this.options.countingBody ?? '{"usage":{"prompt_tokens":11}}'),
      };
    }

    const index = this.completionCalls;
    this.completionCalls += 1;
    if (engineRequest.body !== undefined) {
      this.sentBodies.push(engineRequest.body);
    }
    const script = this.scriptFor(index);
    if (script.throwOnRequest !== undefined) {
      throw script.throwOnRequest;
    }
    return { status: script.status ?? 200, body: this.scriptedBody(script, engineRequest.signal) };
  };

  private scriptFor(index: number): FakeEngineScript {
    const script = this.options.script;
    if (script === undefined || script.length === 0) {
      return {};
    }
    return script[Math.min(index, script.length - 1)] ?? {};
  }

  private staticBody(text: string): AsyncGenerator<string, void, undefined> {
    // Arrow functions rather than a `this` alias: the generator below is a plain function, and the
    // counters it moves are the ones a spec asserts on.
    const enter = (): void => {
      this.openStreams += 1;
    };
    const leave = (): void => {
      this.openStreams -= 1;
      this.closedStreams += 1;
    };
    return (async function* body(): AsyncGenerator<string, void, undefined> {
      enter();
      try {
        // One real microtask before the first chunk, so a consumer genuinely awaits this body.
        await Promise.resolve();
        yield text;
      } finally {
        leave();
      }
    })();
  }

  private scriptedBody(
    script: FakeEngineScript,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    const enter = (): void => {
      this.openStreams += 1;
    };
    const leave = (): void => {
      this.openStreams -= 1;
      this.closedStreams += 1;
    };
    return (async function* body(): AsyncGenerator<string, void, undefined> {
      enter();
      try {
        for (const chunk of script.chunks ?? []) {
          if (signal.aborted) {
            throw abortError();
          }
          yield chunk;
        }
        if (script.throwAfterChunks !== undefined) {
          throw script.throwAfterChunks;
        }
        if (script.hangUntilAborted === true) {
          // The request never completes on its own. Only the composed deadline or a suite cancellation
          // ends it -- which is exactly what the timeout specs need to observe.
          await whenAborted(signal);
          throw abortError();
        }
      } finally {
        leave();
      }
    })();
  }
}

/** A tokenizer that answers a fixed number, or throws, or lies. */
export class FakeTokenizer implements RiyaLocalTokenizerPort {
  public promptCalls = 0;
  public outputCalls = 0;

  public constructor(
    private readonly options: {
      readonly promptTokens?: number | (() => number);
      readonly outputTokens?: number;
      readonly throwOnPrompt?: boolean;
      readonly rawPromptTokens?: unknown;
      readonly withOutputCounting?: boolean;
    } = {},
  ) {
    if (options.withOutputCounting === true) {
      this.countOutputTokens = (input: { readonly text: string }): Promise<number> => {
        this.outputCalls += 1;
        return Promise.resolve(this.options.outputTokens ?? Math.max(1, input.text.length));
      };
    }
  }

  public countOutputTokens?: (input: { readonly text: string }) => Promise<number>;

  public countPromptTokens = (input: {
    readonly messages: readonly RiyaLocalChatMessage[];
  }): Promise<number> => {
    this.promptCalls += 1;
    if (this.options.throwOnPrompt === true) {
      return Promise.reject(new Error('tokenizer exploded'));
    }
    if (this.options.rawPromptTokens !== undefined) {
      // A tokenizer returning something its signature forbids is exactly what the guard exists for.
      return Promise.resolve(this.options.rawPromptTokens as number);
    }
    const configured = this.options.promptTokens;
    if (typeof configured === 'function') {
      return Promise.resolve(configured());
    }
    return Promise.resolve(configured ?? input.messages.length);
  };
}

/** One well-formed streamed chunk, as an engine would send it. */
export function fakeStreamChunk(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

/** The sentinel that ends an OpenAI-compatible stream. */
export const FAKE_STREAM_DONE = 'data: [DONE]\n\n';

/**
 * A complete, healthy stream: a role-only opener, two content deltas, a finish and a usage chunk.
 *
 * The opener and the finish are not decoration. They are the chunks a naive first-token detector
 * mistakes for output, and every TTFT spec here is written against a stream that contains them.
 */
export function fakeHealthyStream(options: {
  readonly model: string;
  readonly completionTokens?: number;
  readonly promptTokens?: number;
}): readonly string[] {
  return [
    fakeStreamChunk({ model: options.model, choices: [{ delta: { role: 'assistant' } }] }),
    fakeStreamChunk({ model: options.model, choices: [{ delta: { content: '' } }] }),
    fakeStreamChunk({ model: options.model, choices: [{ delta: { content: 'alpha ' } }] }),
    fakeStreamChunk({ model: options.model, choices: [{ delta: { content: 'beta' } }] }),
    fakeStreamChunk({ model: options.model, choices: [{ delta: {}, finish_reason: 'stop' }] }),
    fakeStreamChunk({
      model: options.model,
      choices: [],
      usage: {
        prompt_tokens: options.promptTokens ?? 11,
        completion_tokens: options.completionTokens ?? 2,
      },
    }),
    FAKE_STREAM_DONE,
  ];
}
