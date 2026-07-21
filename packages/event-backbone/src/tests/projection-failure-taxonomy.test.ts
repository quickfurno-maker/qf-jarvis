/**
 * QFJ-P03.07B — projection failure taxonomy (ADR-0040). Unit tests (no database).
 *
 * The load-bearing correction: an absent-code / ordinary error is `UNKNOWN_UNCLASSIFIED_FAILURE`, NOT
 * `DETERMINISTIC_HANDLER_FAILURE`. Classification is hostile-safe (never invokes a caller method, never
 * throws) and leaks no raw thrown value. Table-driven where useful.
 */
import { describe, expect, it } from 'vitest';

import * as publicApi from '../index.js';
import {
  PROJECTION_FAILURE_CATEGORIES,
  classifyProjectionFailure,
  deterministicHandlerFailure,
  inspectSqlstate,
  isProjectionFailureCategory,
  projectionCancellation,
  repositoryInvariantFailure,
  ProjectionDeterministicHandlerFailure,
  type ProjectionFailureCategory,
} from '../projections/projection-failure-taxonomy.js';
import { ProjectionSafeErrorCodeError } from '../projections/projection-safe-error.js';

const coded = (code: unknown): unknown => Object.assign(new Error('x'), { code });

function classify(error: unknown): ProjectionFailureCategory {
  return classifyProjectionFailure(error).category;
}

// --- inspectSqlstate (closed tri-state, hostile-safe) --------------------------------------------

describe('inspectSqlstate — closed tri-state, never invokes a caller method', () => {
  it('a well-formed data-property code is valid', () => {
    expect(inspectSqlstate(coded('40P01'))).toEqual({ kind: 'valid', code: '40P01' });
    expect(inspectSqlstate({ code: '23505' })).toEqual({ kind: 'valid', code: '23505' });
    expect(inspectSqlstate({ code: '99999' })).toEqual({ kind: 'valid', code: '99999' });
  });

  it('an ordinary Error / thrown primitive / no own code is absent', () => {
    expect(inspectSqlstate(new Error('boom'))).toEqual({ kind: 'absent' });
    expect(inspectSqlstate('a thrown string')).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(42)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(null)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate(undefined)).toEqual({ kind: 'absent' });
    expect(inspectSqlstate({})).toEqual({ kind: 'absent' });
  });

  it('an accessor code is invalid and the getter is NEVER invoked', () => {
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

  it('non-string / malformed / empty / lowercase / overlong codes are invalid', () => {
    for (const code of [42, null, {}, ['40P01'], '', '4', '40p01', '400011', 'ABCD!', ' 40P0']) {
      expect(inspectSqlstate({ code })).toEqual({ kind: 'invalid' });
    }
  });

  it('a plain function with no own code is absent; with a data code is valid', () => {
    const fn = (): void => undefined;
    expect(inspectSqlstate(fn)).toEqual({ kind: 'absent' });
    Object.defineProperty(fn, 'code', { value: '23505', enumerable: true, configurable: true });
    expect(inspectSqlstate(fn)).toEqual({ kind: 'valid', code: '23505' });
  });

  it('a hostile getOwnPropertyDescriptor trap is invalid and never leaks its secret', () => {
    const MARKER = 'DESCRIPTOR-SECRET-7f3a';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(MARKER);
        },
      },
    );
    let inspection: unknown;
    expect(() => {
      inspection = inspectSqlstate(hostile);
    }).not.toThrow();
    expect(inspection).toEqual({ kind: 'invalid' });
    expect(JSON.stringify(inspection)).not.toContain(MARKER);
  });

  it('a revoked Proxy is invalid and never throws a raw TypeError', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => inspectSqlstate(proxy)).not.toThrow();
    expect(inspectSqlstate(proxy)).toEqual({ kind: 'invalid' });
  });
});

// --- classifyProjectionFailure -------------------------------------------------------------------

describe('classifyProjectionFailure — the five closed categories', () => {
  it('the category vocabulary is exactly the five closed categories', () => {
    expect([...PROJECTION_FAILURE_CATEGORIES]).toEqual([
      'DETERMINISTIC_HANDLER_FAILURE',
      'TRANSIENT_INFRASTRUCTURE_FAILURE',
      'REPOSITORY_INVARIANT_FAILURE',
      'CANCELLATION_OR_SHUTDOWN',
      'UNKNOWN_UNCLASSIFIED_FAILURE',
    ]);
    expect(isProjectionFailureCategory('DETERMINISTIC_HANDLER_FAILURE')).toBe(true);
    expect(isProjectionFailureCategory('NOT_A_CATEGORY')).toBe(false);
    expect(isProjectionFailureCategory(42)).toBe(false);
  });

  it('an explicit deterministic-handler-failure contract => DETERMINISTIC (retry)', () => {
    const result = classifyProjectionFailure(deterministicHandlerFailure('bounded detail'));
    expect(result.category).toBe('DETERMINISTIC_HANDLER_FAILURE');
    expect(result.disposition).toBe('retry');
    expect(result.code).toBe('projection-handler-failed');
    expect(result.sqlstate).toBeNull();
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
  ])(
    'recognised deterministic SQLSTATE %s => DETERMINISTIC (retry), sqlstate preserved',
    (code) => {
      const result = classifyProjectionFailure(coded(code));
      expect(result.category).toBe('DETERMINISTIC_HANDLER_FAILURE');
      expect(result.disposition).toBe('retry');
      expect(result.sqlstate).toBe(code);
    },
  );

  it.each(['22000', '22007', '22P05'])('class-22 data-exception %s => DETERMINISTIC', (code) => {
    expect(classify(coded(code))).toBe('DETERMINISTIC_HANDLER_FAILURE');
  });

  it.each(['40P01', '40001', '08006', '08003', '57P01', '57P03', '53100', '53200', '53300'])(
    'recognised infrastructure SQLSTATE %s => TRANSIENT_INFRASTRUCTURE (fail closed)',
    (code) => {
      const result = classifyProjectionFailure(coded(code));
      expect(result.category).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
      expect(result.disposition).toBe('fail-closed');
      expect(result.sqlstate).toBe(code);
    },
  );

  it.each(['99999', 'ZZZZZ', 'XX000'])(
    'valid but unrecognised SQLSTATE %s => TRANSIENT_INFRASTRUCTURE (conservative, never deterministic)',
    (code) => {
      expect(classify(coded(code))).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
    },
  );

  it.each([undefined, null, 42, '', '40p01', 'ABCD!', '400011', ' 40P0'])(
    'a present-but-unreadable/malformed code %s => TRANSIENT_INFRASTRUCTURE (conservative)',
    (code) => {
      expect(classify({ code })).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
    },
  );

  it('THE CORRECTION: a plain Error with no recognised code => UNKNOWN_UNCLASSIFIED (fail closed)', () => {
    const result = classifyProjectionFailure(new Error('an ordinary bug'));
    expect(result.category).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
    expect(result.disposition).toBe('fail-closed');
    expect(result.code).toBe('projection-unknown-failure');
    expect(result.sqlstate).toBeNull();
  });

  it('a custom Error subclass without an approved code => UNKNOWN_UNCLASSIFIED', () => {
    class CustomError extends Error {}
    expect(classify(new CustomError('nope'))).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
    expect(classify({ notCode: true })).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
    expect(classify([1, 2, 3])).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
  });

  it.each([
    ['string thrown', 'a thrown string'],
    ['number thrown', 42],
    ['null thrown', null],
    ['undefined thrown', undefined],
    ['symbol thrown', Symbol('boom')],
  ])('%s => UNKNOWN_UNCLASSIFIED', (_label, value) => {
    expect(classify(value)).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
  });

  it('a recognised repository-invariant contract => REPOSITORY_INVARIANT (fail closed)', () => {
    const result = classifyProjectionFailure(repositoryInvariantFailure());
    expect(result.category).toBe('REPOSITORY_INVARIANT_FAILURE');
    expect(result.disposition).toBe('fail-closed');
    expect(classify(new ProjectionSafeErrorCodeError())).toBe('REPOSITORY_INVARIANT_FAILURE');
  });

  it('a cancellation / shutdown signal => CANCELLATION_OR_SHUTDOWN (fail closed)', () => {
    const result = classifyProjectionFailure(projectionCancellation());
    expect(result.category).toBe('CANCELLATION_OR_SHUTDOWN');
    expect(result.disposition).toBe('fail-closed');
    // a standard AbortError with an own data `name` is recognised
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classify(abort)).toBe('CANCELLATION_OR_SHUTDOWN');
  });

  it('cancellation and repository-invariant take precedence over any coincidental SQLSTATE', () => {
    const cancel = Object.assign(projectionCancellation(), { code: '23505' });
    expect(classify(cancel)).toBe('CANCELLATION_OR_SHUTDOWN');
    const invariant = Object.assign(repositoryInvariantFailure(), { code: '40P01' });
    expect(classify(invariant)).toBe('REPOSITORY_INVARIANT_FAILURE');
  });
});

// --- Hostile safety ------------------------------------------------------------------------------

describe('classifyProjectionFailure — hostile-safe and leak-free', () => {
  it('a hostile getter for code is never invoked; result is conservative infrastructure', () => {
    let invoked = false;
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'code', {
      get() {
        invoked = true;
        return '23505';
      },
      enumerable: true,
      configurable: true,
    });
    expect(classify(hostile)).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
    expect(invoked).toBe(false);
  });

  it('a hostile getter for message is never invoked; a no-code object is UNKNOWN', () => {
    let invoked = false;
    const hostile = {};
    Object.defineProperty(hostile, 'message', {
      get() {
        invoked = true;
        return 'SECRET';
      },
      enumerable: true,
      configurable: true,
    });
    expect(classify(hostile)).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
    expect(invoked).toBe(false);
  });

  it('a Proxy throwing on property access does not crash the classifier and does not leak', () => {
    const MARKER = 'PROXY-SECRET-19bc';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(MARKER);
        },
      },
    );
    let result: unknown;
    expect(() => {
      result = classifyProjectionFailure(hostile);
    }).not.toThrow();
    expect((result as { category: string }).category).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it('a revoked Proxy is conservative infrastructure and never throws', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => classifyProjectionFailure(proxy)).not.toThrow();
    expect(classify(proxy)).toBe('TRANSIENT_INFRASTRUCTURE_FAILURE');
  });

  it('a cyclic object with no code is UNKNOWN and does not crash the classifier', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => classifyProjectionFailure(cyclic)).not.toThrow();
    expect(classify(cyclic)).toBe('UNKNOWN_UNCLASSIFIED_FAILURE');
  });

  it('a deterministic contract sanitizes a hostile detail (strips control chars, caps length)', () => {
    const detail = `line1\nline2\t\u{1f600}${'x'.repeat(500)}`;
    const failure = deterministicHandlerFailure(detail);
    expect(failure.detail).toBeDefined();
    expect(failure.detail).not.toContain('\n');
    expect(failure.detail).not.toContain('\t');
    expect(failure.detail).not.toContain('\u{1f600}');
    expect((failure.detail ?? '').length).toBeLessThanOrEqual(200);
  });

  it('the classification result carries no free-text detail from a deterministic contract', () => {
    const result = classifyProjectionFailure(deterministicHandlerFailure('line1 secret detail'));
    expect(result.category).toBe('DETERMINISTIC_HANDLER_FAILURE');
    expect(Object.keys(result).sort()).toEqual(['category', 'code', 'disposition', 'sqlstate']);
    expect(JSON.stringify(result)).not.toContain('line1');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('the classification result is frozen (immutable)', () => {
    const result = classifyProjectionFailure(new Error('x'));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('the classifier never throws across a broad hostile input set, and every result is a category', () => {
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'code', {
      get() {
        throw new Error('nope');
      },
      enumerable: true,
      configurable: true,
    });
    const inputs: unknown[] = [
      new Error('x'),
      'string',
      42,
      0,
      null,
      undefined,
      Symbol('s'),
      [],
      {},
      { code: '23505' },
      { code: '40P01' },
      { code: 'ZZZZZ' },
      { code: null },
      { code: undefined },
      { code: 42 },
      throwingGetter,
      (): void => undefined,
      deterministicHandlerFailure(),
      repositoryInvariantFailure(),
      projectionCancellation(),
      new ProjectionDeterministicHandlerFailure(),
    ];
    for (const input of inputs) {
      let result: unknown;
      expect(() => {
        result = classifyProjectionFailure(input);
      }).not.toThrow();
      expect(isProjectionFailureCategory((result as { category: unknown }).category)).toBe(true);
    }
  });
});

// --- Public API containment ----------------------------------------------------------------------

describe('taxonomy stays internal — no package-root runtime surface change', () => {
  it('none of the taxonomy runtime symbols are reachable from the package root', () => {
    for (const symbol of [
      'classifyProjectionFailure',
      'deterministicHandlerFailure',
      'inspectSqlstate',
      'ProjectionDeterministicHandlerFailure',
      'PROJECTION_FAILURE_CATEGORIES',
      'repositoryInvariantFailure',
      'projectionCancellation',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });
});
