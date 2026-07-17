/**
 * The safe validation-issue mapper (ADR-0030 correction 1): it must never let a validator-native
 * message or an arbitrary (possibly sender-controlled) key name escape into a rejection.
 *
 * Imported from the INTERNAL module on purpose — the mapper and its vocabulary are not part of the
 * package-root surface (`public-api.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import type { ContractIssue } from '@qf-jarvis/contracts';

import {
  mapSafeValidationIssues,
  MAX_ISSUE_PATH_LENGTH,
  MAX_PATH_DEPTH,
  MAX_REJECTION_ISSUES,
  SAFE_VALIDATION_ISSUE_CODES,
  SAFE_VALIDATION_MESSAGES,
  safeStructuralPath,
  toSafeValidationCode,
} from '../ingest/rejection.js';

const SAFE_CODES = new Set<string>(SAFE_VALIDATION_ISSUE_CODES);
const SAFE_MESSAGES = new Set<string>(Object.values(SAFE_VALIDATION_MESSAGES));

function issue(path: string, code: string, message: string): ContractIssue {
  return { path, code, message };
}

describe('safeStructuralPath', () => {
  it('returns the empty path unchanged', () => {
    expect(safeStructuralPath('')).toBe('');
  });

  it('retains a top-level canonical-envelope field name verbatim', () => {
    expect(safeStructuralPath('eventType')).toBe('eventType');
    expect(safeStructuralPath('payload')).toBe('payload');
    expect(safeStructuralPath('subject')).toBe('subject');
  });

  it('makes every non-envelope segment opaque, keeping bounded numeric indexes', () => {
    expect(safeStructuralPath('payload.recommendation.confidence')).toBe('payload.[field].[field]');
    expect(safeStructuralPath('payload.recommendation.evidence.0.description')).toBe(
      'payload.[field].[field].[0].[field]',
    );
  });

  it('never lets a raw key name (which may be sensitive) appear in the path', () => {
    // A hostile key with dots fragments into several opaque segments — a stronger no-leak case.
    const hostile = 'client-secret@example.com';
    expect(safeStructuralPath(`payload.${hostile}`)).toBe('payload.[field].[field]');
    expect(safeStructuralPath(`subject.${hostile}.value`)).toBe('subject.[field].[field].[field]');
    expect(safeStructuralPath(hostile)).toBe('[field].[field]');
    // A dotless hostile key collapses to a single opaque token.
    const dotless = 'client-secret-token-abcdef';
    expect(safeStructuralPath(`payload.${dotless}`)).toBe('payload.[field]');
    for (const built of [
      safeStructuralPath(`payload.${hostile}`),
      safeStructuralPath(hostile),
      safeStructuralPath(`payload.${dotless}`),
    ]) {
      expect(built).not.toContain('client-secret');
      expect(built).not.toContain('@');
      expect(built).not.toContain('example');
    }
  });

  it('does not retain an envelope name below the top level', () => {
    // `subject` appears at depth 1 here — it must not be retained; only depth 0 is trusted.
    expect(safeStructuralPath('payload.subject')).toBe('payload.[field]');
  });

  it('treats an over-long numeric segment as opaque, not as an index', () => {
    expect(safeStructuralPath('payload.12345678')).toBe('payload.[field]');
  });

  it('bounds path depth and total length', () => {
    const deep = ['payload', ...Array.from({ length: 20 }, (_v, i) => String(i))].join('.');
    const built = safeStructuralPath(deep);
    expect(built.endsWith('…')).toBe(true);
    // At most MAX_PATH_DEPTH segments were emitted before the marker.
    const beforeMarker = built.slice(0, -1).replace(/\.$/, '');
    expect(beforeMarker.split('.').length).toBeLessThanOrEqual(MAX_PATH_DEPTH);
    expect(built.length).toBeLessThanOrEqual(MAX_ISSUE_PATH_LENGTH + 1);
  });
});

describe('toSafeValidationCode', () => {
  it('maps known validator codes into the closed safe vocabulary', () => {
    expect(toSafeValidationCode('invalid_type')).toBe('invalid-type');
    expect(toSafeValidationCode('unrecognized_keys')).toBe('unknown-field');
    expect(toSafeValidationCode('invalid_format')).toBe('invalid-format');
    expect(toSafeValidationCode('too_big')).toBe('constraint-violation');
    expect(toSafeValidationCode('too_small')).toBe('constraint-violation');
    expect(toSafeValidationCode('custom')).toBe('constraint-violation');
    expect(toSafeValidationCode('invalid_value')).toBe('invalid-value');
  });

  it('maps any unrecognised validator code to a safe fallback in the closed set', () => {
    expect(SAFE_CODES.has(toSafeValidationCode('some_future_zod_code'))).toBe(true);
    expect(SAFE_CODES.has(toSafeValidationCode(''))).toBe(true);
  });
});

describe('mapSafeValidationIssues', () => {
  it('emits only codes from the closed safe set, and only fixed repository-owned messages', () => {
    const codes = ['invalid_type', 'unrecognized_keys', 'too_big', 'custom', 'weird_code'];
    const mapped = mapSafeValidationIssues(
      codes.map((c, i) => issue(`payload.f${String(i)}`, c, 'x')),
    );
    for (const safe of mapped.issues) {
      expect(SAFE_CODES.has(safe.code)).toBe(true);
      expect(SAFE_MESSAGES.has(safe.message)).toBe(true);
      expect(safe.message).toBe(SAFE_VALIDATION_MESSAGES[safe.code]);
    }
  });

  it('cannot be made to leak a malicious message or path', () => {
    const email = 'victim@example.com';
    const token = 'sk-secret-abcdef0123456789';
    const mapped = mapSafeValidationIssues([
      issue(
        `payload.recommendation.${email}`,
        'custom',
        `leaked ${token} and eventType qf.evil@9 and supported: a,b,c`,
      ),
    ]);
    const serialized = JSON.stringify(mapped);
    for (const fragment of [email, token, 'qf.evil@9', 'supported', '@']) {
      expect(serialized).not.toContain(fragment);
    }
    expect(mapped.issues[0]?.code).toBe('constraint-violation');
    expect(mapped.issues[0]?.path).toBe('payload.[field].[field].[field]');
    expect(mapped.issues[0]?.message).toBe(SAFE_VALIDATION_MESSAGES['constraint-violation']);
  });

  it('deduplicates issues that map to the same (path, code)', () => {
    const mapped = mapSafeValidationIssues([
      issue('payload.a', 'invalid_type', 'm1'),
      issue('payload.b', 'invalid_type', 'm2'), // same safe path [field] and code
      issue('payload.c', 'invalid_type', 'm3'),
    ]);
    // payload.a/b/c all collapse to 'payload.[field]' with code 'invalid-type'.
    expect(mapped.issues.length).toBe(1);
    expect(mapped.issuesTruncated).toBe(false);
  });

  it('orders issues deterministically regardless of input order', () => {
    const inputs = [
      issue('subject', 'invalid_type', 'a'),
      issue('eventId', 'invalid_type', 'b'),
      issue('payload', 'too_big', 'c'),
      issue('payload', 'invalid_type', 'd'),
    ];
    const first = mapSafeValidationIssues(inputs).issues.map((i) => `${i.path}|${i.code}`);
    const second = mapSafeValidationIssues([...inputs].reverse()).issues.map(
      (i) => `${i.path}|${i.code}`,
    );
    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort());
  });

  it('sets issuesTruncated only when more than the cap of unique issues exists', () => {
    const few = mapSafeValidationIssues(
      Array.from({ length: 3 }, (_v, i) => issue(String(i), 'invalid_type', 'm')),
    );
    // Distinct numeric indexes → distinct safe paths, so these stay unique.
    expect(few.issuesTruncated).toBe(false);

    const many = mapSafeValidationIssues(
      Array.from({ length: MAX_REJECTION_ISSUES + 4 }, (_v, i) =>
        issue(String(i), 'invalid_type', 'm'),
      ),
    );
    expect(many.issues.length).toBe(MAX_REJECTION_ISSUES);
    expect(many.issuesTruncated).toBe(true);
  });

  it('freezes the result, the issue array, and every issue', () => {
    const mapped = mapSafeValidationIssues([issue('payload.x', 'invalid_type', 'm')]);
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.issues)).toBe(true);
    expect(Object.isFrozen(mapped.issues[0])).toBe(true);
  });
});
