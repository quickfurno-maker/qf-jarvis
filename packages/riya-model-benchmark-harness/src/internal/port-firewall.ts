/**
 * Strict runtime validation of FOREIGN PORT OUTPUT (RMB-B).
 *
 * ### A TypeScript interface is not a firewall
 *
 * `RiyaBenchmarkInvocationSuccess` says a result carries counts. At run time an adapter written by
 * somebody else — in a later slice, against a real provider — can hand back:
 *
 * ```
 * { outcome: 'SUCCESS', inputTokens: 512, outputTokens: 20, text: 'raw model reply' }
 * ```
 *
 * and the compiler has been out of the room for hours. Reading the known fields and ignoring `text`
 * means the claim "no content can cross this boundary BY SHAPE" is false: the content crossed, it was
 * merely unused. Something downstream eventually logs the object.
 *
 * So every value arriving from a port is parsed strictly and REBUILT here. An unknown key is a refusal,
 * not a passthrough, which is what makes the shape claim true rather than aspirational.
 *
 * ### Exact means EVERY own key
 *
 * `.strict()` compares enumerable string keys, which is the set a `{...spread}` or a `JSON.stringify`
 * would show. An adapter can define `transcript` as non-enumerable, or key it by a symbol, and that
 * object looks empty to both. `Reflect.ownKeys` does not, so the own-key gate below runs first and
 * treats a symbol or a hidden property as exactly what it is: an unknown key.
 *
 * ### Zod never sees a foreign object
 *
 * An exact key set is not enough either, because a LEGITIMATE key can be an accessor. `safeParse` is a
 * validation API, not an exception sandbox: it reads the properties it is asked about, so a getter on
 * `outcome` would run foreign code during parsing and its throw would escape as itself — and parsing
 * deliberately sits outside `callForeign`, where nothing would replace it.
 *
 * So every data DTO is SNAPSHOTTED first: own keys reflected, accessors refused without being invoked,
 * data values copied into a fresh plain object, and only that object handed to a schema.
 *
 * ### Even the reflection is foreign
 *
 * `Reflect.ownKeys` and `Object.getOwnPropertyDescriptor` run proxy traps, and a trap can throw. Both
 * are therefore performed through the same normalizing helper as any other foreign call. Looking at an
 * untrusted object is itself an operation that can fail, and it fails closed.
 *
 * ### A foreign `RiyaHarnessError` is not a harness error
 *
 * The error class is exported, so foreign code can construct one, pick whichever closed code suits it,
 * and hang a prompt off `message` or an endpoint off `cause`. `instanceof` would say yes to all of it.
 * Trust here comes from WHERE a throw arose, never from what class the thrower claims — so anything
 * raised by foreign code is REPLACED with a freshly constructed, content-free error for that boundary,
 * including when it is already a `RiyaHarnessError`.
 *
 * The consequence for callers: internal parsing must sit OUTSIDE the foreign call, because there is no
 * longer any way to tell an internal failure apart from a foreign one once both are inside the same
 * `catch`. Every function here is shaped that way, and so are its call sites.
 *
 * ### It does not restate RMB-A
 *
 * Subject and environment are checked for OUTER shape here and then re-proved by their own RMB-A
 * constructors; the byte bound is imported rather than copied. This file owns the boundary, not the
 * contracts.
 */
import { RIYA_BENCHMARK_MAX_BYTES } from '@qf-jarvis/riya-model-benchmark';
import { z } from 'zod';

import { RiyaHarnessError } from '../contracts/errors.js';
import type { RiyaHarnessErrorCode } from '../contracts/errors.js';
import type {
  RiyaBenchmarkInvocationResult,
  RiyaBenchmarkMemoryCasePort,
  RiyaBenchmarkMemoryReading,
  RiyaBenchmarkPreparedCase,
  RiyaBenchmarkTargetDescriptor,
} from '../contracts/ports.js';

/** Own keys of a foreign object, with a hostile `ownKeys` proxy trap normalized rather than raised. */
function safeOwnKeys(value: object, code: RiyaHarnessErrorCode): readonly (string | symbol)[] {
  return callForeignSync(() => Reflect.ownKeys(value), code);
}

/**
 * Read an own DATA property of a foreign object without running any of its code.
 *
 * `handle.abort` looks like a read. On an untrusted object it can be an accessor, and evaluating it
 * runs foreign code outside every normalization boundary this package has — free to throw a prompt, or
 * to do something less polite. A descriptor lookup reports the accessor instead of invoking it.
 *
 * The lookup itself can be a proxy trap, and a trap can throw; that is swallowed here rather than
 * normalized, because this function's callers ask "is there something safe to use" and the honest
 * answer for an object that will not even be inspected is no.
 *
 * Returns `undefined` for a non-object, an absent key, an accessor, or a hostile trap.
 */
export function ownDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
    return undefined;
  }
  return descriptor.value;
}

/** Refuse anything carrying an own key outside `allowed`, before its schema is consulted. */
function assertOwnKeysWithin(
  value: unknown,
  allowed: readonly string[],
  code: RiyaHarnessErrorCode,
): void {
  if (typeof value !== 'object' || value === null) {
    throw new RiyaHarnessError(code);
  }
  for (const key of safeOwnKeys(value, code)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new RiyaHarnessError(code);
    }
  }
}

/**
 * A fresh plain object holding the foreign value's own DATA properties, and nothing else.
 *
 * This is what a schema gets to see. The foreign object is reflected over, never read from: an
 * accessor on an allowed key is refused WITHOUT being invoked, which is the whole point — `outcome`
 * being a legitimate key says nothing about whether reading it runs somebody's code.
 *
 * PRESENCE IS PRESERVED. Only keys the object actually has are copied, because absence carries
 * meaning: a `FAILURE` result legitimately has no `outputTokens`, an unmeasured probe legitimately
 * reports no bytes, and manufacturing those keys as `undefined` would change which union arm matched
 * and which optional fields a rebuilt artifact carries.
 */
function snapshotOwnDataObject(
  value: unknown,
  allowed: readonly string[],
  code: RiyaHarnessErrorCode,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new RiyaHarnessError(code);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of safeOwnKeys(value, code)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new RiyaHarnessError(code);
    }
    const descriptor = callForeignSync(() => Object.getOwnPropertyDescriptor(value, key), code);
    if (descriptor === undefined) {
      // `ownKeys` claimed a key the descriptor lookup denies. An object that cannot describe itself
      // consistently is not one to take numbers from.
      throw new RiyaHarnessError(code);
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new RiyaHarnessError(code);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

const DESCRIPTOR_KEYS = ['subject', 'environment'] as const;
const PREPARED_KEYS = [
  'workloadCaseId',
  'promptProfileDigest',
  'inputTokenCount',
  'maximumOutputTokens',
  'samplingConfigDigest',
  'streaming',
] as const;
const INVOCATION_RESULT_KEYS = ['outcome', 'inputTokens', 'outputTokens'] as const;
const MEMORY_READING_KEYS = ['peakAcceleratorMemoryBytes', 'peakHostMemoryBytes'] as const;
const MEMORY_CASE_KEYS = ['finish', 'abort'] as const;

/**
 * The outer descriptor surface: exactly two keys, both present.
 *
 * `z.unknown()` tolerates an absent key, so presence is asserted separately below — otherwise `{}`
 * would parse and the "exact keys" claim would hold in only one direction.
 */
const descriptorSchema = z.object({ subject: z.unknown(), environment: z.unknown() }).strict();

const preparedSchema = z
  .object({
    workloadCaseId: z.string().min(1).max(128),
    promptProfileDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    inputTokenCount: z.int().min(1),
    maximumOutputTokens: z.int().min(1),
    samplingConfigDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    streaming: z.boolean(),
  })
  .strict();

/**
 * A discriminated union, `.strict()` on both arms.
 *
 * This is the one that matters most: `text`, `content`, `output`, `partialText`, `messages` and
 * `usageBlob` are all refused, because neither arm admits an unknown key.
 */
const invocationResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('SUCCESS'),
      inputTokens: z.int().min(0),
      outputTokens: z.int().min(0),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('FAILURE'),
      inputTokens: z.int().min(0).optional(),
    })
    .strict(),
]);

/** Bytes, bounded by RMB-A's own limit so an over-bound reading is refused with a precise code. */
const memorySchema = z
  .object({
    peakAcceleratorMemoryBytes: z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES).optional(),
    peakHostMemoryBytes: z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES).optional(),
  })
  .strict();

/**
 * Outer descriptor shape only. The two halves are re-proved by RMB-A at the call site.
 *
 * The assertion is the honest expression of the boundary: what arrives is `unknown` twice over, and
 * the constructors that follow are what decide whether it is a subject and an environment.
 */
export function parseTargetDescriptor(value: unknown): RiyaBenchmarkTargetDescriptor {
  const snapshot = snapshotOwnDataObject(value, DESCRIPTOR_KEYS, 'TARGET_PROTOCOL_INVALID');
  const parsed = descriptorSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  if (!Object.hasOwn(snapshot, 'subject') || !Object.hasOwn(snapshot, 'environment')) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  return parsed.data as RiyaBenchmarkTargetDescriptor;
}

/** A prepared case, rebuilt. Anything extra — a prompt, a message list — is refused. */
export function parsePreparedCase(value: unknown): RiyaBenchmarkPreparedCase {
  const parsed = preparedSchema.safeParse(
    snapshotOwnDataObject(value, PREPARED_KEYS, 'TARGET_PROTOCOL_INVALID'),
  );
  if (!parsed.success) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  return Object.freeze({
    workloadCaseId: parsed.data.workloadCaseId,
    promptProfileDigest: parsed.data.promptProfileDigest,
    inputTokenCount: parsed.data.inputTokenCount,
    maximumOutputTokens: parsed.data.maximumOutputTokens,
    samplingConfigDigest: parsed.data.samplingConfigDigest,
    streaming: parsed.data.streaming,
  });
}

/** A terminal result, rebuilt. No raw output survives this. */
export function parseInvocationResult(value: unknown): RiyaBenchmarkInvocationResult {
  const parsed = invocationResultSchema.safeParse(
    snapshotOwnDataObject(value, INVOCATION_RESULT_KEYS, 'TARGET_PROTOCOL_INVALID'),
  );
  if (!parsed.success) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  const result = parsed.data;
  if (result.outcome === 'FAILURE') {
    return Object.freeze(
      result.inputTokens === undefined
        ? { outcome: 'FAILURE' as const }
        : { outcome: 'FAILURE' as const, inputTokens: result.inputTokens },
    );
  }
  return Object.freeze({
    outcome: 'SUCCESS' as const,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}

/** A memory reading, rebuilt. A machine name, a serial or a device path has nowhere to sit. */
export function parseMemoryReading(value: unknown): RiyaBenchmarkMemoryReading {
  const parsed = memorySchema.safeParse(
    snapshotOwnDataObject(value, MEMORY_READING_KEYS, 'MEMORY_MEASUREMENT_INVALID'),
  );
  if (!parsed.success) {
    throw new RiyaHarnessError('MEMORY_MEASUREMENT_INVALID');
  }
  return Object.freeze({
    ...(parsed.data.peakAcceleratorMemoryBytes === undefined
      ? {}
      : { peakAcceleratorMemoryBytes: parsed.data.peakAcceleratorMemoryBytes }),
    ...(parsed.data.peakHostMemoryBytes === undefined
      ? {}
      : { peakHostMemoryBytes: parsed.data.peakHostMemoryBytes }),
  });
}

/** A foreign lifecycle call, captured once and invoked with the handle as its receiver. */
type ForeignLifecycleCall = (this: unknown) => unknown;

/**
 * A memory-case HANDLE, rebuilt.
 *
 * The other parsers rebuild data; this one rebuilds a capability, and it is the surface that was
 * easiest to overlook — a handle is stored rather than read, so an adapter could hang a transcript off
 * it and nothing would ever look. What the harness keeps is a frozen object of its own with exactly
 * two methods, so the foreign object survives only as a closed-over receiver.
 *
 * `finish` rebuilds its reading; `abort` proves its completion is void, because cleanup that resolves
 * with data is data crossing the boundary through the one call nobody inspects.
 */
export function parseMemoryCasePort(value: unknown): RiyaBenchmarkMemoryCasePort {
  assertOwnKeysWithin(value, MEMORY_CASE_KEYS, 'MEMORY_MEASUREMENT_INVALID');
  // Descriptor reads, not property reads: an accessor here would be foreign code executing during
  // VALIDATION, which is the one moment nothing is guarding.
  const finish = ownDataProperty(value, 'finish');
  const abort = ownDataProperty(value, 'abort');
  if (typeof finish !== 'function' || typeof abort !== 'function') {
    throw new RiyaHarnessError('MEMORY_MEASUREMENT_INVALID');
  }
  // Captured once, so the pair that was proved is the pair that gets called.
  const finishCall = finish as ForeignLifecycleCall;
  const abortCall = abort as ForeignLifecycleCall;

  return Object.freeze({
    finish: async (): Promise<RiyaBenchmarkMemoryReading> => {
      // Parsed AFTER the foreign boundary returns, never inside it.
      const raw = await callForeign(() => finishCall.call(value), 'MEMORY_MEASUREMENT_INVALID');
      return parseMemoryReading(raw);
    },
    abort: async (): Promise<void> => {
      const completion = await callForeign(
        () => abortCall.call(value),
        'MEMORY_MEASUREMENT_INVALID',
      );
      if (completion !== undefined) {
        throw new RiyaHarnessError('MEMORY_MEASUREMENT_INVALID');
      }
    },
  });
}

/**
 * Await a foreign call, replacing ANY rejection with one closed code.
 *
 * Replaced, never wrapped and never re-thrown — not even when the foreign value is already a
 * `RiyaHarnessError`. The class is exported, so an adapter can construct one, choose a misleading code
 * and carry a prompt in `message` or a credential in `cause`; `instanceof` cannot tell that apart from
 * ours and is therefore not evidence of anything.
 */
export async function callForeign<T>(
  operation: () => Promise<T> | T,
  code: RiyaHarnessErrorCode,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new RiyaHarnessError(code);
  }
}

/** The synchronous twin, for the clock — the one port the harness reads without awaiting. */
export function callForeignSync<T>(operation: () => T, code: RiyaHarnessErrorCode): T {
  try {
    return operation();
  } catch {
    throw new RiyaHarnessError(code);
  }
}
