import { CONTROL_PLANE_READ_CONTRACT_VERSION } from '@qf-jarvis/control-plane-read-contract';

/**
 * Response construction for the read-only route (JOS-01B, ADR-0086).
 *
 * Kept out of the route file so the headers are one reviewable list rather than something spread
 * through a handler, and so the failure body is written once — the place where a leak would
 * otherwise be easiest to introduce later.
 */

/**
 * Headers every response carries.
 *
 * - `no-store`: a control-plane reading must never be served from a cache. A stale snapshot that
 *   still says "connected" is worse than no snapshot, and this route is cheap to recompute.
 * - `nosniff`: the body is JSON and must never be content-sniffed into something executable.
 * - `X-Control-Plane-Contract-Version`: lets a client detect a version mismatch from the headers
 *   without parsing a body it may not understand.
 * - `Referrer-Policy: same-origin`: one policy across the whole application, matching
 *   `SECURITY_HEADERS` in the proxy. It is inert on a JSON response — there is no browsing context
 *   here to navigate from — but a second, stricter value would leave the codebase asserting two
 *   different referrer policies, and the next reader would have to work out which one governs the
 *   login form. The proxy comment records why that value is `same-origin` and not `no-referrer`.
 * - There is NO `Access-Control-Allow-Origin`. Not a wildcard, not an echo of `Origin` — none at
 *   all, so no cross-origin page can read this. JOS-01C adds authentication; until then the
 *   correct CORS policy is silence.
 */
export const READ_ONLY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Control-Plane-Contract-Version': CONTROL_PLANE_READ_CONTRACT_VERSION,
});

/**
 * The single failure body.
 *
 * Fixed text, no error code from the thrown value, no message, no stack, no field paths. A caller
 * learns that the snapshot could not be produced and nothing about why — the "why" belongs in a
 * server log, not in a response that will one day be reachable over a network.
 */
export const FAILURE_BODY = Object.freeze({
  error: 'control-plane-snapshot-unavailable',
  message: 'The control-plane snapshot could not be produced.',
});

/**
 * Query parameters are not a data-access mechanism here.
 *
 * The route takes no filters, no ids and no pagination, so ANY query parameter is a caller
 * misunderstanding worth failing on rather than silently ignoring. Ignoring unknown parameters is
 * how `?tenant=other` quietly becomes a supported feature that was never designed: rejecting is
 * the behaviour that stays correct when the route later grows an authenticated scope.
 */
/**
 * The unauthenticated body (JOS-01C).
 *
 * One fixed shape for every unauthenticated case. It does not distinguish "no cookie" from
 * "expired" from "tampered", because each of those is a fact an attacker would like to have and
 * none of them helps a legitimate operator, who simply signs in again.
 */
export const UNAUTHENTICATED_BODY = Object.freeze({
  error: 'unauthenticated',
  message: 'An authenticated operator session is required.',
});

export const UNSUPPORTED_QUERY_BODY = Object.freeze({
  error: 'unsupported-query-parameter',
  message: 'This endpoint accepts no query parameters.',
});
