/**
 * `toProjectionName` / `isProjectionName` — the internal projection-name vocabulary (Stage 3.4.1,
 * ADR-0034). A projection name is repository-owned lowercase kebab-case, bounded to 64 characters.
 */
import { describe, expect, it } from 'vitest';

import {
  isProjectionName,
  MAX_PROJECTION_NAME_LENGTH,
  ProjectionNameError,
  toProjectionName,
} from '../projections/projection-name.js';

describe('projection name — valid', () => {
  it('accepts lowercase kebab-case names, including the two Stage 3.4 proof projections', () => {
    for (const name of [
      'event-type-activity',
      'daily-event-acceptance',
      'a',
      'projection1',
      'a-b-c',
      'x9-y9',
    ]) {
      expect(isProjectionName(name)).toBe(true);
      expect(toProjectionName(name)).toBe(name);
    }
  });

  it('accepts a name at exactly the maximum length', () => {
    const name = 'a'.repeat(MAX_PROJECTION_NAME_LENGTH);
    expect(isProjectionName(name)).toBe(true);
    expect(toProjectionName(name)).toBe(name);
  });
});

describe('projection name — invalid (rejected with a typed, text-safe error)', () => {
  it.each([
    ['empty', ''],
    ['uppercase', 'Event-Type'],
    ['leading digit', '1projection'],
    ['leading hyphen', '-projection'],
    ['trailing hyphen', 'projection-'],
    ['doubled hyphen', 'a--b'],
    ['whitespace', 'event type'],
    ['leading/trailing space', ' event '],
    ['path-like slash', 'a/b'],
    ['path-like backslash', 'a\\b'],
    ['underscore', 'event_type'],
    ['dot', 'event.type'],
    ['unicode', 'événement'],
    ['overlength', 'a'.repeat(MAX_PROJECTION_NAME_LENGTH + 1)],
  ])('rejects %s', (_label, value) => {
    expect(isProjectionName(value)).toBe(false);
    expect(() => toProjectionName(value)).toThrow(ProjectionNameError);
  });

  it('rejects non-string input', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(isProjectionName(value)).toBe(false);
      expect(() => toProjectionName(value)).toThrow(ProjectionNameError);
    }
  });
});
