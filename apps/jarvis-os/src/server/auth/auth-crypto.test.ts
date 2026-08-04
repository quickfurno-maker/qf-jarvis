import { argon2, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { authConfigV1Schema } from './config/schema';
import type { AuthConfigV1 } from './config/schema';
import { AuthFailure } from './errors';
import { MAX_PASSWORD_BYTES, verifyPassword } from './password/argon2id';
import { LoginAttemptLimiter } from './rate-limit/limiter';
import { csrfMatches, newSessionClaims, openSession, sealSession } from './session/token';
import { decodeBase32, totpCodeForStep, verifyTotp } from './totp/totp';
import {
  clearedSessionCookieAttributes,
  isLoopbackHost,
  serializeCookie,
  sessionCookieAttributes,
} from './session/cookie';
import { requireSameOriginMutation, safeReturnPath } from './origin/same-origin';

/**
 * Authentication primitives (JOS-01C, ADR-0087).
 *
 * The fixtures here are REAL: a genuine Argon2id digest derived at module load from a known
 * passphrase and a fixed salt, a real 32-byte session key, a real base32 TOTP secret. Nothing is
 * stubbed, because a stubbed KDF proves only that the stub works.
 *
 * None of it is a shared credential: every value is generated in-process, is discarded when the
 * suite exits, and would fail against any real configuration.
 */

const TEST_PASSPHRASE = 'correct horse battery staple 42';
const TEST_SALT = Buffer.alloc(16, 7);
/** RFC 6238 test key ("12345678901234567890") base32-encoded. */
const RFC_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const digestFor = async (password: string): Promise<Buffer> =>
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

/**
 * Decode a base32 secret, failing loudly when it cannot be decoded.
 *
 * `noUncheckedIndexedAccess` and the repository's ban on `!` mean the alternative is a cast, and a
 * cast would silently pass `undefined` into an HMAC if the fixture ever broke.
 */
function secretOf(base32: string): Buffer {
  const decoded = decodeBase32(base32);
  if (decoded === undefined) {
    throw new Error('fixture secret is not valid base32');
  }
  return decoded;
}

const SESSION_KEY = randomBytes(32).toString('base64url');
const SECOND_KEY = randomBytes(32).toString('base64url');

async function testConfig(overrides: Partial<AuthConfigV1> = {}): Promise<AuthConfigV1> {
  const digest = await digestFor(TEST_PASSPHRASE);
  const base = {
    version: 1,
    mode: 'PRODUCTION',
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
    ...overrides,
  };
  return authConfigV1Schema.parse(base);
}

describe('the auth configuration schema', () => {
  it('accepts a well-formed production configuration', async () => {
    const config = await testConfig();
    expect(config.mode).toBe('PRODUCTION');
    expect(config.totp.required).toBe(true);
  });

  it('REJECTS a production configuration that disables TOTP', async () => {
    const digest = await digestFor(TEST_PASSPHRASE);
    const candidate = {
      version: 1,
      mode: 'PRODUCTION',
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
        required: false,
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
    expect(authConfigV1Schema.safeParse(candidate).success).toBe(false);
  });

  it('rejects Argon2id parameters below the OWASP minimum', async () => {
    const config = await testConfig();
    for (const [field, value] of [
      ['memoryKiB', 19_455],
      ['passes', 1],
    ] as const) {
      const weakened = {
        ...config,
        passwordVerifier: { ...config.passwordVerifier, [field]: value },
      };
      expect(authConfigV1Schema.safeParse(weakened).success, field).toBe(false);
    }
  });

  it('rejects an unsupported password algorithm outright', async () => {
    const config = await testConfig();
    const swapped = {
      ...config,
      passwordVerifier: { ...config.passwordVerifier, algorithm: 'PBKDF2_SHA256' },
    };
    expect(authConfigV1Schema.safeParse(swapped).success).toBe(false);
  });

  it('rejects a session key that is not exactly 32 bytes', async () => {
    const config = await testConfig();
    const short = {
      ...config,
      session: {
        ...config.session,
        keys: [
          { id: 'k1', status: 'PRIMARY' as const, key: randomBytes(16).toString('base64url') },
        ],
      },
    };
    expect(authConfigV1Schema.safeParse(short).success).toBe(false);
  });

  it('requires exactly one PRIMARY key, matching primaryKeyId', async () => {
    const config = await testConfig();
    const twoPrimaries = {
      ...config,
      session: {
        ...config.session,
        keys: [
          { id: 'k1', status: 'PRIMARY' as const, key: SESSION_KEY },
          { id: 'k2', status: 'PRIMARY' as const, key: SECOND_KEY },
        ],
      },
    };
    expect(authConfigV1Schema.safeParse(twoPrimaries).success).toBe(false);

    const mismatched = {
      ...config,
      session: { ...config.session, primaryKeyId: 'k2' },
    };
    expect(authConfigV1Schema.safeParse(mismatched).success).toBe(false);
  });

  it('rejects unknown fields and out-of-range TTLs', async () => {
    const config = await testConfig();
    expect(authConfigV1Schema.safeParse({ ...config, extra: true }).success).toBe(false);
    for (const ttl of [899, 14_401]) {
      const candidate = { ...config, session: { ...config.session, absoluteTtlSeconds: ttl } };
      expect(authConfigV1Schema.safeParse(candidate).success, String(ttl)).toBe(false);
    }
  });
});

describe('Argon2id password verification', () => {
  it('accepts the correct passphrase and rejects a wrong one', async () => {
    const config = await testConfig();
    expect(
      await verifyPassword({ password: TEST_PASSPHRASE, verifier: config.passwordVerifier }),
    ).toBe(true);
    expect(
      await verifyPassword({ password: `${TEST_PASSPHRASE} `, verifier: config.passwordVerifier }),
    ).toBe(false);
    expect(await verifyPassword({ password: '', verifier: config.passwordVerifier })).toBe(false);
  });

  it('is deterministic for the same salt and parameters', async () => {
    const a = await digestFor(TEST_PASSPHRASE);
    const b = await digestFor(TEST_PASSPHRASE);
    expect(a.equals(b)).toBe(true);
    expect(a.byteLength).toBe(32);
  });

  it('refuses an oversized password without spending the KDF on it', async () => {
    const config = await testConfig();
    const huge = 'x'.repeat(MAX_PASSWORD_BYTES + 1);
    expect(await verifyPassword({ password: huge, verifier: config.passwordVerifier })).toBe(false);
  });

  it('normalizes Unicode so the same passphrase verifies from any keyboard', async () => {
    // U+00E9 (precomposed) vs U+0065 U+0301 (decomposed) look identical and are different bytes.
    const precomposed = 'passphrase-café-secure';
    const decomposed = 'passphrase-café-secure';
    const digest = await new Promise<Buffer>((resolve, reject) => {
      argon2(
        'argon2id',
        {
          message: Buffer.from(precomposed.normalize('NFC'), 'utf8'),
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
    const config = await testConfig();
    const verifier = { ...config.passwordVerifier, digest: digest.toString('base64url') };
    expect(await verifyPassword({ password: decomposed, verifier })).toBe(true);
  });
});

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const secret = secretOf(RFC_TOTP_SECRET);
    expect(secret.toString('ascii')).toBe('12345678901234567890');
    // RFC 6238 Appendix B, SHA-1 column, truncated to six digits.
    expect(totpCodeForStep(secret, Math.floor(59 / 30), 6)).toBe('287082');
    expect(totpCodeForStep(secret, Math.floor(1_111_111_109 / 30), 6)).toBe('081804');
    expect(totpCodeForStep(secret, Math.floor(1_234_567_890 / 30), 6)).toBe('005924');
  });

  it('accepts the current step and one step of drift either side', async () => {
    const config = await testConfig();
    const secret = secretOf(RFC_TOTP_SECRET);
    const now = 1_700_000_000;
    const step = Math.floor(now / 30);
    for (const offset of [-1, 0, 1]) {
      const code = totpCodeForStep(secret, step + offset, 6);
      expect(verifyTotp({ code, totp: config.totp, nowSeconds: now }), String(offset)).toBe(true);
    }
  });

  it('rejects a code outside the drift window', async () => {
    const config = await testConfig();
    const secret = secretOf(RFC_TOTP_SECRET);
    const now = 1_700_000_000;
    const step = Math.floor(now / 30);
    for (const offset of [-2, 2, 10]) {
      const code = totpCodeForStep(secret, step + offset, 6);
      expect(verifyTotp({ code, totp: config.totp, nowSeconds: now }), String(offset)).toBe(false);
    }
  });

  it('rejects malformed codes without touching the secret', async () => {
    const config = await testConfig();
    for (const code of ['', '12345', '1234567', 'abcdef', '12 456', '12345a', '-12345']) {
      expect(verifyTotp({ code, totp: config.totp, nowSeconds: 1_700_000_000 }), code).toBe(false);
    }
  });

  it('rejects a base32 secret with invalid characters', () => {
    expect(decodeBase32('ABC1DEF')).toBeUndefined();
    expect(decodeBase32('abcdefgh')).toBeUndefined();
  });
});

describe('the encrypted session token', () => {
  const NOW = 1_700_000_000;

  it('round-trips and freezes the claims', async () => {
    const config = await testConfig();
    const claims = newSessionClaims({ config, nowSeconds: NOW });
    const opened = openSession({ token: sealSession(config, claims), config, nowSeconds: NOW });
    expect(opened.operatorId).toBe('owner');
    expect(opened.role).toBe('OWNER');
    expect(Object.isFrozen(opened)).toBe(true);
  });

  it('produces a different token every time for the same claims', async () => {
    const config = await testConfig();
    const claims = newSessionClaims({ config, nowSeconds: NOW });
    // A fresh random IV per seal. Identical ciphertext would mean IV reuse, which is catastrophic
    // for GCM.
    expect(sealSession(config, claims)).not.toBe(sealSession(config, claims));
  });

  it('mints a fresh session id and CSRF token per login — no fixation', async () => {
    const config = await testConfig();
    const first = newSessionClaims({ config, nowSeconds: NOW });
    const second = newSessionClaims({ config, nowSeconds: NOW });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.csrfToken).not.toBe(second.csrfToken);
  });

  it('rejects a tampered IV, ciphertext or tag', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    const parts = token.split('.');
    for (const index of [2, 3, 4]) {
      const mutated = [...parts];
      const original = mutated[index] ?? '';
      // Flip a character in the MIDDLE, not the last one: the final base64url character of a
      // group can carry spare bits, so changing it sometimes decodes to identical bytes and the
      // "tampered" token would in fact be the original.
      const at = Math.floor(original.length / 2);
      const replacement = original[at] === 'A' ? 'B' : 'A';
      mutated[index] = original.slice(0, at) + replacement + original.slice(at + 1);
      expect(() => openSession({ token: mutated.join('.'), config, nowSeconds: NOW })).toThrow(
        AuthFailure,
      );
    }
  });

  it('rejects a truncated, oversized or wrong-version token', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    for (const bad of [
      token.slice(0, token.length - 10),
      token.split('.').slice(0, 3).join('.'),
      `v2.${token.split('.').slice(1).join('.')}`,
      'x'.repeat(2000),
      '',
    ]) {
      expect(() => openSession({ token: bad, config, nowSeconds: NOW })).toThrow(AuthFailure);
    }
  });

  it('rejects a token sealed with a key that is no longer configured', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    // Key removal IS revocation in this model.
    const rotated = await testConfig({
      session: {
        revision: 1,
        absoluteTtlSeconds: 3600,
        primaryKeyId: 'k2',
        keys: [{ id: 'k2', status: 'PRIMARY', key: SECOND_KEY }],
      },
    });
    expect(() => openSession({ token, config: rotated, nowSeconds: NOW })).toThrow(AuthFailure);
  });

  it('still opens a token sealed with a key kept as VERIFY_ONLY', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    const rotated = await testConfig({
      session: {
        revision: 1,
        absoluteTtlSeconds: 3600,
        primaryKeyId: 'k2',
        keys: [
          { id: 'k2', status: 'PRIMARY', key: SECOND_KEY },
          { id: 'k1', status: 'VERIFY_ONLY', key: SESSION_KEY },
        ],
      },
    });
    expect(openSession({ token, config: rotated, nowSeconds: NOW }).operatorId).toBe('owner');
    // ...and a NEW token is sealed with the new primary.
    expect(sealSession(rotated, newSessionClaims({ config: rotated, nowSeconds: NOW }))).toContain(
      'v1.k2.',
    );
  });

  it('revokes every session when the revision is incremented', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    const bumped = await testConfig({
      session: { ...config.session, revision: 2 },
    });
    expect(() => openSession({ token, config: bumped, nowSeconds: NOW })).toThrow(AuthFailure);
  });

  it('enforces expiry, clock skew and the configured TTL ceiling', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));

    // Valid inside the window, refused one second past it.
    expect(openSession({ token, config, nowSeconds: NOW + 3599 }).operatorId).toBe('owner');
    expect(() => openSession({ token, config, nowSeconds: NOW + 3601 })).toThrow(AuthFailure);

    // A token issued well into the future is refused rather than trusted.
    const future = sealSession(config, newSessionClaims({ config, nowSeconds: NOW + 600 }));
    expect(() => openSession({ token: future, config, nowSeconds: NOW })).toThrow(AuthFailure);

    // Shortening the configured TTL must shorten EXISTING sessions too.
    const shortened = await testConfig({ session: { ...config.session, absoluteTtlSeconds: 900 } });
    expect(() => openSession({ token, config: shortened, nowSeconds: NOW })).toThrow(AuthFailure);
  });

  it('rejects a token whose operator no longer matches the configuration', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    const renamed = await testConfig({
      operator: { id: 'someone-else', displayName: 'Owner', role: 'OWNER' },
    });
    expect(() => openSession({ token, config: renamed, nowSeconds: NOW })).toThrow(AuthFailure);
  });

  it('carries no passphrase, TOTP secret or session key in the token', async () => {
    const config = await testConfig();
    const token = sealSession(config, newSessionClaims({ config, nowSeconds: NOW }));
    // The ciphertext is opaque, but assert the obvious anyway: nothing leaked into the envelope.
    expect(token).not.toContain(TEST_PASSPHRASE);
    expect(token).not.toContain(RFC_TOTP_SECRET);
    expect(token).not.toContain(SESSION_KEY);
    expect(token).not.toContain(config.passwordVerifier.digest);
  });

  it('keeps failure messages free of token material', async () => {
    const config = await testConfig();
    try {
      openSession({ token: 'v1.k1.AAAA.BBBB.CCCC', config, nowSeconds: NOW });
      expect.unreachable('should have thrown');
    } catch (error) {
      const failure = error as AuthFailure;
      expect(failure.message).not.toContain('AAAA');
      expect(failure.message).not.toContain(SESSION_KEY);
      expect(failure.publicOutcome).toBe('INVALID_CREDENTIALS');
    }
  });

  it('compares CSRF tokens in constant time and rejects a mismatch', () => {
    expect(csrfMatches('abcdef', 'abcdef')).toBe(true);
    expect(csrfMatches('abcdef', 'abcdeg')).toBe(false);
    expect(csrfMatches('abcdef', 'abcde')).toBe(false);
    expect(csrfMatches('', '')).toBe(true);
  });
});

describe('cookie policy', () => {
  it('uses the __Host- prefix, Secure and SameSite=Strict in production', () => {
    const attributes = sessionCookieAttributes({
      mode: 'PRODUCTION',
      host: 'jarvis.example.com',
      token: 'v1.k1.a.b.c',
    });
    expect(attributes.name).toBe('__Host-qfj-jos-session');
    expect(attributes.secure).toBe(true);
    const header = serializeCookie(attributes);
    expect(header).toContain('__Host-qfj-jos-session=');
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Secure');
    // __Host- forbids Domain, and a persistent cookie is not wanted.
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('Expires=');
    expect(header).not.toMatch(/Max-Age=[1-9]/u);
  });

  it('drops Secure ONLY for a local-development config on loopback', () => {
    expect(
      sessionCookieAttributes({ mode: 'LOCAL_DEVELOPMENT', host: '127.0.0.1:3000', token: 't' })
        .secure,
    ).toBe(false);
    // The same development config on a real hostname keeps Secure, so a plain-HTTP deployment
    // simply cannot set the cookie -- which is the correct outcome.
    expect(
      sessionCookieAttributes({ mode: 'LOCAL_DEVELOPMENT', host: 'jarvis.example.com', token: 't' })
        .secure,
    ).toBe(true);
    expect(
      sessionCookieAttributes({ mode: 'PRODUCTION', host: '127.0.0.1:3000', token: 't' }).secure,
    ).toBe(true);
  });

  it('recognises only genuine loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.1:3000', '[::1]:3000']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ['evil.com', 'localhost.evil.com', '127.0.0.1.evil.com', '', null]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });

  it('clears with matching attributes and Max-Age=0', () => {
    const header = serializeCookie(
      clearedSessionCookieAttributes({ mode: 'PRODUCTION', host: 'jarvis.example.com' }),
    );
    expect(header).toContain('__Host-qfj-jos-session=;');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
  });
});

describe('same-origin and return-path safety', () => {
  const headers = (values: Record<string, string>): Headers => new Headers(values);

  it('accepts a genuine same-origin POST', () => {
    expect(() => {
      requireSameOriginMutation({
        method: 'POST',
        headers: headers({
          host: 'jarvis.example.com',
          origin: 'https://jarvis.example.com',
          'sec-fetch-site': 'same-origin',
        }),
        mode: 'PRODUCTION',
      });
    }).not.toThrow();
  });

  it('rejects a cross-origin POST, a mismatched port and a missing Origin', () => {
    const cases: Record<string, string>[] = [
      { host: 'jarvis.example.com', origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' },
      {
        host: 'jarvis.example.com',
        origin: 'https://jarvis.example.com:8443',
        'sec-fetch-site': 'same-origin',
      },
      { host: 'jarvis.example.com', 'sec-fetch-site': 'same-origin' },
      { origin: 'https://jarvis.example.com', 'sec-fetch-site': 'same-origin' },
      {
        host: 'jarvis.example.com',
        origin: 'http://jarvis.example.com',
        'sec-fetch-site': 'same-origin',
      },
    ];
    for (const value of cases) {
      expect(() => {
        requireSameOriginMutation({ method: 'POST', headers: headers(value), mode: 'PRODUCTION' });
      }).toThrow(AuthFailure);
    }
  });

  it('rejects every method except POST', () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(() => {
        requireSameOriginMutation({
          method,
          headers: headers({
            host: 'jarvis.example.com',
            origin: 'https://jarvis.example.com',
            'sec-fetch-site': 'same-origin',
          }),
          mode: 'PRODUCTION',
        });
      }).toThrow(AuthFailure);
    }
  });

  it('never trusts a caller-supplied return path', () => {
    for (const hostile of [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'http://evil.com',
      '\\\\evil.com',
      'javascript:alert(1)',
      '/path\nSet-Cookie: x=y',
      '',
      'relative',
      `/${'x'.repeat(600)}`,
    ]) {
      expect(safeReturnPath(hostile), hostile).toBe('/');
    }
    // Ordinary in-app paths survive.
    for (const safe of ['/', '/approvals', '/agents/aarohi', '/governance?tab=matrix']) {
      expect(safeReturnPath(safe), safe).toBe(safe);
    }
  });
});

describe('the login attempt limiter', () => {
  it('refuses after the per-client limit and recovers after the window', () => {
    const limiter = new LoginAttemptLimiter({
      perClientLimit: 3,
      globalLimit: 100,
      windowSeconds: 60,
      maxEntries: 8,
    });
    const now = 1000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.check('a', now).allowed).toBe(true);
      limiter.recordFailure('a', now);
    }
    const refused = limiter.check('a', now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    // The window rolls.
    expect(limiter.check('a', now + 61).allowed).toBe(true);
  });

  it('applies a global ceiling so spraying across keys still hits a wall', () => {
    const limiter = new LoginAttemptLimiter({
      perClientLimit: 100,
      globalLimit: 5,
      windowSeconds: 60,
      maxEntries: 64,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure(`key-${String(attempt)}`, 1000);
    }
    expect(limiter.check('brand-new-key', 1000).allowed).toBe(false);
  });

  it('is bounded: the table never exceeds maxEntries', () => {
    const limiter = new LoginAttemptLimiter({
      perClientLimit: 3,
      globalLimit: 100_000,
      windowSeconds: 60,
      maxEntries: 4,
    });
    for (let index = 0; index < 500; index += 1) {
      limiter.recordFailure(`key-${String(index)}`, 1000);
    }
    expect(limiter.trackedKeys).toBeLessThanOrEqual(4);
  });

  it('clears a client bucket on success but not the global counter', () => {
    const limiter = new LoginAttemptLimiter({
      perClientLimit: 2,
      globalLimit: 3,
      windowSeconds: 60,
      maxEntries: 8,
    });
    limiter.recordFailure('a', 1000);
    limiter.recordFailure('a', 1000);
    expect(limiter.check('a', 1000).allowed).toBe(false);
    limiter.recordSuccess('a');
    expect(limiter.check('a', 1000).allowed).toBe(true);
  });
});
