/**
 * The loopback containment boundary.
 *
 * This is the spec that has to be right. Every other guarantee in the package -- no credential, no
 * hosted call, no paid provider, no traffic leaving the machine -- rests on a destination that cannot
 * name a remote host, and a destination is only as good as the constructor that refuses one.
 */
import { describe, expect, it } from 'vitest';

import { createRiyaLocalEngineEndpoint, riyaLocalEngineRequestUrl } from '../contracts/endpoint.js';
import type { RiyaLocalEngineEndpointV1 } from '../contracts/endpoint.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

function refusalCode(raw: string): string {
  try {
    createRiyaLocalEngineEndpoint(raw);
  } catch (error: unknown) {
    return error instanceof RiyaLocalBenchmarkError ? error.code : 'NOT_A_LOCAL_ERROR';
  }
  return 'ACCEPTED';
}

describe('the three loopback spellings are accepted, and recorded', () => {
  it('accepts an IPv4 loopback with an explicit port', () => {
    const endpoint = createRiyaLocalEngineEndpoint('http://127.0.0.1:8000');
    expect(endpoint.origin).toBe('http://127.0.0.1:8000');
    expect(endpoint.basePath).toBe('');
    expect(endpoint.hostForm).toBe('IPV4_LOOPBACK');
  });

  it('accepts the localhost name, and records that it was a NAME', () => {
    // The distinction is the honest one: a name is resolved by the operating system, and the artifact
    // says which spelling was trusted rather than implying they are equivalent.
    expect(createRiyaLocalEngineEndpoint('http://localhost:11434').hostForm).toBe('LOCALHOST_NAME');
  });

  it('accepts an IPv6 loopback', () => {
    const endpoint = createRiyaLocalEngineEndpoint('http://[::1]:8080');
    expect(endpoint.origin).toBe('http://[::1]:8080');
    expect(endpoint.hostForm).toBe('IPV6_LOOPBACK');
  });

  it('accepts a short path prefix, and normalizes a trailing slash away', () => {
    expect(createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/v1').basePath).toBe('/v1');
    expect(createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/v1/').basePath).toBe('/v1');
  });
});

describe('everything else is refused', () => {
  it('refuses a remote hostname', () => {
    expect(refusalCode('http://api.example.com:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(refusalCode('http://engine.internal:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses every hosted-provider shape, whatever the scheme', () => {
    // The one-character mistake this whole boundary exists to prevent.
    expect(refusalCode('https://api.openai.com/v1')).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(refusalCode('https://api.anthropic.com')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses https even to a loopback address', () => {
    // A process on this machine needs no TLS, and permitting the scheme is how a public host arrives
    // later under a rule that already says yes to https.
    expect(refusalCode('https://127.0.0.1:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses a LAN address', () => {
    for (const raw of [
      'http://192.168.1.50:8000',
      'http://10.0.0.7:8000',
      'http://172.16.4.4:8000',
    ]) {
      expect(refusalCode(raw), raw).toBe('ENDPOINT_NOT_LOOPBACK');
    }
  });

  it('refuses a public address', () => {
    expect(refusalCode('http://93.184.216.34:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses 0.0.0.0, which is a bind address and not a destination', () => {
    expect(refusalCode('http://0.0.0.0:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses a loopback-adjacent address that is not exactly 127.0.0.1', () => {
    // 127.0.0.2 is loopback too. It is still refused: the allowlist is three exact spellings, so
    // there is no range to reason about and no edge for a future reader to widen.
    expect(refusalCode('http://127.0.0.2:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
  });

  it('refuses a credential embedded in the URL', () => {
    expect(refusalCode('http://user:secret@127.0.0.1:8000')).toBe('ENDPOINT_INVALID');
    expect(refusalCode('http://token@127.0.0.1:8000')).toBe('ENDPOINT_INVALID');
  });

  it('refuses a query string or a fragment, where a key would be hidden', () => {
    expect(refusalCode('http://127.0.0.1:8000/v1?api_key=abc')).toBe('ENDPOINT_INVALID');
    expect(refusalCode('http://127.0.0.1:8000/v1#abc')).toBe('ENDPOINT_INVALID');
  });

  it('refuses a missing port', () => {
    expect(refusalCode('http://127.0.0.1')).toBe('ENDPOINT_INVALID');
    expect(refusalCode('http://localhost')).toBe('ENDPOINT_INVALID');
  });

  it('lets no traversal segment survive into the base path', () => {
    // A literal `..` is resolved by URL parsing before this constructor sees it, so the honest
    // assertion is about the RESULT rather than about a refusal: whatever the operator typed, the
    // stored prefix is a plain path.
    expect(createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/v1/../admin').basePath).toBe(
      '/admin',
    );
    expect(createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/..').basePath).toBe('');
  });

  it('refuses any percent escape that SURVIVES normalization', () => {
    // `%2e%2e` is resolved by the parser like a literal `..`, so it never reaches the grammar. An
    // encoded SLASH is not resolved -- it stays in the pathname and an engine decoding it server-side
    // would see a path separator the check never split on. The segment grammar refuses the escape
    // outright rather than trying to decide which ones are harmless.
    expect(createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/v1/%2e%2e/admin').basePath).toBe(
      '/admin',
    );
    expect(refusalCode('http://127.0.0.1:8000/v1%2f%2e%2e')).toBe('ENDPOINT_INVALID');
    expect(refusalCode('http://127.0.0.1:8000/v1%2fadmin')).toBe('ENDPOINT_INVALID');
  });

  it('refuses a non-http scheme and a non-URL', () => {
    expect(refusalCode('file:///etc/passwd')).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(refusalCode('ws://127.0.0.1:8000')).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(refusalCode('127.0.0.1:8000')).toBe('ENDPOINT_INVALID');
    expect(refusalCode('')).toBe('ENDPOINT_INVALID');
  });
});

describe('the request URL is re-proved at the socket', () => {
  it('joins only the closed set of paths', () => {
    const endpoint = createRiyaLocalEngineEndpoint('http://127.0.0.1:8000/v1');
    expect(riyaLocalEngineRequestUrl(endpoint, '/chat/completions')).toBe(
      'http://127.0.0.1:8000/v1/chat/completions',
    );
    expect(riyaLocalEngineRequestUrl(endpoint, '/models')).toBe('http://127.0.0.1:8000/v1/models');
  });

  it('refuses a path outside the closed set', () => {
    const endpoint = createRiyaLocalEngineEndpoint('http://127.0.0.1:8000');
    expect(() =>
      // A caller reaching this function through JavaScript, a cast or a deserialization is exactly the
      // case the runtime check exists for.
      riyaLocalEngineRequestUrl(endpoint, '/shutdown' as '/models'),
    ).toThrow(RiyaLocalBenchmarkError);
  });

  it('NEGATIVE CONTROL: a forged endpoint value is refused rather than believed', () => {
    // The type says loopback; the value says otherwise. This is what a cast, a `JSON.parse` or a
    // future refactor would produce, and it is the case where believing the type would send a
    // benchmark request to a host nobody reviewed. If the re-proof in `riyaLocalEngineRequestUrl`
    // were removed, this expectation fails and the URL below comes back pointing at example.com.
    const forged = {
      version: 1,
      origin: 'http://api.example.com:443',
      basePath: '/v1',
      hostForm: 'IPV4_LOOPBACK',
    } as RiyaLocalEngineEndpointV1;
    expect(() => riyaLocalEngineRequestUrl(forged, '/chat/completions')).toThrow(
      RiyaLocalBenchmarkError,
    );
  });
});
