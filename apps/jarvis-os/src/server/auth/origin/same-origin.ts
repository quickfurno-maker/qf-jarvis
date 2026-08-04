import { AuthFailure } from '../errors';
import type { AuthConfigV1 } from '../config/schema';
import { isLoopbackHost } from '../session/cookie';

/**
 * Same-origin enforcement for authentication mutations (JOS-01C, ADR-0087).
 *
 * ### Why this exists alongside `SameSite=Strict`
 *
 * `SameSite=Strict` already stops the browser attaching the session cookie to a cross-site
 * request, which defeats classic CSRF on its own. This is a second, independent layer because the
 * first depends entirely on the browser behaving: an older client, an unusual embedding context or
 * a future relaxation of the attribute would silently remove the only control. Checking `Origin`
 * server-side costs nothing and does not care what the browser decided.
 *
 * ### `Origin` is compared to the EFFECTIVE origin, not to a configured allowlist
 *
 * There is no `ALLOWED_ORIGIN` setting to misconfigure. The request must come from the exact host
 * it was sent to, which is correct by construction on any hostname the app is ever deployed
 * under — and cannot be widened by a well-meaning environment variable.
 */

export interface OriginCheckInput {
  readonly method: string;
  readonly headers: Headers;
  readonly mode: AuthConfigV1['mode'];
}

/**
 * `Sec-Fetch-Site` values this accepts.
 *
 * `same-origin` is the normal case for a form posted from our own page. `none` is a
 * user-initiated navigation with no initiator — a bookmark or typed URL — which cannot be forged
 * by another site and must be accepted or a directly-opened login page could never submit.
 * `cross-site` and `same-site` are both refused: this app has no siblings to trust.
 */
const ACCEPTED_FETCH_SITE = new Set(['same-origin', 'none']);

/**
 * Reject anything that is not a genuine same-origin mutation.
 *
 * Throws `origin-rejected`, which surfaces to a caller as the same generic outcome as a wrong
 * password — a probe learns nothing from being blocked here.
 */
export function requireSameOriginMutation(input: OriginCheckInput): void {
  if (input.method !== 'POST') {
    throw new AuthFailure('method-not-allowed');
  }

  const host = input.headers.get('host');
  if (host === null || host === '') {
    throw new AuthFailure('origin-rejected');
  }

  const fetchSite = input.headers.get('sec-fetch-site');
  if (fetchSite !== null && !ACCEPTED_FETCH_SITE.has(fetchSite)) {
    throw new AuthFailure('origin-rejected');
  }
  // In PRODUCTION the header is required. Every browser that can reach a `Secure` cookie sends it,
  // so an absent one is a non-browser client posting a form, which has no business here.
  if (input.mode === 'PRODUCTION' && fetchSite === null) {
    throw new AuthFailure('origin-rejected');
  }

  const origin = input.headers.get('origin');
  if (origin === null || origin === '') {
    // Same reasoning: a browser always sends `Origin` on a cross-origin-capable POST.
    throw new AuthFailure('origin-rejected');
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AuthFailure('origin-rejected');
  }

  // The host authority must match exactly, port included. `example.com` and `example.com:8443` are
  // different origins and a mismatch here is a redirect or a proxy misconfiguration worth failing.
  if (parsed.host !== host) {
    throw new AuthFailure('origin-rejected');
  }

  // Scheme: production is HTTPS-only; a development config is HTTP only on loopback.
  if (input.mode === 'PRODUCTION') {
    if (parsed.protocol !== 'https:') {
      throw new AuthFailure('origin-rejected');
    }
  } else if (parsed.protocol !== 'https:' && !isLoopbackHost(host)) {
    throw new AuthFailure('origin-rejected');
  }
}

/**
 * Resolve a caller-supplied `returnTo` to a safe in-app path, or fall back to `/`.
 *
 * Never trusted, never parsed as a URL that could carry an authority. The accepted shape is a
 * single leading slash followed by a path character that is not another slash and not a backslash:
 * this rejects `//evil.com` (protocol-relative), `/\evil.com` (browsers normalise the backslash),
 * `https://evil.com` and anything with a scheme. An open redirect on a login form is a phishing
 * primitive — the operator authenticates, then lands on an attacker's page that looks like the app.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (typeof candidate !== 'string' || candidate === '') {
    return '/';
  }
  if (candidate.length > 512) {
    return '/';
  }
  if (!candidate.startsWith('/')) {
    return '/';
  }
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return '/';
  }
  if (candidate.includes('\\') || candidate.includes('\n') || candidate.includes('\r')) {
    return '/';
  }
  // A control character or a scheme-looking prefix anywhere is enough to refuse. Checked by code
  // point rather than a regex class, so the linter's control-character rule stays enabled.
  let hasControlCharacter = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      hasControlCharacter = true;
      break;
    }
  }
  if (hasControlCharacter || /^\/[A-Za-z][A-Za-z0-9+.-]*:/u.test(candidate)) {
    return '/';
  }
  return candidate;
}
