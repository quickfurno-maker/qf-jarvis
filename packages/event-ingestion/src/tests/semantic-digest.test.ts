/**
 * The Stage 3.3 semantic-digest foundation (ADR-0029), tested before it exists.
 *
 * The digest is `sha256(utf8(canonicalise(validatedEvent)))`, rendered as 64 lowercase
 * hex characters. Canonicalisation sorts object keys (UTF-16 code-unit order), preserves
 * array order, serialises primitives with ECMAScript JSON semantics, does NOT normalise
 * Unicode, and refuses programmer misuse through a bounded, value-free error.
 *
 * The canonical string is deliberately NOT exported, so every property below is observed
 * through the digest — which is exactly how a real duplicate comparison will observe it.
 * Several tests cross-check against an INDEPENDENTLY constructed canonical string (built
 * with `JSON.stringify` on the primitives, which is the ECMAScript serialisation ADR-0029
 * rule 4 mandates) hashed with `node:crypto`, so the implementation is pinned rather than
 * merely self-consistent.
 *
 * This algorithm is internal semantic-duplicate comparison. It is NOT the signing
 * canonicalisation — the Stage 3.2 verifier still signs the exact raw bytes (ADR-0027).
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

// Imported from the INTERNAL modules on purpose (ADR-0029): the semantic-digest foundation is
// compiled internally and is NOT part of the package-root public surface. `public-api.test.ts`
// asserts its absence from `../index.js`.
import { SemanticCanonicalisationError } from '../ingest/errors.js';
import { computeSemanticEventDigest } from '../ingest/semantic-digest.js';

/** Independently constructed SHA-256 over a UTF-8 canonical string, as 64 lowercase hex. */
function sha256Hex(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const HEX_64 = /^[0-9a-f]{64}$/;

describe('semantic digest — result shape', () => {
  it('returns exactly { algorithm: "sha256", hex } with 64 lowercase hex characters', () => {
    const result = computeSemanticEventDigest({ eventId: 'E1', payload: { n: 1 } });
    expect(result.algorithm).toBe('sha256');
    expect(result.hex).toMatch(HEX_64);
    expect(Object.keys(result).sort()).toEqual(['algorithm', 'hex']);
  });

  it('returns a frozen, immutable result', () => {
    const result = computeSemanticEventDigest({ a: 1 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('is deterministic across repeated calls on equal inputs', () => {
    const a = computeSemanticEventDigest({ a: 1, b: [1, 2, 3] });
    const b = computeSemanticEventDigest({ a: 1, b: [1, 2, 3] });
    expect(a.hex).toBe(b.hex);
  });
});

describe('semantic digest — object key order is irrelevant', () => {
  it('root key order does not change the digest', () => {
    const one = computeSemanticEventDigest({ b: 1, a: 2, c: 3 });
    const two = computeSemanticEventDigest({ c: 3, a: 2, b: 1 });
    expect(one.hex).toBe(two.hex);
  });

  it('root key order matches the independently sorted canonical string', () => {
    const expected = sha256Hex(`{${JSON.stringify('a')}:2,${JSON.stringify('b')}:1}`);
    expect(computeSemanticEventDigest({ b: 1, a: 2 }).hex).toBe(expected);
  });

  it('nested key order does not change the digest', () => {
    const one = computeSemanticEventDigest({ outer: { z: 1, a: 2, m: 3 } });
    const two = computeSemanticEventDigest({ outer: { a: 2, m: 3, z: 1 } });
    expect(one.hex).toBe(two.hex);
  });

  it('nested key order matches the independently sorted canonical string', () => {
    // {"outer":{"a":2,"z":1}}
    const inner = `{${JSON.stringify('a')}:2,${JSON.stringify('z')}:1}`;
    const expected = sha256Hex(`{${JSON.stringify('outer')}:${inner}}`);
    expect(computeSemanticEventDigest({ outer: { z: 1, a: 2 } }).hex).toBe(expected);
  });

  it('key sorting is by UTF-16 code unit, not locale', () => {
    // Uppercase 'Z' (0x5A) sorts before lowercase 'a' (0x61) by code unit.
    const expected = sha256Hex(`{${JSON.stringify('Z')}:1,${JSON.stringify('a')}:2}`);
    expect(computeSemanticEventDigest({ a: 2, Z: 1 }).hex).toBe(expected);
  });
});

describe('semantic digest — whitespace is irrelevant after parsing', () => {
  it('two objects that differ only in original JSON whitespace digest identically', () => {
    // Both parse to the same in-memory value; the digest is over the value, not the text.
    const fromCompact: unknown = JSON.parse('{"a":1,"b":2}');
    const fromSpaced: unknown = JSON.parse('{\n  "b":  2,\n  "a": 1\n}');
    expect(computeSemanticEventDigest(fromCompact).hex).toBe(
      computeSemanticEventDigest(fromSpaced).hex,
    );
  });
});

describe('semantic digest — array order is preserved', () => {
  it('same array order → same digest', () => {
    expect(computeSemanticEventDigest({ xs: [1, 2, 3] }).hex).toBe(
      computeSemanticEventDigest({ xs: [1, 2, 3] }).hex,
    );
  });

  it('different array order → different digest', () => {
    expect(computeSemanticEventDigest({ xs: [1, 2, 3] }).hex).not.toBe(
      computeSemanticEventDigest({ xs: [3, 2, 1] }).hex,
    );
  });

  it('array order matches the independently constructed canonical string', () => {
    const expected = sha256Hex(`{${JSON.stringify('xs')}:[3,1,2]}`);
    expect(computeSemanticEventDigest({ xs: [3, 1, 2] }).hex).toBe(expected);
  });
});

describe('semantic digest — string escaping is deterministic JSON', () => {
  it('escapes control characters exactly as ECMAScript JSON does', () => {
    const value = 'x\ny\tz"q\\r';
    const expected = sha256Hex(`{${JSON.stringify('s')}:${JSON.stringify(value)}}`);
    expect(computeSemanticEventDigest({ s: value }).hex).toBe(expected);
  });

  it('distinct strings produce distinct digests', () => {
    expect(computeSemanticEventDigest({ s: 'a' }).hex).not.toBe(
      computeSemanticEventDigest({ s: 'b' }).hex,
    );
  });
});

describe('semantic digest — Unicode is NOT normalized', () => {
  it('composed (NFC) and decomposed (NFD) forms digest differently', () => {
    const composed = 'é'; // é
    const decomposed = 'é'; // e + combining acute
    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC')); // equal only after normalisation
    expect(computeSemanticEventDigest({ n: composed }).hex).not.toBe(
      computeSemanticEventDigest({ n: decomposed }).hex,
    );
  });

  it('each Unicode form matches its own independently constructed canonical string', () => {
    const composed = 'é';
    const expected = sha256Hex(`{${JSON.stringify('n')}:${JSON.stringify(composed)}}`);
    expect(computeSemanticEventDigest({ n: composed }).hex).toBe(expected);
  });
});

describe('semantic digest — number serialisation', () => {
  it('negative zero and positive zero canonicalise identically', () => {
    expect(computeSemanticEventDigest({ n: -0 }).hex).toBe(
      computeSemanticEventDigest({ n: 0 }).hex,
    );
  });

  it('negative zero serialises as "0"', () => {
    const expected = sha256Hex(`{${JSON.stringify('n')}:0}`);
    expect(computeSemanticEventDigest({ n: -0 }).hex).toBe(expected);
  });

  it.each([
    ['integer', 42, '42'],
    ['decimal', 1.5, '1.5'],
    ['exponent', 1e21, '1e+21'],
    ['min safe integer', Number.MIN_SAFE_INTEGER, String(Number.MIN_SAFE_INTEGER)],
    ['max safe integer', Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
  ])('serialises a finite %s deterministically', (_label, value, serialised) => {
    const expected = sha256Hex(`{${JSON.stringify('n')}:${serialised}}`);
    expect(computeSemanticEventDigest({ n: value }).hex).toBe(expected);
  });
});

describe('semantic digest — the envelope-plus-payload shape it will really see', () => {
  it('digests a realistic validated canonical event structure deterministically', () => {
    const event = {
      eventId: '6f1b3f5e-2b7a-4f0d-9a1e-2c3d4e5f6a7b',
      eventType: 'qf.recommendation.created',
      eventVersion: 1,
      occurredAt: '2026-07-11T09:00:00.000Z',
      emittedAt: '2026-07-11T09:00:05.000Z',
      source: 'quickfurno-core',
      subject: { entityType: 'lead', entityId: 'CORE-LEAD-00042' },
      correlationId: '11111111-2222-3333-4444-555555555555',
      payload: { score: 3, reasons: ['stale', 'high-value'] },
    };
    const reordered = {
      payload: { reasons: ['stale', 'high-value'], score: 3 },
      subject: { entityId: 'CORE-LEAD-00042', entityType: 'lead' },
      source: 'quickfurno-core',
      correlationId: '11111111-2222-3333-4444-555555555555',
      emittedAt: '2026-07-11T09:00:05.000Z',
      occurredAt: '2026-07-11T09:00:00.000Z',
      eventVersion: 1,
      eventType: 'qf.recommendation.created',
      eventId: '6f1b3f5e-2b7a-4f0d-9a1e-2c3d4e5f6a7b',
    };
    expect(computeSemanticEventDigest(event).hex).toBe(computeSemanticEventDigest(reordered).hex);
    expect(computeSemanticEventDigest(event).hex).toMatch(HEX_64);
  });
});

describe('semantic digest — the caller input is never mutated', () => {
  it('does not reorder, add, or remove keys on the input object', () => {
    const input = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const before = JSON.stringify(input);
    const keysBefore = Object.keys(input);
    computeSemanticEventDigest(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.keys(input)).toEqual(keysBefore);
    expect(Object.keys(input.nested)).toEqual(['y', 'x']);
  });
});

describe('semantic digest — null-prototype plain objects are accepted', () => {
  it('treats a null-prototype object identically to a normal plain object', () => {
    const nullProto = Object.assign(Object.create(null) as object, { b: 1, a: 2 }) as Record<
      string,
      unknown
    >;
    const expected = computeSemanticEventDigest({ a: 2, b: 1 }).hex;
    expect(computeSemanticEventDigest(nullProto).hex).toBe(expected);
  });
});

describe('semantic digest — clock independence', () => {
  it('computes without reading the clock (Date.now replaced with a throwing stub)', () => {
    const originalNow = Date.now;
    Date.now = (): number => {
      throw new Error('the semantic digest must not read the clock');
    };
    try {
      expect(computeSemanticEventDigest({ a: 1 }).hex).toMatch(HEX_64);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe('semantic digest — rejects programmer misuse', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;

  const sparse: number[] = Array<number>(3);
  sparse[0] = 1;
  sparse[2] = 3; // index 1 is a hole

  const symbolKeyed: Record<string, unknown> = {};
  Object.defineProperty(symbolKeyed, Symbol('secret'), { value: 1, enumerable: true });

  class SampleInstance {
    public readonly kind = 'instance';
  }

  const cases: readonly (readonly [label: string, value: unknown, code: string])[] = [
    ['NaN', { n: Number.NaN }, 'non-finite-number'],
    ['Infinity', { n: Number.POSITIVE_INFINITY }, 'non-finite-number'],
    ['-Infinity', { n: Number.NEGATIVE_INFINITY }, 'non-finite-number'],
    ['undefined', { n: undefined }, 'unsupported-value'],
    ['bigint', { n: 1n }, 'unsupported-value'],
    ['function', { n: (): void => undefined }, 'unsupported-value'],
    ['symbol value', { n: Symbol('x') }, 'unsupported-value'],
    ['sparse array', { xs: sparse }, 'sparse-array'],
    ['cyclic object', cyclic, 'cyclic-value'],
    ['Date', { d: new Date(0) }, 'non-plain-object'],
    ['Map', { m: new Map() }, 'non-plain-object'],
    ['Set', { s: new Set() }, 'non-plain-object'],
    ['class instance', { c: new SampleInstance() }, 'non-plain-object'],
    ['symbol key', symbolKeyed, 'symbol-key'],
  ];

  it.each(cases)('rejects %s with a stable safe error code', (_label, value, code) => {
    expect(() => computeSemanticEventDigest(value)).toThrow(SemanticCanonicalisationError);
    try {
      computeSemanticEventDigest(value);
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const semantic = error as SemanticCanonicalisationError;
      expect(semantic.code).toBe(code);
      expect(typeof semantic.path).toBe('string');
    }
  });

  it('rejects an accessor property WITHOUT invoking its getter', () => {
    let getterInvoked = false;
    const withGetter: Record<string, unknown> = {};
    Object.defineProperty(withGetter, 'danger', {
      enumerable: true,
      get: (): string => {
        getterInvoked = true;
        return 'a-secret-that-must-never-be-read';
      },
    });

    expect(() => computeSemanticEventDigest(withGetter)).toThrow(SemanticCanonicalisationError);
    expect(getterInvoked).toBe(false);

    try {
      computeSemanticEventDigest(withGetter);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      expect((error as SemanticCanonicalisationError).code).toBe('accessor-property');
    }
    expect(getterInvoked).toBe(false);
  });
});

describe('semantic digest — rejection errors are safe (no value, no payload leak)', () => {
  it('does not include the rejected value or payload content in the error', () => {
    const secret = 'sensitive-free-text-9876543210-that-must-not-leak';
    const value = { contact: secret, bad: 1n };
    try {
      computeSemanticEventDigest(value);
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const message = (error as SemanticCanonicalisationError).message;
      const path = (error as SemanticCanonicalisationError).path;
      expect(message).not.toContain(secret);
      expect(path).not.toContain(secret);
      // The message names only the stable code and a structural path.
      expect(message).toContain('unsupported-value');
    }
  });

  it('does not include a raw OBJECT KEY (which may itself be sensitive) in the error', () => {
    // The sensitive string is the KEY, not the value. A key can carry an email, phone, or
    // free text, so it must never reach an error path or message (ADR-0029 correction).
    const hostileKey = 'client-secret@example.com';
    const value: Record<string, unknown> = {};
    value[hostileKey] = 1n; // a bad value under the hostile key forces a failure at that key
    try {
      computeSemanticEventDigest(value);
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const semantic = error as SemanticCanonicalisationError;
      for (const fragment of [hostileKey, 'client-secret', 'example.com', '@']) {
        expect(semantic.message).not.toContain(fragment);
        expect(semantic.path).not.toContain(fragment);
      }
      // The path uses a sorted-key ordinal token, not the key text.
      expect(semantic.path).toContain('[key#0]');
    }
  });

  it('does not include a symbol key description in the error', () => {
    const withSymbolKey: Record<string, unknown> = {};
    Object.defineProperty(withSymbolKey, Symbol('secret-symbol-description'), {
      value: 1,
      enumerable: true,
    });
    try {
      computeSemanticEventDigest(withSymbolKey);
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const semantic = error as SemanticCanonicalisationError;
      expect(semantic.code).toBe('symbol-key');
      expect(semantic.message).not.toContain('secret-symbol-description');
      expect(semantic.path).not.toContain('secret-symbol-description');
    }
  });

  it('carries only a code from the closed set', () => {
    const codes = new Set([
      'unsupported-value',
      'non-finite-number',
      'sparse-array',
      'cyclic-value',
      'non-plain-object',
      'accessor-property',
      'symbol-key',
    ]);
    try {
      computeSemanticEventDigest({ n: Number.NaN });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      expect(codes.has((error as SemanticCanonicalisationError).code)).toBe(true);
    }
  });
});

describe('semantic digest — descriptor-only object reads', () => {
  it('reads object data from its own descriptor value', () => {
    const built: Record<string, unknown> = {};
    Object.defineProperty(built, 'a', {
      value: 1,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(built, 'b', {
      value: 2,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(computeSemanticEventDigest(built).hex).toBe(
      computeSemanticEventDigest({ a: 1, b: 2 }).hex,
    );
  });

  it('rejects a non-enumerable own data property as unsupported-value', () => {
    const withHidden: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(withHidden, 'hidden', {
      value: 2,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    try {
      computeSemanticEventDigest(withHidden);
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      expect((error as SemanticCanonicalisationError).code).toBe('unsupported-value');
    }
  });
});

describe('semantic digest — safe array inspection (descriptor-only)', () => {
  it('canonicalises ordinary dense arrays identically', () => {
    const expected = sha256Hex(`{${JSON.stringify('xs')}:[1,2,3]}`);
    expect(computeSemanticEventDigest({ xs: [1, 2, 3] }).hex).toBe(expected);
  });

  it('rejects a getter at an array index and never invokes it', () => {
    let getterInvoked = false;
    const arr: unknown[] = [];
    Object.defineProperty(arr, 0, {
      enumerable: true,
      configurable: true,
      get: () => {
        getterInvoked = true;
        return 1;
      },
    });
    expect(() => computeSemanticEventDigest({ xs: arr })).toThrow(SemanticCanonicalisationError);
    expect(getterInvoked).toBe(false);
    try {
      computeSemanticEventDigest({ xs: arr });
    } catch (error: unknown) {
      expect((error as SemanticCanonicalisationError).code).toBe('accessor-property');
    }
    expect(getterInvoked).toBe(false);
  });

  it('rejects a setter-only array index and never invokes it', () => {
    let setterInvoked = false;
    const arr: unknown[] = [];
    Object.defineProperty(arr, 0, {
      enumerable: true,
      configurable: true,
      set: () => {
        setterInvoked = true;
      },
    });
    try {
      computeSemanticEventDigest({ xs: arr });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect((error as SemanticCanonicalisationError).code).toBe('accessor-property');
    }
    expect(setterInvoked).toBe(false);
  });

  it('rejects a symbol key on an array without reading its description', () => {
    const arr: unknown[] = [1];
    Object.defineProperty(arr, Symbol('array-symbol-secret'), { value: 2, enumerable: true });
    try {
      computeSemanticEventDigest({ xs: arr });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      const semantic = error as SemanticCanonicalisationError;
      expect(semantic.code).toBe('symbol-key');
      expect(semantic.message).not.toContain('array-symbol-secret');
    }
  });

  it('rejects an extra own string property on an array', () => {
    const arr: unknown[] = [1];
    Object.defineProperty(arr, 'foo', {
      value: 'x',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    try {
      computeSemanticEventDigest({ xs: arr });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect((error as SemanticCanonicalisationError).code).toBe('unsupported-value');
    }
  });

  it('rejects a non-enumerable array index', () => {
    const arr: unknown[] = [];
    Object.defineProperty(arr, 0, {
      value: 1,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    try {
      computeSemanticEventDigest({ xs: arr });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect((error as SemanticCanonicalisationError).code).toBe('unsupported-value');
    }
  });

  it('does not let an inherited index fill a sparse hole, and never invokes an inherited getter', () => {
    let inheritedGetterInvoked = false;
    const proto: Record<string, unknown> = {};
    Object.defineProperty(proto, '0', {
      enumerable: true,
      get: () => {
        inheritedGetterInvoked = true;
        return 'INHERITED';
      },
    });
    const arr: unknown[] = Array<unknown>(2);
    arr[1] = 'b'; // index 0 is a hole
    Object.setPrototypeOf(arr, proto);

    try {
      computeSemanticEventDigest({ xs: arr });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect((error as SemanticCanonicalisationError).code).toBe('sparse-array');
    }
    expect(inheritedGetterInvoked).toBe(false);
  });
});

describe('semantic digest — bounded reflection failures (hostile / revoked Proxy)', () => {
  it('converts a revoked Proxy into a bounded unsupported-value error, leaking no trap text', () => {
    const revocable = Proxy.revocable<Record<string, unknown>>({}, {});
    revocable.revoke();
    try {
      computeSemanticEventDigest({ p: revocable.proxy });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const semantic = error as SemanticCanonicalisationError;
      expect(semantic.code).toBe('unsupported-value');
      expect(semantic.message.toLowerCase()).not.toContain('revoked');
      expect(semantic.message.toLowerCase()).not.toContain('proxy');
      expect((semantic as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it('does not let a throwing trap message escape', () => {
    const trapSecret = 'trap-secret-must-not-escape';
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(trapSecret);
        },
      },
    );
    try {
      computeSemanticEventDigest({ p: hostile });
      throw new Error('expected a SemanticCanonicalisationError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SemanticCanonicalisationError);
      const semantic = error as SemanticCanonicalisationError;
      expect(semantic.code).toBe('unsupported-value');
      expect(semantic.message).not.toContain(trapSecret);
      expect((semantic as { cause?: unknown }).cause).toBeUndefined();
    }
  });
});
