/**
 * The table-driven core: every valid fixture parses, every invalid fixture fails.
 *
 * These are not decorative tests. The invalid table is the one that proves the
 * boundary holds — that Jarvis cannot claim approval authority, that an ambiguous
 * result cannot be recorded as a success, that a phone number cannot reach a
 * recipient field. Each of those is a line in a document until something refuses
 * it, and this is the thing that refuses it.
 */

import { describe, expect, it } from 'vitest';

import { cloneFixture, INVALID_FIXTURES, VALID_FIXTURES } from '../fixtures/index.js';
import { SAFE_PARSERS } from './parsers.js';

describe('valid fixtures', () => {
  it.each(VALID_FIXTURES)('parses: $name', ({ contract, value }) => {
    const result = SAFE_PARSERS[contract](value);

    if (!result.success) {
      // Surface why, so a failure here is diagnosable rather than merely red.
      throw new Error(
        `Expected the fixture to parse, but it failed:\n${result.error.issues
          .map((issue) => `  ${issue.path || '<root>'}: ${issue.message}`)
          .join('\n')}`,
      );
    }

    expect(result.success).toBe(true);
  });

  it.each(VALID_FIXTURES)('survives a JSON round trip: $name', ({ contract, value }) => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(value));

    const result = SAFE_PARSERS[contract](roundTripped);
    expect(result.success).toBe(true);

    // The whole point of forbidding Date, bigint, undefined, NaN and class
    // instances: what goes over the wire comes back equal to what went in.
    expect(roundTripped).toStrictEqual(value);
  });

  it.each(VALID_FIXTURES)('does not mutate its input: $name', ({ contract, value }) => {
    const input = cloneFixture(value);
    const before = JSON.stringify(input);

    SAFE_PARSERS[contract](input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(VALID_FIXTURES)('returns a new object, not the input: $name', ({ contract, value }) => {
    const input = cloneFixture(value);
    const result = SAFE_PARSERS[contract](input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBe(input);
    }
  });
});

describe('invalid fixtures', () => {
  it.each(INVALID_FIXTURES)('rejects: $name', ({ contract, value, because }) => {
    const result = SAFE_PARSERS[contract](value);

    if (result.success) {
      throw new Error(`Expected this to be refused. ${because}`);
    }

    expect(result.success).toBe(false);
    expect(result.error.issues.length).toBeGreaterThan(0);
  });
});
