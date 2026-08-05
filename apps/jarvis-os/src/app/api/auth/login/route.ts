import { loadAuthConfig } from '../../../../server/auth/config/loader';
import { AuthFailure, PUBLIC_MESSAGE, toAuthFailure } from '../../../../server/auth/errors';
import {
  requireSameOriginMutation,
  safeReturnPath,
} from '../../../../server/auth/origin/same-origin';
import { verifyPassword } from '../../../../server/auth/password/argon2id';
import { AUTH_RESPONSE_HEADERS } from '../../../../server/auth/response-headers';
import { LoginAttemptLimiter, resolveClientKey } from '../../../../server/auth/rate-limit/limiter';
import { sessionCookieAttributes, serializeCookie } from '../../../../server/auth/session/cookie';
import { newSessionClaims, sealSession } from '../../../../server/auth/session/token';
import { verifyTotp } from '../../../../server/auth/totp/totp';

/**
 * `POST /api/auth/login` (JOS-01C, ADR-0087).
 *
 * ### Every failure looks the same from outside
 *
 * Unknown operator, wrong passphrase, wrong or missing TOTP, malformed body, rejected origin — all
 * of them redirect back to `/login?error=invalid`. There is no factor-specific message and no
 * enumeration oracle, because a login form that says "wrong code" has just confirmed the
 * passphrase.
 *
 * Two things make that indistinguishability real rather than cosmetic. The password derivation
 * runs even when the operator id does not match, so an unknown operator costs the same ~50ms as a
 * known one. And every response waits for a floor duration, so the remaining difference between
 * "failed at the origin check" and "failed at TOTP" is not measurable from the outside.
 */
export const dynamic = 'force-dynamic';

/** One limiter per process. Deliberately in-memory: see the module note about what this is not. */
const limiter = new LoginAttemptLimiter();

/** Bodies are bounded before parsing: an unbounded form post is a cheap denial of service. */
const MAX_BODY_BYTES = 4096;

/**
 * The minimum time any login response takes.
 *
 * Not a substitute for constant-time comparison — it is the floor that hides the cheap early
 * rejections (bad origin, malformed body) behind the expensive one (Argon2id).
 */
const MIN_RESPONSE_MS = 120;

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const nowSeconds = Math.floor(startedAt / 1000);
  const clientKey = resolveClientKey();

  const settle = async (response: Response): Promise<Response> => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
    }
    return response;
  };

  try {
    const config = loadAuthConfig();

    requireSameOriginMutation({
      method: request.method,
      headers: request.headers,
      mode: config.mode,
    });

    const decision = limiter.check(clientKey, nowSeconds);
    if (!decision.allowed) {
      return await settle(
        redirectToLogin('rate-limited', '/', {
          'Retry-After': String(decision.retryAfterSeconds),
        }),
      );
    }

    const form = await readBoundedForm(request);
    const operatorId = readField(form, 'operatorId', 64);
    const password = readField(form, 'password', 512);
    const totpCode = readField(form, 'totpCode', 16);
    const returnTo = safeReturnPath(readField(form, 'returnTo', 512));

    // The operator check does NOT short-circuit the password work: an unknown id must cost the
    // same as a known one, or the response time enumerates operators.
    const operatorMatches = operatorId === config.operator.id;
    const passwordMatches = await verifyPassword({
      password,
      verifier: config.passwordVerifier,
    });

    let totpMatches = true;
    if (config.totp.required) {
      totpMatches = verifyTotp({ code: totpCode, totp: config.totp, nowSeconds });
    }

    if (!operatorMatches || !passwordMatches || !totpMatches) {
      limiter.recordFailure(clientKey, nowSeconds);
      return await settle(redirectToLogin('invalid', returnTo));
    }

    limiter.recordSuccess(clientKey);

    // A brand-new session id and CSRF token on every successful login: no session fixation, and a
    // token captured before login is useless afterwards.
    const claims = newSessionClaims({ config, nowSeconds });
    const token = sealSession(config, claims);
    const cookie = serializeCookie(
      sessionCookieAttributes({
        mode: config.mode,
        host: request.headers.get('host'),
        token,
      }),
    );

    return await settle(
      new Response(null, {
        status: 303,
        headers: {
          Location: returnTo,
          'Set-Cookie': cookie,
          ...AUTH_RESPONSE_HEADERS,
        },
      }),
    );
  } catch (error) {
    const failure = toAuthFailure(error, 'request-malformed');
    // Configuration problems present as "unavailable"; everything else as "invalid". Neither says
    // which file, which path or which factor.
    const marker = failure.publicOutcome === 'UNAVAILABLE' ? 'unavailable' : 'invalid';
    if (failure.publicOutcome === 'INVALID_CREDENTIALS') {
      limiter.recordFailure(clientKey, nowSeconds);
    }
    return settle(redirectToLogin(marker, '/'));
  }
}

function redirectToLogin(
  marker: 'invalid' | 'rate-limited' | 'unavailable',
  returnTo: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const target =
    returnTo === '/'
      ? `/login?error=${marker}`
      : `/login?error=${marker}&returnTo=${encodeURIComponent(returnTo)}`;
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      ...AUTH_RESPONSE_HEADERS,
      ...extraHeaders,
    },
  });
}

/** Read the body with a hard byte ceiling and an exact content-type requirement. */
async function readBoundedForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    throw new AuthFailure('request-malformed');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new AuthFailure('request-malformed');
  }

  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new AuthFailure('request-malformed');
  }

  const params = new URLSearchParams(text);
  const form = new FormData();
  for (const [key, value] of params) {
    form.set(key, value);
  }
  return form;
}

function readField(form: FormData, name: string, maxLength: number): string {
  const value = form.get(name);
  if (typeof value !== 'string' || value.length > maxLength) {
    return '';
  }
  return value;
}

export { PUBLIC_MESSAGE };
