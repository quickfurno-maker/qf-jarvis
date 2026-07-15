import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MAX_PUBLIC_KEY_RECORDS,
  PublicKeyRegistry,
  PublicKeyRegistryError,
  type PublicKeyConfigRecord,
  type RegistryEnvironment,
} from '../index.js';
import { TEST_KEY_ID, testConfigRecord } from './fixtures/registry.js';
import { TEST_PRIVATE_KEY_PKCS8_B64, TEST_PUBLIC_KEY_SPKI_B64 } from './fixtures/test-keys.js';

/** A non-Ed25519 (EC P-256) public key, as SPKI DER Base64. */
const ecPublicKeySpkiB64 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .publicKey.export({ format: 'der', type: 'spki' })
  .toString('base64');

function distinctKeyRecords(count: number): PublicKeyConfigRecord[] {
  return Array.from({ length: count }, (_unused, index) =>
    testConfigRecord({ keyId: `test-core-key-${String(index)}` }),
  );
}

describe('PublicKeyRegistry — lookup and immutability', () => {
  it('finds a key by its exact id and returns primitive validity bounds', () => {
    const registry = new PublicKeyRegistry([testConfigRecord()], 'test');
    const found = registry.find(TEST_KEY_ID);
    expect(found?.keyId).toBe(TEST_KEY_ID);
    expect(typeof found?.validFromMs).toBe('number');
    expect(typeof found?.validUntilMs).toBe('number');
    expect(registry.size).toBe(1);
  });

  it('returns undefined for an unknown id — it never guesses', () => {
    const registry = new PublicKeyRegistry([testConfigRecord()], 'test');
    expect(registry.find('test-core-key-z')).toBeUndefined();
  });

  it('mutating the source record after construction cannot change registry behaviour', () => {
    const record = testConfigRecord();
    const registry = new PublicKeyRegistry([record], 'test');
    // Mutate the caller-owned record object.
    const mutable = record as { status: string; validUntil: string };
    mutable.status = 'revoked';
    mutable.validUntil = '2000-01-01T00:00:00.000Z';
    const snapshot = registry.find(TEST_KEY_ID);
    expect(snapshot?.status).toBe('active');
    expect(snapshot?.validUntilMs).toBe(Date.parse('2027-01-01T00:00:00.000Z'));
  });
});

describe('PublicKeyRegistry — bounds and duplicates', () => {
  it('accepts exactly 32 records', () => {
    expect(new PublicKeyRegistry(distinctKeyRecords(MAX_PUBLIC_KEY_RECORDS), 'test').size).toBe(32);
  });

  it('rejects 33 records', () => {
    expect(
      () => new PublicKeyRegistry(distinctKeyRecords(MAX_PUBLIC_KEY_RECORDS + 1), 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a duplicate keyId', () => {
    expect(() => new PublicKeyRegistry([testConfigRecord(), testConfigRecord()], 'test')).toThrow(
      PublicKeyRegistryError,
    );
  });
});

describe('PublicKeyRegistry — environment and keyId', () => {
  it('rejects a test- keyId in production', () => {
    expect(() => new PublicKeyRegistry([testConfigRecord()], 'production')).toThrow(/production/);
  });

  it('accepts a test- keyId in test and development', () => {
    expect(new PublicKeyRegistry([testConfigRecord()], 'test').size).toBe(1);
    expect(new PublicKeyRegistry([testConfigRecord()], 'development').size).toBe(1);
  });

  it('accepts a non-test keyId in production', () => {
    const record = testConfigRecord({ keyId: 'core-2026-a' });
    expect(new PublicKeyRegistry([record], 'production').size).toBe(1);
  });

  it('rejects an invalid keyId (contains a space)', () => {
    expect(() => new PublicKeyRegistry([testConfigRecord({ keyId: 'bad key' })], 'test')).toThrow(
      PublicKeyRegistryError,
    );
  });

  it('rejects an invalid keyId (contains a newline)', () => {
    expect(() => new PublicKeyRegistry([testConfigRecord({ keyId: 'a\nb' })], 'test')).toThrow(
      PublicKeyRegistryError,
    );
  });

  it('rejects an unknown environment', () => {
    const badEnvironment = 'staging' as unknown as RegistryEnvironment;
    expect(() => new PublicKeyRegistry([testConfigRecord()], badEnvironment)).toThrow(
      PublicKeyRegistryError,
    );
  });
});

describe('PublicKeyRegistry — record validation', () => {
  it('rejects a wrong purpose', () => {
    expect(
      () => new PublicKeyRegistry([testConfigRecord({ purpose: 'something-else' })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects an invalid status', () => {
    const badStatus = {
      ...testConfigRecord(),
      status: 'active-ish',
    } as unknown as PublicKeyConfigRecord;
    expect(() => new PublicKeyRegistry([badStatus], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects malformed Base64 for the public key', () => {
    expect(
      () =>
        new PublicKeyRegistry([testConfigRecord({ publicKeySpkiDerBase64: 'not*base64' })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects malformed DER (valid Base64, not a key)', () => {
    const junkDer = Buffer.alloc(44, 1).toString('base64');
    expect(
      () => new PublicKeyRegistry([testConfigRecord({ publicKeySpkiDerBase64: junkDer })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a private key supplied where a public key belongs', () => {
    expect(
      () =>
        new PublicKeyRegistry(
          [testConfigRecord({ publicKeySpkiDerBase64: TEST_PRIVATE_KEY_PKCS8_B64 })],
          'test',
        ),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a non-Ed25519 public key', () => {
    expect(
      () =>
        new PublicKeyRegistry(
          [testConfigRecord({ publicKeySpkiDerBase64: ecPublicKeySpkiB64 })],
          'test',
        ),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a non-canonical validity timestamp', () => {
    expect(
      () =>
        new PublicKeyRegistry([testConfigRecord({ validFrom: '2026-01-01T00:00:00Z' })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects validFrom on or after validUntil', () => {
    expect(
      () =>
        new PublicKeyRegistry(
          [
            testConfigRecord({
              validFrom: '2027-01-01T00:00:00.000Z',
              validUntil: '2026-01-01T00:00:00.000Z',
            }),
          ],
          'test',
        ),
    ).toThrow(PublicKeyRegistryError);
  });

  it('does not leak the public key bytes in an error message', () => {
    try {
      new PublicKeyRegistry([testConfigRecord({ purpose: 'wrong' })], 'test');
      expect.unreachable('construction should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PublicKeyRegistryError);
      expect((error as Error).message).not.toContain(TEST_PUBLIC_KEY_SPKI_B64);
    }
  });
});

describe('PublicKeyRegistry — canonical SPKI DER (not just canonical Base64)', () => {
  const validDer = Buffer.from(TEST_PUBLIC_KEY_SPKI_B64, 'base64');

  it('rejects valid Ed25519 SPKI DER plus one trailing zero byte', () => {
    const withTrailing = Buffer.concat([validDer, Buffer.from([0])]).toString('base64');
    expect(
      () =>
        new PublicKeyRegistry([testConfigRecord({ publicKeySpkiDerBase64: withTrailing })], 'test'),
    ).toThrow(/canonical SPKI DER/);
  });

  it('rejects valid Ed25519 SPKI DER plus several trailing bytes', () => {
    const withTrailing = Buffer.concat([validDer, Buffer.from([1, 2, 3, 4])]).toString('base64');
    expect(
      () =>
        new PublicKeyRegistry([testConfigRecord({ publicKeySpkiDerBase64: withTrailing })], 'test'),
    ).toThrow(/canonical SPKI DER/);
  });

  it('rejects an over-long Base64 public key before decoding', () => {
    expect(
      () =>
        new PublicKeyRegistry(
          [testConfigRecord({ publicKeySpkiDerBase64: 'A'.repeat(200) })],
          'test',
        ),
    ).toThrow(/over-long/);
  });

  it('rejects a non-string publicKeySpkiDerBase64', () => {
    const bad = {
      ...testConfigRecord(),
      publicKeySpkiDerBase64: 12345,
    } as unknown as PublicKeyConfigRecord;
    expect(() => new PublicKeyRegistry([bad], 'test')).toThrow(PublicKeyRegistryError);
  });
});

describe('PublicKeyRegistry — strict runtime validation of config records', () => {
  function asRecord(value: unknown): PublicKeyConfigRecord {
    return value as PublicKeyConfigRecord;
  }

  it('rejects a non-array records argument', () => {
    expect(() => new PublicKeyRegistry({} as unknown as PublicKeyConfigRecord[], 'test')).toThrow(
      PublicKeyRegistryError,
    );
  });

  it('rejects a null record', () => {
    expect(() => new PublicKeyRegistry([asRecord(null)], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects an array record', () => {
    expect(() => new PublicKeyRegistry([asRecord([])], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a class-instance record', () => {
    class Record {
      public keyId = 'test-core-key-a';
      public publicKeySpkiDerBase64 = TEST_PUBLIC_KEY_SPKI_B64;
      public status = 'active';
      public purpose = 'core-to-jarvis-event';
      public validFrom = '2026-01-01T00:00:00.000Z';
      public validUntil = '2027-01-01T00:00:00.000Z';
    }
    expect(() => new PublicKeyRegistry([asRecord(new Record())], 'test')).toThrow(
      PublicKeyRegistryError,
    );
  });

  it('rejects a numeric keyId (no coercion)', () => {
    expect(
      () => new PublicKeyRegistry([asRecord({ ...testConfigRecord(), keyId: 42 })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a String-object keyId (typeof object, not string)', () => {
    // A boxed String object (typeof 'object') must be rejected, not coerced.
    const boxedKeyId: unknown = Object('test-core-key-a');
    const record = { ...testConfigRecord(), keyId: boxedKeyId };
    expect(() => new PublicKeyRegistry([asRecord(record)], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a getter-valued field without invoking the getter', () => {
    let reads = 0;
    const record = Object.create(Object.prototype, {
      keyId: { value: 'test-core-key-a', enumerable: true },
      publicKeySpkiDerBase64: { value: TEST_PUBLIC_KEY_SPKI_B64, enumerable: true },
      status: { value: 'active', enumerable: true },
      purpose: { value: 'core-to-jarvis-event', enumerable: true },
      validFrom: { value: '2026-01-01T00:00:00.000Z', enumerable: true },
      validUntil: {
        get() {
          reads += 1;
          return '2027-01-01T00:00:00.000Z';
        },
        enumerable: true,
      },
    }) as PublicKeyConfigRecord;
    expect(() => new PublicKeyRegistry([record], 'test')).toThrow(PublicKeyRegistryError);
    expect(reads).toBe(0);
  });

  it('turns a throwing getter into a PublicKeyRegistryError, not the thrown error', () => {
    const record = Object.create(Object.prototype, {
      keyId: {
        get() {
          throw new Error('a getter must never be invoked');
        },
        enumerable: true,
      },
      publicKeySpkiDerBase64: { value: TEST_PUBLIC_KEY_SPKI_B64, enumerable: true },
      status: { value: 'active', enumerable: true },
      purpose: { value: 'core-to-jarvis-event', enumerable: true },
      validFrom: { value: '2026-01-01T00:00:00.000Z', enumerable: true },
      validUntil: { value: '2027-01-01T00:00:00.000Z', enumerable: true },
    }) as PublicKeyConfigRecord;
    expect(() => new PublicKeyRegistry([record], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('turns a throwing Proxy reflection into a PublicKeyRegistryError', () => {
    const proxy = new Proxy(testConfigRecord(), {
      ownKeys() {
        throw new Error('reflection failure');
      },
    });
    let thrown: unknown;
    try {
      new PublicKeyRegistry([proxy], 'test');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PublicKeyRegistryError);
  });

  it('rejects a symbol extra key', () => {
    const record: Record<string | symbol, unknown> = { ...testConfigRecord() };
    record[Symbol('extra')] = 'x';
    expect(() => new PublicKeyRegistry([asRecord(record)], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a non-enumerable extra key', () => {
    const record: Record<string, unknown> = { ...testConfigRecord() };
    Object.defineProperty(record, 'hidden', { value: 'x', enumerable: false });
    expect(() => new PublicKeyRegistry([asRecord(record)], 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects an ordinary extra field', () => {
    expect(
      () => new PublicKeyRegistry([asRecord({ ...testConfigRecord(), extra: 'x' })], 'test'),
    ).toThrow(PublicKeyRegistryError);
  });
});

describe('PublicKeyRegistry — strict validation of the outer records container', () => {
  function asRecords(value: unknown): PublicKeyConfigRecord[] {
    return value as PublicKeyConfigRecord[];
  }

  it('accepts dense arrays of 0, 1, and 32 records', () => {
    expect(new PublicKeyRegistry([], 'test').size).toBe(0);
    expect(new PublicKeyRegistry([testConfigRecord()], 'test').size).toBe(1);
    expect(new PublicKeyRegistry(distinctKeyRecords(MAX_PUBLIC_KEY_RECORDS), 'test').size).toBe(32);
  });

  it('rejects 33 records', () => {
    expect(
      () => new PublicKeyRegistry(distinctKeyRecords(MAX_PUBLIC_KEY_RECORDS + 1), 'test'),
    ).toThrow(PublicKeyRegistryError);
  });

  it('rejects a revoked Proxy in place of the array', () => {
    const { proxy, revoke } = Proxy.revocable([testConfigRecord()], {});
    revoke();
    expect(() => new PublicKeyRegistry(asRecords(proxy), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a Proxy that throws from ownKeys', () => {
    const proxy = new Proxy([testConfigRecord()], {
      ownKeys() {
        throw new Error('trap');
      },
    });
    expect(() => new PublicKeyRegistry(asRecords(proxy), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a Proxy that throws from getOwnPropertyDescriptor', () => {
    const proxy = new Proxy([testConfigRecord()], {
      getOwnPropertyDescriptor() {
        throw new Error('trap');
      },
    });
    expect(() => new PublicKeyRegistry(asRecords(proxy), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a Proxy that throws when length is inspected', () => {
    const proxy = new Proxy([testConfigRecord()], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') {
          throw new Error('trap');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expect(() => new PublicKeyRegistry(asRecords(proxy), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects an accessor element at index 0 without invoking it', () => {
    let reads = 0;
    const array: unknown[] = [undefined];
    Object.defineProperty(array, '0', {
      get() {
        reads += 1;
        return testConfigRecord();
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => new PublicKeyRegistry(asRecords(array), 'test')).toThrow(PublicKeyRegistryError);
    expect(reads).toBe(0);
  });

  it('rejects a sparse array (a hole)', () => {
    const array: unknown[] = [testConfigRecord()];
    Reflect.deleteProperty(array, 0);
    expect(() => new PublicKeyRegistry(asRecords(array), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a hole whose index 0 is only an inherited Array.prototype getter, without invoking it', () => {
    let reads = 0;
    const array: unknown[] = [testConfigRecord()];
    Reflect.deleteProperty(array, 0);
    Object.defineProperty(Array.prototype, '0', {
      get() {
        reads += 1;
        return testConfigRecord();
      },
      configurable: true,
    });
    try {
      expect(() => new PublicKeyRegistry(asRecords(array), 'test')).toThrow(PublicKeyRegistryError);
    } finally {
      Reflect.deleteProperty(Array.prototype, '0');
    }
    expect(reads).toBe(0);
  });

  it('rejects a symbol property on the array', () => {
    const array: unknown[] = [testConfigRecord()];
    (array as unknown as Record<symbol, unknown>)[Symbol('extra')] = 'y';
    expect(() => new PublicKeyRegistry(asRecords(array), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects an ordinary non-index extra property on the array', () => {
    const array: unknown[] = [testConfigRecord()];
    (array as unknown as Record<string, unknown>)['extra'] = 'y';
    expect(() => new PublicKeyRegistry(asRecords(array), 'test')).toThrow(PublicKeyRegistryError);
  });

  it('rejects a revoked Proxy as an individual record (Array.isArray raw TypeError does not escape)', () => {
    // The outer container is a real, dense array; the poisoned value is one element:
    // a revoked Proxy. `Array.isArray` throws a raw `TypeError` on a revoked Proxy, and
    // that probe runs inside `readConfigStrings` for the individual record. The failure
    // must surface as `PublicKeyRegistryError`, never the Proxy's own revocation TypeError.
    const { proxy, revoke } = Proxy.revocable(testConfigRecord(), {});
    revoke();
    const array: unknown[] = [proxy];

    let caught: unknown;
    try {
      new PublicKeyRegistry(asRecords(array), 'test');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PublicKeyRegistryError);
    // Prove specifically that the raw Proxy revocation TypeError did not escape.
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).not.toMatch(/revoked/i);
  });
});
