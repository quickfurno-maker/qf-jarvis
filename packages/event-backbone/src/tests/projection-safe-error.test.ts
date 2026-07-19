/**
 * The closed projection safe-error vocabulary (Stage 3.4.1, ADR-0034). Only the four repository-owned
 * codes are accepted; a raw database message, an exception string, or an arbitrary caller code is
 * refused — this is the gate that keeps unbounded error text out of the durable store.
 */
import { describe, expect, it } from 'vitest';

import {
  assertProjectionSafeErrorCode,
  isProjectionSafeErrorCode,
  PROJECTION_SAFE_ERROR_CODES,
  ProjectionSafeErrorCodeError,
} from '../projections/projection-safe-error.js';

describe('projection safe error codes', () => {
  it('accepts exactly the four closed codes and nothing else', () => {
    expect([...PROJECTION_SAFE_ERROR_CODES].sort()).toStrictEqual(
      [
        'projection-attempt-write-failed',
        'projection-checkpoint-invalid',
        'projection-handler-failed',
        'projection-state-write-failed',
      ].sort(),
    );
    for (const code of PROJECTION_SAFE_ERROR_CODES) {
      expect(isProjectionSafeErrorCode(code)).toBe(true);
      expect(assertProjectionSafeErrorCode(code)).toBe(code);
    }
  });

  it('refuses arbitrary error text, database messages, and unknown codes', () => {
    for (const value of [
      'ERROR: duplicate key value violates unique constraint',
      'connection refused',
      'Error: handler exploded\n  at foo (bar.ts:1:1)',
      'dead-letter', // a Stage 3.5 concept, deliberately absent here
      'replay',
      'PROJECTION-HANDLER-FAILED', // wrong case
      '',
      'select * from qf_jarvis.event',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isProjectionSafeErrorCode(value)).toBe(false);
      expect(() => assertProjectionSafeErrorCode(value)).toThrow(ProjectionSafeErrorCodeError);
    }
  });
});
