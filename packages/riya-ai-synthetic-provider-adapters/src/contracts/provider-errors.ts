/**
 * The provider-neutral failure taxonomy (AS3A, ADR-0143 §23).
 *
 * ### Why a second taxonomy exists beside AS2's
 *
 * AS2's `RiyaSyntheticErrorClass` is what an INVOCATION RESULT may carry: `TRANSIENT`, `PERMANENT`,
 * `TIMEOUT`, `CANCELLED`, `MALFORMED_OUTPUT`. That is the right vocabulary for a candidate, because a
 * candidate only ever needs to know whether the attempt may be retried.
 *
 * A real run needs three distinctions that vocabulary deliberately does not draw, and needs them
 * BEFORE the mapping collapses them:
 *
 * - **auth/config** must stop the WHOLE run. Retrying a bad key across two hundred candidates is the
 *   one failure mode that spends real money to learn nothing.
 * - **rate limit** is transient but says something different about pacing than a 500 does, and a
 *   pilot's usage report is where that shows up.
 * - **provider unavailable** is transient too, but distinguishes "their side is down" from "this
 *   request failed", which is what a stop-or-continue decision turns on.
 *
 * So the richer kind is classified at the transport boundary, used for run control and the usage
 * report, and then MAPPED DOWN to AS2's closed class for the invocation result. Nothing widens: AS2's
 * taxonomy is untouched, and no new code reaches an artifact.
 *
 * ### It is a kind, never a message
 *
 * Classification takes an HTTP status and two booleans. It never takes, stores or forwards a provider
 * error body -- that text can carry a request id, an account hint, an internal URL or a truncated
 * prompt, and the whole point of a closed code is that none of that can reach a log or an artifact.
 */
import type { RiyaSyntheticErrorClass } from '@qf-jarvis/riya-ai-synthetic-generation';

export const RIYA_SYNTHETIC_PROVIDER_FAILURE_KINDS = [
  'AUTH_OR_CONFIG',
  /**
   * The serialized request exceeded the budget's hard byte ceiling.
   *
   * Not a provider failure at all — it never reached one. It is here rather than in the pilot
   * taxonomy because it has to travel back through the invocation port, and the port carries closed
   * provider kinds. It maps to PERMANENT: asking again with the same oversized body would spend the
   * same money for the same answer.
   */
  'REQUEST_TOO_LARGE',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TRANSIENT_PROVIDER_FAILURE',
  'PERMANENT_PROVIDER_FAILURE',
  'TIMEOUT',
  'CANCELLED',
  'MALFORMED_OUTPUT',
] as const;
export type RiyaSyntheticProviderFailureKind =
  (typeof RIYA_SYNTHETIC_PROVIDER_FAILURE_KINDS)[number];

/** A transport failure reduced to a closed kind. Carries no provider text, by construction. */
export class RiyaSyntheticProviderTransportError extends Error {
  readonly kind: RiyaSyntheticProviderFailureKind;

  constructor(kind: RiyaSyntheticProviderFailureKind) {
    // The message is derived from the KIND, never from the provider. A provider body would put a
    // request id or an account hint into every stack trace that crossed a log.
    super(`Provider transport failed: ${kind}`);
    this.name = 'RiyaSyntheticProviderTransportError';
    this.kind = kind;
  }
}

export interface ProviderFailureSignals {
  /** The HTTP status, when the failure carried one. */
  readonly status?: number;
  /** The caller's signal aborted, or the SDK reported a user abort. */
  readonly aborted?: boolean;
  /** The per-invocation deadline elapsed. */
  readonly timedOut?: boolean;
}

/**
 * Classify a transport failure from signals only.
 *
 * Pure, provider-neutral and total, so both SDK bindings share one classification and it can be
 * tested without a network, an SDK error object or a credential.
 *
 * Order matters. Cancellation outranks a deadline: when a caller aborts a call that was also about to
 * time out, the honest answer is that somebody cancelled it. Both outrank a status, because an
 * aborted request can still surface as a socket error carrying one.
 */
export function classifyRiyaSyntheticProviderFailure(
  signals: ProviderFailureSignals,
): RiyaSyntheticProviderFailureKind {
  if (signals.aborted === true) return 'CANCELLED';
  if (signals.timedOut === true) return 'TIMEOUT';

  const status = signals.status;
  if (status === undefined) {
    // No status at all is a connection-level failure: DNS, TLS, a dropped socket. Transient, because
    // the request may never have reached the provider.
    return 'TRANSIENT_PROVIDER_FAILURE';
  }
  if (status === 401 || status === 403) return 'AUTH_OR_CONFIG';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408) return 'TIMEOUT';
  if (status === 503 || status === 502 || status === 504) return 'PROVIDER_UNAVAILABLE';
  if (status >= 500) return 'TRANSIENT_PROVIDER_FAILURE';
  // 400, 404, 413, 422 and friends. The request itself is wrong -- a bad model id, an unsupported
  // parameter, an over-long input. Retrying it unchanged spends money to get the same answer.
  return 'PERMANENT_PROVIDER_FAILURE';
}

/** True when this kind must stop the entire run rather than fail one candidate. */
export function riyaSyntheticFailureStopsRun(kind: RiyaSyntheticProviderFailureKind): boolean {
  return kind === 'AUTH_OR_CONFIG';
}

/** True when a bounded retry is meaningful. A permanent failure is not retried, ever. */
export function riyaSyntheticFailureIsRetryable(kind: RiyaSyntheticProviderFailureKind): boolean {
  return (
    kind === 'RATE_LIMITED' ||
    kind === 'PROVIDER_UNAVAILABLE' ||
    kind === 'TRANSIENT_PROVIDER_FAILURE'
  );
}

/**
 * Collapse a provider kind onto the AS2 class an invocation result may carry.
 *
 * Auth/config maps to `PERMANENT` rather than `TRANSIENT`: it must never be retried by the candidate
 * loop, because the run itself is being stopped for it a level up.
 */
export function riyaSyntheticErrorClassFor(
  kind: RiyaSyntheticProviderFailureKind,
): RiyaSyntheticErrorClass {
  switch (kind) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'MALFORMED_OUTPUT':
      return 'MALFORMED_OUTPUT';
    case 'RATE_LIMITED':
    case 'PROVIDER_UNAVAILABLE':
    case 'TRANSIENT_PROVIDER_FAILURE':
      return 'TRANSIENT';
    case 'AUTH_OR_CONFIG':
    case 'PERMANENT_PROVIDER_FAILURE':
    case 'REQUEST_TOO_LARGE':
      return 'PERMANENT';
  }
}
