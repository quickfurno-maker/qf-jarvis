/**
 * The PASSIVE candidate transport observation layer (MVP-P2A.2 HF4-R4).
 *
 * ### The gap RUN S5 left
 *
 * S5 reached the provider ten times. Nine of those were ordinary MODEL_REQUIRED calls and all nine
 * came back as `gatewayErrorCode=provider-failed`, which is where the diagnosis stopped. That code is
 * the gateway's own closed vocabulary and it is honest, but it is also the terminus of a funnel: the
 * Groq normalization already collapses 400, 401, 403, 404, 413, 422 and every unexpected 4xx into one
 * `failed` status, and the gateway then reports all of them as `provider-failed`. An owner reading the
 * receipt could not tell a rejected request from a revoked key from a model the project is not
 * entitled to — three findings with three completely different next actions.
 *
 * So the run spent its one live authorization proving that something went wrong ten times, and could
 * not say what.
 *
 * ### Why an observer rather than a wider error vocabulary
 *
 * Widening `ModelGatewayErrorCode` would push a live-evidence concern into the gateway's public
 * contract, where every serving caller would inherit it. The narrower fix is the seam that already
 * exists: `GroqTransport` is one method, `createFetchGroqTransport()` is injectable, and this package
 * already wraps it once for cancellation. This wraps it again, records four content-free facts, and
 * delegates the same request and the same signal, unmodified.
 *
 * It is PASSIVE in the strict sense. It sends nothing, rewrites nothing, retries nothing, cancels
 * nothing and swallows nothing: a response is returned unchanged and a throw is rethrown unchanged, so
 * the gateway's normalization, the ledger, the safety verdict and the accounting all see exactly what
 * they saw before this file existed.
 *
 * ### What content-free means here, precisely
 *
 * Four values leave this module: a boolean, a bounded integer status, and two members of closed
 * allowlists. The response body is read for exactly two keys, compared against a reviewed literal
 * table, and discarded in the same expression. `error.message`, `failed_generation`, the request body,
 * the headers, the credential, the endpoint and any thrown object are never read, never stored and
 * never returned — a hostile provider body cannot put a single byte of itself into a diagnostic,
 * because there is no field for it to occupy.
 */
import type { GroqTransport } from '@qf-jarvis/model-gateway';

/**
 * How the ONE provider request for a case ended, at the transport boundary.
 *
 * `NOT_REACHED` and `NONE` are different facts and the distinction is load-bearing: `NOT_REACHED`
 * means the boundary was never crossed (a pre-model case, or a gateway that refused before sending),
 * while `NONE` means it WAS crossed and never settled — the request left and nothing came back. A
 * single "unknown" would merge a boundary that held with a request that vanished.
 */
export const CANDIDATE_PROVIDER_HTTP_CLASSES = [
  'NONE',
  'SUCCESS_2XX',
  'BAD_REQUEST_400',
  'UNAUTHORIZED_401',
  'FORBIDDEN_403',
  'NOT_FOUND_404',
  'PAYLOAD_TOO_LARGE_413',
  'UNPROCESSABLE_422',
  'RATE_LIMITED_429',
  'CAPACITY_498',
  'CANCELLED_499',
  'SERVER_5XX',
  'OTHER_HTTP',
  'TRANSPORT_THROW',
  'NOT_REACHED',
] as const;

export type CandidateProviderHttpClass = (typeof CANDIDATE_PROVIDER_HTTP_CLASSES)[number];

/**
 * The error FAMILY, from the reviewed allowlist only.
 *
 * `OTHER_OR_ABSENT` is deliberately one value rather than two. "The envelope named a family we do not
 * recognise" and "the envelope named no family" are both "we cannot say", and inventing a third token
 * would imply this module had read enough to tell them apart — which is exactly what it refuses to do.
 */
export const CANDIDATE_PROVIDER_ERROR_TYPES = [
  'NONE',
  'INVALID_REQUEST_ERROR',
  'PERMISSIONS_ERROR',
  'OTHER_OR_ABSENT',
] as const;

export type CandidateProviderErrorType = (typeof CANDIDATE_PROVIDER_ERROR_TYPES)[number];

/** The closed provider error codes worth recognising by name. Everything else is `OTHER_OR_ABSENT`. */
export const CANDIDATE_PROVIDER_ERROR_CODES = [
  'NONE',
  'JSON_VALIDATE_FAILED',
  'BLOCKED_API_ACCESS',
  'MODEL_PERMISSION_BLOCKED_ORG',
  'MODEL_PERMISSION_BLOCKED_PROJECT',
  'OTHER_OR_ABSENT',
] as const;

export type CandidateProviderErrorCode = (typeof CANDIDATE_PROVIDER_ERROR_CODES)[number];

/** What one real provider invocation did at the transport boundary. Four facts, nothing else. */
export interface CandidateTransportObservation {
  readonly providerTransportStarted: boolean;
  /** The exact HTTP status, bounded to 100-599. `0` means no status was ever received. */
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
}

/**
 * The observation for a case that never reached the boundary.
 *
 * The DEFAULT, deliberately. A case with no observation reports "the provider was never reached"
 * rather than inheriting whatever the previous case saw, which is the leak this default closes by
 * construction rather than by care.
 */
export const NOT_REACHED_TRANSPORT_OBSERVATION: CandidateTransportObservation = Object.freeze({
  providerTransportStarted: false,
  providerHttpStatus: 0,
  providerHttpClass: 'NOT_REACHED',
  providerErrorType: 'NONE',
  providerErrorCode: 'NONE',
});

/** The boundary was crossed and has not settled yet. Replaced in place once it does. */
const STARTED_TRANSPORT_OBSERVATION: CandidateTransportObservation = Object.freeze({
  providerTransportStarted: true,
  providerHttpStatus: 0,
  providerHttpClass: 'NONE',
  providerErrorType: 'NONE',
  providerErrorCode: 'NONE',
});

/** The request left and the transport rejected. The thrown object itself is never inspected. */
const THROWN_TRANSPORT_OBSERVATION: CandidateTransportObservation = Object.freeze({
  providerTransportStarted: true,
  providerHttpStatus: 0,
  providerHttpClass: 'TRANSPORT_THROW',
  providerErrorType: 'NONE',
  providerErrorCode: 'NONE',
});

/**
 * The largest body this module will attempt to parse.
 *
 * The transport already bounds the body, so this is a second, much tighter bound applied purely for
 * the mapping step: a real Groq error envelope is a few hundred bytes, and anything approaching this
 * size is not one. Past the bound nothing is parsed and the outcome is `OTHER_OR_ABSENT`, which is the
 * honest answer rather than a best effort over a megabyte of unknown bytes.
 */
export const MAX_OBSERVED_ERROR_BODY_BYTES = 65_536;

/** The reviewed error families. A plain object read through `hasOwnProperty`, never by index. */
const RECOGNISED_ERROR_TYPES: Readonly<Record<string, CandidateProviderErrorType>> = Object.freeze({
  invalid_request_error: 'INVALID_REQUEST_ERROR',
  permissions_error: 'PERMISSIONS_ERROR',
});

/** The reviewed error codes. Same lookup discipline, same reason. */
const RECOGNISED_ERROR_CODES: Readonly<Record<string, CandidateProviderErrorCode>> = Object.freeze({
  json_validate_failed: 'JSON_VALIDATE_FAILED',
  blocked_api_access: 'BLOCKED_API_ACCESS',
  model_permission_blocked_org: 'MODEL_PERMISSION_BLOCKED_ORG',
  model_permission_blocked_project: 'MODEL_PERMISSION_BLOCKED_PROJECT',
});

/**
 * Map an HTTP status onto the closed class vocabulary.
 *
 * The families are the ones Groq's own documentation accounts for. Note that this is a NAMING of what
 * happened, not a re-classification: `normalizeGroqHttpStatus` still decides what the gateway does
 * with the status, and nothing here changes retryability, cancellation or any provider result.
 */
export function classifyProviderHttpStatus(status: number): CandidateProviderHttpClass {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return 'OTHER_HTTP';
  }
  if (status >= 200 && status <= 299) {
    return 'SUCCESS_2XX';
  }
  if (status >= 500 && status <= 599) {
    return 'SERVER_5XX';
  }
  switch (status) {
    case 400:
      return 'BAD_REQUEST_400';
    case 401:
      return 'UNAUTHORIZED_401';
    case 403:
      return 'FORBIDDEN_403';
    case 404:
      return 'NOT_FOUND_404';
    case 413:
      return 'PAYLOAD_TOO_LARGE_413';
    case 422:
      return 'UNPROCESSABLE_422';
    case 429:
      return 'RATE_LIMITED_429';
    case 498:
      return 'CAPACITY_498';
    case 499:
      return 'CANCELLED_499';
    default:
      return 'OTHER_HTTP';
  }
}

/** A status is retained only when it is a real integer HTTP status. Anything else records `0`. */
function boundedStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

/**
 * Read AT MOST two keys out of an error envelope and map them onto reviewed literals.
 *
 * The parsed value is scoped to this function and never escapes it. Only `error.type` / `error.code`
 * — and the top-level `code`, which some envelopes use — are consulted, and only by exact match
 * against the two tables above. `message`, `failed_generation`, request identifiers, nested payloads
 * and every unrecognised key are neither read nor retained.
 */
function mapErrorEnvelope(bodyText: string): {
  readonly errorType: CandidateProviderErrorType;
  readonly errorCode: CandidateProviderErrorCode;
} {
  const absent = { errorType: 'OTHER_OR_ABSENT', errorCode: 'OTHER_OR_ABSENT' } as const;
  if (bodyText.length > MAX_OBSERVED_ERROR_BODY_BYTES) {
    return absent;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return absent;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return absent;
  }
  const envelope = parsed as Record<string, unknown>;
  const error: unknown = envelope['error'];
  const nested =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : envelope;
  const rawType: unknown = nested['type'];
  const rawCode: unknown = nested['code'];
  // `hasOwnProperty`, never a bare index: a body naming `constructor` or `__proto__` would otherwise
  // reach an inherited member and produce a token nobody reviewed.
  const errorType =
    typeof rawType === 'string' &&
    Object.prototype.hasOwnProperty.call(RECOGNISED_ERROR_TYPES, rawType)
      ? RECOGNISED_ERROR_TYPES[rawType]
      : undefined;
  const errorCode =
    typeof rawCode === 'string' &&
    Object.prototype.hasOwnProperty.call(RECOGNISED_ERROR_CODES, rawCode)
      ? RECOGNISED_ERROR_CODES[rawCode]
      : undefined;
  return {
    errorType: errorType ?? 'OTHER_OR_ABSENT',
    errorCode: errorCode ?? 'OTHER_OR_ABSENT',
  };
}

/** Build the observation for a settled response. The body is consumed here and goes no further. */
export function observeProviderResponse(
  status: number,
  bodyText: string,
): CandidateTransportObservation {
  const httpClass = classifyProviderHttpStatus(status);
  if (httpClass === 'SUCCESS_2XX') {
    // A success has no error envelope to read, so the body is not parsed at all.
    return Object.freeze({
      providerTransportStarted: true,
      providerHttpStatus: boundedStatus(status),
      providerHttpClass: httpClass,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
    });
  }
  const mapped = mapErrorEnvelope(bodyText);
  return Object.freeze({
    providerTransportStarted: true,
    providerHttpStatus: boundedStatus(status),
    providerHttpClass: httpClass,
    providerErrorType: mapped.errorType,
    providerErrorCode: mapped.errorCode,
  });
}

/**
 * The run-local observation recorder.
 *
 * `duringCase` is the CLAIM: it opens a window for exactly one case, and any boundary crossing inside
 * that window belongs to that case. Nothing infers attribution from ordering, from a case identifier,
 * or from the gateway's concurrency setting — the candidate gateway happens to run one request at a
 * time today, and an assumption that is true by configuration is one configuration change away from
 * silently misattributing every row.
 */
export interface CandidateTransportObservations {
  /** Wrap a transport so its outcomes are recorded. Returns a transport, changes no behaviour. */
  readonly observe: (underlying: GroqTransport) => GroqTransport;
  /** Run one case's provider invocation inside its own attribution window. */
  readonly duringCase: <T>(caseId: string, run: () => Promise<T>) => Promise<T>;
  /** This case's observation, or `NOT_REACHED` when the boundary was never crossed for it. */
  readonly observationFor: (caseId: string) => CandidateTransportObservation;
  /** How many boundary crossings were attributed to this case. Exactly one per real invocation. */
  readonly observationCountFor: (caseId: string) => number;
  /** Crossings that happened with no window open. Attributed to nobody, counted for everybody. */
  readonly unattributedObservations: () => number;
  /** Windows that overlapped. Any overlap suspends attribution rather than guessing. */
  readonly overlappingCaseWindows: () => number;
}

export function createCandidateTransportObservations(): CandidateTransportObservations {
  const perCase = new Map<string, CandidateTransportObservation>();
  const counts = new Map<string, number>();
  let active: string | undefined;
  let openWindows = 0;
  let unattributed = 0;
  let overlapping = 0;

  const observe = (underlying: GroqTransport): GroqTransport =>
    Object.freeze({
      send: async (
        request: Parameters<GroqTransport['send']>[0],
        signal: AbortSignal,
      ): ReturnType<GroqTransport['send']> => {
        // Captured at ENTRY. Settlement then lands on the case whose window was open when the request
        // left, even if the window has since closed — which is what makes a late settlement a fact
        // about the right case rather than a stale value the next case could inherit.
        const target = active;
        if (target === undefined) {
          unattributed += 1;
        } else {
          perCase.set(target, STARTED_TRANSPORT_OBSERVATION);
          counts.set(target, (counts.get(target) ?? 0) + 1);
        }
        try {
          const response = await underlying.send(request, signal);
          if (target !== undefined) {
            perCase.set(target, observeProviderResponse(response.status, response.bodyText));
          }
          // The SAME response object, unchanged. This seam observes; it does not answer.
          return response;
        } catch (error: unknown) {
          if (target !== undefined) {
            perCase.set(target, THROWN_TRANSPORT_OBSERVATION);
          }
          // Rethrown unchanged, so the gateway's own normalization sees exactly what it always saw.
          throw error;
        }
      },
    });

  return Object.freeze({
    observe,
    duringCase: async <T>(caseId: string, run: () => Promise<T>): Promise<T> => {
      openWindows += 1;
      if (openWindows === 1) {
        active = caseId;
      } else {
        // Two windows at once. Attribution is no longer PROVABLE, so it is refused for the whole
        // overlap: both cases keep `NOT_REACHED` and the ambiguity is reported as a number rather
        // than resolved by a guess that would be right most of the time.
        overlapping += 1;
        active = undefined;
      }
      try {
        return await run();
      } finally {
        openWindows -= 1;
        // Cleared unconditionally at the last close. A window that stayed open would let the NEXT
        // case's crossing be written to the previous case's slot, which is the leak this closes.
        if (openWindows === 0) {
          active = undefined;
        }
      }
    },
    observationFor: (caseId: string) => perCase.get(caseId) ?? NOT_REACHED_TRANSPORT_OBSERVATION,
    observationCountFor: (caseId: string) => counts.get(caseId) ?? 0,
    unattributedObservations: () => unattributed,
    overlappingCaseWindows: () => overlapping,
  });
}
