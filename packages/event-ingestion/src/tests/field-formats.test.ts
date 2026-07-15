import { describe, expect, it } from 'vitest';

import {
  decodeCanonicalBase64,
  decodeEd25519Signature,
  isValidKeyId,
  parseCanonicalTimestampMs,
} from '../signature/field-formats.js';

describe('isValidKeyId — the shared 1–128 keyId rule', () => {
  it('accepts a single alphanumeric', () => {
    expect(isValidKeyId('a')).toBe(true);
    expect(isValidKeyId('0')).toBe(true);
  });

  it('accepts the permitted punctuation after an alphanumeric start', () => {
    expect(isValidKeyId('core-2026.a_b:c')).toBe(true);
    expect(isValidKeyId('test-core-key-a')).toBe(true);
  });

  it('accepts exactly 128 characters and rejects 129', () => {
    expect(isValidKeyId(`a${'b'.repeat(127)}`)).toBe(true);
    expect(isValidKeyId(`a${'b'.repeat(128)}`)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidKeyId('')).toBe(false);
  });

  it('rejects a leading punctuation character', () => {
    expect(isValidKeyId('-abc')).toBe(false);
    expect(isValidKeyId('.abc')).toBe(false);
  });

  it('rejects spaces, tabs, newlines, and NUL (signing-input delimiter / control injection)', () => {
    expect(isValidKeyId('a b')).toBe(false);
    expect(isValidKeyId('a\tb')).toBe(false);
    expect(isValidKeyId('a\nb')).toBe(false);
    expect(isValidKeyId('a\rb')).toBe(false);
    expect(isValidKeyId('a\u0000b')).toBe(false);
  });

  it('rejects path separators', () => {
    expect(isValidKeyId('a/b')).toBe(false);
    expect(isValidKeyId('a\\b')).toBe(false);
  });

  it('does not coerce a non-string value — it rejects it', () => {
    expect(isValidKeyId(42)).toBe(false);
    expect(isValidKeyId(null)).toBe(false);
    expect(isValidKeyId(undefined)).toBe(false);
    // A boxed String object (typeof 'object') must be rejected, not coerced to its value.
    expect(isValidKeyId(Object('abc'))).toBe(false);
  });
});

describe('parseCanonicalTimestampMs', () => {
  it('accepts a canonical instant and returns epoch ms', () => {
    expect(parseCanonicalTimestampMs('2026-07-15T12:00:00.000Z')).toBe(
      Date.parse('2026-07-15T12:00:00.000Z'),
    );
  });

  it('rejects a non-canonical instant (no milliseconds)', () => {
    expect(parseCanonicalTimestampMs('2026-07-15T12:00:00Z')).toBeNull();
  });

  it('rejects an impossible calendar date', () => {
    expect(parseCanonicalTimestampMs('2026-13-40T12:00:00.000Z')).toBeNull();
  });
});

describe('decodeEd25519Signature', () => {
  it('accepts a canonical 88-char signature and returns 64 bytes', () => {
    const bytes = decodeEd25519Signature(`${'A'.repeat(86)}==`);
    expect(bytes?.length).toBe(64);
  });

  it('rejects wrong length, padding, alphabet, and non-canonical forms', () => {
    expect(decodeEd25519Signature('A'.repeat(88))).toBeNull();
    expect(decodeEd25519Signature(`${'A'.repeat(87)}=`)).toBeNull();
    expect(decodeEd25519Signature(`${'A'.repeat(84)}!!==`)).toBeNull();
    expect(decodeEd25519Signature(`${'A'.repeat(85)}D==`)).toBeNull();
  });
});

describe('decodeCanonicalBase64', () => {
  it('accepts canonical padded Base64', () => {
    expect(decodeCanonicalBase64(Buffer.from('hello').toString('base64'))).not.toBeNull();
  });

  it('rejects the empty string and non-canonical Base64', () => {
    expect(decodeCanonicalBase64('')).toBeNull();
    expect(decodeCanonicalBase64('abc')).toBeNull();
    expect(decodeCanonicalBase64('****')).toBeNull();
  });
});
