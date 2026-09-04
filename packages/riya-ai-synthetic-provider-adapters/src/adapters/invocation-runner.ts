/**
 * The shared invocation lifecycle both provider adapters run (AS3A, ADR-0143 §6, §7, §23).
 *
 * ### One lifecycle, so the two families cannot drift
 *
 * Abort composition, deadline handling, refusal policy, payload bounds, usage mapping and the
 * failure-kind to AS2-error-class collapse are identical for GPT and Claude, and they are written
 * once here. Two copies would eventually disagree about something quiet — which failures are
 * retryable, whether a refusal is a malformed output — and the corpus would carry the difference.
 *
 * ### Abort: passed DOWN, never raced
 *
 * The port is explicit that an adapter must observe the signal, stop provider work as far as
 * transport permits, and SETTLE its promise afterwards, because the harness releases its concurrency
 * permit on settlement. `Promise.race` against a timer would settle the caller while the HTTP request
 * was still open — live provider calls exceeding `maxConcurrentInvocations` while the gate's own
 * numbers looked perfectly compliant. So the composed signal is handed to the transport and the
 * transport is awaited. The deadline is expressed as an abort, not as a race.
 *
 * ### A refusal fails CLOSED
 *
 * A provider that declines is not a malformed response to be repaired. Repairing it would mean asking
 * again in different words until something came back — which is gate-gaming with extra steps, and on
 * a safety decline it is the worst possible version of it. It maps to a permanent failure, and the
 * candidate fails.
 *
 * ### Nothing provider-shaped survives this function
 *
 * No header, no request id, no raw error body, no reasoning summary, no thinking block. A transport
 * hands back text, a refusal flag and three integers; everything else is dropped at the boundary
 * rather than carried inward, because inward is where artifacts are written.
 */
import {
  RIYA_SYNTHETIC_MAX_PAYLOAD_CHARS,
  createRiyaSyntheticInvocationResult,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticInvocationStatus,
  RiyaSyntheticUsageV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import {
  RiyaSyntheticProviderTransportError,
  classifyRiyaSyntheticProviderFailure,
  riyaSyntheticErrorClassFor,
} from '../contracts/provider-errors.js';
import type { RiyaSyntheticProviderFailureKind } from '../contracts/provider-errors.js';
import { sha256Hex } from '../internal/digest.js';

/** What every transport returns, whatever it talked to. Three integers and some text. */
export interface RiyaSyntheticProviderReply {
  /** The final structured output. Never a reasoning summary, never a thinking block. */
  readonly outputText: string;
  /** The provider declined. Not a transport failure, and never repaired. */
  readonly refused: boolean;
  readonly usage: RiyaSyntheticUsageV1;
}

/** Zeroes, for a failure that produced no countable usage. Reporting nothing is not reporting zero. */
export const NO_USAGE: RiyaSyntheticUsageV1 = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
});

/**
 * The size of the request that is ACTUALLY about to be sent, in UTF-8 bytes.
 *
 * Measured on the serialized body — instructions, the projected role input and the bound output
 * schema — rather than on any one part of it, because the ceiling exists to bound what crosses the
 * wire. Bytes rather than tokens: bytes are a fact this repository owns, and a token count is a
 * provider's opinion about the same string that we would have to reimplement to predict.
 */
export function riyaSyntheticRequestUtf8Bytes(body: unknown): number {
  // `JSON.stringify(undefined)` is `undefined` at runtime whatever its type says, and a byte count of
  // "nothing to send" is zero rather than a crash.
  if (body === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

const STATUS_FOR: Readonly<
  Record<RiyaSyntheticProviderFailureKind, RiyaSyntheticInvocationStatus>
> = Object.freeze({
  AUTH_OR_CONFIG: 'PROVIDER_ERROR',
  REQUEST_TOO_LARGE: 'PROVIDER_ERROR',
  RATE_LIMITED: 'PROVIDER_ERROR',
  PROVIDER_UNAVAILABLE: 'PROVIDER_ERROR',
  TRANSIENT_PROVIDER_FAILURE: 'PROVIDER_ERROR',
  PERMANENT_PROVIDER_FAILURE: 'PROVIDER_ERROR',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  MALFORMED_OUTPUT: 'MALFORMED',
});

/**
 * Told about every failure, with the PRECISE kind rather than the class AS2 will see.
 *
 * The port can only carry `TRANSIENT`/`PERMANENT`/`TIMEOUT`/`CANCELLED`/`MALFORMED_OUTPUT`, and a
 * rejected credential collapses into `PERMANENT` alongside a bad model id and an over-long input.
 * Run control needs the difference: one of those must stop the whole run, the other two must not. So
 * the finer kind is reported sideways, to an observer, rather than smuggled into the result.
 */
export type RiyaSyntheticProviderFailureObserver = (kind: RiyaSyntheticProviderFailureKind) => void;

/** A failure outcome, carrying a closed class and no digest — the shape AS2's constructor demands. */
export function riyaSyntheticFailureOutcome(
  request: RiyaSyntheticInvocationRequestV1,
  kind: RiyaSyntheticProviderFailureKind,
  usage: RiyaSyntheticUsageV1 = NO_USAGE,
): RiyaSyntheticInvocationOutcome {
  return {
    result: createRiyaSyntheticInvocationResult({
      requestRef: request.requestRef,
      configRef: request.configRef,
      role: request.role,
      status: STATUS_FOR[kind],
      usage,
      errorClass: riyaSyntheticErrorClassFor(kind),
    }),
  };
}

/**
 * Which kind a thrown value represents.
 *
 * The caller's own signal outranks the deadline: when a run is cancelled at the moment a call was
 * also about to expire, "somebody cancelled it" is the true statement, and a pilot that reported a
 * timeout there would send someone looking for a slow provider.
 */
function kindForThrown(
  error: unknown,
  callerAborted: boolean,
  deadlineElapsed: boolean,
): RiyaSyntheticProviderFailureKind {
  if (callerAborted) return 'CANCELLED';
  if (deadlineElapsed) return 'TIMEOUT';
  if (error instanceof RiyaSyntheticProviderTransportError) return error.kind;
  // A binding that threw something unclassified. Transient, because the request may never have
  // reached the provider, and because a wrong PERMANENT would abandon work a retry could complete.
  return classifyRiyaSyntheticProviderFailure({});
}

/**
 * Run one provider call and turn it into an AS2 invocation outcome.
 *
 * NEVER throws for a provider failure — the port requires a result whose status says what happened,
 * because throwing would make failure handling depend on an exception type the port cannot constrain.
 */
export async function runRiyaSyntheticProviderInvocation(
  request: RiyaSyntheticInvocationRequestV1,
  options: RiyaSyntheticInvocationOptions,
  call: (signal: AbortSignal) => Promise<RiyaSyntheticProviderReply>,
  onFailureKind?: RiyaSyntheticProviderFailureObserver,
  /** The serialized body size and its hard ceiling, when the caller enforces one. */
  size?: { readonly utf8Bytes: number; readonly maxUtf8Bytes: number },
): Promise<RiyaSyntheticInvocationOutcome> {
  const fail = (
    kind: RiyaSyntheticProviderFailureKind,
    usage?: RiyaSyntheticUsageV1,
  ): RiyaSyntheticInvocationOutcome => {
    onFailureKind?.(kind);
    return riyaSyntheticFailureOutcome(request, kind, usage);
  };

  // Read through a function. `aborted` is a value that CHANGES, and TypeScript narrows it after the
  // check below -- so the re-read in the catch would be treated as impossible and eliminated. The
  // call defeats that narrowing, which is the difference between reporting a cancellation and
  // reporting whatever the socket error happened to look like.
  const callerAborted = (): boolean => options.signal?.aborted === true;

  // Already cancelled before we started. Spending a call on a run somebody stopped is exactly the
  // waste the re-check exists to prevent.
  if (callerAborted()) {
    return fail('CANCELLED');
  }

  // HARD, and checked on the bytes that were just built rather than on an estimate of them. Refused
  // BEFORE a transport is touched, so an over-large request costs nothing at all.
  if (size !== undefined && size.utf8Bytes > size.maxUtf8Bytes) {
    return fail('REQUEST_TOO_LARGE');
  }

  const deadline = AbortSignal.timeout(options.timeoutMs);
  const composed =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);

  let reply: RiyaSyntheticProviderReply;
  try {
    // AWAITED, not raced. The permit is released on this settling, so settling early would be a lie
    // about what is still in flight.
    reply = await call(composed);
  } catch (error) {
    return fail(kindForThrown(error, callerAborted(), deadline.aborted));
  }

  if (reply.refused) {
    return fail('PERMANENT_PROVIDER_FAILURE', reply.usage);
  }

  // Bounded BEFORE it is treated as a payload. A model that returned megabytes is a failure, and
  // discovering that after digesting it is discovering it too late. Empty is a failure too: there is
  // nothing for the parser to reject, so nothing downstream would notice.
  if (reply.outputText.length === 0 || reply.outputText.length > RIYA_SYNTHETIC_MAX_PAYLOAD_CHARS) {
    return fail('MALFORMED_OUTPUT', reply.usage);
  }

  return {
    result: createRiyaSyntheticInvocationResult({
      requestRef: request.requestRef,
      configRef: request.configRef,
      role: request.role,
      status: 'SUCCESS',
      // The DIGEST of what came back. The text goes to the parser as an untrusted payload and never
      // into the envelope that ends up in an artifact.
      outputDigest: sha256Hex(reply.outputText),
      usage: reply.usage,
    }),
    payload: reply.outputText,
  };
}
