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
 * ### Failures are normalized, content-free
 *
 * A foreign adapter's exception may carry a prompt, a URL or a credential in its message. None of it
 * may reach a `RiyaHarnessError`, so a foreign throw becomes a closed code and nothing else — the
 * original is deliberately not chained, because `cause` would carry it just as far.
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
  RiyaBenchmarkMemoryReading,
  RiyaBenchmarkPreparedCase,
  RiyaBenchmarkTargetDescriptor,
} from '../contracts/ports.js';

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
  const parsed = descriptorSchema.safeParse(value);
  if (!parsed.success) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  if (!Object.hasOwn(parsed.data, 'subject') || !Object.hasOwn(parsed.data, 'environment')) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  return parsed.data as RiyaBenchmarkTargetDescriptor;
}

/** A prepared case, rebuilt. Anything extra — a prompt, a message list — is refused. */
export function parsePreparedCase(value: unknown): RiyaBenchmarkPreparedCase {
  const parsed = preparedSchema.safeParse(value);
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
  const parsed = invocationResultSchema.safeParse(value);
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
  const parsed = memorySchema.safeParse(value);
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

/**
 * Await a foreign call, normalizing ANY rejection to one closed code.
 *
 * A harness error passing through is re-thrown unchanged — it is ours and already content-free. Every
 * other rejection is REPLACED, never wrapped.
 */
export async function callForeign<T>(
  operation: () => Promise<T> | T,
  code: RiyaHarnessErrorCode,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof RiyaHarnessError) {
      throw error;
    }
    throw new RiyaHarnessError(code);
  }
}
