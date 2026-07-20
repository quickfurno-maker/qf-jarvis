/**
 * Stage 3.4.4 — the deterministic advisory-lock key (ADR-0037). Unit tests: fixed vectors, distinctness,
 * stability, and the decimal-string parameter (never a JS number). No database.
 */
import { describe, expect, it } from 'vitest';

import {
  PROJECTION_LOCK_KEY_DOMAIN,
  projectionAdvisoryLockKey,
  projectionAdvisoryLockKeyParameter,
} from '../projections/projection-lock-key.js';
import { toProjectionName } from '../projections/projection-name.js';
import { ProjectionInputError } from '../projections/projection-errors.js';

const NAME_A = toProjectionName('event-type-activity');
const NAME_B = toProjectionName('daily-event-acceptance');

describe('projectionAdvisoryLockKey — fixed vectors (U1)', () => {
  it.each([
    ['event-type-activity', 1, -5669050953429467864n],
    ['daily-event-acceptance', 1, 1246584766324522588n],
    ['event-type-activity', 2, -9050093009359467535n],
  ])('name=%s version=%d -> %s', (name, version, expected) => {
    expect(projectionAdvisoryLockKey(toProjectionName(name), version)).toBe(expected);
    expect(projectionAdvisoryLockKeyParameter(toProjectionName(name), version)).toBe(
      expected.toString(10),
    );
  });

  it('the domain prefix is the versioned constant', () => {
    expect(PROJECTION_LOCK_KEY_DOMAIN).toBe('qf-jarvis/projection-lock/v1');
  });
});

describe('projectionAdvisoryLockKey — properties (U2)', () => {
  it('is stable across repeated calls', () => {
    expect(projectionAdvisoryLockKey(NAME_A, 1)).toBe(projectionAdvisoryLockKey(NAME_A, 1));
  });

  it('distinguishes name and version', () => {
    const a1 = projectionAdvisoryLockKey(NAME_A, 1);
    const a2 = projectionAdvisoryLockKey(NAME_A, 2);
    const b1 = projectionAdvisoryLockKey(NAME_B, 1);
    expect(a1).not.toBe(a2);
    expect(a1).not.toBe(b1);
    expect(a2).not.toBe(b1);
  });

  it('returns a bigint within the signed int64 range', () => {
    for (const [name, version] of [
      [NAME_A, 1],
      [NAME_B, 1],
      [NAME_A, 2],
    ] as const) {
      const key = projectionAdvisoryLockKey(name, version);
      expect(typeof key).toBe('bigint');
      expect(key >= -(2n ** 63n)).toBe(true);
      expect(key < 2n ** 63n).toBe(true);
    }
  });

  it('the parameter is a decimal string, never a JS number (precision would be lost)', () => {
    const param = projectionAdvisoryLockKeyParameter(NAME_A, 1);
    expect(typeof param).toBe('string');
    expect(param).toBe('-5669050953429467864');
    // Round-tripping through Number would corrupt this magnitude (> Number.MAX_SAFE_INTEGER).
    expect(Math.abs(Number(param))).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(BigInt(param).toString(10)).toBe(param);
  });

  it('fails closed on an invalid version', () => {
    expect(() => projectionAdvisoryLockKey(NAME_A, 0)).toThrow(ProjectionInputError);
    expect(() => projectionAdvisoryLockKey(NAME_A, 1.5)).toThrow(ProjectionInputError);
  });
});
