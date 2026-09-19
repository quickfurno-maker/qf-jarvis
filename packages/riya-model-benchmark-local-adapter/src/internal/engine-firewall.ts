/**
 * What the adapter is willing to believe about an engine response (AS4-PREP-A).
 *
 * ### Projection, not passthrough -- and not strict refusal either
 *
 * RMB-B's port firewall refuses an unknown key outright, because a target is written against a
 * contract this repository owns. An OpenAI-compatible engine is not: real servers add
 * `system_fingerprint`, `service_tier`, per-engine timing blocks and whatever the next release
 * invents, and refusing those would make the adapter break on a routine engine upgrade while proving
 * nothing.
 *
 * So this layer PROJECTS. It reads the four things that have meaning -- the served model, one content
 * delta, the finish signal and the usage counts -- copies them into a small owned value, and drops
 * everything else on the floor. The raw object never leaves this file, is never stored, and is never
 * what a caller holds. That is the same guarantee strict refusal would give, obtained in the way that
 * survives contact with a real server.
 *
 * ### The generated text is the point of the discipline
 *
 * A content delta IS customer-shaped text -- it is a model's reply. It exists in this process only
 * long enough to be counted, it is never written to an artifact, never logged, never attached to an
 * error, and never returned to RMB-B, whose invocation result has no field it would fit in.
 *
 * ### Reads are by descriptor
 *
 * `JSON.parse` cannot produce an accessor, so nothing here is defending against a hostile getter. It
 * CAN produce an own `__proto__` key, and a plain `value.model` read on a hand-built object elsewhere
 * in a future refactor could run one. Reading own data properties is the cheap habit that keeps this
 * file true for whatever it is later handed.
 */
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

/** An own DATA property, or `undefined` for anything else -- absent, inherited, or an accessor. */
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

/** A non-negative safe integer, or `undefined`. Used for every count an engine reports. */
function readCount(value: unknown, key: string): number | undefined {
  const raw = readOwnData(value, key);
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    return undefined;
  }
  return raw;
}

export interface RiyaLocalEngineUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

/** The four meaningful facts in one streamed chunk. Everything else in it is discarded. */
export interface RiyaLocalEngineChunk {
  readonly model?: string;
  /** The generated text carried by this chunk. Counted, then dropped. */
  readonly contentDelta?: string;
  readonly finished: boolean;
  readonly usage?: RiyaLocalEngineUsage;
}

/**
 * Project one decoded chunk payload.
 *
 * Throws `ENGINE_PROTOCOL_INVALID` for anything that is not parseable JSON describing an object --
 * a proxy error page, a plain-text stack trace, an HTML redirect body. Those mean the adapter is not
 * talking to the engine it thinks it is, which is worse than a slow request and must not be recorded
 * as one.
 */
export function projectRiyaLocalEngineChunk(payload: string): RiyaLocalEngineChunk {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
  }

  const modelRaw = readOwnData(raw, 'model');
  const model = typeof modelRaw === 'string' && modelRaw.length > 0 ? modelRaw : undefined;

  let contentDelta: string | undefined;
  let finished = false;
  const choices = readOwnData(raw, 'choices');
  if (Array.isArray(choices)) {
    // One logical request, one choice. `n > 1` is never requested by this adapter, and reading a
    // second choice would credit output the benchmark did not ask for.
    const choice: unknown = (choices as readonly unknown[])[0];
    if (choice !== undefined) {
      const reason = readOwnData(choice, 'finish_reason');
      finished = typeof reason === 'string' && reason.length > 0;
      const delta = readOwnData(choice, 'delta');
      const content = readOwnData(delta, 'content');
      // A role-only delta, an explicitly null content and an empty string are all NOT output. Each of
      // them arrives before the first real token on at least one real engine, and treating any of
      // them as output would report a time-to-first-token that measures the response header.
      if (typeof content === 'string' && content.length > 0) {
        contentDelta = content;
      }
    }
  }

  const usageRaw = readOwnData(raw, 'usage');
  let usage: RiyaLocalEngineUsage | undefined;
  if (typeof usageRaw === 'object' && usageRaw !== null) {
    const promptTokens = readCount(usageRaw, 'prompt_tokens');
    const completionTokens = readCount(usageRaw, 'completion_tokens');
    usage = Object.freeze({
      ...(promptTokens === undefined ? {} : { promptTokens }),
      ...(completionTokens === undefined ? {} : { completionTokens }),
    });
  }

  return Object.freeze({
    ...(model === undefined ? {} : { model }),
    ...(contentDelta === undefined ? {} : { contentDelta }),
    finished,
    ...(usage === undefined ? {} : { usage }),
  });
}

/**
 * The model ids a `/models` listing claims to serve.
 *
 * Control traffic, read once before a suite. Bounded, because a malfunctioning engine returning a
 * hundred thousand entries should fail the check rather than the process.
 */
export function projectRiyaLocalEngineModelIds(body: string): readonly string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
  }
  const data = readOwnData(raw, 'data');
  if (!Array.isArray(data) || data.length > 4_096) {
    throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
  }
  const ids: string[] = [];
  for (const entry of data) {
    const id = readOwnData(entry, 'id');
    if (typeof id === 'string' && id.length > 0 && id.length <= 256) {
      ids.push(id);
    }
  }
  return Object.freeze(ids);
}
