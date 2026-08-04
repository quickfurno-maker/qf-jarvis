import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * The Next.js 16 proxy (JOS-01C, ADR-0087).
 *
 * This is `proxy.ts`, the Next 16 name — not the deprecated `middleware.ts`. It runs BEFORE
 * routing, on every matched request, and it does exactly two jobs.
 *
 * ### 1. It is an OPTIMISTIC gate, never the authority
 *
 * It checks whether a session cookie is PRESENT. It does not decrypt it, does not read the auth
 * configuration, and does not know whether the token is valid, expired or forged. That is
 * deliberate and it is the documented Next.js guidance: the proxy is a cheap redirect for the
 * common case, and real authorization belongs close to the data.
 *
 * So a request carrying any cookie value passes through here and is then properly verified by
 * `requireOperatorSession()` in the protected layout, or `requireApiOperatorSession()` in the
 * snapshot route. Delete this file and every protected surface stays closed; that is the property
 * the tests assert by calling the route handlers directly.
 *
 * It also adds NO identity header. There is no `x-operator-id` for downstream code to trust,
 * because a header set by a trusted component is indistinguishable at the point of use from one
 * set by a client, and that confusion is a recurring source of complete auth bypasses.
 *
 * ### 2. It mints the CSP nonce
 *
 * Authentication makes every protected page dynamic, so a nonce-based Content-Security-Policy
 * becomes possible — and a nonce is strictly better than a hash allowlist for an app that renders
 * per request. The nonce is fresh per HTML request, and any incoming `x-nonce` is OVERWRITTEN: a
 * client that could choose the nonce could authorise its own injected script.
 */

/** Paths reachable without a session. Everything not listed here is protected by default. */
const PUBLIC_PATHS: readonly string[] = Object.freeze(['/login', '/api/auth/login']);

/** Cookie names, duplicated deliberately: the proxy must not import the server-only auth modules. */
const SESSION_COOKIE_NAMES: readonly string[] = Object.freeze([
  '__Host-qfj-jos-session',
  'qfj-jos-session-dev',
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

/**
 * The Content-Security-Policy.
 *
 * Production is strict and entirely local: no CDN, no analytics, no external font or image host,
 * and `strict-dynamic` so a nonce-approved script may load its own chunks without the policy
 * needing to enumerate them.
 *
 * `frame-ancestors 'none'` and `base-uri 'none'` matter more than they look. The first is the
 * modern clickjacking defence; the second stops an injected `<base>` tag silently repointing every
 * relative URL on the page — including the login form's action.
 *
 * Development needs `unsafe-eval` for React Refresh and `unsafe-inline` for the dev overlay's
 * styles. Both are narrowly scoped to development and asserted absent from production by tests.
 */
export function contentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const styleSrc = isDevelopment ? `'self' 'unsafe-inline'` : `'self' 'nonce-${nonce}'`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

/**
 * Headers applied to every response.
 *
 * HSTS is deliberately ABSENT. It is only meaningful over HTTPS, this build serves plain HTTP
 * locally, and sending it now would either do nothing or — worse — read as protection that is not
 * there. JOS-01D adds it when Traefik terminates real TLS.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '),
});

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => {
    const value = request.cookies.get(name)?.value;
    return value !== undefined && value !== '';
  });
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isDevelopment = process.env.NODE_ENV !== 'production';

  // A fresh 128-bit nonce per request, and any client-supplied `x-nonce` is discarded.
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/gu, ''), 'hex').toString('base64');
  const csp = contentSecurityPolicy(nonce, isDevelopment);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-nonce');
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const decorate = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(header, value);
    }
    // Authenticated surfaces must never sit in a shared cache.
    response.headers.set('Cache-Control', 'no-store, private');
    return response;
  };

  const authenticated = hasSessionCookie(request);

  // An operator who already has a session should not be looking at the login form.
  if (pathname === '/login' && authenticated) {
    return decorate(NextResponse.redirect(new URL('/', request.url)));
  }

  if (isPublicPath(pathname)) {
    return decorate(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (!authenticated) {
    if (isApiPath(pathname)) {
      // JSON for an API path; a redirect would be parsed as data by a fetch caller.
      return decorate(
        new NextResponse(JSON.stringify({ error: 'unauthenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      );
    }
    const login = new URL('/login', request.url);
    // `returnTo` carries only a path; the login route re-validates it and never trusts it.
    if (pathname !== '/') {
      login.searchParams.set('returnTo', pathname);
    }
    return decorate(NextResponse.redirect(login));
  }

  return decorate(NextResponse.next({ request: { headers: requestHeaders } }));
}

/**
 * The matcher.
 *
 * Excludes only Next's own static output and the favicon. It deliberately does NOT exclude
 * `/api/`: the snapshot route must be matched, and a matcher that skipped API paths would leave
 * the one protected API unguarded at this layer. Every future route is protected by default,
 * because the allowlist is explicit and short.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
