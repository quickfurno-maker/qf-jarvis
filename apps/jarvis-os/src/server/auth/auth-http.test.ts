import { argon2, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authConfigV1Schema } from './config/schema';
import type { AuthConfigV1 } from './config/schema';
import { AUTH_CONFIG_PATH_VAR, loadAuthConfig } from './config/loader';
import { newSessionClaims, sealSession } from './session/token';
import { totpCodeForStep, decodeBase32 } from './totp/totp';

function secretOf(base32: string): Buffer {
  const decoded = decodeBase32(base32);
  if (decoded === undefined) {
    throw new Error('fixture secret is not valid base32');
  }
  return decoded;
}

/**
 * HTTP authorization behaviour (JOS-01C, ADR-0087).
 *
 * ### The routes are invoked DIRECTLY, with no proxy anywhere
 *
 * That is the whole point of this file. The Next.js proxy also gates these paths, and if these
 * tests went through it they would prove nothing about the routes themselves — a future refactor
 * that moved a route outside the matcher would keep passing while shipping an open endpoint.
 *
 * Calling the exported handler with a hand-built `Request` proves the handler refuses on its own.
 *
 * `next/headers` is mocked because `cookies()` needs a request scope that exists only inside the
 * framework. The mock supplies the cookie a browser would have sent; everything downstream — the
 * config read, the AES-GCM open, the expiry and revision checks — is the real implementation.
 */

const TEST_PASSPHRASE = 'correct horse battery staple 42';
const TEST_SALT = Buffer.alloc(16, 7);
const RFC_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SESSION_KEY = randomBytes(32).toString('base64url');

let cookieValue: string | undefined;

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieValue === undefined ? undefined : { name, value: cookieValue }),
    }),
}));

const digestFor = (password: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password.normalize('NFC'), 'utf8'),
        nonce: TEST_SALT,
        parallelism: 1,
        tagLength: 32,
        memory: 19_456,
        passes: 2,
      },
      (error, tag) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(tag.buffer, tag.byteOffset, tag.byteLength));
      },
    );
  });

let configPath: string;
let config: AuthConfigV1;

beforeEach(async () => {
  const digest = await digestFor(TEST_PASSPHRASE);
  const document = {
    version: 1,
    mode: 'LOCAL_DEVELOPMENT',
    operator: { id: 'owner', displayName: 'Owner', role: 'OWNER' },
    passwordVerifier: {
      algorithm: 'ARGON2ID_V19',
      memoryKiB: 19_456,
      passes: 2,
      parallelism: 1,
      salt: TEST_SALT.toString('base64url'),
      digest: digest.toString('base64url'),
    },
    totp: {
      required: true,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedDriftSteps: 1,
      secret: RFC_TOTP_SECRET,
    },
    session: {
      revision: 1,
      absoluteTtlSeconds: 3600,
      primaryKeyId: 'k1',
      keys: [{ id: 'k1', status: 'PRIMARY', key: SESSION_KEY }],
    },
  };
  config = authConfigV1Schema.parse(document);

  const dir = mkdtempSync(join(tmpdir(), 'qfj-jos-auth-'));
  configPath = join(dir, 'auth.json');
  writeFileSync(configPath, JSON.stringify(document), { mode: 0o600 });
  process.env[AUTH_CONFIG_PATH_VAR] = configPath;
  cookieValue = undefined;
});

afterEach(() => {
  Reflect.deleteProperty(process.env, AUTH_CONFIG_PATH_VAR);
  cookieValue = undefined;
});

function validSessionCookie(offsetSeconds = 0): string {
  const now = Math.floor(Date.now() / 1000) + offsetSeconds;
  return sealSession(config, newSessionClaims({ config, nowSeconds: now }));
}

const localHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  host: '127.0.0.1:3000',
  origin: 'http://127.0.0.1:3000',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/x-www-form-urlencoded',
  ...extra,
});

describe('the configuration loader', () => {
  it('reads and validates a well-formed file', () => {
    expect(loadAuthConfig().operator.id).toBe('owner');
  });

  it('fails closed when the path variable is unset — no default, no search', () => {
    Reflect.deleteProperty(process.env, AUTH_CONFIG_PATH_VAR);
    expect(() => loadAuthConfig()).toThrow();
  });

  it('fails closed on a missing file, a directory and malformed JSON', () => {
    expect(() => loadAuthConfig({ path: join(tmpdir(), 'definitely-not-here.json') })).toThrow();
    expect(() => loadAuthConfig({ path: tmpdir() })).toThrow();

    const dir = mkdtempSync(join(tmpdir(), 'qfj-bad-'));
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ not json', { mode: 0o600 });
    expect(() => loadAuthConfig({ path: broken })).toThrow();
  });

  it('rejects an oversized file before parsing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfj-big-'));
    const big = join(dir, 'big.json');
    writeFileSync(big, JSON.stringify({ padding: 'x'.repeat(20_000) }), { mode: 0o600 });
    expect(() => loadAuthConfig({ path: big })).toThrow();
  });

  it('rejects a group- or world-readable file on POSIX', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfj-perm-'));
    const open = join(dir, 'open.json');
    writeFileSync(open, JSON.stringify({ version: 1 }), { mode: 0o644 });
    // Platform is injected so the POSIX rule is exercised on any host.
    expect(() => loadAuthConfig({ path: open, platform: 'linux' })).toThrow();
  });

  it('never puts the path or a secret into the failure message', () => {
    Reflect.deleteProperty(process.env, AUTH_CONFIG_PATH_VAR);
    try {
      loadAuthConfig({ path: '/run/secrets/very-secret-name.json' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('very-secret-name');
      expect(message).not.toContain('/run/secrets');
      expect(message).toBe('Secure access is unavailable.');
    }
  });
});

describe('GET /api/control-plane/v1/snapshot requires a session', () => {
  it('returns 401 and NO snapshot when unauthenticated', async () => {
    const { GET } = await import('../../app/api/control-plane/v1/snapshot/route');
    const response = await GET(new Request('http://127.0.0.1/api/control-plane/v1/snapshot'));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { readonly error?: string };
    expect(body.error).toBe('unauthenticated');
    // Not a single field of the real payload leaks.
    expect(JSON.stringify(body)).not.toContain('contractVersion');
    expect(JSON.stringify(body)).not.toContain('REPOSITORY_BASELINE');
  });

  it('returns the JOS-01B contract payload when authenticated', async () => {
    cookieValue = validSessionCookie();
    const { GET } = await import('../../app/api/control-plane/v1/snapshot/route');
    const response = await GET(new Request('http://127.0.0.1/api/control-plane/v1/snapshot'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['contractVersion']).toBe('1');
    expect(body['mode']).toBe('READ_ONLY');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects an expired session exactly like an absent one', async () => {
    // Seal a token that expired an hour and a half ago.
    cookieValue = validSessionCookie(-5400);
    const { GET } = await import('../../app/api/control-plane/v1/snapshot/route');
    const response = await GET(new Request('http://127.0.0.1/api/control-plane/v1/snapshot'));
    expect(response.status).toBe(401);
  });

  it('rejects a session whose revision the configuration has moved past', async () => {
    cookieValue = validSessionCookie();
    // Rotate the revision on disk: emergency global revocation.
    const rotated = { ...JSON.parse(JSON.stringify(config)) } as Record<string, unknown>;
    (rotated['session'] as Record<string, unknown>)['revision'] = 2;
    writeFileSync(configPath, JSON.stringify(rotated), { mode: 0o600 });

    const { GET } = await import('../../app/api/control-plane/v1/snapshot/route');
    const response = await GET(new Request('http://127.0.0.1/api/control-plane/v1/snapshot'));
    // No rebuild, no restart: the next request is already refused.
    expect(response.status).toBe(401);
  });

  it('exports no mutating verb', async () => {
    const route = (await import('../../app/api/control-plane/v1/snapshot/route')) as Record<
      string,
      unknown
    >;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(route[method], method).toBeUndefined();
    }
  });
});

describe('POST /api/auth/login', () => {
  const loginBody = (overrides: Record<string, string> = {}): string => {
    const secret = secretOf(RFC_TOTP_SECRET);
    const step = Math.floor(Date.now() / 1000 / 30);
    return new URLSearchParams({
      operatorId: 'owner',
      password: TEST_PASSPHRASE,
      totpCode: totpCodeForStep(secret, step, 6),
      returnTo: '/',
      ...overrides,
    }).toString();
  };

  const post = async (body: string, headers = localHeaders()): Promise<Response> => {
    const { POST } = await import('../../app/api/auth/login/route');
    return POST(new Request('http://127.0.0.1/api/auth/login', { method: 'POST', headers, body }));
  };

  it('sets a session cookie and redirects on a valid password + TOTP', async () => {
    const response = await post(loginBody());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('qfj-jos-session-dev=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toMatch(/Max-Age=[1-9]/u);
    expect(cookie).not.toContain('Domain=');
  });

  it('gives the SAME generic failure for a wrong id, password or code', async () => {
    const outcomes = await Promise.all([
      post(loginBody({ operatorId: 'someone-else' })),
      post(loginBody({ password: 'not-the-passphrase-at-all' })),
      post(loginBody({ totpCode: '000000' })),
      post(loginBody({ totpCode: '' })),
    ]);
    for (const response of outcomes) {
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login?error=invalid');
      // No cookie is ever set on a failure.
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('rejects a cross-origin post and a bad Sec-Fetch-Site', async () => {
    for (const headers of [
      localHeaders({ origin: 'http://evil.example' }),
      localHeaders({ 'sec-fetch-site': 'cross-site' }),
      localHeaders({ origin: '' }),
    ]) {
      const response = await post(loginBody(), headers);
      expect(response.headers.get('location')).toContain('/login?error=');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('refuses a body that is not form-encoded, and one that is too large', async () => {
    const wrongType = await post(loginBody(), localHeaders({ 'content-type': 'application/json' }));
    expect(wrongType.headers.get('set-cookie')).toBeNull();

    const huge = await post(`password=${'x'.repeat(9000)}`);
    expect(huge.headers.get('set-cookie')).toBeNull();
  });

  it('never honours a hostile returnTo', async () => {
    for (const hostile of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const response = await post(loginBody({ returnTo: hostile }));
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
    }
  });

  it('honours a safe in-app returnTo', async () => {
    const response = await post(loginBody({ returnTo: '/approvals' }));
    expect(response.headers.get('location')).toBe('/approvals');
  });

  it('exports no GET handler', async () => {
    const route = (await import('../../app/api/auth/login/route')) as Record<string, unknown>;
    expect(route['GET']).toBeUndefined();
  });
});

describe('POST /api/auth/logout', () => {
  const post = async (body: string, headers = localHeaders()): Promise<Response> => {
    const { POST } = await import('../../app/api/auth/logout/route');
    const form = new FormData();
    for (const [key, value] of new URLSearchParams(body)) {
      form.set(key, value);
    }
    const { 'content-type': _ignored, ...rest } = headers;
    return POST(
      new Request('http://127.0.0.1/api/auth/logout', {
        method: 'POST',
        headers: rest,
        body: form,
      }),
    );
  };

  it('clears the cookie when the session and CSRF token are valid', async () => {
    const claims = newSessionClaims({ config, nowSeconds: Math.floor(Date.now() / 1000) });
    cookieValue = sealSession(config, claims);

    const response = await post(new URLSearchParams({ csrfToken: claims.csrfToken }).toString());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('Max-Age=0');
    expect(response.headers.get('clear-site-data')).toContain('cookies');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('refuses a missing or wrong CSRF token without clearing anything', async () => {
    const claims = newSessionClaims({ config, nowSeconds: Math.floor(Date.now() / 1000) });
    cookieValue = sealSession(config, claims);

    for (const body of ['', 'csrfToken=wrong-token-entirely']) {
      const response = await post(body);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/login');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('refuses a cross-origin logout', async () => {
    const claims = newSessionClaims({ config, nowSeconds: Math.floor(Date.now() / 1000) });
    cookieValue = sealSession(config, claims);
    const response = await post(
      new URLSearchParams({ csrfToken: claims.csrfToken }).toString(),
      localHeaders({ origin: 'http://evil.example' }),
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('exports no GET handler — a GET can never log anyone out', async () => {
    const route = (await import('../../app/api/auth/logout/route')) as Record<string, unknown>;
    expect(route['GET']).toBeUndefined();
    expect(route['DELETE']).toBeUndefined();
  });
});
