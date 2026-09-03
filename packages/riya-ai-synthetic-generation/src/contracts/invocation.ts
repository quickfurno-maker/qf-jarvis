/**
 * The invocation envelopes (AS2, ADR-0143).
 *
 * ### A request carries refs and an input digest, never the transport
 *
 * No key, no URL, no header, no account. The adapter behind the port already knows how to reach
 * whatever `adapterRef` names; the envelope's job is to say WHICH configuration, in WHICH role, for
 * WHICH scenario, on WHICH attempt — the things an artifact has to be able to cite afterwards.
 *
 * `inputDigest` rather than the input itself. The structured input contains generated dialogue, and
 * an envelope is the thing that ends up in a checkpoint and a log line.
 *
 * ### A result carries a closed status, never a provider's words
 *
 * `errorClass` is a code. A provider's error body is untrusted text that can carry a request id, an
 * account hint or a truncated prompt, and a harness that stored it would put all of that in a
 * repository. The raw payload is available to the parser at the boundary and is dropped inward.
 */
import { z } from 'zod';

import { SHA256_HEX } from '../internal/digest.js';
import { RiyaSyntheticGenerationError } from './errors.js';
import { RIYA_SYNTHETIC_ROLES } from './model-config.js';
import type { RiyaSyntheticRole } from './model-config.js';

export const RIYA_SYNTHETIC_INVOCATION_STATUSES = [
  'SUCCESS',
  'MALFORMED',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'CANCELLED',
] as const;
export type RiyaSyntheticInvocationStatus = (typeof RIYA_SYNTHETIC_INVOCATION_STATUSES)[number];

/**
 * Why an invocation failed, as a closed code.
 *
 * `TRANSIENT` and `PERMANENT` are separated because only one of them may be retried. Collapsing them
 * would either retry a permanent failure forever or refuse to retry a blip.
 */
export const RIYA_SYNTHETIC_ERROR_CLASSES = [
  'TRANSIENT',
  'PERMANENT',
  'TIMEOUT',
  'CANCELLED',
  'MALFORMED_OUTPUT',
] as const;
export type RiyaSyntheticErrorClass = (typeof RIYA_SYNTHETIC_ERROR_CLASSES)[number];

export interface RiyaSyntheticInvocationRequestV1 {
  readonly version: 1;
  readonly requestRef: string;
  readonly generationRef: string;
  readonly scenarioRef: string;
  readonly role: RiyaSyntheticRole;
  readonly configRef: string;
  /** The digest of the structured input. The input itself never enters the envelope. */
  readonly inputDigest: string;
  readonly outputSchemaRef: string;
  readonly attempt: number;
  readonly maxOutputTokens: number;
}

export type RiyaSyntheticInvocationRequestInput = Omit<
  RiyaSyntheticInvocationRequestV1,
  'version'
> & { readonly version?: 1 };

/** Integer counters only. No cost, because prices change and a stored price becomes a lie. */
export interface RiyaSyntheticUsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface RiyaSyntheticInvocationResultV1 {
  readonly version: 1;
  readonly requestRef: string;
  readonly configRef: string;
  readonly role: RiyaSyntheticRole;
  readonly status: RiyaSyntheticInvocationStatus;
  /** Present only on SUCCESS. The digest of what came back, never the text. */
  readonly outputDigest?: string;
  readonly usage?: RiyaSyntheticUsageV1;
  /** Present only on failure. A closed code — never a provider message. */
  readonly errorClass?: RiyaSyntheticErrorClass;
}

export type RiyaSyntheticInvocationResultInput = Omit<
  RiyaSyntheticInvocationResultV1,
  'version'
> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const COUNTER = z.int().min(0).max(100_000_000);

const requestSchema = z
  .object({
    version: z.literal(1).optional(),
    requestRef: REF,
    generationRef: REF,
    scenarioRef: REF,
    role: z.enum(RIYA_SYNTHETIC_ROLES),
    configRef: REF,
    inputDigest: z.string().regex(SHA256_HEX),
    outputSchemaRef: REF,
    // Attempt 1 is the first try. A bounded ceiling here mirrors the repair/retry policy.
    attempt: z.int().min(1).max(8),
    maxOutputTokens: z.int().min(1).max(200_000),
  })
  .strict();

const resultSchema = z
  .object({
    version: z.literal(1).optional(),
    requestRef: REF,
    configRef: REF,
    role: z.enum(RIYA_SYNTHETIC_ROLES),
    status: z.enum(RIYA_SYNTHETIC_INVOCATION_STATUSES),
    outputDigest: z.string().regex(SHA256_HEX).optional(),
    usage: z
      .object({
        inputTokens: COUNTER,
        outputTokens: COUNTER,
        cachedInputTokens: COUNTER,
      })
      .strict()
      .optional(),
    errorClass: z.enum(RIYA_SYNTHETIC_ERROR_CLASSES).optional(),
  })
  .strict();

/** Validate and freeze an invocation request. Throws `invalid-invocation-request`. */
export function createRiyaSyntheticInvocationRequest(
  input: RiyaSyntheticInvocationRequestInput,
): RiyaSyntheticInvocationRequestV1 {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-invocation-request');
  }
  const data = parsed.data;
  return Object.freeze({
    version: 1 as const,
    requestRef: data.requestRef,
    generationRef: data.generationRef,
    scenarioRef: data.scenarioRef,
    role: data.role,
    configRef: data.configRef,
    inputDigest: data.inputDigest,
    outputSchemaRef: data.outputSchemaRef,
    attempt: data.attempt,
    maxOutputTokens: data.maxOutputTokens,
  });
}

/**
 * Validate and freeze an invocation result. Throws `invalid-invocation-result`.
 *
 * The status and the payload must agree: SUCCESS carries a digest and no error class, and every
 * failure carries an error class and no digest. A result claiming both, or neither, is not a result —
 * it is a bug that would otherwise be recorded as evidence.
 */
export function createRiyaSyntheticInvocationResult(
  input: RiyaSyntheticInvocationResultInput,
): RiyaSyntheticInvocationResultV1 {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-invocation-result');
  }
  const data = parsed.data;
  const succeeded = data.status === 'SUCCESS';
  if (succeeded && (data.outputDigest === undefined || data.errorClass !== undefined)) {
    throw new RiyaSyntheticGenerationError('invalid-invocation-result');
  }
  if (!succeeded && (data.errorClass === undefined || data.outputDigest !== undefined)) {
    throw new RiyaSyntheticGenerationError('invalid-invocation-result');
  }
  return Object.freeze({
    version: 1 as const,
    requestRef: data.requestRef,
    configRef: data.configRef,
    role: data.role,
    status: data.status,
    ...(data.outputDigest === undefined ? {} : { outputDigest: data.outputDigest }),
    ...(data.usage === undefined ? {} : { usage: Object.freeze({ ...data.usage }) }),
    ...(data.errorClass === undefined ? {} : { errorClass: data.errorClass }),
  });
}
