/**
 * QFJ-P03.08 — unit proofs for the canonical read-model digest (ADR-0043 §G).
 *
 * The digest is an intra-run `A === B` proof, so these tests pin the canonicaliser's determinism and
 * its explicit, fail-closed value encoding: BIGINT as base-10, integer numbers as decimal, TIMESTAMPTZ
 * `Date` as UTC ISO-8601, DATE strings passed through, NULL as a fixed sentinel, and every unsupported
 * value rejected. No database is used here.
 */
import { describe, expect, it } from 'vitest';

import { ProjectionRebuildError } from '../projections/projection-rebuild-errors.js';
import {
  canonicalDateExpr,
  canonicalTimestamptzExpr,
  canonicalizeReadModelSnapshot,
  digestReadModelSnapshot,
  encodeCanonicalValue,
} from '../projections/projection-rebuild-digest.js';

describe('encodeCanonicalValue — explicit, deterministic encoding', () => {
  it('encodes a BIGINT as its base-10 string', () => {
    expect(encodeCanonicalValue(123n)).toBe('123');
    expect(encodeCanonicalValue(9_007_199_254_740_993n)).toBe('9007199254740993');
    // A BIGINT arriving from node-postgres as a decimal string passes through unchanged.
    expect(encodeCanonicalValue('9007199254740993')).toBe('9007199254740993');
  });

  it('encodes an integer number as its decimal string', () => {
    expect(encodeCanonicalValue(2)).toBe('2');
    expect(encodeCanonicalValue(0)).toBe('0');
  });

  it('encodes a TIMESTAMPTZ Date as canonical UTC ISO-8601 with millisecond precision', () => {
    const date = new Date(Date.UTC(2026, 6, 19, 1, 2, 3, 456));
    expect(encodeCanonicalValue(date)).toBe('2026-07-19T01:02:03.456Z');
  });

  it('passes a canonical DATE string through unchanged', () => {
    expect(encodeCanonicalValue('2026-07-19')).toBe('2026-07-19');
  });

  it('encodes NULL as a fixed sentinel distinct from the empty string and the text "NULL"', () => {
    const encoded = encodeCanonicalValue(null);
    expect(encoded).not.toBe('');
    expect(encoded).not.toBe('NULL');
    expect(encoded).toContain('NULL');
    // The sentinel is unambiguous: the literal string "NULL" and the SQL NULL encode differently.
    expect(encodeCanonicalValue('NULL')).not.toBe(encoded);
  });

  it('fails closed on a non-integer number', () => {
    expect(() => encodeCanonicalValue(1.5)).toThrow(ProjectionRebuildError);
    expect(() => encodeCanonicalValue(Number.NaN)).toThrow(ProjectionRebuildError);
    expect(() => encodeCanonicalValue(Number.POSITIVE_INFINITY)).toThrow(ProjectionRebuildError);
  });

  it('fails closed on unsupported types (boolean, object, undefined)', () => {
    expect(() => encodeCanonicalValue(true)).toThrow(ProjectionRebuildError);
    expect(() => encodeCanonicalValue({})).toThrow(ProjectionRebuildError);
    expect(() => encodeCanonicalValue(undefined)).toThrow(ProjectionRebuildError);
  });

  it('fails closed on a string containing a framing control character', () => {
    // A value carrying the field separator would make the framing ambiguous.
    const withSeparator = `a${String.fromCharCode(0x1f)}b`;
    let raised: unknown;
    try {
      encodeCanonicalValue(withSeparator);
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ProjectionRebuildError);
    expect((raised as ProjectionRebuildError).code).toBe('projection-rebuild-uncanonical-value');
  });
});

describe('canonicalizeReadModelSnapshot / digestReadModelSnapshot — determinism', () => {
  const columns = ['event_type', 'event_count'];
  const row0 = { event_type: 'a.one', event_count: '3' };
  const row1 = { event_type: 'b.two', event_count: '1' };
  const rows = [row0, row1];

  it('is byte-stable across repeated canonicalisation of the same rows', () => {
    expect(canonicalizeReadModelSnapshot(rows, columns)).toBe(
      canonicalizeReadModelSnapshot(rows, columns),
    );
    expect(digestReadModelSnapshot(rows, columns)).toBe(digestReadModelSnapshot(rows, columns));
  });

  it('includes every requested column and reflects a value change in the digest', () => {
    const changed = [row0, { event_type: 'b.two', event_count: '2' }];
    expect(digestReadModelSnapshot(changed, columns)).not.toBe(
      digestReadModelSnapshot(rows, columns),
    );
  });

  it('is sensitive to row order (the caller must sort by primary key)', () => {
    const reversed = [row1, row0];
    expect(digestReadModelSnapshot(reversed, columns)).not.toBe(
      digestReadModelSnapshot(rows, columns),
    );
  });

  it('distinguishes a NULL value from the empty string and from the literal text "NULL"', () => {
    const nullRow = [{ event_type: 'x.one', event_count: null }];
    const emptyRow = [{ event_type: 'x.one', event_count: '' }];
    const textRow = [{ event_type: 'x.one', event_count: 'NULL' }];
    const a = digestReadModelSnapshot(nullRow, columns);
    const b = digestReadModelSnapshot(emptyRow, columns);
    const c = digestReadModelSnapshot(textRow, columns);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('produces a 64-hex-character SHA-256 digest', () => {
    expect(digestReadModelSnapshot(rows, columns)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonical SQL projections', () => {
  it('renders TIMESTAMPTZ to canonical UTC ISO text server-side', () => {
    expect(canonicalTimestamptzExpr('last_accepted_at')).toBe(
      `to_char(last_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    );
  });

  it('renders DATE to canonical YYYY-MM-DD text server-side', () => {
    expect(canonicalDateExpr('accepted_date')).toBe(`to_char(accepted_date, 'YYYY-MM-DD')`);
  });
});
