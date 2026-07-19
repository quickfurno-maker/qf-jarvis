/**
 * The INTERNAL projection definition vocabulary (Stage 3.4.2, ADR-0035).
 *
 * A projection definition is the immutable, repository-owned description of ONE projection: its
 * validated {@link ProjectionName}, its positive version, and the single async handler that applies
 * one event to the read model. It is a description, not a runner — nothing here opens a transaction,
 * takes a lock, reads an event, writes a checkpoint, or retries. Those belong to Stage 3.4.3+.
 *
 * The handler receives EVENT METADATA ONLY: the ingestion sequence, the event type and version, and
 * the canonical UTC acceptance instant. It deliberately receives **no** payload, subject id,
 * correlation id, event id, source, signature, free text, environment value, or provider detail. A
 * handler that cannot see personal data cannot leak it into a read model, and erasure then survives a
 * rebuild trivially (ADR-0034 §10). This shape is the enforcement point for that guarantee.
 *
 * **The caller is hostile until proven otherwise.** Every property of a candidate definition is read
 * EXACTLY ONCE into a local snapshot, and only that snapshot is validated and frozen — so a getter
 * cannot return a valid value to the validator and a different one to the copier. Every failure,
 * including one thrown by a caller's getter or proxy trap, becomes a typed error whose message is
 * fixed by construction and carries no caller text.
 *
 * Not exported from the package root — this is internal projection vocabulary (ADR-0035 §7).
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { isProjectionName, type ProjectionName } from './projection-name.js';

/**
 * The intrinsic `Date.prototype.toISOString`, captured at module load.
 *
 * Captured because a `Date` **subclass** can override `toISOString` and `getTime` to return arbitrary
 * text, and calling `value.toISOString()` would hand that text straight into a validated value.
 * Invoking the intrinsic with the supplied object as receiver ignores any override and additionally
 * acts as a brand check: it throws `TypeError` for anything without a `[[DateValue]]` internal slot
 * (so a plain object or a forged `Symbol.hasInstance` cannot pass) and `RangeError` for an invalid
 * date. Both are caught.
 */
// Capturing the UNBOUND intrinsic is the entire point: it is invoked below with an explicit receiver
// via `.call`, which is what makes a subclass override unreachable. Binding it, or calling
// `value.toISOString()`, would defeat that.
// eslint-disable-next-line @typescript-eslint/unbound-method -- deliberate unbound intrinsic capture
const intrinsicToISOString = Date.prototype.toISOString;

/**
 * A canonical UTC instant, as an ISO-8601 string with millisecond precision and a literal `Z`.
 *
 * A string, deliberately — NOT a `Date`. A `Date` is mutable: a handler could call `setTime` on the
 * instant it was handed and change state shared with the runner or another handler. A canonical
 * string cannot be mutated, compares and sorts correctly, and has exactly one representation per
 * instant, so two runs producing the same instant produce the same bytes (rebuild determinism,
 * ADR-0022 §3).
 */
export type CanonicalInstant = string & { readonly __brand: 'CanonicalInstant' };

/** `YYYY-MM-DDTHH:MM:SS.sssZ` — the SHAPE only. Shape alone is not validity; see {@link isCanonicalInstant}. */
export const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * True iff `value` is a **semantically valid** canonical UTC instant.
 *
 * Shape matching is necessary but nowhere near sufficient: `2026-02-30T02:46:50.123Z`,
 * `2026-13-19T…`, `2026-07-19T24:00:00.000Z`, `…T02:60:00.000Z` and `…T23:59:60.000Z` all match the
 * pattern, yet none names a real instant. So this additionally requires a **byte-exact round trip**:
 * parse the string, re-serialise it with the intrinsic serialiser, and demand the result equal the
 * input. An impossible date either fails to parse (`NaN` → `RangeError` on serialisation) or silently
 * rolls over — Feb 30 becomes Mar 2, hour 24 becomes the next midnight — and the rolled-over
 * serialisation no longer equals the input, so both classes are rejected.
 *
 * Never throws, and never surfaces a native parse or range error.
 */
export function isCanonicalInstant(value: unknown): value is CanonicalInstant {
  if (typeof value !== 'string') {
    return false;
  }
  if (!CANONICAL_INSTANT_PATTERN.test(value)) {
    return false;
  }

  try {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      return false;
    }
    // Round-trip through the intrinsic serialiser: the only accepted proof of semantic validity.
    return intrinsicToISOString.call(new Date(parsed)) === value;
  } catch {
    // A RangeError from an unrepresentable date, or anything else, is a rejection — not a leak.
    return false;
  }
}

/**
 * Serialise `value` with the intrinsic `Date.prototype.toISOString`, or return `undefined`.
 *
 * Deliberately calls neither `value.toISOString()` nor `value.getTime()`: both are caller-overridable
 * on a subclass. Every failure — a non-`Date` receiver (`TypeError`), an invalid date (`RangeError`),
 * or a non-string result — collapses to `undefined`.
 */
function intrinsicIsoOrUndefined(value: unknown): string | undefined {
  try {
    const serialized: unknown = intrinsicToISOString.call(value as Date);
    return typeof serialized === 'string' ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert a `Date` (or an already-canonical string) into an immutable {@link CanonicalInstant}.
 *
 * A `Date` is converted **only** through the intrinsic serialiser, so a subclass overriding
 * `getTime`/`toISOString` can neither bypass validation nor inject arbitrary text. The result is
 * re-validated through {@link isCanonicalInstant} before it is accepted. Every invalid input —
 * invalid date, impossible date, non-canonical string, wrong type — becomes a
 * {@link ProjectionDefinitionError} with a fixed, safe message; no native error escapes.
 */
export function toCanonicalInstant(value: unknown): CanonicalInstant {
  if (typeof value === 'string') {
    if (isCanonicalInstant(value)) {
      return value;
    }
    throw new ProjectionDefinitionError('projection-event-invalid');
  }

  const serialized = intrinsicIsoOrUndefined(value);
  if (serialized !== undefined && isCanonicalInstant(serialized)) {
    return serialized;
  }

  throw new ProjectionDefinitionError('projection-event-invalid');
}

/**
 * The METADATA-ONLY view of an accepted event handed to a projection handler.
 *
 * Every field here is repository-derived and non-identifying. Adding a payload, subject reference,
 * correlation id, or free-text field to this interface would silently widen what every projection can
 * write into a read model, so it is a deliberate, ADR-gated decision — not a convenience edit.
 */
export interface ProjectionEvent {
  /** The event's monotonic ingestion sequence. */
  readonly sequence: bigint;
  /** The canonical event type, e.g. `quote.issued`. Repository vocabulary, not sender free text. */
  readonly eventType: string;
  /** The positive integer contract version of that event type. */
  readonly eventVersion: number;
  /** When the event store accepted the event, as an immutable canonical UTC instant. */
  readonly acceptedAt: CanonicalInstant;
}

/**
 * The single handler a projection exposes: apply exactly ONE event to the read model, using the
 * already-borrowed client it is given.
 *
 * The handler does NOT commit, roll back, take a lock, advance a checkpoint, record an attempt, or
 * decide whether to retry — the Stage 3.4.3 runner owns all of that. A handler signals failure by
 * rejecting; it never reports its own outcome.
 */
export type ProjectionHandler = (client: DatabaseClient, event: ProjectionEvent) => Promise<void>;

/** An immutable, validated projection definition. Frozen; safe to share across callers. */
export interface ProjectionDefinition {
  readonly name: ProjectionName;
  readonly version: number;
  readonly apply: ProjectionHandler;
}

/** What a caller may offer. Deliberately looser than {@link ProjectionDefinition}: it is validated, not trusted. */
export interface ProjectionDefinitionInput {
  readonly name: unknown;
  readonly version: unknown;
  readonly apply: unknown;
}

/**
 * The closed set of definition/event validation failure codes, each mapped to its FIXED message.
 *
 * The message is chosen by this table and nowhere else. There is deliberately **no** constructor path
 * that accepts an arbitrary string, so "the message is fixed by construction" (ADR-0035 §9) is a
 * property of the type rather than a convention every call site must remember.
 */
const PROJECTION_DEFINITION_ERROR_MESSAGES = {
  'projection-definition-invalid':
    'A projection definition must be an object with a valid name, a positive safe-integer version, and an apply handler function.',
  'projection-definition-unreadable':
    'A projection definition could not be read; its properties are not plainly accessible.',
  'projection-event-invalid':
    'A projection event acceptance instant must be a valid Date or a canonical UTC instant string.',
} as const;

/** The closed set of definition-layer failure codes. */
export const PROJECTION_DEFINITION_ERROR_CODES = Object.freeze(
  Object.keys(PROJECTION_DEFINITION_ERROR_MESSAGES) as ProjectionDefinitionErrorCode[],
);

/** One definition-layer failure code. */
export type ProjectionDefinitionErrorCode = keyof typeof PROJECTION_DEFINITION_ERROR_MESSAGES;

/**
 * The fallback code applied when a supplied code is not one of the closed, known codes. A
 * structurally invalid definition is the safe, generic classification.
 */
const DEFINITION_FALLBACK_CODE: ProjectionDefinitionErrorCode = 'projection-definition-invalid';

/**
 * Normalise an arbitrary runtime value into a known code, or the safe fallback.
 *
 * The static type says `code: ProjectionDefinitionErrorCode`, but a caller can `as`-cast anything —
 * an unbounded secret — into that position. Without this check the secret would survive in `.code`
 * even though `.message` is table-derived. `hasOwnProperty` on the closed message table (never `in`,
 * which would also match inherited `constructor`/`__proto__`) is the runtime gate, so an unrecognised
 * value can never be stored.
 */
function normalizeDefinitionCode(code: unknown): ProjectionDefinitionErrorCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PROJECTION_DEFINITION_ERROR_MESSAGES, code)
    ? (code as ProjectionDefinitionErrorCode)
    : DEFINITION_FALLBACK_CODE;
}

/**
 * A projection definition (or handler event) was structurally invalid, or could not be read at all.
 *
 * The constructor accepts **only a code**, which is additionally **normalised at runtime** against the
 * closed table: an unrecognised value (e.g. a secret `as`-cast into the code position) collapses to
 * the safe fallback, so neither `message` NOR `code` can carry caller text. Nothing caller-controlled
 * can reach `message`, `code`, `stack`, or `cause` — an error message becomes a log line, a definition
 * can be built from caller-supplied data, and the canonical payload privacy boundary prohibits
 * arbitrary free text crossing it (ADR-0026 §2). A thrown getter's original error is deliberately
 * **not** retained as `cause`: that object is caller-controlled and would carry its text along for the
 * ride. Callers branch on the stable {@link code}, never by parsing a message.
 */
export class ProjectionDefinitionError extends Error {
  public readonly code: ProjectionDefinitionErrorCode;

  public constructor(code: ProjectionDefinitionErrorCode) {
    const safeCode = normalizeDefinitionCode(code);
    super(PROJECTION_DEFINITION_ERROR_MESSAGES[safeCode]);
    this.name = 'ProjectionDefinitionError';
    this.code = safeCode;
  }
}

/** The inclusive upper bound on a projection version, matching the SQL `INTEGER` column of 0004. */
export const MAX_PROJECTION_VERSION = 2_147_483_647;

/** True iff `value` is a positive, safe, whole version within the storable range. */
export function isProjectionVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_PROJECTION_VERSION
  );
}

/** The three caller-supplied values, each read exactly once. */
interface DefinitionSnapshot {
  readonly name: unknown;
  readonly version: unknown;
  readonly apply: unknown;
}

/**
 * Read `name`, `version` and `apply` from a candidate — each **exactly once** — into locals.
 *
 * This single-read boundary is what makes a getter unable to pass validation and then substitute a
 * different value at copy time: after this function returns, the caller's object is never consulted
 * again. Any throw from a getter, a proxy trap, or a revoked proxy is converted here into a typed,
 * fixed-message error; the original is discarded rather than wrapped, so its text cannot escape.
 */
function snapshotDefinition(input: unknown): DefinitionSnapshot {
  // Array.isArray itself throws on a revoked proxy, so even the classification is guarded.
  let inputIsArray: boolean;
  try {
    inputIsArray = Array.isArray(input);
  } catch {
    throw new ProjectionDefinitionError('projection-definition-unreadable');
  }

  if (typeof input !== 'object' || input === null || inputIsArray) {
    throw new ProjectionDefinitionError('projection-definition-invalid');
  }

  try {
    const source = input as Record<string, unknown>;
    // Exactly one read per property. Do not add a second read anywhere below.
    const name: unknown = source['name'];
    const version: unknown = source['version'];
    const apply: unknown = source['apply'];
    return { name, version, apply };
  } catch {
    throw new ProjectionDefinitionError('projection-definition-unreadable');
  }
}

/**
 * Validate and freeze one projection definition.
 *
 * Reads each property once (see {@link snapshotDefinition}), validates **only** those locals, and
 * freezes **those same locals** onto a fresh object. The caller's object is never retained, so
 * mutating it afterwards cannot change what was registered, and any extra properties on it are
 * dropped rather than silently carried along.
 */
export function defineProjection(input: unknown): ProjectionDefinition {
  const snapshot = snapshotDefinition(input);

  if (!isProjectionName(snapshot.name)) {
    throw new ProjectionDefinitionError('projection-definition-invalid');
  }
  if (!isProjectionVersion(snapshot.version)) {
    throw new ProjectionDefinitionError('projection-definition-invalid');
  }
  if (typeof snapshot.apply !== 'function') {
    throw new ProjectionDefinitionError('projection-definition-invalid');
  }

  // Freeze the VALIDATED SNAPSHOT — the same values that were just checked, not a re-read.
  return Object.freeze({
    name: snapshot.name,
    version: snapshot.version,
    apply: snapshot.apply as ProjectionHandler,
  });
}
