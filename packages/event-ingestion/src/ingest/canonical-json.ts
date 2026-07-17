/**
 * Deterministic canonical JSON for **semantic** duplicate comparison (ADR-0029).
 *
 * ### It is an INTERNAL primitive, not a hostile-input parser
 *
 * This runs only AFTER JSON parsing and canonical-event contract validation, on an
 * already-validated in-memory value. It is **not** exported from the package barrel, and
 * **contract validation is still the required boundary**. What the defences below do, and do
 * NOT, provide:
 *
 * - accessor getters and setters (own or inherited) are **never invoked**, and raw values are
 *   read from **own data descriptors only**;
 * - if a `Proxy` is supplied, its **reflection traps may still execute** — `Object.getPrototypeOf`,
 *   `Reflect.ownKeys`, and `Object.getOwnPropertyDescriptor` all trigger traps. The wrappers do
 *   **not** stop a trap from running; they only stop attacker-controlled exception messages,
 *   causes, property names, and trap text from **escaping**;
 * - therefore this remains an **internal primitive**, not a standalone hostile-object parser,
 *   and only canonical-event output returned from contract validation may reach it.
 *
 * It is **not** the signing canonicalisation either: the Stage 3.2 verifier still verifies the
 * exact raw bytes (ADR-0027, ADR-0020 §2).
 *
 * ### The rules (ADR-0029)
 *
 * - object keys are sorted recursively by UTF-16 code unit;
 * - array element order is preserved;
 * - primitives and string escaping follow ECMAScript JSON serialization semantics;
 * - Unicode is NOT normalised (NFC and NFD stay distinct);
 * - negative zero serialises as zero;
 * - `NaN`, `±Infinity`, `undefined`, `bigint`, `function`, `symbol`, sparse-array holes,
 *   cyclic structures, accessor properties, symbol keys, non-plain objects, and
 *   **non-enumerable own data properties** are refused;
 * - every object and array is read through **own property descriptors only** — a getter is
 *   never invoked, `record[key]` is never read, and an inherited property can never fill a
 *   sparse hole;
 * - a supplied `Proxy`'s reflection traps may execute; a trap that throws becomes a bounded
 *   `unsupported-value` error carrying no trap text, no property name, and no rejected value.
 *
 * ### The error path names no data
 *
 * Structural paths use **ordinal tokens** for object keys (`$[key#0]`) and numeric indices
 * for arrays (`$[3]`). A raw object key — which could hold an email, a phone number, or free
 * text — is **never** placed in an error path or message. A symbol key's description is never
 * read. The utility reads no clock, environment, filesystem, or network; it logs nothing and
 * mutates neither the caller's input nor any global state.
 */
import { SemanticCanonicalisationError, type SemanticCanonicalisationErrorCode } from './errors.js';

/** Keep the reported path bounded. Each segment is a pre-formatted, data-free token. */
const MAX_PATH_LENGTH = 256;

function formatPath(segments: readonly string[]): string {
  let path = '$';
  for (const segment of segments) {
    if (path.length + segment.length > MAX_PATH_LENGTH) {
      path += '…';
      break;
    }
    path += segment;
  }
  return path;
}

function fail(code: SemanticCanonicalisationErrorCode, segments: readonly string[]): never {
  throw new SemanticCanonicalisationError(code, formatPath(segments));
}

// --- Bounded reflection (ADR-0029): a Proxy trap MAY run, but its text must not escape ------
//
// These reflection operations execute a supplied Proxy's traps; the wrappers do NOT prevent a
// trap from running. They only prevent a thrown trap's message, cause, property name, and text
// from escaping — any throw becomes a bounded `unsupported-value` with none of that attached.

function safeIsArray(value: object, path: readonly string[]): boolean {
  try {
    return Array.isArray(value);
  } catch {
    fail('unsupported-value', path);
  }
}

function safeGetPrototypeOf(value: object, path: readonly string[]): unknown {
  try {
    return Object.getPrototypeOf(value) as unknown;
  } catch {
    fail('unsupported-value', path);
  }
}

function safeOwnKeys(value: object, path: readonly string[]): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    fail('unsupported-value', path);
  }
}

function safeGetOwnPropertyDescriptor(
  value: object,
  key: string,
  path: readonly string[],
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail('unsupported-value', path);
  }
}

/** A canonical array index: a non-negative integer string `< length`, with no leading zero. */
function isCanonicalIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function writeArray(value: object, ancestors: Set<object>, path: string[]): string {
  if (ancestors.has(value)) fail('cyclic-value', path);
  ancestors.add(value);

  const ownKeys: string[] = [];
  for (const key of safeOwnKeys(value, path)) {
    // A symbol key on an array is misuse; its description is never read.
    if (typeof key === 'symbol') fail('symbol-key', path);
    ownKeys.push(key);
  }

  const lengthDescriptor = safeGetOwnPropertyDescriptor(value, 'length', path);
  if (lengthDescriptor === undefined) fail('unsupported-value', path);
  if (lengthDescriptor.get !== undefined || lengthDescriptor.set !== undefined) {
    fail('unsupported-value', path);
  }
  const lengthValue = lengthDescriptor.value as unknown;
  if (typeof lengthValue !== 'number' || !Number.isInteger(lengthValue) || lengthValue < 0) {
    fail('unsupported-value', path);
  }
  const length = lengthValue;

  // Only `length` and the canonical own index keys 0..length-1 are permitted. Any extra own
  // string property (or a non-canonical / out-of-range index) makes this not a plain array.
  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (isCanonicalIndex(key, length)) continue;
    fail('unsupported-value', path);
  }

  const parts: string[] = [];
  for (let index = 0; index < length; index += 1) {
    path.push(`[${String(index)}]`);
    const descriptor = safeGetOwnPropertyDescriptor(value, String(index), path);
    // A missing OWN index is a hole. An inherited property can never fill it, because only
    // own descriptors are consulted.
    if (descriptor === undefined) fail('sparse-array', path);
    if (descriptor.get !== undefined || descriptor.set !== undefined)
      fail('accessor-property', path);
    if (descriptor.enumerable !== true) fail('unsupported-value', path);
    parts.push(write(descriptor.value as unknown, ancestors, path));
    path.pop();
  }

  ancestors.delete(value);
  return `[${parts.join(',')}]`;
}

function writeObject(value: object, ancestors: Set<object>, path: string[]): string {
  const proto = safeGetPrototypeOf(value, path);
  if (proto !== null && proto !== Object.prototype) {
    // A Date, Map, Set, RegExp, class instance, etc. Not a JSON value.
    fail('non-plain-object', path);
  }

  if (ancestors.has(value)) fail('cyclic-value', path);
  ancestors.add(value);

  const stringKeys: string[] = [];
  for (const key of safeOwnKeys(value, path)) {
    // A symbol key is misuse; its description is never read.
    if (typeof key === 'symbol') fail('symbol-key', path);
    stringKeys.push(key);
  }
  stringKeys.sort();

  const parts: string[] = [];
  for (const [ordinal, key] of stringKeys.entries()) {
    // The path names the SORTED-KEY ORDINAL, never the raw key text.
    path.push(`[key#${String(ordinal)}]`);
    const descriptor = safeGetOwnPropertyDescriptor(value, key, path);
    if (descriptor === undefined) fail('unsupported-value', path);
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      // An accessor. Refuse it WITHOUT reading it — invoking a getter is exactly the leak and
      // the side effect this function must never cause.
      fail('accessor-property', path);
    }
    if (descriptor.enumerable !== true) {
      // A non-enumerable own data property is outside the JSON-parsed value domain.
      fail('unsupported-value', path);
    }
    // Read the value from its descriptor, never `record[key]`.
    parts.push(`${JSON.stringify(key)}:${write(descriptor.value as unknown, ancestors, path)}`);
    path.pop();
  }

  ancestors.delete(value);
  return `{${parts.join(',')}}`;
}

function write(value: unknown, ancestors: Set<object>, path: string[]): string {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    const num = value as number;
    if (!Number.isFinite(num)) fail('non-finite-number', path);
    // ECMAScript JSON number serialisation; `JSON.stringify(-0)` is `"0"` (ADR-0029 rule 6).
    return JSON.stringify(num);
  }
  if (type === 'string') return JSON.stringify(value);
  if (type === 'object') {
    const object = value as object;
    return safeIsArray(object, path)
      ? writeArray(object, ancestors, path)
      : writeObject(object, ancestors, path);
  }

  // `undefined`, `bigint`, `function`, `symbol` — outside the JSON value domain.
  fail('unsupported-value', path);
}

/**
 * Produce the canonical JSON string of an already-validated JSON value.
 *
 * Internal to semantic duplicate comparison — not exported from the package barrel. Throws
 * {@link SemanticCanonicalisationError} on any value outside the JSON value domain, with a
 * bounded code and a data-free structural path.
 */
export function canonicaliseToJson(value: unknown): string {
  return write(value, new Set<object>(), []);
}
