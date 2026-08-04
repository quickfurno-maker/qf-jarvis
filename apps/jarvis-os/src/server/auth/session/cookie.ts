import type { AuthConfigV1 } from '../config/schema';

/**
 * Session cookie policy (JOS-01C, ADR-0087).
 *
 * ### `__Host-` in production, and a different name outside it
 *
 * The `__Host-` prefix is a browser-enforced contract: the cookie MUST be `Secure`, MUST have
 * `Path=/`, and MUST NOT have a `Domain`. A subdomain cannot set it, so a compromised
 * `anything.example.com` cannot plant a session for the control plane. It is the strongest
 * cookie-integrity guarantee available without any server cooperation, which is exactly why it is
 * mandatory in production rather than recommended.
 *
 * Local development uses a DIFFERENT name. That is deliberate: `__Host-` requires `Secure`, and a
 * loopback HTTP origin cannot set a `Secure` cookie, so a shared name would either fail silently
 * or tempt someone to drop the prefix in production "because it works locally". Two names make the
 * production rule unconditional.
 *
 * ### No `Max-Age`, no `Expires`
 *
 * The cookie is a session cookie in the browser sense: it dies when the browser session ends. The
 * SERVER enforces absolute expiry through the token's own `expiresAt`, so a browser that keeps the
 * cookie longer gains nothing. There is no "remember me" and no sliding refresh in this phase —
 * both are real features with real risks, and inventing them here would be guesswork.
 */

export const PRODUCTION_COOKIE_NAME = '__Host-qfj-jos-session' as const;
export const DEVELOPMENT_COOKIE_NAME = 'qfj-jos-session-dev' as const;

export function sessionCookieName(mode: AuthConfigV1['mode']): string {
  return mode === 'PRODUCTION' ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
}

/** Loopback hosts. A LOCAL_DEVELOPMENT cookie is refused anywhere else. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (host === null || host === undefined || host === '') {
    return false;
  }
  // Strip a port; keep IPv6 brackets in mind (`[::1]:3000`).
  const withoutPort = host.startsWith('[')
    ? (host.split(']')[0] ?? '') + ']'
    : (host.split(':')[0] ?? '');
  return (
    withoutPort === 'localhost' ||
    withoutPort === '127.0.0.1' ||
    withoutPort === '[::1]' ||
    withoutPort === '::1'
  );
}

export interface CookieAttributes {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'strict';
  readonly path: '/';
  readonly maxAge?: number;
}

/**
 * Attributes for setting the session cookie.
 *
 * `Secure` is false ONLY for a LOCAL_DEVELOPMENT config on a loopback host. Every other
 * combination — including a LOCAL_DEVELOPMENT config reached over a real hostname — gets `Secure`,
 * which on plain HTTP means the browser simply refuses the cookie. Failing to log in is the right
 * outcome for a development config exposed on a network interface.
 */
export function sessionCookieAttributes(options: {
  readonly mode: AuthConfigV1['mode'];
  readonly host: string | null;
  readonly token: string;
}): CookieAttributes {
  const developmentOnLoopback =
    options.mode === 'LOCAL_DEVELOPMENT' && isLoopbackHost(options.host);
  return {
    name: sessionCookieName(options.mode),
    value: options.token,
    httpOnly: true,
    secure: !developmentOnLoopback,
    sameSite: 'strict',
    path: '/',
  };
}

/** Attributes for clearing it. Must match name, path and security or the browser keeps the old one. */
export function clearedSessionCookieAttributes(options: {
  readonly mode: AuthConfigV1['mode'];
  readonly host: string | null;
}): CookieAttributes {
  const developmentOnLoopback =
    options.mode === 'LOCAL_DEVELOPMENT' && isLoopbackHost(options.host);
  return {
    name: sessionCookieName(options.mode),
    value: '',
    httpOnly: true,
    secure: !developmentOnLoopback,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  };
}

/** Serialize to a `Set-Cookie` value. Written out so tests can assert the exact string. */
export function serializeCookie(attributes: CookieAttributes): string {
  const parts = [
    `${attributes.name}=${attributes.value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Priority=High',
  ];
  if (attributes.secure) {
    parts.splice(2, 0, 'Secure');
  }
  if (attributes.maxAge !== undefined) {
    parts.push(`Max-Age=${String(attributes.maxAge)}`);
  }
  return parts.join('; ');
}
