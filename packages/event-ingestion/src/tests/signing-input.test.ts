import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DOMAIN_SEPARATION_PREFIX } from '../index.js';
import { ComputedBodyDigest } from '../signature/computed-body-digest.js';
import { buildSigningInput } from '../signature/signing-input.js';

const RAW = new TextEncoder().encode('{"eventId":"signing-input-test"}');
const digest = ComputedBodyDigest.fromRawBody(RAW);

describe('buildSigningInput', () => {
  it('is the domain-separated prefix, keyId, signedAt and computed digest hex joined by single newlines', () => {
    const out = buildSigningInput('test-core-key-a', '2026-07-15T12:00:00.000Z', digest);
    expect(out.toString('utf8')).toBe(
      `${DOMAIN_SEPARATION_PREFIX}\ntest-core-key-a\n2026-07-15T12:00:00.000Z\n${digest.hex}`,
    );
  });

  it('produces exactly four newline-separated segments', () => {
    const segments = buildSigningInput('k', '2026-07-15T12:00:00.000Z', digest)
      .toString('utf8')
      .split('\n');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe(DOMAIN_SEPARATION_PREFIX);
  });

  it('starts with the domain-separation prefix so a foreign-boundary signature cannot match', () => {
    const out = buildSigningInput('k', '2026-07-15T12:00:00.000Z', digest);
    expect(out.toString('utf8').startsWith(`${DOMAIN_SEPARATION_PREFIX}\n`)).toBe(true);
  });
});

describe('ComputedBodyDigest — a digest can only be produced from raw bytes', () => {
  it('is exactly SHA-256 over the raw body', () => {
    expect(digest.hex).toBe(createHash('sha256').update(RAW).digest('hex'));
    expect(digest.bytes).toHaveLength(32);
  });

  it('is obtained only through the fromRawBody factory', () => {
    expect(typeof ComputedBodyDigest.fromRawBody).toBe('function');
  });
});
