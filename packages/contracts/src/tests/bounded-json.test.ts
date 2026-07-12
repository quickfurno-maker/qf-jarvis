/**
 * Bounded JSON — the most dangerous field in the package, tested accordingly.
 *
 * Every rejection here corresponds to a way that "some JSON" becomes a data-loss
 * bug, a hang, or a smuggling route.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JSON_LIMITS,
  inspectGovernedContent,
  inspectJsonValue,
  isBoundedJsonValue,
} from '../index.js';

function codesFor(value: unknown): string[] {
  return inspectJsonValue(value).map((issue) => issue.code);
}

describe('bounded JSON: what is accepted', () => {
  it.each([
    ['a string', 'hello'],
    ['a finite number', 42],
    ['a negative number', -1.5],
    ['a boolean', true],
    ['null', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['a nested plain structure', { a: [1, 'two', { three: false, four: null }] }],
  ])('accepts %s', (_label, value) => {
    expect(isBoundedJsonValue(value)).toBe(true);
  });

  it('accepts a value shared twice without being cyclic', () => {
    // A DAG is not a cycle. The same sub-object referenced side by side
    // serializes perfectly well, and must not be mistaken for a loop.
    const shared = { label: 'shared' };
    expect(isBoundedJsonValue({ first: shared, second: shared })).toBe(true);
  });
});

describe('bounded JSON: what is refused', () => {
  it('refuses undefined, which JSON.stringify silently drops', () => {
    expect(codesFor({ a: undefined })).toContain('json.undefined');
  });

  it('refuses a function', () => {
    expect(codesFor({ a: () => 'nope' })).toContain('json.function');
  });

  it('refuses a symbol', () => {
    expect(codesFor({ a: Symbol('nope') })).toContain('json.symbol');
  });

  it('refuses a symbol key', () => {
    expect(codesFor({ [Symbol('k')]: 'v' })).toContain('json.symbol-key');
  });

  it('refuses a bigint, which JSON.stringify throws on', () => {
    expect(codesFor({ a: 10n })).toContain('json.bigint');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('refuses %s, which JSON.stringify turns into null', (_label, value) => {
    expect(codesFor({ a: value })).toContain('json.non-finite-number');
  });

  it.each([
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    [
      'a class instance',
      new (class Thing {
        public readonly kind = 'thing';
      })(),
    ],
  ])('refuses %s, which serializes to something other than itself', (_label, value) => {
    expect(codesFor({ a: value })).toContain('json.class-instance');
  });

  it('refuses a cyclic reference rather than hanging on it', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(codesFor(cyclic)).toContain('json.cyclic');
  });

  it('refuses nesting beyond the depth limit', () => {
    let nested: Record<string, unknown> = { bottom: true };
    for (let level = 0; level <= DEFAULT_JSON_LIMITS.maxDepth + 2; level += 1) {
      nested = { nested };
    }

    expect(codesFor(nested)).toContain('json.max-depth-exceeded');
  });

  it('refuses an oversized string', () => {
    const tooLong = 'x'.repeat(DEFAULT_JSON_LIMITS.maxStringLength + 1);
    expect(codesFor({ a: tooLong })).toContain('json.string-too-long');
  });

  it('refuses an oversized array', () => {
    const tooMany = Array.from({ length: DEFAULT_JSON_LIMITS.maxArrayItems + 1 }, () => 1);
    expect(codesFor(tooMany)).toContain('json.array-too-large');
  });

  it('refuses too many keys', () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index <= DEFAULT_JSON_LIMITS.maxObjectKeys; index += 1) {
      wide[`key${String(index)}`] = index;
    }

    expect(codesFor(wide)).toContain('json.too-many-keys');
  });

  it('bounds total work, so a shared sub-tree cannot explode the walk', () => {
    // Not cyclic, and not deep — but exponentially many nodes when walked.
    let node: unknown = { leaf: true };
    for (let level = 0; level < 12; level += 1) {
      node = { a: node, b: node };
    }

    expect(codesFor(node)).toContain('json.too-many-nodes');
  });
});

describe('bounded JSON: issues never echo the value', () => {
  it('reports the path, and not the secret it just refused', () => {
    const secret = 'FAKE-SECRET-DO-NOT-ECHO-9d3f';
    const issues = inspectJsonValue({ nested: { bad: Number.NaN, note: secret } });

    const serialized = JSON.stringify(issues);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('nested');
  });
});

describe('governed content', () => {
  it.each([
    ['apiKey', { apiKey: 'x' }],
    ['api_key', { api_key: 'x' }],
    ['API-KEY', { 'API-KEY': 'x' }],
    ['accessToken', { accessToken: 'x' }],
    ['password', { password: 'x' }],
    ['phoneNumber', { phoneNumber: 'x' }],
    ['email', { email: 'x' }],
    ['transcript', { transcript: 'x' }],
    ['chainOfThought', { chainOfThought: 'x' }],
    ['prompt', { prompt: 'x' }],
  ])('refuses the forbidden key %s, however it is spelled', (_label, value) => {
    const issues = inspectGovernedContent(value, []);
    expect(issues.map((issue) => issue.code)).toContain('governed.forbidden-key');
  });

  it.each([
    ['an email address', 'someone@example.invalid'],
    ['an E.164 phone number', '+919876543210'],
    ['a bare long digit run', '919876543210'],
  ])('refuses %s appearing as a value', (_label, value) => {
    const issues = inspectGovernedContent({ note: value }, []);
    expect(issues.map((issue) => issue.code)).toContain('governed.contact-detail');
  });

  it.each([
    ['an RFC 3339 timestamp', '2026-07-11T09:00:00Z'],
    ['a UUID', '4f6b1e2a-0c3d-4e5f-8a9b-1c2d3e4f5a6b'],
    ['an opaque Core id', 'CORE-CLIENT-00311'],
    ['ordinary prose', 'The client has been silent for four days.'],
  ])('does not fire on %s', (_label, value) => {
    expect(inspectGovernedContent({ note: value }, [])).toHaveLength(0);
  });
});
