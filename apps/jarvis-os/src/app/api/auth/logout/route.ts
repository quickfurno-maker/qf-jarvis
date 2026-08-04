import { requireOperatorSession } from '../../../../server/auth/dal';
import { toAuthFailure } from '../../../../server/auth/errors';
import { requireSameOriginMutation } from '../../../../server/auth/origin/same-origin';
import {
  clearedSessionCookieAttributes,
  serializeCookie,
} from '../../../../server/auth/session/cookie';
import { csrfMatches } from '../../../../server/auth/session/token';

/**
 * `POST /api/auth/logout` (JOS-01C, ADR-0087).
 *
 * ### Why logout needs CSRF protection at all
 *
 * A forced logout is a low-severity attack, but it is a real one — and more importantly, this is
 * the first state-changing route in Jarvis OS, so it sets the pattern every future write route
 * will copy. Getting the shape right here (POST only, exact-origin, session-bound token compared in
 * constant time) is worth more than the specific risk it mitigates today.
 *
 * The CSRF token is carried in the ENCRYPTED session and re-emitted into the logout form by the
 * server. An attacker who can make the browser POST cannot read the token, because it never exists
 * anywhere JavaScript can reach: not in a readable cookie, not in `localStorage`, not in a
 * client-component prop.
 *
 * ### There is no GET logout
 *
 * A GET that mutates can be triggered by an `<img>` tag, a prefetch, or a link scanner in an email
 * client. Only `POST` is exported, so the App Router answers `GET /api/auth/logout` with 405.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireOperatorSession();

    requireSameOriginMutation({
      method: request.method,
      headers: request.headers,
      mode: session.config.mode,
    });

    const form = await request.formData();
    const submitted = form.get('csrfToken');
    if (typeof submitted !== 'string' || !csrfMatches(session.csrfToken, submitted)) {
      // Deliberately NOT a distinct status or message: a probe learns nothing from a refused
      // logout that it would not learn from an unauthenticated one.
      return unauthenticatedRedirect();
    }

    const cookie = serializeCookie(
      clearedSessionCookieAttributes({
        mode: session.config.mode,
        host: request.headers.get('host'),
      }),
    );

    return new Response(null, {
      status: 303,
      headers: {
        Location: '/login',
        'Set-Cookie': cookie,
        'Cache-Control': 'no-store, private',
        // Jarvis OS owns its whole origin, so clearing the origin's storage on sign-out is safe
        // and removes any cached protected page a shared machine might otherwise show.
        'Clear-Site-Data': '"cache", "cookies", "storage"',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // Any failure -- no session, bad origin, wrong method -- ends at the login page with the
    // cookie cleared where we can safely do so.
    toAuthFailure(error, 'session-absent');
    return unauthenticatedRedirect();
  }
}

function unauthenticatedRedirect(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
