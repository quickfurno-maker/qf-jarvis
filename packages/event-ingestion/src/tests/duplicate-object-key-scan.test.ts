/**
 * `scanForDuplicateObjectKeys` — the internal duplicate-object-key detector (Stage 3.3.5, ADR-0033).
 *
 * These prove the security contract: a duplicate object member name at any depth is detected by
 * DECODED name (so escaped-equivalent names collide), the same name in different object scopes is
 * accepted, string contents never masquerade as keys, and deeply nested hostile input is handled
 * iteratively without a stack overflow. `'malformed'` is a deliberate defer-to-JSON.parse signal,
 * never a false duplicate.
 */
import { describe, expect, it } from 'vitest';

import { scanForDuplicateObjectKeys } from '../ingest/duplicate-object-key-scan.js';

describe('scanForDuplicateObjectKeys — duplicates rejected at every depth', () => {
  it('rejects a top-level exact duplicate', () => {
    expect(scanForDuplicateObjectKeys('{"a":1,"a":2}')).toBe('duplicate-object-key');
  });

  it('rejects a nested duplicate', () => {
    expect(scanForDuplicateObjectKeys('{"outer":{"a":1,"a":2}}')).toBe('duplicate-object-key');
  });

  it('rejects a duplicate inside an object inside an array', () => {
    expect(scanForDuplicateObjectKeys('[{"a":1,"a":2}]')).toBe('duplicate-object-key');
    expect(scanForDuplicateObjectKeys('[0,{"x":{"a":1,"a":2}}]')).toBe('duplicate-object-key');
  });

  it('rejects an escaped-equivalent duplicate ({"a":1,"\\u0061":2})', () => {
    expect(scanForDuplicateObjectKeys('{"a":1,"\\u0061":2}')).toBe('duplicate-object-key');
  });

  it('rejects a Unicode-escape duplicate against a literal (é vs \\u00e9)', () => {
    expect(scanForDuplicateObjectKeys('{"\\u00e9":1,"é":2}')).toBe('duplicate-object-key');
  });

  it('rejects a surrogate-pair-escape duplicate against a literal astral character', () => {
    // "😀" and the literal 😀 decode to the same two UTF-16 code units.
    expect(scanForDuplicateObjectKeys('{"\\uD83D\\uDE00":1,"😀":2}')).toBe('duplicate-object-key');
  });

  it('rejects an escaped-solidus duplicate ("a/b" vs "a\\/b")', () => {
    expect(scanForDuplicateObjectKeys('{"a/b":1,"a\\/b":2}')).toBe('duplicate-object-key');
  });

  it('rejects a duplicate whose name contains structural punctuation', () => {
    expect(scanForDuplicateObjectKeys('{"a,b":1,"a,b":2}')).toBe('duplicate-object-key');
    expect(scanForDuplicateObjectKeys('{"a:{}b":1,"a:{}b":2}')).toBe('duplicate-object-key');
  });

  it('rejects a duplicate separated by arbitrary whitespace', () => {
    expect(scanForDuplicateObjectKeys('{ "a" : 1 ,\n\t "a" : 2 }')).toBe('duplicate-object-key');
  });

  it('rejects the FIRST repeated name among several members', () => {
    expect(scanForDuplicateObjectKeys('{"a":1,"b":2,"a":3}')).toBe('duplicate-object-key');
  });
});

describe('scanForDuplicateObjectKeys — valid documents accepted', () => {
  it('accepts the same name in separate object scopes', () => {
    expect(scanForDuplicateObjectKeys('{"left":{"a":1},"right":{"a":2}}')).toBe('ok');
  });

  it('accepts distinct objects in an array each using the same key', () => {
    expect(scanForDuplicateObjectKeys('[{"a":1},{"a":2},{"a":3}]')).toBe('ok');
  });

  it('does not treat structural punctuation inside a STRING VALUE as keys', () => {
    expect(scanForDuplicateObjectKeys('{"a":"b:,{}c"}')).toBe('ok');
    // A serialized JSON object (with its own duplicate) sitting inside a string value is just text.
    expect(scanForDuplicateObjectKeys('{"k":"{\\"a\\":1,\\"a\\":2}"}')).toBe('ok');
  });

  it('accepts keys that merely resemble each other but decode differently', () => {
    expect(scanForDuplicateObjectKeys('{"a":1,"A":2,"ab":3}')).toBe('ok');
  });

  it('accepts scalars, arrays, nesting, and an empty object/array', () => {
    for (const value of [
      'true',
      'false',
      'null',
      '123',
      '-12.5e3',
      '"a string with : , { } inside"',
      '[]',
      '{}',
      '[1,2,3]',
      '{"a":[{"b":1},{"b":2}],"c":{"d":{"e":1}}}',
    ]) {
      expect(scanForDuplicateObjectKeys(value)).toBe('ok');
    }
  });

  it('accepts a realistic nested event-shaped object with unique keys', () => {
    const doc =
      '{"eventId":"1","payload":{"items":[{"id":"x"},{"id":"y"}],"meta":{"id":"z"}},"correlationId":"c"}';
    expect(scanForDuplicateObjectKeys(doc)).toBe('ok');
  });
});

describe('scanForDuplicateObjectKeys — malformed input defers (never a false duplicate)', () => {
  it('reports malformed for structurally broken JSON', () => {
    for (const value of [
      '',
      '   ',
      '{',
      '}',
      '{"a"}',
      '{"a":}',
      '{"a" 1}',
      '{"a":1,}',
      '[1,]',
      'not json',
      '{"a":1}extra',
      '"unterminated',
      '{"a":1,"b":2', // unterminated object
    ]) {
      expect(scanForDuplicateObjectKeys(value)).toBe('malformed');
    }
  });

  it('never reports a duplicate for a body that has none, regardless of value types', () => {
    expect(scanForDuplicateObjectKeys('{"a":"a","b":"a","c":"a"}')).toBe('ok');
    expect(scanForDuplicateObjectKeys('{"a":{"a":{"a":1}}}')).toBe('ok');
  });
});

describe('scanForDuplicateObjectKeys — hostile depth is iterative, not recursive', () => {
  it('handles very deep nesting without a stack overflow', () => {
    const depth = 50_000;
    const deepArray = '['.repeat(depth) + '1' + ']'.repeat(depth);
    expect(scanForDuplicateObjectKeys(deepArray)).toBe('ok');

    const deepObject = '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
    // Each object has exactly one key in its own scope — valid, and it must not overflow.
    expect(scanForDuplicateObjectKeys(deepObject)).toBe('ok');
  });

  it('detects a duplicate buried under deep nesting', () => {
    const depth = 20_000;
    const buried = '['.repeat(depth) + '{"a":1,"a":2}' + ']'.repeat(depth);
    expect(scanForDuplicateObjectKeys(buried)).toBe('duplicate-object-key');
  });
});
