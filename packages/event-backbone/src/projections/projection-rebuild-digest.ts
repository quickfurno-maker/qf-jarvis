/**
 * The internal canonical read-model DIGEST utility for the bounded rebuild proof (QFJ-P03.08, ADR-0043).
 *
 * The rebuild determinism proof is: digest the live read model → destroy and rebuild it → digest again
 * → assert the two digests are equal (ADR-0022 §7). This module owns that digest.
 *
 * ### One canonicaliser, both states, no driver quirks
 *
 * The SAME canonicaliser produces both the live digest and the rebuilt digest, so the comparison is an
 * INTRA-RUN `A === B` check — it is not a portable/persisted interchange format, and nothing here is
 * stored. Determinism is obtained two ways: (1) rows are read in COMPLETE-primary-key order via an
 * explicit `ORDER BY`, and (2) the two values whose `node-postgres` mapping is locale/timezone-prone —
 * `DATE` and `TIMESTAMPTZ` — are rendered to canonical TEXT server-side (`to_char` at UTC), so the JS
 * driver never parses them into a locale-dependent `Date`.
 *
 * ### Explicit, tested value encoding
 *
 * {@link encodeCanonicalValue} accepts only `string | number | bigint | Date | null` and encodes each
 * deterministically: BIGINT as a base-10 string, an integer number as its decimal string, a `Date` via
 * the intrinsic UTC ISO-8601 serialiser, `null` as a fixed sentinel. Anything else — a float, a
 * boolean, an object, `undefined`, or a value containing a framing separator — fails closed with a
 * {@link ProjectionRebuildError} (`projection-rebuild-uncanonical-value`). Row content is never logged.
 *
 * Not exported from the package root — internal projection vocabulary.
 */
import { createHash } from 'node:crypto';

import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionRebuildError } from './projection-rebuild-errors.js';

/**
 * The intrinsic `Date.prototype.toISOString`, captured at module load — invoked below with an explicit
 * receiver so a `Date` subclass override is unreachable (the same guard the definition layer uses).
 */
// eslint-disable-next-line @typescript-eslint/unbound-method -- deliberate unbound intrinsic capture
const intrinsicToISOString = Date.prototype.toISOString;

/**
 * The framing separators — ASCII control characters that a canonical read-model value must never
 * contain. Built with {@link String.fromCharCode} rather than written as literals so the source stays
 * free of raw control bytes (and so no `no-control-regex` is needed to detect them).
 */
const US = 0x1f; // unit separator — between a column name and its value, and between fields
const RS = 0x1e; // record separator — between rows
const GS = 0x1d; // group separator — reserved group boundary
const NUL = 0x00; // the null-sentinel prefix
const FIELD_SEPARATOR = String.fromCharCode(US);
const RECORD_SEPARATOR = String.fromCharCode(RS);
const GROUP_SEPARATOR = String.fromCharCode(GS);
const NULL_SENTINEL = String.fromCharCode(NUL) + 'NULL'; // the fixed encoding of a SQL NULL
const FRAMING_CODE_POINTS = new Set<number>([US, RS, GS, NUL]);

/** True iff `text` contains any framing/sentinel control character (which would make framing ambiguous). */
function containsFramingCharacter(text: string): boolean {
  for (const character of text) {
    if (FRAMING_CODE_POINTS.has(character.codePointAt(0) ?? -1)) {
      return true;
    }
  }
  return false;
}

/** The domain-separation header, versioning the derivation itself (not any projection). */
export const PROJECTION_REBUILD_DIGEST_DOMAIN = 'qf-jarvis/projection-rebuild-digest/v1';

/** A canonical TEXT SQL projection for a `TIMESTAMPTZ` column: UTC ISO-8601 with millisecond precision. */
export function canonicalTimestamptzExpr(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** A canonical TEXT SQL projection for a `DATE` column: `YYYY-MM-DD`. */
export function canonicalDateExpr(column: string): string {
  return `to_char(${column}, 'YYYY-MM-DD')`;
}

/** One authoritative read-model column: its output `name` and the SQL `expr` that produces it. */
export interface ReadModelColumn {
  readonly name: string;
  /** The SQL expression selected AS `name`. Defaults to the bare column name when omitted. */
  readonly expr?: string;
}

/** A read model's digest specification: the table, the ordered authoritative columns, and the PK order. */
export interface ReadModelDigestSpec {
  readonly table: string;
  readonly columns: readonly ReadModelColumn[];
  /** The complete primary key, in order, used for the deterministic `ORDER BY`. */
  readonly orderBy: readonly string[];
}

/**
 * Encode ONE read-model value to its canonical string form, or fail closed.
 *
 * Never logs the value. A framing separator inside a string, a non-integer/`NaN`/±Infinity number, a
 * boolean, an object, `undefined`, a symbol, or an invalid `Date` all fail closed — determinism cannot
 * be claimed for a value the canonicaliser does not fully control.
 */
export function encodeCanonicalValue(value: unknown): string {
  if (value === null) {
    return NULL_SENTINEL;
  }
  if (typeof value === 'string') {
    if (containsFramingCharacter(value)) {
      throw new ProjectionRebuildError('projection-rebuild-uncanonical-value');
    }
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new ProjectionRebuildError('projection-rebuild-uncanonical-value');
    }
    return value.toString(10);
  }
  if (value instanceof Date) {
    try {
      const iso: unknown = intrinsicToISOString.call(value);
      if (typeof iso !== 'string') {
        throw new ProjectionRebuildError('projection-rebuild-uncanonical-value');
      }
      return iso;
    } catch {
      throw new ProjectionRebuildError('projection-rebuild-uncanonical-value');
    }
  }
  throw new ProjectionRebuildError('projection-rebuild-uncanonical-value');
}

/**
 * Canonically serialise a full read-model snapshot: for each row, in the caller's column order, emit
 * `name`, the field separator, the encoded value, and a trailing field separator; rows are joined by
 * the record separator. Row order is the caller's responsibility (the snapshot query sorts by PK).
 */
export function canonicalizeReadModelSnapshot(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  const parts: string[] = [PROJECTION_REBUILD_DIGEST_DOMAIN, GROUP_SEPARATOR];
  for (const row of rows) {
    for (const column of columns) {
      parts.push(column, FIELD_SEPARATOR, encodeCanonicalValue(row[column]), FIELD_SEPARATOR);
    }
    parts.push(RECORD_SEPARATOR);
  }
  return parts.join('');
}

/** The SHA-256 hex digest of a canonicalised read-model snapshot. */
export function digestReadModelSnapshot(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  const canonical = canonicalizeReadModelSnapshot(rows, columns);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Read every authoritative row of a read model, in complete-primary-key order, for digesting. */
export async function snapshotReadModel(
  client: DatabaseClient,
  spec: ReadModelDigestSpec,
): Promise<Record<string, unknown>[]> {
  const selectList = spec.columns
    .map((column) => `${column.expr ?? column.name} AS "${column.name}"`)
    .join(', ');
  const orderList = spec.orderBy.map((column) => `"${column}" ASC`).join(', ');
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${selectList} FROM ${spec.table} ORDER BY ${orderList}`,
  );
  return result.rows;
}

/** Snapshot a read model and return its SHA-256 digest. The single acceptance-proof primitive. */
export async function digestReadModel(
  client: DatabaseClient,
  spec: ReadModelDigestSpec,
): Promise<string> {
  const rows = await snapshotReadModel(client, spec);
  return digestReadModelSnapshot(
    rows,
    spec.columns.map((column) => column.name),
  );
}

/** The digest spec for the `event-type-activity` production read model (`qf_jarvis.rm_event_type_activity`). */
export const EVENT_TYPE_ACTIVITY_DIGEST_SPEC: ReadModelDigestSpec = Object.freeze({
  table: 'qf_jarvis.rm_event_type_activity',
  columns: Object.freeze([
    { name: 'event_type' },
    { name: 'event_version' },
    { name: 'event_count' },
    { name: 'first_event_position' },
    { name: 'last_event_position' },
    { name: 'last_accepted_at', expr: canonicalTimestamptzExpr('last_accepted_at') },
  ]),
  orderBy: Object.freeze(['event_type', 'event_version']),
});

/** The digest spec for the `daily-event-acceptance` production read model (`qf_jarvis.rm_daily_event_acceptance`). */
export const DAILY_EVENT_ACCEPTANCE_DIGEST_SPEC: ReadModelDigestSpec = Object.freeze({
  table: 'qf_jarvis.rm_daily_event_acceptance',
  columns: Object.freeze([
    { name: 'accepted_date', expr: canonicalDateExpr('accepted_date') },
    { name: 'event_count' },
    { name: 'first_event_position' },
    { name: 'last_event_position' },
  ]),
  orderBy: Object.freeze(['accepted_date']),
});
