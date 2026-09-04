/**
 * Exact prompt token counting, by the engine that will run the benchmark (AS4-PREP-A).
 *
 * ### Why not a tokenizer library
 *
 * Because a library's answer is not the number the benchmark consumes. The engine applies its own chat
 * template before tokenizing, and the template is a property of the model repository, the engine
 * version and the launch flags. A local tokenizer would agree with it most of the time, and the times
 * it disagreed would produce evidence claiming an exact input token count that the engine never used.
 *
 * It would also drag a Python-adjacent dependency, a downloaded tokenizer file and a model-specific
 * code path into a package whose whole claim is that it downloads nothing.
 *
 * ### How the count is obtained, and why it is exact
 *
 * One non-streamed completion of the SAME messages with `max_tokens: 1`, and the engine's reported
 * `usage.prompt_tokens` is read. That is not an estimate of what the benchmark request will consume: it
 * is the same engine, the same model, the same template and the same messages, so it is the number
 * itself.
 *
 * It costs one generated token per case, and it is PRE-BENCHMARK CONTROL TRAFFIC -- it happens inside
 * `prepareCase`, before warmup, outside every measured window and outside every percentile.
 *
 * ### It counts prompts only
 *
 * There is no uniform OpenAI-compatible way to tokenize arbitrary assistant text, so `countOutputTokens`
 * is deliberately absent rather than approximated. A configuration asking for local output counting is
 * refused when it is handed this tokenizer, which is the honest outcome: the alternative is a number
 * labelled "exact local count" that came from somewhere else.
 */
import type {
  RiyaLocalChatMessage,
  RiyaLocalEngineHttpResponse,
  RiyaLocalEngineTransportPort,
  RiyaLocalTokenizerPort,
} from '../contracts/engine-ports.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

const CHAT_COMPLETIONS_PATH = '/chat/completions';

/** A counting response is small. Anything larger is a malfunction, not a completion. */
const MAX_BODY_CHARACTERS = 1_048_576;

/** An own DATA property, or `undefined`. Same discipline as the streaming firewall. */
function readOwnData(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
    return undefined;
  }
  return descriptor.value;
}

async function readBody(response: RiyaLocalEngineHttpResponse): Promise<string> {
  const iterator = response.body[Symbol.asyncIterator]();
  let text = '';
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) {
        return text;
      }
      text += step.value;
      if (text.length > MAX_BODY_CHARACTERS) {
        throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
      }
    }
  } finally {
    try {
      await iterator.return?.();
    } catch {
      // Nothing useful left to learn from a stream that will not close.
    }
  }
}

export interface CreateRiyaLocalEngineUsageTokenizerOptions {
  readonly transport: RiyaLocalEngineTransportPort;
  /** The exact served model. The counting request must be answered by the same one. */
  readonly servedModelId: string;
}

/** Build a tokenizer that asks the engine what a prompt costs. */
export function createRiyaLocalEngineUsageTokenizer(
  options: CreateRiyaLocalEngineUsageTokenizerOptions,
): RiyaLocalTokenizerPort {
  const countPromptTokens = async (input: {
    readonly messages: readonly RiyaLocalChatMessage[];
    readonly signal?: AbortSignal;
  }): Promise<number> => {
    const body = JSON.stringify({
      model: options.servedModelId,
      messages: input.messages,
      max_tokens: 1,
      stream: false,
      // Deterministic and minimal. Nothing about this request is measured, so the only thing that
      // matters is that it consumes the identical prompt.
      temperature: 0,
    });

    let response: RiyaLocalEngineHttpResponse;
    try {
      response = await options.transport.request({
        method: 'POST',
        path: CHAT_COMPLETIONS_PATH,
        body,
        signal: input.signal ?? new AbortController().signal,
      });
    } catch (error: unknown) {
      if (error instanceof RiyaLocalBenchmarkError) {
        throw error;
      }
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }
    if (response.status !== 200) {
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(response));
    } catch (error: unknown) {
      if (error instanceof RiyaLocalBenchmarkError) {
        throw error;
      }
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }

    const model = readOwnData(parsed, 'model');
    if (typeof model === 'string' && model !== options.servedModelId) {
      // Counting a prompt against a different model than the one that will be benchmarked would give
      // an exact number for the wrong tokenizer -- the same substitution failure, one layer earlier.
      throw new RiyaLocalBenchmarkError('ENGINE_MODEL_MISMATCH');
    }
    const promptTokens = readOwnData(readOwnData(parsed, 'usage'), 'prompt_tokens');
    if (
      typeof promptTokens !== 'number' ||
      !Number.isSafeInteger(promptTokens) ||
      promptTokens < 1
    ) {
      // An engine that will not say what it consumed cannot be benchmarked under exact input parity,
      // and guessing here would defeat the reason the port exists.
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }
    return promptTokens;
  };

  // `countOutputTokens` is deliberately not provided. See the header.
  return Object.freeze({ countPromptTokens });
}
