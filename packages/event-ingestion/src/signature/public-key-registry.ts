/**
 * The public-key registry: **validated configuration in, immutable snapshots out.**
 *
 * The registry is constructed from bounded, serializable configuration records — the
 * kind a deployment can hold in a config file or a secret store — not from live
 * `KeyObject`s a caller built, and an **explicit environment**. It treats the records as
 * fully untrusted runtime input: each must be a plain object with exactly the six
 * approved own enumerable **string** data properties (no symbols, no extras, no
 * accessors, no inherited values), and every reflective operation — including the
 * `Array.isArray` probe on both the outer container and each individual record, which
 * throws a raw `TypeError` on a revoked Proxy — is caught and turned into a
 * `PublicKeyRegistryError`, never a `TypeError` or a getter/Proxy exception.
 *
 * Each record carries a Base64 SPKI DER public key, which the registry decodes and
 * validates into an Ed25519 public `KeyObject` once, at construction. **Canonical Base64
 * is not enough**: after `createPublicKey` succeeds and the key is confirmed Ed25519, the
 * registry re-exports the key to SPKI DER and requires it to equal the supplied bytes
 * **byte-for-byte** — otherwise trailing bytes appended to a valid DER (which
 * `createPublicKey` silently ignores) would be accepted. The Base64 is length-bounded
 * before it is decoded.
 *
 * What it stores and returns is an **immutable snapshot** holding a constructed key and
 * **primitive** epoch-millisecond validity bounds — never a caller-owned mutable `Date`
 * or record object. Mutating the caller's records after construction cannot change what
 * the registry does.
 *
 * Load-bearing properties (ADR-0020 §5–§6, ADR-0027):
 *
 * - **Public keys only.** A private key, malformed DER, non-canonical DER, or non-Ed25519
 *   key is rejected.
 * - **Lookup is by `keyId`, never by trial** — the verifier asks for one specific key.
 * - **Rotation without a deploy** — `active → retiring → revoked` plus a validity window.
 * - **Test keys cannot load in production.** The environment is passed **explicitly**;
 *   the registry never reads `process.env`. In `production`, a `test-`-prefixed keyId is
 *   refused. This is a Stage 3.2 registry control, not something deferred to Stage 3.3.
 * - **Bounded.** At most 32 keys, and each SPKI DER Base64 at most 128 characters.
 *
 * The registry is synchronous and reads no environment, filesystem, or network. Errors
 * reference a record by index and a rule, never a raw value or key bytes.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';

import { PublicKeyRegistryError } from './errors.js';
import { decodeCanonicalBase64, isValidKeyId, parseCanonicalTimestampMs } from './field-formats.js';
import { SUPPORTED_ALGORITHM } from './limits.js';

/** A key's lifecycle status. `retiring` still verifies; `revoked` never does. */
export type KeyStatus = 'active' | 'retiring' | 'revoked';

/** The environment the registry is loaded for. Passed explicitly — never read from `process.env`. */
export type RegistryEnvironment = 'development' | 'test' | 'production';

/** The single approved purpose for a Core → Jarvis event-signing key. */
export const EVENT_KEY_PURPOSE = 'core-to-jarvis-event';

/** At most this many keys may be loaded. */
export const MAX_PUBLIC_KEY_RECORDS = 32;

/** A conservative cap on the SPKI DER Base64 length. Canonical Ed25519 SPKI is ~60 chars. */
export const MAX_SPKI_DER_BASE64_LENGTH = 128;

/**
 * The bounded, serializable configuration for one public key. Every field is a plain
 * string or a small enum — nothing here is a live object or mutable handle. Validated at
 * runtime; the interface is only a convenience for TypeScript callers.
 */
export interface PublicKeyConfigRecord {
  /** The key identifier. Must satisfy the shared keyId format. */
  readonly keyId: string;
  /** The Ed25519 public key, as canonical Base64 of its canonical SPKI DER encoding. */
  readonly publicKeySpkiDerBase64: string;
  /** Lifecycle status. */
  readonly status: KeyStatus;
  /** Must be exactly `core-to-jarvis-event`. */
  readonly purpose: string;
  /** Canonical `YYYY-MM-DDTHH:mm:ss.SSSZ` instant the key becomes valid (inclusive). */
  readonly validFrom: string;
  /** Canonical `YYYY-MM-DDTHH:mm:ss.SSSZ` instant the key stops being valid (exclusive). */
  readonly validUntil: string;
}

/** An immutable, validated registry entry. Holds a constructed key and primitive bounds. */
export interface RegisteredKey {
  readonly keyId: string;
  readonly publicKey: KeyObject;
  readonly status: KeyStatus;
  readonly validFromMs: number;
  readonly validUntilMs: number;
}

const CONFIG_KEYS = [
  'keyId',
  'publicKeySpkiDerBase64',
  'status',
  'purpose',
  'validFrom',
  'validUntil',
] as const;
const CONFIG_KEY_SET: ReadonlySet<string> = new Set<string>(CONFIG_KEYS);

const VALID_STATUSES: readonly string[] = ['active', 'retiring', 'revoked'];
const VALID_ENVIRONMENTS: readonly string[] = ['development', 'test', 'production'];

type ConfigStrings = Record<(typeof CONFIG_KEYS)[number], string>;

/**
 * Strictly read the six approved string fields off an untrusted record. Any deviation —
 * not a plain object, wrong prototype, wrong key set, a symbol key, an accessor, a
 * non-enumerable or non-string value, or a throwing reflective trap — becomes a
 * `PublicKeyRegistryError` that names only the index and the rule.
 */
function readConfigStrings(record: unknown, index: number): ConfigStrings {
  const at = `key record at index ${String(index)}`;

  if (record === null || typeof record !== 'object') {
    throw new PublicKeyRegistryError(`${at} is not a plain object`);
  }
  // `Array.isArray` throws a raw `TypeError` on a revoked Proxy, so it is guarded here
  // exactly like every other reflective probe: a throw becomes a `PublicKeyRegistryError`,
  // and an actual array is still rejected as not a plain object. No getter or value is read.
  let recordIsArray: boolean;
  try {
    recordIsArray = Array.isArray(record);
  } catch {
    throw new PublicKeyRegistryError(`${at} could not be inspected`);
  }
  if (recordIsArray) {
    throw new PublicKeyRegistryError(`${at} is not a plain object`);
  }

  let prototype: object | null;
  let ownKeys: (string | symbol)[];
  try {
    prototype = Reflect.getPrototypeOf(record);
    ownKeys = Reflect.ownKeys(record);
  } catch {
    throw new PublicKeyRegistryError(`${at} could not be inspected`);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new PublicKeyRegistryError(`${at} is not a plain object`);
  }
  if (ownKeys.length !== CONFIG_KEYS.length) {
    throw new PublicKeyRegistryError(`${at} has the wrong set of keys`);
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !CONFIG_KEY_SET.has(key)) {
      throw new PublicKeyRegistryError(`${at} has an unexpected key`);
    }
  }

  const values: Partial<ConfigStrings> = {};
  for (const key of CONFIG_KEYS) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(record, key);
    } catch {
      throw new PublicKeyRegistryError(`${at} could not be inspected`);
    }
    if (
      descriptor === undefined ||
      typeof descriptor.get === 'function' ||
      typeof descriptor.set === 'function' ||
      descriptor.enumerable !== true
    ) {
      throw new PublicKeyRegistryError(`${at} has an invalid property: ${key}`);
    }
    const value: unknown = descriptor.value;
    if (typeof value !== 'string') {
      throw new PublicKeyRegistryError(`${at} has a non-string property: ${key}`);
    }
    values[key] = value;
  }

  return values as ConfigStrings;
}

function buildRegisteredKey(
  record: unknown,
  index: number,
  environment: RegistryEnvironment,
): RegisteredKey {
  const at = `key record at index ${String(index)}`;
  const values = readConfigStrings(record, index);

  if (!isValidKeyId(values.keyId)) {
    throw new PublicKeyRegistryError(`${at} has an invalid keyId`);
  }
  if (environment === 'production' && values.keyId.startsWith('test-')) {
    throw new PublicKeyRegistryError(`${at} uses a test- keyId, which is forbidden in production`);
  }
  if (!VALID_STATUSES.includes(values.status)) {
    throw new PublicKeyRegistryError(`${at} has an invalid status`);
  }
  const status = values.status as KeyStatus;
  if (values.purpose !== EVENT_KEY_PURPOSE) {
    throw new PublicKeyRegistryError(`${at} has an unsupported purpose`);
  }

  const validFromMs = parseCanonicalTimestampMs(values.validFrom);
  const validUntilMs = parseCanonicalTimestampMs(values.validUntil);
  if (validFromMs === null || validUntilMs === null) {
    throw new PublicKeyRegistryError(`${at} has a non-canonical validity timestamp`);
  }
  if (validFromMs >= validUntilMs) {
    throw new PublicKeyRegistryError(`${at} has validFrom on or after validUntil`);
  }

  if (values.publicKeySpkiDerBase64.length > MAX_SPKI_DER_BASE64_LENGTH) {
    throw new PublicKeyRegistryError(`${at} has an over-long public key`);
  }
  const der = decodeCanonicalBase64(values.publicKeySpkiDerBase64);
  if (der === null) {
    throw new PublicKeyRegistryError(`${at} has a non-canonical Base64 public key`);
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new PublicKeyRegistryError(`${at} is not a valid SPKI DER public key`);
  }
  if (publicKey.type !== 'public') {
    throw new PublicKeyRegistryError(`${at} is not a public key`);
  }
  if (publicKey.asymmetricKeyType !== SUPPORTED_ALGORITHM) {
    throw new PublicKeyRegistryError(`${at} is not an ${SUPPORTED_ALGORITHM} key`);
  }

  // Canonical DER: re-export and require byte-for-byte equality. This rejects trailing
  // bytes appended to a valid Ed25519 SPKI DER, which createPublicKey silently ignores.
  const canonicalDer = publicKey.export({ format: 'der', type: 'spki' });
  if (!canonicalDer.equals(der)) {
    throw new PublicKeyRegistryError(`${at} is not canonical SPKI DER`);
  }

  return Object.freeze({
    keyId: values.keyId,
    publicKey,
    status,
    validFromMs,
    validUntilMs,
  });
}

/**
 * Read the **outer container** as untrusted runtime configuration too. It must be an
 * actual array (a revoked Proxy throwing from `Array.isArray` is caught), whose own
 * `length` is a non-enumerable data property holding a non-negative integer ≤ 32, whose
 * only own keys are `length` and the dense indexes `0…length-1`, each a **own enumerable
 * data** property (no holes, no inherited elements, no accessors, no symbols, no non-index
 * extras). Every element is read from its validated own descriptor value — never through
 * ordinary `records[index]` access. Any deviation, and any throwing reflective trap,
 * becomes a `PublicKeyRegistryError` — never a `TypeError`, getter, or Proxy error.
 */
function readConfigRecordsArray(records: unknown): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(records);
  } catch {
    throw new PublicKeyRegistryError('records could not be inspected');
  }
  if (!isArray) {
    throw new PublicKeyRegistryError('records must be an array');
  }
  const container = records as object;

  let ownKeys: (string | symbol)[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    ownKeys = Reflect.ownKeys(container);
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(container, 'length');
  } catch {
    throw new PublicKeyRegistryError('records could not be inspected');
  }

  if (
    lengthDescriptor === undefined ||
    typeof lengthDescriptor.get === 'function' ||
    typeof lengthDescriptor.set === 'function' ||
    lengthDescriptor.enumerable !== false
  ) {
    throw new PublicKeyRegistryError('records has an invalid length property');
  }
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new PublicKeyRegistryError('records has an invalid length');
  }
  if (length > MAX_PUBLIC_KEY_RECORDS) {
    throw new PublicKeyRegistryError(
      `too many key records: at most ${String(MAX_PUBLIC_KEY_RECORDS)} are allowed`,
    );
  }

  const allowedIndexes = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    allowedIndexes.add(String(index));
  }
  for (const key of ownKeys) {
    if (typeof key === 'symbol') {
      throw new PublicKeyRegistryError('records has a symbol property');
    }
    if (key === 'length') {
      continue;
    }
    if (!allowedIndexes.has(key)) {
      throw new PublicKeyRegistryError('records has an unexpected property');
    }
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(container, String(index));
    } catch {
      throw new PublicKeyRegistryError('records could not be inspected');
    }
    if (descriptor === undefined) {
      throw new PublicKeyRegistryError(`records has a hole at index ${String(index)}`);
    }
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      throw new PublicKeyRegistryError(`records has an accessor element at index ${String(index)}`);
    }
    if (descriptor.enumerable !== true) {
      throw new PublicKeyRegistryError(
        `records element at index ${String(index)} is not enumerable`,
      );
    }
    values.push(descriptor.value);
  }
  return values;
}

/** An immutable, `keyId`-indexed set of validated public keys. */
export class PublicKeyRegistry {
  readonly #byKeyId: ReadonlyMap<string, RegisteredKey>;

  public constructor(records: readonly PublicKeyConfigRecord[], environment: RegistryEnvironment) {
    if (!VALID_ENVIRONMENTS.includes(environment)) {
      throw new PublicKeyRegistryError('unknown registry environment');
    }

    const recordValues = readConfigRecordsArray(records);

    const byKeyId = new Map<string, RegisteredKey>();
    for (let index = 0; index < recordValues.length; index += 1) {
      const registered = buildRegisteredKey(recordValues[index], index, environment);
      if (byKeyId.has(registered.keyId)) {
        throw new PublicKeyRegistryError(`duplicate keyId at record index ${String(index)}`);
      }
      byKeyId.set(registered.keyId, registered);
    }
    this.#byKeyId = byKeyId;
  }

  /** Look up a key by its exact id. Returns an immutable snapshot, or `undefined`. */
  public find(keyId: string): RegisteredKey | undefined {
    return this.#byKeyId.get(keyId);
  }

  /** How many keys the registry holds. */
  public get size(): number {
    return this.#byKeyId.size;
  }
}
