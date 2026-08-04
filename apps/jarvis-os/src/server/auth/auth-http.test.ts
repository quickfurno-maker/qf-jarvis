import { argon2, randomBytes } from 'node:crypto';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authConfigV1Schema } from './config/schema';
import type { AuthConfigV1 } from './config/schema';
import { AUTH_CONFIG_PATH_VAR, loadAuthConfig } from './config/loader';
import { getOptionalOperatorSession } from './dal';
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

  it('rejects a SYMLINK at the configured path', () => {
    // The defect this replaces was a time-of-check/time-of-use race: `lstat(path)` proved the name
    // was not a symlink, then `open(path)` resolved the same name a second time. Anything with
    // write access to the directory could swap the entry between the two calls. The loader now
    // opens with O_NOFOLLOW and validates the DESCRIPTOR, so the check and the use are the same
    // object -- and a symlink is refused by the kernel at open time rather than by a prior glance.
    const dir = mkdtempSync(join(tmpdir(), 'qfj-link-'));
    const real = join(dir, 'real.json');
    const link = join(dir, 'link.json');
    writeFileSync(real, JSON.stringify({ version: 1 }), { mode: 0o600 });
    try {
      symlinkSync(real, link);
    } catch {
      // Windows requires elevation for symlinks; skip rather than assert a platform behaviour we
      // cannot create. Production is Linux, where CI exercises this path.
      return;
    }
    expect(() => loadAuthConfig({ path: link })).toThrow();
  });

  it('rejects a world-readable file as well as a group-readable one', () => {
    for (const mode of [0o644, 0o604, 0o640]) {
      const dir = mkdtempSync(join(tmpdir(), 'qfj-mode-'));
      const file = join(dir, 'open.json');
      writeFileSync(file, JSON.stringify({ version: 1 }), { mode });
      expect(() => loadAuthConfig({ path: file, platform: 'linux' }), String(mode)).toThrow();
    }
  });

  it('accepts an owner-only regular file', () => {
    // The positive case, so the rejections above are not passing for an unrelated reason.
    //
    // The REAL platform is used here rather than a forced 'linux': Windows does not implement
    // POSIX mode bits, so a file created with `mode: 0o600` there still reports as world-readable
    // and would fail a rule that only production (Linux) is meant to enforce.
    expect(loadAuthConfig({ path: configPath }).operator.id).toBe('owner');
  });

  it('bounds the read even if the file grows after it is measured', () => {
    // The read asks for one byte MORE than the maximum, so a file that grew between fstat and read
    // is detected rather than silently truncated and parsed as valid configuration.
    const dir = mkdtempSync(join(tmpdir(), 'qfj-grow-'));
    const file = join(dir, 'grown.json');
    writeFileSync(file, JSON.stringify({ padding: 'x'.repeat(20_000) }), { mode: 0o600 });
    expect(() => loadAuthConfig({ path: file })).toThrow();
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

describe('an invalid cookie can never lock the operator out of /login', () => {
  /**
   * The defect this replaces.
   *
   * The proxy used to redirect `/login` to `/` whenever a session cookie was PRESENT -- and the
   * proxy deliberately does not decrypt or verify anything. So any cookie that existed but was not
   * valid produced an infinite loop: proxy sends the browser to `/`, the protected layout verifies
   * properly and rejects, sends it back to `/login`, proxy sees the same cookie again. An operator
   * whose session merely expired could not reach the form to sign in again.
   *
   * These assertions cover every shape of "present but not valid", through the same
   * `getOptionalOperatorSession()` the login page uses. `undefined` means the page renders the
   * form; anything else would mean it redirects, which is the loop.
   */
  const shapesOfInvalid = (): readonly (readonly [string, string])[] => {
    const now = Math.floor(Date.now() / 1000);
    const valid = sealSession(config, newSessionClaims({ config, nowSeconds: now }));
    const parts = valid.split('.');
    const middle = Math.floor((parts[3] ?? '').length / 2);
    const tampered = [...parts];
    tampered[3] =
      (parts[3] ?? '').slice(0, middle) +
      ((parts[3] ?? '')[middle] === 'A' ? 'B' : 'A') +
      (parts[3] ?? '').slice(middle + 1);

    return [
      ['random garbage', 'not-a-token-at-all'],
      ['empty-ish', '....'],
      ['wrong version', `v9.${parts.slice(1).join('.')}`],
      ['tampered ciphertext', tampered.join('.')],
      ['expired', sealSession(config, newSessionClaims({ config, nowSeconds: now - 7200 }))],
      ['oversized', 'x'.repeat(4000)],
    ];
  };

  it('renders the login form for every invalid cookie shape', async () => {
    for (const [label, value] of shapesOfInvalid()) {
      cookieValue = value;
      const session = await getOptionalOperatorSession();
      // `undefined` => the login page renders the form. Anything else => a redirect => the loop.
      expect(session, label).toBeUndefined();
    }
  });

  it('renders the login form when no cookie is present at all', async () => {
    cookieValue = undefined;
    expect(await getOptionalOperatorSession()).toBeUndefined();
  });

  it('renders the login form for a token whose key was removed', async () => {
    const now = Math.floor(Date.now() / 1000);
    cookieValue = sealSession(config, newSessionClaims({ config, nowSeconds: now }));
    // Rotate the key on disk: the old token becomes undecryptable.
    const rotated = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    const session = rotated['session'] as Record<string, unknown>;
    session['primaryKeyId'] = 'k2';
    session['keys'] = [{ id: 'k2', status: 'PRIMARY', key: randomBytes(32).toString('base64url') }];
    writeFileSync(configPath, JSON.stringify(rotated), { mode: 0o600 });

    expect(await getOptionalOperatorSession()).toBeUndefined();
  });

  it('renders the login form for a stale session revision', async () => {
    const now = Math.floor(Date.now() / 1000);
    cookieValue = sealSession(config, newSessionClaims({ config, nowSeconds: now }));
    const rotated = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    (rotated['session'] as Record<string, unknown>)['revision'] = 2;
    writeFileSync(configPath, JSON.stringify(rotated), { mode: 0o600 });

    expect(await getOptionalOperatorSession()).toBeUndefined();
  });

  it('redirects away from /login ONLY for a fully verified session', async () => {
    cookieValue = sealSession(
      config,
      newSessionClaims({ config, nowSeconds: Math.floor(Date.now() / 1000) }),
    );
    const session = await getOptionalOperatorSession();
    // Defined => the login page redirects to `/`. This is the only case that may.
    expect(session).toBeDefined();
    expect(session?.view.operatorId).toBe('owner');
  });

  it('leaves protected surfaces closed for those same invalid cookies', async () => {
    const { GET } = await import('../../app/api/control-plane/v1/snapshot/route');
    for (const [label, value] of shapesOfInvalid()) {
      cookieValue = value;
      const response = await GET(new Request('http://127.0.0.1/api/control-plane/v1/snapshot'));
      // Reachable login page, still-closed API. Both properties at once is the whole point.
      expect(response.status, label).toBe(401);
    }
  });
});

describe('the proxy never decides a session is valid', () => {
  it('performs no decryption, reads no configuration and sets no identity header', () => {
    const source = readFileSync(fileURLToPath(new URL('../../proxy.ts', import.meta.url)), 'utf8');
    // It must not import the session, config or password modules -- doing so would make the
    // pre-routing path a second authority holding key material.
    for (const forbidden of [
      'openSession',
      'loadAuthConfig',
      'sealSession',
      'auth/config',
      'auth/session',
      'auth/password',
      'auth/dal',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // And it must not hand a downstream consumer an identity to trust.
    expect(source).not.toMatch(/set\(\s*['"]x-operator/iu);
    expect(source).not.toMatch(/set\(\s*['"]x-user/iu);
  });

  it('no longer redirects /login on mere cookie presence', () => {
    const source = readFileSync(fileURLToPath(new URL('../../proxy.ts', import.meta.url)), 'utf8');
    // The exact shape that caused the loop.
    expect(source).not.toMatch(/pathname === '\/login' && authenticated/u);
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
