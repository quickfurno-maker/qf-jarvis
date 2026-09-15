/**
 * The ONE bounded network seam for authenticated Nara model discovery.
 *
 * ### Why the I/O is here and the rules are next door
 *
 * `nara-model-discovery.ts` stays pure: parse, filter, shortlist, score. Every rule that decides
 * anything can therefore be asserted against recorded payloads with no network at all. This file holds
 * the part that genuinely cannot be pure — one HTTP GET — behind an injected transport, so the same
 * separation survives into the executable.
 *
 * ### What the transport is NOT allowed to be
 *
 * Not the chat transport. Nara's chat path already exists in `@qf-jarvis/model-gateway` and is reached
 * only through the gateway; a second HTTP client that could reach the same host with the same key is
 * exactly the "second provider router" this lane is forbidden to create. This seam does one GET against
 * one fixed URL and can do nothing else.
 *
 * ### The bounds, and why each one is refused rather than clamped
 *
 * A redirect is refused rather than followed: a 302 is the endpoint telling us to send the credential
 * somewhere the code did not pin. An oversized body is refused rather than truncated: a truncated JSON
 * list is a list we would be guessing at. A timeout is a failure, not a reason to try again — there is
 * no retry here, and a person may start a NEW run after reading the failure.
 */
import type { NaraApiKey } from '@qf-jarvis/model-gateway';

import {
  MAX_DISCOVERY_PAGES,
  MAX_DISCOVERY_RESPONSE_BYTES,
  NARA_MODELS_ENDPOINT,
} from './nara-model-discovery.js';

/** The bounded timeout for one discovery call. */
export const DISCOVERY_TIMEOUT_MS = 20_000;

/** What a transport hands back. Deliberately bytes-and-status, never a parsed object. */
export interface DiscoveryHttpResponse {
  readonly status: number;
  /** Present only for a redirect, so the seam can REFUSE it by name rather than silently follow. */
  readonly redirected: boolean;
  readonly bodyBytes: number;
  readonly bodyText: string;
}

/**
 * One GET, injected.
 *
 * Production supplies a `fetch`-backed implementation with `redirect: 'manual'`; tests supply a
 * deterministic fake. The signature carries no URL because the URL is fixed in code: a transport that
 * could be pointed elsewhere is a transport that could send the credential elsewhere.
 */
export interface NaraDiscoveryTransport {
  get(request: {
    readonly authorization: string;
    readonly timeoutMs: number;
    readonly maxBytes: number;
  }): Promise<DiscoveryHttpResponse>;
}

export const DISCOVERY_FAILURES = [
  'discovery-redirect-refused',
  'discovery-unauthorized',
  'discovery-http-error',
  'discovery-response-too-large',
  'discovery-invalid-json',
  'discovery-transport-failed',
  'discovery-budget-exhausted',
  'discovery-page-limit',
] as const;
export type DiscoveryFailure = (typeof DISCOVERY_FAILURES)[number];

export type DiscoveryFetchResult =
  | { readonly ok: true; readonly payload: unknown; readonly calls: number }
  | { readonly ok: false; readonly failure: DiscoveryFailure; readonly calls: number };

/** Reserve one call before making it. Supplied by the run's ledger so the ceiling is real. */
export type ReserveCall = () => boolean;

/**
 * Perform the ONE bounded authenticated discovery call and hand the raw payload to the pure parser.
 *
 * Returns the payload, never a decision. What the payload means is `parseNaraModelDiscovery`'s job, and
 * keeping those apart is what stops a network error from being mistaken for an empty catalogue.
 */
export async function fetchNaraModelCatalogue(
  transport: NaraDiscoveryTransport,
  apiKey: NaraApiKey,
  reserve: ReserveCall,
): Promise<DiscoveryFetchResult> {
  if (!reserve()) {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-budget-exhausted' as const,
      calls: 0,
    });
  }

  let response: DiscoveryHttpResponse;
  try {
    response = await transport.get({
      // The holder builds the header itself: this seam never sees the secret, only the value the
      // provider's own accessor produces, and it puts that straight into the request.
      authorization: apiKey.authorizationHeaderValue(),
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBytes: MAX_DISCOVERY_RESPONSE_BYTES,
    });
  } catch {
    // The underlying error is discarded: a transport error can quote the request, headers included.
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-transport-failed' as const,
      calls: 1,
    });
  }

  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-redirect-refused' as const,
      calls: 1,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-unauthorized' as const,
      calls: 1,
    });
  }
  if (response.status !== 200) {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-http-error' as const,
      calls: 1,
    });
  }
  if (response.bodyBytes > MAX_DISCOVERY_RESPONSE_BYTES) {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-response-too-large' as const,
      calls: 1,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.bodyText);
  } catch {
    return Object.freeze({
      ok: false as const,
      failure: 'discovery-invalid-json' as const,
      calls: 1,
    });
  }
  return Object.freeze({ ok: true as const, payload, calls: 1 });
}

/** The fixed URL and page ceiling, re-exported so a composition root cannot supply its own. */
export { MAX_DISCOVERY_PAGES, NARA_MODELS_ENDPOINT };
