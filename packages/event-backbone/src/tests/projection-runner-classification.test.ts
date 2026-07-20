/**
 * Stage 3.4.4 — SQLSTATE classification, attempt/checkpoint reconciliation, and runner-error
 * serialization (ADR-0037). Unit tests (U5, U6). No database.
 */
import { describe, expect, it } from 'vitest';

import type { ProjectionAttemptRow } from '../projections/attempt-store.js';
import {
  assertFailedAttempts,
  classifyHandlerError,
  inspectSqlstate,
  isProjectionRunnerErrorSafely,
} from '../projections/projection-runner.js';
import {
  PROJECTION_RUNNER_ERROR_CODES,
  ProjectionRunnerError,
} from '../projections/projection-runner-errors.js';

const NOW = new Date('2026-07-19T00:00:00.000Z');
function failedRow(attemptNumber: number): ProjectionAttemptRow {
  return {
    sequence: BigInt(attemptNumber),
    attemptNumber,
    outcome: 'failed',
    safeErrorCode: 'projection-handler-failed',
    startedAt: NOW,
    completedAt: NOW,
    recordedAt: NOW,
  };
}
function succeededRow(attemptNumber: number): ProjectionAttemptRow {
  return { ...failedRow(attemptNumber), outcome: 'succeeded', safeErrorCode: null };
}

describe('inspectSqlstate — closed tri-state, never invokes a caller method (U5)', () => {
  it('a data-property code that is a well-formed SQLSTATE is valid (C5.3/C5.4)', () => {
    expect(inspectSqlstate(Object.assign(new Error('x'), { code: '40P01' }))).toEqual({
      kind: 'valid',
      code: '40P01',
    });
    expect(inspectSqlstate({ code: '23505' })).toEqual({ kind: 'valid', code: '23505' });
  });

  it('an ordinary Error / thrown primitive / no own code is absent (C5.1/C5.2)', () => {
    expect(inspectSqlstate(new Error('boom'))).toEqual({ kind: 'absent' });
    expect(inspectSqlstate('a thrown string')).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(42)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(null)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(undefined)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate({})).toEqual({ kind: 'absent' });
  });

  it('an accessor (getter) code is invalid and the getter is NEVER invoked (C5.5)', () => {
    let invoked = false;
    const hostile = {};
    Object.defineProperty(hostile, 'code', {
      get() {
        invoked = true;
        return '40P01';
      },
      enumerable: true,
      configurable: true,
    });
    expect(inspectSqlstate(hostile)).toEqual({ kind: 'invalid' });
    expect(invoked).toBe(false);
  });

  it('a non-string code is invalid (C5.6)', () => {
    expect(inspectSqlstate({ code: 42 })).toEqual({ kind: 'invalid' });
    expect(inspectSqlstate({ code: null })).toEqual({ kind: 'invalid' });
    expect(inspectSqlstate({ code: {} })).toEqual({ kind: 'invalid' });
    expect(inspectSqlstate({ code: ['40P01'] })).toEqual({ kind: 'invalid' });
  });

  it('a malformed / empty / arbitrary code string is invalid (C5.7)', () => {
    for (const code of ['', '4', '40p01', '400011', 'ABCD!', ' 40P0', 'drop table', '2350']) {
      expect(inspectSqlstate({ code })).toEqual({ kind: 'invalid' });
    }
  });

  it('a well-formed but unrecognised SQLSTATE is still valid — the tables decide (C5.8)', () => {
    expect(inspectSqlstate({ code: '99999' })).toEqual({ kind: 'valid', code: '99999' });
    expect(inspectSqlstate({ code: 'ZZZZZ' })).toEqual({ kind: 'valid', code: 'ZZZZZ' });
  });

  it('a hostile getOwnPropertyDescriptor trap is invalid and its secret never leaks (C5.9)', () => {
    const MARKER = 'DESCRIPTOR-SECRET-7f3a';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(MARKER);
        },
      },
    );
    let threw: unknown = null;
    let inspection: unknown;
    try {
      inspection = inspectSqlstate(hostile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull(); // the trap's throw never escapes
    expect(inspection).toEqual({ kind: 'invalid' });
    expect(JSON.stringify(inspection)).not.toContain(MARKER);
  });

  it('a revoked Proxy is invalid and does not throw a raw TypeError (C5.10)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => inspectSqlstate(proxy)).not.toThrow();
    expect(inspectSqlstate(proxy)).toEqual({ kind: 'invalid' });
  });
});

describe('inspectSqlstate — property-bearing FUNCTION values (Correction-3 C1)', () => {
  it('a plain function with no own code is absent (C3.1)', () => {
    const fn = (): void => undefined;
    expect(inspectSqlstate(fn)).toEqual({ kind: 'absent' });
    expect(classifyHandlerError(fn)).toBe('deterministic');
  });

  it('a function with an own data-property valid deterministic SQLSTATE is valid (C3.2)', () => {
    const fn = (): void => undefined;
    Object.defineProperty(fn, 'code', {
      value: '23505',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(inspectSqlstate(fn)).toEqual({ kind: 'valid', code: '23505' });
    expect(classifyHandlerError(fn)).toBe('deterministic');
  });

  it('a function with an own data-property valid infrastructure SQLSTATE is valid (C3.3)', () => {
    const fn = (): void => undefined;
    Object.defineProperty(fn, 'code', {
      value: '40P01',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(inspectSqlstate(fn)).toEqual({ kind: 'valid', code: '40P01' });
    expect(classifyHandlerError(fn)).toBe('infrastructure');
  });

  it('a function with an ACCESSOR code is invalid and the getter is NEVER invoked (C3.4)', () => {
    let invoked = false;
    const fn = (): void => undefined;
    Object.defineProperty(fn, 'code', {
      get() {
        invoked = true;
        return '23505';
      },
      enumerable: true,
      configurable: true,
    });
    expect(inspectSqlstate(fn)).toEqual({ kind: 'invalid' });
    expect(classifyHandlerError(fn)).toBe('infrastructure');
    expect(invoked).toBe(false); // the function's own getter never ran
  });

  it('a revoked FUNCTION Proxy is invalid and does not throw a raw TypeError (C3.5)', () => {
    const { proxy, revoke } = Proxy.revocable((): void => undefined, {});
    revoke();
    expect(() => inspectSqlstate(proxy)).not.toThrow();
    expect(inspectSqlstate(proxy)).toEqual({ kind: 'invalid' });
    expect(classifyHandlerError(proxy)).toBe('infrastructure');
  });

  it('a FUNCTION Proxy whose getOwnPropertyDescriptor trap throws a secret marker is invalid, no leak (C3.6)', () => {
    const MARKER = 'FN-DESCRIPTOR-SECRET-8e21';
    const hostile = new Proxy((): void => undefined, {
      getOwnPropertyDescriptor() {
        throw new Error(MARKER);
      },
    });
    let threw: unknown = null;
    let inspection: unknown;
    try {
      inspection = inspectSqlstate(hostile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull();
    expect(inspection).toEqual({ kind: 'invalid' });
    expect(JSON.stringify(inspection)).not.toContain(MARKER);
    expect(classifyHandlerError(hostile)).toBe('infrastructure');
  });
});

describe('isProjectionRunnerErrorSafely — guarded recognition (Correction-3 C2)', () => {
  it('recognises an authentic ProjectionRunnerError, retaining its exact code', () => {
    const error = new ProjectionRunnerError('projection-infrastructure-failed');
    expect(isProjectionRunnerErrorSafely(error)).toBe(true);
    expect(error.code).toBe('projection-infrastructure-failed'); // code intact
  });

  it('rejects an ordinary Error and a thrown primitive', () => {
    expect(isProjectionRunnerErrorSafely(new Error('boom'))).toBe(false);
    expect(isProjectionRunnerErrorSafely('a string')).toBe(false);
    expect(isProjectionRunnerErrorSafely(42)).toBe(false);
    expect(isProjectionRunnerErrorSafely(null)).toBe(false);
    expect(isProjectionRunnerErrorSafely(undefined)).toBe(false);
  });

  it('a revoked OBJECT Proxy is not recognised and never throws a raw TypeError', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => isProjectionRunnerErrorSafely(proxy)).not.toThrow();
    expect(isProjectionRunnerErrorSafely(proxy)).toBe(false);
  });

  it('a revoked FUNCTION Proxy is not recognised and never throws a raw TypeError', () => {
    const { proxy, revoke } = Proxy.revocable((): void => undefined, {});
    revoke();
    expect(() => isProjectionRunnerErrorSafely(proxy)).not.toThrow();
    expect(isProjectionRunnerErrorSafely(proxy)).toBe(false);
  });

  it('a hostile getPrototypeOf Proxy carrying a secret marker is not recognised and never leaks', () => {
    const MARKER = 'PROTO-SECRET-3f9d';
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(MARKER);
        },
      },
    );
    let threw: unknown = null;
    let recognised: unknown;
    try {
      recognised = isProjectionRunnerErrorSafely(hostile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull(); // the trap's throw never escapes `instanceof`
    expect(recognised).toBe(false);
  });
});

describe('classifyHandlerError (U5)', () => {
  it('absent code => deterministic (C5.1/C5.2)', () => {
    expect(classifyHandlerError(new Error('boom'))).toBe('deterministic');
    expect(classifyHandlerError('a thrown string')).toBe('deterministic');
    expect(classifyHandlerError({ nope: true })).toBe('deterministic');
  });

  it.each([
    '23505',
    '23514',
    '23503',
    '23502',
    '22001',
    '22P02',
    '42501',
    '42P01',
    '42703',
    '42883',
  ])('recognised handler-side SQLSTATE %s => deterministic (C5.3)', (code) => {
    expect(classifyHandlerError(Object.assign(new Error('x'), { code }))).toBe('deterministic');
  });

  it.each([
    '08006',
    '08003',
    '40P01',
    '40001',
    '53100',
    '53200',
    '55P03',
    '57014',
    '57P01',
    '58030',
    'XX000',
  ])('infrastructure SQLSTATE %s => infrastructure (C5.4)', (code) => {
    expect(classifyHandlerError(Object.assign(new Error('x'), { code }))).toBe('infrastructure');
  });

  it('a present-but-unrecognised well-formed code is conservative infrastructure (C5.8)', () => {
    expect(classifyHandlerError(Object.assign(new Error('x'), { code: '99999' }))).toBe(
      'infrastructure',
    );
    expect(classifyHandlerError(Object.assign(new Error('x'), { code: 'ZZZZZ' }))).toBe(
      'infrastructure',
    );
  });

  it('an accessor code is INFRASTRUCTURE and the getter is never invoked (C5.5)', () => {
    let invoked = false;
    const hostile = Object.assign(new Error('x'), {});
    Object.defineProperty(hostile, 'code', {
      get() {
        invoked = true;
        return '40P01';
      },
      enumerable: true,
      configurable: true,
    });
    expect(classifyHandlerError(hostile)).toBe('infrastructure');
    expect(invoked).toBe(false);
  });

  it('a non-string or malformed code is infrastructure (C5.6/C5.7)', () => {
    expect(classifyHandlerError({ code: 42 })).toBe('infrastructure');
    expect(classifyHandlerError({ code: '40p01' })).toBe('infrastructure');
    expect(classifyHandlerError({ code: '' })).toBe('infrastructure');
  });

  it('a hostile getOwnPropertyDescriptor trap => infrastructure, never throws, no secret leak (C5.9)', () => {
    const MARKER = 'CLASSIFY-SECRET-19bc';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(MARKER);
        },
      },
    );
    let threw: unknown = null;
    let result = 'unset';
    try {
      result = classifyHandlerError(hostile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull();
    expect(result).toBe('infrastructure');
  });

  it('a revoked Proxy => infrastructure, never a raw TypeError (C5.10)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => classifyHandlerError(proxy)).not.toThrow();
    expect(classifyHandlerError(proxy)).toBe('infrastructure');
  });
});

/** Run the reconciliation guard, returning the thrown error (or null on success). */
function runAssert(rows: readonly ProjectionAttemptRow[], expected: number): unknown {
  try {
    assertFailedAttempts(rows, expected);
    return null;
  } catch (error) {
    return error;
  }
}

describe('assertFailedAttempts reconciliation (U6)', () => {
  it('accepts exactly k failed attempts numbered 1..k', () => {
    expect(runAssert([], 0)).toBeNull();
    expect(runAssert([failedRow(1)], 1)).toBeNull();
    expect(runAssert([failedRow(1), failedRow(2), failedRow(3), failedRow(4)], 4)).toBeNull();
  });

  it('rejects a count mismatch', () => {
    expect(runAssert([failedRow(1)], 0)).toBeInstanceOf(ProjectionRunnerError);
    expect(runAssert([failedRow(1)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a gap in attempt numbers', () => {
    expect(runAssert([failedRow(1), failedRow(3)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a duplicate attempt number', () => {
    expect(runAssert([failedRow(1), failedRow(1)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a succeeded row among the expected failures', () => {
    expect(runAssert([failedRow(1), succeededRow(2)], 2)).toBeInstanceOf(ProjectionRunnerError);
    expect(runAssert([succeededRow(1)], 1)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('the divergence error is the closed code with no caller text', () => {
    const caught = runAssert([failedRow(1)], 3);
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect((caught as ProjectionRunnerError).code).toBe('projection-attempt-checkpoint-divergent');
  });
});

describe('ProjectionRunnerError — runtime-normalised, no leak (U5)', () => {
  it('normalises a forged code to the safe fallback and leaks no marker', () => {
    const MARKER = 'RUNNER-SECRET-9c1a';
    const forged = new ProjectionRunnerError(MARKER as never);
    expect(forged.code).toBe('projection-infrastructure-failed');
    const rendered = `${forged.message} ${forged.code} ${forged.stack ?? ''}`;
    expect(rendered).not.toContain(MARKER);
    expect((forged as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(forged)).not.toContain(MARKER);
  });

  it('every declared code maps to a non-empty fixed message', () => {
    for (const code of PROJECTION_RUNNER_ERROR_CODES) {
      const error = new ProjectionRunnerError(code);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
