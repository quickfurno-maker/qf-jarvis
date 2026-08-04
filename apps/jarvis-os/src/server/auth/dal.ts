import { cookies } from 'next/headers';

import { loadAuthConfig } from './config/loader';
import type { AuthConfigV1 } from './config/schema';
import { AuthFailure } from './errors';
import { sessionCookieName } from './session/cookie';
import { openSession } from './session/token';
import type { SessionClaims } from './session/token';

/**
 * The secure Data Access Layer (JOS-01C, ADR-0087).
 *
 * ### Every protected surface verifies here, and Proxy is never the only check
 *
 * The Next.js proxy runs before routing and is an OPTIMISTIC gate: it sees a cookie, it does not
 * decrypt it. That is the correct division — a per-request AES-GCM decrypt plus a config read in
 * the edge path would be wasteful, and the proxy cannot be the authority anyway because a route
 * reachable by any path that skips it would be unprotected.
 *
 * So the protected layout calls `requireOperatorSession()` and the snapshot route calls
 * `requireApiOperatorSession()`, independently, close to the data. If the proxy were deleted
 * tomorrow, every protected surface would still be closed. The tests assert exactly that by
 * invoking the route handler directly, with no proxy in the picture.
 *
 * ### Nothing here trusts a request header for identity
 *
 * There is no "the proxy already checked, read `x-operator-id`" path. A header set by a trusted
 * component is indistinguishable, at the point of use, from a header set by a client — and that
 * confusion is a recurring source of complete authentication bypasses.
 */

/** What a client component may see. No token, no session id, no CSRF, no key id, no revision. */
export interface OperatorSessionView {
  readonly operatorId: string;
  readonly displayName: string;
  readonly role: 'OWNER';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** The server-side view. Adds the CSRF token, which only the logout form may embed. */
export interface OperatorSession {
  readonly view: OperatorSessionView;
  readonly csrfToken: string;
  readonly config: AuthConfigV1;
}

/** Injected clock, so session-expiry behaviour is testable without waiting an hour. */
export type NowSeconds = () => number;

export const systemNowSeconds: NowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Read and verify the session, returning `undefined` rather than throwing when there is none.
 *
 * Used where "not signed in" is an expected branch — the login page redirecting an already
 * authenticated operator away, for instance.
 */
export async function getOptionalOperatorSession(
  now: NowSeconds = systemNowSeconds,
): Promise<OperatorSession | undefined> {
  let config: AuthConfigV1;
  try {
    config = loadAuthConfig();
  } catch {
    // Configuration unavailable is not "signed in". Fail closed and let the caller decide how to
    // present it; never fall back to an unauthenticated-but-permitted state.
    return undefined;
  }

  const store = await cookies();
  const raw = store.get(sessionCookieName(config.mode))?.value;
  if (raw === undefined || raw === '') {
    return undefined;
  }

  try {
    const claims = openSession({ token: raw, config, nowSeconds: now() });
    return freezeSession(claims, config);
  } catch {
    return undefined;
  }
}

/**
 * Require a session, throwing a generic failure when absent or invalid.
 *
 * Callers that render a page catch this and redirect; callers that serve JSON catch it and return
 * 401. Neither branch reports WHY, so an expired token and a forged one are indistinguishable.
 */
export async function requireOperatorSession(
  now: NowSeconds = systemNowSeconds,
): Promise<OperatorSession> {
  const config = loadAuthConfig();
  const store = await cookies();
  const raw = store.get(sessionCookieName(config.mode))?.value;
  if (raw === undefined || raw === '') {
    throw new AuthFailure('session-absent');
  }
  const claims = openSession({ token: raw, config, nowSeconds: now() });
  return freezeSession(claims, config);
}

/**
 * The API variant.
 *
 * Identical verification; it exists as its own name so a reader of the snapshot route can see that
 * the route authenticates itself rather than inheriting a guarantee from somewhere else.
 */
export async function requireApiOperatorSession(
  now: NowSeconds = systemNowSeconds,
): Promise<OperatorSession> {
  return await requireOperatorSession(now);
}

/**
 * Build the frozen session.
 *
 * `displayName` is read from the CURRENT configuration rather than carried in the token. Renaming
 * the operator in the config then takes effect immediately, and the token stays smaller and
 * carries one less thing worth stealing.
 */
function freezeSession(claims: Readonly<SessionClaims>, config: AuthConfigV1): OperatorSession {
  return Object.freeze({
    view: Object.freeze({
      operatorId: claims.operatorId,
      displayName: config.operator.displayName,
      role: 'OWNER' as const,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    }),
    csrfToken: claims.csrfToken,
    config,
  });
}
