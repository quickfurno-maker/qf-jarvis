/**
 * Adversarial tests for the strict envelope parser: hostile prototypes, accessors,
 * hidden keys, and throwing Proxy traps. The parser must reject them all with
 * `signature-malformed` (or `signature-missing`), must **never invoke a getter or a
 * setter**, and must **never throw** on untrusted input.
 */
import { describe, expect, it } from 'vitest';

import { parseSignatureEnvelope } from '../signature/signature-envelope.js';

const SIGNED_AT = '2026-07-15T12:00:00.000Z';
const BODY_DIGEST = `sha256:${'ab'.repeat(32)}`;
const VALID_SIGNATURE = `${'A'.repeat(86)}==`;

const KEYS = ['algorithm', 'keyId', 'signedAt', 'bodyDigest', 'signature'] as const;

function validValue(key: (typeof KEYS)[number]): string {
  switch (key) {
    case 'algorithm':
      return 'ed25519';
    case 'keyId':
      return 'test-core-key-a';
    case 'signedAt':
      return SIGNED_AT;
    case 'bodyDigest':
      return BODY_DIGEST;
    case 'signature':
      return VALID_SIGNATURE;
  }
}

function dataDescriptors(): PropertyDescriptorMap {
  const map: PropertyDescriptorMap = {};
  for (const key of KEYS) {
    map[key] = { value: validValue(key), enumerable: true, configurable: true, writable: true };
  }
  return map;
}

const MALFORMED = { ok: false, reason: 'signature-malformed' } as const;

describe('parseSignatureEnvelope — hostile prototypes', () => {
  it('rejects a class instance (non-plain prototype)', () => {
    class Envelope {
      public algorithm = 'ed25519';
      public keyId = 'test-core-key-a';
      public signedAt = SIGNED_AT;
      public bodyDigest = BODY_DIGEST;
      public signature = VALID_SIGNATURE;
    }
    expect(parseSignatureEnvelope(new Envelope())).toEqual(MALFORMED);
  });

  it('rejects an object whose signature is only inherited, without invoking its getter', () => {
    let reads = 0;
    const proto = {};
    Object.defineProperty(proto, 'signature', {
      get() {
        reads += 1;
        return VALID_SIGNATURE;
      },
      enumerable: true,
      configurable: true,
    });
    const object = Object.create(proto) as Record<string, unknown>;
    object['algorithm'] = 'ed25519';
    object['keyId'] = 'test-core-key-a';
    object['signedAt'] = SIGNED_AT;
    object['bodyDigest'] = BODY_DIGEST;
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
    expect(reads).toBe(0);
  });

  it('rejects an object whose algorithm is only inherited, without invoking its getter', () => {
    let reads = 0;
    const proto = {};
    Object.defineProperty(proto, 'algorithm', {
      get() {
        reads += 1;
        return 'ed25519';
      },
      enumerable: true,
      configurable: true,
    });
    const object = Object.create(proto) as Record<string, unknown>;
    object['keyId'] = 'test-core-key-a';
    object['signedAt'] = SIGNED_AT;
    object['bodyDigest'] = BODY_DIGEST;
    object['signature'] = VALID_SIGNATURE;
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
    expect(reads).toBe(0);
  });
});

describe('parseSignatureEnvelope — accessors are never invoked', () => {
  it('rejects an object using getters for every field, and invokes none of them', () => {
    let reads = 0;
    const descriptors: PropertyDescriptorMap = {};
    for (const key of KEYS) {
      descriptors[key] = {
        get() {
          reads += 1;
          return validValue(key);
        },
        enumerable: true,
        configurable: true,
      };
    }
    const object = Object.create(Object.prototype, descriptors) as Record<string, unknown>;
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
    expect(reads).toBe(0);
  });

  it('does not invoke a throwing getter and does not throw', () => {
    const descriptors = dataDescriptors();
    descriptors['signature'] = {
      get() {
        throw new Error('a getter must never be invoked');
      },
      enumerable: true,
      configurable: true,
    };
    const object = Object.create(Object.prototype, descriptors) as Record<string, unknown>;
    expect(() => parseSignatureEnvelope(object)).not.toThrow();
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
  });

  it('rejects a field defined as a setter-only accessor', () => {
    const descriptors = dataDescriptors();
    descriptors['keyId'] = {
      set(_value: unknown) {
        /* never called */
      },
      enumerable: true,
      configurable: true,
    };
    const object = Object.create(Object.prototype, descriptors) as Record<string, unknown>;
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
  });
});

describe('parseSignatureEnvelope — hidden keys', () => {
  it('rejects a symbol extra key', () => {
    const object: Record<string | symbol, unknown> = {
      algorithm: 'ed25519',
      keyId: 'test-core-key-a',
      signedAt: SIGNED_AT,
      bodyDigest: BODY_DIGEST,
      signature: VALID_SIGNATURE,
    };
    object[Symbol('extra')] = 'x';
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
  });

  it('rejects a non-enumerable extra key', () => {
    const object: Record<string, unknown> = {
      algorithm: 'ed25519',
      keyId: 'test-core-key-a',
      signedAt: SIGNED_AT,
      bodyDigest: BODY_DIGEST,
      signature: VALID_SIGNATURE,
    };
    Object.defineProperty(object, 'hidden', { value: 'x', enumerable: false });
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
  });

  it('rejects a non-enumerable approved key', () => {
    const descriptors = dataDescriptors();
    descriptors['algorithm'] = { value: 'ed25519', enumerable: false, configurable: true };
    const object = Object.create(Object.prototype, descriptors) as Record<string, unknown>;
    expect(parseSignatureEnvelope(object)).toEqual(MALFORMED);
  });
});

describe('parseSignatureEnvelope — hostile Proxy traps never escape', () => {
  function validTarget(): Record<string, string> {
    return {
      algorithm: 'ed25519',
      keyId: 'test-core-key-a',
      signedAt: SIGNED_AT,
      bodyDigest: BODY_DIGEST,
      signature: VALID_SIGNATURE,
    };
  }

  it('a Proxy that throws from getPrototypeOf yields signature-malformed', () => {
    const proxy = new Proxy(validTarget(), {
      getPrototypeOf() {
        throw new Error('trap');
      },
    });
    expect(() => parseSignatureEnvelope(proxy)).not.toThrow();
    expect(parseSignatureEnvelope(proxy)).toEqual(MALFORMED);
  });

  it('a Proxy that throws from ownKeys yields signature-malformed', () => {
    const proxy = new Proxy(validTarget(), {
      ownKeys() {
        throw new Error('trap');
      },
    });
    expect(() => parseSignatureEnvelope(proxy)).not.toThrow();
    expect(parseSignatureEnvelope(proxy)).toEqual(MALFORMED);
  });

  it('a Proxy that throws from getOwnPropertyDescriptor yields signature-malformed', () => {
    const proxy = new Proxy(validTarget(), {
      getOwnPropertyDescriptor() {
        throw new Error('trap');
      },
    });
    expect(() => parseSignatureEnvelope(proxy)).not.toThrow();
    expect(parseSignatureEnvelope(proxy)).toEqual(MALFORMED);
  });
});
