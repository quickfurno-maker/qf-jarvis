/**
 * RMB-B's target port, implemented against an OpenAI-compatible LOCAL engine (AS4-PREP-A).
 *
 * ### This is the slice RMB-B said would come later, in the place RMB-B said it belonged
 *
 * RMB-B ships no real target and benchmarks no real model, and its header says a real provider or
 * local-engine adapter is a later slice implemented BEHIND the target port -- "and emphatically not by
 * adding benchmark instrumentation to the production model gateway, which is the serving waist". This
 * file is that adapter. Nothing in RMB-A, RMB-B or the gateway changed to admit it, which is the
 * measure of whether the port was drawn correctly.
 *
 * ### What it prepares, and why the proof happens before warmup
 *
 * `prepareCase` materializes the case's synthetic prompt, proves the materialized bytes hash to the
 * digest the plan declared, and asks the ENGINE what that prompt costs in tokens. All three happen
 * before a single measured request. Discovering afterwards that the prompt differed, or that the token
 * count was 480 rather than 512, means throwing away a run -- and, worse, means a run already
 * published could have been wrong the same way.
 *
 * The token count is the engine's own, through the tokenizer port. It is never estimated from
 * character length. An estimate would be a number that looks exact, sits in evidence beside real ones,
 * and is wrong by whatever the chat template adds.
 *
 * ### Time to first token
 *
 * `onFirstOutput` fires on the first NON-EMPTY content delta and never again. Not on the response
 * headers, not on the role-only chunk every engine sends first, not on an empty string, not on the
 * usage chunk and not on the finish event. Each of those arrives before real output on at least one
 * engine, and marking any of them would make TTFT a measurement of the response header.
 *
 * ### Timeout and cancellation abort the actual request
 *
 * The deadline is a composed `AbortSignal`, handed to the transport, which hands it to the socket.
 * There is no `Promise.race` anywhere here: a race would resolve the invocation while the engine kept
 * generating, RMB-B would free the concurrency slot, and the next request would be admitted against a
 * machine still busy with the last one. Every path -- success, failure, timeout, cancellation, protocol
 * error -- closes the response stream in a `finally` and settles only after it is closed.
 *
 * A timeout is DATA: an ordinary `FAILURE`, exactly as RMB-B's port asks. A suite cancellation is not:
 * it throws, because a cancelled request has no latency to report, and recording it as a failure would
 * put the operator who pressed Ctrl-C into the success rate.
 *
 * ### Nothing measured leaves except counts
 *
 * Generated text is accumulated only so it can be counted when local counting is configured, then
 * dropped. It is never persisted, never logged, never attached to an error and never returned --
 * RMB-B's invocation result has no field it would fit in, and RMB-B's firewall would refuse one.
 *
 * ### Memory is not reported, deliberately
 *
 * There is no honest engine-independent way to read peak accelerator memory over an OpenAI-compatible
 * socket. Process RSS is not VRAM, a model file size is not a working set, and a parameter count is not
 * a measurement. RMB-B makes the probe optional; this adapter supplies none, and the observation
 * carries no memory rather than a fabricated zero.
 */
import type { RiyaBenchmarkWorkloadV1 } from '@qf-jarvis/riya-model-benchmark';
import type {
  RiyaBenchmarkInvocation,
  RiyaBenchmarkInvocationResult,
  RiyaBenchmarkPreparedCase,
  RiyaBenchmarkTargetDescriptor,
  RiyaBenchmarkTargetPort,
} from '@qf-jarvis/riya-model-benchmark-harness';

import type { RiyaLocalBenchmarkAdapterConfigV1 } from '../contracts/adapter-config.js';
import type {
  RiyaLocalChatMessage,
  RiyaLocalEngineHttpResponse,
  RiyaLocalEngineTransportPort,
  RiyaLocalTokenizerPort,
} from '../contracts/engine-ports.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import {
  projectRiyaLocalEngineChunk,
  projectRiyaLocalEngineModelIds,
} from '../internal/engine-firewall.js';
import { RiyaLocalSseDecoder } from '../internal/stream-decoder.js';
import {
  materializeRiyaSyntheticPromptProfile,
  riyaSyntheticPromptProfileDigest,
} from '../prompts/synthetic-profiles.js';

/** The two paths this adapter uses, named once each. */
const CHAT_COMPLETIONS_PATH = '/chat/completions';
const MODELS_PATH = '/models';

/** The sentinel an OpenAI-compatible stream ends with. */
const STREAM_DONE = '[DONE]';

/** A control-traffic body larger than this is a malfunction, not a listing. */
const MAX_CONTROL_BODY_CHARACTERS = 1_048_576;

export interface RiyaLocalBenchmarkTarget extends RiyaBenchmarkTargetPort {
  /**
   * Prove the engine is serving the exact configured model. PRE-BENCHMARK CONTROL TRAFFIC.
   *
   * Called by the runner before the suite starts, never from `invoke`, so it contributes no request to
   * any measured window and no latency to any percentile. A local server that is serving something
   * else must not be found out from the numbers.
   */
  verifyServedModel: (options?: { readonly signal?: AbortSignal }) => Promise<void>;
}

export interface CreateRiyaLocalBenchmarkTargetOptions {
  readonly config: RiyaLocalBenchmarkAdapterConfigV1;
  readonly transport: RiyaLocalEngineTransportPort;
  readonly tokenizer: RiyaLocalTokenizerPort;
}

/** What one case looks like once it has been proved and priced. */
interface PreparedLocalCase {
  readonly messages: readonly RiyaLocalChatMessage[];
  readonly inputTokenCount: number;
  readonly maximumOutputTokens: number;
  readonly requestTimeoutMillis: number;
}

/** A positive safe integer a foreign port claimed, or a closed refusal. */
function assertPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
  }
  return value;
}

/**
 * Read a LIVE abort signal.
 *
 * A direct `signal.aborted` property read gets narrowed by the compiler off an earlier check on the
 * same signal -- and an `AbortSignal` is precisely the value that changes underneath an `await`
 * without any assignment the compiler can see. Reading it through a call is what keeps the later
 * checks meaningful rather than compile-time constants.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** The shapes an aborted request surfaces as, across Node versions and transports. */
function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name: unknown = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Close a response stream, whatever happened to it. Awaited, so nothing outlives the call.
 *
 * The iterator is the one that was actually consumed, not a fresh one: for an async generator those
 * are the same object, but a transport free to return a new iterator per call would otherwise have its
 * live stream left open while an unused one was politely closed.
 */
async function closeIterator(iterator: AsyncIterator<string> | undefined): Promise<void> {
  if (iterator === undefined) {
    return;
  }
  try {
    await iterator.return?.();
  } catch {
    // A stream that refuses to close cleanly says nothing about the measurement, and complaining here
    // would replace the failure that actually explains the run.
  }
}

/**
 * Build a local benchmark target.
 *
 * Every disagreement the configuration can have with itself is settled here, before a socket exists.
 */
export function createRiyaLocalBenchmarkTarget(
  options: CreateRiyaLocalBenchmarkTargetOptions,
): RiyaLocalBenchmarkTarget {
  const { config, transport, tokenizer } = options;

  // A configuration asking for exact local output counting, handed a tokenizer that cannot count
  // output, would silently fall back to the server's number under a label saying it did not.
  if (
    config.outputTokenAccounting === 'LOCAL_TOKENIZER_COUNT' &&
    typeof tokenizer.countOutputTokens !== 'function'
  ) {
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }

  /**
   * The case currently being measured.
   *
   * RMB-B prepares a case, runs its warmup and measured phases, then moves on, and an invocation
   * carries no case id -- so "the case that was prepared last" is the contract, and it is the whole
   * state this target holds.
   */
  let currentCase: PreparedLocalCase | undefined;

  const descriptor = (): RiyaBenchmarkTargetDescriptor =>
    // Frozen values built once by the config constructor and returned identically on every read. RMB-B
    // locks the first answer and re-proves it around every case; a target that recomputed them from
    // mutable state is the one that eventually drifts mid-suite.
    Object.freeze({ subject: config.subject, environment: config.environment });

  const prepareCase = async (
    workload: RiyaBenchmarkWorkloadV1,
  ): Promise<RiyaBenchmarkPreparedCase> => {
    const profileId = config.casePromptProfiles[workload.workloadCaseId];
    if (profileId === undefined) {
      // The plan names a case this configuration has no prompt for. Refused rather than defaulted: a
      // default profile is how a case silently measures a different prompt from the intended one.
      throw new RiyaLocalBenchmarkError('PROMPT_PROFILE_UNKNOWN');
    }

    // Streaming is not optional here. Time to first token is the measurement that separates candidate
    // engines most sharply, and a non-streamed completion has no first token to observe -- an adapter
    // that accepted `streaming: false` would have to invent one.
    if (!workload.streaming) {
      throw new RiyaLocalBenchmarkError('STREAMING_REQUIRED');
    }
    if (workload.samplingConfigDigest !== config.samplingConfigDigest) {
      // The plan was authored under different decoding settings. RMB-B would refuse this too; saying
      // it here says WHICH of the six prepared fields disagreed.
      throw new RiyaLocalBenchmarkError('SAMPLING_CONFIG_MISMATCH');
    }

    const timeoutMicros = workload.requestTimeoutMicros;
    if (timeoutMicros === undefined || timeoutMicros % 1_000 !== 0) {
      // RMB-B's port says the ADAPTER enforces the exact deadline. A JavaScript timer resolves in
      // milliseconds, so a microsecond-precision deadline cannot be honoured exactly -- and rounding it
      // would mean two plans differing by 500 microseconds compared as equal while having abandoned
      // slow requests at the same moment. Refusing is the only honest option.
      throw new RiyaLocalBenchmarkError('REQUEST_TIMEOUT_NOT_MILLISECOND_EXACT');
    }

    const messages = materializeRiyaSyntheticPromptProfile(profileId);
    const promptProfileDigest = riyaSyntheticPromptProfileDigest(profileId);
    if (promptProfileDigest !== workload.promptProfileDigest) {
      // The adapter's own proof, before warmup. RMB-B checks the RETURNED digest as well, so the
      // guarantee survives this check being deleted -- but a plan whose prompt bytes cannot be
      // reproduced deserves to fail with the reason rather than a generic case mismatch.
      throw new RiyaLocalBenchmarkError('PROMPT_PROFILE_DIGEST_MISMATCH');
    }

    let counted: unknown;
    try {
      counted = await tokenizer.countPromptTokens({ messages });
    } catch {
      // The tokenizer is an injected port; a raw exception from it would escape this package's closed
      // vocabulary at the most basic call the adapter makes.
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }
    const inputTokenCount = assertPositiveInteger(counted);

    currentCase = {
      messages,
      inputTokenCount,
      maximumOutputTokens: workload.maximumOutputTokens,
      requestTimeoutMillis: timeoutMicros / 1_000,
    };

    // What was ACTUALLY prepared, not what was asked for. The engine's token count is reported as it
    // came back: if it disagrees with the plan, RMB-B refuses the case before warmup, which is the
    // whole reason the port asks a target to state its own preparation.
    return {
      workloadCaseId: workload.workloadCaseId,
      promptProfileDigest,
      inputTokenCount,
      maximumOutputTokens: workload.maximumOutputTokens,
      samplingConfigDigest: config.samplingConfigDigest,
      streaming: true,
    };
  };

  /**
   * Turn a thrown value into a terminal outcome, without ever guessing.
   *
   * Three cases and only three. The suite was cancelled: not a measurement, so it throws. The deadline
   * expired: measurement data, so it is a `FAILURE`. Anything else came out of the transport or the
   * parser, and rethrowing it would leak whatever an engine, a socket or a proxy put in a message --
   * so it becomes this package's own content-free protocol code.
   */
  function terminalForAbort(
    invocation: RiyaBenchmarkInvocation,
    error: unknown,
  ): RiyaBenchmarkInvocationResult {
    if (isAborted(invocation.signal)) {
      throw new RiyaLocalBenchmarkError('REQUEST_CANCELLED');
    }
    if (error instanceof RiyaLocalBenchmarkError) {
      throw error;
    }
    if (isAbortLike(error)) {
      // The deadline. The composed signal fired, the socket closed, and the engine was told to stop.
      return { outcome: 'FAILURE' };
    }
    throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
  }

  async function resolveOutputTokens(
    generated: string,
    completionTokens: number | undefined,
  ): Promise<number> {
    if (config.outputTokenAccounting === 'SERVER_REPORTED_USAGE') {
      if (completionTokens === undefined || completionTokens < 1) {
        // No invented number. An engine that streamed output and reported no usable completion count
        // has not said how many tokens it produced, and "approximately N" has no place in evidence.
        throw new RiyaLocalBenchmarkError('ENGINE_USAGE_INVALID');
      }
      return completionTokens;
    }
    const count = tokenizer.countOutputTokens;
    if (count === undefined) {
      // Unreachable: the constructor refuses this configuration. Kept because the alternative to an
      // explicit refusal is a silent fallback to the server's number.
      throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
    }
    let counted: unknown;
    try {
      counted = await count({ text: generated });
    } catch {
      throw new RiyaLocalBenchmarkError('TOKENIZER_INVALID');
    }
    return assertPositiveInteger(counted);
  }

  const invoke = async (
    invocation: RiyaBenchmarkInvocation,
  ): Promise<RiyaBenchmarkInvocationResult> => {
    const measured = currentCase;
    if (measured === undefined) {
      // A request for a case that was never prepared is a scheduling bug, and guessing which prompt it
      // meant would be worse than refusing.
      throw new RiyaLocalBenchmarkError('CASE_NOT_PREPARED');
    }
    if (isAborted(invocation.signal)) {
      throw new RiyaLocalBenchmarkError('REQUEST_CANCELLED');
    }

    // The per-request deadline and the suite cancellation, composed into ONE signal that reaches the
    // socket. `AbortSignal.timeout` schedules an unref'd timer, so nothing here keeps the process
    // alive once the suite has returned.
    const deadline = AbortSignal.timeout(measured.requestTimeoutMillis);
    const signal = AbortSignal.any([invocation.signal, deadline]);

    const body = JSON.stringify({
      model: config.servedModelId,
      messages: measured.messages,
      max_tokens: measured.maximumOutputTokens,
      stream: true,
      // Asked for explicitly: without it most engines omit `usage` from a streamed response entirely,
      // and the adapter would have to guess an output count it is not allowed to guess.
      stream_options: { include_usage: true },
      temperature: config.sampling.temperature,
      top_p: config.sampling.topP,
      seed: config.sampling.seed,
    });

    let iterator: AsyncIterator<string> | undefined;
    let generated = '';
    // Held in one object rather than as separate `let`s: every one of these is written from the chunk
    // callback below, and the compiler does not track assignments made inside a nested function -- so
    // the checks after the stream ends would otherwise be evaluated against their initial values.
    const seen: {
      sawContent: boolean;
      promptTokens: number | undefined;
      completionTokens: number | undefined;
    } = { sawContent: false, promptTokens: undefined, completionTokens: undefined };

    const absorbChunk = (payload: string): void => {
      const projected = projectRiyaLocalEngineChunk(payload);
      if (projected.model !== undefined && projected.model !== config.servedModelId) {
        // The engine is serving something other than the release this evidence will be stamped with.
        // Silent substitution is the one failure a benchmark cannot survive: every number would be
        // real, and every number would be about the wrong model.
        throw new RiyaLocalBenchmarkError('ENGINE_MODEL_MISMATCH');
      }
      if (projected.contentDelta !== undefined) {
        if (!seen.sawContent) {
          seen.sawContent = true;
          invocation.onFirstOutput();
        }
        generated += projected.contentDelta;
      }
      if (projected.usage !== undefined) {
        seen.promptTokens = projected.usage.promptTokens ?? seen.promptTokens;
        seen.completionTokens = projected.usage.completionTokens ?? seen.completionTokens;
      }
    };

    try {
      let response: RiyaLocalEngineHttpResponse;
      try {
        response = await transport.request({
          method: 'POST',
          path: CHAT_COMPLETIONS_PATH,
          body,
          signal,
        });
      } catch (error: unknown) {
        return terminalForAbort(invocation, error);
      }

      // A redirect is refused rather than followed. The transport refuses one too; this is the second
      // half of the same rule, and it is the half that still holds when the transport is a fake.
      if (response.status >= 300 && response.status < 400) {
        throw new RiyaLocalBenchmarkError('ENGINE_REDIRECT_REFUSED');
      }
      if (response.status !== 200) {
        // An engine that answered with an error answered. That is a failed request -- measurement data
        // -- not a broken adapter and not a reason to abandon the suite.
        return { outcome: 'FAILURE' };
      }

      iterator = response.body[Symbol.asyncIterator]();
      const decoder = new RiyaLocalSseDecoder();
      let done = false;

      try {
        while (!done) {
          const step = await iterator.next();
          if (step.done === true) {
            break;
          }
          for (const payload of decoder.push(step.value)) {
            if (payload === STREAM_DONE) {
              done = true;
              break;
            }
            absorbChunk(payload);
          }
        }
        if (!done) {
          for (const payload of decoder.finish()) {
            if (payload !== STREAM_DONE) {
              absorbChunk(payload);
            }
          }
        }
      } catch (error: unknown) {
        return terminalForAbort(invocation, error);
      }

      // The stream ended. HOW it ended decides everything below.
      if (isAborted(invocation.signal)) {
        throw new RiyaLocalBenchmarkError('REQUEST_CANCELLED');
      }
      if (isAborted(deadline)) {
        return { outcome: 'FAILURE' };
      }
      if (!seen.sawContent) {
        // A 200 that produced no output token. RMB-B refuses a success with `outputTokens < 1` as a
        // protocol violation, and it is right to: there is no time to first token, so there is no
        // measurement, and calling it a very fast request would be the worst possible reading.
        throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
      }

      const outputTokens = await resolveOutputTokens(generated, seen.completionTokens);
      if (outputTokens > measured.maximumOutputTokens) {
        // The engine ignored the cap. RMB-B would refuse it as `OUTPUT_TOKEN_LIMIT_EXCEEDED`; refusing
        // here says the engine was the one that broke the contract.
        throw new RiyaLocalBenchmarkError('ENGINE_USAGE_INVALID');
      }
      if (seen.promptTokens !== undefined && seen.promptTokens !== measured.inputTokenCount) {
        // The engine consumed a different prompt from the one that was priced. Never averaged, never
        // replaced with the planned number: this is exactly the drift a benchmark must not smooth over.
        throw new RiyaLocalBenchmarkError('ENGINE_USAGE_INVALID');
      }

      return { outcome: 'SUCCESS', inputTokens: measured.inputTokenCount, outputTokens };
    } finally {
      // Counted, then gone. Dropping the reference is not a formality: it is the line that makes
      // "generated text does not outlive the request that produced it" true.
      generated = '';
      await closeIterator(iterator);
    }
  };

  const verifyServedModel = async (
    verifyOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<void> => {
    let iterator: AsyncIterator<string> | undefined;
    try {
      const response = await transport.request({
        method: 'GET',
        path: MODELS_PATH,
        signal: verifyOptions.signal ?? new AbortController().signal,
      });
      if (response.status !== 200) {
        throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
      }
      iterator = response.body[Symbol.asyncIterator]();
      let text = '';
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) {
          break;
        }
        text += step.value;
        if (text.length > MAX_CONTROL_BODY_CHARACTERS) {
          throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
        }
      }
      if (!projectRiyaLocalEngineModelIds(text).includes(config.servedModelId)) {
        // No nearest match, no prefix match, no single-entry shortcut. "It is the only model loaded, so
        // it must be the one" is precisely how a benchmark ends up attributed to the wrong release.
        throw new RiyaLocalBenchmarkError('ENGINE_MODEL_MISMATCH');
      }
    } catch (error: unknown) {
      if (error instanceof RiyaLocalBenchmarkError) {
        throw error;
      }
      throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
    } finally {
      await closeIterator(iterator);
    }
  };

  return Object.freeze({ descriptor, prepareCase, invoke, verifyServedModel });
}
